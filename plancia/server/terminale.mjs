// Il terminale della plancia: una shell vera sul Mac di chi usa la plancia, dentro una pseudo-tty, senza dipendenze npm.
// La pty la alloca il comando di sistema `script` (macOS: `script -q /dev/null <cmd>`; Linux: `script -qfec <cmd> /dev/null`,
// non provato). `script` vuole uno stdin che regga tcgetattr: i pipe di Node sono socket e non lo reggono, quindi lo stdin gli
// arriva da `cat |`. La dimensione iniziale la mette `stty` prima della shell; il ridimensionamento la cambia da fuori con
// `stty -f /dev/ttysN` (Linux: `-F`) sulla tty della shell, trovata con `ps`: il kernel manda SIGWINCH e la shell ridisegna.
//
// Sicurezza (è una shell): la rotta di creazione vuole X-Dashboard e un'Origin della plancia (server/rotte/terminale.mjs); ogni
// terminale ha un token casuale, richiesto su ogni richiesta, stream compreso; il processo muore se nessuno stream è collegato
// per GRAZIA_MS (pagina chiusa), dopo INATTIVO_MS senza input né output, e all'uscita del server. L'input non va mai su disco:
// resta in memoria solo l'ultimo pezzo di output, per ridisegnare dopo una riconnessione.
import { execFile, spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { StringDecoder } from "node:string_decoder";

export const MASSIMO_TERMINALI = 4;
const GRAZIA_MS = 15000; // senza stream collegato per tanto, il terminale si chiude (pagina chiusa o ricaricata e non tornata)
const INATTIVO_MS = 60 * 60 * 1000; // un'ora senza input né output
const STORIA = 128 * 1024; // caratteri di output tenuti per una riconnessione
const MAX_INPUT = 256 * 1024;
const KEEPALIVE_MS = 20000;

const terminali = new Map(); // id → terminale
let chiusuraAllUscita = false;

const intero = (v, min, max, def) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };

function comandoPty() {
  // la shell e la dimensione passano per l'ambiente: nessuna stringa costruita a mano dentro il comando
  const dentro = 'stty rows "$PLANCIA_RIGHE" cols "$PLANCIA_COLONNE" 2>/dev/null; s="$PLANCIA_SHELL"; unset PLANCIA_RIGHE PLANCIA_COLONNE PLANCIA_SHELL; exec "$s" -l';
  const q = (t) => `'${t.replace(/'/g, "'\\''")}'`;
  if (process.platform === "linux") return `cat | exec script -qfec ${q(dentro)} /dev/null`;
  return `cat | exec script -q /dev/null /bin/sh -c ${q(dentro)}`;
}

function scriviSse(res, ogg) { try { res.write(`data: ${JSON.stringify(ogg)}\n\n`); } catch { /* stream chiuso */ } }

export function supportato() { return process.platform === "darwin" || process.platform === "linux"; }

export function crea({ cartella, righe, colonne }) {
  if (!supportato()) throw new Error(`il terminale della plancia funziona solo su macOS e Linux (qui ${process.platform}): apri un terminale tuo nella cartella ${cartella}`);
  if (terminali.size >= MASSIMO_TERMINALI) throw new Error(`al massimo ${MASSIMO_TERMINALI} terminali aperti`);
  if (!chiusuraAllUscita) { process.on("exit", chiudiTutti); chiusuraAllUscita = true; }
  const id = `t-${randomBytes(4).toString("hex")}`;
  const token = randomBytes(24).toString("hex");
  const r = intero(righe, 5, 300, 30), k = intero(colonne, 20, 500, 100);
  const env = { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor", PLANCIA_RIGHE: String(r), PLANCIA_COLONNE: String(k), PLANCIA_SHELL: process.env.SHELL || "/bin/zsh" };
  delete env.COCKPIT_SESSIONE; delete env.COCKPIT_TOKEN; // la shell è della persona, non di un agente
  if (!/utf-?8/i.test(env.LANG || env.LC_ALL || env.LC_CTYPE || "")) env.LANG = "en_US.UTF-8";
  const p = spawn("/bin/sh", ["-c", comandoPty()], { cwd: cartella, env, stdio: ["pipe", "pipe", "pipe"], detached: true, windowsHide: true });
  const t = {
    id, token, p, righe: r, colonne: k, creato: Date.now(), ultimo: Date.now(), tty: null,
    storia: "", res: null, keepalive: null, grazia: null, inattivo: null, finito: false, codice: null,
  };
  const dec = new StringDecoder("utf8");
  const esce = (d) => {
    const testo = dec.write(d);
    if (!testo) return;
    t.ultimo = Date.now();
    t.storia = (t.storia + testo).slice(-STORIA);
    if (t.res) scriviSse(t.res, { o: testo });
  };
  p.stdout.on("data", esce);
  p.stderr.on("data", esce);
  p.stdin.on("error", () => {});
  p.on("error", (e) => fine(t, null, e.message));
  p.on("exit", (codice, segnale) => fine(t, codice ?? segnale));
  terminali.set(id, t);
  aspettaStream(t);
  t.inattivo = setInterval(() => { if (Date.now() - t.ultimo > INATTIVO_MS) chiudi(id); }, 60000);
  t.inattivo.unref();
  return { id, token, righe: r, colonne: k };
}

function fine(t, codice, errore) {
  if (t.finito) return;
  t.finito = true;
  t.codice = codice;
  if (t.res) { scriviSse(t.res, { fine: true, codice, errore: errore || undefined }); t.res.end(); }
  pulisci(t);
}

function pulisci(t) {
  clearInterval(t.inattivo); clearInterval(t.keepalive); clearTimeout(t.grazia);
  terminali.delete(t.id);
}

function aspettaStream(t) {
  clearTimeout(t.grazia);
  t.grazia = setTimeout(() => chiudi(t.id), GRAZIA_MS);
  t.grazia.unref();
}

export function trova(id, token) {
  const t = terminali.get(String(id || ""));
  if (!t) return null;
  const a = Buffer.from(String(token || "")), b = Buffer.from(t.token);
  return a.length === b.length && timingSafeEqual(a, b) ? t : null;
}

// Lo stream dell'output: uno per terminale; uno nuovo (riconnessione) prende il posto del vecchio e riceve la storia.
export function collega(t, req, res) {
  if (t.res) { try { t.res.end(); } catch { /* già chiuso */ } }
  clearInterval(t.keepalive);
  clearTimeout(t.grazia);
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
  res.write(": ok\n\n");
  t.res = res;
  scriviSse(res, { storia: t.storia, righe: t.righe, colonne: t.colonne });
  t.keepalive = setInterval(() => { try { res.write(": .\n\n"); } catch { /* chiuso */ } }, KEEPALIVE_MS);
  t.keepalive.unref();
  req.on("close", () => {
    if (t.res !== res) return;
    t.res = null;
    clearInterval(t.keepalive);
    if (!t.finito) aspettaStream(t);
  });
}

export function scrivi(t, dati) {
  const s = String(dati ?? "");
  if (s.length > MAX_INPUT) throw new Error("input troppo lungo");
  if (t.finito) throw new Error("il terminale è chiuso");
  t.ultimo = Date.now();
  t.p.stdin.write(s);
}

// La tty della shell: figlia di `script`, figlio di /bin/sh (il nostro processo). Una volta trovata resta in memoria.
function trovaTty(t) {
  if (t.tty) return Promise.resolve(t.tty);
  return new Promise((ok) => {
    execFile("ps", ["-A", "-o", "pid=,ppid=,tty=,comm="], { windowsHide: true }, (err, out) => {
      if (err) return ok(null);
      const righe = String(out).trim().split("\n").map((r) => r.trim().split(/\s+/));
      const scr = righe.find((r) => r[1] === String(t.p.pid) && /script$/.test(r[3] || ""));
      const sh = scr && righe.find((r) => r[1] === scr[0] && r[2] && r[2] !== "??" && r[2] !== "?");
      t.tty = sh ? `/dev/${sh[2]}` : null;
      ok(t.tty);
    });
  });
}

export async function ridimensiona(t, righe, colonne) {
  const r = intero(righe, 5, 300, t.righe), k = intero(colonne, 20, 500, t.colonne);
  if (r === t.righe && k === t.colonne) return { righe: r, colonne: k };
  const tty = await trovaTty(t);
  if (!tty || !/^\/dev\/(ttys?\d+|pts\/\d+)$/.test(tty)) throw new Error("tty della shell non trovata: ridimensionamento non fatto");
  await new Promise((ok, no) => execFile("stty", [process.platform === "linux" ? "-F" : "-f", tty, "rows", String(r), "cols", String(k)], { windowsHide: true }, (e) => (e ? no(new Error(`stty: ${e.message}`)) : ok())));
  t.righe = r; t.colonne = k;
  return { righe: r, colonne: k };
}

// Chiude la shell: SIGHUP al gruppo (sh, cat, script); la shell, in un'altra sessione, riceve SIGHUP quando la pty si chiude.
export function chiudi(id) {
  const t = terminali.get(id);
  if (!t) return false;
  try { process.kill(-t.p.pid, "SIGHUP"); } catch { /* già uscito */ }
  const duro = setTimeout(() => { try { process.kill(-t.p.pid, "SIGKILL"); } catch { /* già uscito */ } }, 2000);
  duro.unref();
  fine(t, null);
  return true;
}

export function chiudiTutti() {
  for (const id of [...terminali.keys()]) chiudi(id);
}

export function elenco() {
  return [...terminali.values()].map((t) => ({ id: t.id, righe: t.righe, colonne: t.colonne, creato: t.creato, collegato: !!t.res }));
}
