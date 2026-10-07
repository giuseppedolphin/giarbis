// Il cockpit, modulo comune: helper ($, md), banner, modelli, colori, lo stato condiviso fra moduli (S) e chi usa la pagina
// con il nome dell'assistente (da /api/chi, via condivisi/chi.js). Le chiamate al server, la memoria del browser e i formati
// stanno in condivisi/ (api.js, memo.js, formati.js): qui non si rifanno.
import { chi } from "/condivisi/chi.js";
import { esc } from "/condivisi/formati.js";

const $ = (id) => document.getElementById(id);
const md = (t) => {
  try { return DOMPurify.sanitize(marked.parse(String(t || ""), { gfm: true, breaks: true })); } catch { return `<p>${esc(t)}</p>`; }
};
const STATO = { ferma: "in pausa", avvio: "si avvia", lavora: "lavora", attende: "aspetta te", errore: "errore" };

// ---- stato condiviso fra i moduli ---------------------------------------------------------
// Tutti i campi sono dichiarati qui: un modulo non ne aggiunge a runtime.
const S = {
  sessioni: new Map(), // id → sessione, come la manda il server
  eventi: new Map(), // id → eventi caricati della sessione
  live: new Map(), // id → { testo } della risposta in streaming
  caricati: new Set(), // id delle sessioni di cui sono stati letti gli eventi
  aperta: null, // la sessione aperta nel pannello a destra
  orchestratore: null, // l'id della sessione dell'assistente
  modelli: [], // [{ alias, id, nome }] dal server (GET /api/sessioni)
  // Il turno in corso dell'assistente, per la voce (voce.js): chi l'ha aperto decide se si legge ad alta voce.
  turno: { id: 0, origine: "" },
};

// ---- chi usa la pagina e come si chiama l'assistente ----------------------------------------
// Oggetti dichiarati subito e riempiti da caricaChi(): chi li importa vede sempre i valori aggiornati.
const persona = { slug: "", nome: "" };
const assistente = { nome: "Assistente", slug: "assistente", chiamata: [], varianti: { prefissi: [], nomi: [] }, alias: [] };
const istanza = { modalita: "normale", moduli: [] };

async function caricaChi() {
  const c = await chi();
  Object.assign(persona, { slug: c.slug || "", nome: c.nome || "" });
  Object.assign(assistente, c.assistente);
  Object.assign(istanza, { modalita: c.modalita || "normale", moduli: c.moduli || [] });
  return c;
}
// vero se `nome` (di una sessione, di un mittente) è l'assistente: il suo nome, il suo slug o uno degli alias della config
const eAssistente = (nome) => {
  const n = String(nome || "").toLowerCase();
  return !!n && [assistente.nome, assistente.slug, ...assistente.alias].some((x) => String(x).toLowerCase() === n);
};
const nomeVisibile = (nome) => (eAssistente(nome) ? assistente.nome : String(nome ?? ""));
const nomeSessione = (s) => (s.ruolo === "orchestratore" ? assistente.nome : s.nome);

// ---- i modelli ---------------------------------------------------------------------------
// la lista arriva dal server (plancia/server/modelli.mjs) con le sessioni
const nomeModello = (m) => (S.modelli.find((x) => x.id === m || x.alias === m) || {}).nome || String(m || "");
// il selettore del modello di una sessione, piccolo: mostra quello attuale; se un cambio aspetta la fine del turno lo dice accanto
function selettoreModello(s) {
  const corrente = (S.modelli.find((x) => x.id === s.modello || x.alias === s.modello) || {}).alias;
  const opzioni = S.modelli.map((x) => `<option value="${esc(x.alias)}"${x.alias === corrente ? " selected" : ""}>${esc(x.nome)}</option>`).join("")
    + (corrente ? "" : `<option selected>${esc(s.modello)}</option>`);
  const lavora = s.stato === "lavora" || s.stato === "avvio";
  const titolo = `Modello di questa sessione. ${lavora ? "Sta lavorando: il cambio scatta a fine turno, senza interromperla. " : ""}La conversazione continua.`;
  return `<select class="toggle sel-modello" data-m="${esc(s.id)}" aria-label="Modello di ${esc(s.nome)}" title="${titolo}">${opzioni}</select>`
    + (s.modelloPendente
      ? `<span class="mod-pend" title="Il turno in corso non si interrompe">→ ${esc(nomeModello(s.modelloPendente))} a fine turno</span>` : "");
}

// ---- banner e piccoli aiuti ----------------------------------------------------------------
let bannerTimer;
function mostraBanner(t, ms) {
  const b = $("banner");
  b.textContent = t;
  b.classList.add("on");
  clearTimeout(bannerTimer);
  if (ms) bannerTimer = setTimeout(() => b.classList.remove("on"), ms);
}
function nascondiBanner() { $("banner").classList.remove("on"); }
const NOMI_TOOL = {
  Bash: "Comando", Read: "Legge", Edit: "Modifica", Write: "Scrive", Grep: "Cerca", Glob: "File", Agent: "Sotto-agente",
  WebFetch: "Pagina web", WebSearch: "Ricerca web", Skill: "Skill", ToolSearch: "Strumenti",
};
function autoAltezza(t) {
  t.style.height = "auto";
  t.style.height = `${Math.min(t.scrollHeight, 200)}px`;
}

// movimento ridotto: `fermo` è letto una volta all'avvio (sonar, ascolto), RIDOTTO dal vivo (mappa)
const fermo = matchMedia("(prefers-reduced-motion: reduce)").matches;
const RIDOTTO = matchMedia("(prefers-reduced-motion: reduce)");

// ---- la palette del canvas ------------------------------------------------------------------
// La palette del canvas (mappa, sonar, timer, sottoagenti) viene dal tema: terne RGB lette dalle variabili --x-rgb della
// palette comune (condivisi/palette.css, con gli alias di palette-cockpit.css) e rilette quando la barra cambia data-tema
// su <html>. Gli array si aggiornano sul posto: chi li ha già in mano (COL_SA) vede il colore nuovo.
// COL: il colore di ogni stato (foglio: gli agenti di foglio, come il loro pallino). TEMA: gli altri colori del disegno.
const VAR_COL = { lavora: "sonar", avvio: "sonar", attende: "sand", ferma: "muted", errore: "coral", tu: "tu", foglio: "foglio", fatto: "fatto" };
const VAR_TEMA = { testo: "text", testo2: "text2", sonar: "sonar", coral: "coral", violet: "violet", fondo: "deep", punto: "punto", suSand: "su-sand" };
const COL = Object.fromEntries(Object.keys(VAR_COL).map((k) => [k, [0, 0, 0]]));
const TEMA = { chiaro: false, ...Object.fromEntries(Object.keys(VAR_TEMA).map((k) => [k, [0, 0, 0]])) };
function leggiPalette() {
  const cs = getComputedStyle(document.documentElement);
  const rgb = (v) => {
    const t = cs.getPropertyValue(v.startsWith("su-") ? `--${v}` : `--${v}-rgb`).trim();
    return t.startsWith("#") ? t.slice(1).match(/../g).map((x) => parseInt(x, 16)) : t.split(/[\s,]+/).map(Number);
  };
  for (const [k, v] of Object.entries(VAR_COL)) COL[k].splice(0, 3, ...rgb(v));
  for (const [k, v] of Object.entries(VAR_TEMA)) TEMA[k].splice(0, 3, ...rgb(v));
  TEMA.chiaro = document.documentElement.dataset.tema === "chiaro";
}
leggiPalette();
new MutationObserver(leggiPalette).observe(document.documentElement, { attributes: true, attributeFilter: ["data-tema"] });

export {
  $, COL, NOMI_TOOL, RIDOTTO, S, STATO, TEMA, assistente, autoAltezza, caricaChi, eAssistente, fermo, istanza, leggiPalette, md,
  mostraBanner, nascondiBanner, nomeModello, nomeSessione, nomeVisibile, persona, selettoreModello,
};
