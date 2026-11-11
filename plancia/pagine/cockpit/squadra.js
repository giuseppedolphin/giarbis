// Il pannello della squadra, aperto dal pulsante «Squadra» fra i comandi della mappa: l'interruttore generale, una riga per
// agente raggruppata per capo (interruttore, intervallo in minuti, stato, ultimo turno), il passaggio alla bacheca
// (GET/POST /api/squadra). Il risveglio lo fa il server con codice (server/squadra.mjs): qui si regola soltanto.
// Una persona senza squadra (`definita: false`) non la vede: il pulsante resta solo come invito a crearla, con dove si definisce.
import { $, S } from "./comune.js";
import { apriBacheca } from "./bacheca.js";
import { apri } from "./chat.js";
import { api } from "/condivisi/api.js";
import { su } from "/condivisi/eventi.js";
import { esc } from "/condivisi/formati.js";
import { attrColore, caricaColori, suColori } from "/condivisi/colori.js";

let stato = null, errore = "";
const ora = (t) => new Date(t).toLocaleString("it-IT", { weekday: "short", hour: "2-digit", minute: "2-digit" });
const STATO = { ferma: "in pausa", avvio: "si avvia", lavora: "lavora", attende: "ha finito", errore: "errore" };

// lo stato della sessione dal vivo (cockpit_sessione), altrimenti quello dell'ultima lettura del pannello
const statoDi = (r) => S.sessioni.get(r.sessione)?.stato || r.stato || "";

function riga(r) {
  const st = statoDi(r);
  const titolo = `${r.mandato}${r.metrica ? `\nMetrica: ${r.metrica}` : ""}\nModello: ${r.modello}${r.perche ? ` (${r.perche})` : ""}\nAutonomia: ${r.autonomia}`;
  const ultimo = r.ultimoTurno ? `ultimo turno ${ora(r.ultimoTurno)}${r.esito ? ` · ${r.esito}` : ""}` : "mai svegliato";
  return `<div class="sq-riga${r.tipo === "esecutore" ? " sq-es" : ""}" title="${esc(titolo)}">`
    + `<i class="dot ${esc(st || "ferma")}"></i>`
    + `<button type="button" class="sq-nome" data-chat="${esc(r.sessione)}" ${r.sessione ? "" : "disabled"}><span${attrColore(r.slug, "nome-ag ag-pt")}>${esc(r.nome)}</span></button>`
    + `<label class="sq-min" title="Ogni quanti minuti il server guarda se c'è qualcosa di nuovo"><input type="number" min="1" max="1440" value="${r.intervalloMinuti}" data-intervallo="${esc(r.slug)}"> min</label>`
    + `<input type="checkbox" role="switch" aria-label="Accendi ${esc(r.nome)}" data-ruolo="${esc(r.slug)}" ${r.acceso ? "checked" : ""}>`
    + `<span class="sq-m">${esc(st ? STATO[st] || st : "non ancora creato")} · ${esc(ultimo)}</span></div>`;
}

function disegna() {
  const box = $("squadra-pannello");
  if (!box || box.hidden) return;
  const q = stato;
  if (!q) { box.innerHTML = '<h3>Squadra</h3><p class="bt-m" style="padding:8px 12px">Carico…</p>'; return; }
  if (q.definita === false) {
    box.innerHTML = '<h3><span>Squadra</span></h3><div class="bt-corpo"><p class="bt-m">Questa plancia non ha ancora una squadra di agenti permanenti.'
      + ` Si definisce in ${q.cercati?.length ? q.cercati.map((f) => `<code>${esc(f)}</code>`).join(" o ") : "un modulo con il campo squadra"}:`
      + " chiedi all'assistente di crearla, coi ruoli che vuoi tu; vale dal Riavvia.</p></div>";
    return;
  }
  const capi = q.ruoli.filter((r) => r.tipo === "capo");
  const gruppi = capi.map((c) => riga(c) + q.ruoli.filter((r) => r.capo === c.slug).map(riga).join("")).join("");
  const notte = q.regole.quiete ? `di notte (${q.regole.quiete.dalle}-${q.regole.quiete.alle}) ${q.regole.quiete.intervalloMinuti ? `ogni ${q.regole.quiete.intervalloMinuti} min` : "dorme"}` : "";
  box.innerHTML = `<h3><span>Squadra</span><label class="bt-int"><span>${q.acceso ? "accesa" : "spenta"}</span><input type="checkbox" role="switch" data-generale ${q.acceso ? "checked" : ""}></label></h3>`
    + `<div class="bt-corpo"><p class="bt-m">Il server guarda con codice se c'è qualcosa di nuovo per ognuno e sveglia solo chi è fermo; a vuoto ogni ${q.regole.vuotoOgniMinuti} min${notte ? `, ${notte}` : ""}.${q.quiete ? " Adesso è notte." : ""}${errore ? ` <span class="bt-err">${esc(errore)}</span>` : ""}</p>`
    + `<div class="sq-lista">${gruppi}</div>`
    + '<div class="bt-azioni"><button type="button" data-bacheca>Bacheca</button></div></div>';
}

// senza squadra il pulsante è solo un invito: tratteggiato, col suo titolo
function pulsante() {
  const b = $("m-squadra");
  if (!b || !stato) return;
  const vuota = stato.definita === false;
  b.classList.toggle("sq-invito", vuota);
  b.title = vuota ? "Nessuna squadra su questa plancia: aprilo per sapere come crearla" : "La squadra di agenti permanenti: accesa o spenta, ogni quanto si sveglia ciascuno";
}
async function carica() {
  try { stato = (await api("GET", "/api/squadra")).squadra; errore = ""; } catch (e) { errore = /non trovato|404/.test(e.message) ? "serve il Riavvia della plancia" : e.message; }
  pulsante(); disegna();
}
async function imposta(corpo) {
  try { stato = (await api("POST", "/api/squadra", corpo)).squadra; errore = ""; } catch (e) { errore = e.message; }
  disegna();
}

function apriPannello(si) {
  const box = $("squadra-pannello");
  box.hidden = !si;
  $("m-squadra").setAttribute("aria-expanded", String(si));
  if (si) { errore = ""; disegna(); carica(); }
}

export function initSquadra() {
  const box = $("squadra-pannello"), bottone = $("m-squadra");
  if (!box || !bottone) return;
  bottone.onclick = (e) => { e.stopPropagation(); apriPannello(box.hidden); };
  box.addEventListener("click", (e) => {
    e.stopPropagation();
    if (e.target.closest("[data-bacheca]")) { apriPannello(false); apriBacheca("bacheca"); }
    const chat = e.target.closest("[data-chat]");
    if (chat?.dataset.chat) { apriPannello(false); apri(chat.dataset.chat); }
  });
  box.addEventListener("change", (e) => {
    if (e.target.matches("[data-generale]")) imposta({ acceso: e.target.checked });
    else if (e.target.matches("[data-ruolo]")) imposta({ ruolo: e.target.dataset.ruolo, acceso: e.target.checked });
    else if (e.target.matches("[data-intervallo]")) imposta({ ruolo: e.target.dataset.intervallo, intervalloMinuti: Number(e.target.value) });
  });
  document.addEventListener("click", () => { if (!box.hidden) apriPannello(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !box.hidden) { e.stopPropagation(); apriPannello(false); } });
  caricaColori(); suColori(disegna);
  su("cockpit_squadra", (ev) => { if (ev.stato) { stato = ev.stato; pulsante(); disegna(); } });
  carica();
  su("cockpit_sessione", (ev) => { if (ev.sessione?.ruolo === "squadra" && !box.hidden) disegna(); });
}
