// Il pannello del battito, aperto dal pulsante «Battito» fra i comandi della mappa: interruttore, orari e giorni, prossimo
// scatto, ultimo scatto e ultima proposta (GET /api/battito e /api/proposte). Le proposte da decidere restano nella casella
// «Da decidere» della barra: dal pannello ci si arriva col pulsante in fondo.
import { $, assistente } from "./comune.js";
import { api } from "/condivisi/api.js";
import { apriDomande } from "/condivisi/domande.js";
import { su } from "/condivisi/eventi.js";
import { esc } from "/condivisi/formati.js";

const GIORNI = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
let stato = null, proposte = null, errore = "";

const ora = (t) => new Date(t).toLocaleString("it-IT", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function disegna() {
  const box = $("battito-pannello");
  if (!box || box.hidden) return;
  const b = stato;
  if (!b) { box.innerHTML = '<h3>Battito</h3><p class="bt-m">Carico…</p>'; return; }
  const ultima = proposte?.attuale || proposte?.recenti?.[0] || null;
  const u = b.ultimo;
  box.innerHTML = `<h3><span>Battito di ${esc(assistente.nome)}</span>`
    + `<label class="bt-int"><span>${b.acceso ? "acceso" : "spento"}</span><input type="checkbox" role="switch" data-acceso ${b.acceso ? "checked" : ""}></label></h3>`
    + '<div class="bt-corpo">'
    + `<form class="bt-orari" data-orari><label>Orari <input name="orari" value="${esc(b.orari.join(", "))}" spellcheck="false"></label><button type="submit">Salva</button></form>`
    + `<p class="bt-m">Giorni: ${esc(b.giorni.map((g) => GIORNI[g]).join(", "))}${errore ? ` · <span class="bt-err">${esc(errore)}</span>` : ""}</p>`
    + `<p><b>Prossimo</b> ${b.acceso ? (b.prossimo ? esc(ora(b.prossimo)) : "nessuno in vista") : "spento"}</p>`
    + `<p><b>Ultimo scatto</b> ${u ? `${esc(ora(u.t))} · ${esc(u.esito)}${u.nota ? ` <span class="bt-m">(${esc(u.nota)})</span>` : ""}` : "mai"}</p>`
    + `<p><b>Ultima proposta</b> ${ultima ? `«${esc(ultima.testo)}» <span class="bt-m">${esc(ultima.stato || "")}</span>` : "nessuna"}</p>`
    + '<div class="bt-azioni"><button type="button" data-domande>Da decidere</button></div></div>';
}

async function carica() {
  try {
    const [b, p] = await Promise.all([api("GET", "/api/battito"), api("GET", "/api/proposte")]);
    stato = b.battito; proposte = p;
  } catch { /* resta l'ultimo stato */ }
  disegna();
}

function apriPannello(si) {
  const box = $("battito-pannello");
  box.hidden = !si;
  $("m-battito").setAttribute("aria-expanded", String(si));
  if (si) { errore = ""; disegna(); carica(); }
}

export function initBattito() {
  const box = $("battito-pannello"), bottone = $("m-battito");
  if (!box || !bottone) return;
  bottone.onclick = (e) => { e.stopPropagation(); apriPannello(box.hidden); };
  box.addEventListener("click", (e) => {
    e.stopPropagation();
    if (e.target.closest("[data-domande]")) { apriPannello(false); apriDomande(); }
  });
  box.addEventListener("change", async (e) => {
    if (!e.target.matches("[data-acceso]")) return;
    try { stato = (await api("POST", "/api/battito", { acceso: e.target.checked })).battito; errore = ""; } catch (x) { errore = x.message; }
    disegna();
  });
  box.addEventListener("submit", async (e) => {
    e.preventDefault();
    try { stato = (await api("POST", "/api/battito", { orari: e.target.orari.value })).battito; errore = ""; } catch (x) { errore = x.message; }
    disegna();
  });
  document.addEventListener("click", () => { if (!box.hidden) apriPannello(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !box.hidden) { e.stopPropagation(); apriPannello(false); } });
  su("cockpit_proposte", (ev) => { if (ev.battito) stato = ev.battito; if (ev.attuale !== undefined) proposte = ev; disegna(); });
}
