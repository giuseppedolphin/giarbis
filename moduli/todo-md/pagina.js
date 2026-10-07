// Lato pagina del modulo todo-md: il foglio to-do del cockpit (le voci aperte del file markdown, per
// priorità; la spunta chiude la voce, le chiuse da poco si riaprono con un clic) e gli esempi della chat sulla to-do.
// Il cockpit carica questo file se il modulo è acceso (/api/chi lo elenca) e chiama la funzione di default con
// ciò che offre: { registraTipoFoglio, registraEsempi, mostraBanner, md }. La barra comune la chiama solo con
// { registraVoceBarra }: questo modulo non ha voci di barra e in quel caso non fa niente.
import { api } from "/condivisi/api.js";
import { su } from "/condivisi/eventi.js";
import { esc } from "/condivisi/formati.js";
import { memo } from "/condivisi/memo.js";
import { iniettaStile } from "/condivisi/stile.js";

const CSS = `
.td-tab{display:flex;gap:6px;padding:8px 10px;border-bottom:1px solid var(--pl-line);position:sticky;top:0;background:rgb(var(--pl-deep-rgb) / .98);
  z-index:1;align-items:center;flex-wrap:wrap}
.td-tab .toggle{padding:3px 10px;font-size:12px}
.td-tab .tot{margin-left:auto;font-size:12px;color:var(--pl-muted)}
.td-g{padding:10px 12px 2px;font:600 12px/1 ui-monospace,Menlo,monospace;letter-spacing:.4px;color:var(--pl-text2);display:flex;gap:8px;align-items:center}
.td-g i{width:8px;height:8px;border-radius:50%;display:inline-block}
.td-g .P1{background:var(--pl-coral)}
.td-g .P2{background:var(--pl-sand)}
.td-g .P3{background:var(--pl-muted)}
.td-v{display:grid;grid-template-columns:auto auto 1fr auto;align-items:start;gap:2px 10px;padding:7px 12px;border-bottom:1px solid var(--pl-line);font-size:13px}
.td-v.con-scheda{cursor:pointer}
.td-v.con-scheda:hover{background:rgb(var(--pl-sonar-rgb) / .06)}
.td-id{font:500 11.5px/1.6 ui-monospace,Menlo,monospace;color:var(--pl-sonar)}
.td-t{color:var(--pl-text)}
.td-t .td-blocca{color:var(--pl-coral)}
.td-sc{font-size:11.5px;color:var(--pl-text2);white-space:nowrap}
.td-sc.scaduta{color:var(--pl-coral)}
.td-ck{width:18px;height:18px;margin-top:2px;padding:0;border:1.5px solid var(--pl-line2);border-radius:5px;background:transparent;
  color:var(--pl-abyss);font:700 12px/1 system-ui,sans-serif;cursor:pointer}
.td-ck:hover{border-color:var(--pl-sonar)}
.td-ck.on{background:var(--pl-sonar);border-color:var(--pl-sonar)}
.td-v.chiusa .td-t{color:var(--pl-muted);text-decoration:line-through}
.td-chiuse{border-top:1px solid var(--pl-line);margin-top:8px}
.td-chiuse summary{cursor:pointer;padding:9px 12px;font:600 12px/1 ui-monospace,Menlo,monospace;letter-spacing:.4px;color:var(--pl-text2)}
.td-esito{grid-column:1/-1;display:flex;gap:6px;align-items:center;padding:4px 0 2px 28px}
.td-esito input{flex:1;min-width:0;font:inherit;font-size:12.5px;background:var(--pl-abyss);border:1px solid var(--pl-line2);border-radius:8px;
  padding:5px 8px;color:var(--pl-text)}
.td-esito .toggle{padding:3px 10px;font-size:12px}
.td-pa{grid-column:3/5;font-size:12px;color:var(--pl-text2)}
.td-scheda{position:absolute;inset:0;background:var(--pl-deep);overflow:auto;z-index:2;padding:0 14px 14px;font-size:13.5px}
.td-scheda .td-su{position:sticky;top:0;background:var(--pl-deep);padding:10px 0;display:flex;gap:10px;align-items:center;
  border-bottom:1px solid var(--pl-line);margin-bottom:8px}
.td-scheda pre,.td-scheda code{font-family:ui-monospace,Menlo,monospace;font-size:12px}
.td-scheda pre{overflow:auto;background:var(--pl-abyss);padding:8px;border-radius:8px}
.td-scheda table{border-collapse:collapse;font-size:12px}
.td-scheda td,.td-scheda th{border:1px solid var(--pl-line);padding:4px 8px;white-space:normal;max-width:none}`;

const AGGIORNA_OGNI_MS = 30000;
// dati: la risposta di GET /api/todo ({ ok, <tabella>: [voci], chiuse: { <tabella>: [voci] } }); corpi: i fogli to-do aperti
const T = { dati: null, quando: 0, predefinita: "todo", corpi: new Map(), ctx: null, avviato: false };

const dataEstesa = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? iso.split("-").reverse().join("/") : iso || "");
const etichetta = (chiave) => chiave[0].toUpperCase() + chiave.slice(1);
const memoFoglio = (id, nome) => `foglio.${id}.${nome}`;

// ---- dati ----------------------------------------------------------------------------------------
async function caricaTodo(forza) {
  if (!forza && T.dati && Date.now() - T.quando < 4000) return;
  T.dati = await api("GET", "/api/todo");
  T.quando = Date.now();
}
function rendiTutti() {
  for (const [corpo, foglio] of T.corpi) {
    if (!corpo.isConnected) T.corpi.delete(corpo); else rendiTodo(corpo, foglio);
  }
}
const rileggi = () => caricaTodo(true).then(rendiTutti);

// ---- il foglio ---------------------------------------------------------------------------------------
function htmlVoce(x, oggi) {
  const blocca = x.bloccante === "si" ? ' · <span class="td-blocca">blocca</span>' : "";
  const scade = x.scadenza ? `entro ${esc(dataEstesa(x.scadenza))}` : "";
  const scaduta = x.scadenza && x.scadenza < oggi ? " scaduta" : "";
  return `<div class="td-v${x.scheda ? " con-scheda" : ""}" data-s="${esc(x.scheda)}" data-i="${esc(x.id)}"${x.scheda ? ' title="Apri la scheda"' : ""}>`
    + `<button class="td-ck" data-c="${esc(x.id)}" title="Segna come fatta" aria-label="Segna ${esc(x.id)} come fatta"></button>`
    + `<span class="td-id">${esc(x.id)}</span><span class="td-t">${esc(x.titolo)}${blocca}</span><span class="td-sc${scaduta}">${scade}</span>`
    + `${x.prossima_azione ? `<div class="td-pa">→ ${esc(x.prossima_azione)}</div>` : ""}</div>`;
}
function htmlChiusa(x) {
  return `<div class="td-v chiusa" data-i="${esc(x.id)}"><button class="td-ck on" data-r="${esc(x.id)}" title="Riapri" aria-label="Riapri ${esc(x.id)}">✓</button>`
    + `<span class="td-id">${esc(x.id)}</span><span class="td-t">${esc(x.titolo)}</span><span class="td-sc">chiusa il ${esc(dataEstesa(x.chiusa))}</span>`
    + `${x.esito ? `<div class="td-pa">${esc(x.esito)}</div>` : ""}</div>`;
}

function rendiTodo(corpo, foglio, errore) {
  if (errore || !T.dati) {
    corpo.innerHTML = `<div class="foglio-vuota">Non riesco a leggere le to-do: ${esc(errore || "nessun dato")}.</div>`;
    return;
  }
  if (corpo.querySelector(".td-esito")) return; // si sta scrivendo un esito: la lista non si ridisegna sotto le dita
  const aperta = corpo.querySelector(".td-scheda") ? corpo.querySelector(".td-scheda").dataset.p : "";
  const chiavi = Object.keys(T.dati).filter((k) => Array.isArray(T.dati[k])); // le liste; restano fuori ok e chiuse
  const tab = memo.get(memoFoglio(foglio.id, "tab"), foglio.tabella || T.predefinita);
  const voci = T.dati[tab] || [];
  const tabs = chiavi
    .map((k) => `<button class="toggle" data-t="${esc(k)}" aria-pressed="${k === tab}">${esc(etichetta(k))} · ${(T.dati[k] || []).length}</button>`).join("");
  const oggi = new Date().toISOString().slice(0, 10);
  const gruppi = ["P1", "P2", "P3", ""].map((p) => {
    const v = voci.filter((x) => (x.priorita || "") === p);
    if (!v.length) return "";
    return `<div class="td-g"><i class="${p || "P3"}"></i>${p || "senza priorità"} · ${v.length}</div>${v.map((x) => htmlVoce(x, oggi)).join("")}`;
  }).join("");
  const chiuse = (T.dati.chiuse || {})[tab] || [];
  const aperteChiuse = memo.get(memoFoglio(foglio.id, "chiuse"), "0") === "1";
  const dettagli = chiuse.length
    ? `<details class="td-chiuse"${aperteChiuse ? " open" : ""}><summary>Chiuse da poco · ${chiuse.length}</summary>`
      + `${chiuse.map(htmlChiusa).join("")}</details>` : "";
  const scrollo = corpo.scrollTop;
  corpo.innerHTML = `<div class="td-tab">${tabs}<span class="tot">${voci.length} aperte</span></div>`
    + `${gruppi || '<div class="foglio-vuota">Nessuna voce aperta.</div>'}${dettagli}`;
  corpo.querySelector(".td-chiuse")?.addEventListener("toggle", (e) => memo.set(memoFoglio(foglio.id, "chiuse"), e.target.open ? "1" : "0"));
  corpo.querySelectorAll("[data-c]").forEach((b) => { b.onclick = (e) => { e.stopPropagation(); chiediEsito(corpo, b.closest(".td-v"), b.dataset.c); }; });
  corpo.querySelectorAll("[data-r]").forEach((b) => { b.onclick = (e) => { e.stopPropagation(); azioneTodo("riapri", b.dataset.r); }; });
  corpo.scrollTop = scrollo;
  corpo.querySelectorAll("[data-t]").forEach((b) => { b.onclick = () => { memo.set(memoFoglio(foglio.id, "tab"), b.dataset.t); rendiTodo(corpo, foglio); }; });
  corpo.querySelectorAll(".td-v.con-scheda").forEach((v) => { v.onclick = () => apriSchedaTodo(corpo, v.dataset.s, v.dataset.i); });
  if (aperta) apriSchedaTodo(corpo, aperta, "");
}

// La spunta: chiude la voce sul file (data ed esito sulla stessa riga). Prima propone un esito
// modificabile al volo (Invio conferma, Esc annulla); riaprire è un clic sulla spunta di una voce chiusa da poco.
function chiediEsito(corpo, riga, voce) {
  if (!riga) return;
  corpo.querySelector(".td-esito")?.remove();
  const f = document.createElement("div");
  f.className = "td-esito";
  f.innerHTML = `<input type="text" value="Fatta." maxlength="300" aria-label="Esito di ${esc(voce)}">`
    + '<button class="toggle" data-o="si">Chiudi</button><button class="toggle" data-o="no">Annulla</button>';
  riga.appendChild(f);
  const inp = f.querySelector("input");
  inp.focus();
  inp.select();
  const fine = () => { f.remove(); rendiTutti(); };
  async function conferma() {
    inp.disabled = true;
    f.remove();
    await azioneTodo("chiudi", voce, inp.value.trim() || "Fatta.");
  }
  f.addEventListener("click", (e) => {
    e.stopPropagation();
    const o = e.target.closest("button")?.dataset.o;
    if (o === "no") fine(); else if (o === "si") conferma();
  });
  inp.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") conferma(); else if (e.key === "Escape") fine();
  });
}
async function azioneTodo(azione, voce, esito) {
  try { await api("POST", `/api/todo/${azione}`, { id: voce, esito }); } catch (e) { T.ctx.mostraBanner(`${voce}: ${e.message}`, 5000); }
  rileggi().catch((e) => T.ctx.mostraBanner(e.message, 4000)); // subito, senza aspettare l'evento o i 30 s
}
async function apriSchedaTodo(corpo, percorso, voce) { // pannello di sola lettura sopra la lista
  corpo.querySelector(".td-scheda")?.remove();
  const p = document.createElement("div");
  p.className = "td-scheda";
  p.dataset.p = percorso;
  p.innerHTML = `<div class="td-su"><button class="toggle">← Torna alla lista</button>`
    + `<span class="meta">${esc(voce)} · ${esc(percorso)} · sola lettura</span></div><div class="td-md">Carico…</div>`;
  corpo.appendChild(p);
  p.querySelector("button").onclick = () => p.remove();
  p.addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (!a) return;
    e.preventDefault();
    if (/^https?:/.test(a.getAttribute("href") || "")) window.open(a.href, "_blank", "noopener");
  });
  try {
    const j = await api("GET", `/api/todo/scheda?p=${encodeURIComponent(percorso)}`);
    p.querySelector(".td-md").innerHTML = T.ctx.md(j.testo.replace(/^---\n[\s\S]*?\n---\n/, ""));
  } catch (e) { p.querySelector(".td-md").textContent = `Scheda non leggibile: ${e.message}`; }
}

// ---- il modulo -------------------------------------------------------------------------------------------
const tipoTodo = {
  nome: "to-do",
  disegna(corpo, foglio, ctx) {
    T.ctx = ctx;
    T.corpi.set(corpo, foglio);
    corpo.innerHTML = '<div class="foglio-vuota">Carico le to-do…</div>';
    caricaTodo(false).then(() => rendiTodo(corpo, foglio)).catch((e) => rendiTodo(corpo, foglio, e.message));
  },
  aggiorna: () => rileggi().catch((e) => { for (const [corpo, foglio] of T.corpi) rendiTodo(corpo, foglio, e.message); }),
};

export default async function monta({ registraVoceBarra, registraTipoFoglio, registraEsempi, mostraBanner, md } = {}) {
  void registraVoceBarra; // il contratto della barra: todo-md non ha voci, niente da registrare
  if (typeof registraTipoFoglio !== "function" || T.avviato) return; // chiamata dalla barra, o già fatta
  T.avviato = true;
  T.ctx = { mostraBanner, md };
  iniettaStile("pl-todo-md", CSS);
  T.predefinita = "todo"; // una lista sola: il file markdown
  registraTipoFoglio("todo", tipoTodo);
  registraEsempi?.(["Lancia un agente che riassume le voci P1 della to-do", "Fammi vedere la to-do sulla mappa"]);
  su("cockpit_todo", () => { rileggi().catch(() => {}); }); // una voce chiusa o riaperta (da qui, dall'assistente o da un'altra scheda)
  setInterval(() => { if (!document.hidden && T.corpi.size) rileggi().catch(() => {}); }, AGGIORNA_OGNI_MS);
}
