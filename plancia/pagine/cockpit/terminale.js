// Il terminale del cockpit: una finestra sopra la mappa con una o più shell vere (server/terminale.mjs), disegnate da xterm.js
// (da cdnjs, con l'impronta SRI). Pulsante «Terminale» fra i comandi della mappa: apre la finestra e, se non ce n'è, una shell;
// «+» ne apre un'altra (al massimo 4, lo dice il server), × la chiude, «—» nasconde la finestra lasciando le shell vive.
// Ogni shell ha il suo token, che resta solo in memoria: lo stream lo porta nella query (EventSource non manda header), l'input
// nell'header X-Terminale. A pagina chiusa o ricaricata le shell si chiudono (sendBeacon su pagehide; comunque il server le chiude
// dopo 15 secondi senza stream).
// I tasti dentro la finestra non arrivano alle scorciatoie del cockpit (Esc, Ctrl+Spazio): servono alla shell.
import { $, mostraBanner } from "./comune.js";
import { BASE } from "/condivisi/api.js";
import { esc } from "/condivisi/formati.js";

const CDN = "https://cdnjs.cloudflare.com/ajax/libs/xterm/6.0.0/";
const SRI = {
  js: "sha512-uizNIcrofW9tvPxCDN2zy3RKGesFPi8nwV0SEE480G+qUpyDaWEI9ia9lnwTitiU1DbW4wLQcA/vFrVzjgVkdw==",
  css: "sha512-xos4zaD4xiLA4Y3REtnCRqZx2icS1XdZdLBjXUmgqhflDB7tUtnOwKNMHuVIxnBnDUsbuJhlMIuV+exytqZYTA==",
};

const shell = new Map(); // id → { id, token, term, el, es, coda, inVolo, finita, n }
let attiva = null, numero = 0, libreria = null;

function caricaXterm() {
  if (window.Terminal) return Promise.resolve();
  if (libreria) return libreria;
  libreria = new Promise((ok, no) => {
    const l = Object.assign(document.createElement("link"), { rel: "stylesheet", href: `${CDN}xterm.min.css`, integrity: SRI.css, crossOrigin: "anonymous" });
    document.head.append(l);
    const s = Object.assign(document.createElement("script"), { src: `${CDN}xterm.js`, integrity: SRI.js, crossOrigin: "anonymous" });
    s.onload = () => (window.Terminal ? ok() : no(new Error("xterm.js non si è caricato")));
    s.onerror = () => { libreria = null; no(new Error("xterm.js non raggiungibile (cdnjs)")); };
    document.head.append(s);
  });
  return libreria;
}

async function chiama(sh, azione, corpo) {
  const r = await fetch(`${BASE}/api/terminali/${sh.id}/${azione}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-dashboard": "1", "x-terminale": sh.token },
    body: JSON.stringify(corpo || {}),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.errore || `errore ${r.status}`);
  return j;
}

// I colori dalla palette del tema: la shell segue il tema scuro o chiaro come il resto del cockpit.
function tema() {
  const v = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  return { background: v("--abyss"), foreground: v("--text"), cursor: v("--sonar"), cursorAccent: v("--abyss"), selectionBackground: v("--line2") };
}

// Righe e colonne che stanno nel riquadro: la cella la misura xterm (interno), altrimenti una prova col font.
function misura(sh) {
  const cella = sh.term._core?._renderService?.dimensions?.css?.cell;
  let w = cella?.width, h = cella?.height;
  if (!w || !h) {
    const p = Object.assign(document.createElement("span"), { textContent: "W".repeat(40) });
    p.style.cssText = `position:absolute;visibility:hidden;font:${sh.term.options.fontSize}px ${sh.term.options.fontFamily};line-height:normal`;
    document.body.append(p);
    w = p.getBoundingClientRect().width / 40; h = p.getBoundingClientRect().height;
    p.remove();
  }
  const r = sh.el.getBoundingClientRect();
  return { righe: Math.max(5, Math.floor((r.height - 8) / h)), colonne: Math.max(20, Math.floor((r.width - 14) / w)) };
}

let ritardo = null;
function adatta() {
  clearTimeout(ritardo);
  ritardo = setTimeout(() => {
    const sh = shell.get(attiva);
    if (!sh || sh.finita || $("terminale").hidden) return;
    const { righe, colonne } = misura(sh);
    if (righe === sh.term.rows && colonne === sh.term.cols) return;
    sh.term.resize(colonne, righe);
    chiama(sh, "dimensioni", { righe, colonne }).catch((e) => mostraBanner(`Terminale: ${e.message}`, 4000));
  }, 120);
}

// L'input va in ordine: una richiesta alla volta, quello che arriva intanto si accoda e parte insieme.
function manda(sh, dati) {
  sh.coda += dati;
  if (sh.inVolo || sh.finita) return;
  sh.inVolo = true;
  const pezzo = sh.coda; sh.coda = "";
  chiama(sh, "input", { dati: pezzo })
    .catch((e) => { if (!sh.finita) mostraBanner(`Terminale: ${e.message}`, 4000); })
    .finally(() => { sh.inVolo = false; if (sh.coda) manda(sh, ""); });
}

function rendiSchede() {
  $("tm-schede").innerHTML = [...shell.values()].map((sh) => `<span class="tm-scheda${sh.id === attiva ? " attiva" : ""}${sh.finita ? " finita" : ""}" data-id="${esc(sh.id)}">`
    + `<button class="tm-nome" data-a="vai">shell ${sh.n}${sh.finita ? " (chiusa)" : ""}</button><button class="tm-x" data-a="chiudi" aria-label="Chiudi la shell ${sh.n}">×</button></span>`).join("");
  const b = $("m-terminale");
  b.textContent = shell.size ? `Terminale (${shell.size})` : "Terminale";
}

function mostra(id) {
  attiva = id;
  for (const sh of shell.values()) sh.el.hidden = sh.id !== id;
  rendiSchede();
  const sh = shell.get(id);
  if (sh) { adatta(); sh.term.focus(); }
}

async function nuova() {
  try { await caricaXterm(); } catch (e) { return mostraBanner(e.message, 5000); }
  const corpo = $("tm-corpo");
  const el = document.createElement("div");
  el.className = "tm-shell";
  corpo.append(el);
  const term = new window.Terminal({ fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace', fontSize: 13, cursorBlink: true, scrollback: 5000, theme: tema(), allowProposedApi: false });
  term.open(el);
  const sh = { id: "", token: "", term, el, es: null, coda: "", inVolo: false, finita: false, n: ++numero };
  let r;
  try {
    const { righe, colonne } = misura(sh);
    term.resize(colonne, righe);
    const risposta = await fetch(`${BASE}/api/terminali`, { method: "POST", headers: { "content-type": "application/json", "x-dashboard": "1" }, body: JSON.stringify({ righe, colonne }) });
    r = await risposta.json().catch(() => ({ ok: false, errore: `errore ${risposta.status}` }));
    if (!risposta.ok || r.ok === false) throw new Error(r.errore || `errore ${risposta.status}`);
  } catch (e) {
    term.dispose(); el.remove(); numero--;
    return mostraBanner(/non trovato/.test(e.message) ? "Il server non ha ancora il terminale: serve il Riavvia" : `Terminale: ${e.message}`, 6000);
  }
  Object.assign(sh, { id: r.id, token: r.token });
  shell.set(sh.id, sh);
  term.onData((d) => manda(sh, d));
  sh.es = new EventSource(`${BASE}/api/terminali/${sh.id}/stream?token=${sh.token}`);
  sh.es.onmessage = (m) => {
    const ev = JSON.parse(m.data);
    if (ev.storia !== undefined) { term.reset(); term.write(ev.storia); }
    if (ev.o) term.write(ev.o);
    if (ev.fine) finisci(sh, "\r\n\x1b[2m[shell chiusa]\x1b[0m\r\n");
  };
  sh.es.onerror = () => { if (sh.es.readyState === EventSource.CLOSED) finisci(sh, "\r\n\x1b[2m[collegamento perso]\x1b[0m\r\n"); };
  mostra(sh.id);
}

function finisci(sh, nota) {
  if (sh.finita) return;
  sh.finita = true;
  sh.es?.close();
  sh.term.write(nota);
  rendiSchede();
}

function chiudi(id) {
  const sh = shell.get(id);
  if (!sh) return;
  if (!sh.finita) chiama(sh, "chiudi").catch(() => {});
  sh.finita = true;
  sh.es?.close();
  sh.term.dispose();
  sh.el.remove();
  shell.delete(id);
  const altra = [...shell.keys()].pop();
  if (altra) mostra(altra); else { attiva = null; rendiSchede(); $("terminale").hidden = true; }
}

function apri() {
  const box = $("terminale");
  if (!box.hidden) { box.hidden = true; return; }
  box.hidden = false;
  if (!shell.size) nuova(); else mostra(attiva || [...shell.keys()].pop());
}

// La finestra si sposta trascinando la testata e si ridimensiona dall'angolo (resize del CSS); xterm segue.
function trascinabile(box, maniglia) {
  maniglia.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    const r = box.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    maniglia.setPointerCapture(e.pointerId);
    const muovi = (m) => {
      box.style.left = `${Math.max(0, Math.min(innerWidth - 120, m.clientX - dx))}px`;
      box.style.top = `${Math.max(0, Math.min(innerHeight - 40, m.clientY - dy))}px`;
      box.style.right = box.style.bottom = "auto";
    };
    const fine = () => { maniglia.removeEventListener("pointermove", muovi); maniglia.removeEventListener("pointerup", fine); };
    maniglia.addEventListener("pointermove", muovi);
    maniglia.addEventListener("pointerup", fine);
  });
}

function initTerminale() {
  const box = $("terminale");
  $("m-terminale").onclick = apri;
  $("tm-nuova").onclick = () => nuova();
  $("tm-nascondi").onclick = () => { box.hidden = true; };
  $("tm-schede").addEventListener("click", (e) => {
    const id = e.target.closest(".tm-scheda")?.dataset.id, a = e.target.closest("[data-a]")?.dataset.a;
    if (id && a === "chiudi") chiudi(id); else if (id) mostra(id);
  });
  trascinabile(box, $("tm-testa"));
  // i tasti restano alla shell: le scorciatoie del cockpit (Esc, Ctrl+Spazio) ascoltano su document e window
  for (const tipo of ["keydown", "keyup", "keypress"]) box.addEventListener(tipo, (e) => e.stopPropagation());
  if ("ResizeObserver" in window) new ResizeObserver(adatta).observe($("tm-corpo"));
  new MutationObserver(() => { for (const sh of shell.values()) sh.term.options.theme = tema(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ["data-tema", "data-stile"] });
  // pagina chiusa o ricaricata: le shell si chiudono subito con sendBeacon (una fetch keepalive con header propri non parte). A tutte,
  // anche a quelle che sembrano finite: in uscita il browser chiude prima gli stream, e la shell sembrerebbe già chiusa.
  addEventListener("pagehide", () => {
    for (const sh of shell.values()) navigator.sendBeacon(`${BASE}/api/terminali/${sh.id}/fine?token=${sh.token}`);
  });
}

export { initTerminale };
