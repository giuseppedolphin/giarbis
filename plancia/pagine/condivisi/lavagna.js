// La lavagna: una finestra modale con ciò che l'assistente vuole far vedere (grafico, pagina, tabella, audio, video).
// Una sola per tutte le pagine; il contenuto sta in un iframe isolato (niente accesso alle API). Le ultime 12 aperte
// si riaprono dalla tendina in testa.
import { BASE } from "./api.js";
import { esc } from "./formati.js";
import { memo } from "./memo.js";
import { caricaPalette, iniettaStile } from "./stile.js";

const CSS = `
.pl-lav{position:fixed;inset:0;z-index:2147482200;background:var(--pl-velo);display:grid;place-items:center;padding:28px}
.pl-lav[hidden]{display:none}
.pl-lav>div{width:min(1280px,100%);height:min(860px,100%);display:flex;flex-direction:column;background:var(--pl-deep);border:1px solid var(--pl-line2);
  border-radius:14px;overflow:hidden;box-shadow:0 30px 80px rgb(var(--pl-ombra-rgb) / calc(.6 * var(--pl-ombra-k)));font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--pl-text)}
.pl-lav .t{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--pl-line)}
.pl-lav .t b{font-size:16px}
.pl-lav .t i{flex:1;font-style:normal;color:var(--pl-muted)}
.pl-lav .t a{color:var(--pl-text2)}
.pl-lav .t button{font:inherit;background:none;border:0;color:var(--pl-text2);cursor:pointer;font-size:16px}
.pl-lav .t select{font:inherit;max-width:240px;background:var(--pl-campo);border:1px solid var(--pl-line2);border-radius:8px;padding:4px 8px;color:var(--pl-text)}
.pl-lav iframe{flex:1;border:0;width:100%;background:var(--pl-campo)}
.pl-lav :focus-visible{outline:2px solid var(--pl-sonar);outline-offset:2px}`;

const MAX_STORIA = 12;
let el = null;
let storia = null;

function crea() {
  iniettaStile("pl-lavagna", CSS);
  caricaPalette();
  el = document.createElement("div");
  el.className = "pl-lav"; el.hidden = true;
  el.innerHTML = `<div role="dialog" aria-label="Lavagna"><div class="t"><b></b><select aria-label="Lavagne recenti" hidden></select><i></i>
    <a target="_blank" rel="noopener">Apri in una scheda</a><button type="button" title="Chiudi (Esc)" aria-label="Chiudi">✕</button></div>
    <iframe sandbox="allow-scripts allow-popups" title="Lavagna"></iframe></div>`;
  document.body.append(el);
  el.querySelector("button").onclick = chiudiLavagna;
  el.addEventListener("click", (e) => { if (e.target === el) chiudiLavagna(); });
  el.querySelector("select").onchange = (e) => {
    const x = storia[Number(e.target.value)];
    if (x) apriLavagna({ titolo: x.titolo, src: x.src, da: x.da });
  };
  // in fase di cattura: Esc chiude la lavagna e basta, senza fermare anche la voce o chiudere altro
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && lavagnaAperta()) { e.stopPropagation(); chiudiLavagna(); }
  }, true);
}

export const lavagnaAperta = () => !!el && !el.hidden;

export function chiudiLavagna() {
  if (!el) return;
  el.hidden = true;
  el.querySelector("iframe").src = "about:blank";
}

// src: il percorso servito dal plancia (/lavagna/<file>, /pannelli/<file>…); da: chi l'ha prodotta.
export function apriLavagna({ titolo, src, da }) {
  if (!el) crea();
  // le lavagne di prima della migrazione di memo.js hanno `percorso` invece di `src`
  storia = storia || memo.json("lavagne", []).map((x) => ({ ...x, src: x.src || x.percorso })).filter((x) => x.src);
  const url = BASE + src;
  el.querySelector("iframe").src = url;
  el.querySelector("b").textContent = titolo || "Lavagna";
  el.querySelector("i").textContent = da ? `da ${da}` : "";
  el.querySelector("a").href = url;
  const i = storia.findIndex((x) => x.src === src);
  if (i >= 0) storia.splice(i, 1);
  storia.unshift({ src, titolo: titolo || src.split("/").pop(), da: da || "" });
  storia.length = Math.min(storia.length, MAX_STORIA);
  memo.setJson("lavagne", storia);
  const sel = el.querySelector("select");
  sel.innerHTML = storia.map((x, k) => `<option value="${k}">${esc(x.titolo)}</option>`).join("");
  sel.hidden = storia.length < 2;
  el.hidden = false;
}
