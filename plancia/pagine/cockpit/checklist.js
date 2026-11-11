// La checklist di primo avvio (server/checklist.mjs), nel pannello del pulsante «Avvio» fra i comandi della mappa: una riga per
// voce col pallino (verde fatta, giallo facoltativa o in attesa, rosso manca), il dettaglio del controllo e come si sistema.
// Si apre da sola finché la checklist non è completa e la persona non l'ha messa da parte («Più tardi»); il pulsante la riapre
// e la ricontrolla. Le voci «spunta» (una lettura) hanno la casella; «Guidami» manda all'assistente il turno [checklist].
import { $, assistente } from "./comune.js";
import { api } from "/condivisi/api.js";
import { su } from "/condivisi/eventi.js";
import { esc } from "/condivisi/formati.js";

let stato = null, errore = "", lavora = false;

function riga(v) {
  const spunta = v.tipo === "spunta"
    ? `<label class="ck-spunta"><input type="checkbox" data-spunta="${esc(v.id)}" ${v.esito === "ok" ? "checked" : ""}> fatto</label>` : "";
  return `<li class="ck-riga ck-${esc(v.colore)}"><i class="ck-dot" aria-label="${esc(v.colore)}"></i>`
    + `<div><b>${esc(v.titolo)}</b>${v.facoltativa ? ' <span class="bt-m">facoltativa</span>' : ""}${v.tipo === "assistente" ? ` <span class="bt-m">la verifica ${esc(assistente.nome)}</span>` : ""}`
    + `<p class="bt-m">${esc(v.dettaglio)}</p>${v.esito !== "ok" && v.come ? `<p class="ck-come">${esc(v.come)}</p>` : ""}</div>${spunta}</li>`;
}

function disegna() {
  const box = $("checklist-pannello");
  if (!box || box.hidden) return;
  const c = stato;
  const testa = !c?.voci ? "Primo avvio" : c.operatore ? "Sei operatore" : `Primo avvio · ${c.mancano === 1 ? "manca 1 voce" : `mancano ${c.mancano} voci`}`;
  box.innerHTML = `<h3><span>${esc(testa)}</span>${lavora ? '<span class="bt-m">controllo…</span>' : ""}</h3><div class="bt-corpo">`
    + (c?.voci ? `<ul class="ck-lista">${c.voci.map(riga).join("")}</ul>` : '<p class="bt-m">Controllo le voci…</p>')
    + (errore ? `<p class="bt-err">${esc(errore)}</p>` : "")
    + `<div class="bt-azioni ck-azioni"><button type="button" data-azione="dopo">Più tardi</button><button type="button" data-azione="guida">Guidami, ${esc(assistente.nome)}</button>`
    + `<button type="button" data-azione="controlla">Ricontrolla</button></div></div>`;
}

async function chiama(percorso, corpo) {
  lavora = true; errore = ""; disegna();
  try { stato = (await api("POST", percorso, corpo || {})).checklist; } catch (x) { errore = x.message; }
  lavora = false; disegna();
}

function apri(si, { controlla = false } = {}) {
  const box = $("checklist-pannello");
  box.hidden = !si;
  $("m-avvio").setAttribute("aria-expanded", String(si));
  if (si) { disegna(); if (controlla || !stato?.voci) chiama("/api/checklist/controlla"); }
}

export async function initChecklist() {
  const box = $("checklist-pannello"), bottone = $("m-avvio");
  if (!box || !bottone) return;
  bottone.onclick = (e) => { e.stopPropagation(); apri(box.hidden, { controlla: true }); };
  box.addEventListener("click", (e) => {
    e.stopPropagation();
    const a = e.target.closest("[data-azione]")?.dataset.azione;
    if (a === "controlla") chiama("/api/checklist/controlla");
    else if (a === "guida") chiama("/api/checklist/guida");
    else if (a === "dopo") { apri(false); api("POST", "/api/checklist/nascondi", { nascosta: true }).catch(() => {}); }
  });
  box.addEventListener("change", (e) => {
    const id = e.target.dataset?.spunta;
    if (id) chiama("/api/checklist/spunta", { id, fatto: e.target.checked });
  });
  su("cockpit_checklist", (ev) => {
    stato = ev.checklist;
    bottone.classList.toggle("ck-manca", !stato.operatore); bottone.hidden = !!stato.completata; // completa: sparisce dalla barra, resta nel menu dell'ingranaggio
    if (box.hidden && !stato.nascosta && !stato.completata) apri(true);
    disegna();
  });
  try { stato = (await api("GET", "/api/checklist")).checklist; } catch { return; } // server vecchio: niente checklist fino al Riavvia
  bottone.classList.toggle("ck-manca", !!stato.voci && !stato.operatore); bottone.hidden = !!stato.completata;
  if (!stato.completata && !stato.nascosta) apri(true);
}
