// La configurazione della plancia: UN file, plancia.config.json, nella cartella di lavoro (la si cerca risalendo da
// process.cwd(), come fa git; PLANCIA_CONFIG la forza). Senza file valgono i default e la plancia parte lo stesso.
// Tutto il resto del nucleo chiede qui: cartella di lavoro, porta, persona, chiavi, nome dell'assistente, moduli accesi.
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirStato } from "./stato.mjs";

export const PLANCIA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); // la cartella plancia/ del pacchetto
const NOME_FILE = "plancia.config.json";
const PORTA_DEFAULT = 4173;

export function slug(testo) {
  return String(testo ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function trovaFile() {
  if (process.env.PLANCIA_CONFIG) return path.resolve(process.env.PLANCIA_CONFIG);
  let dir = process.cwd();
  for (;;) {
    const f = path.join(dir, NOME_FILE);
    if (existsSync(f)) return f;
    const su = path.dirname(dir);
    if (su === dir) return "";
    dir = su;
  }
}

const fascia = (f) => (f && /^\d\d:\d\d$/.test(f.dalle || "") && /^\d\d:\d\d$/.test(f.alle || "") ? { dalle: f.dalle, alle: f.alle } : null);
const minuti = (v, base) => (typeof v === "number" && v >= 0 ? v : base);
const elenco = (v, base) => (Array.isArray(v) ? v.map(String) : base);

// telegram.whisper: { cli, modello, ffmpeg, secondi }; un percorso con ~ parte dalla cartella di casa, un campo assente resta al default
const casa = (p) => (typeof p === "string" && p.trim() ? p.trim().replace(/^~(?=$|[\\/])/, os.homedir()) : undefined);
function whisper(w) {
  const o = w && typeof w === "object" ? w : {};
  return { cli: casa(o.cli), modello: casa(o.modello), ffmpeg: casa(o.ffmpeg), secondi: Number(o.secondi) > 0 ? Number(o.secondi) : undefined };
}

function assistente(a = {}) {
  const nome = String(a.nome || "Assistente");
  const s = slug(a.slug || nome) || "assistente";
  const v = a.varianti || {};
  return {
    nome, slug: s,
    chiamata: elenco(a.chiamata, [`hey ${s}`]),
    varianti: {
      prefissi: elenco(v.prefissi, ["hey", "ehi", "hei", "ei", "eh", "e"]),
      nomi: elenco(v.nomi, [s]),
    },
    alias: elenco(a.alias, []),
  };
}

function risolvi(grezzo, fileConfig) {
  const g = grezzo || {};
  const cartella = fileConfig ? path.dirname(fileConfig) : process.cwd();
  const b = g.battito || {}, k = g.conservazione || {}, m = g.modelli || {}, c = g.contesto || {}, q = g.squadra || {}, pt = g.ponte || {}, tg = g.telegram || {};
  return {
    cartella, fileConfig,
    assistente: assistente(g.assistente),
    lingua: String(g.lingua || "it"),
    chrome: g.chrome !== false, // false: le sessioni non partono con --chrome (chi non ha l'estensione Claude in Chrome)
    fuso: String(g.fuso || "Europe/Rome"),
    porta: Number(g.porta) || PORTA_DEFAULT,
    chiavi: g.chiavi ? String(g.chiavi) : "",
    persone: Array.isArray(g.persone) ? g.persone.map((p) => ({ ...p, email: String(p.email || "").toLowerCase() })) : [],
    modelli: { default: String(m.default || "opus"), foglio: String(m.foglio || "sonnet") },
    battito: {
      orari: elenco(b.orari, ["11:00", "13:00", "15:00", "17:00", "19:00"]),
      giorni: Array.isArray(b.giorni) ? b.giorni.map(Number) : [1, 2, 3, 4, 5],
      oraMinima: String(b.oraMinima || "10:00"),
    },
    conservazione: {
      allegatiGiorni: Number(k.allegatiGiorni) || 30,
      registriMB: Number(k.registriMB) || 20,
    },
    // limiti.corpoMB: il tetto del corpo JSON di una richiesta al server (rotte.mjs); un messaggio o un compito lungo ci passa intero
    limiti: { corpoMB: Number(g.limiti?.corpoMB) > 0 ? Number(g.limiti.corpoMB) : 8 },
    // compattaOltre: quota della finestra (0-1) oltre la quale a fine turno il server manda /compact (sessioni.mjs); null o assente = spento
    contesto: { compattaOltre: Number(c.compattaOltre) > 0 && Number(c.compattaOltre) < 1 ? Number(c.compattaOltre) : null },
    // la squadra di agenti permanenti (squadra.mjs): i ruoli li portano i moduli, qui le regole comuni del risveglio
    squadra: {
      intervalloMinuti: Number(q.intervalloMinuti) > 0 ? Number(q.intervalloMinuti) : 15,
      vuotoOgniMinuti: Number(q.vuotoOgniMinuti) > 0 ? Number(q.vuotoOgniMinuti) : 120,
      messaggiOra: Number(q.messaggiOra) > 0 ? Number(q.messaggiOra) : 6,
      consumoMax: Number(q.consumoMax) > 0 ? Number(q.consumoMax) : 90,
      quiete: q.quiete && /^\d\d:\d\d$/.test(q.quiete.dalle || "") && /^\d\d:\d\d$/.test(q.quiete.alle || "")
        ? { dalle: q.quiete.dalle, alle: q.quiete.alle, intervalloMinuti: Number(q.quiete.intervalloMinuti) > 0 ? Number(q.quiete.intervalloMinuti) : null }
        : null,
    },
    // il ponte con le plance delle altre persone (ponte.mjs): ogni quanti minuti si guarda la coda
    ponte: { intervalloMinuti: Number(pt.intervalloMinuti) > 0 ? Number(pt.intervalloMinuti) : 1 },
    // Telegram (telegram.mjs): acceso solo se lo dice la config e c'è il token; soglie in minuti, orario di lavoro e silenzio nel fuso
    telegram: {
      acceso: tg.acceso === true,
      urgentiDopoMinuti: minuti(tg.urgentiDopoMinuti, 15),
      fuoriOrarioDopoMinuti: minuti(tg.fuoriOrarioDopoMinuti, 30),
      orario: fascia(tg.orario) ? { ...fascia(tg.orario), giorni: Array.isArray(tg.orario.giorni) ? tg.orario.giorni.map(Number) : [1, 2, 3, 4, 5] } : null,
      silenzio: fascia(tg.silenzio),
      specchioPonte: tg.specchioPonte !== false,
      // gli slug delle persone che stanno nel gruppo Telegram: lo specchio porta solo i fili fra loro; assente = tutti i fili
      gruppoPersone: Array.isArray(tg.gruppoPersone) ? tg.gruppoPersone.map(String) : null,
      // la trascrizione locale dei vocali (trascrizione.mjs): false = spenta; assente = i percorsi predefiniti, se i file ci sono
      whisper: tg.whisper === false ? false : whisper(tg.whisper),
    },
    moduli: g.moduli && typeof g.moduli === "object" ? g.moduli : {},
  };
}

let cache = null;

export function config() {
  if (cache) return cache;
  const file = trovaFile();
  let grezzo = {};
  if (file) {
    if (!existsSync(file)) throw new Error(`PLANCIA_CONFIG punta a un file che non c'è: ${file}`);
    try { grezzo = JSON.parse(readFileSync(file, "utf8")); } catch (e) { throw new Error(`${file} non è JSON valido: ${e.message}`); }
  }
  cache = risolvi(grezzo, file);
  return cache;
}

// Per le prove: dimentica la config letta, la prossima chiamata la rilegge.
export function ricarica() { cache = null; return config(); }

// Chi sta usando la plancia: COCKPIT_PERSONA (slug) oppure l'email di git nella cartella di lavoro.
export function chiSono() {
  const cfg = config();
  const forzata = String(process.env.COCKPIT_PERSONA || "").trim().toLowerCase();
  if (forzata) {
    const p = cfg.persone.find((x) => x.slug === forzata);
    if (p) return { ...p, slug: p.slug, nome: p.nome || "", email: p.email, pagina: p.pagina || "/" };
    if (cfg.persone.length) throw new Error(`COCKPIT_PERSONA non valida: "${forzata}" (${cfg.persone.map((x) => x.slug).join(", ")})`);
    return { slug: forzata, nome: forzata, email: "", pagina: "/" };
  }
  const email = String(spawnSync("git", ["config", "user.email"], { cwd: cfg.cartella, encoding: "utf8", windowsHide: true }).stdout || "").trim().toLowerCase();
  const p = cfg.persone.find((x) => x.email === email);
  return p ? { ...p, nome: p.nome || "", email, pagina: p.pagina || "/" } : { slug: "", nome: "", email, pagina: "/" };
}

function leggiEnv(file) {
  let testo; try { testo = readFileSync(file, "utf8"); } catch { return {}; }
  const out = {};
  for (const riga of testo.split("\n")) {
    const m = riga.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || riga.trim().startsWith("#")) continue;
    out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

// Una chiave: variabile d'ambiente, poi il file delle chiavi della config, poi <stato>/chiavi.env. Mai stampata.
export function chiave(nome) {
  if (process.env[nome]) return process.env[nome];
  const cfg = config();
  const file = [cfg.chiavi && path.resolve(cfg.cartella, cfg.chiavi), path.join(dirStato(), "chiavi.env")].filter(Boolean);
  for (const f of file) { const v = leggiEnv(f)[nome]; if (v) return v; }
  return "";
}

// Porta: argomento numerico → COCKPIT_PORTA → config → 4173.
export function portaServer(argv = process.argv.slice(2)) {
  const arg = Number((argv || []).find((a) => /^\d+$/.test(String(a))));
  return arg || Number(process.env.COCKPIT_PORTA) || config().porta || PORTA_DEFAULT;
}

// Come si lancia ctl.mjs da questa cartella (lo scrivono i prompt e le istruzioni agli agenti).
export function comandoCtl() {
  const ctl = path.join(PLANCIA, "ctl.mjs");
  const rel = path.relative(config().cartella, ctl);
  // sempre con "/": su Windows "planciactl.mjs" in Git Bash diventa "planciactl.mjs"; "/" va bene anche in PowerShell e cmd
  const percorso = (rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : ctl).split(path.sep).join("/");
  return `node ${/\s/.test(percorso) ? JSON.stringify(percorso) : percorso}`;
}
