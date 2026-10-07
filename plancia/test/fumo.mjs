#!/usr/bin/env node
// Il controllo automatico della plancia: nessun modello chiamato, meno di un minuto.
//   node plancia/test/fumo.mjs [--solo a,b] [--salta a,b]
// Ogni controllo è un file plancia/test/controlli/<nome>.mjs con `export default async function (t)`. Il runner stampa una
// riga per controllo e il totale; esce 1 se un controllo fallisce. I server di prova partono su una porta libera, con
// stato temporaneo, senza browser (NO_OPEN), senza processi `claude` (COCKPIT_PROVA) e vengono spenti a fine controllo.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
    const req = http.request({ host: u.hostname, port: u.port, path: percorso, method: metodo, headers: h }, (res) => {
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
const ereditate = ["COCKPIT_PORTA", "COCKPIT_SESSIONE", "COCKPIT_STATO"];
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
        env: { ...ambientePulito(), NO_OPEN: "1", COCKPIT_PROVA: "1", COCKPIT_PERSONA: "prova", ...env, COCKPIT_STATO: stato },
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
    ctl(args, env = {}) {
      const r = spawnSync(process.execPath, [path.join(plancia, "ctl.mjs"), ...args], {
        cwd: cartella, encoding: "utf8", timeout: 30000, env: { ...ambientePulito(), ...env },
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

let falliti = 0;
for (const nome of eseguire) {
  const { t, chiudiTutto, esito } = creaT(nome);
  const inizio = Date.now();
  let errore = "";
  try {
    const modulo = await import(path.join(qui, "controlli", `${nome}.mjs`));
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
console.log(`\n${eseguire.length - falliti}/${eseguire.length} controlli verdi${falliti ? `, ${falliti} rossi` : ""}`);
process.exit(falliti ? 1 : 0);
