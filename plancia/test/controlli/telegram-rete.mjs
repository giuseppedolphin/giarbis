// Telegram sulla rete: l'API vera parla HTTP/2, e il fetch di Node 26 metteva sendMessage in coda dietro il long
// polling di getUpdates sulla stessa connessione, fino al timeout. Qui un'API finta TLS con HTTP/2 (e HTTP/1.1), certificato fatto
// al momento con openssl e fidato solo nel processo di prova: un invio mentre getUpdates aspetta parte subito; una connessione
// rifiutata prima di arrivare si ritenta da sola e il messaggio arriva una volta; un invio arrivato senza risposta non si ritenta
// ed è «incerto»; connessioni sempre rifiutate: tre tentativi, niente arrivato.
import { spawn, spawnSync } from "node:child_process";
import { realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// la prova in un processo suo: NODE_EXTRA_CA_CERTS vale solo all'avvio di Node
const PROVA = `import http2 from "node:http2"; import net from "node:net"; import { readFileSync, writeFileSync } from "node:fs";
const { creaTelegram } = await import(process.env.MODULO);
const TOKEN = "123456:prova";
const arrivi = { sendMessage: 0 };
let trattieni = false, rifiuta = 0;
const api = http2.createSecureServer({ key: readFileSync(process.env.CHIAVE), cert: readFileSync(process.env.CERT), allowHTTP1: true }, (req, res) => {
  let corpo = "";
  req.on("data", (d) => { corpo += d; });
  req.on("end", () => {
    const metodo = req.url.split("/").pop();
    const ok = (result) => res.end(JSON.stringify({ ok: true, result }));
    if (metodo === "getMe") return ok({ id: 9, is_bot: true, username: "prova_bot" });
    if (metodo === "getUpdates") return setTimeout(() => ok([]), 4000);
    if (metodo === "sendMessage") { arrivi.sendMessage++; if (!trattieni) ok({ message_id: arrivi.sendMessage }); return; }
    ok(true);
  });
});
await new Promise((r) => api.listen(0, "127.0.0.1", r));
// davanti all'API: le prime \`rifiuta\` connessioni si chiudono prima della stretta di mano TLS
const davanti = net.createServer((s) => {
  if (rifiuta > 0) { rifiuta--; return s.destroy(); }
  const a = net.connect(api.address().port, "127.0.0.1");
  s.pipe(a).pipe(s);
  s.on("error", () => a.destroy()); a.on("error", () => s.destroy());
});
await new Promise((r) => davanti.listen(0, "127.0.0.1", r));
writeFileSync(process.env.COCKPIT_STATO + "/telegram.json", JSON.stringify({ codice: "", persona: { chat: 111, utente: 111, nome: "P" }, gruppo: null, offset: 0, mandate: {}, registro: [], ignorati: 0 }));
const tg = creaTelegram({
  cfg: { telegram: { acceso: true }, fuso: "Europe/Rome", assistente: { nome: "Pilota", slug: "pilota" }, persone: [] },
  persona: { slug: "p", nome: "P" }, cockpit: { orchestratore: () => null }, token: TOKEN, api: "https://localhost:" + davanti.address().port, secondi: 2,
});
const esito = {};
const misura = async (fn) => { const t0 = Date.now(); const r = await fn(); return { ...r, ms: Date.now() - t0, arrivi: arrivi.sendMessage }; };
// 1. un invio mentre getUpdates aspetta (4 s)
const poll = tg.controlla({ attesaS: 4 });
await new Promise((r) => setTimeout(r, 500));
esito.durantePoll = await misura(() => tg.scrivi({ testo: "uno" }));
await poll;
// 2. la prima connessione rifiutata: ritentato, arrivato una volta
rifiuta = 1; esito.rifiutata = await misura(() => tg.scrivi({ testo: "due" }));
// 3. arrivato ma senza risposta: niente nuovo tentativo, incerto
trattieni = true; esito.trattenuto = await misura(() => tg.scrivi({ testo: "tre" }));
await new Promise((r) => setTimeout(r, 1500));
esito.dopoTrattenuto = arrivi.sendMessage;
trattieni = false;
// 4. tutte le connessioni rifiutate: tre tentativi, poi non mandato
rifiuta = 10; esito.semprerifiutata = await misura(() => tg.scrivi({ testo: "quattro" }));
esito.tentativiRifiutati = 10 - rifiuta;
console.log(JSON.stringify(esito));
process.exit(0);
`;

export default async function (t) {
  const dir = realpathSync(t.tmp());
  const chiave = path.join(dir, "chiave.pem"), cert = path.join(dir, "cert.pem");
  const o = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", chiave, "-out", cert, "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { encoding: "utf8" });
  if (o.status !== 0) return t.nota(`telegram-rete saltato: openssl non disponibile (${(o.stderr || o.error?.message || "").trim().slice(0, 120)})`);
  const stato = realpathSync(t.tmp());
  writeFileSync(path.join(dir, "plancia.config.json"), "{}");
  const env = {
    ...process.env, COCKPIT_STATO: stato, COCKPIT_PROVA: "1", PLANCIA_CONFIG: path.join(dir, "plancia.config.json"), NODE_EXTRA_CA_CERTS: cert,
    CHIAVE: chiave, CERT: cert, MODULO: pathToFileURL(path.join(t.plancia, "server/telegram.mjs")).href,
  };
  delete env.COCKPIT_PORTA; delete env.COCKPIT_SESSIONE; delete env.TELEGRAM_API; delete env.TELEGRAM_BOT_TOKEN;
  const figlio = spawn(process.execPath, ["--input-type=module", "-e", PROVA], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  figlio.stdout.on("data", (d) => { out += d; });
  figlio.stderr.on("data", (d) => { err += d; });
  const uscito = await new Promise((ok) => {
    const limite = setTimeout(() => { figlio.kill("SIGKILL"); ok("tempo scaduto"); }, 40000);
    figlio.on("exit", (c) => { clearTimeout(limite); ok(c); });
  });
  let e;
  try { e = JSON.parse(out.trim().split("\n").pop()); } catch { return t.ok(false, `telegram-rete: la prova non ha dato un esito (uscita ${uscito}): ${(out + err).slice(-500)}`); }
  const d = e.durantePoll, r = e.rifiutata, x = e.trattenuto, s = e.semprerifiutata;
  t.ok(d.inviato && d.ms < 1500, `un invio mentre getUpdates aspetta parte subito, non in coda dietro il poll (${JSON.stringify(d)})`);
  t.ok(r.inviato && r.arrivi === 2, `connessione rifiutata prima di arrivare: ritentato, arrivato una volta (${JSON.stringify(r)})`);
  t.ok(!x.inviato && x.incerto && x.arrivi === 3 && e.dopoTrattenuto === 3 && /prima di ripetere/.test(x.motivo), `arrivato senza risposta: nessun nuovo tentativo, esito incerto (${JSON.stringify(x)}, dopo ${e.dopoTrattenuto})`);
  t.ok(!s.inviato && !s.incerto && s.arrivi === 3 && e.tentativiRifiutati === 3, `sempre rifiutata: tre tentativi, niente arrivato (${JSON.stringify(s)}, tentativi ${e.tentativiRifiutati})`);
  t.ok(!/123456:prova/.test(out + err), "il token non compare nell'uscita");
}
