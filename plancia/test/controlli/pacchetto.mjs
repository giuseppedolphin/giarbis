// Ritocchi per chi impacchetta la plancia: primo avvio (setup), frammenti di prompt assoluti e opzionali, --chrome da config,
// moduli in una cartella extra, skill lavagna nel prompt. Tutto in cartelle temporanee, senza processi claude.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SPORCHE = ["PLANCIA_CONFIG", "PLANCIA_PRIMO_AVVIO", "PLANCIA_MODULI_EXTRA", "COCKPIT_STATO", "COCKPIT_PERSONA", "COCKPIT_PORTA", "COCKPIT_PROVA", "COCKPIT_SESSIONE"];
const pulito = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !SPORCHE.includes(k)));
const dormi = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function (t) {
  const url = (...p) => pathToFileURL(path.join(t.plancia, ...p)).href;
  const dir = () => realpathSync(t.tmp());
  const scrivi = (file, dati) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, typeof dati === "string" ? dati : JSON.stringify(dati)); };
  const libera = () => new Promise((ok) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => ok(port)); }); });

  // un processo di prova dentro `cwd` (la config si cerca da lì), con ambiente pulito
  function esegui(cwd, corpo, env = {}) {
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", corpo], {
      cwd, encoding: "utf8", env: { ...pulito(), COCKPIT_STATO: path.join(cwd, "stato"), COCKPIT_PROVA: "1", ...env },
    });
    if (r.status !== 0) throw new Error(`processo di prova uscito ${r.status}: ${String(r.stderr).slice(-500)}`);
    return JSON.parse(r.stdout.trim().split("\n").pop());
  }

  // un server di prova con la cartella di lavoro `cwd` (senza il config del worktree)
  const aperti = [];
  async function server(cwd, env = {}) {
    const porta = await libera();
    const figlio = spawn(process.execPath, [path.join(t.plancia, "server/server.mjs"), String(porta)], {
      cwd, stdio: ["ignore", "pipe", "pipe"],
      env: { ...pulito(), NO_OPEN: "1", COCKPIT_PROVA: "1", COCKPIT_STATO: path.join(cwd, "stato"), ...env },
    });
    let log = "", uscito = false;
    figlio.on("exit", () => { uscito = true; });
    figlio.stdout.on("data", (d) => { log += d; }); figlio.stderr.on("data", (d) => { log += d; });
    const base = `http://127.0.0.1:${porta}`;
    aperti.push(() => new Promise((ok) => { if (uscito) return ok(); figlio.once("exit", ok); figlio.kill("SIGTERM"); setTimeout(() => figlio.kill("SIGKILL"), 3000).unref(); }));
    for (let i = 0; i < 100; i++) {
      if (uscito) throw new Error(`server uscito: ${log.slice(-500)}`);
      try { if ((await t.get(base, "/cockpit")).codice === 200) return { base, porta, log: () => log }; } catch { /* non ancora */ }
      await dormi(150);
    }
    throw new Error("il server non risponde");
  }
  // ascolta lo stream e raccoglie i tipi degli eventi
  function stream(base) {
    const tipi = [];
    const u = new URL(base);
    const req = http.get({ host: u.hostname, port: u.port, path: "/api/stream", headers: { host: u.host } }, (res) => {
      let buf = "";
      res.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n\n")) >= 0) { const b = buf.slice(0, i); buf = buf.slice(i + 2); const m = b.match(/^data: (.*)$/m); if (m) tipi.push(JSON.parse(m[1])); } });
    });
    req.on("error", () => {});
    return { tipi, chiudi: () => req.destroy() };
  }
  const D = { "x-dashboard": "1" };

  try {
    // ───── N1: primo avvio ─────
    {
      const cwd = dir();
      const s = await server(cwd, { PLANCIA_PRIMO_AVVIO: "1" });
      const chi = (await t.get(s.base, "/api/chi", D)).json();
      t.ok(chi.modalita === "setup", `senza config e col lanciatore: modalita setup (${chi.modalita})`);
      await dormi(400);
      const { sessioni } = (await t.get(s.base, "/api/sessioni", D)).json();
      const o = sessioni.find((x) => x.ruolo === "orchestratore");
      t.ok(o && o.nome === "setup", `l'orchestratore si chiama setup: ${sessioni.map((x) => x.nome)}`);
      const ev = (await t.get(s.base, `/api/sessioni/setup/eventi`, D)).json().eventi;
      t.ok(ev.some((e) => e.type === "cockpit_utente" && e.origine === "sistema" && /^\[primo avvio\]/.test(e.testo)), "il primo messaggio [primo avvio] è partito (a registro, in prova)");
      const ascolto = stream(s.base);
      await dormi(200);
      const no = await t.post(s.base, "/api/setup/fatto", {}, D);
      t.ok(no.codice === 400 && /plancia\.config\.json/.test(no.json().errore), `setup fatto senza file: 400 (${no.codice})`);
      scrivi(path.join(cwd, "plancia.config.json"), "{ rotto");
      t.ok((await t.post(s.base, "/api/setup/fatto", {}, D)).codice === 400, "setup fatto con JSON rotto: 400");
      scrivi(path.join(cwd, "plancia.config.json"), { assistente: { nome: "Prova" } });
      const si = await t.post(s.base, "/api/setup/fatto", {}, D);
      await dormi(300);
      t.ok(si.codice === 200 && si.json().ok === true, `setup fatto con config valida: 200 (${si.codice})`);
      t.ok(ascolto.tipi.some((e) => e.type === "cockpit_setup" && e.pronto === true), "evento cockpit_setup arrivato sullo stream");
      ascolto.chiudi();
      t.ok(!/fuori catalogo/.test(s.log()), "cockpit_setup è nel catalogo degli eventi");
      // ctl setup fatto
      const c = t.ctl(["setup", "fatto", "--porta", String(s.porta)], { COCKPIT_STATO: path.join(cwd, "stato") });
      t.ok(c.codice === 0, `ctl setup fatto: uscita ${c.codice} ${c.out.slice(0, 120)}`);
      // sessione "setup" dopo il Riavvia: config presente, orchestratore nuovo, setup agente fermo
      const r = esegui(cwd, `const { Cockpit } = await import(${JSON.stringify(url("server/sessioni.mjs"))});
const { config } = await import(${JSON.stringify(url("server/config.mjs"))});
const k = new Cockpit({ cfg: config(), persona: { slug: "x", nome: "X" }, moduli: [] });
await new Promise((r) => setTimeout(r, 300));
console.log(JSON.stringify({ elenco: k.elenco().map((x) => [x.nome, x.ruolo, x.stato]), modalita: k.modalita,
  benv: k.eventi(k.orchestratore().id).map((e) => e.testo || e.type) }));`, { PLANCIA_PRIMO_AVVIO: "1" });
      const setup = r.elenco.find((x) => x[0] === "setup"), orc = r.elenco.find((x) => x[1] === "orchestratore");
      t.ok(setup && setup[1] === "setup" && setup[2] === "ferma", `dopo il Riavvia setup resta come agente fermo: ${JSON.stringify(r.elenco)}`);
      t.ok(orc && orc[0] === "prova" && r.modalita === "normale", `nasce l'orchestratore normale: ${JSON.stringify(r.elenco)}`);
      t.ok(r.benv.some((x) => /^\[benvenuto\]/.test(x)), "al primo avvio normale l'orchestratore riceve il benvenuto");
    }
    {
      const s = await server(dir());
      const chi = (await t.get(s.base, "/api/chi", D)).json();
      t.ok(chi.modalita === "normale", `senza la variabile: modalita normale (${chi.modalita})`);
      const { sessioni } = (await t.get(s.base, "/api/sessioni", D)).json();
      t.ok(!sessioni.some((x) => x.nome === "setup") && sessioni.length === 1, `senza la variabile nessuna sessione setup, nessun messaggio: ${sessioni.map((x) => x.nome)}`);
      t.ok(sessioni[0].turni === 0 && !(await t.get(s.base, `/api/sessioni/${sessioni[0].id}/eventi`, D)).json().eventi.length, "nessun benvenuto senza il lanciatore");
    }
    // la plancia viva (config presente, variabile assente o presente) non entra in setup e, con turni, non riceve il benvenuto
    {
      const cwd = dir();
      scrivi(path.join(cwd, "plancia.config.json"), { assistente: { nome: "Prova", slug: "prova" } });
      const stato = path.join(cwd, "stato");
      mkdirSync(stato, { recursive: true });
      scrivi(path.join(stato, "sessioni.json"), [{ id: "abc12345", nome: "prova", ruolo: "orchestratore", modello: "claude-opus-4-5", genitore: "", claudeId: "x", stato: "ferma", creata: "2026-01-01T00:00:00.000Z", aggiornata: "2026-01-01T00:00:00.000Z", ultimo: "", costo: 0, turni: 4, nonLetti: 0 }]);
      const r = esegui(cwd, `const { Cockpit } = await import(${JSON.stringify(url("server/sessioni.mjs"))});
const { config } = await import(${JSON.stringify(url("server/config.mjs"))});
const k = new Cockpit({ cfg: config(), persona: { slug: "x", nome: "X" }, moduli: [] });
await new Promise((r) => setTimeout(r, 300));
console.log(JSON.stringify({ modalita: k.modalita, elenco: k.elenco().map((x) => [x.nome, x.ruolo, x.stato, x.turni]), eventi: k.eventi("abc12345").length }));`, { PLANCIA_PRIMO_AVVIO: "1", COCKPIT_STATO: stato });
      t.ok(r.modalita === "normale" && r.elenco.length === 1 && r.elenco[0][3] === 4 && r.eventi === 0, `plancia già in uso: niente setup né benvenuto: ${JSON.stringify(r)}`);
    }

    // ───── N2: frammenti di prompt ─────
    {
      const cwd = dir();
      const frammento = path.join(cwd, "fuori", "extra.md");
      scrivi(frammento, "FRAMMENTO-ASSOLUTO per {{assistente}}");
      scrivi(path.join(cwd, "prompt", "x.md"), "base {{assistente}}");
      const r = esegui(cwd, `const { componi } = await import(${JSON.stringify(url("server/prompt.mjs"))});
const cart = ${JSON.stringify(path.join(cwd, "prompt"))};
const m = (prompt) => [{ cartella: ${JSON.stringify(path.join(cwd, "modulo"))}, prompt }];
const prova = (prompt) => { try { return componi("x", { assistente: "A" }, m(prompt), cart); } catch (e) { return "ERRORE " + e.message.slice(0, 80); } };
console.log(JSON.stringify({
  assoluto: prova({ x: ${JSON.stringify(frammento)} }),
  opzionaleAssente: prova({ x: { file: "non-c-e.md", opzionale: true } }),
  obbligatorioAssente: prova({ x: "non-c-e.md" }),
  obbligatorioOggetto: prova({ x: { file: "non-c-e.md" } }),
  relativo: prova({ x: "../fuori/extra.md" }),
}));`);
      t.ok(/base A\n\nFRAMMENTO-ASSOLUTO per A/.test(r.assoluto), `frammento assoluto in coda: ${JSON.stringify(r.assoluto)}`);
      t.ok(r.opzionaleAssente === "base A\n", `opzionale assente: nessun errore: ${JSON.stringify(r.opzionaleAssente)}`);
      t.ok(/^ERRORE/.test(r.obbligatorioAssente) && /^ERRORE/.test(r.obbligatorioOggetto), "obbligatorio assente: errore");
      t.ok(/FRAMMENTO-ASSOLUTO/.test(r.relativo), "frammento relativo fuori dal modulo (path.resolve)");
    }

    // ───── N3: --chrome da config ─────
    {
      const r = esegui(dir(), `const { argomentiClaude } = await import(${JSON.stringify(url("server/sessioni.mjs"))});
const { config } = await import(${JSON.stringify(url("server/config.mjs"))});
const base = { modello: "m", prompt: "p", nome: "n" };
console.log(JSON.stringify({ si: argomentiClaude({ ...base, chrome: true }), no: argomentiClaude({ ...base, chrome: false }), predef: argomentiClaude(base), cfg: config().chrome }));`);
      t.ok(r.si.includes("--chrome") && r.predef.includes("--chrome") && r.cfg === true, "chrome di default: --chrome presente");
      t.ok(!r.no.includes("--chrome"), "chrome false: niente --chrome");
      const cwd = dir();
      scrivi(path.join(cwd, "plancia.config.json"), { chrome: false });
      const r2 = esegui(cwd, `const { Cockpit } = await import(${JSON.stringify(url("server/sessioni.mjs"))});
const { config } = await import(${JSON.stringify(url("server/config.mjs"))});
const k = new Cockpit({ cfg: config(), persona: { slug: "x", nome: "X" }, moduli: [] });
console.log(JSON.stringify({ cfg: config().chrome, args: k.argomenti(k.orchestratore()) }));`);
      t.ok(r2.cfg === false && !r2.args.includes("--chrome"), "Cockpit.argomenti rispetta cfg.chrome");
    }

    // ───── N5: moduli in una cartella extra ─────
    {
      const cwd = dir(), extra = path.join(dir(), "moduli-extra");
      scrivi(path.join(cwd, "plancia.config.json"), { moduli: { finto: { a: 1 } } });
      scrivi(path.join(extra, "finto", "modulo.mjs"), 'export default { nome: "finto", pagina: "pagina.js", tipiEvento: ["finto_x"] };\n');
      scrivi(path.join(extra, "finto", "pagina.js"), "export const finto = 1;\n");
      const s = await server(cwd, { PLANCIA_MODULI_EXTRA: extra });
      const chi = (await t.get(s.base, "/api/chi", D)).json();
      t.ok(chi.moduli.some((m) => m.nome === "finto" && m.pagina === "/moduli/finto/pagina.js"), `modulo extra caricato: ${JSON.stringify(chi.moduli)}`);
      const p = await t.get(s.base, "/moduli/finto/pagina.js");
      t.ok(p.codice === 200 && /finto = 1/.test(p.testo), `pagina.js del modulo extra servita (${p.codice})`);
      const senza = await server(cwd);
      t.ok(!(await t.get(senza.base, "/api/chi", D)).json().moduli.length, "senza PLANCIA_MODULI_EXTRA il modulo non si trova (saltato)");
    }

    // ───── N4: skill lavagna ─────
    {
      const cwd = dir();
      const corpo = `const { componi, skillLavagna } = await import(${JSON.stringify(url("server/prompt.mjs"))});
const v = { assistente: "A", persona: "P", ctl: "ctl", modello_default: "m", mappa: "mappa", assistente_slug: "a", battito_orari: "", battito_giorni: "" };
console.log(JSON.stringify({ testo: componi("assistente", v, []), skill: skillLavagna() }));`;
      const senza = esegui(cwd, corpo);
      t.ok(!/skills\/lavagna/.test(senza.testo) && /file html autosufficiente/.test(senza.testo) && /cartella lavagna/.test(senza.testo), "senza skill: le tre righe essenziali");
      scrivi(path.join(cwd, ".claude/skills/lavagna/SKILL.md"), "x");
      const con = esegui(cwd, corpo);
      t.ok(/la skill lavagna \(\.claude\/skills\/lavagna\/SKILL\.md\)/.test(con.testo), "con la skill: il percorso nel prompt");
      const fuori = [];
      const cerca = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) cerca(p); else if (/skills\/lavagna/.test(readFileSync(p, "utf8"))) fuori.push(path.relative(t.plancia, p)); } };
      cerca(path.join(t.plancia, "prompt"));
      t.ok(!fuori.length, `nessun skills/lavagna in plancia/prompt: ${fuori}`);
    }
  } finally {
    for (const chiudi of aperti) await chiudi();
  }
}
