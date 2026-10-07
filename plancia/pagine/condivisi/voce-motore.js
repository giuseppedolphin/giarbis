// Il motore della voce: la coda UNICA e seriale di ciò che l'assistente dice, la stessa per cockpit e bolla.
//  - Una cosa alla volta: mai due audio insieme; un messaggio nuovo va in coda dopo quello in corso.
//  - Parla una scheda sola: il possesso sta in microfono.js (canale «plancia-voce»); senza possesso non si accoda niente,
//    e perdendolo si ferma tutto.
//  - Il testo arriva a pezzi mentre l'assistente scrive: flusso() lo taglia in frasi e le accoda man mano. Ogni frase
//    parte verso la sintesi (/api/voce) e l'audio si suona mentre scarica; la successiva si prepara mentre suona la prima.
//    Se il server non ha la voce, riserva: la voce del browser.
//  - Cosa si legge: deveLeggere(turno).
// Chi ha bisogno di sapere cosa succede (volto, pulsante, bolla) usa stato() e suStato().
import { api } from "./api.js";
import { memo } from "./memo.js";
import { avviaPossesso, inoltraAlPossessore, possiedo, suInoltrato, suPossesso } from "./microfono.js";

const BASE_VOCE = "/api/voce";
const ATTESA_PENSIERO_MS = 1200;
const FRASI_ATTESA = ["Fammi riflettere un attimo.", "Sto pensando.", "Ci sono, ci penso un secondo.", "Fammi guardare.", "Un attimo che ragiono.", "Vediamo."];

// ---- impostazioni (sul server: le stesse per tutte le pagine) -------------------------------------
let imp = { motore: "realtime", voce: "ash", velocita: 1.1, chiave: "", tono: "", tonoPredefinito: "", grezze: {} };

export const impostazioni = () => imp;

export async function caricaImpostazioni() {
  const j = await api("GET", "/api/impostazioni");
  imp = {
    motore: j.motore || "realtime", voce: j.voce, velocita: j.velocita || 1.1, chiave: j.chiaveVoce || "",
    tono: j.tono || "", tonoPredefinito: j.tonoPredefinito || "", grezze: j,
  };
  return j;
}

export async function salvaImpostazioni(campi) {
  await api("POST", "/api/impostazioni", campi);
  return caricaImpostazioni();
}

// ---- stato della coda ------------------------------------------------------------------------------
let voceOn = memo.get("voce", "1") === "1";
const coda = [];            // elementi {testo, turno, audio, reg} in attesa
let corrente = null;        // l'elemento che sta suonando
let sospesa = false;        // microfono aperto: la voce aspetta
let voceServer = true;      // false dopo un errore del server: si passa alla voce del browser
let audioCtx = null, analizzatore = null;
const attivi = new Set();   // i flussi aperti (testo ancora in arrivo)
const ascoltatori = new Set();
let ultimoStato = "";
let contaTurni = 0;

// → { parlando, inCoda, sospesa }: parlando = c'è voce in corso o in coda (e il microfono non la tiene ferma);
// inCoda = quanti messaggi aspettano dopo quello in corso.
export function stato() {
  const rif = corrente?.turno ?? coda[0]?.turno;
  const altri = new Set(coda.filter((e) => e.turno !== rif).map((e) => e.turno));
  return { parlando: !sospesa && (!!corrente || coda.length > 0), inCoda: altri.size, sospesa };
}

function notifica() {
  const s = stato();
  const chiave = JSON.stringify(s);
  if (chiave === ultimoStato) return;
  ultimoStato = chiave;
  for (const fn of ascoltatori) { try { fn(s); } catch (e) { console.error(e); } }
}

// fn(stato) a ogni cambio, e subito una volta; restituisce la funzione che toglie l'ascolto.
export function suStato(fn) {
  ascoltatori.add(fn);
  try { fn(stato()); } catch (e) { console.error(e); }
  return () => ascoltatori.delete(fn);
}

// Il volume della voce che suona (AnalyserNode), null con la voce del browser: fa pulsare sonar e volto.
export const analizzatoreVoce = () => analizzatore;

// ---- il registro di ciò che la sintesi dice (per non scambiare la propria voce per la tua) -------------
const registro = [];
function registraFrase(testo) {
  const ora = Date.now();
  for (let i = registro.length - 1; i >= 0; i--) if (registro[i].fine && ora - registro[i].fine > 10000) registro.splice(i, 1);
  const r = { testo, fine: 0 };
  registro.push(r);
  return r;
}

// Vero se la sintesi sta dicendo, o ha finito da meno di 4 secondi, una frase che contiene il motivo (RegExp):
// serve alla frase di chiamata, che la voce stessa pronuncia spesso.
export function sintesiDice(motivo) {
  const ora = Date.now();
  return registro.some((r) => (!r.fine || ora - r.fine < 4000) && motivo.test(r.testo));
}

// ---- cosa si legge ---------------------------------------------------------------------------------
// turno = { origine, urgente }. I turni aperti da te, dalla bolla o da un agente (il riassunto di fine lavoro) si leggono;
// quelli del battito no, salvo una proposta urgente.
export function deveLeggere(turno = {}) {
  if (turno.origine === "battito") return !!turno.urgente;
  return true;
}

// ---- riproduzione ------------------------------------------------------------------------------------
const modalitaServer = () => voceServer && !!imp.chiave;

function creaAudio(el) {
  const a = new Audio(`${BASE_VOCE}?k=${encodeURIComponent(imp.chiave)}&t=${encodeURIComponent(el.testo)}`);
  a.preload = "auto"; a.preservesPitch = true;
  a.onerror = () => {
    voceServer = false;
    if (corrente === el) leggiBrowser(el); else a.guasto = true;
  };
  return a;
}

function avanza() {
  if (corrente) return;
  if (sospesa || !possiedo()) { notifica(); return; }
  const el = coda.shift();
  if (!el) { analizzatore = null; notifica(); return; }
  corrente = el;
  preparaProssime();
  if (el.audio && !el.audio.guasto) suonaAudio(el); else leggiBrowser(el);
  preparaProssime();
  notifica();
}

function finito(el) {
  if (corrente !== el) return;
  if (el.reg && !el.reg.fine) el.reg.fine = Date.now();
  corrente = null;
  analizzatore = null;
  avanza();
}

function suonaAudio(el) {
  const a = el.audio;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaElementSource(a);
    analizzatore = audioCtx.createAnalyser();
    analizzatore.fftSize = 256;
    src.connect(analizzatore); analizzatore.connect(audioCtx.destination);
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch { analizzatore = null; }
  a.defaultPlaybackRate = a.playbackRate = imp.velocita;
  a.onended = () => finito(el);
  a.play().catch(() => { if (!sospesa) finito(el); }); // in pausa per il microfono: riparte da sospendi(false)
}

function vocePreferita() {
  const v = speechSynthesis.getVoices().filter((x) => (x.lang || "").toLowerCase().startsWith("it"));
  return v.find((x) => /premium|enhanced|siri/i.test(x.name)) || v.find((x) => /google/i.test(x.name))
    || v.find((x) => /alice|federica|luca|paola/i.test(x.name)) || v[0] || null;
}

// La riserva: la voce del browser, frase per frase.
function leggiBrowser(el) {
  if (!("speechSynthesis" in window)) { finito(el); return; }
  analizzatore = null;
  const frasi = el.testo.match(/[^.!?;:]+[.!?;:]*/g) || [el.testo];
  const voce = vocePreferita();
  frasi.forEach((f, i) => {
    const u = new SpeechSynthesisUtterance(f.trim());
    u.lang = "it-IT"; u.rate = 1.05;
    if (voce) u.voice = voce;
    if (i === frasi.length - 1) u.onend = () => finito(el);
    u.onerror = () => finito(el);
    speechSynthesis.speak(u);
  });
}

// Chrome parla solo dopo un gesto dell'utente: al primo gesto si pronuncia una frase vuota per sbloccarlo.
let sbloccata = false;
export function sbloccaVoce() {
  if (sbloccata || !("speechSynthesis" in window)) return;
  sbloccata = true;
  const u = new SpeechSynthesisUtterance(" ");
  u.volume = 0;
  speechSynthesis.speak(u);
}

// ---- accodare ----------------------------------------------------------------------------------------
// Ciò che sta fra backtick (codice, percorsi, id) si vede ma non si legge; URL e tabelle nemmeno.
export function pulisciPerVoce(t) {
  return String(t || "").replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ").split("\n").filter((r) => !r.trim().startsWith("|")).join("\n")
    .replace(/[*_#>|~]/g, "").replace(/\s+([,.;:!?])/g, "$1").replace(/\s+/g, " ").trim().slice(0, 1200);
}

function accoda(frase, turno) {
  if (!voceOn || !possiedo() || turno.muto) return;
  const testo = pulisciPerVoce(frase);
  if (!testo || !/[\p{L}\p{N}]/u.test(testo)) return;
  const el = { testo, turno: turno.id, audio: null, reg: registraFrase(testo) };
  coda.push(el);
  avanza();
  preparaProssime();
  notifica();
}

// L'audio si prepara (e si paga) solo per la frase in corso e per la successiva: le frasi che poi si saltano non costano.
function preparaProssime() {
  if (!modalitaServer()) return;
  for (const el of [corrente, coda[0]]) if (el && !el.audio && !el.guasto) el.audio = creaAudio(el);
}

// Il segmentatore: taglia a fine frase o a capo, salta i blocchi di codice e le righe di tabella. Il primo pezzo può
// essere corto (parte prima), i successivi si accorpano fino a ~140 caratteri.
function nuovoSegmentatore() { return { buf: "", recinto: false, primo: true, attesa: "" }; }

function segmenta(v, testo, emetti) {
  v.buf += testo;
  let m;
  while ((m = v.buf.match(/^[\s\S]*?(?:[.!?…](?=\s)|\n)/))) {
    const pezzo = m[0];
    v.buf = v.buf.slice(pezzo.length);
    const riga = pezzo.trim();
    if (riga.startsWith("```")) { v.recinto = !v.recinto; continue; }
    if (v.recinto || riga.startsWith("|")) continue;
    v.attesa += pezzo;
    if (v.attesa.trim().length >= (v.primo ? 12 : 140) || pezzo.endsWith("\n")) { emetti(v.attesa); v.attesa = ""; v.primo = false; }
  }
}

function svuota(v, emetti) {
  if (!v.recinto && v.buf.trim()) v.attesa += v.buf;
  if (v.attesa.trim()) emetti(v.attesa);
  v.buf = ""; v.attesa = "";
}

// La risposta in streaming di un turno: nutri(delta) a ogni pezzo di testo, fine() quando il testo si interrompe
// (uno strumento, la fine del turno). idTurno serve a prossimo(), che salta un messaggio intero.
export function flusso(idTurno) {
  const turno = { id: idTurno ?? `t${++contaTurni}`, muto: false, haTesto: false };
  attivi.add(turno);
  const seg = nuovoSegmentatore();
  const emetti = (f) => accoda(f, turno);
  return {
    turno,
    nutri(delta) {
      if (turno.muto || !delta) return;
      turno.haTesto = true;
      attesaPensiero.testoArrivato();
      segmenta(seg, String(delta), emetti);
    },
    fine() {
      if (!turno.muto) svuota(seg, emetti);
      attivi.delete(turno);
    },
  };
}

// La guardia di un turno dell'assistente, per chi ascolta gli eventi (cockpit e bolla): un turno = UN flusso «guardia» che non
// riceve testo + un «segmento» per ogni tratto di testo fra uno strumento e l'altro. Guardia e segmenti hanno lo stesso id, quindi
// stop e «avanti» (che mutano per id) silenziano insieme il segmento in corso e i tratti che arrivano dopo, nello stesso turno,
// e la coda conta un messaggio solo.
//   apri(idFlusso, turno): chiude il turno prima e, se deveLeggere(turno), ne apre uno nuovo
//   segmento(): il flusso su cui scrivere adesso, o null se il turno non si legge o è stato fermato
//   chiudiSegmento(): il testo si interrompe (uno strumento); chiudi(): il turno è finito
export function guardiaTurno() {
  let guardia = null, segmento = null;
  const g = {
    apri(idFlusso, turno) {
      g.chiudi();
      if (deveLeggere(turno)) guardia = flusso(idFlusso);
    },
    segmento() {
      if (!guardia || guardia.turno.muto) return null;
      if (!segmento) segmento = flusso(guardia.turno.id);
      return segmento;
    },
    chiudiSegmento() { segmento?.fine(); segmento = null; },
    chiudi() {
      g.chiudiSegmento();
      guardia?.fine();
      guardia = null;
    },
  };
  return g;
}

// Dice un testo intero (la frase di prova, un annuncio): si spezza in frasi e si accoda come un messaggio a sé.
// subito: prima zittisce tutto (la frase di prova, «Voce attiva»).
export function dì(testo, { subito = false } = {}) {
  if (subito) ferma();
  const turno = { id: `d${++contaTurni}`, muto: false };
  const seg = nuovoSegmentatore();
  const emetti = (f) => accoda(f, turno);
  segmenta(seg, `${testo}\n`, emetti);
  svuota(seg, emetti);
}
export { dì as di };

// Una proposta urgente: si dice dalla scheda che ha la voce. Se questa non la possiede, la gira a quella che ce l'ha; la chiave
// evita che la dica due volte quando più schede ricevono lo stesso evento.
const dette = new Set();
function diUnaVolta(testo, chiave) {
  if (chiave) {
    if (dette.has(chiave)) return;
    dette.add(chiave);
    setTimeout(() => dette.delete(chiave), 60000);
  }
  dì(testo);
}
export function diUrgente(testo, chiave) {
  if (!voceOn) return;
  if (possiedo()) diUnaVolta(testo, chiave);
  else inoltraAlPossessore(testo, chiave);
}
suInoltrato((testo, chiave) => { if (voceOn) diUnaVolta(testo, chiave); });

// ---- controllo ---------------------------------------------------------------------------------------
function fermaElemento(el) {
  if (!el?.audio) return;
  el.audio.onerror = el.audio.onended = null;
  el.audio.pause();
  el.audio.src = "";
}

function chiudiRegistro() {
  const ora = Date.now();
  for (const r of registro) if (!r.fine) r.fine = ora;
}

// Ferma tutto: ciò che suona, la coda e il resto dei turni ancora in streaming (restano muti fino al prossimo flusso).
export function ferma() {
  for (const t of attivi) t.muto = true;
  attesaPensiero.annulla(true);
  chiudiRegistro();
  if ("speechSynthesis" in window) { speechSynthesis.cancel(); if (sospesa) speechSynthesis.resume(); }
  for (const el of coda) fermaElemento(el);
  coda.length = 0;
  fermaElemento(corrente);
  corrente = null;
  analizzatore = null;
  notifica();
}

// Salta il messaggio in corso (anche il resto che ancora arriva) e passa al prossimo in coda.
export function prossimo() {
  const id = corrente?.turno ?? coda[0]?.turno;
  if (id === undefined) return;
  for (const t of attivi) if (t.id === id) t.muto = true;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  fermaElemento(corrente);
  if (corrente?.reg && !corrente.reg.fine) corrente.reg.fine = Date.now();
  corrente = null;
  analizzatore = null;
  for (let i = coda.length - 1; i >= 0; i--) if (coda[i].turno === id) { fermaElemento(coda[i]); coda.splice(i, 1); }
  avanza();
  notifica();
}

// Microfono aperto: la voce aspetta (quella in corso va in pausa) e riparte alla chiusura.
export function sospendi(on) {
  on = !!on;
  if (on === sospesa) return;
  sospesa = on;
  if (on) {
    corrente?.audio?.pause();
    if ("speechSynthesis" in window && (speechSynthesis.speaking || speechSynthesis.pending)) speechSynthesis.pause();
  } else if (corrente) {
    if ("speechSynthesis" in window) speechSynthesis.resume();
    corrente.audio?.play().catch(() => finito(corrente));
  } else avanza();
  notifica();
}

export const voceAccesa = () => voceOn;
export function accendiVoce(on) {
  voceOn = !!on;
  memo.set("voce", voceOn ? "1" : "0");
  if (!voceOn) ferma();
  notifica();
}

// ---- la frase d'attesa -------------------------------------------------------------------------------
// Al massimo una per turno, solo se dopo ATTESA_PENSIERO_MS dall'inizio del ragionamento non c'è ancora testo né voce.
const att = { timer: 0, fatta: false, testo: false };
export const attesaPensiero = {
  nuovoTurno() { this.annulla(); att.fatta = false; att.testo = false; },
  testoArrivato() { att.testo = true; this.annulla(); },
  annulla(definitivo = false) { clearTimeout(att.timer); att.timer = 0; if (definitivo) att.fatta = true; },
  // turno: lo stesso { origine, urgente } di deveLeggere
  avvia(turno) {
    if (att.timer || att.fatta || att.testo || !voceOn || !possiedo() || !deveLeggere(turno)) return;
    att.timer = setTimeout(() => {
      att.timer = 0;
      if (att.fatta || att.testo || !voceOn || sospesa || stato().parlando || [...attivi].some((t) => t.haTesto)) return;
      att.fatta = true;
      dì(FRASI_ATTESA[Math.floor(Math.random() * FRASI_ATTESA.length)]);
    }, ATTESA_PENSIERO_MS);
  },
};

// ---- avvio ---------------------------------------------------------------------------------------------
avviaPossesso();
suPossesso((possiede) => { if (!possiede) ferma(); });
document.addEventListener("pointerdown", sbloccaVoce, { once: true });
caricaImpostazioni().catch(() => {});
addEventListener("focus", () => { caricaImpostazioni().catch(() => {}); });
