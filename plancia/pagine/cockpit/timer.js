// I timer delle sessioni sulla mappa: orologi legati alle sfere, scheda dei dettagli e «Togli dal registro».
import { $, COL, RIDOTTO, S, TEMA, mostraBanner, nomeVisibile, nomeSessione } from "./comune.js";
import { M, chiudiScheda, posizionaScheda, raggioDi, schermo } from "./mappa.js";
import { SA } from "./sottoagenti.js";
import { api } from "/condivisi/api.js";
import { su } from "/condivisi/eventi.js";
import { esc, tempoFa } from "/condivisi/formati.js";

// ---- i timer delle sessioni --------------------------------------------------------------
// I risvegli che l'assistente e gli agenti si programmano con CronCreate vivono dentro il loro processo; la sessione li dichiara
// al server (ctl.mjs timer …, registro in timer.json nella cartella di stato, plancia/server/timer.mjs). Sulla mappa ogni timer
// è un piccolo orologio a sé, legato con una linea
// tratteggiata alla sfera di chi l'ha creato (come i fogli): un arco si riempie verso il prossimo scatto e allo scatto c'è un impulso.
// Senza numeri; cosa controlla e fra quanto scatta stanno nel tooltip, e un clic apre i dettagli col pulsante per toglierlo.
const T = { lista: [], pos: new Map(), pulsi: new Map(), passati: new Set(), ultimaLettura: 0 };
const t_ms = (iso) => (iso ? Date.parse(iso) : NaN);
async function caricaTimer() { const j = await api("GET", "/api/timer"); T.lista = j.timer || []; T.ultimaLettura = Date.now(); rendiTimerTutti(); }
function riceviTimer(ev) {
  if (ev.type === "cockpit_timer" && ev.azione === "scattato" && ev.timer) T.pulsi.set(ev.timer.id, performance.now());
  caricaTimer().catch(() => {});
}
function fraQuanto(ms) {
  if (!Number.isFinite(ms)) return "";
  const m = Math.round(ms / 60000);
  if (ms <= 0) return "sta per scattare";
  if (m < 1) return "fra meno di un minuto";
  if (m < 60) return `fra ${m} ${m === 1 ? "minuto" : "minuti"}`;
  if (m < 36 * 60) { const h = Math.floor(m / 60), r = m % 60; return `fra ${h} ${h === 1 ? "ora" : "ore"}${r ? ` e ${r} min` : ""}`; }
  const g = Math.round(m / 1440); return `fra ${g} giorni`;
}
const dettaglioTimer = (tm) => (tm.sospeso
  ? "spento: il processo della sessione è ripartito e il suo risveglio non c'è più" : `scatta ${fraQuanto(t_ms(tm.prossimo) - Date.now())}`);
// dove sta un timer sulla mappa: attorno alla sfera della sua sessione, di lato rispetto al ramo che sale dal padre, più timer a ventaglio
function posTimer(n, i, t) {
  const p = schermo(n.x, n.y), r = raggioDi(n) * M.cam.z, zt = Math.max(0.75, Math.min(1.25, M.cam.z));
  const padre = n.padre && M.nodi.get(n.padre);
  const verso = padre ? Math.atan2(n.y - padre.y, n.x - padre.x) : 0;
  const lato = Math.sin(verso - Math.PI / 2) > 0.3 ? Math.PI / 2 : -Math.PI / 2;
  // di lato al ramo, dalla parte alta: sotto la sfera ci sono nome e attività
  const a = verso + lato + (i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.62 * (lato > 0 ? -1 : 1));
  const d = r + 58 * zt + Math.sin(t / 2300 + i * 1.7) * 3;
  return { x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, sfera: p, r, a };
}
function disegnaTimer(cx, t) {
  const adesso = Date.now(), per = new Map();
  for (const tm of T.lista) {
    const n = [...M.nodi.values()].find((v) => v.s && v.s.nome === tm.sessione);
    if (!n) continue;
    if (!per.has(n.k)) per.set(n.k, { n, l: [] });
    per.get(n.k).l.push(tm);
  }
  T.pos.clear(); let rilettura = false;
  const z = Math.max(0.8, Math.min(1.3, M.cam.z));
  for (const { n, l } of per.values()) l.forEach((tm, i) => {
    const q = posTimer(n, i, t), R = 10 * z, colore = tm.sospeso ? COL.ferma : COL[n.s.stato] || COL.ferma;
    T.pos.set(tm.id, { x: q.x, y: q.y, r: R, tm });
    const prossimo = t_ms(tm.prossimo);
    if (!tm.sospeso && prossimo <= adesso) {
      const k = tm.id + tm.prossimo;
      if (!T.passati.has(k)) {
        T.passati.add(k);
        T.pulsi.set(tm.id, t);
      } rilettura = true;
    }
    // la linea tratteggiata dalla sfera al timer, come quella dei fogli
    const du = Math.hypot(q.x - q.sfera.x, q.y - q.sfera.y) || 1;
    cx.beginPath(); cx.moveTo(
      q.sfera.x + (q.x - q.sfera.x) / du * q.r,
      q.sfera.y + (q.y - q.sfera.y) / du * q.r
    ); cx.lineTo(q.x - (q.x - q.sfera.x) / du * R, q.y - (q.y - q.sfera.y) / du * R);
    cx.strokeStyle = `rgba(${colore},${tm.sospeso ? 0.3 : 0.55})`; cx.lineWidth = 1; cx.setLineDash([4, 4]); cx.stroke(); cx.setLineDash([]);
    // il quadrante
    const evid = T.pulsi.get(tm.id) !== undefined ? t - T.pulsi.get(tm.id) : Infinity;
    cx.save();
    cx.beginPath(); cx.arc(q.x, q.y, R, 0, Math.PI * 2); cx.fillStyle = `rgba(${TEMA.fondo},.94)`; cx.fill();
    if (evid < 1800) { cx.shadowColor = `rgba(${colore},.9)`; cx.shadowBlur = 16 * (1 - evid / 1800) * z; }
    cx.lineWidth = 1.2 * z; cx.strokeStyle = `rgba(${colore},${tm.sospeso ? 0.35 : 0.22 + (evid < 1800 ? 0.5 * (1 - evid / 1800) : 0)})`;
    if (tm.sospeso) cx.setLineDash([2, 3]);
    cx.stroke(); cx.setLineDash([]); cx.lineCap = "round";
    let ang = -Math.PI / 2;
    if (!tm.sospeso) {
      const prec = Number.isFinite(t_ms(tm.prec)) ? t_ms(tm.prec) : t_ms(tm.creato);
      const f = Math.max(0, Math.min(1, (adesso - prec) / Math.max(1, prossimo - prec)));
      ang = -Math.PI / 2 + Math.PI * 2 * f;
      cx.shadowColor = `rgba(${colore},.6)`; cx.shadowBlur = 5 * z; cx.strokeStyle = `rgba(${colore},.9)`; cx.lineWidth = 1.8 * z;
      cx.beginPath(); cx.arc(q.x, q.y, R, -Math.PI / 2, Math.max(-Math.PI / 2 + 0.05, ang)); cx.stroke();
    }
    // lancetta (verso il prossimo scatto) e perno: un orologio, non un indicatore di caricamento
    cx.shadowBlur = 0; cx.lineWidth = 1.3 * z; cx.strokeStyle = `rgba(${colore},${tm.sospeso ? 0.4 : 0.85})`;
    cx.beginPath(); cx.moveTo(q.x, q.y); cx.lineTo(q.x + Math.cos(ang) * R * 0.55, q.y + Math.sin(ang) * R * 0.55); cx.stroke();
    cx.beginPath(); cx.arc(q.x, q.y, 1.4 * z, 0, Math.PI * 2); cx.fillStyle = `rgba(${colore},.9)`; cx.fill();
    cx.restore();
    // l'impulso allo scatto: un anello che si allarga (a movimento ridotto resta solo il bagliore)
    if (evid < 1800 && !RIDOTTO.matches) {
      const u = evid / 1800;
      cx.beginPath();
      cx.arc(q.x, q.y, R + u * 24 * z, 0, Math.PI * 2);
      cx.strokeStyle = `rgba(${colore},${(1 - u) * 0.65})`;
      cx.lineWidth = 1.6;
      cx.stroke();
    }
    if (M.selTimer === tm.id) {
      cx.beginPath();
      cx.arc(q.x, q.y, R + 4, 0, Math.PI * 2);
      cx.strokeStyle = `rgb(${TEMA.testo})`;
      cx.lineWidth = 1.2;
      cx.stroke();
    }
  });
  for (const id of [...T.pulsi.keys()]) if (!T.lista.some((x) => x.id === id) || t - T.pulsi.get(id) > 2000) T.pulsi.delete(id);
  if (T.passati.size > 200) T.passati.clear();
  if (rilettura && Date.now() - T.ultimaLettura > 4000) {
    T.ultimaLettura = Date.now();
    caricaTimer().catch(() => {});
  } // un timer è scattato: il server ha già rimesso in pari il prossimo
}
function timerA(x, y) {
  for (const v of [...T.pos.values()].reverse()) if (Math.hypot(v.x - x, v.y - y) <= v.r + 6) return v.tm;
  return null;
}
// la lista dei timer di una sessione (scheda sulla mappa e pannello della sessione), ognuno col suo «Togli»
function htmlTimerSessione(sessione) {
  return T.lista.filter((x) => x.sessione === sessione).map((tm) => `<div class="tm-riga">`
    + `<span class="tm-d" title="${esc(tm.descrizione)}">⏲ ${esc(tm.descrizione)}</span><span class="tm-q">${esc(dettaglioTimer(tm))}</span>`
    + `<button data-tm="${esc(tm.id)}" title="Toglie il timer dal registro del cockpit">Togli</button></div>`).join("");
}
function colegaTogliTimer(el) { el.querySelectorAll("button[data-tm]").forEach((b) => b.onclick = () => togliTimer(b.dataset.tm)); }
async function togliTimer(id) {
  try {
    await api("DELETE", `/api/timer/${encodeURIComponent(id)}`);
    if (M.selTimer === id) chiudiScheda();
    await caricaTimer();
  } catch (e) {
    mostraBanner(e.message, 5000);
  }
}
function rendiTimerPannello() {
  const s = S.aperta && S.sessioni.get(S.aperta), el = $("p-timer"), h = s ? htmlTimerSessione(s.nome) : "";
  el.hidden = !h;
  if (h) { el.innerHTML = `<div class="tm-titolo">Timer di ${esc(nomeSessione(s))}</div>${h}`; colegaTogliTimer(el); }
}
function rendiTimerTutti() {
  rendiTimerPannello();
  const blocco = $("sn-timer");
  if (blocco && M.sel) {
    const n = M.nodi.get(M.sel), h = n?.s ? htmlTimerSessione(n.s.nome) : "";
    blocco.hidden = !h;
    blocco.innerHTML = h;
    colegaTogliTimer(blocco);
  }
  if (M.selTimer) { if (T.lista.some((x) => x.id === M.selTimer)) apriSchedaTimer(M.selTimer, true); else chiudiScheda(); }
}
function apriSchedaTimer(id, aggiorna) {
  const tm = T.lista.find((x) => x.id === id); if (!tm) return;
  M.sel = null; M.selTimer = id; SA.sel = null; const el = $("scheda-nodo");
  const n = [...M.nodi.values()].find((v) => v.s && v.s.nome === tm.sessione), colore = tm.sospeso ? COL.ferma : (n && COL[n.s.stato]) || COL.ferma;
  const nome = nomeVisibile(tm.sessione); // le sessioni dell'assistente si chiamano col suo nome, anche con i timer di prima
  const prossimo = t_ms(tm.prossimo);
  const quando = new Date(prossimo).toLocaleString("it-IT", { weekday: "short", hour: "2-digit", minute: "2-digit" });
  const stato = tm.sospeso ? "spento" : tm.unaVolta ? "una volta" : "ricorrente";
  const nota = "Il processo di questa sessione è ripartito e i job di CronCreate non sopravvivono: la sessione deve ricrearlo, oppure toglilo da qui.";
  el.innerHTML = `<div class="sn-testa"><span style="width:9px;height:9px;border-radius:50%;border:1.5px solid rgb(${colore.join(",")})"></span>`
    + `<b>Timer di ${esc(nome)}</b><span class="meta">${stato}</span><button class="x" id="sn-x" title="Chiudi">✕</button></div>`
    + `<div class="sn-corpo"><div style="font-size:14px">${esc(tm.descrizione)}</div>`
    + `<dl class="tm-det"><dt>Prossimo scatto</dt><dd>${tm.sospeso ? "—" : `${esc(fraQuanto(prossimo - Date.now()))} · ${esc(quando)}`}</dd>`
    + `<dt>Ultimo scatto</dt><dd>${tm.ultimo ? esc(tempoFa(tm.ultimo)) : "ancora nessuno"}</dd>`
    + `<dt>Ricorrenza</dt><dd><code>${esc(tm.ricorrenza)}</code></dd>`
    + `<dt>Creato</dt><dd>${esc(tempoFa(tm.creato))}</dd></dl>`
    + `${tm.sospeso ? `<div class="tm-nota">${nota}</div>` : ""}`
    + '<div class="tm-nota">«Togli» cancella solo la voce del cockpit: il risveglio vero lo ferma la sessione con CronDelete.</div></div>'
    + '<div class="sn-piede"><button class="tm-togli" id="tm-togli">Togli dal registro</button></div>';
  el.hidden = false; $("sn-x").onclick = chiudiScheda; $("tm-togli").onclick = () => togliTimer(tm.id);
  if (!aggiorna) posizionaScheda();
}
function initTimer() {
  su("cockpit_timer", riceviTimer);
  su("_aperto", () => caricaTimer().catch(() => {})); // i timer registrati dalle sessioni prima del ricarico
}
export { T, apriSchedaTimer, caricaTimer, dettaglioTimer, disegnaTimer, initTimer, rendiTimerPannello, rendiTimerTutti, timerA };
