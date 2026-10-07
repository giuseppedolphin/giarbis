// L'ascolto: dettatura a mano, la frase di chiamata che accende il comando, il feedback del microfono (livello, pastiglia,
// esito) e cosa succede quando la scheda perde o riprende il possesso di microfono e voce. Il livello, il bip, il possesso e
// la coda della voce stanno in condivisi/ (microfono.js, voce-motore.js): qui c'è solo ciò che è del cockpit.
import { aggiornaInvia, inviaOrchestratore, inviaSessione } from "./chat.js";
import { $, S, assistente, autoAltezza, fermo, mostraBanner } from "./comune.js";
import { aggiornaOrb } from "./sonar.js";
import { costruisciChiamata, fraseChiamata } from "/condivisi/chiamata.js";
import { memo } from "/condivisi/memo.js";
import { apriLivello, avviaPossesso, bip, colpetto, livello, possiedo, prendi, suPossesso } from "/condivisi/microfono.js";
import { sintesiDice, sospendi } from "/condivisi/voce-motore.js";

// Soglie della voce, in ms: quiete dopo l'ultimo risultato prima di chiudere la dettatura (e inviare), la stessa quando
// l'ultimo risultato è già finale.
const SILENZIO_FINE_MS = 900, QUIETE_FINALE_MS = 500;
const Riconoscimento = window.SpeechRecognition || window.webkitSpeechRecognition;
// la frase di chiamata dell'assistente (prefisso + nome, varianti dalla config): si legge al momento, il nome arriva da /api/chi
const chiamata = () => costruisciChiamata(assistente);

// ---- il microfono è aperto? ------------------------------------------------------------------
// Regola generale: l'assistente non parla mentre registri. Il microfono è «aperto» con la dettatura a mano accesa o con un
// comando dopo la frase di chiamata in corso; l'ascolto a riposo della sola frase non conta. Aperto: la voce va in pausa e il
// livello si misura (sincronizzaVoce).
let ascolto = null; // il riconoscimento della dettatura a mano
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

// ---- dettatura a mano ------------------------------------------------------------------------
function avviaAscolto(inp, mic, invio) {
  if (!Riconoscimento) { mostraBanner("Questo browser non ha la dettatura: usa Chrome.", 5000); return; }
  if (ascolto) { ascolto.stop(); return; }
  if (!possiedo()) prendi();
  svPausa(); // la voce non si butta: va in pausa quando il microfono risulta aperto (sincronizzaVoce)
  const r = new Riconoscimento();
  r.lang = "it-IT"; r.interimResults = true; r.continuous = true;
  // Ascolto continuo: si chiude dopo SILENZIO_FINE_MS di silenzio (o con un altro clic); se l'ultimo risultato è già finale
  // basta QUIETE_FINALE_MS.
  let silenzio = setTimeout(() => r.stop(), 8000);
  const rimanda = (ms = SILENZIO_FINE_MS) => { clearTimeout(silenzio); silenzio = setTimeout(() => r.stop(), ms); };
  const base = $(inp).value ? `${$(inp).value.trim()} ` : "";
  let finale = "";
  r.onresult = (e) => {
    rimanda(e.results[e.results.length - 1].isFinal ? QUIETE_FINALE_MS : SILENZIO_FINE_MS);
    let provv = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finale += t; else provv += t;
    }
    $(inp).value = base + finale + provv;
    autoAltezza($(inp));
    aggiornaInvia();
    pastigliaTesto(finale + provv);
  };
  r.onerror = (e) => {
    if (e.error === "no-speech" || e.error === "aborted") return;
    mostraBanner(e.error === "not-allowed" ? "Il browser non ha il permesso del microfono." : `Dettatura: ${e.error}`, 5000);
  };
  r.onend = () => {
    clearTimeout(silenzio);
    ascolto = null;
    $(mic).setAttribute("aria-pressed", "false");
    aggiornaOrb();
    // prima l'invio (azzera la voce in sospeso), poi si riprende ciò che resta
    if (finale.trim() && possiedo()) pastigliaEsito(invio);
    else if (possiedo()) pastigliaEsito(null, true);
    sincronizzaVoce();
  };
  ascolto = r;
  $(mic).setAttribute("aria-pressed", "true");
  r.start();
  pastigliaInizia();
  aggiornaOrb();
  sincronizzaVoce();
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
  if (ascolto) { try { ascolto.abort(); } catch { /* già fermo */ } }
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
  $("mic-j").onclick = () => avviaAscolto("in-j", "mic-j", inviaOrchestratore);
  $("mic-s").onclick = () => avviaAscolto("in-s", "mic-s", inviaSessione);
  $("orb").onclick = () => avviaAscolto("in-j", "mic-j", inviaOrchestratore);
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.code === "Space") { e.preventDefault(); avviaAscolto("in-j", "mic-j", inviaOrchestratore); }
  });
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
