// I percorsi citati nella pagina diventano link che aprono il file nell'editor (vscode://file/<percorso assoluto>[:riga]).
// Si guardano i `code` (testo tra backtick e blocchi di codice di chat e schede) e gli elementi con data-percorso (campi dei
// fogli): se il testo è un percorso relativo alla cartella di lavoro, si chiede al server se è un file vero (POST
// /api/percorsi, che dà anche la cartella) e solo allora si fa il link. Le risposte restano in memoria: un ridisegno della
// chat ritrova i link senza richiamare il server. Server senza la rotta (prima del Riavvia): nessun link, si riprova fra un minuto.
import { api } from "/condivisi/api.js";

// a/b/c.md, ./README.md, x.csv:12 — senza spazi, con un'estensione nell'ultimo pezzo
const PERCORSO = /^(?:\.\/)?(?:[\w@+\-.]+\/)*[\w@+\-.]*\.[A-Za-z0-9]{1,8}(?::\d+(?::\d+)?)?$/;
const RIPROVA_MS = 60000;

const noti = new Map(); // percorso (senza riga) → true | false
const inAttesa = new Set();
let cartella = "";
let spento = 0; // fino a quando non si chiede al server (la rotta non c'è)
let timer = null;

const pulito = (t) => String(t || "").trim().replace(/^\.\//, "");
const senzaRiga = (p) => p.replace(/(:\d+){1,2}$/, "");
const candidato = (t) => t.length <= 300 && !t.includes("..") && !/^[\d.]+$/.test(t) && PERCORSO.test(t);

function collega(el, p) {
  const a = document.createElement("a");
  a.className = "pl-percorso";
  const riga = (p.match(/(:\d+){1,2}$/) || [""])[0];
  a.href = `vscode://file${encodeURI(`${cartella}/${senzaRiga(p)}`)}${riga}`;
  a.title = `Apri ${senzaRiga(p)} in VS Code`;
  a.addEventListener("click", (e) => e.stopPropagation()); // la riga di una to-do sotto non apre la sua scheda
  el.replaceWith(a);
  a.appendChild(el);
}

function guarda(radice) {
  const els = radice.querySelectorAll ? radice.querySelectorAll("code, [data-percorso]") : [];
  for (const el of [radice, ...els]) {
    if (!el.matches?.("code, [data-percorso]") || el.closest("a")) continue;
    if (el.matches("pre code") && el.textContent.trim().includes("\n")) continue;
    const p = pulito(el.dataset.percorso || el.textContent);
    if (!candidato(p)) continue;
    const chiave = senzaRiga(p);
    if (noti.get(chiave) === true && cartella) collega(el, p);
    else if (!noti.has(chiave)) { inAttesa.add(chiave); programma(); }
  }
}

function programma() {
  if (timer || Date.now() < spento) return;
  timer = setTimeout(chiedi, 150);
}

async function chiedi() {
  timer = null;
  const lista = [...inAttesa].slice(0, 200);
  if (!lista.length) return;
  try {
    const j = await api("POST", "/api/percorsi", { percorsi: lista });
    // su Windows "C:\a\b" → "/C:/a/b": vscode://file vuole le "/" e una "/" prima della lettera del disco
    cartella = String(j.cartella || "").replace(/\\/g, "/").replace(/\/+$/, "").replace(/^(?=[A-Za-z]:)/, "/");
    const si = new Set(j.esistono || []);
    for (const p of lista) { noti.set(p, si.has(p)); inAttesa.delete(p); }
    if (si.size) guarda(document.body);
    if (inAttesa.size) programma();
  } catch {
    spento = Date.now() + RIPROVA_MS;
    inAttesa.clear(); // si riprovano al prossimo ridisegno dopo il minuto
  }
}

export function initPercorsi() {
  new MutationObserver((cambi) => {
    if (Date.now() < spento) return;
    for (const c of cambi) for (const n of c.addedNodes) if (n.nodeType === 1) guarda(n);
  }).observe(document.body, { childList: true, subtree: true });
  guarda(document.body);
}
