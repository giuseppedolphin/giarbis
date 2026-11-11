// I colori dei ruoli della squadra lato pagina: li calcola il server (server/colori.mjs, dal file dei ruoli) e li espone su
// GET /api/squadra/colori, un colore per tema. Uno stato per pagina, caricato una volta; server vecchio senza la rotta:
// nessun colore (come oggi) e si riprova dopo un minuto. Gli agenti fuori dalla squadra, l'assistente e la persona non hanno
// un colore qui: tengono quelli di sempre. Accanto al colore viaggia `volto`, il tipo di faccia del ruolo (cockpit/volti.js).
//
// Nell'html: un elemento con class="pl-ag" e style="${stileColore(slug)}" ha la variabile --ag col colore del tema in uso
// (cambia da sola col tema); i figli la ereditano. Nel canvas: rgbRuolo(slug, chiaro).
import { api } from "./api.js";
import { iniettaStile } from "./stile.js";

const C = new Map(); // slug → { nome, capo, volto, scuro, chiaro }
const ascoltatori = new Set();
export const suColori = (fn) => { ascoltatori.add(fn); return () => ascoltatori.delete(fn); };

let avvio = null;
export function caricaColori() {
  if (avvio) return avvio;
  iniettaStile("colori", ".pl-ag{--ag:var(--ag-s)}:root[data-tema=chiaro] .pl-ag{--ag:var(--ag-c)}");
  avvio = api("GET", "/api/squadra/colori").then(({ colori }) => {
    C.clear();
    for (const [slug, c] of Object.entries(colori || {})) if (c?.scuro && c?.chiaro) C.set(slug, c);
    ascoltatori.forEach((f) => { try { f(); } catch (e) { console.error("colori:", e); } });
  }).catch(() => { setTimeout(() => { avvio = null; }, 60000); });
  return avvio;
}

export const coloreRuolo = (slug) => C.get(String(slug || "")) || null;
// gli attributi di stile per un elemento .pl-ag; "" se non è un ruolo della squadra
export function stileColore(slug) {
  const c = coloreRuolo(slug);
  return c ? `--ag-s:${c.scuro};--ag-c:${c.chiaro}` : "";
}
// classe e stile insieme, per i template: ` class="pl-ag x" style="…"`; senza colore niente, nemmeno le classi `x` (che
// usano --ag: senza la variabile il testo perderebbe il suo colore di sempre)
export function attrColore(slug, classi = "") {
  const st = stileColore(slug);
  return st ? ` class="pl-ag${classi ? ` ${classi}` : ""}" style="${st}"` : "";
}
export function rgbRuolo(slug, chiaro) {
  const c = coloreRuolo(slug);
  return c ? (chiaro ? c.chiaro : c.scuro).slice(1).match(/../g).map((x) => parseInt(x, 16)) : null;
}
