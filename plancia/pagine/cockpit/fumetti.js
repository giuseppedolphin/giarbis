// I fumetti di fine turno sulla mappa: quando un agente (o un agente di foglio, mai l'assistente) chiude un turno, accanto alla
// sua sfera compare un fumetto con l'anteprima di cosa ha detto, ripulita dal markdown, senza chiamare nessun modello. Sostituisce
// il pallino dei non letti e l'anteprima sotto la sfera. Resta finché la chat non si apre (nonLetti torna a zero) o finché non lo
// si chiude con la x (vale per quel turno: memo fumetto.<id> = turni). Clic = apre la chat (per un agente di foglio, foglio e
// chat affiancati). Se l'ultima frase è una domanda porta il segno «ti chiede»; un turno finito male porta «errore».
// Un fumetto in più, accanto all'assistente: la proposta nuova del battito (proposte.js), finché non la si guarda; clic = apre
// il foglio delle proposte. Si piazza accanto alla sfera nel primo posto libero: non copre fogli, comandi della mappa, scheda
// aperta, etichette, il pulsante della voce né altri fumetti.
import { $, S, assistente } from "./comune.js";
import { apri } from "./chat.js";
import { C } from "./fogli.js";
import { apriAgenteFoglio } from "./agenti-foglio.js";
import { M, raggioDi, schermo } from "./mappa.js";
import { apriProposte, propostaDaSegnalare, segnaVista } from "./proposte.js";
import { su } from "/condivisi/eventi.js";
import { esc } from "/condivisi/formati.js";
import { memo } from "/condivisi/memo.js";

const F = { testo: new Map(), el: new Map() }; // testo: l'ultima risposta vista passare nello stream, per sessione
const chiave = (s) => `fumetto.${s.id}`;
const HTML_FUMETTO = '<span class="fu-segno"></span><span class="fu-t"></span>'
  + '<button class="fu-x" type="button" aria-label="Chiudi il fumetto" title="Chiudi">✕</button>';
const MAX = 140;

// markdown → una frase pulita: niente blocchi di codice, tabelle, titoli, backtick, enfasi, link, elenchi
function pulisci(md) {
  const righe = String(md || "").replace(/```[\s\S]*?(```|$)/g, " ").split("\n")
    .filter((r) => !/^\s*(#{1,6}\s|\||[-:| ]{3,}$|>?\s*$)/.test(r))
    .map((r) => r.replace(/^\s*(>\s*)?([-*+]|\d+[.)])\s+/, ""));
  return righe.join(" ").replace(/`([^`]*)`/g, "$1").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/(\*\*|__|\*|_|~~)(\S[\s\S]*?\S|\S)\1/g, "$2")
    .replace(/[`*#|]/g, "").replace(/\s+/g, " ").trim();
}
function anteprima(testo) {
  const t = pulisci(testo); if (!t) return "";
  const frase = t.match(/^[\s\S]{12,}?[.!?…](?=\s|$)/)?.[0];
  if (frase && frase.length <= MAX) return frase;
  const corto = t.slice(0, MAX); return t.length > MAX ? corto.replace(/\s+\S*$/, "") + "…" : corto;
}
const domanda = (testo) => /\?\s*$/.test(pulisci(testo).split(/(?<=[.!?])\s+/).filter(Boolean).pop() || "");

// visibile: agente o agente di foglio, turno chiuso con qualcosa da leggere, chat non aperta, non chiuso con la x per questo turno
function fumettoVisibile(s) {
  return !!s && (s.ruolo === "agente" || s.ruolo === "foglio") && s.nonLetti > 0 && S.aperta !== s.id
    && s.stato !== "lavora" && s.stato !== "avvio" && memo.get(chiave(s), "") !== String(s.turni);
}

// dallo stream (ogni evento): l'ultima risposta di ogni sessione, intera, per anteprima e domanda
function notaFumetto(ev) {
  if (ev.type === "assistant" && !ev.parent) {
    const t = (ev.blocchi || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (t) F.testo.set(ev.id, t);
  }
}

function crea(s) {
  const el = document.createElement("div"); el.className = "fumetto"; el.dataset.id = s.id; el.setAttribute("role", "button"); el.tabIndex = 0;
  el.innerHTML = HTML_FUMETTO;
  el.addEventListener("click", (e) => {
    const s2 = S.sessioni.get(s.id); if (!s2) return;
    if (e.target.closest(".fu-x")) { memo.set(chiave(s2), String(s2.turni)); aggiornaFumetti(); return; }
    if (s2.ruolo === "foglio" && C.el.has(s2.foglio)) apriAgenteFoglio(s2.foglio); else apri(s2.id);
  });
  el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.click(); } });
  $("fumetti").appendChild(el); F.el.set(s.id, el);
  return el;
}

// il contenuto: quando cambia lo stato delle sessioni (chat.js lo chiama dopo ogni cockpit_sessione e all'apertura di una chat)
function aggiornaFumetti() {
  if (!$("fumetti")) return;
  const vivi = new Set();
  for (const s of S.sessioni.values()) {
    if (!fumettoVisibile(s)) continue;
    vivi.add(s.id);
    const el = F.el.get(s.id) || crea(s);
    const testo = F.testo.get(s.id) || s.ultimo || "";
    const errore = s.stato === "errore", chiede = !errore && domanda(testo);
    el.classList.toggle("chiede", chiede); el.classList.toggle("errore", errore); el.classList.toggle("di-foglio", s.ruolo === "foglio");
    el.querySelector(".fu-segno").textContent = errore ? "errore" : chiede ? "ti chiede" : "";
    el.querySelector(".fu-t").textContent = anteprima(testo) || "Ha finito il turno.";
    el.title = `${s.nome}: apri la chat`;
    el.setAttribute("aria-label", `${s.nome}${chiede ? ", ti chiede" : errore ? ", errore" : ""}: ${el.querySelector(".fu-t").textContent}`);
  }
  const p = propostaDaSegnalare();
  if (p) {
    vivi.add("proposta");
    let el = F.el.get("proposta");
    if (!el) {
      el = document.createElement("div");
      el.className = "fumetto proposta";
      el.dataset.id = "proposta";
      el.setAttribute("role", "button");
      el.tabIndex = 0;
      el.innerHTML = HTML_FUMETTO;
      el.addEventListener("click", (e) => { if (e.target.closest(".fu-x")) segnaVista(); else apriProposte(); });
      el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.click(); } });
      $("fumetti").appendChild(el); F.el.set("proposta", el);
    }
    el.classList.toggle("errore", !!p.urgente);
    const propone = `${assistente.nome} propone`;
    el.querySelector(".fu-segno").textContent = p.urgente ? `urgente · ${propone}` : propone;
    el.querySelector(".fu-t").textContent = anteprima(p.testo);
    el.title = `Apri «${propone}»`;
    el.setAttribute("aria-label", `${propone}: ${p.testo}`);
  }
  for (const [id, el] of F.el) if (!vivi.has(id)) { el.remove(); F.el.delete(id); }
}

// il posto: ogni fotogramma della mappa, il primo libero fra destra, sinistra, sopra e sotto la sfera
const sovrappone = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
function ostacoli(base) {
  const r = [];
  const rel = (el) => { if (!el || el.hidden || !el.offsetParent) return; const q = el.getBoundingClientRect(); r.push({
    x: q.left - base.left - 6,
    y: q.top - base.top - 6,
    w: q.width + 12,
    h: q.height + 12
  }); };
  for (const el of C.el.values()) rel(el);
  rel($("scheda-nodo")); rel(document.querySelector(".mappa-com")); rel($("elenco-fogli")); rel(document.querySelector(".mappa-legenda"));
  rel($("voce-comando")); // il pulsante della voce, quando parla
  for (const n of M.nodi.values()) { // la sfera e la sua etichetta
    const p = schermo(n.x, n.y), rr = raggioDi(n) * M.cam.z;
    r.push({ x: p.x - rr - 16, y: p.y - rr - 16, w: 2 * rr + 32, h: 2 * rr + 32 }, // con l'anello e il cerchiolino del contesto
       { x: p.x - 105, y: p.y + rr + 4, w: 210, h: 52 });
  }
  return r;
}
function posizionaFumetti() {
  requestAnimationFrame(posizionaFumetti);
  const box = $("fumetti"); if (!box || !M.on || !F.el.size) return;
  const base = box.getBoundingClientRect(), occupati = ostacoli(base);
  for (const [id, el] of F.el) {
    const n = id === "proposta" ? [...M.nodi.values()].find((v) => v.s?.ruolo === "orchestratore") : M.nodi.get("a:" + id);
    if (!n) {
      el.hidden = true;
      continue;
    }
    el.hidden = false;
    const p = schermo(n.x, n.y), r = raggioDi(n) * M.cam.z, w = el.offsetWidth, h = el.offsetHeight, g = 12;
    // dal più vicino al più lontano: accanto (a destra, poi a sinistra) a distanze crescenti e un po' più su o più giù, poi sopra e sotto l'etichetta
    const posti = [];
    for (const dx of [g, g + 36, g + 90]) for (const dy of [0, -h / 2 - 8, h / 2 + 8, -h - 16, h + 16, -1.6 * h - 24, 1.6 * h + 24])
      posti.push({ x: p.x + r + dx, y: p.y - h / 2 + dy, lato: "d" }, { x: p.x - r - dx - w, y: p.y - h / 2 + dy, lato: "s" });
    for (const dy of [0, 40, 90]) posti.push({ x: p.x - w / 2, y: p.y - r - g - h - dy, lato: "su" }, { x: p.x - w / 2, y: p.y + r + 60 + dy, lato: "giu" });
    const libero = posti.find((q) => q.x >= 4 && q.y >= 4 && q.x + w <= base.width - 4 && q.y + h <= base.height - 4 && !occupati.some((o) => sovrappone(
      { ...q, w, h },
      o
    )));
    if (!libero) { el.hidden = true; continue; } // nessun posto libero: meglio non coprire niente (resta la chat da aprire)
    const pos = { x: Math.round(libero.x), y: Math.round(libero.y) };
    if (el._x !== pos.x || el._y !== pos.y) { el.style.transform = `translate(${pos.x}px, ${pos.y}px)`; el._x = pos.x; el._y = pos.y; }
    if (el.dataset.lato !== libero.lato) el.dataset.lato = libero.lato;
    const coda = Math.round(Math.max(8, Math.min(h - 16, p.y - pos.y - 4))); // la punta guarda l'altezza della sfera
    if (el._coda !== coda) { el.style.setProperty("--coda", coda + "px"); el._coda = coda; }
    occupati.push({ x: pos.x - 6, y: pos.y - 6, w: w + 12, h: h + 12 });
  }
}

function initFumetti() {
  su("*", notaFumetto); // l'ultima risposta di ogni agente, per il fumetto di fine turno
  const box = document.createElement("div"); box.className = "fumetti"; box.id = "fumetti";
  document.querySelector(".mappa").appendChild(box);
  aggiornaFumetti();
  requestAnimationFrame(posizionaFumetti);
}

export { aggiornaFumetti, anteprima, fumettoVisibile, initFumetti, notaFumetto, pulisci };
