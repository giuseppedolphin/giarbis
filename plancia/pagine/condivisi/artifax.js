// «Artifax»: il catalogo di ciò che è stato prodotto (file di lavagna, fogli, pannelli), da /api/artifax. Un clic lo riapre
// come foglio sulla mappa del cockpit (lo riaccende, se c'è già); audio e video, che non sono fogli, si aprono nella lavagna.
import { BASE, api } from "./api.js";
import { data, esc } from "./formati.js";
import { apriLavagna } from "./lavagna.js";

const NOMI = { html: "pagina", immagine: "immagine", audio: "audio", video: "video", tabella: "tabella", todo: "to-do" };
const AGGIORNA_MS = 10000;

// Monta il pulsante e il cassetto; `dopo` è l'elemento della barra dopo cui sta il pulsante, `inCockpit` dice se la pagina è il cockpit.
export function montaArtifax(dopo, { inCockpit }) {
  const bottone = document.createElement("button");
  bottone.className = "artifax"; bottone.type = "button"; bottone.id = "rdnav-artifax";
  bottone.textContent = "Artifax"; bottone.setAttribute("aria-expanded", "false");
  dopo.after(bottone);

  const cassetto = document.createElement("aside");
  cassetto.className = "rdartifax"; cassetto.hidden = true;
  cassetto.setAttribute("aria-label", "Artifax, le cose prodotte");
  cassetto.innerHTML = `<div class="t"><b>Artifax</b><button type="button" title="Chiudi (Esc)" aria-label="Chiudi">✕</button></div>
    <input type="search" placeholder="Cerca per titolo" aria-label="Cerca per titolo"><ul></ul>`;
  document.body.append(cassetto);
  const lista = cassetto.querySelector("ul"), ricerca = cassetto.querySelector("input");

  let voci = [], timer = null;

  const riga = (x) => `<li${x.mancante ? ' class="manca"' : ""}><button type="button" data-id="${esc(x.id)}" title="${x.mancante ? "File non più presente" : "Riapri"}">
    <span class="k">${esc(NOMI[x.tipo] || x.tipo)}</span><span class="n">${esc(x.titolo)}</span>
    <span class="m">${esc(data(x.quando))}${x.da ? ` · da ${esc(x.da)}` : ""}${x.tipo === "tabella" ? ` · ${x.n_righe} righe` : ""}</span></button></li>`;

  function disegna() {
    const q = ricerca.value.trim().toLowerCase();
    const v = voci.filter((x) => !q || String(x.titolo).toLowerCase().includes(q));
    lista.innerHTML = v.map(riga).join("") || `<li class="vuoto">${voci.length ? "Nessun titolo corrisponde." : "Ancora nessun artifax."}</li>`;
  }

  async function carica() {
    try { voci = (await api("GET", "/api/artifax")).artifax || []; disegna(); }
    catch { lista.innerHTML = '<li class="vuoto">Il server non risponde: riavvialo per vedere la lista.</li>'; }
  }

  function chiudi() {
    cassetto.hidden = true;
    bottone.setAttribute("aria-expanded", "false");
    clearInterval(timer);
  }

  function apri() {
    cassetto.hidden = false;
    bottone.setAttribute("aria-expanded", "true");
    carica();
    timer = setInterval(carica, AGGIORNA_MS);
    ricerca.focus();
  }

  bottone.onclick = () => (cassetto.hidden ? apri() : chiudi());
  cassetto.querySelector(".t button").onclick = chiudi;
  ricerca.oninput = disegna;
  lista.addEventListener("click", async (e) => {
    const x = voci.find((v) => v.id === e.target.closest("button")?.dataset.id);
    if (!x) return;
    if (x.tipo === "audio" || x.tipo === "video") { chiudi(); apriLavagna({ titolo: x.titolo, src: x.percorso, da: x.da }); return; }
    try { // un foglio sulla mappa, che si vede solo sul cockpit
      await api("POST", `/api/artifax/${encodeURIComponent(x.id)}/foglio`);
      chiudi();
      if (!inCockpit) location.href = `${BASE}/cockpit`;
    } catch (err) { lista.insertAdjacentHTML("afterbegin", `<li class="vuoto">${esc(err.message)}</li>`); }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !cassetto.hidden) chiudi(); });
  document.addEventListener("click", (e) => { if (!cassetto.hidden && !e.target.closest(".rdartifax, #rdnav-artifax")) chiudi(); });
  return bottone;
}
