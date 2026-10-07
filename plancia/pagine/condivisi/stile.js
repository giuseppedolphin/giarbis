// Stile iniettato dalle pagine condivise. Ogni nodo porta data-plancia, così la bolla staccata (finestra
// Picture-in-Picture) li copia tutti nella sua finestra.
import { BASE } from "./api.js";

export function iniettaStile(id, css) {
  let el = document.querySelector(`style[data-plancia="${id}"]`);
  if (!el) {
    el = document.createElement("style");
    el.dataset.plancia = id;
    document.head.append(el);
  }
  if (el.textContent !== css) el.textContent = css;
  return el;
}

export const urlPalette = () => new URL(`${BASE}/condivisi/palette.css`, location.href).href;
const paletteCaricata = () => !!getComputedStyle(document.documentElement).getPropertyValue("--pl-sonar-rgb").trim();

// Carica la palette dei due temi (una volta sola) e risolve quando le variabili ci sono; non blocca oltre 1,5 secondi.
let promessa = null;
export function caricaPalette() {
  if (promessa) return promessa;
  if (paletteCaricata()) return (promessa = Promise.resolve());
  promessa = new Promise((ok) => {
    let link = document.querySelector('link[data-plancia="palette"], link[href$="/condivisi/palette.css"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "stylesheet"; link.href = urlPalette(); link.dataset.plancia = "palette";
      document.head.append(link);
    }
    link.addEventListener("load", () => ok(), { once: true });
    link.addEventListener("error", () => ok(), { once: true });
    setTimeout(ok, 1500);
  });
  return promessa;
}
