// Gli eventi del server (SSE su /api/stream): un solo EventSource per pagina, chi ascolta si registra per tipo.
//   su("delta", (ev) => ...)  →  restituisce la funzione che toglie l'ascolto
//   su("*", fn)               →  ogni evento
//   su("_aperto", fn) · su("_errore", fn)  →  la connessione si è aperta (anche dopo una caduta) o è caduta
import { BASE } from "./api.js";

const ascoltatori = new Map();
let sorgente = null;

function emetti(tipo, ev) {
  for (const fn of ascoltatori.get(tipo) || []) {
    try { fn(ev); } catch (e) { console.error(`evento ${tipo}:`, e); }
  }
}

export function su(tipo, fn) {
  if (!ascoltatori.has(tipo)) ascoltatori.set(tipo, new Set());
  ascoltatori.get(tipo).add(fn);
  return () => ascoltatori.get(tipo)?.delete(fn);
}

// Apre lo stream, una volta sola per pagina (richiamarla è innocuo). Si riconnette da sé.
export function connetti() {
  if (sorgente) return sorgente;
  sorgente = new EventSource(`${BASE}/api/stream`);
  sorgente.onopen = () => emetti("_aperto", { type: "_aperto" });
  sorgente.onerror = () => emetti("_errore", { type: "_errore" });
  sorgente.onmessage = (m) => {
    let ev;
    try { ev = JSON.parse(m.data); } catch { return; }
    if (!ev || !ev.type) return;
    emetti(ev.type, ev);
    emetti("*", ev);
  };
  return sorgente;
}
