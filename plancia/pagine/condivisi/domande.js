// La casella «Da decidere»: le domande che l'assistente, gli agenti e gli agenti di foglio fanno alla persona con
// `ctl.mjs domanda`, e le proposte del battito. Pulsante con il contatore nella barra comune (accanto a Consumo e Artifax),
// tendina in stile «notifiche» (una riga per domanda, bottoni a pillola, il resto dietro un tocco o l'ingranaggio); le stesse
// righe tornano nella chat e il cockpit mette il segno «?» sulla sfera.
// Lo stato sta sul server (server/domande.mjs, GET /api/domande) e arriva con l'evento cockpit_domande.
//
//   montaDomande(dopo, { assistente }) → il pulsante e la tendina, dopo l'elemento `dopo` della barra
//   apriDomande({ sessione })  → apre la tendina (filtrata su una sessione, se data)
//   D · suDomande(fn) · domandeDi(sessione) · aperteDi(sessione)  → per cockpit e chat
//   htmlDomanda(q, { chat })  · collegaAzioni(radice)              → la scheda di una domanda e i suoi pulsanti
//   limiteRisposta() · avvisoLunghezza(n) · segnaLimite(campo)     → il tetto della risposta a parole, che viene dal server
import { BASE, api } from "./api.js";
import { su } from "./eventi.js";
import { esc } from "./formati.js";
import { iniettaStile } from "./stile.js";
import { attrColore, caricaColori, coloreRuolo, stileColore, suColori } from "./colori.js";

export const D = { stato: null, battito: null, filtro: "", nomi: new Map() };
const ascoltatori = new Set();
export const suDomande = (fn) => { ascoltatori.add(fn); return () => ascoltatori.delete(fn); };
const avvisa = (ev) => { for (const fn of ascoltatori) { try { fn(ev); } catch (e) { console.error("domande:", e); } } };

const tutte = () => (D.stato ? [...D.stato.aperte, ...(D.stato.chiuse || [])] : []);
export const aperteDi = (sessione) => (D.stato?.aperte || []).filter((q) => q.da.sessione === sessione);
export const domandeDi = (sessione) => tutte().filter((q) => q.da.sessione === sessione).sort((a, b) => a.creata.localeCompare(b.creata));

let caricando = null;
export function caricaDomande() {
  caricando ??= api("GET", "/api/domande")
    .then((j) => { D.stato = j; avvisa({ azione: "carica" }); })
    .catch(() => {})
    .finally(() => { caricando = null; });
  return caricando;
}

// ---- il tetto della risposta a parole: uno solo, lo dà il server ----------------------------------------
// Il campo non ha maxlength: il browser taglierebbe in silenzio ciò che si incolla o si detta. Oltre il tetto si avvisa, non si
// manda e il testo resta lì. Un server acceso da prima non dà il tetto e taglierebbe a questo numero: ci si ferma lì.
const TAGLIO_SERVER_VECCHIO = 280;
export const limiteRisposta = () => D.stato?.limiti?.libera || TAGLIO_SERVER_VECCHIO;
export function avvisoLunghezza(n) {
  const max = limiteRisposta();
  if (n <= max) return "";
  return D.stato?.limiti?.libera ? `${n} battute, il massimo è ${max}: accorcia, il testo resta qui.`
    : `${n} battute, il server acceso ne prende ${max}: accorcia, o fai il Riavvia. Il testo resta qui.`;
}
export function segnaLimite(campo) {
  const conta = campo?.closest(".dq-scrivi")?.querySelector(".dq-conta");
  if (!conta) return;
  const n = campo.value.trim().length, max = limiteRisposta(), avviso = avvisoLunghezza(n);
  conta.textContent = avviso || (n > max * 0.8 ? `${n} di ${max} battute` : "");
  conta.classList.toggle("oltre", !!avviso);
}

// ---- tempo e nomi ------------------------------------------------------------------------------------
function daQuanto(t) {
  const m = Math.round((Date.now() - Date.parse(t)) / 60000);
  if (m < 1) return "adesso";
  if (m < 60) return `${m} min fa`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h fa` : new Date(t).toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "numeric" });
}
const oraDi = (t) => (t ? new Date(t).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : "");
const iniziale = (q) => (q.da.ruolo === "orchestratore" ? "" : (String((q.da.ruolo === "squadra" && coloreRuolo(q.da.nome)?.nome) || q.da.nome).replace(/^foglio[-\s]*/i, "")[0] || "?").toUpperCase());

// ---- una domanda, stile «notifiche» (scelto): una riga corta, i bottoni a pillola sotto ----------
// Chi chiede è una sferetta col colore del ruolo (come sulla mappa; un agente della squadra col colore del suo ruolo,
// condivisi/colori.js, e il nome del ruolo al posto dello slug); un tocco sulla domanda mostra chi, quando e i collegamenti;
// sotto la domanda il «Perché te lo chiedo», chiuso, che si apre con un clic: le righe
// di contesto scritte da chi chiede (o il perché di una proposta), o quella ricavata dal compito, detta come tale;
// la matita apre la risposta a parole. Lo stato «aperto», «perché» e «scrive» di ogni domanda sopravvive ai ridisegni.
const aperti = new Set(), scrive = new Set(), perche = new Set();
function htmlPerche(q) {
  const righe = [q.perche, ...String(q.contesto || "").split("\n")].map((x) => String(x || "").trim()).filter(Boolean);
  if (!righe.length) return "";
  const nota = q.contestoRicavato ? '<span class="dq-pm">Chi chiede non l\'ha scritto: è ricavato dal suo lavoro.</span>' : "";
  const su = perche.has(q.id);
  return `<div class="dq-pq${su ? " su" : ""}"><button type="button" class="dq-pb" data-perche aria-expanded="${su}">Perché te lo chiedo</button>`
    + `<div class="dq-pc">${righe.map((r) => `<p>${esc(r)}</p>`).join("")}${nota}</div></div>`;
}
export function htmlDomanda(q, { chat = false } = {}) {
  const chiusa = q.stato !== "aperta" && q.stato !== "rimandata";
  const sq = q.da.ruolo === "squadra" ? q.da.nome : "", col = stileColore(sq), chi = coloreRuolo(sq)?.nome || q.da.nome;
  const sfera = `<span class="dq-sfera r-${esc(q.da.ruolo)}${col ? " pl-ag" : ""}${q.urgente && !chiusa ? " urgente" : ""}"${col ? ` style="${col}"` : ""} title="${esc(chi)}" aria-label="${esc(chi)}${q.urgente ? ", urgente" : ""}">${esc(iniziale(q))}</span>`;
  const link = [
    !chat && q.da.sessione ? '<button type="button" class="dq-l" data-chat>Apri la chat</button>' : "",
    q.foglio ? '<button type="button" class="dq-l" data-foglio>Apri il foglio</button>' : "",
    !chiusa && q.tipo !== "proposta" ? '<button type="button" class="dq-l muto" data-ritira>Togli</button>' : "",
  ].join("");
  const det = `<div class="dq-det"><span class="dq-chi">${col ? `<b${attrColore(sq)}>${esc(chi)}</b>` : esc(chi)}, ${daQuanto(q.creata)}${q.tipo === "testo" ? ", l'ha scritta senza il comando" : ""}</span>`
    + `${link ? `<span class="dq-ls">${link}</span>` : ""}</div>`;
  let corpo;
  if (chiusa) {
    const come = q.stato === "risposta" ? `Hai risposto <b>${esc(q.risposta)}</b>${q.come === "chat" ? " in chat" : ""}` : q.stato === "ignorata" ? "Rimasta senza risposta" : "Tolta";
    corpo = `<div class="dq-esito">${come}<span class="dq-m"> ${oraDi(q.chiusa)}</span></div>`;
  } else {
    const pillole = q.opzioni.map((o, i) => `<button type="button" class="dq-b${i === 0 ? " pr" : ""}" data-r="${esc(o)}">${esc(o)}</button>`).join("");
    const matita = q.tipo === "proposta" ? "" : `<button type="button" class="dq-b ico" data-scrivi title="Rispondi a parole" aria-label="Rispondi a parole">${q.opzioni.length ? "✎" : "✎ Rispondi"}</button>`;
    corpo = `<div class="dq-op">${pillole}${matita}</div>`
      + `<div class="dq-scrivi"><textarea class="dq-lib" rows="2" placeholder="Scrivi la risposta" aria-label="Risposta a: ${esc(q.testo)}"></textarea><button type="button" class="dq-manda" data-manda>Manda</button><span class="dq-conta" role="status"></span></div>`;
  }
  const classi = ["dq", q.tipo, chiusa ? "chiusa" : "", chat ? "in-chat" : "", aperti.has(q.id) ? "aperto" : "", scrive.has(q.id) && !chiusa ? "scrive" : ""].filter(Boolean).join(" ");
  return `<div class="${classi}" data-dq="${esc(q.id)}" data-sessione="${esc(q.da.sessione)}" data-foglio-id="${esc(q.foglio || "")}">${sfera}`
    + `<div class="dq-corpo"><p class="dq-t" role="button" tabindex="0" data-dettagli title="Tocca per chi la fa e i collegamenti">${esc(q.testo)}</p>${htmlPerche(q)}${det}${corpo}</div></div>`;
}

// ---- le azioni: un solo ascoltatore per contenitore ---------------------------------------------------
function apriChat(sessione) {
  if (location.pathname.startsWith("/cockpit")) dispatchEvent(new CustomEvent("plancia:apri-chat", { detail: { sessione } }));
  else location.href = `${BASE}/cockpit#chat=${encodeURIComponent(sessione)}`;
}
function apriFoglio(id) {
  if (location.pathname.startsWith("/cockpit")) dispatchEvent(new CustomEvent("plancia:apri-foglio", { detail: { id } }));
  else location.href = `${BASE}/cockpit#foglio=${encodeURIComponent(id)}`;
}
async function rispondi(id, risposta, come, el) {
  el?.querySelectorAll("button, textarea").forEach((x) => { x.disabled = true; });
  try {
    await api("POST", `/api/domande/${encodeURIComponent(id)}/risposta`, { risposta, come });
    scrive.delete(id); aperti.delete(id);
    if (el && !el.classList.contains("in-chat")) { el.classList.add("via"); await new Promise((r) => setTimeout(r, 220)); }
    await caricaDomande();
  } catch (e) { el?.querySelectorAll("button, textarea").forEach((x) => { x.disabled = false; }); alertino(el, e.message); }
}
function mandaLibera(el) {
  const campo = el.querySelector(".dq-lib"), v = campo?.value.trim();
  if (!v) return;
  if (avvisoLunghezza(v.length)) { segnaLimite(campo); campo.focus(); return; }
  rispondi(el.dataset.dq, v, "libera", el);
}
function alertino(el, testo) {
  if (!el) return;
  let m = el.querySelector(".dq-err");
  if (!m) { m = document.createElement("p"); m.className = "dq-err"; el.append(m); }
  m.textContent = testo;
}
export function collegaAzioni(radice) {
  if (!radice || radice.dataset.dqCollegata) return;
  radice.dataset.dqCollegata = "1";
  const azione = (e) => {
    const el = e.target.closest("[data-dq]");
    if (!el || !radice.contains(el)) return false;
    const id = el.dataset.dq;
    const b = e.target.closest("[data-r]");
    if (b) { rispondi(id, b.dataset.r, "opzione", el); return true; }
    if (e.target.closest("[data-chat]")) { apriChat(el.dataset.sessione); return true; }
    if (e.target.closest("[data-foglio]")) { apriFoglio(el.dataset.foglioId); return true; }
    if (e.target.closest("[data-ritira]")) {
      api("POST", `/api/domande/${encodeURIComponent(id)}/ritira`, {}).then(caricaDomande).catch((x) => alertino(el, x.message));
      return true;
    }
    const pb = e.target.closest("[data-perche]");
    if (pb) {
      (perche.has(id) ? perche.delete(id) : perche.add(id));
      const su = pb.parentElement.classList.toggle("su"); pb.setAttribute("aria-expanded", String(su)); return true;
    }
    if (e.target.closest("[data-dettagli]")) { (aperti.has(id) ? aperti.delete(id) : aperti.add(id)); el.classList.toggle("aperto"); return true; }
    if (e.target.closest("[data-scrivi]")) {
      (scrive.has(id) ? scrive.delete(id) : scrive.add(id)); el.classList.toggle("scrive");
      if (el.classList.contains("scrive")) el.querySelector(".dq-lib")?.focus();
      return true;
    }
    if (e.target.closest("[data-manda]")) { mandaLibera(el); return true; }
    return false;
  };
  radice.addEventListener("click", (e) => { if (azione(e)) e.stopPropagation(); });
  radice.addEventListener("input", (e) => { if (e.target.matches?.(".dq-lib")) segnaLimite(e.target); });
  radice.addEventListener("keydown", (e) => {
    const lib = e.target.closest?.(".dq-lib");
    if (lib && e.key === "Enter" && !e.shiftKey && !e.isComposing && lib.value.trim()) { e.preventDefault(); mandaLibera(lib.closest("[data-dq]")); return; }
    if ((e.key === "Enter" || e.key === " ") && e.target.closest("[data-dettagli], a[role=button]")) { e.preventDefault(); azione(e); }
  });
}

// ---- il pulsante e la tendina nella barra --------------------------------------------------------------
// In vista solo le domande; interruttori, risposte di oggi e contatori stanno dietro l'ingranaggio.
let tendina = null, aperta = 0, menu = false;
function htmlMenu(s) {
  const b = D.battito, c = s.contatori;
  const oggi = new Date().toDateString();
  const chiuseOggi = (s.chiuse || []).filter((q) => q.chiusa && new Date(q.chiusa).toDateString() === oggi && q.stato === "risposta").slice(0, 6);
  const interruttore = (attr, acceso, testo) => `<label class="dq-int"><span>${testo}</span><input type="checkbox" role="switch" ${attr} ${acceso ? "checked" : ""}></label>`;
  return `<div class="dq-menu">${interruttore("data-chiude", s.impostazioni.chiudeConChat, "Una risposta in chat chiude le domande dell'agente")}`
    + (b ? interruttore("data-battito", b.acceso, `Battito ${D.assistente ? `di ${esc(D.assistente)}` : "dell'assistente"}, alle ${esc((b.orari || []).join(", "))}`) : "")
    + (s.rimandate?.length ? `<p class="dq-m">Rimandate al prossimo battito: ${s.rimandate.map((q) => esc(q.testo)).join("; ")}</p>` : "")
    + `<p class="dq-m">${chiuseOggi.length ? `Oggi hai risposto a ${chiuseOggi.length}: ${chiuseOggi.map((q) => `${esc(q.testo.slice(0, 50))} <b>${esc(q.risposta.length > 120 ? `${q.risposta.slice(0, 119)}…` : q.risposta)}</b>`).join("; ")}.` : "Oggi nessuna risposta."}`
    + ` In tutto ${c.fatte} domande, ${c.risposte} risposte, ${c.dalTesto} prese dal testo.</p></div>`;
}
function disegnaTendina() {
  if (!tendina) return;
  const s = D.stato, somm = tendina.querySelector("summary"), pop = tendina.querySelector(".pop");
  const aperte = s?.aperte || [], n = aperte.length, urgenti = aperte.some((q) => q.urgente);
  tendina.dataset.n = String(n);
  if (urgenti) tendina.dataset.urgente = ""; else delete tendina.dataset.urgente;
  somm.innerHTML = `${urgenti ? '<i class="dq-pulsa" aria-hidden="true"></i>' : ""}<span>Da decidere</span><b class="dq-n">${n}</b>`;
  somm.title = n ? `${n} ${n === 1 ? "domanda aspetta" : "domande aspettano"} una tua risposta${urgenti ? ", almeno una urgente" : ""}` : "Nessuna domanda aperta";
  somm.setAttribute("aria-label", somm.title);
  if (!tendina.open) return;
  if (!s) { pop.innerHTML = '<div class="dq-vuota"><b>Non le vedo ancora</b>Il server acceso non conosce le domande: serve il Riavvia.</div>'; return; }
  // il testo che si sta scrivendo sopravvive al ridisegno
  const scritte = new Map([...pop.querySelectorAll("[data-dq] .dq-lib")].filter((x) => x.value).map((x) => [x.closest("[data-dq]").dataset.dq, x.value]));
  const filtrate = D.filtro ? aperte.filter((q) => q.da.sessione === D.filtro || q.da.nome === D.filtro) : aperte;
  const nomeFiltro = D.filtro ? (aperte.find((q) => q.da.sessione === D.filtro)?.da.nome || D.filtro) : "";
  const filtro = D.filtro ? `<button type="button" class="dq-filtro" data-tutte title="Mostra tutte">${esc(nomeFiltro)} ✕</button>` : "";
  const testa = `<div class="dq-testa"><b>Da decidere</b>${filtro}<span class="sp"></span>`
    + `<button type="button" class="dq-ing${menu ? " su" : ""}" data-ing aria-expanded="${menu}" aria-label="Impostazioni e storia" title="Impostazioni e storia">${ICO_ING}</button></div>`;
  const lista = filtrate.length ? filtrate.map((q) => htmlDomanda(q)).join("")
    : `<div class="dq-vuota"><b>Niente da decidere</b>${D.filtro ? "Questo agente non ti chiede niente." : "Quando qualcuno ti chiede qualcosa, compare qui."}</div>`;
  pop.innerHTML = `${testa}${menu ? htmlMenu(s) : ""}<div class="dq-lista">${lista}</div>`;
  for (const [id, v] of scritte) { const i = pop.querySelector(`[data-dq="${id}"] .dq-lib`); if (i) { i.value = v; segnaLimite(i); } }
}
const ICO_ING = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';

export function apriDomande({ sessione = "" } = {}) {
  if (!tendina) return;
  D.filtro = sessione;
  aperta = Date.now(); // il clic che l'ha aperta (dalla mappa) non deve richiuderla subito
  tendina.open = true;
  disegnaTendina();
  tendina.querySelector("summary").focus();
}

export function montaDomande(dopo, { assistente = "" } = {}) {
  D.assistente = assistente;
  iniettaStile("pl-domande", CSS_DOMANDE);
  caricaColori(); suColori(() => avvisa({ azione: "colori" })); // i colori dei ruoli della squadra: ridisegna chi mostra le domande
  tendina = document.createElement("details");
  tendina.className = "domande"; tendina.id = "rdnav-domande";
  tendina.innerHTML = '<summary><span>Da decidere</span><b class="dq-n">·</b></summary><div class="pop dq-pop" role="dialog" aria-label="Da decidere"></div>';
  dopo.after(tendina);
  const pop = tendina.querySelector(".pop");
  collegaAzioni(pop);
  pop.addEventListener("click", (e) => {
    if (e.target.closest("[data-tutte]")) { D.filtro = ""; disegnaTendina(); }
    if (e.target.closest("[data-ing]")) { menu = !menu; disegnaTendina(); }
  });
  pop.addEventListener("change", async (e) => {
    if (e.target.matches("[data-chiude]")) {
      try { await api("POST", "/api/domande/impostazioni", { chiudeConChat: e.target.checked }); await caricaDomande(); } catch { disegnaTendina(); }
    }
    if (e.target.matches("[data-battito]")) {
      try { D.battito = (await api("POST", "/api/battito", { acceso: e.target.checked })).battito; } catch { /* resta com'era */ }
      disegnaTendina();
    }
  });
  tendina.addEventListener("toggle", () => {
    if (!tendina.open) { D.filtro = ""; menu = false; return; }
    disegnaTendina();
    caricaDomande();
    api("GET", "/api/battito").then((j) => { D.battito = j.battito; disegnaTendina(); }).catch(() => {});
  });
  // il percorso del clic, non il bersaglio: un pulsante che ridisegna la tendina (l'ingranaggio) non c'è più quando il clic arriva qui
  document.addEventListener("click", (e) => { if (tendina.open && Date.now() - aperta > 400 && !e.composedPath().includes(tendina)) tendina.open = false; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && tendina.open) { tendina.open = false; tendina.querySelector("summary").focus(); } });
  suDomande(disegnaTendina);
  su("cockpit_domande", (ev) => { avvisa(ev); caricaDomande(); });
  su("cockpit_proposte", (ev) => { if (ev.battito) { D.battito = ev.battito; disegnaTendina(); } });
  su("_aperto", caricaDomande); // lo stream lo apre la pagina (cockpit, bolla): qui solo ascolto, più un giro al minuto
  caricaDomande();
  setInterval(() => { if (!document.hidden) caricaDomande(); }, 60000);
  return tendina;
}

// ---- stile: colori dalla palette, nei due temi --------------------------------------------------------
export const CSS_DOMANDE = `
.rdnav details.domande summary{display:flex;align-items:center;gap:7px;white-space:nowrap;padding:5px 6px 5px 12px}
.rdnav details.domande .dq-n{min-width:22px;height:22px;display:grid;place-items:center;border-radius:999px;font-variant-numeric:tabular-nums;font-size:12px;font-weight:700;background:var(--pl-line2);color:var(--pl-text2)}
.rdnav details.domande:not([data-n="0"]) summary{color:var(--pl-text);border-color:var(--pl-coral);border-width:1.5px}
.rdnav details.domande:not([data-n="0"]) .dq-n{background:var(--pl-coral);color:#fff}
.dq-pulsa{width:8px;height:8px;border-radius:50%;background:var(--pl-coral);animation:dqp 1.4s ease-in-out infinite}
@keyframes dqp{50%{opacity:.25}}
.rdnav .dq-pop{width:min(420px,calc(100vw - 24px));max-height:min(74vh,660px);overflow:auto;padding:0;gap:0}
.dq-testa{display:flex;align-items:center;gap:8px;padding:10px 10px 8px 14px;position:sticky;top:0;background:var(--pl-deep);z-index:1}
.dq-testa b{font-size:14px}
.dq-testa .sp{flex:1}
.rdnav .pop .dq-ing,.dq-ing{all:unset;box-sizing:border-box;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;color:var(--pl-text2);cursor:pointer;border:1px solid transparent}
.dq-ing:hover,.dq-ing.su{border-color:var(--pl-line2);color:var(--pl-text)}
.dq-ing svg{width:16px;height:16px}
.rdnav .pop .dq-filtro,.dq-filtro{all:unset;cursor:pointer;font-size:12px;color:var(--pl-text2);border:1px solid var(--pl-line2);border-radius:999px;padding:2px 9px}
.dq-menu{display:grid;gap:9px;margin:0 10px 8px;padding:10px 12px;border-radius:12px;background:rgb(var(--pl-tinta-rgb) / .05);font-size:12.5px}
.rdnav .pop .dq-int,.dq-int{display:flex;align-items:center;justify-content:space-between;gap:12px;color:var(--pl-text2);cursor:pointer}
.dq-int input{accent-color:var(--pl-sonar);width:16px;height:16px;flex:none}
.dq-m{margin:0;color:var(--pl-muted);font-size:12px;line-height:1.45}
.dq-m b{color:var(--pl-text2);font-weight:600}
.dq-vuota{padding:28px 16px 30px;text-align:center;color:var(--pl-muted);font-size:12.5px}
.dq-vuota b{display:block;font-size:15px;color:var(--pl-text);margin-bottom:4px}
.dq-lista{padding:0 0 6px}

/* una domanda: sferetta + riga corta + pillole */
.dq{display:grid;grid-template-columns:auto 1fr;gap:10px;padding:11px 14px;border-top:1px solid var(--pl-line);color:var(--pl-text);transition:opacity .2s, transform .2s}
.dq.via{opacity:0;transform:translateX(18px)}
.dq-corpo{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;min-width:0}
.dq-sfera{--c:var(--pl-sand);position:relative;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;font:700 12.5px/1 system-ui,sans-serif;color:#fff;
  background:radial-gradient(circle at 34% 30%, color-mix(in srgb, var(--c) 45%, #fff) 0, var(--c) 50%, color-mix(in srgb, var(--c) 45%, #000) 100%);
  box-shadow:0 0 10px color-mix(in srgb, var(--c) 50%, transparent);margin-top:1px}
.dq-sfera.r-orchestratore{--c:var(--pl-sonar)}
.dq-sfera.r-orchestratore::before,.dq-sfera.r-orchestratore::after{content:"";position:absolute;top:36%;width:20%;height:20%;border-radius:50%;border:2px solid #fff;box-sizing:border-box}
.dq-sfera.r-orchestratore::before{left:22%}.dq-sfera.r-orchestratore::after{right:22%}
.dq-sfera.r-foglio{--c:var(--pl-violet)}
.dq-sfera.r-terminale{--c:var(--pl-muted)}
.dq-sfera.pl-ag{--c:var(--ag);color:var(--pl-su-sonar)}
.dq-chi .pl-ag{color:var(--ag);font-weight:600}
.dq-sfera.urgente{outline:2px solid var(--pl-coral);outline-offset:2px}
.dq-t{margin:0;font-weight:600;font-size:14.5px;line-height:1.35;cursor:pointer;align-self:center}
.dq-t:hover{color:var(--pl-sonar)}
.dq.testo .dq-t{color:var(--pl-text2)}
.dq-det{display:none;gap:4px;font-size:12.5px;color:var(--pl-text2);line-height:1.45}
.dq.aperto .dq-det{display:grid}
.dq-chi{color:var(--pl-muted);font-size:12px}
.rdnav .pop .dq-pb,.dq-pb{all:unset;cursor:pointer;font-size:12px;color:var(--pl-text2);display:inline-flex;align-items:center;gap:5px}
.dq-pb::before{content:"";width:0;height:0;border-left:5px solid currentColor;border-top:4px solid transparent;border-bottom:4px solid transparent;transition:transform .15s}
.dq-pq.su .dq-pb::before{transform:rotate(90deg)}
.dq-pb:hover{color:var(--pl-sonar)}
.dq-pb:focus-visible{outline:2px solid var(--pl-sonar);outline-offset:2px;border-radius:4px}
.dq-pc{display:none;margin:4px 0 2px;padding-left:10px;border-left:2px solid var(--pl-line2);font-size:12.5px;line-height:1.45;color:var(--pl-text2)}
.dq-pq.su .dq-pc{display:grid;gap:3px}
.dq-pc p{margin:0;overflow-wrap:anywhere}
.dq-pm{font-size:11.5px;color:var(--pl-muted);font-style:italic}
.dq-ls{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px}
.rdnav .pop .dq-l,.dq-l{all:unset;cursor:pointer;font-size:12px;color:var(--pl-sonar);border:1px solid var(--pl-line2);border-radius:999px;padding:3px 10px}
.dq-l.muto{color:var(--pl-muted)}
.dq-op{display:flex;flex-wrap:wrap;gap:7px}
.rdnav .pop .dq-b,.dq .dq-b{all:unset;box-sizing:border-box;cursor:pointer;font-size:14px;font-weight:600;line-height:1;color:var(--pl-text);border:1.5px solid var(--pl-line2);border-radius:999px;padding:9px 16px;background:rgb(var(--pl-tinta-rgb) / .03)}
.rdnav .pop .dq-b:hover,.dq .dq-b:hover{border-color:var(--pl-sonar)}
.rdnav .pop .dq-b.pr,.dq .dq-b.pr{background:var(--pl-sonar);border-color:var(--pl-sonar);color:var(--pl-su-sonar)}
.rdnav .pop .dq-b.ico,.dq .dq-b.ico{color:var(--pl-text2);font-weight:500;padding:9px 13px}
.dq .dq-b:focus-visible,.dq-l:focus-visible,.dq-ing:focus-visible,.dq-filtro:focus-visible{outline:2px solid var(--pl-sonar);outline-offset:2px}
.dq .dq-b:disabled{opacity:.5;cursor:default}
.dq-scrivi{display:none;gap:6px;flex-wrap:wrap}
.dq.scrive .dq-scrivi{display:flex}
.dq-conta{order:1;flex:1 1 0;align-self:center;font-size:12px;color:var(--pl-muted)}
.dq-conta:empty{display:none}
.dq-conta.oltre{color:var(--pl-critico)}
.dq-lib{flex:1 1 100%;min-width:0;font:inherit;font-size:13.5px;line-height:1.4;background:var(--pl-campo);border:1.5px solid var(--pl-line2);border-radius:14px;padding:8px 13px;color:var(--pl-text);resize:vertical;field-sizing:content;min-height:3.6em;max-height:40vh;overflow:auto}
.dq-lib:focus{outline:none;border-color:var(--pl-sonar)}
.rdnav .pop .dq-manda,.dq .dq-manda{all:unset;cursor:pointer;border-radius:999px;background:var(--pl-sonar);color:var(--pl-su-sonar);font-weight:600;font-size:13.5px;padding:9px 15px;order:2;margin-left:auto}
.dq-esito{font-size:13px;color:var(--pl-text2)}
.dq-esito b{color:var(--pl-text);white-space:pre-wrap;overflow-wrap:anywhere}
.dq-err{margin:0;color:var(--pl-critico);font-size:12px}

/* nella chat: la stessa riga, con il filo corallo a sinistra finché aspetta */
.dq.in-chat{border-top:0;border-left:3px solid var(--pl-coral);padding:4px 0 4px 12px;margin:10px 0}
.dq.in-chat.chiusa{border-left-color:var(--pl-line2)}
.dq.in-chat.chiusa .dq-t{font-weight:500;color:var(--pl-text2)}
@media (prefers-reduced-motion:reduce){.dq-pulsa{animation:none}.dq{transition:none}.dq-pb::before{transition:none}}
@media (max-width:900px){.rdnav details.domande summary span{display:none}}`;
