// Il foglio delle proposte del battito: la proposta dell'assistente, una alla volta, con Sì / No / Più tardi; sotto i contatori
// (fatte, accettate, rifiutate, ignorate) e l'interruttore del battito. Lo stato sta sul server (battito.mjs, GET /api/proposte)
// e arriva a tutte le schede con l'evento cockpit_proposte. Il foglio è un tipo a sé («proposte»), registrato qui con
// registraTipoFoglio. Una proposta nuova si annuncia col fumetto accanto alla sfera dell'assistente (fumetti.js legge
// propostaDaSegnalare); se è urgente la si dice anche a voce (il server non sa del calendario: l'urgenza la decide l'assistente,
// che lo guarda).
import { $, assistente, mostraBanner } from "./comune.js";
import { C, accendiFoglio, registraTipoFoglio, trovaFoglio, upsertFoglio } from "./fogli.js";
import { aggiornaFumetti } from "./fumetti.js";
import { M, vistaMappa } from "./mappa.js";
import { api } from "/condivisi/api.js";
import { su } from "/condivisi/eventi.js";
import { esc } from "/condivisi/formati.js";
import { memo } from "/condivisi/memo.js";
import { deveLeggere, diUrgente } from "/condivisi/voce-motore.js";

const PR = { stato: null, corpi: new Set() };
const NOMI = { si: "accettata", no: "rifiutata", ignorata: "ignorata", dopo: "rimandata", attesa: "in attesa" };
const giorno = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
const quando = (t) => {
  if (!t) return "";
  const d = new Date(t), oggi = new Date();
  const hh = d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === oggi.toDateString() ? `oggi alle ${hh}` : `${giorno[d.getDay()]} ${d.getDate()} alle ${hh}`;
};

async function carica() {
  try { PR.stato = await api("GET", "/api/proposte"); } catch (e) { PR.stato = { errore: e.message }; }
  rendiTutti();
  aggiornaFumetti();
}

// la proposta da annunciare col fumetto: in attesa e non ancora vista (aprire il foglio o la x la segnano vista)
function propostaDaSegnalare() {
  const p = PR.stato?.attuale;
  return p && p.stato === "attesa" && memo.get("proposta.vista", "") !== `${p.id}:${p.creata}` ? p : null;
}
function segnaVista() {
  const p = PR.stato?.attuale;
  if (p) memo.set("proposta.vista", `${p.id}:${p.creata}`);
  aggiornaFumetti();
}

// il corpo del foglio: fogli.js lo chiama al primo disegno e quando cambia titolo o contenuto
function rendiProposte(corpo) {
  PR.corpi.add(corpo);
  if (!PR.stato) carica(); else rendi(corpo);
}
function rendiTutti() {
  for (const c of PR.corpi) { if (!c.isConnected) PR.corpi.delete(c); else rendi(c); }
}
function htmlProposta(p, b) {
  if (!p) {
    const quandoRiparte = b.acceso ? ` ${esc(assistente.nome)} guarda di nuovo ${esc(quando(b.prossimo) || "al prossimo battito")}.` : " Il battito è spento.";
    return `<div class="foglio-vuota pr-vuota">Nessuna proposta in attesa.${quandoRiparte}</div>`;
  }
  return `<div class="pr-card${p.urgente ? " urgente" : ""}"><div class="pr-quando">${p.urgente ? "<b>urgente</b> · " : ""}${esc(quando(p.creata))}</div>`
    + `<p class="pr-testo">${esc(p.testo)}</p>${p.perche ? `<p class="pr-perche">${esc(p.perche)}</p>` : ""}`
    + '<div class="pr-azioni"><button class="toggle pr-si" data-r="si">Sì</button><button class="toggle" data-r="no">No</button>'
    + '<button class="toggle" data-r="dopo" title="Torna al prossimo battito">Più tardi</button></div></div>';
}
function htmlBattito(b) {
  const esito = b.ultimo?.esito === "inviato" ? `inviato a ${assistente.nome}` : b.ultimo?.esito;
  const ultimo = b.ultimo ? ` · ultimo: ${esc(b.ultimo.slot.slice(11))} ${esc(esito)}` : "";
  const titolo = "Ogni giorno feriale, agli orari, il server guarda i segnali senza modello e sveglia l'assistente solo se c'è qualcosa di nuovo";
  return `<label class="pr-battito" title="${titolo}"><input type="checkbox" role="switch" data-a="battito" ${b.acceso ? "checked" : ""}>`
    + ` Battito ${b.acceso ? "acceso" : "spento"}<span class="meta"> · alle ${esc(b.orari.join(", "))}${ultimo}</span></label>`;
}
function rendi(corpo) {
  const s = PR.stato;
  if (!s) { corpo.innerHTML = '<div class="foglio-vuota">Carico…</div>'; return; }
  if (s.errore) { corpo.innerHTML = `<div class="foglio-vuota">Non riesco a leggere le proposte: ${esc(s.errore)}.</div>`; return; }
  const p = s.attuale, c = s.contatori, b = s.battito;
  const conta = `<div class="pr-conta"><span><b>${c.fatte}</b> fatte</span><span><b>${c.accettate}</b> sì</span>`
    + `<span><b>${c.rifiutate}</b> no</span><span><b>${c.ignorate}</b> ignorate</span></div>`;
  const storia = s.recenti.filter((x) => x.stato !== "attesa").slice(0, 4)
    .map((x) => `<div class="pr-st"><i class="${esc(x.stato)}"></i>${esc(NOMI[x.stato] || x.stato)} · ${esc(x.testo)}</div>`).join("");
  corpo.innerHTML = `<div class="pr">${htmlProposta(p, b)}${conta}${storia ? `<div class="pr-storia">${storia}</div>` : ""}${htmlBattito(b)}</div>`;
  corpo.querySelectorAll("[data-r]").forEach((x) => { x.onclick = () => rispondi(p.id, x.dataset.r, x); });
  corpo.querySelector('[data-a="battito"]').onchange = (e) => interruttore(e.target.checked);
  if (p && M.on && corpo.offsetParent) segnaVista(); // il foglio è aperto davanti: la proposta è vista
}

async function rispondi(id, r, bottone) {
  corpoDisabilitato(true);
  try { await api("POST", `/api/proposte/${id}/${r}`); } catch (e) { mostraBanner(e.message, 5000); corpoDisabilitato(false); }
  if (bottone) bottone.blur();
}
function corpoDisabilitato(disabilita) {
  for (const c of PR.corpi) c.querySelectorAll("[data-r]").forEach((x) => { x.disabled = disabilita; });
}
async function interruttore(acceso) {
  try {
    const j = await api("POST", "/api/battito", { acceso });
    if (PR.stato) { PR.stato.battito = j.battito; rendiTutti(); }
    mostraBanner(acceso
      ? `Battito acceso: ${assistente.nome} si sveglia da solo agli orari, solo se c'è qualcosa di nuovo.` : "Battito spento.", 4000);
  } catch (e) { mostraBanner(e.message, 5000); rendiTutti(); }
}

// dall'evento cockpit_proposte: ogni cambio rimanda lo stato intero
function riceviProposte(ev) {
  PR.stato = { attuale: ev.attuale, contatori: ev.contatori, recenti: ev.recenti, battito: ev.battito };
  rendiTutti();
  aggiornaFumetti();
  const nuova = ev.azione === "nuova" || ev.azione === "ripresa";
  if (nuova && ev.proposta?.urgente && deveLeggere({ origine: "battito", urgente: true })) {
    diUrgente(`${assistente.nome} propone: ${ev.proposta.testo}`, `proposta:${ev.proposta.id ?? ev.proposta.testo}`);
  }
}

// il foglio: lo apre il fumetto o il pulsante «Battito»; se non c'è il server lo crea (uno solo)
const trovaProposte = () => [...C.dati.values()].find((x) => x.tipo === "proposte");
async function apriProposte() {
  try {
    const f = trovaProposte();
    if (f) { if (f.attiva === false) accendiFoglio(f.id, true); } else {
      const j = await api("POST", "/api/proposte/foglio");
      if (j.foglio) upsertFoglio(j.foglio, true);
    }
    if (!M.on) vistaMappa(true);
    const g = trovaProposte();
    if (g) trovaFoglio(g.id);
    segnaVista();
  } catch (e) { mostraBanner(`Battito: ${e.message}`, 5000); }
}

function initProposte() {
  registraTipoFoglio("proposte", { nome: () => `proposte di ${assistente.nome}`, disegna: (corpo) => rendiProposte(corpo) });
  su("cockpit_proposte", riceviProposte);
  $("m-battito")?.addEventListener("click", apriProposte);
  carica();
}

export { PR, apriProposte, initProposte, propostaDaSegnalare, segnaVista };
