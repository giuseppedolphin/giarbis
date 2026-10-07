#!/usr/bin/env node
// Telecomando della plancia: lo usa l'assistente (l'orchestratore) dal suo Bash, gli agenti e chiunque da terminale.
// È un client HTTP del server (plancia/server/server.mjs) e non scrive mai lo stato: passa sempre dal server.
// L'elenco dei comandi è AIUTO qui sotto (`ctl.mjs aiuto`); i moduli accesi in plancia.config.json aggiungono i loro
// da plancia/moduli/<nome>/ctl.mjs (o PLANCIA_MODULI_EXTRA/<nome>/ctl.mjs) (export `comandi`, `aiuto`, opzionale `opzioni`).
//
// Dove sta il server, in quest'ordine: opzione --porta → server.json della cartella COCKPIT_STATO (se è impostata porta
// il ctl su una copia di prova, e senza un server lì il ctl fallisce invece di ripiegare) → server.json dello stato di default della cartella del ctl (se c'è e il processo è vivo:
// un ctl lanciato da una copia o da un pacchetto in un'altra cartella va sul proprio server) → COCKPIT_PORTA → porta della
// config (il default sta in config.mjs). Così una COCKPIT_PORTA ereditata dalla plancia viva non vince su un server trovato
// per cartella. Chi lancia un agente o gli scrive viene registrato come genitore o mittente (COCKPIT_SESSIONE).
//
// Comandi dei moduli: plancia/moduli/<nome>/ctl.mjs esporta `comandi` ({ "foglio todo": fn, … }), `aiuto`, `opzioni`.
// Ogni funzione riceve UN solo argomento, il contesto: { args, opz, api, uso, errore, cfg, io, persona, leggiFile,
// mandaInLavagna, base } — args = gli argomenti posizionali dopo il comando, opz = le opzioni lette, api(metodo, percorso,
// corpo) = client del server (lancia l'uscita 1 su errore), uso/errore = stampano ed escono 1, io = COCKPIT_SESSIONE,
// persona = chiSono(), leggiFile(file) → { sorgente, buffer }, mandaInLavagna(file, nome?) → nome nella lavagna, base = URL.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PLANCIA, chiSono, comandoCtl, config } from "./server/config.mjs";
import { dirStato, percorsoStato } from "./server/stato.mjs";

const cfg = config();
const IO = process.env.COCKPIT_SESSIONE || "";
const NOME = cfg.assistente.nome;

const AIUTO = [
  "lista                                          gli agenti (senza l'orchestratore)",
  'crea <nome> "<compito>" [--modello <alias>]    lancia un agente (senza --modello: il default del server)',
  "modello <nome> [<alias>]                       mostra o cambia il modello di una sessione (anche dell'assistente)",
  'invia <nome> "<messaggio>"                     scrive a una sessione',
  "guarda <nome> [n=15]                           gli ultimi eventi di una sessione",
  "ferma <nome>                                   interrompe il turno in corso",
  'mostra <file.html> ["titolo"]                  apre il file sulla lavagna del cockpit',
  'foglio html <file.html> "titolo"               un file HTML in un foglio sulla mappa',
  'foglio immagine <file> "titolo"                png, jpg, svg, gif, webp',
  'foglio tabella <file.json> "titolo"            {"colonne":[…],"righe":[[…]]} oppure un array di oggetti',
  "foglio leggi <id> [--max 4000]                 il solo testo del foglio, troncato a N caratteri",
  'foglio aggiorna <id> [--file <file>] [--titolo "…"] [--descrizione "…"]',
  "foglio attiva|disattiva <id>                   accende o spegne un foglio (spento = nascosto, non perso)",
  "foglio sposta <id> <x> <y> [<larghezza> <altezza>]",
  "fogli                                          tutti i fogli: stato, posizione, misura, descrizione",
  "chiudi-foglio <id>                             lo elimina del tutto (per tenerlo, disattivalo)",
  'progresso piano "passo1|passo2|…" | avanti ["passo"] | <fatti>/<totale> ["cosa faccio"]   (agenti)',
  'timer aggiungi "cosa controlli" <cron|"ogni 30 minuti"> [--id <id-cron>] [--una-volta]   (agenti)',
  "timer scattato <id> | togli <id> | lista",
  `propone "proposta" --perche "una riga" [--urgente]   (${NOME}, al battito)`,
  `battito [stato]|on|off|ora|orari "11:00,13:00"|giorni "1,2,3,4,5"   il battito di ${NOME}`,
  "proposte                                       la proposta in attesa, i contatori, le ultime risposte",
  "setup fatto                                    primo avvio: la config è scritta, la pagina mostra Avvia",
  "cartella [stato|lavagna|allegati]              il percorso della cartella di stato del server con cui parla il ctl",
  '--descrizione "una riga" su mostra e foglio: cosa contiene; --porta <n>: un server su un\'altra porta',
];

const aiutoCompleto = (moduli) => [
  `uso: ${comandoCtl()} <comando> …`,
  ...AIUTO.map((r) => `  ${r}`),
  ...moduli.flatMap((m) => (m.aiuto || []).map((r) => `  ${r}`)),
  `  adesso il ctl parla col server sulla porta ${PORTA} (${DA_DOVE})`,
].join("\n");

function esci(messaggio, codice = 1) {
  console.error(messaggio);
  process.exit(codice);
}
const uso = (testo) => esci(`uso: ${testo}`);
const errore = (testo) => esci(`errore: ${testo}`);

// ───── moduli: comandi in più, letti da plancia/moduli/<nome>/ctl.mjs (solo dei moduli accesi) ─────
async function caricaModuli() {
  const out = [];
  for (const nome of Object.keys(cfg.moduli)) {
    if (!/^[\w\-]+$/.test(nome)) continue;
    const extra = process.env.PLANCIA_MODULI_EXTRA;
    const file = [path.join(PLANCIA, "moduli"), extra && path.isAbsolute(extra) ? extra : ""].filter(Boolean)
      .map((base) => path.join(base, nome, "ctl.mjs")).find((f) => existsSync(f));
    if (!file) continue;
    try { out.push({ nome, ...(await import(pathToFileURL(file).href)) }); }
    catch (e) { console.error(`attenzione: i comandi del modulo "${nome}" non si caricano (${e.message})`); }
  }
  return out;
}
const moduli = await caricaModuli();

// ───── opzioni: un solo parser. Un'opzione vale solo se è nota (le altre restano testo, come "--" dentro un messaggio) ─────
const CON_VALORE = new Set(["descrizione", "modello", "altezza", "generatore", "pagina", "tabella", "max", "file", "titolo", "id", "perche", "porta"]);
const BOOLEANE = new Set(["urgente", "una-volta"]);
for (const m of moduli) {
  for (const o of m.opzioni?.valore || []) CON_VALORE.add(o);
  for (const o of m.opzioni?.booleane || []) BOOLEANE.add(o);
}

function leggiArgomenti(argv) {
  const pos = [], opz = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([\w-]+)$/.exec(argv[i]);
    if (m && BOOLEANE.has(m[1])) opz[m[1]] = true;
    else if (m && CON_VALORE.has(m[1]) && i + 1 < argv.length) opz[m[1]] = argv[++i];
    else pos.push(argv[i]);
  }
  return { pos, opz };
}
const { pos: tutti, opz } = leggiArgomenti(process.argv.slice(2));
const [cmd, ...resto] = tutti;

// ───── il server: dove sta e un solo client HTTP ─────
function portaDaServerJson(file) {
  try {
    const { porta, pid } = JSON.parse(readFileSync(file, "utf8"));
    if (pid) { try { process.kill(pid, 0); } catch (e) { if (e.code === "ESRCH") return 0; } } // server spento: file vecchio
    return Number(porta) || 0;
  } catch { return 0; }
}
const STATO_DEFAULT = path.join(cfg.cartella, ".plancia");
const SCELTE = [
  ["--porta", () => Number(opz.porta)],
  ["server.json di COCKPIT_STATO", () => (process.env.COCKPIT_STATO ? portaDaServerJson(percorsoStato("server.json")) : 0)],
  // con COCKPIT_STATO impostata si parla solo col server di quello stato: mai ripiegare sulla plancia viva
  ["server.json dello stato di questa cartella", () => (process.env.COCKPIT_STATO ? 0 : portaDaServerJson(path.join(STATO_DEFAULT, "server.json")))],
  ["COCKPIT_PORTA", () => (process.env.COCKPIT_STATO ? 0 : Number(process.env.COCKPIT_PORTA))],
];
let PORTA = cfg.porta, DA_DOVE = "porta della config";
for (const [nome, trova] of SCELTE) {
  const p = trova();
  if (p) { PORTA = p; DA_DOVE = nome; break; }
}
// COCKPIT_STATO senza un server vivo in quello stato (e senza --porta): porta 0, la richiesta fallisce con «server non risponde»
if (process.env.COCKPIT_STATO && DA_DOVE === "porta della config") { PORTA = 0; DA_DOVE = "nessun server.json in COCKPIT_STATO"; }
const BASE = `http://127.0.0.1:${PORTA}`;

async function richiesta(metodo, percorso, { corpo, grezzo, tipo } = {}) {
  const intestazioni = { "x-dashboard": "1" };
  let dati;
  if (grezzo) { dati = grezzo; intestazioni["content-type"] = tipo || "application/octet-stream"; }
  else if (corpo) { dati = JSON.stringify(corpo); intestazioni["content-type"] = "application/json"; }
  try {
    return await fetch(BASE + percorso, { method: metodo, headers: intestazioni, body: dati, signal: AbortSignal.timeout(60000) });
  } catch {
    const server = comandoCtl().replace("ctl.mjs", "server/server.mjs");
    return esci(`errore: il server non risponde su ${BASE} (${server}; un'altra porta: COCKPIT_PORTA o --porta)`);
  }
}

// → l'oggetto JSON della risposta. Con `tollera404` un 404 dà null (il server acceso può non conoscere ancora la rotta).
async function api(metodo, percorso, corpo, { tollera404 = false } = {}) {
  const r = await richiesta(metodo, percorso, { corpo });
  const j = await r.json().catch(() => ({}));
  if (r.status === 404 && tollera404) return null;
  if (r.status === 404 && /^non trovato/i.test(j.errore || "")) errore(`il server acceso non conosce ${percorso}: serve il Riavvia della plancia`);
  if (!r.ok || j.ok === false) errore(j.errore || r.status);
  return j;
}

// ───── modelli, sessioni, nomi ─────
let modelliNoti = null;
async function modelli() {
  modelliNoti ??= (await api("GET", "/api/sessioni")).modelli || [];
  return modelliNoti;
}
const nomeModello = (elenco, id) => elenco.find((m) => m.id === id || m.alias === id)?.nome || String(id);

// L'orchestratore si chiama come dice il server: il nome dell'assistente, il suo slug e gli alias della config valgono tutti.
async function risolvi(nome) {
  const n = String(nome || "").trim().toLowerCase();
  const a = cfg.assistente;
  const dellAssistente = new Set(["orchestratore", a.slug, a.nome.toLowerCase(), ...a.alias.map((x) => x.toLowerCase())]);
  if (!dellAssistente.has(n)) return nome;
  const { sessioni } = await api("GET", "/api/sessioni");
  return sessioni.find((s) => s.ruolo === "orchestratore")?.nome || nome;
}
const sessione = async (nome) => encodeURIComponent(await risolvi(nome));

const riga = (s, elenco) => {
  const modello = nomeModello(elenco, s.modello) + (s.modelloPendente ? ` → ${nomeModello(elenco, s.modelloPendente)}` : "");
  return `${s.nome.padEnd(16)} ${s.stato.padEnd(8)} ${modello.padEnd(11)} ${(s.ultimo || "").replace(/\s+/g, " ").slice(0, 110)}`;
};

function testoEvento(e) {
  if (e.type === "cockpit_utente") return `› ${e.testo}`;
  if (e.type === "assistant") {
    const blocco = (b) => (b.type === "text" ? b.text : b.type === "tool_use" ? `⚙ ${b.name} ${JSON.stringify(b.input).slice(0, 140)}` : "");
    return e.blocchi.map(blocco).filter(Boolean).join("\n");
  }
  if (e.type === "risultati") return e.risultati.map((r) => `${r.errore ? "✗" : "✓"} ${r.testo.replace(/\s+/g, " ").slice(0, 140)}`).join("\n");
  if (e.type === "fine") return `— fine turno (${Math.round((e.durata_ms || 0) / 1000)} s)`;
  if (e.type === "cockpit_errore") return `! ${e.testo}`;
  return "";
}

// ───── file: si mandano al server, che li tiene nella lavagna dello stato ─────
const leggiFile = (file) => {
  const f = path.resolve(cfg.cartella, file || "");
  if (!file || !existsSync(f)) errore(`non trovo ${file || "il file"}`);
  return { sorgente: f, buffer: readFileSync(f) };
};

// → il nome con cui il file sta nella lavagna. Il server lo riceve con POST /api/lavagna/carica?nome=… (corpo grezzo).
async function mandaInLavagna(file, nomeForzato) {
  const { sorgente, buffer } = leggiFile(file);
  const nome = nomeForzato || path.basename(sorgente).replace(/[^\w.\-]+/g, "-");
  const r = await richiesta("POST", `/api/lavagna/carica?nome=${encodeURIComponent(nome)}`, { grezzo: buffer });
  if (r.status === 404) errore("il server acceso non conosce /api/lavagna/carica: serve il Riavvia della plancia");
  if (!r.ok) errore((await r.json().catch(() => ({}))).errore || r.status);
  return nome;
}

// {"colonne":[…],"righe":[[…]]} oppure un array di oggetti (le colonne sono le chiavi, nell'ordine in cui compaiono).
function leggiTabellaJson(file) {
  const { buffer } = leggiFile(file);
  let dati;
  try { dati = JSON.parse(buffer.toString("utf8")); } catch (e) { return errore(`${file} non è JSON valido (${e.message})`); }
  if (Array.isArray(dati)) {
    const colonne = [...new Set(dati.flatMap((o) => Object.keys(o || {})))];
    dati = { colonne, righe: dati.map((o) => colonne.map((c) => (o || {})[c] ?? "")) };
  }
  return { colonne: dati.colonne, righe: dati.righe };
}

const descriviFoglio = (c) => `${c.attiva === false ? "spento" : "acceso"} · x ${c.x} y ${c.y} · ${c.w}×${c.h}`;
const unaRiga = (t) => String(t ?? "").replace(/\s+/g, " ").trim();
const trovaFoglio = async (id) => {
  const f = (await api("GET", "/api/fogli")).fogli.find((x) => x.id === id);
  return f || errore(`nessun foglio "${id}" (ctl.mjs fogli per l'elenco)`);
};

// Il testo di un foglio quando il server non lo dà (GET /api/fogli/<id>/testo): tabella e html si ricavano qui.
async function testoLocale(f) {
  if (f.tipo === "tabella") return [(f.colonne || []).join(" | "), ...(f.righe || []).map((r) => r.join(" | "))].join("\n");
  if (f.tipo === "html" && f.percorso) {
    const r = await richiesta("GET", f.percorso);
    const html = r.ok ? await r.text() : "";
    return html.replace(/<(script|style|svg|head)\b[\s\S]*?<\/\1>/gi, "").replace(/<(br|\/p|\/div|\/li|\/tr|\/h\d)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  }
  return `${f.tipo}: ${f.percorso || f.titolo} (il testo di questo tipo lo dà solo il server: serve il Riavvia della plancia)`;
}

// ───── comandi ─────
const quando = (t) => (t ? new Date(t).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" }) : "—");
const ora = (t) => (t ? new Date(t).toLocaleString("it-IT", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

async function foglio(args) {
  const [tipo, ...r] = args;
  const descrizione = opz.descrizione;
  const corpo = { tipo, da: IO, ...(descrizione ? { descrizione } : {}) };
  if (tipo === "leggi") {
    const [id] = r, max = opz.max === undefined ? 4000 : Number(opz.max);
    if (!id || !(max > 0)) uso("ctl.mjs foglio leggi <id> [--max N]");
    // il server taglia il testo e dice quanto era lungo (GET /api/fogli/<id>/testo); senza la rotta si ricava qui
    const dalServer = await api("GET", `/api/fogli/${encodeURIComponent(id)}/testo?max=${max}`, undefined, { tollera404: true });
    const f = dalServer?.foglio || await trovaFoglio(id);
    const intero = dalServer ? null : await testoLocale(f);
    const totale = dalServer ? Number(dalServer.lunghezza) || String(dalServer.testo).length : intero.length;
    const testo = (dalServer ? String(dalServer.testo) : intero).slice(0, max);
    console.log(`${f.titolo} · ${f.tipo}${f.da ? ` · da ${f.da}` : ""}\n${unaRiga(f.descrizione || f.titolo)}\n---`);
    const coda = `\n… [troncato: restano ${(totale - testo.length).toLocaleString("it-IT")} caratteri su ${totale.toLocaleString("it-IT")}; rilancia con --max ${totale}]`;
    console.log(totale > testo.length ? testo + coda : testo);
    return;
  }
  if (tipo === "aggiorna") { // lo usa soprattutto l'agente di un foglio
    const [id] = r;
    if (!id || (!opz.file && opz.titolo === undefined && descrizione === undefined)) {
      uso('ctl.mjs foglio aggiorna <id> [--file <file>] [--titolo "…"] [--descrizione "…"]');
    }
    const f = await trovaFoglio(id);
    const modifica = { id, ricarica: true, ...(opz.titolo !== undefined ? { titolo: opz.titolo } : {}), ...(descrizione !== undefined ? { descrizione } : {}) };
    if (opz.file && f.tipo === "tabella") Object.assign(modifica, leggiTabellaJson(opz.file));
    else if (opz.file && (f.tipo === "html" || f.tipo === "immagine")) {
      const nome = /^\/lavagna\/([\w.\-]+)$/.exec(f.percorso || "")?.[1];
      if (!nome) errore(`il foglio ${id} non ha un file modificabile (${f.percorso})`);
      await mandaInLavagna(opz.file, nome);
    } else if (opz.file) errore(`un foglio ${f.tipo} non si aggiorna da file`);
    const { foglio: g } = await api("POST", "/api/fogli", modifica);
    console.log(`foglio ${g.id} "${g.titolo}" aggiornato`);
    return;
  }
  if (tipo === "attiva" || tipo === "disattiva" || tipo === "sposta") {
    const [id, ...n] = r;
    if (!id) uso(`ctl.mjs foglio ${tipo} <id>${tipo === "sposta" ? " <x> <y> [<larghezza> <altezza>]" : ""}`);
    const modifica = tipo === "sposta" ? {} : { attiva: tipo === "attiva" };
    if (tipo === "sposta") {
      const num = n.map(Number);
      if (num.length < 2 || num.length === 3 || num.length > 4 || num.some((v) => !Number.isFinite(v))) {
        uso("ctl.mjs foglio sposta <id> <x> <y> [<larghezza> <altezza>] (numeri, in pixel)");
      }
      [modifica.x, modifica.y, modifica.w, modifica.h] = num;
    }
    const { foglio: g } = await api("POST", "/api/fogli", { id, ...modifica });
    console.log(`foglio ${g.id} "${g.titolo}": ${descriviFoglio(g)}`);
    return;
  }
  if (tipo === "html" || tipo === "immagine") {
    const [file, ...t] = r;
    if (!file) uso(`ctl.mjs foglio ${tipo} <file> "titolo"`);
    if (tipo === "immagine" && !/\.(png|jpe?g|svg|gif|webp)$/i.test(file)) errore("l'immagine deve essere png, jpg, svg, gif o webp");
    corpo.percorso = `/lavagna/${await mandaInLavagna(file)}`;
    corpo.titolo = t.join(" ") || path.basename(file);
  } else if (tipo === "tabella") {
    const [file, ...t] = r;
    Object.assign(corpo, leggiTabellaJson(file));
    corpo.titolo = t.join(" ") || path.basename(file, ".json");
  } else {
    return uso('ctl.mjs foglio html <file> | tabella <file.json> | immagine <file>  (poi il titolo) [--descrizione "una riga"]  |  foglio leggi <id> [--max N]');
  }
  const { foglio: g } = await api("POST", "/api/fogli", corpo);
  console.log(`foglio ${g.tipo} "${g.titolo}" sulla mappa (${g.id}); chiudi con: ctl.mjs chiudi-foglio ${g.id}`);
}

async function progresso(args) {
  // Per la sessione di chi lo lancia (COCKPIT_SESSIONE, che il cockpit imposta agli agenti). Si vede solo l'anello, mai i numeri.
  if (!IO) errore("progresso vale per un agente del cockpit (manca COCKPIT_SESSIONE)");
  const [a, ...r] = args;
  let corpo;
  if (a === "piano") corpo = { piano: r.join(" ").split("|").map((x) => x.trim()).filter(Boolean) };
  else if (a === "avanti") corpo = { avanti: true, passo: r.join(" ") };
  else if (/^\d+\/\d+$/.test(a || "")) { const [fatti, totale] = a.split("/").map(Number); corpo = { fatti, totale, passo: r.join(" ") }; }
  else uso('ctl.mjs progresso piano "passo1|passo2|…"  |  progresso avanti ["passo"]  |  progresso <fatti>/<totale> ["cosa sto facendo"]');
  const { progresso: p } = await api("POST", `/api/sessioni/${encodeURIComponent(IO)}/progresso`, corpo);
  console.log(`avanzamento: ${p.fatti} di ${p.totale}${p.passo ? ` — ora: ${p.passo}` : ""}`);
}

async function timer(args) {
  // La sessione è COCKPIT_SESSIONE, quindi chi lo chiama. Il registro è solo uno specchio: i job veri vivono nel processo claude.
  const [azione, ...r] = args;
  if (azione === "aggiungi") {
    if (!IO) errore("timer aggiungi vale per una sessione del cockpit (manca COCKPIT_SESSIONE)");
    const [descrizione, ...cron] = r;
    if (!descrizione || !cron.length) uso('ctl.mjs timer aggiungi "descrizione" <cron a 5 campi | "ogni N minuti"> [--id <id-cron>] [--una-volta]');
    const corpo = { sessione: IO, descrizione, ricorrenza: cron.join(" "), idCron: opz.id || "", unaVolta: !!opz["una-volta"] };
    const { timer: t } = await api("POST", "/api/timer", corpo);
    console.log(`timer ${t.id} registrato: "${t.descrizione}" (${t.ricorrenza}), prossimo scatto ${quando(t.prossimo)}`);
  } else if (azione === "scattato" || azione === "togli") {
    const [id] = r;
    if (!id) uso(`ctl.mjs timer ${azione} <id>`);
    const { timer: t } = await api("POST", `/api/timer/${encodeURIComponent(id)}/${azione}`);
    console.log(azione === "togli" || t.tolto ? `timer ${t.id} tolto dal registro` : `timer ${t.id} scattato; prossimo ${quando(t.prossimo)}`);
  } else if (azione === "lista") {
    const { timer: tutti } = await api("GET", "/api/timer");
    const riga = (t) => `${t.id.padEnd(9)} ${t.sessione.padEnd(14)} ${t.ricorrenza.padEnd(16)} prossimo ${quando(t.prossimo).padEnd(16)} ` +
      `${t.sospeso ? "(spento) " : ""}${t.descrizione}${t.idCron ? `  [cron ${t.idCron}]` : ""}`;
    console.log((IO ? tutti.filter((t) => t.sessione === IO) : tutti).map(riga).join("\n") || "nessun timer");
  } else {
    uso('ctl.mjs timer aggiungi "descrizione" <cron> [--id <id-cron>] [--una-volta] | timer scattato <id> | timer togli <id> | timer lista');
  }
}

const descriviBattito = (b) => `battito ${b.acceso ? "acceso" : "spento"} · orari ${b.orari.join(", ")} · giorni ${b.giorni.join(",")} (0 = domenica)` +
  `${b.acceso ? ` · prossimo ${ora(b.prossimo)}` : ""}${b.ultimo ? ` · ultimo ${b.ultimo.slot}: ${b.ultimo.esito}${b.ultimo.nota ? ` (${b.ultimo.nota})` : ""}` : ""}`;

async function battito(args) {
  const [sub = "stato", valore] = args;
  if (sub === "stato") console.log(descriviBattito((await api("GET", "/api/battito")).battito));
  else if (sub === "on" || sub === "off") console.log(descriviBattito((await api("POST", "/api/battito", { acceso: sub === "on" })).battito));
  else if (sub === "orari") console.log(descriviBattito((await api("POST", "/api/battito", { orari: valore })).battito));
  else if (sub === "giorni") console.log(descriviBattito((await api("POST", "/api/battito", { giorni: valore })).battito));
  else if (sub === "ora") {
    const j = await api("POST", "/api/battito/ora");
    console.log(`battito: ${j.esito}${j.motivo ? ` (${j.motivo})` : ""}${j.nuovi ? ` · ${j.nuovi} segnali nuovi su ${j.segnali}` : ""}`);
  } else uso('ctl.mjs battito [stato]|on|off|ora|orari "11:00,13:00"|giorni "1,2,3,4,5"');
}

const COMANDI = {
  async lista() {
    const { sessioni, modelli: m } = await api("GET", "/api/sessioni");
    console.log(sessioni.filter((s) => s.ruolo !== "orchestratore").map((s) => riga(s, m || [])).join("\n") || "nessun agente");
  },
  async crea(args) {
    const [nome, ...compito] = args;
    if (!nome) uso('ctl.mjs crea <nome> "<compito>" [--modello <alias>]');
    // senza --modello decide il server
    const { sessione: s } = await api("POST", "/api/sessioni", { nome, compito: compito.join(" "), modello: opz.modello, genitore: IO });
    console.log(`agente "${s.nome}" lanciato (${nomeModello(await modelli(), s.modello)})`);
  },
  async modello([nome, alias]) {
    if (!nome) uso("ctl.mjs modello <nome> [<alias>]");
    const elenco = await modelli();
    if (!alias) {
      const { sessioni } = await api("GET", "/api/sessioni");
      const voluto = String(await risolvi(nome)).toLowerCase();
      const s = sessioni.find((x) => x.nome === voluto || x.id === voluto);
      if (!s) errore(`nessuna sessione "${nome}"`);
      console.log(`${s.nome}: ${nomeModello(elenco, s.modello)}${s.modelloPendente ? ` (a fine turno passa a ${nomeModello(elenco, s.modelloPendente)})` : ""}`);
      return;
    }
    const j = await api("POST", `/api/sessioni/${await sessione(nome)}/modello`, { modello: alias });
    const nuovo = nomeModello(elenco, j.sessione.modello), pendente = nomeModello(elenco, j.sessione.modelloPendente);
    console.log(j.applicato ? `${j.sessione.nome}: modello ${nuovo} (vale dal prossimo messaggio, la conversazione continua)`
      : `${j.sessione.nome} sta lavorando: passa a ${pendente} a fine turno, senza interromperlo`);
  },
  async invia([nome, ...testo]) {
    if (!nome) uso('ctl.mjs invia <nome> "<messaggio>"');
    await api("POST", `/api/sessioni/${await sessione(nome)}/messaggio`, { testo: testo.join(" "), mittente: IO });
    console.log(`messaggio mandato a "${nome}"`);
  },
  async guarda([nome, n = "15"]) {
    if (!nome) uso("ctl.mjs guarda <nome> [n=15]");
    const { sessione: s, eventi } = await api("GET", `/api/sessioni/${await sessione(nome)}/eventi`);
    console.log(riga(s, await modelli()));
    console.log(eventi.map(testoEvento).filter(Boolean).slice(-Number(n)).join("\n"));
  },
  async ferma([nome]) {
    if (!nome) uso("ctl.mjs ferma <nome>");
    await api("POST", `/api/sessioni/${await sessione(nome)}/ferma`);
    console.log(`turno di "${nome}" interrotto`);
  },
  async mostra([file, ...titolo]) {
    if (!file) uso('ctl.mjs mostra <file.html> ["titolo"]');
    const nome = await mandaInLavagna(file);
    await api("POST", "/api/lavagna", { percorso: `/lavagna/${nome}`, titolo: titolo.join(" "), descrizione: opz.descrizione, da: IO });
    console.log(`mostrato sulla lavagna: ${nome}`);
  },
  foglio,
  async fogli() {
    const { fogli } = await api("GET", "/api/fogli");
    const riga = (c) => `${c.id.padEnd(9)} ${c.tipo.padEnd(8)} ${descriviFoglio(c).padEnd(36)} ${c.titolo}${c.da ? `  (da ${c.da})` : ""}\n` +
      `${" ".repeat(10)}${unaRiga(c.descrizione || c.titolo)}`;
    console.log(fogli.map(riga).join("\n") || "nessun foglio");
  },
  async "chiudi-foglio"([id]) {
    if (!id) uso("ctl.mjs chiudi-foglio <id>");
    await api("POST", `/api/fogli/${encodeURIComponent(id)}/chiudi`);
    console.log(`foglio ${id} chiuso`);
  },
  progresso,
  timer,
  async propone(args) {
    const testo = args.join(" ").trim();
    if (!testo) uso('ctl.mjs propone "cosa propongo" --perche "una riga" [--urgente]');
    const j = await api("POST", "/api/proposte", { testo, perche: opz.perche, urgente: !!opz.urgente });
    console.log(`proposta ${j.proposta.id} sul foglio «${NOME} propone»${j.proposta.urgente ? " (urgente: anche a voce)" : ""}`);
  },
  battito,
  async proposte() {
    const j = await api("GET", "/api/proposte"), c = j.contatori;
    console.log([
      j.attuale ? `in attesa (${j.attuale.id}): ${j.attuale.testo}${j.attuale.perche ? ` — ${j.attuale.perche}` : ""}` : "nessuna proposta in attesa",
      `fatte ${c.fatte} · accettate ${c.accettate} · rifiutate ${c.rifiutate} · ignorate ${c.ignorate}`, descriviBattito(j.battito),
      ...j.recenti.map((p) => `  ${p.stato.padEnd(8)} ${ora(p.creata)}  ${p.testo}`),
    ].join("\n"));
  },
  async setup([quale]) {
    if (quale !== "fatto") uso("ctl.mjs setup fatto");
    await api("POST", "/api/setup/fatto");
    console.log("setup segnalato: la pagina mostra il pulsante per avviare");
  },
  async cartella([quale = "stato"]) {
    // la cartella del server con cui si parla (/api/chi); un server vecchio o spento non la dice: si risponde con quella locale
    const locali = { stato: dirStato(), lavagna: percorsoStato("lavagna"), allegati: percorsoStato("allegati") };
    let dalServer = null;
    try { dalServer = (await (await fetch(`${BASE}/api/chi`, { headers: { "x-dashboard": "1" }, signal: AbortSignal.timeout(5000) })).json()).cartelle; } catch {}
    const p = { ...locali, ...(dalServer || {}) }[quale];
    if (!p) uso("ctl.mjs cartella [stato|lavagna|allegati]");
    const rel = path.relative(cfg.cartella, p);
    console.log(rel.startsWith("..") || path.isAbsolute(rel) ? p : rel); // relativo alla cartella di lavoro se ci sta dentro
  },
  aiuto() { console.log(aiutoCompleto(moduli)); },
};

// Cosa riceve un comando di un modulo: gli argomenti dopo il comando, le opzioni, il client e gli attrezzi comuni.
const contestoModulo = (args) => ({ args, opz, api, uso, errore, cfg, io: IO, persona: chiSono(), leggiFile, mandaInLavagna, base: BASE });

// Un comando di un modulo a due parole ("foglio todo") batte il comando del nucleo; uno a una parola vale se il nucleo non lo ha.
async function esegui() {
  const comandiModuli = Object.assign({}, ...moduli.map((m) => m.comandi || {}));
  if (cmd && resto[0] && comandiModuli[`${cmd} ${resto[0]}`]) return comandiModuli[`${cmd} ${resto[0]}`](contestoModulo(resto.slice(1)));
  if (cmd && Object.hasOwn(COMANDI, cmd)) return COMANDI[cmd](resto);
  if (cmd && comandiModuli[cmd]) return comandiModuli[cmd](contestoModulo(resto));
  if (!cmd || cmd === "--aiuto" || cmd === "help") return COMANDI.aiuto();
  return esci(`comando sconosciuto: ${cmd}\n${aiutoCompleto(moduli)}`);
}

await esegui();
