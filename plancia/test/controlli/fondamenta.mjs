// Prove unitarie dei file di fondamenta (config, stato, migrazioni, rotte, eventi, moduli, prompt), su cartelle temporanee.
// config e stato leggono l'ambiente e tengono una cache: si provano in un processo a parte, con l'ambiente pulito.
import { spawnSync } from "node:child_process";
import {
  existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync,
} from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SPORCHE = ["PLANCIA_CONFIG", "COCKPIT_STATO", "COCKPIT_PERSONA", "COCKPIT_PORTA", "PLANCIA_PROVA_CHIAVE", "PLANCIA_PROVA_ALTRA"];

export default async function (t) {
  const modulo = (n) => pathToFileURL(path.join(t.plancia, "server", `${n}.mjs`)).href;
  const scrivi = (file, testo) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, typeof testo === "string" ? testo : JSON.stringify(testo)); };
  const reale = (d) => realpathSync(d);

  // Esegue `corpo` (che termina con console.log(JSON.stringify(...))) in un processo pulito dentro `cwd`.
  function esegui(cwd, env, corpo) {
    const pulito = Object.fromEntries(Object.entries(process.env).filter(([k]) => !SPORCHE.includes(k)));
    const pre = ["config", "stato", "migrazioni"].map((n) => `const ${n[0].toUpperCase() + n.slice(1)} = await import(${JSON.stringify(modulo(n))});`).join("\n");
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", `${pre}\n${corpo}`], { cwd, encoding: "utf8", env: { ...pulito, ...env } });
    if (r.status !== 0) throw new Error(`processo di prova uscito ${r.status}: ${String(r.stderr).slice(-400)}`);
    const righe = r.stdout.trim().split("\n");
    return JSON.parse(righe[righe.length - 1]);
  }

  // ───── config ─────
  {
    const d = reale(t.tmp());
    const c = esegui(d, {}, `const c = Config.config(); console.log(JSON.stringify({ c, ctl: Config.comandoCtl(), porta: Config.portaServer([]) }));`);
    t.ok(c.c.cartella === d, `senza file: cartella = cwd (${c.c.cartella})`);
    t.ok(c.c.assistente.nome === "Assistente" && c.c.assistente.slug === "assistente", "senza file: assistente neutro");
    t.ok(JSON.stringify(c.c.assistente.chiamata) === '["hey assistente"]', "senza file: chiamata hey assistente");
    t.ok(c.c.porta === 4173 && c.porta === 4173, "senza file: porta 4173");
    t.ok(Object.keys(c.c.moduli).length === 0 && c.c.persone.length === 0, "senza file: nessun modulo, nessuna persona");
    t.ok(c.c.fuso === "Europe/Rome" && c.c.lingua === "it" && c.c.modelli.default === "opus", "senza file: fuso, lingua, modelli di default");
    t.ok(c.ctl === `node ${path.join(t.plancia, "ctl.mjs")}`, `comandoCtl fuori dalla cartella = percorso assoluto (${c.ctl})`);
  }
  {
    const d = reale(t.tmp());
    scrivi(path.join(d, "plancia.config.json"), {
      assistente: { nome: "Prova Uno", alias: ["jarvis"] }, porta: 5000, chiavi: "k.env",
      persone: [{ email: "X@Y.it", slug: "x", nome: "Xavier", pagina: "/x", extra: 7 }], moduli: { m: { a: 1 } },
      conservazione: { registriMB: 0.0005 },
    });
    scrivi(path.join(d, "k.env"), '# commento\nPLANCIA_PROVA_CHIAVE="dal-file"\nexport PLANCIA_PROVA_ALTRA=altra\n');
    mkdirSync(path.join(d, "sotto/più/giù"), { recursive: true });
    const cwd = path.join(d, "sotto/più/giù");
    const c = esegui(cwd, { COCKPIT_PERSONA: "x" }, `
      const c = Config.config();
      let sbagliata = ""; process.env.COCKPIT_PERSONA = "nessuno"; try { Config.chiSono(); } catch (e) { sbagliata = e.message; } process.env.COCKPIT_PERSONA = "x";
      const persona = Config.chiSono();
      const dalFile = Config.chiave("PLANCIA_PROVA_CHIAVE"), altra = Config.chiave("PLANCIA_PROVA_ALTRA");
      process.env.PLANCIA_PROVA_CHIAVE = "dall-ambiente";
      const ambiente = Config.chiave("PLANCIA_PROVA_CHIAVE"), manca = Config.chiave("PLANCIA_PROVA_NON_C_E");
      console.log(JSON.stringify({ c, persona, sbagliata, dalFile, altra, ambiente, manca, slug: Config.slug("  Già Così! "),
        p1: Config.portaServer(["5001"]), p2: Config.portaServer([]) }));`);
    t.ok(c.c.cartella === d && c.c.fileConfig === path.join(d, "plancia.config.json"), "con file: trovato risalendo da cwd");
    t.ok(c.c.assistente.slug === "prova-uno" && c.c.assistente.chiamata[0] === "hey prova-uno", "con file: slug e chiamata derivati dal nome");
    t.ok(c.c.assistente.alias[0] === "jarvis" && c.c.assistente.varianti.nomi[0] === "prova-uno", "con file: alias e varianti");
    t.ok(c.c.porta === 5000 && c.p2 === 5000 && c.p1 === 5001, `porta: config ${c.p2}, argomento ${c.p1}`);
    t.ok(c.c.moduli.m.a === 1, "con file: moduli letti");
    t.ok(c.persona.slug === "x" && c.persona.nome === "Xavier" && c.persona.email === "x@y.it" && c.persona.extra === 7, "chiSono con COCKPIT_PERSONA: campi extra inclusi");
    t.ok(/non valida/.test(c.sbagliata), "chiSono: persona forzata sconosciuta = errore");
    t.ok(c.dalFile === "dal-file" && c.altra === "altra", "chiave dal file delle chiavi (virgolette, export, commenti)");
    t.ok(c.ambiente === "dall-ambiente" && c.manca === "", "chiave: l'ambiente vince, la mancante è vuota");
    t.ok(c.slug === "gia-cosi", `slug: ${c.slug}`);

    const k = esegui(cwd, { COCKPIT_STATO: path.join(d, "st") }, `console.log(JSON.stringify({ a: Config.chiave("PLANCIA_PROVA_STATO") }))`);
    t.ok(k.a === "", "chiave assente ovunque = vuota");
    scrivi(path.join(d, "st/chiavi.env"), "PLANCIA_PROVA_STATO=nello-stato\n");
    const k2 = esegui(cwd, { COCKPIT_STATO: path.join(d, "st") }, `console.log(JSON.stringify({ a: Config.chiave("PLANCIA_PROVA_STATO") }))`);
    t.ok(k2.a === "nello-stato", "chiave da <stato>/chiavi.env");

    const sc = esegui(cwd, {}, `console.log(JSON.stringify({ s: Config.chiSono() }))`);
    t.ok(typeof sc.s.slug === "string" && sc.s.pagina === "/", "chiSono senza persona conosciuta: slug vuoto o persona, pagina /");

    // ───── stato ─────
    const st = path.join(d, "stato");
    const s = esegui(cwd, { COCKPIT_STATO: st }, `
      const { negozio, registro, salvaFile, pulisci, dirStato, percorsoStato } = Stato;
      const fs = await import("node:fs");
      const out = { dir: dirStato() };
      const n = negozio("prova", { base: { a: 1, n: 0 } });
      out.letto = n.leggi();
      await Promise.all(Array.from({ length: 20 }, () => n.aggiorna(async (x) => { const v = x.n; await new Promise((r) => setTimeout(r, 2)); x.n = v + 1; })));
      out.dopo = n.leggi();
      out.residui = fs.readdirSync(dirStato()).filter((f) => f.includes(".tmp-"));
      fs.writeFileSync(n.file, "{rotto");
      out.daRotto = n.leggi();
      out.messoDaParte = fs.readdirSync(dirStato()).filter((f) => f.startsWith("prova.json.rotto-")).length;
      const lista = negozio("lista", { base: [] }); lista.scrivi([1, 2]);
      out.lista = lista.leggi();
      const r = registro("giro");
      for (let i = 0; i < 40; i++) r.aggiungi({ n: i, riempimento: "x".repeat(30) });
      out.registro = { attuali: r.leggi().length, ultime: r.leggi({ ultime: 2 }).map((x) => x.n), ruotato: fs.existsSync(percorsoStato("giro.1.jsonl")) };
      r.azzera();
      out.azzerato = { attuali: r.leggi().length, ruotato: fs.existsSync(percorsoStato("giro.1.jsonl")) };
      const f = salvaFile("allegati", "a.txt", "ciao");
      out.file = { esiste: fs.existsSync(f), testo: fs.readFileSync(f, "utf8"), sotto: f.startsWith(dirStato()) };
      out.fuori = []; for (const [sc, nome] of [["allegati", "../x"], ["..", "x"], ["a/../..", "x"], ["", "a/b"]]) { try { salvaFile(sc, nome, "x"); out.fuori.push("scritto"); } catch { out.fuori.push("rifiutato"); } }
      const antico = 40 * 86400 * 1000;
      fs.writeFileSync(percorsoStato("allegati/vecchio.pdf"), "v"); fs.utimesSync(percorsoStato("allegati/vecchio.pdf"), new Date(Date.now() - antico), new Date(Date.now() - antico));
      fs.writeFileSync(percorsoStato("morto.json.tmp-1"), "t"); fs.utimesSync(percorsoStato("morto.json.tmp-1"), new Date(Date.now() - 3600000), new Date(Date.now() - 3600000));
      fs.writeFileSync(percorsoStato("recente.json.tmp-2"), "t");
      out.pulisci = pulisci();
      out.dopoPulizia = { vecchio: fs.existsSync(percorsoStato("allegati/vecchio.pdf")), nuovo: fs.existsSync(percorsoStato("allegati/a.txt")),
        morto: fs.existsSync(percorsoStato("morto.json.tmp-1")), recente: fs.existsSync(percorsoStato("recente.json.tmp-2")) };
      console.log(JSON.stringify(out));`);
    t.ok(s.dir === st, "dirStato = COCKPIT_STATO");
    t.ok(s.letto.a === 1 && s.letto.versione === 1, "negozio: la base e il campo versione");
    t.ok(s.dopo.n === 20, `negozio.aggiorna serializza: ${s.dopo.n} (atteso 20)`);
    t.ok(s.residui.length === 0, `negozio: nessun .tmp- dopo la scrittura (${s.residui})`);
    t.ok(s.daRotto.a === 1 && s.messoDaParte === 1, "negozio: file rotto messo da parte e base restituita");
    t.ok(JSON.stringify(s.lista) === "[1,2]", "negozio con elenco: nessun campo aggiunto");
    t.ok(s.registro.ruotato && s.registro.attuali < 40 && JSON.stringify(s.registro.ultime) === "[38,39]", `registro ruota (${JSON.stringify(s.registro)})`);
    t.ok(s.azzerato.attuali === 0 && !s.azzerato.ruotato, "registro.azzera toglie anche il ruotato");
    t.ok(s.file.esiste && s.file.testo === "ciao" && s.file.sotto, "salvaFile scrive dentro lo stato");
    t.ok(s.fuori.every((x) => x === "rifiutato"), `salvaFile rifiuta i percorsi che escono (${s.fuori})`);
    t.ok(!s.dopoPulizia.vecchio && s.dopoPulizia.nuovo, "pulisci: allegato vecchio via, nuovo resta");
    t.ok(!s.dopoPulizia.morto && s.dopoPulizia.recente, "pulisci: .tmp- vecchio via, recente resta");
    t.ok(s.pulisci.tmp === 1 && s.pulisci.allegati === 1, `pulisci conta (${JSON.stringify(s.pulisci)})`);

    // ───── migrazioni, con stato di prova ─────
    const m1 = path.join(d, "mig");
    scrivi(path.join(m1, "carte.json"), [{ id: "c1", da: "jarvis" }, { id: "c2", da: "tu" }]);
    scrivi(path.join(m1, "generati.json"), [{ id: "g1", da: "jarvis" }]);
    scrivi(path.join(m1, "sessioni.json"), [
      { id: "1", nome: "jarvis", ruolo: "orchestratore", modello: "sonnet" },
      { id: "2", nome: "agente", ruolo: "agente", genitore: "jarvis", modello: "claude-opus-5-5", modelloPendente: "haiku" },
      { id: "3", nome: "senza", ruolo: "agente", modello: "inesistente" },
    ]);
    scrivi(path.join(m1, "impostazioni.json"), { motore: "tts" });
    const mig = esegui(cwd, { COCKPIT_STATO: m1 }, `
      const primo = Migrazioni.migra(); const secondo = Migrazioni.migra();
      const fs = await import("node:fs"); const l = (f) => JSON.parse(fs.readFileSync(Stato.percorsoStato(f), "utf8"));
      console.log(JSON.stringify({ primo, secondo, versione: l("versione.json"), fogli: l("fogli.json"), artifax: l("artifax.json"), sessioni: l("sessioni.json"),
        imp: l("impostazioni.json"), carte: fs.existsSync(Stato.percorsoStato("carte.json")), generati: fs.existsSync(Stato.percorsoStato("generati.json")) }));`);
    t.ok(mig.primo.length === 6, `migra: ${mig.primo.length} passi applicati (attesi 6: ${mig.primo.join(" | ")})`);
    t.ok(mig.secondo.length === 0, "migra: seconda volta nessun passo (idempotente)");
    t.ok(mig.versione.versione === 7 && mig.versione.passi.length === 7, "versione.json annota i passi");
    t.ok(mig.fogli[0].id === "c1" && !mig.carte, "carte.json → fogli.json");
    t.ok(mig.fogli[0].da === "prova-uno" && mig.fogli[1].da === "tu" && mig.artifax[0].da === "prova-uno", "passo 7: il campo da dei fogli e degli artifax passa allo slug (gli altri restano)");
    t.ok(mig.artifax[0].id === "g1" && !mig.generati, "generati.json → artifax.json");
    t.ok(mig.sessioni[0].nome === "prova-uno" && mig.sessioni[1].genitore === "prova-uno", "sessione orchestratore e genitore rinominati");
    t.ok(mig.sessioni[0].modello === "claude-sonnet-5-5" && mig.sessioni[1].modelloPendente === "claude-haiku-4-5-20251001", "alias di modello → id");
    t.ok(mig.sessioni[2].modello === "claude-opus-5-5", "modello sconosciuto → default");
    t.ok(mig.imp.motore === "tts" && mig.imp.versione === 1, "campo versione aggiunto dove manca");

    // il passo 1: locale/cockpit → .plancia, solo senza COCKPIT_STATO
    const v = reale(t.tmp());
    scrivi(path.join(v, "plancia.config.json"), {});
    scrivi(path.join(v, "locale/cockpit/sessioni.json"), [{ id: "1", nome: "jarvis", ruolo: "orchestratore" }]);
    scrivi(path.join(v, "locale/cockpit/carte.json"), []);
    const vec = esegui(v, {}, `const fatti = Migrazioni.migra(); console.log(JSON.stringify({ fatti }));`);
    t.ok(vec.fatti[0] === "locale/cockpit → .plancia" && existsSync(path.join(v, ".plancia/sessioni.json")), "locale/cockpit copiato in .plancia");
    t.ok(existsSync(path.join(v, "locale/cockpit/sessioni.json")), "locale/cockpit non è cancellato");
    t.ok(existsSync(path.join(v, ".plancia/fogli.json")), "dopo la copia anche carte.json → fogli.json");
    const nuovoNome = JSON.parse(readFileSync(path.join(v, ".plancia/sessioni.json"), "utf8"))[0].nome;
    t.ok(nuovoNome === "jarvis", `senza alias in config la sessione non si rinomina (${nuovoNome})`);
  }
  {
    const r = esegui(t.cartella, {}, `console.log(JSON.stringify({ c: Config.config().assistente, ctl: Config.comandoCtl() }))`);
    t.ok(r.c.slug === "giarbis" && r.c.chiamata[0] === "hey giarbis" && r.c.alias.includes("jarvis"), "plancia.config.json del worktree: Giarbis");
    t.ok(r.ctl === "node plancia/ctl.mjs", `comandoCtl dentro la cartella = relativo (${r.ctl})`);
  }

  // ───── rotte ─────
  {
    const { creaRouter } = await import(modulo("rotte"));
    const server = http.createServer();
    await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
    const porta = server.address().port, base = `http://127.0.0.1:${porta}`;
    const router = creaRouter({ porta });
    router.aggiungi([
      { metodo: "POST", percorso: "/api/x/:id/azione", gestore: async (c) => ({ id: c.parametri.id }) },
      { metodo: "GET", percorso: "/api/aperta", guardia: "locale", gestore: async (c) => c.json(200, { ok: true, aperta: true }) },
      { metodo: "GET", percorso: "/pagina", gestore: async (c) => c.invia(200, "text/plain", "ciao") },
      { metodo: "GET", percorso: "/api/guasta", gestore: async () => { throw new Error("rotta rotta"); } },
      { metodo: "GET", percorso: /^\/api\/re\/(\d+)$/, gestore: async (c) => ({ n: c.parametri[0] }) },
      { metodo: "POST", percorso: "/api/corpo", gestore: async (c) => ({ chiavi: Object.keys(await c.corpo()) }) },
    ]);
    server.on("request", async (req, res) => {
      if (!(await router.gestisci(req, res))) { res.writeHead(404); res.end("no"); }
    });
    const D = { "x-dashboard": "1" };
    try {
      let r = await t.post(base, "/api/x/a%20b/azione", {}, D);
      t.ok(r.codice === 200 && r.json().ok === true && r.json().id === "a b", `rotta con parametro: ${r.codice} ${r.testo}`);
      r = await t.post(base, "/api/x/a/azione", {});
      t.ok(r.codice === 403, `guardia dashboard senza header: ${r.codice}`);
      r = await t.get(base, "/api/aperta");
      t.ok(r.codice === 200 && r.json().aperta, "guardia locale: basta l'Host");
      r = await t.get(base, "/pagina");
      t.ok(r.codice === 200 && r.testo === "ciao", "fuori da /api/ vale la guardia locale; invia()");
      r = await t.get(base, "/api/aperta", { host: "evil.example" });
      t.ok(r.codice === 403, `Host sbagliato: ${r.codice}`);
      r = await t.get(base, "/api/aperta", { host: `localhost:${porta}` });
      t.ok(r.codice === 200, "localhost:<porta> ammesso");
      r = await t.get(base, "/api/guasta", D);
      t.ok(r.codice === 400 && r.json().ok === false && r.json().errore === "rotta rotta", `eccezione → 400: ${r.codice} ${r.testo}`);
      r = await t.get(base, "/api/re/42", D);
      t.ok(r.codice === 200 && r.json().n === "42", "rotta con RegExp");
      r = await t.get(base, "/api/non-c-e", D);
      t.ok(r.codice === 404, "nessuna rotta: gestisci() dice false e risponde il chiamante");
      r = await t.post(base, "/api/corpo", { a: 1, b: 2 }, D);
      t.ok(r.codice === 200 && r.json().chiavi.join() === "a,b", "corpo(): JSON letto");
      r = await t.post(base, "/api/corpo", "non json", D);
      t.ok(r.codice === 200 && r.json().chiavi.length === 0, "corpo(): JSON non valido = oggetto vuoto");

      // oltre 1 MB: 413 e la connessione si chiude davvero
      const esito = await new Promise((ok) => {
        const req = http.request({ host: "127.0.0.1", port: porta, path: "/api/corpo", method: "POST", headers: { host: `127.0.0.1:${porta}`, "x-dashboard": "1", "content-type": "application/json" } }, (res) => {
          let testo = ""; res.on("data", (d) => { testo += d; });
          res.on("end", () => ok({ codice: res.statusCode, testo, chiusa: res.headers.connection === "close" }));
        });
        req.on("error", (e) => ok({ errore: e.code }));
        req.setTimeout(8000, () => req.destroy(new Error("timeout")));
        req.write(Buffer.alloc(300 * 1024, "a"));
        let n = 0;
        const giro = setInterval(() => { if (req.destroyed || ++n > 20) { clearInterval(giro); try { req.end(); } catch { /* chiusa */ } return; } req.write(Buffer.alloc(300 * 1024, "a")); }, 5);
      });
      t.ok(esito.codice === 413, `corpo oltre 1 MB: ${JSON.stringify(esito)}`);
      t.ok(esito.chiusa, "413 con connection: close");
      r = await t.post(base, "/api/corpo", { ok: 1 }, D);
      t.ok(r.codice === 200, "il server regge dopo il 413");
      t.ok(await new Promise((ok) => server.getConnections((e, n) => ok(!e && n <= 1))), "nessuna connessione appesa dopo il 413");
    } finally { server.closeAllConnections?.(); await new Promise((ok) => server.close(ok)); }
  }

  // ───── eventi ─────
  {
    const ev = await import(modulo("eventi"));
    const vecchio = console.error; let rumore = 0; console.error = () => { rumore++; };
    try {
      const prima = ev.contaFuoriCatalogo();
      ev.trasmetti({ type: "tipo_che_non_c_e" });
      t.ok(ev.contaFuoriCatalogo() === prima + 1 && rumore === 1, "tipo fuori catalogo: console.error e conteggio");
      ev.registraTipi(["tipo_nuovo"]);
      ev.trasmetti({ type: "tipo_nuovo" });
      t.ok(ev.contaFuoriCatalogo() === prima + 1, "registraTipi: il tipo registrato non conta");
      let lancia = false; try { ev.trasmetti({ id: "x" }); } catch { lancia = true; }
      t.ok(lancia, "evento senza type = errore");
    } finally { console.error = vecchio; }
    for (const tipo of ["cockpit_sessione", "delta", "cockpit_foglio_chiuso", "cockpit_proposte", "fine", "cockpit_mostra"]) t.ok(ev.TIPI.has(tipo), `catalogo: ${tipo}`);

    const server = http.createServer((req, res) => ev.ascolta(req, res));
    await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
    try {
      const ricevuto = await new Promise((ok, no) => {
        const req = http.get({ host: "127.0.0.1", port: server.address().port, path: "/" }, (res) => {
          let testo = "";
          res.on("data", (d) => { testo += d; if (testo.includes("\"delta\"")) { req.destroy(); ok({ tipo: res.headers["content-type"], testo }); } else if (!testo.includes("delta") && testo.includes(": ok")) ev.trasmetti({ type: "delta", testo: "ciao" }); });
        });
        req.on("error", (e) => { if (e.code !== "ECONNRESET") no(e); });
        setTimeout(() => no(new Error("timeout SSE")), 5000);
      });
      t.ok(/text\/event-stream/.test(ricevuto.tipo) && /data: \{"type":"delta","testo":"ciao"\}/.test(ricevuto.testo), "SSE: ascolta + trasmetti");
    } finally { server.closeAllConnections?.(); await new Promise((ok) => server.close(ok)); }
  }

  // ───── moduli e prompt ─────
  {
    const { caricaModuli } = await import(modulo("moduli"));
    const { componi } = await import(modulo("prompt"));
    const { TIPI } = await import(modulo("eventi"));
    const cm = t.tmp(), cp = t.tmp();
    scrivi(path.join(cm, "buono/modulo.mjs"), 'export default { tipiEvento: ["evento_del_modulo"], prompt: { prova: "extra.md" } };\n');
    scrivi(path.join(cm, "buono/extra.md"), "Extra: {{ctl}}\n");
    const vecchio = console.error; console.error = () => {};
    let mod;
    try { mod = await caricaModuli({ moduli: { buono: { x: 1 }, assente: {} } }, cm); } finally { console.error = vecchio; }
    t.ok(mod.length === 1 && mod[0].nome === "buono" && mod[0].opzioni.x === 1, "caricaModuli: uno acceso, l'assente saltato");
    t.ok(TIPI.has("evento_del_modulo"), "caricaModuli registra i tipi di evento");
    let nomeNo = false; try { await caricaModuli({ moduli: { "../fuori": {} } }, cm); } catch { nomeNo = true; }
    t.ok(nomeNo, "caricaModuli: nome di modulo non valido = errore");

    scrivi(path.join(cp, "prova.md"), "Ciao {{assistente}}, sono per {{ persona }}.\n");
    const v = { assistente: "Zeta", persona: "Ugo", ctl: "node ctl" };
    const testo = componi("prova", v, mod, cp);
    t.ok(testo === "Ciao Zeta, sono per Ugo.\n\nExtra: node ctl\n", `componi: ${JSON.stringify(testo)}`);
    let errore = ""; try { componi("prova", { assistente: "Zeta", ctl: "c" }, mod, cp); } catch (e) { errore = e.message; }
    t.ok(/persona/.test(errore), `componi: segnaposto mancante = errore (${errore})`);
    scrivi(path.join(cp, "prova.md"), "Cambiato {{assistente}}\n");
    t.ok(componi("prova", v, [], cp).startsWith("Cambiato Zeta"), "componi rilegge da disco a ogni chiamata");
    let nomeBrutto = false; try { componi("../x", v, [], cp); } catch { nomeBrutto = true; }
    t.ok(nomeBrutto, "componi: nome di prompt non valido = errore");
  }
}
