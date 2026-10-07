#!/usr/bin/env node
// Copia il nucleo del cockpit (la cartella plancia/ della repo dove nasce) dentro plancia/ del pacchetto, e lo verifica.
//   node scripts/importa-nucleo.mjs <percorso della cartella plancia/ sorgente> [--commit <hash>] [--prova]
// Prende il nucleo com'è in un commit (default HEAD) con `git archive`: le modifiche non committate della sorgente non entrano.
// Si ferma, lasciando plancia/ com'era, se: mancano file attesi, la scansione trova
// qualcosa che non deve uscire, un file non passa `node --check`. Con --prova fa tutto in una cartella temporanea.
//
// La scansione (scripts/scansione.mjs) cerca segreti, email, percorsi personali e le parole private elencate fuori dalla repo
// (GIARBIS_PAROLE, di default ~/.config/giarbis/parole-private.txt: la lista stessa non deve finire nel pacchetto).
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scansiona } from "./scansione.mjs";

const PACCHETTO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEST = path.join(PACCHETTO, "plancia");
const argv = process.argv.slice(2);
const prova = argv.includes("--prova");
const iCommit = argv.indexOf("--commit");
const commit = iCommit >= 0 ? argv[iCommit + 1] : "HEAD";
const sorgente = path.resolve(argv.find((a, i) => !a.startsWith("--") && i !== iCommit + 1) || "");

// Cosa non entra: i moduli della repo d'origine, le loro prove, la mappa d'origine (sostituita da nucleo/CLAUDE.md),
// il controllo del confine d'origine (la sua lista di parole è privata).
const ESCLUSI = [/^moduli\/rd-[^/]*/, /^dashboard(\/|$)/, /^CLAUDE\.md$/, /^test\/controlli\/(rd-[^/]*|confine)\.mjs$/,
  /(^|\/)\.DS_Store$/, /\.tmp-\d+$/];
const ATTESI = ["ctl.mjs", "server/server.mjs", "server/config.mjs", "server/prompt.mjs", "server/moduli.mjs",
  "prompt/assistente.md", "prompt/agente.md", "prompt/setup.md", "pagine/cockpit/index.html", "test/fumo.mjs"];
// Ritocchi ai commenti del nucleo: i riferimenti alle voci di lavoro interne e ai moduli d'origine non dicono niente a chi usa il pacchetto.
const RITOCCHI = [
  [/\s*\((?:G|RD|A|INC)-\d{3}[^)\n]*\)/g, ""],
  [/ \(scripts\/db\) e i pannelli in git del modulo rd-dashboard/g, " dei moduli"],
  [/"g[i]useppe"/g, '"prova"'], // la persona finta delle prove d'origine
];

let tmp = "";
function ferma(msg) { if (tmp) rmSync(tmp, { recursive: true, force: true }); console.error(`✗ ${msg}`); process.exit(1); }
const git = (...a) => spawnSync("git", ["-C", sorgente, ...a], { encoding: "utf8" });

function* file(dir) {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) yield* file(p); else yield p;
  }
}

if (!sorgente || !existsSync(path.join(sorgente, "ctl.mjs"))) ferma(`non è la cartella plancia/ del nucleo: ${sorgente}`);
const hash = git("rev-parse", "--verify", `${commit}^{commit}`).stdout.trim();
if (!hash) ferma(`commit sconosciuto nella sorgente: ${commit}`);

tmp = mkdtempSync(path.join(tmpdir(), "giarbis-nucleo-"));
const grezzo = path.join(tmp, "grezzo");
mkdirSync(grezzo);
const arch = spawnSync("sh", ["-c", `git -C "$1" archive "$2" . | tar -x -C "$3"`, "sh", sorgente, hash, grezzo], { encoding: "utf8" });
if (arch.status !== 0) ferma(`git archive: ${arch.stderr}`);
const nuovo = path.join(tmp, "plancia");
cpSync(grezzo, nuovo, { recursive: true, filter: (f) => !ESCLUSI.some((re) => re.test(path.relative(grezzo, f).split(path.sep).join("/"))) });

for (const f of file(nuovo)) {
  if (!/\.(mjs|js|css|html)$/.test(f)) continue;
  const prima = readFileSync(f, "utf8");
  const dopo = RITOCCHI.reduce((t, [re, s]) => t.replace(re, s), prima);
  if (dopo !== prima) writeFileSync(f, dopo);
}

// I file del pacchetto sopra il nucleo
cpSync(path.join(PACCHETTO, "nucleo", "CLAUDE.md"), path.join(nuovo, "CLAUDE.md"));
const modelloConfig = readFileSync(path.join(PACCHETTO, "modelli", "plancia.config.esempio.json"), "utf8").trim();
for (const n of readdirSync(path.join(PACCHETTO, "prompt"))) {
  if (!n.endsWith(".md") || n === "LEGGIMI.md") continue;
  const testo = readFileSync(path.join(PACCHETTO, "prompt", n), "utf8").replace("{{modello_config}}", modelloConfig);
  writeFileSync(path.join(nuovo, "prompt", n), testo);
}

const mancanti = ATTESI.filter((f) => !existsSync(path.join(nuovo, f)));
if (mancanti.length) ferma(`mancano nel nucleo: ${mancanti.join(", ")}`);

const trovate = scansiona(nuovo);
if (trovate.length) ferma(`la scansione ha trovato ${trovate.length} righe che non devono uscire (da togliere nella repo d'origine o nei ritocchi):\n${trovate.join("\n")}`);

for (const f of file(nuovo)) if (/\.(mjs|js)$/.test(f)) {
  const r = spawnSync(process.execPath, ["--check", f], { encoding: "utf8" });
  if (r.status !== 0) ferma(`node --check: ${path.relative(nuovo, f)}\n${r.stderr}`);
}

writeFileSync(path.join(nuovo, "NUCLEO.txt"), `Nucleo del cockpit, commit ${hash.slice(0, 12)}, importato il ${new Date().toISOString().slice(0, 10)}.\nNon si modifica qui: si corregge all'origine e si reimporta.\n`);
if (prova) { console.log(`✓ prova verde, nucleo ${hash.slice(0, 8)} in ${nuovo} (plancia/ non toccata)`); process.exit(0); }
rmSync(DEST, { recursive: true, force: true });
renameSync(nuovo, DEST);
rmSync(tmp, { recursive: true, force: true });
console.log(`✓ nucleo ${hash.slice(0, 8)} importato in plancia/. Ora: node plancia/test/fumo.mjs, poi test/prova-da-zero.md`);
