// Il pulsante «Copia» sotto una risposta della chat (assistente e agenti): copia negli appunti il markdown sorgente della
// risposta finale (i testi dopo l'ultimo strumento, niente strumenti né ragionamento) e per due secondi dice «Copiato».
// Compare solo a turno chiuso: durante lo streaming la risposta non è ancora finita.
import { esc } from "/condivisi/formati.js";

const ICONA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';
const ICONA_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

// Il testo da copiare: i blocchi di testo della risposta, separati da una riga vuota come arrivano dal modello.
const testoRisposta = (blocchi) => blocchi.filter((b) => b.type === "text").map((b) => b.text.trim()).filter(Boolean).join("\n\n");

// L'html della riga delle azioni sotto la risposta; il testo sorgente viaggia nell'attributo (esc lo rende sicuro).
function htmlCopia(blocchi) {
  const t = testoRisposta(blocchi);
  if (!t) return "";
  return `<div class="azioni-msg"><button type="button" class="copia" data-copia="${esc(t)}" aria-label="Copia la risposta" title="Copia">`
    + `${ICONA}<span>Copia</span></button></div>`;
}

// Negli appunti: navigator.clipboard, e se manca o rifiuta un textarea nascosto con execCommand.
async function copiaTesto(t) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(t); return true; }
  } catch { /* si prova la via vecchia */ }
  const ta = document.createElement("textarea");
  ta.value = t;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0";
  const fuoco = document.activeElement;
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  ta.remove();
  fuoco?.focus?.();
  return ok;
}

function initCopia() {
  document.addEventListener("click", async (e) => {
    const b = e.target.closest?.("button[data-copia]");
    if (!b) return;
    const ok = await copiaTesto(b.dataset.copia);
    clearTimeout(b._t);
    b.classList.toggle("fatto", ok);
    b.innerHTML = `${ok ? ICONA_OK : ICONA}<span>${ok ? "Copiato" : "Non copiato"}</span>`;
    b.setAttribute("aria-label", ok ? "Risposta copiata" : "Copia non riuscita");
    b._t = setTimeout(() => {
      b.classList.remove("fatto");
      b.innerHTML = `${ICONA}<span>Copia</span>`;
      b.setAttribute("aria-label", "Copia la risposta");
    }, 2000);
  });
}

export { copiaTesto, htmlCopia, initCopia, testoRisposta };
