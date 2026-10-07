#!/usr/bin/env node
// Il comando `giarbis`: controlli, cartella e porta, primo avvio, telecomando. Flusso: docs/primo-avvio.md.
//
//   giarbis [--porta N] [--cartella P]   avvia il cockpit nella cartella (primo avvio se manca plancia.config.json)
//   giarbis setup                         rifà il setup anche con la config presente
//   giarbis controlla [--config]          prerequisiti (e, con --config, la configurazione)
//   giarbis ctl <comando…>                il telecomando del cockpit (lo usano gli agenti)
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACCHETTO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NUCLEO = path.join(PACCHETTO, "plancia");
const SERVER = path.join(NUCLEO, "server", "server.mjs");
const CTL = path.join(NUCLEO, "ctl.mjs");
const MODULI = path.join(PACCHETTO, "moduli");
const NOME_CONFIG = "plancia.config.json";
const PORTA_DEFAULT = 4747;
const versione = () => JSON.parse(readFileSync(path.join(PACCHETTO, "package.json"), "utf8")).version;

function opzioni(argv) {
  const o = { comando: "avvia", resto: [], porta: 0, cartella: process.cwd(), config: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (i === 0 && ["setup", "controlla", "ctl", "aiuto"].includes(a)) { o.comando = a; if (a === "ctl") { o.resto = argv.slice(1); break; } continue; }
    if (a === "--porta") o.porta = Number(argv[++i]) || 0;
    else if (a === "--cartella") o.cartella = path.resolve(argv[++i] || ".");
    else if (a === "--config") o.config = true;
    else if (a === "--versione" || a === "-v" || a === "--version") o.comando = "versione";
    else if (a === "--help" || a === "-h") o.comando = "aiuto";
    else { console.error(`Non conosco «${a}». Scrivi: giarbis aiuto`); process.exit(2); }
  }
  return o;
}

function trovaConfig(dir) {
  for (;;) {
    const f = path.join(dir, NOME_CONFIG);
    if (existsSync(f)) return f;
    const su = path.dirname(dir);
    if (su === dir) return "";
    dir = su;
  }
}

const esegui = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, encoding: "utf8" });

function portaLibera(porta) {
  return new Promise((ok) => {
    const s = createServer().once("error", () => ok(false)).once("listening", () => s.close(() => ok(true)));
    s.listen(porta, "127.0.0.1");
  });
}

async function scegliPorta(voluta) {
  for (let p = voluta; p < voluta + 20; p++) if (await portaLibera(p)) return p;
  return 0;
}

// Una riga per controllo: { ok: true|false|null (informazione), testo, rimedio }
function controlli(cartella, conConfig) {
  const r = [];
  const [maggiore] = process.versions.node.split(".").map(Number);
  r.push(maggiore >= 20
    ? { ok: true, testo: `Node ${process.versions.node}` }
    : { ok: false, testo: `Node ${process.versions.node}: serve la 20 o più recente`, rimedio: "scarica la versione LTS da nodejs.org" });

  const v = esegui("claude", ["--version"]);
  if (v.error || v.status !== 0) {
    r.push({ ok: false, testo: "Claude Code non trovato", rimedio: "installalo (README, «Cosa ti serve prima») e riapri il Terminale" });
  } else {
    const ver = v.stdout.trim().split(/\s/)[0];
    let auth = {};
    try { auth = JSON.parse(esegui("claude", ["auth", "status", "--json"]).stdout || "{}"); } catch {}
    r.push(auth.loggedIn
      ? { ok: true, testo: `Claude Code ${ver}, collegato${auth.email ? ` come ${auth.email}` : ""}${auth.subscriptionType ? ` (piano ${auth.subscriptionType})` : ""}` }
      : { ok: false, testo: `Claude Code ${ver}, ma non collegato a un account`, rimedio: "scrivi claude nel Terminale, fai il login, esci con /exit" });
  }

  const g = esegui("git", ["--version"]);
  r.push(g.error ? { ok: false, testo: "git non trovato", rimedio: "scrivi xcode-select --install nel Terminale" } : { ok: true, testo: "git" });

  r.push(existsSync(SERVER)
    ? { ok: true, testo: "nucleo del cockpit presente" }
    : { ok: false, testo: "nucleo del cockpit mancante in questo pacchetto", rimedio: "pacchetto incompleto: chiedi a chi te l'ha mandato" });

  const file = trovaConfig(cartella);
  if (!file) r.push({ ok: null, testo: "nessuna configurazione in questa cartella: al primo avvio parte il setup" });
  else if (!conConfig) r.push({ ok: true, testo: `configurazione: ${file}` });
  else {
    try {
      const c = JSON.parse(readFileSync(file, "utf8"));
      if (c.porta !== undefined && !(Number.isInteger(c.porta) && c.porta > 1023 && c.porta < 65536)) throw new Error("«porta» deve essere un numero fra 1024 e 65535");
      if (c.assistente && typeof c.assistente.nome !== "string") throw new Error("«assistente.nome» deve essere un testo");
      r.push({ ok: true, testo: `configurazione valida: ${file}` });
    } catch (e) {
      r.push({ ok: false, testo: `configurazione da correggere (${file}): ${e.message}`, rimedio: "giarbis setup la rifà con te" });
    }
  }
  return r;
}

function stampa(righe) {
  for (const x of righe) {
    console.log(`${x.ok === true ? "✓" : x.ok === false ? "✗" : "·"} ${x.testo}`);
    if (x.ok === false && x.rimedio) console.log(`    → ${x.rimedio}`);
  }
  return righe.every((x) => x.ok !== false);
}

const vivo = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
function pidServer(cartella) {
  const f = path.join(process.env.COCKPIT_STATO || path.join(cartella, ".plancia"), "server.json");
  try { return Number(JSON.parse(readFileSync(f, "utf8")).pid) || 0; } catch { return 0; }
}

function apriBrowser(url) {
  if (process.env.NO_OPEN || process.platform === "darwin") return; // su macOS lo apre il server
  const cmd = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try { spawn(cmd[0], cmd[1], { stdio: "ignore", detached: true }).unref(); } catch {}
}

async function avvia(o, forzaSetup) {
  if (!stampa(controlli(o.cartella, false).filter((x) => x.ok === false))) process.exit(1);
  let file = trovaConfig(o.cartella);
  if (forzaSetup && file) { // giarbis setup: la config di prima resta accanto, il setup riparte da zero
    renameSync(file, `${file}.prima`);
    console.log(`La configurazione di prima è in ${path.basename(file)}.prima: il setup la può leggere.`);
    file = "";
  }
  const cartella = file ? path.dirname(file) : o.cartella;
  let voluta = o.porta || PORTA_DEFAULT;
  if (!o.porta && file) { try { voluta = Number(JSON.parse(readFileSync(file, "utf8")).porta) || PORTA_DEFAULT; } catch {} }
  const porta = await scegliPorta(voluta);
  if (!porta) { console.error(`Le porte da ${voluta} a ${voluta + 19} sono tutte occupate. Scegline un'altra: giarbis --porta 5000`); process.exit(1); }
  if (porta !== voluta) console.log(`La porta ${voluta} è occupata: uso la ${porta}.`);

  // PLANCIA_PRIMO_AVVIO sempre: senza config fa partire il setup; con la config fa solo il benvenuto alla prima accensione
  // dell'assistente (anche dopo il Riavvia, che eredita l'ambiente). PLANCIA_MODULI_EXTRA: i moduli del pacchetto.
  const env = { ...process.env, COCKPIT_PORTA: String(porta), PLANCIA_PRIMO_AVVIO: "1", PLANCIA_MODULI_EXTRA: MODULI };
  delete env.COCKPIT_SESSIONE; delete env.COCKPIT_ATTESA; // ereditate se si lancia da dentro un altro cockpit
  const url = `http://127.0.0.1:${porta}/`;
  console.log(file ? `Giarbis è su ${url}  (per fermarlo premi Ctrl+C)` : `Primo avvio: la configurazione si fa nel browser, su ${url}  (per fermarlo premi Ctrl+C)`);
  const figlio = spawn(process.execPath, [SERVER, String(porta)], { cwd: cartella, env, stdio: ["ignore", "ignore", "inherit"] });
  apriBrowser(url);

  // Il Riavvia della pagina lancia un server nuovo staccato e chiude questo: il comando resta acceso finché vive il nuovo,
  // e Ctrl+C ferma quello.
  let attuale = 0;
  const ferma = () => {
    if (attuale && vivo(attuale)) process.kill(attuale, "SIGTERM"); else figlio.kill("SIGTERM");
    setTimeout(() => process.exit(0), 500);
  };
  process.on("SIGINT", ferma);
  process.on("SIGTERM", ferma);
  figlio.on("exit", async (code) => {
    for (let i = 0; i < 40; i++) { // il nuovo server scrive server.json appena ascolta
      const pid = pidServer(cartella);
      if (pid && pid !== figlio.pid && vivo(pid)) { attuale = pid; break; }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!attuale) process.exit(code ?? 0);
    console.log("Giarbis riavviato.");
    const giro = setInterval(() => { if (!vivo(attuale)) { clearInterval(giro); process.exit(0); } }, 1000);
  });
}

const AIUTO = `giarbis — cockpit per Claude Code

  giarbis                 avvia il cockpit nella cartella dove sei (la prima volta parte il setup)
  giarbis --porta 4800    su una porta scelta da te
  giarbis --cartella P    in un'altra cartella
  giarbis setup           rifà il setup
  giarbis controlla       controlla che ci sia tutto
  giarbis --versione

Istruzioni complete: il README del pacchetto.`;

const o = opzioni(process.argv.slice(2));
if (o.comando === "versione") console.log(versione());
else if (o.comando === "aiuto") console.log(AIUTO);
else if (o.comando === "controlla") process.exit(stampa(controlli(o.cartella, o.config)) ? 0 : 1);
else if (o.comando === "ctl") {
  if (!existsSync(CTL)) { console.error("nucleo del cockpit mancante in questo pacchetto"); process.exit(1); }
  const r = spawnSync(process.execPath, [CTL, ...o.resto], { stdio: "inherit", env: { ...process.env, PLANCIA_MODULI_EXTRA: MODULI } });
  process.exit(r.status ?? 1);
} else await avvia(o, o.comando === "setup");
