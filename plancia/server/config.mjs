// La configurazione della plancia: UN file, plancia.config.json, nella cartella di lavoro (la si cerca risalendo da
// process.cwd(), come fa git; PLANCIA_CONFIG la forza). Senza file valgono i default e la plancia parte lo stesso.
// Tutto il resto del nucleo chiede qui: cartella di lavoro, porta, persona, chiavi, nome dell'assistente, moduli accesi.
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
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

const elenco = (v, base) => (Array.isArray(v) ? v.map(String) : base);

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
  const b = g.battito || {}, k = g.conservazione || {}, m = g.modelli || {};
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
  const email = String(spawnSync("git", ["config", "user.email"], { cwd: cfg.cartella, encoding: "utf8" }).stdout || "").trim().toLowerCase();
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
  const percorso = rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : ctl;
  return `node ${/\s/.test(percorso) ? JSON.stringify(percorso) : percorso}`;
}
