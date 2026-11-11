// Le sfere che si spostano a mano sulla mappa: si trascina una sfera per spostarla, lo sfondo per spostare la
// mappa (mappa.js, oltre 4 pixel è un trascinamento, sotto resta un clic). Al rilascio la posizione si salva sul server
// (rotte/posti.mjs: vale per ogni browser della persona) e vince sul layout automatico (raggiera.js, conPosti); «Riordina» le
// rimette tutte al loro posto, «Al suo posto» nella scheda della sfera solo quella. Senza la rotta (server non ancora riavviato)
// lo spostamento vale finché la pagina resta aperta.
import { $ } from "./comune.js";
import { chiavePosto } from "./raggiera.js";
import { api } from "/condivisi/api.js";
import { su } from "/condivisi/eventi.js";

export const POSTI = new Map(); // chiave stabile → { x, y } in punti della mappa
let D = null; // da mappa.js: { M, mondo, layout, inquadra }

const mostraRiordina = () => { const b = $("m-riordina"); if (b) b.hidden = !POSTI.size; };
export const aMano = (n) => POSTI.has(chiavePosto(n));
// la presa: dove sta il puntatore rispetto al centro della sfera, perché la sfera non salti sotto il dito
export function prendi(pan, x, y) { const m = D.mondo(x, y); pan.presa = { dx: pan.nodo.x - m.x, dy: pan.nodo.y - m.y }; }
export function muovi(pan, x, y) {
  const n = pan.nodo, m = D.mondo(x, y);
  D.M.trascina = n.k; D.M.sporca = true; // layout() non la rimette al suo posto mentre la si sposta
  n.x = n.tx = m.x + pan.presa.dx; n.y = n.ty = m.y + pan.presa.dy;
}
export function lascia(pan) {
  const n = pan.nodo, chiave = chiavePosto(n), p = { x: Math.round(n.tx), y: Math.round(n.ty) };
  D.M.trascina = null; POSTI.set(chiave, p); mostraRiordina();
  api("POST", "/api/posti", { chiave, ...p }).catch(() => {});
}
// senza nodo tutte: le sfere scorrono al posto che dà la raggiera
export function riordina(n) {
  if (n) POSTI.delete(chiavePosto(n)); else POSTI.clear();
  mostraRiordina(); D.layout();
  api("POST", "/api/posti/riordina", n ? { chiave: chiavePosto(n) } : {}).catch(() => {});
}
export function initPosti(d) {
  D = d;
  $("m-riordina").onclick = () => riordina();
  su("cockpit_rimossa", (ev) => { if (POSTI.delete(`s:${ev.id}`)) mostraRiordina(); }); // il server la pota alla prossima lettura
  api("GET", "/api/posti").then((r) => {
    for (const [k, p] of Object.entries(r.posti || {})) POSTI.set(k, p);
    mostraRiordina();
    if (!POSTI.size || !D.M.on) return;
    D.layout(); // all'apertura le sfere spostate stanno già al loro posto, senza scorrere
    for (const n of D.M.nodi.values()) if (aMano(n)) { n.x = n.tx; n.y = n.ty; }
    D.inquadra();
  }).catch(() => {});
}
