// Sessioni e chat: il rendering dei turni (l'assistente, la sessione aperta a destra della mappa), il conteggio degli agenti
// in testata, gli eventi delle sessioni (una funzione per tipo, registrate con su() di condivisi/eventi.js), l'invio dei
// messaggi, il nuovo agente e le schede su schermi stretti.
import { coda, prendiAllegati } from "./allegati.js";
import { aggiornaPallini, staccaFogli } from "./agenti-foglio.js";
import { cerchioContesto } from "./contesto.js";
import { htmlCopia } from "./copia.js";
import { aggiornaFumetti } from "./fumetti.js";
import {
  $, NOMI_TOOL, RICARICA, S, STATO, assistente, autoAltezza, mostraBanner, nascondiBanner, md, nomeSessione, selettoreModello,
} from "./comune.js";
import { rendiTimerPannello } from "./timer.js";
import { aggiornaOrb } from "./sonar.js";
import { mostraFoto } from "./volti.js";
import { api } from "/condivisi/api.js";
import { su } from "/condivisi/eventi.js";
import { durata, esc } from "/condivisi/formati.js";
import { collegaAzioni, domandeDi, htmlDomanda, segnaLimite, suDomande } from "/condivisi/domande.js";
import { stileColore } from "/condivisi/colori.js";
import { memo } from "/condivisi/memo.js";
import { ferma, sbloccaVoce, stato as statoVoce } from "/condivisi/voce-motore.js";

// ---- esempi della schermata iniziale ------------------------------------------------------
// Quelli del nucleo sono generici; i moduli ne aggiungono di propri con registraEsempi.
const ESEMPI = ["Cosa stanno facendo gli agenti?"];
function registraEsempi(lista) {
  for (const e of lista) if (!ESEMPI.includes(e)) ESEMPI.push(e);
  if (S.orchestratore) rendiOrchestratore();
}

// ---- rendering dei messaggi -------------------------------------------------------------
function sintesiTool(nome, input = {}) {
  const i = input || {};
  const v = i.command || i.file_path || i.pattern || i.description || i.url || i.query || i.prompt || i.path || i.skill || "";
  if (v) return String(v).replace(/\s+/g, " ");
  const k = Object.keys(i)[0];
  return k ? `${k}: ${JSON.stringify(i[k])}`.slice(0, 200) : "";
}

// la riga di uno strumento col suo risultato non cambia più: si tiene (l'input e l'output possono essere lunghi)
const righeTool = new WeakMap();
function rigaTool(b, risultati) {
  const r = risultati.get(b.id), tenuta = r && righeTool.get(b);
  if (tenuta && tenuta.r === r) return tenuta.html;
  const html = htmlRigaTool(b, r);
  if (r) righeTool.set(b, { r, html });
  return html;
}
function htmlRigaTool(b, r) {
  const ic = !r ? '<span class="ic run">◌</span>' : r.errore ? '<span class="ic ko">✕</span>' : '<span class="ic ok">✓</span>';
  const input = JSON.stringify(b.input, null, 2);
  const corto = input.length > 4000 ? `${input.slice(0, 4000)}\n…` : input;
  return `<details class="tool" data-k="t-${esc(b.id)}"><summary>${ic}<span class="tn">${esc(NOMI_TOOL[b.name] || b.name)}</span>`
    + `<span class="ta">${esc(sintesiTool(b.name, b.input))}</span></summary>`
    + `<div class="dett"><pre>${esc(corto)}</pre>${r ? `<pre>${esc(r.testo || "(nessun output)")}</pre>` : ""}</div></details>`;
}
const nomeFile = (a) => esc(a.split("/").pop().replace(/^[a-z0-9]+-/, ""));
const chipAllegati = (l) => (l && l.length ? `<div class="allegati-msg">${l.map((a) => `<span class="chip-file">${nomeFile(a)}</span>`).join("")}</div>` : "");

// Gli eventi di una sessione raggruppati in turni: un turno = dal tuo messaggio alla fine.
function raggruppaTurni(ev) {
  const risultati = new Map();
  for (const e of ev) if (e.type === "risultati") for (const r of e.risultati) risultati.set(r.id, r);
  const turni = [];
  let cur = null;
  for (const e of ev) {
    if (e.type === "cockpit_utente") { cur = { utente: e, blocchi: [], fine: null, errori: [], t0: e.t }; turni.push(cur); }
    else if (!cur) { cur = { utente: null, blocchi: [], fine: null, errori: [], t0: e.t }; turni.push(cur); }
    if (e.type === "assistant") {
      for (const b of e.blocchi) if (b.type === "tool_use" || (b.type === "text" && b.text.trim())) cur.blocchi.push(b);
    } else if (e.type === "fine") { cur.fine = e; cur = null; }
    else if (e.type === "cockpit_errore") cur.errori.push(e.testo);
  }
  return { turni, risultati };
}

// Il markdown di un blocco si converte una volta sola: i blocchi in S.eventi non cambiano più dopo l'arrivo.
const mdCache = new WeakMap();
function mdBlocco(b) {
  let h = mdCache.get(b);
  if (h === undefined) { h = md(b.text); mdCache.set(b, h); }
  return h;
}

// Il blocco «Reasoning…» di un turno: i testi intermedi e gli strumenti, chiusi sotto un titolo.
function htmlRagionamento(tu, n, passi, inCorso, live, risultati) {
  const strumenti = passi.filter((b) => b.type === "tool_use").length;
  const etichetta = inCorso ? '<span class="spin"></span>Reasoning…' : "See reasoning";
  const meta = [strumenti ? `${strumenti} ${strumenti === 1 ? "passaggio" : "passaggi"}` : "", tu.fine ? durata(tu.fine.durata_ms) : ""]
    .filter(Boolean).join(" · ");
  const corpo = passi.map((b) => (b.type === "tool_use" ? rigaTool(b, risultati) : `<div class="md passo">${mdBlocco(b)}</div>`)).join("")
    + (inCorso && live && live.testo ? `<div class="md passo">${md(live.testo)}<span class="cursore"></span></div>` : "")
    || '<div class="meta">Sta leggendo il contesto…</div>';
  return `<details class="ragiona${inCorso ? " vivo" : ""}" data-k="r-${n}"><summary>${etichetta}${meta ? `<span class="rm">${meta}</span>` : ""}</summary>`
    + `<div class="passi">${corpo}</div></details>`;
}

// L'html di un turno: il tuo messaggio, il «Reasoning…», la risposta finale, gli errori e le domande nate nel turno.
// Un turno chiuso non cambia più (salvo le domande, aggiunte a parte): il suo html si tiene, legato all'evento «fine».
const turniChiusi = new WeakMap();
function htmlTurno(turni, n, ctx) {
  const tu = turni[n];
  let corpo = tu.fine ? turniChiusi.get(tu.fine) : undefined;
  if (corpo === undefined) {
    corpo = htmlCorpoTurno(turni, n, ctx);
    if (tu.fine) turniChiusi.set(tu.fine, corpo);
  }
  const parti = [corpo];
  // dal primo turno, non da sempre: dopo «Nuova conversazione» la sessione ha lo stesso id e le domande vecchie restano sue
  const da = n === 0 ? tu.t0 ?? -Infinity : tu.t0 || 0, a = n + 1 < turni.length ? turni[n + 1].t0 || Infinity : Infinity;
  for (const q of ctx.domande) { const t = Date.parse(q.creata); if (t >= da && t < a) parti.push(htmlDomanda(q, { chat: true })); }
  return parti.join("");
}
function htmlCorpoTurno(turni, n, ctx) {
  const tu = turni[n], parti = [];
  const ultimo = n === turni.length - 1;
  if (tu.utente) {
    parti.push(tu.utente.nota ? `<div class="nota"><i></i>${esc(tu.utente.nota)}</div>`
      : `<div class="msg utente"><div class="bolla">${tu.utente.testo ? esc(tu.utente.testo) : ""}${chipAllegati(tu.utente.allegati)}</div></div>`);
  }
  const inCorso = !tu.fine && ultimo && ctx.vivo && !tu.errori.length;
  // la risposta finale: i testi dopo l'ultimo strumento, solo a turno chiuso
  let k = tu.blocchi.length;
  if (!inCorso) while (k > 0 && tu.blocchi[k - 1].type === "text") k--;
  const passi = tu.blocchi.slice(0, k), finale = tu.blocchi.slice(k);
  if (passi.length || inCorso) parti.push(htmlRagionamento(tu, n, passi, inCorso, ctx.live, ctx.risultati));
  for (const b of finale) parti.push(`<div class="msg md">${mdBlocco(b)}</div>`);
  if (!inCorso) parti.push(htmlCopia(finale)); // «Copia» col markdown della risposta, solo a turno chiuso (copia.js)
  for (const e of tu.errori) parti.push(`<div class="err">${esc(e)}</div>`);
  if (tu.fine && tu.fine.errore) parti.push(`<div class="err">${esc(tu.fine.testo || "Il turno si è chiuso con un errore.")}</div>`);
  return parti.join("");
}

// Si vede la risposta finale; tutto ciò che c'è prima (testi intermedi e strumenti) sta chiuso sotto "Reasoning…" / "See reasoning".
// Il ridisegno è incrementale: ogni turno è un suo elemento (.turno, display:contents) e si rifà solo se il suo html è cambiato;
// si vedono gli ultimi TURNI_VISIBILI turni, «Mostra i turni precedenti» ne aggiunge altrettanti (la cronologia dell'assistente
// arriva a migliaia di eventi: ricostruirla tutta a ogni evento bloccava la pagina per secondi, analisi).
const TURNI_VISIBILI = 60;
function rendiSessione(id, contenitore) {
  const { turni, risultati } = raggruppaTurni(S.eventi.get(id) || []);
  const s = S.sessioni.get(id);
  const ctx = { vivo: s && (s.stato === "lavora" || s.stato === "avvio"), live: S.live.get(id), risultati, domande: domandeDi(id) };
  let R = contenitore._chat;
  if (!R || R.id !== id) { contenitore.innerHTML = ""; R = contenitore._chat = { id, quanti: TURNI_VISIBILI, pezzi: new Map() }; }
  const primo = Math.max(0, turni.length - R.quanti);
  const nuovi = [];
  if (primo) nuovi.push({ k: "prima", html: `<button type="button" class="btn leggero turni-prima" data-prima>Mostra i turni precedenti (${primo})</button>` });
  for (let n = primo; n < turni.length; n++) nuovi.push({ k: n, html: htmlTurno(turni, n, ctx) });

  const flusso = contenitore.parentElement;
  const inFondo = flusso.scrollHeight - flusso.scrollTop - flusso.clientHeight < 80;
  const fuoco = document.activeElement?.closest?.("[data-dq]")?.dataset.dq;
  const tenuti = new Set();
  nuovi.forEach(({ k, html }, i) => {
    const vecchio = R.pezzi.get(k);
    let el = vecchio?.el;
    if (!vecchio || vecchio.html !== html) {
      el = document.createElement("div");
      el.className = "turno";
      el.innerHTML = html;
      if (vecchio) {
        // i riquadri aperti e una risposta che si sta scrivendo in una domanda sopravvivono al ridisegno del turno
        const aperti = new Set([...vecchio.el.querySelectorAll("details[open]")].map((d) => d.dataset.k));
        el.querySelectorAll("details[data-k]").forEach((d) => { if (aperti.has(d.dataset.k)) d.open = true; });
        const scritte = new Map([...vecchio.el.querySelectorAll("[data-dq] .dq-lib")].filter((x) => x.value)
          .map((x) => [x.closest("[data-dq]").dataset.dq, x.value]));
        for (const q of el.querySelectorAll("[data-dq]")) {
          const lib = q.querySelector(".dq-lib");
          if (!lib) continue;
          if (scritte.has(q.dataset.dq)) { lib.value = scritte.get(q.dataset.dq); segnaLimite(lib); }
          if (fuoco === q.dataset.dq) lib.focus();
        }
        vecchio.el.replaceWith(el);
      }
      R.pezzi.set(k, { html, el });
    }
    tenuti.add(k);
    if (contenitore.children[i] !== el) contenitore.insertBefore(el, contenitore.children[i] || null);
  });
  for (const [k, p] of R.pezzi) if (!tenuti.has(k)) { p.el.remove(); R.pezzi.delete(k); }
  if (inFondo) flusso.scrollTop = flusso.scrollHeight;
  return turni.length;
}
// «Mostra i turni precedenti»: la finestra si allarga e la vista resta dov'era
function mostraPrecedenti(e) {
  const b = e.target.closest?.("[data-prima]"), contenitore = e.currentTarget, R = contenitore._chat;
  if (!b || !R) return;
  const flusso = contenitore.parentElement, h = flusso.scrollHeight;
  R.quanti += TURNI_VISIBILI;
  rendiSessione(R.id, contenitore);
  flusso.scrollTop += flusso.scrollHeight - h;
}
const azzeraChat = (contenitore) => { contenitore._chat = null; };

let jDaRifare = false;
function rendiOrchestratore() {
  if (!S.orchestratore) return;
  const sj = S.sessioni.get(S.orchestratore);
  // non si ridisegna sotto il dito mentre si sceglie
  if (sj && !document.activeElement?.classList?.contains("sel-modello")) $("j-modello").innerHTML = selettoreModello(sj);
  $("j-contesto").innerHTML = cerchioContesto(sj);
  // la colonna dell'assistente sta in .centro, nascosta con la mappa accesa: non si ridisegna finché non si vede
  if (!$("msg-j").checkVisibility()) { jDaRifare = true; return; }
  jDaRifare = false;
  const n = rendiSessione(S.orchestratore, $("msg-j"));
  if (n) return;
  azzeraChat($("msg-j"));
  $("msg-j").innerHTML = `<div class="benvenuto"><h1>Cosa facciamo?</h1><p>${esc(assistente.nome)} coordina gli agenti: gli affidi un compito, `
    + "lui lo passa a un agente che lavora in parallelo, e ti dice a che punto sono.</p>"
    + `<div class="esempi">${ESEMPI.map((e) => `<button>${esc(e)}</button>`).join("")}</div></div>`;
  $("msg-j").querySelectorAll(".esempi button").forEach((b) => {
    b.onclick = () => { $("in-j").value = b.textContent; aggiornaInvia(); inviaOrchestratore(); };
  });
}

// in testata: quanti agenti, quanti al lavoro, quanti ti aspettano; e il pallino di ogni foglio segue la sessione del suo agente
function rendiStat() {
  const agenti = [...S.sessioni.values()].filter((s) => s.ruolo !== "orchestratore");
  const attivi = agenti.filter((s) => s.stato === "lavora" || s.stato === "avvio").length;
  const attesa = agenti.filter((s) => s.stato === "attende" && s.nonLetti).length;
  aggiornaPallini();
  $("stat").textContent = `${agenti.length} agenti · ${attivi} al lavoro${attesa ? ` · ${attesa} ti aspettano` : ""}`;
}

function rendiPannello() {
  const s = S.aperta && S.sessioni.get(S.aperta);
  $("app").classList.toggle("con-sessione", !!s);
  if (!s) {
    $("p-contesto").innerHTML = "";
    $("p-nome").textContent = "Nessuna sessione";
    $("p-nome").classList.remove("pl-ag", "nome-ag"); $("p-nome").style.cssText = ""; $("p-volto").hidden = true;
    azzeraChat($("msg-s"));
    $("msg-s").innerHTML = '<div class="vuoto">Apri un agente dalla mappa: doppio clic sulla sua sfera.</div>';
    return;
  }
  $("p-nome").textContent = nomeSessione(s);
  // un ruolo della squadra col suo colore (condivisi/colori.js); gli altri come sempre
  const st = s.ruolo === "squadra" ? stileColore(s.nome) : "";
  $("p-nome").classList.toggle("pl-ag", !!st); $("p-nome").classList.toggle("nome-ag", !!st); $("p-nome").style.cssText = st; mostraFoto($("p-volto"), s.ruolo === "squadra" ? s.nome : "");
  $("p-meta").textContent = `${STATO[s.stato] || s.stato}${s.turni ? ` · ${s.turni} turni` : ""}`;
  if (!document.activeElement?.classList?.contains("sel-modello")) $("p-modello").innerHTML = selettoreModello(s);
  $("p-contesto").innerHTML = cerchioContesto(s);
  const turno = s.stato === "lavora" || s.stato === "avvio"; Object.assign($("p-ferma"), { disabled: !(turno || s.processo), textContent: turno || !s.processo ? "Ferma" : "Ricarica", title: turno ? "Interrompe il turno in corso" : RICARICA });
  $("p-rimuovi").style.display = s.ruolo === "orchestratore" || s.ruolo === "squadra" ? "none" : "";
  rendiSessione(s.id, $("msg-s"));
  rendiTimerPannello();
}

// ---- dati ------------------------------------------------------------------------------
async function caricaEventi(id) {
  if (S.caricati.has(id)) return;
  const j = await api("GET", `/api/sessioni/${id}/eventi`);
  S.eventi.set(id, j.eventi);
  S.caricati.add(id);
}

async function apri(id) {
  S.aperta = id;
  memo.set("aperta", id);
  aggiornaFumetti();
  vista("sessione");
  rendiStat(); rendiPannello();
  try { await caricaEventi(id); } catch (e) { mostraBanner(e.message, 5000); }
  rendiPannello();
  $("flusso-s").scrollTop = $("flusso-s").scrollHeight;
  api("POST", `/api/sessioni/${id}/letta`).catch(() => {});
}
function chiudi() {
  staccaFogli(false);
  S.aperta = null;
  memo.set("aperta", "");
  rendiStat(); rendiPannello();
  vista("mappa");
}

// ---- gli eventi del server: una funzione per tipo -----------------------------------------------
const daRendere = new Set();
let raf = 0;
function pianifica(id) {
  daRendere.add(id);
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    for (const i of daRendere) {
      if (i === S.orchestratore) { rendiOrchestratore(); aggiornaOrb(); }
      if (i === S.aperta) rendiPannello();
    }
    daRendere.clear();
  });
}

function sessioneAggiornata(ev) {
  const { id } = ev, prima = S.sessioni.get(id);
  S.sessioni.set(id, ev.sessione);
  if (ev.sessione.ruolo === "orchestratore") { S.orchestratore = id; aggiornaOrb(); }
  if (S.aperta === id && ev.sessione.nonLetti) api("POST", `/api/sessioni/${id}/letta`).catch(() => {});
  if (prima && prima.stato !== ev.sessione.stato && ev.sessione.stato !== "lavora") S.live.delete(id);
  rendiStat();
  pianifica(id); // un ridisegno per fotogramma, come gli altri eventi
  aggiornaFumetti();
}
// un evento che entra nella cronologia della sessione (se la cronologia è già caricata o è visibile)
function accumula(ev) {
  const { id } = ev;
  if (!S.caricati.has(id) && id !== S.orchestratore && S.aperta !== id) return;
  const lista = S.eventi.get(id) || [];
  lista.push(ev);
  S.eventi.set(id, lista);
  pianifica(id);
}
function fineParziale(ev) { // finito un tratto di testo o di turno: la risposta in streaming non serve più
  S.live.delete(ev.id);
  pianifica(ev.id);
}

function registraEventi() {
  collegaAzioni($("msg-j")); collegaAzioni($("msg-s")); // i pulsanti dei riquadri delle domande
  $("msg-j").addEventListener("click", mostraPrecedenti); $("msg-s").addEventListener("click", mostraPrecedenti);
  addEventListener("resize", () => { if (jDaRifare) pianifica(S.orchestratore); });
  suDomande(() => { if (S.orchestratore) pianifica(S.orchestratore); if (S.aperta) pianifica(S.aperta); });
  su("cockpit_sessione", sessioneAggiornata);
  su("cockpit_azzerata", (ev) => { S.eventi.set(ev.id, []); S.live.delete(ev.id); pianifica(ev.id); });
  su("cockpit_rimossa", (ev) => {
    S.sessioni.delete(ev.id);
    if (S.aperta === ev.id) chiudi();
    rendiStat();
  });
  su("delta", (ev) => {
    const l = S.live.get(ev.id) || { testo: "" };
    l.testo += ev.testo;
    S.live.set(ev.id, l);
    pianifica(ev.id);
  });
  su("delta_tool", fineParziale);
  su("delta_pensa", fineParziale);
  for (const tipo of ["cockpit_utente", "risultati"]) su(tipo, accumula);
  su("assistant", (ev) => { accumula(ev); S.live.delete(ev.id); });
  for (const tipo of ["fine", "cockpit_errore"]) su(tipo, (ev) => { accumula(ev); S.live.delete(ev.id); });

  // lo stream si è (ri)aperto: si rilegge lo stato delle sessioni, anche i turni chiusi mentre la pagina era chiusa
  su("_aperto", () => { riavvioDal = 0; ricarica(); });
  // durante un Riavvia (fino a un minuto) la caduta è attesa: niente «rilancialo»
  su("_errore", () => mostraBanner(Date.now() - riavvioDal < 60000
    ? "Riavvio in corso: mi ricollego da solo."
    : "Il server non risponde. Rilancialo con node plancia/server/server.mjs: mi ricollego da solo."));
}

// il selettore del modello del «Nuovo agente»: i modelli dal server, il primo è il predefinito
function popolaModelli() {
  $("n-modello").innerHTML = S.modelli.map((m) => `<option value="${esc(m.alias)}">${esc(m.nome)}</option>`).join("");
}

async function ricarica() {
  nascondiBanner();
  try {
    const j = await api("GET", "/api/sessioni");
    S.sessioni = new Map(j.sessioni.map((s) => [s.id, s]));
    aggiornaFumetti();
    if (Array.isArray(j.modelli) && j.modelli.length) { S.modelli = j.modelli; popolaModelli(); }
    S.orchestratore = j.sessioni.find((s) => s.ruolo === "orchestratore")?.id || null;
    S.caricati.clear();
    if (S.orchestratore) await caricaEventi(S.orchestratore);
    const ricorda = memo.get("aperta", "");
    if (S.aperta && !S.sessioni.has(S.aperta)) S.aperta = null;
    if (!S.aperta && ricorda && S.sessioni.has(ricorda) && innerWidth > 900) S.aperta = ricorda;
    if (S.aperta) await caricaEventi(S.aperta);
    rendiStat(); rendiOrchestratore(); rendiPannello(); aggiornaOrb();
    $("flusso-j").scrollTop = $("flusso-j").scrollHeight;
  } catch (e) { mostraBanner(e.message); }
}

// ---- invio ------------------------------------------------------------------------------
function aggiornaInvia() {
  $("go-j").disabled = !$("in-j").value.trim() && !coda.j.length;
  $("go-s").disabled = (!$("in-s").value.trim() && !coda.s.length) || !S.aperta;
}
async function inviaOrchestratore() {
  await S.primaDiInviare("in-j"); // una dettatura in corso lì si chiude con le ultime parole (ascolto.js)
  const t = $("in-j").value.trim();
  if ((!t && !coda.j.length) || !S.orchestratore) return false;
  const allegati = prendiAllegati("j");
  if (!allegati) return false;
  $("in-j").value = "";
  autoAltezza($("in-j"));
  aggiornaInvia();
  ferma(); // un tuo messaggio nuovo zittisce ciò che l'assistente sta dicendo
  sbloccaVoce();
  try { await api("POST", `/api/sessioni/${S.orchestratore}/messaggio`, { testo: t, allegati }); return true; } catch (e) {
    mostraBanner(e.message, 6000);
    $("in-j").value = t;
    aggiornaInvia();
    return false;
  }
}
async function inviaSessione() {
  await S.primaDiInviare("in-s");
  const t = $("in-s").value.trim();
  if ((!t && !coda.s.length) || !S.aperta) return false;
  const allegati = prendiAllegati("s");
  if (!allegati) return false;
  $("in-s").value = "";
  autoAltezza($("in-s"));
  aggiornaInvia();
  try {
    await caricaEventi(S.aperta);
    await api("POST", `/api/sessioni/${S.aperta}/messaggio`, { testo: t, allegati });
    return true;
  } catch (e) {
    mostraBanner(e.message, 6000);
    $("in-s").value = t;
    aggiornaInvia();
    return false;
  }
}
// schede su schermi stretti
function vista(v) {
  if (innerWidth > 900 && v === "sessione") v = "mappa"; // su schermo largo mappa e sessione stanno affiancate
  $("app").dataset.vista = v;
  document.querySelectorAll(".schede button").forEach((b) => b.setAttribute("aria-selected", b.dataset.v === $("app").dataset.vista));
  if (jDaRifare) pianifica(S.orchestratore);
}

function initModello() {
  document.addEventListener("change", async (e) => {
    const sel = e.target.closest?.(".sel-modello");
    if (!sel) return;
    sel.blur(); // così le viste si ridisegnano col valore nuovo (e con la nota «a fine turno», se c'è)
    try {
      const j = await api("POST", `/api/sessioni/${sel.dataset.m}/modello`, { modello: sel.value });
      S.sessioni.set(j.sessione.id, j.sessione);
    } catch (err) { mostraBanner(err.message, 5000); }
    rendiOrchestratore(); rendiPannello(); rendiStat();
  });
}

function initChat() {
  registraEventi();
  for (const [inp, go, fn] of [["in-j", "go-j", inviaOrchestratore], ["in-s", "go-s", inviaSessione]]) {
    $(inp).addEventListener("input", () => { autoAltezza($(inp)); aggiornaInvia(); });
    $(inp).addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); fn(); }
    });
    $(go).onclick = fn;
  }

  // nuovo agente
  $("apri-nuovo").onclick = () => {
    $("form-nuovo").classList.add("aperto");
    $("apri-nuovo").style.display = "none";
    $("n-nome").focus();
  };
  $("annulla-nuovo").onclick = () => {
    $("form-nuovo").classList.remove("aperto");
    $("apri-nuovo").style.display = "";
  };
  $("form-nuovo").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const j = await api("POST", "/api/sessioni", { nome: $("n-nome").value, compito: $("n-compito").value, modello: $("n-modello").value });
      S.sessioni.set(j.sessione.id, j.sessione);
      S.eventi.set(j.sessione.id, []);
      S.caricati.add(j.sessione.id);
      $("form-nuovo").reset();
      $("annulla-nuovo").onclick();
      apri(j.sessione.id);
    } catch (err) { mostraBanner(err.message, 5000); }
  };

  // pannello
  $("p-chiudi").onclick = chiudi;
  $("riavvia").onclick = riavvia;
  $("nuova").onclick = () => S.orchestratore && api("POST", `/api/sessioni/${S.orchestratore}/nuova`).catch((e) => mostraBanner(e.message, 5000));
  $("p-ferma").onclick = () => S.aperta && api("POST", `/api/sessioni/${S.aperta}/ferma`).catch((e) => mostraBanner(e.message, 5000));
  $("p-rimuovi").onclick = () => $("p-conferma").classList.add("aperta");
  $("p-conferma-no").onclick = () => $("p-conferma").classList.remove("aperta");
  $("p-conferma-si").onclick = async () => {
    $("p-conferma").classList.remove("aperta");
    try { await api("POST", `/api/sessioni/${S.aperta}/rimuovi`); } catch (e) { mostraBanner(e.message, 5000); }
  };
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && S.aperta && document.activeElement?.id !== "in-s" && !statoVoce().parlando) chiudi();
  });

  document.querySelectorAll(".schede button").forEach((b) => { b.onclick = () => vista(b.dataset.v); });
}

// il Riavvia: rilancia il server (le sessioni riprendono da dove erano); lo usa anche «Avvia» del primo avvio
let riavvioDal = 0;
async function riavvia() {
  try {
    riavvioDal = Date.now();
    await api("POST", "/api/riavvia");
    mostraBanner("Riavvio in corso: mi ricollego da solo.", 4000);
  } catch (e) { riavvioDal = 0; mostraBanner(e.message, 5000); }
}
export {
  aggiornaInvia, apri, caricaEventi, chiudi, initChat, initModello, inviaOrchestratore, inviaSessione, registraEsempi, rendiPannello,
  rendiStat, riavvia, vista,
};
