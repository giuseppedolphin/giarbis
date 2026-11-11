// Gli eventi del server (SSE su /api/stream): un solo EventSource per pagina, chi ascolta si registra per tipo.
//   su("delta", (ev) => ...)  →  restituisce la funzione che toglie l'ascolto
//   su("*", fn)               →  ogni evento
//   su("_aperto", fn) · su("_errore", fn)  →  la connessione si è aperta (anche dopo una caduta) o è caduta
import { BASE } from "./api.js";

const ascoltatori = new Map();
let sorgente = null;
let sorveglia = null; // dopo una caduta: ogni RIPROVA_MS si chiede /api/chi e, se il server c'è, si riapre lo stream
export const RIPROVA_MS = 3000;

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

// Apre lo stream, una volta sola per pagina (richiamarla è innocuo). Si riconnette da sé: il browser riprova da solo, ma
// se una ripresa trova una risposta che non è uno stream (un 403, un 5xx, la porta presa da un altro processo durante un
// Riavvia) chiude l'EventSource per sempre e la pagina restava sull'avviso col server di nuovo su.
// Per questo dopo una caduta si sorveglia: col server che risponde e lo stream non aperto, se ne apre uno nuovo.
export function connetti() {
  if (sorgente) return sorgente;
  apri();
  return sorgente;
}

function apri() {
  const es = new EventSource(`${BASE}/api/stream`);
  sorgente = es;
  es.onopen = () => {
    if (sorgente !== es) return;
    clearInterval(sorveglia); sorveglia = null;
    emetti("_aperto", { type: "_aperto" });
  };
  es.onerror = () => {
    if (sorgente !== es) return;
    emetti("_errore", { type: "_errore" });
    if (!sorveglia) sorveglia = setInterval(controlla, RIPROVA_MS);
  };
  es.onmessage = (m) => {
    let ev;
    try { ev = JSON.parse(m.data); } catch { return; }
    if (!ev || !ev.type) return;
    emetti(ev.type, ev);
    emetti("*", ev);
  };
}

async function controlla() {
  if (!sorgente || sorgente.readyState === 1) { clearInterval(sorveglia); sorveglia = null; return; } // 1 = OPEN
  if (sorgente.readyState === 0) return; // 0 = CONNECTING: il browser sta già riprovando
  try {
    const r = await fetch(`${BASE}/api/chi`, { headers: { "x-dashboard": "1" }, cache: "no-store" });
    if (!r.ok || !sorgente || sorgente.readyState !== 2) return; // 2 = CLOSED: il browser non riprova più
    sorgente.close();
    apri();
  } catch { /* server ancora giù: si riprova al giro dopo */ }
}
