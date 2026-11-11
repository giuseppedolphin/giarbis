// L'ascolto: dettatura a mano (invio solo col pulsante), la frase di chiamata che accende il comando, il feedback del microfono
// (livello, pastiglia, esito) e cosa succede quando la scheda perde o riprende il possesso di microfono e voce. Il livello, il
// bip, il possesso e la coda della voce stanno in condivisi/ (microfono.js, voce-motore.js): qui c'è solo ciò che è del cockpit.
import { aggiornaInvia, inviaOrchestratore } from "./chat.js";
import { $, S, assistente, autoAltezza, fermo, mostraBanner } from "./comune.js";
import { aggiornaOrb } from "./sonar.js";
import { costruisciChiamata, fraseChiamata } from "/condivisi/chiamata.js";
import { memo } from "/condivisi/memo.js";
import { apriLivello, avviaPossesso, bip, colpetto, livello, possiedo, prendi, suPossesso } from "/condivisi/microfono.js";
import { sintesiDice, sospendi } from "/condivisi/voce-motore.js";

// Soglie della dettatura a mano, in ms: silenzio dopo cui si mette in pausa da sola (senza inviare), attesa delle ultime
// parole quando la chiudi, sotto quanto una ripartenza del riconoscimento conta come «lampo» (tre di fila = microfono guasto).
const INATTIVO_MS = 180000, CHIUSURA_MS = 1500, LAMPO_MS = 1000;
const Riconoscimento = window.SpeechRecognition || window.webkitSpeechRecognition;
// la frase di chiamata dell'assistente (prefisso + nome, varianti dalla config): si legge al momento, il nome arriva da /api/chi
const chiamata = () => costruisciChiamata(assistente);

// ---- il microfono è aperto? ------------------------------------------------------------------
// Regola generale: l'assistente non parla mentre registri. Il microfono è «aperto» con la dettatura a mano accesa o con un
// comando dopo la frase di chiamata in corso; l'ascolto a riposo della sola frase non conta. Aperto: la voce va in pausa e il
// livello si misura (sincronizzaVoce).
let ascolto = null; // la dettatura a mano in corso: { inp, mic, rec, base, finale, provv, chiusa, attese, … }
const sv = { on: memo.get("sveglia", "0") === "1", rec: null, attivo: false, comando: null, timer: 0 };
const micAperto = () => !!ascolto || !!sv.comando;
let micEraAperto = false;
function sincronizzaVoce() {
  const ora = micAperto();
  if (ora === micEraAperto) return;
  micEraAperto = ora;
  apriLivello(ora);
  sospendi(ora);
}

// ---- feedback del microfono: livello, trascrizione parziale, esito --------------------------------
// Lo leggono sonar, mappa e pastiglia: un valore (0..1) per fotogramma, calcolato una volta sola da tickMic (sonar.js).
let liv = 0;
const livelloMic = () => liv;
function tickMic() {
  liv = livello();
  const pill = $("voce-pill");
  if (!pill.hidden) pill.style.setProperty("--liv", fermo ? 0 : liv.toFixed(3));
}
let nascondiPill = 0;
function pastiglia(stato, testo, vuoto, ms) {
  const p = $("voce-pill");
  clearTimeout(nascondiPill);
  p.dataset.s = stato;
  p.hidden = false;
  $("vp-t").textContent = testo;
  $("vp-t").classList.toggle("vuoto", !!vuoto);
  if (ms) nascondiPill = setTimeout(() => { p.hidden = true; }, ms);
}
const pastigliaInizia = () => pastiglia("ascolto", "Ti ascolto…", true);
function pastigliaTesto(t) {
  colpetto();
  t = (t || "").trim();
  if (t) pastiglia("ascolto", t.length > 90 ? `…${t.slice(-88)}` : t, false);
}
async function pastigliaEsito(invio, vuoto) {
  if (vuoto) { pastiglia("err", "Non ho sentito niente.", false, 3000); return; }
  pastiglia("ascolto", "Invio…", true);
  let ok = false;
  try { ok = await invio(); } catch { /* resta ok = false */ }
  if (ok) pastiglia("ok", "Messaggio inviato", false, 1800);
  else pastiglia("err", "Non sono riuscito a inviarlo", false, 5000);
}

// ---- dettatura a mano: registri finché vuoi, mandi tu --------------------------------------------
// Le pause non inviano niente: il testo cresce nel campo e, quando il browser chiude il riconoscimento
// per conto suo (silenzio lungo, rete), si riparte da solo tenendo quello che c'è. Un altro clic sul microfono (o sulla sfera,
// Ctrl+Spazio, Esc) la mette in pausa e il testo resta da rileggere; scrivere nel campo la ferma senza toccare ciò che scrivi;
// dopo INATTIVO_MS senza parole si ferma da sola. Invia (pulsante o Invio) passa da finisciDettatura: chiude il riconoscimento,
// aspetta le ultime parole (al massimo CHIUSURA_MS) e solo dopo manda.
function scriviDettato(d) {
  $(d.inp).value = d.base + d.finale + d.provv;
  autoAltezza($(d.inp));
  aggiornaInvia();
  pastigliaTesto($(d.inp).value);
}
function rimandaInattivo(d) {
  clearTimeout(d.inattivo);
  d.inattivo = setTimeout(() => fermaDettatura("inattivo"), INATTIVO_MS);
}

function avviaAscolto(inp, mic) {
  if (!Riconoscimento) { mostraBanner("Questo browser non ha la dettatura: usa Chrome.", 5000); return; }
  if (ascolto) { fermaDettatura("pausa"); return; }
  if (!possiedo()) prendi();
  svPausa(); // la voce non si butta: va in pausa quando il microfono risulta aperto (sincronizzaVoce)
  const d = ascolto = { inp, mic, rec: null, base: "", finale: "", provv: "", chiusa: "", ignora: false, attese: [], sentito: false, lampi: 0, inattivo: 0 };
  $(mic).setAttribute("aria-pressed", "true");
  pastiglia("ascolto", "Ti ascolto. Le pause non inviano: premi Invia quando hai finito.", true);
  if (matchMedia("(hover: hover)").matches) $(inp).focus(); // così Invio manda; su touch niente tastiera che salta su
  rimandaInattivo(d);
  avviaRiconoscimento(d);
  aggiornaOrb();
  sincronizzaVoce();
}

// Un riconoscimento (il browser ne chiude uno dopo un silenzio lungo): riparte dal testo che c'è nel campo.
function avviaRiconoscimento(d) {
  const v = $(d.inp).value.trim();
  d.base = v ? `${v} ` : "";
  d.finale = d.provv = "";
  d.avviato = Date.now();
  const riprova = (ms) => setTimeout(() => { if (ascolto === d && !d.chiusa && !d.rec) avviaRiconoscimento(d); }, ms);
  const r = new Riconoscimento();
  r.lang = "it-IT"; r.interimResults = true; r.continuous = true;
  r.onresult = (e) => {
    if (d.ignora || d.rec !== r) return;
    d.sentito = true; d.lampi = 0;
    if (!d.chiusa) rimandaInattivo(d);
    let provv = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) d.finale += t; else provv += t;
    }
    d.provv = provv;
    scriviDettato(d);
  };
  r.onerror = (e) => {
    if (e.error === "no-speech" || e.error === "aborted") return; // il silenzio non è un errore: si riparte
    d.errore = e.error;
    mostraBanner(e.error === "not-allowed" ? "Il browser non ha il permesso del microfono."
      : e.error === "audio-capture" ? "Nessun microfono disponibile." : `Dettatura: ${e.error}`, 5000);
  };
  r.onend = () => {
    if (d.rec !== r) return;
    d.rec = null;
    d.lampi = Date.now() - d.avviato < LAMPO_MS ? d.lampi + 1 : 0;
    if (d.lampi >= 3) { d.errore = "lampi"; mostraBanner("La dettatura si chiude da sola: controlla il microfono.", 5000); }
    if (ascolto === d && !d.chiusa && !d.errore && possiedo()) { riprova(150); return; }
    chiudiDettatura(d);
  };
  d.rec = r;
  try { r.start(); } catch { // un altro riconoscimento non ha ancora mollato il microfono: si riprova fra poco
    d.rec = null;
    if (++d.lampi >= 3) { mostraBanner("Il microfono è occupato: riprova.", 5000); chiudiDettatura(d); return; }
    riprova(300);
  }
}

// Ferma la dettatura: «pausa», «inattivo» e «invio» aspettano le ultime parole (stop), «scritto» e «possesso» no (abort).
function fermaDettatura(motivo) {
  const d = ascolto;
  if (!d) return;
  d.chiusa = motivo;
  clearTimeout(d.inattivo);
  const r = d.rec;
  if (!r) { chiudiDettatura(d); return; }
  const subito = motivo === "scritto" || motivo === "possesso";
  if (subito) d.ignora = true;
  try { if (subito) r.abort(); else r.stop(); } catch { d.rec = null; chiudiDettatura(d); return; }
  // rete di sicurezza: se il browser non chiude, si chiude qui con ciò che è già nel campo
  setTimeout(() => {
    if (ascolto !== d || d.rec !== r) return;
    d.ignora = true; d.rec = null;
    try { r.abort(); } catch { /* già fermo */ }
    chiudiDettatura(d);
  }, CHIUSURA_MS);
}

function chiudiDettatura(d) {
  if (ascolto !== d) return;
  clearTimeout(d.inattivo);
  ascolto = null;
  $(d.mic).setAttribute("aria-pressed", "false");
  aggiornaOrb();
  sincronizzaVoce();
  const attese = d.attese.splice(0);
  if (attese.length) { $("voce-pill").hidden = true; attese.forEach((f) => f()); return; } // l'invio lo racconta la chat
  if (!possiedo() || d.chiusa === "scritto") { $("voce-pill").hidden = true; return; }
  if (!d.sentito && !$(d.inp).value.trim()) pastiglia("err", "Non ho sentito niente.", false, 3000);
  else if (d.chiusa === "inattivo") pastiglia("ok", "Dettatura in pausa dopo 3 minuti di silenzio: non ho inviato niente.", false, 6000);
  else pastiglia("ok", "Dettatura in pausa: rileggi e premi Invia.", false, 3500);
}

// Prima di mandare il campo `inp` (chat.js): una dettatura in corso lì si chiude e le sue ultime parole entrano nel testo.
function finisciDettatura(inp) {
  const d = ascolto;
  if (!d || d.inp !== inp) return Promise.resolve();
  return new Promise((fatto) => { d.attese.push(fatto); if (!d.chiusa) fermaDettatura("invio"); });
}

// ---- la frase di chiamata anche qui: accende l'ascolto, il silenzio manda ---------------------------
// L'ascolto resta attivo anche mentre l'assistente parla, così la frase lo interrompe (ferma la voce, bip) e parte il comando.
// Si scarta la frase se è la sintesi a pronunciarla (registro delle frasi del motore). Si ferma solo con la dettatura a mano o
// senza il possesso della voce. Limite noto: senza cuffie il microfono sente anche l'eco della sintesi; il filtro sul testo
// copre solo la frase di chiamata detta dalla sintesi, non altre parole scambiate per essa.
const svPuo = () => sv.on && possiedo() && !ascolto;
function svAvvia() {
  if (!Riconoscimento || sv.attivo || !svPuo()) return;
  const r = new Riconoscimento();
  r.lang = "it-IT"; r.interimResults = true; r.continuous = true;
  const scartati = new Set(); // risultati (per indice, validi in questa sessione di riconoscimento) dove la frase era della sintesi
  r.onresult = (e) => {
    if (!sv.comando) {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (scartati.has(i) || !chiamata().test(e.results[i][0].transcript)) continue;
        if (sintesiDice(chiamata())) { scartati.add(i); continue; }
        sv.comando = { base: i };
        sincronizzaVoce(); bip(); pastigliaInizia(); svRimanda(6000); aggiornaOrb();
        break;
      }
    }
    if (!sv.comando) return;
    const parti = [];
    for (let i = sv.comando.base; i < e.results.length; i++) {
      let x = e.results[i][0].transcript;
      if (i === sv.comando.base) { const m = x.match(chiamata()); if (m) x = x.slice(m.index + m[0].length); }
      parti.push(x);
    }
    $("in-j").value = parti.join(" ").replace(/\s+/g, " ").trim();
    autoAltezza($("in-j"));
    aggiornaInvia();
    if ($("in-j").value) { pastigliaTesto($("in-j").value); svRimanda(1600); }
  };
  r.onerror = (e) => {
    if (e.error !== "not-allowed") return;
    sv.on = false;
    memo.set("sveglia", "0");
    $("sveglia").setAttribute("aria-pressed", "false");
    mostraBanner("Il browser non ha il permesso del microfono.", 5000);
  };
  r.onend = () => { sv.attivo = false; sv.rec = null; if (svPuo()) setTimeout(svAvvia, 250); };
  try { r.start(); sv.rec = r; sv.attivo = true; } catch { sv.attivo = false; }
}
function svRimanda(ms) {
  clearTimeout(sv.timer);
  sv.timer = setTimeout(svChiudi, ms);
}
function svChiudi() {
  clearTimeout(sv.timer);
  const c = sv.comando;
  sv.comando = null;
  if (sv.rec) { try { sv.rec.abort(); } catch { /* già fermo */ } }
  aggiornaOrb();
  if (c && $("in-j").value.trim()) pastigliaEsito(inviaOrchestratore);
  else if (c) pastigliaEsito(null, true);
  sincronizzaVoce();
}
function svPausa() { if (sv.rec && !sv.comando) { try { sv.rec.abort(); } catch { /* già fermo */ } } }

// ---- una scheda sola ha la voce -------------------------------------------------------------
// Con più schede aperte lo stesso stream arriva a tutte: microfono, frase di chiamata, sintesi e invio da dettatura stanno
// solo nella scheda che ha il possesso (condivisi/microfono.js, canale «plancia-voce»); le altre leggono e scrivono come prima.
// Il possesso passa a chi torna in primo piano o a chi lo prende con un clic.
function alCambioPossesso(possiede) {
  if (possiede) {
    if (sv.on) setTimeout(svAvvia, 300);
    aggiornaOrb();
    return;
  }
  fermaDettatura("possesso"); // il testo dettato resta nel campo
  clearTimeout(sv.timer);
  sv.comando = null;
  $("voce-pill").hidden = true;
  if (sv.rec) { try { sv.rec.abort(); } catch { /* già fermo */ } }
  sincronizzaVoce();
  $("mic-j").setAttribute("aria-pressed", "false");
  $("mic-s").setAttribute("aria-pressed", "false");
  aggiornaOrb();
}

function initDettatura() {
  S.primaDiInviare = finisciDettatura;
  $("mic-j").onclick = () => avviaAscolto("in-j", "mic-j");
  $("mic-s").onclick = () => avviaAscolto("in-s", "mic-s");
  $("orb").onclick = () => avviaAscolto("in-j", "mic-j");
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.code === "Space") { e.preventDefault(); avviaAscolto("in-j", "mic-j"); }
  });
  // Esc mette in pausa la dettatura prima di ogni altro uso di Esc (chiudere il pannello, fermare la voce)
  addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !ascolto) return;
    e.preventDefault(); e.stopImmediatePropagation();
    fermaDettatura("pausa");
  }, true);
  // scrivere a mano nel campo che si sta dettando ferma la dettatura: le tue correzioni non vengono riscritte
  for (const id of ["in-j", "in-s"]) {
    $(id).addEventListener("input", (e) => { if (ascolto?.inp === id && e.isTrusted) fermaDettatura("scritto"); });
  }
}

function initSveglia() {
  $("sveglia").setAttribute("aria-pressed", sv.on);
  $("sveglia").onclick = () => {
    sv.on = !sv.on;
    memo.set("sveglia", sv.on ? "1" : "0");
    $("sveglia").setAttribute("aria-pressed", sv.on);
    if (sv.on) { svAvvia(); mostraBanner(`Di' «${fraseChiamata(assistente)}» e poi quello che vuoi: mando quando smetti di parlare.`, 4000); } else svPausa();
  };
  // mentre la dettatura a mano è accesa (o senza possesso della voce) la frase non si ascolta; altrimenti si riavvia da sola dopo onend
  setInterval(() => {
    if (sv.on && !sv.attivo && svPuo()) svAvvia();
    else if (sv.attivo && !sv.comando && !svPuo()) svPausa();
  }, 700);
  if (sv.on) svAvvia();
}

function initPossesso() {
  suPossesso(alCambioPossesso);
  avviaPossesso({ avviso: true });
  setInterval(sincronizzaVoce, 250); // rete di sicurezza: le transizioni la chiamano già da sole
}
export { ascolto, initDettatura, initPossesso, initSveglia, livelloMic, sv, tickMic };
