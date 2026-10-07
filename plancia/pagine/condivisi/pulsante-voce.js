// Il pulsante della voce: compare solo mentre l'assistente parla. Con la coda vuota è uno stop (quadrato) e ferma la
// voce; con altri messaggi in coda è un «avanti» (>>) e salta al prossimo. Esc ferma tutto. Colori dalla palette, nei due temi.
import { lavagnaAperta } from "./lavagna.js";
import { caricaPalette, iniettaStile } from "./stile.js";
import { ferma, prossimo, stato, suStato } from "./voce-motore.js";

const CSS = `
.pl-pv{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:34px;height:30px;padding:0 12px;border-radius:999px;cursor:pointer;
  border:1px solid var(--pl-line2);background:rgb(var(--pl-coral-rgb) / .12);color:var(--pl-coral-testo);font:600 12px/1 system-ui,-apple-system,"Segoe UI",sans-serif}
.pl-pv:hover{background:rgb(var(--pl-coral-rgb) / .24);color:var(--pl-stop-hover)}
.pl-pv:focus-visible{outline:2px solid var(--pl-sonar);outline-offset:2px}
.pl-pv[hidden]{display:none}
.pl-pv svg{width:14px;height:14px;flex:none}`;
const QUADRATO = '<svg viewBox="0 0 14 14" aria-hidden="true"><rect x="2" y="2" width="10" height="10" rx="1.5" fill="currentColor"/></svg>';
const AVANTI = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3l4 4-4 4M8 3l4 4-4 4"/></svg>';

let esc = false;

// Monta il pulsante in `contenitore` e lo tiene allineato alla coda della voce. Restituisce il bottone.
export function montaPulsanteVoce(contenitore) {
  iniettaStile("pl-pulsante-voce", CSS);
  caricaPalette();
  const b = document.createElement("button");
  b.type = "button"; b.className = "pl-pv"; b.hidden = true;
  b.onclick = () => (stato().inCoda > 0 ? prossimo() : ferma());
  contenitore.append(b);
  suStato((s) => {
    b.hidden = !s.parlando;
    const avanti = s.inCoda > 0;
    b.innerHTML = avanti ? `${AVANTI}<span>${s.inCoda}</span>` : QUADRATO;
    b.title = avanti ? "Passa al messaggio successivo" : "Ferma la voce (Esc)";
    b.setAttribute("aria-label", avanti ? "Passa al messaggio successivo" : "Ferma la voce");
  });
  if (!esc) {
    esc = true;
    // Esc ferma tutto, anche col fuoco in un campo di testo, ma solo mentre l'assistente parla (altrimenti l'Esc resta al
    // campo); con la lavagna aperta no: la chiude lei.
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || lavagnaAperta() || !stato().parlando) return;
      ferma();
    });
  }
  return b;
}
