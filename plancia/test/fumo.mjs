#!/usr/bin/env node
// Il controllo automatico della plancia: nessun modello chiamato, meno di un minuto.
//   node plancia/test/fumo.mjs [--solo a,b] [--salta a,b]
// Ogni controllo è un file plancia/test/controlli/<nome>.mjs con `export default async function (t)`. Il runner stampa una
// riga per controllo e il totale; esce 1 se un controllo fallisce. I server di prova partono su una porta libera, con
// stato temporaneo, senza browser (NO_OPEN), senza processi `claude` (COCKPIT_PROVA) e vengono spenti a fine controllo.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { tokenProva } from "../server/identita.mjs";

const qui = path.dirname(fileURLToPath(import.meta.url));
const plancia = path.resolve(qui, "..");
const cartella = path.resolve(plancia, "..");

const opzione = (nome) => { const i = process.argv.indexOf(nome); return i < 0 ? [] : String(process.argv[i + 1] || "").split(",").filter(Boolean); };
const solo = opzione("--solo"), salta = opzione("--salta");

const portaLibera = () => new Promise((ok, no) => {
  const s = net.createServer();
  s.on("error", no);
  s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => ok(port)); });
});

function richiesta(base, metodo, percorso, header = {}, corpo) {
  return new Promise((ok, no) => {
    const u = new URL(base);
    const dati = corpo === undefined ? undefined : typeof corpo === "string" || Buffer.isBuffer(corpo) ? corpo : JSON.stringify(corpo);
    const h = { host: u.host, ...header };
    if (dati !== undefined && !h["content-type"]) h["content-type"] = "application/json";
    const req = http.request({ host: u.hostname, port: u.port, path: percorso, method: metodo, headers: h, agent: false }, (res) => {
      const pezzi = [];
      res.on("data", (d) => pezzi.push(d));
      res.on("end", () => {
        const testo = Buffer.concat(pezzi).toString("utf8");
        ok({ codice: res.statusCode, header: res.headers, testo, json() { return JSON.parse(testo); } });
      });
    });
    req.on("error", no);
    req.setTimeout(15000, () => req.destroy(new Error("timeout")));
    req.end(dati);
  });
}

async function attendi(base, spento) {
  for (let i = 0; i < 100; i++) {
    if (spento()) throw new Error("il server è uscito prima di rispondere");
    try { await richiesta(base, "GET", "/cockpit"); return; } catch { await new Promise((r) => setTimeout(r, 150)); }
  }
  throw new Error("il server non risponde");
}

// Gli agenti della plancia viva hanno nell'ambiente COCKPIT_PORTA, COCKPIT_SESSIONE e magari COCKPIT_STATO: i server e i ctl
// di prova partono da un ambiente senza, altrimenti un controllo potrebbe finire sul server vero.
const ereditate = ["COCKPIT_PORTA", "COCKPIT_SESSIONE", "COCKPIT_TOKEN", "COCKPIT_STATO", "COCKPIT_PROVA_SEME"];
// I token di sessione dei server di prova vengono da un seme (server/identita.mjs): il ctl di prova con COCKPIT_SESSIONE riceve
// il token di quella sessione, come un agente vero; t.token(nome) dà l'header per una richiesta HTTP. COCKPIT_TOKEN nell'env
// del ctl (anche vuoto) vince: così un controllo prova un ctl senza token o con un token sbagliato.
const SEME = randomBytes(8).toString("hex");
const conToken = (env) => ("COCKPIT_TOKEN" in env || !env.COCKPIT_SESSIONE ? env : { ...env, COCKPIT_TOKEN: tokenProva(SEME, env.COCKPIT_SESSIONE) });
function ambientePulito() {
  const env = { ...process.env };
  for (const k of ereditate) delete env[k];
  return env;
}

function creaT(nome) {
  const tmps = [], server = [], messaggi = [];
  let verifiche = 0, fallite = 0;
  const t = {
    cartella, plancia, nome,
    tmp() { const d = mkdtempSync(path.join(os.tmpdir(), "plancia-prova-")); tmps.push(d); return d; },
    async avviaServer(env = {}) {
      const porta = await portaLibera();
      const stato = env.COCKPIT_STATO || t.tmp();
      const figlio = spawn(process.execPath, [path.join(plancia, "server/server.mjs"), String(porta)], {
        cwd: cartella, stdio: ["ignore", "pipe", "pipe"],
        env: { ...ambientePulito(), NO_OPEN: "1", COCKPIT_PROVA: "1", COCKPIT_PERSONA: "anna", COCKPIT_PROVA_SEME: SEME, ...env, COCKPIT_STATO: stato },
      });
      let uscito = false, log = "";
      figlio.on("exit", () => { uscito = true; });
      figlio.stdout.on("data", (d) => { log += d; });
      figlio.stderr.on("data", (d) => { log += d; });
      const base = `http://127.0.0.1:${porta}`;
      const s = {
        porta, base, stato, log: () => log,
        chiudi() {
          return new Promise((ok) => {
            if (uscito) return ok();
            figlio.once("exit", () => ok());
            figlio.kill("SIGTERM");
            setTimeout(() => { if (!uscito) figlio.kill("SIGKILL"); }, 3000).unref();
          });
        },
      };
      server.push(s);
      try { await attendi(base, () => uscito); } catch (e) { throw new Error(`${e.message}\n${log.slice(-600)}`); }
      return s;
    },
    get: (base, percorso, header) => richiesta(base, "GET", percorso, header),
    post: (base, percorso, corpo, header) => richiesta(base, "POST", percorso, header, corpo ?? {}),
    richiesta,
    token: (nome) => ({ "x-cockpit-token": tokenProva(SEME, nome) }),
    ctl(args, env = {}, input) { // input: lo stdin del ctl (per --file -)
      // Senza COCKPIT_STATO il ctl sceglie il server.json della cartella di lavoro, se lì c'è una plancia accesa: la prova
      // finirebbe sul server vero, e i suoi messaggi con lui. Ogni ctl di prova dice lo stato del suo server (vuoto solo apposta, per provare
      // la scelta del server).
      if (!("COCKPIT_STATO" in env)) throw new Error(`t.ctl(${JSON.stringify(args[0])}) senza COCKPIT_STATO: il ctl potrebbe parlare con la plancia accesa`);
      const r = spawnSync(process.execPath, [path.join(plancia, "ctl.mjs"), ...args], {
        cwd: cartella, encoding: "utf8", timeout: 30000, env: { ...ambientePulito(), ...conToken(env) }, ...(input !== undefined ? { input } : {}),
      });
      return { codice: r.status, out: `${r.stdout || ""}${r.stderr || ""}` };
    },
    ok(condizione, messaggio) {
      verifiche++;
      if (!condizione) { fallite++; messaggi.push(messaggio || "verifica fallita"); }
    },
    nota(testo) { messaggi.push(testo); },
  };
  const chiudiTutto = async () => {
    for (const s of server) await s.chiudi();
    for (const d of tmps) rmSync(d, { recursive: true, force: true });
  };
  return { t, chiudiTutto, esito: () => ({ verifiche, fallite, messaggi }) };
}

const nomi = readdirSync(path.join(qui, "controlli")).filter((f) => f.endsWith(".mjs")).map((f) => f.slice(0, -4)).sort();
const eseguire = nomi.filter((n) => (!solo.length || solo.includes(n)) && !salta.includes(n));
for (const n of [...solo, ...salta]) if (!nomi.includes(n)) { console.error(`controllo sconosciuto: ${n} (${nomi.join(", ")})`); process.exit(2); }

// Le to-do dei moduli: i controlli girano su un backend in memoria con voci inventate, mai sul database vero. Senza il file delle
// voci di prova (il nucleo da solo) non serve. Le variabili passano ai server e ai ctl di prova (ambientePulito parte da process.env).
const cartellaTodo = mkdtempSync(path.join(os.tmpdir(), "plancia-todo-"));
if (existsSync(path.join(qui, "todo-prova.mjs"))) {
  const { scriviFixtureTodo } = await import("./todo-prova.mjs");
  process.env.TODO_BACKEND = "memoria";
  process.env.TODO_FIXTURE = await scriviFixtureTodo(path.join(cartellaTodo, "todo.json"));
}

let falliti = 0;
for (const nome of eseguire) {
  const { t, chiudiTutto, esito } = creaT(nome);
  const inizio = Date.now();
  let errore = "";
  try {
    const modulo = await import(pathToFileURL(path.join(qui, "controlli", `${nome}.mjs`)).href);
    await modulo.default(t);
  } catch (e) { errore = e.stack?.split("\n").slice(0, 3).join(" | ") || String(e); }
  await chiudiTutto();
  const { verifiche, fallite, messaggi } = esito();
  const bene = !errore && !fallite;
  if (!bene) falliti++;
  console.log(`${bene ? "ok" : "KO"}  ${nome.padEnd(14)} ${verifiche} verifiche, ${fallite} fallite, ${((Date.now() - inizio) / 1000).toFixed(1)}s`);
  if (!bene || messaggi.length) for (const m of messaggi.slice(0, 40)) console.log(`      ${m}`);
  if (errore) console.log(`      eccezione: ${errore}`);
}
rmSync(cartellaTodo, { recursive: true, force: true });
console.log(`\n${eseguire.length - falliti}/${eseguire.length} controlli verdi${falliti ? `, ${falliti} rossi` : ""}`);
process.exit(falliti ? 1 : 0);
