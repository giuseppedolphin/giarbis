#!/usr/bin/env node
// La scansione di sicurezza del pacchetto: niente segreti, email, percorsi personali, stato del cockpit, né le parole private
// (persone, clienti, aziende) elencate in un file FUORI dalla repo: GIARBIS_PAROLE, di default ~/.config/giarbis/parole-private.txt.
//   node scripts/scansione.mjs [cartella]          → scansiona la cartella (default: il pacchetto, senza .git e node_modules)
//   node scripts/scansione.mjs --storia            → scansiona anche ogni versione di ogni file nella storia git
// Esce 1 se trova qualcosa. Senza il file delle parole private avvisa e controlla solo il resto.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACCHETTO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE_PAROLE = process.env.GIARBIS_PAROLE || path.join(os.homedir(), ".config", "giarbis", "parole-private.txt");

const GENERICI = [
  ["chiave", /\b(sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|xi-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})/],
  ["chiave in chiaro", /\b(OPENAI_API_KEY|ELEVENLABS_API_KEY|ANTHROPIC_API_KEY)\s*=\s*['"]?[A-Za-z0-9_-]{12,}/],
  ["email", /\b[A-Za-z0-9._%+-]+@(?![A-Za-z]\.it\b|esempio\.it\b|example\.com\b|anthropic\.com\b|users\.noreply\.github\.com\b)[A-Za-z0-9.-]+\.[a-z]{2,}\b/],
  ["percorso personale", /\/Users\/(?!<|nome\b|tuonome\b)[A-Za-z0-9._-]+|\/home\/(?!<|nome\b)[A-Za-z0-9._-]+\//],
  ["id interno", /\b(?:G|RD|A|INC)-\d{3}\b/],
];

function parolePrivate() {
  if (!existsSync(FILE_PAROLE)) { console.error(`! manca ${FILE_PAROLE}: controllo solo segreti, email e percorsi`); return []; }
  return readFileSync(FILE_PAROLE, "utf8").split("\n").map((r) => r.trim()).filter((r) => r && !r.startsWith("#")).map((r) => new RegExp(r, "i"));
}

function controllaTesto(testo, dove, private_, out) {
  testo.split("\n").forEach((riga, i) => {
    for (const [nome, re] of GENERICI) if (re.test(riga)) out.push(`${dove}:${i + 1} [${nome}] ${riga.trim().slice(0, 120)}`);
    for (const re of private_) if (re.test(riga)) out.push(`${dove}:${i + 1} [privata: ${re.source}] ${riga.trim().slice(0, 120)}`);
  });
}

const TESTO = /\.(mjs|js|cjs|json|md|html|css|txt|svg|yml|yaml|env|sh)$|^(LICENSE|\.gitignore|\.npmignore)$/;

function* file(dir) {
  for (const n of readdirSync(dir)) {
    if (n === ".git" || n === "node_modules") continue;
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) yield* file(p); else yield p;
  }
}

export function scansiona(cartella = PACCHETTO) {
  const private_ = parolePrivate(), out = [];
  for (const f of file(cartella)) {
    const rel = path.relative(cartella, f);
    if (/(^|\/)\.plancia(\/|$)/.test(rel)) { out.push(`${rel} [stato del cockpit nel pacchetto]`); continue; }
    if (/\.(tgz|zip)$/.test(rel)) { out.push(`${rel} [archivio nel pacchetto]`); continue; }
    if (TESTO.test(path.basename(f))) controllaTesto(readFileSync(f, "utf8"), rel, private_, out);
  }
  return out;
}

// Ogni blob raggiungibile da qualsiasi ref, più autore e messaggio di ogni commit.
export function scansionaStoria(cartella = PACCHETTO) {
  const private_ = parolePrivate(), out = [];
  const g = (...a) => spawnSync("git", ["-C", cartella, ...a], { encoding: "utf8", maxBuffer: 1 << 28 }).stdout || "";
  if (!g("rev-parse", "--verify", "HEAD").trim()) return out;
  for (const riga of g("log", "--all", "--format=%H%x09%an <%ae>%x09%cn <%ce>%x09%B%x00").split("\0")) {
    const [h, autore, committer, ...msg] = riga.trim().split("\t");
    if (!h) continue;
    controllaTesto(`${autore}\n${committer}\n${msg.join("\t")}`, `commit ${h.slice(0, 8)}`, private_, out);
  }
  const visti = new Set();
  for (const riga of g("rev-list", "--all", "--objects").split("\n")) {
    const [sha, nome] = riga.split(" ");
    if (!nome || visti.has(sha)) continue;
    visti.add(sha);
    if (g("cat-file", "-t", sha).trim() !== "blob") continue;
    if (/(^|\/)\.plancia(\/|$)/.test(nome)) { out.push(`storia:${nome} [stato del cockpit]`); continue; }
    if (TESTO.test(path.basename(nome))) controllaTesto(g("cat-file", "-p", sha), `storia:${nome}@${sha.slice(0, 7)}`, private_, out);
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const storia = process.argv.includes("--storia");
  const cartella = path.resolve(process.argv.slice(2).find((a) => !a.startsWith("--")) || PACCHETTO);
  const trovate = [...scansiona(cartella), ...(storia ? scansionaStoria(cartella) : [])];
  for (const t of trovate) console.log(t);
  console.log(trovate.length ? `✗ ${trovate.length} righe da togliere` : `✓ scansione pulita${storia ? " (anche la storia git)" : ""}`);
  process.exit(trovate.length ? 1 : 0);
}
