// Compact automatico (decisione) e domande senza rimbalzo: prove sul nucleo senza server né processi claude.
// Il processo di una sessione è finto (uno stdin che registra cosa gli si scrive); gli eventi di stream-json si passano a gestisci().
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SPORCHE = ["PLANCIA_CONFIG", "COCKPIT_STATO", "COCKPIT_PERSONA", "COCKPIT_PORTA", "COCKPIT_PROVA"];
const CONFIG = { assistente: { nome: "Pilota", slug: "pilota" }, contesto: { compattaOltre: 0.35 } };

export default async function (t) {
  const url = (...p) => pathToFileURL(path.join(t.plancia, ...p)).href;

  function esegui(config, corpo) {
    const cwd = realpathSync(t.tmp());
    writeFileSync(path.join(cwd, "plancia.config.json"), JSON.stringify(config));
    const pulito = Object.fromEntries(Object.entries(process.env).filter(([k]) => !SPORCHE.includes(k)));
    const pre = `const { Cockpit, testoAvviso } = await import(${JSON.stringify(url("server/sessioni.mjs"))});
const { daCompattare } = await import(${JSON.stringify(url("server/contesto.mjs"))});
const { config } = await import(${JSON.stringify(url("server/config.mjs"))});
const avvisi = [], fini = [];
const nuovo = (aperte = 0) => new Cockpit({ cfg: config(), persona: { slug: "tester", nome: "Tester" },
  osservatore: { fineTurno: (s, i) => fini.push(i.origine), domandeAperte: () => aperte } });
// una sessione con un processo finto, vivo, a turno chiuso
function vivo(k, s) {
  const scritti = [];
  k.proc.set(s.id, { stdin: { write: (x) => scritti.push(JSON.parse(x).message.content) }, kill() {} });
  k.inCoda.set(s.id, 0); s.vivo = true; s.stato = "attende";
  return scritti;
}
const msg = (usati) => ({ type: "assistant", message: { model: "m", usage: { input_tokens: usati }, content: [{ type: "text", text: "ok" }] } });
const fine = (testo = "fatto") => ({ type: "result", subtype: "success", result: testo, modelUsage: { m: { contextWindow: 1000 } } });
// un turno intero: messaggio della persona (scritto al processo), risposta, fine
function turno(k, s, usati, testo) { k.inCoda.set(s.id, (k.inCoda.get(s.id) || 0) + 1); k.turno.set(s.id, { inizio: Date.now(), origine: "" }); s.stato = "lavora"; k.gestisci(s, msg(usati)); k.gestisci(s, fine(testo)); }`;
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", `${pre}\n${corpo}`], {
      // niente COCKPIT_PROVA (invia deve scrivere ai processi finti) e un PATH senza `claude`: nessun processo vero può partire
      cwd, encoding: "utf8", env: { ...pulito, COCKPIT_STATO: path.join(cwd, "stato"), PATH: "/nessun-percorso" },
    });
    if (r.status !== 0) throw new Error(`processo di prova uscito ${r.status}: ${String(r.stderr).slice(-500)}`);
    return JSON.parse(r.stdout.trim().split("\n").pop());
  }

  // ───── la regola pura ─────
  {
    const r = esegui(CONFIG, `
const s = { contesto: { usati: 400, finestra: 1000 } };
console.log(JSON.stringify({
  sopra: daCompattare(s, { soglia: 0.35 }), sotto: daCompattare({ contesto: { usati: 300, finestra: 1000 } }, { soglia: 0.35 }),
  spento: daCompattare(s, { soglia: null }), errore: daCompattare(s, { soglia: 0.35, errore: true }),
  dopoCompact: daCompattare(s, { soglia: 0.35, origine: "compact" }) ?? daCompattare(s, { soglia: 0.35, dopoCompact: true }), inCoda: daCompattare(s, { soglia: 0.35, inCoda: 1 }),
  senzaFinestra: daCompattare({ contesto: { usati: 400 } }, { soglia: 0.35 }),
  soglia: config().contesto.compattaOltre }));`);
    t.ok(r.sopra === 0.4 && r.sotto === null, `daCompattare: oltre la soglia sì, sotto no: ${r.sopra} ${r.sotto}`);
    t.ok([r.spento, r.errore, r.dopoCompact, r.inCoda, r.senzaFinestra].every((x) => x === null), `daCompattare: mai spento, dopo un errore, dopo un compact, con messaggi in coda, senza finestra`);
    t.ok(r.soglia === 0.35, `config: contesto.compattaOltre letto: ${r.soglia}`);
  }
  {
    const r = esegui({ assistente: { nome: "X" } }, `console.log(JSON.stringify({ soglia: config().contesto.compattaOltre }));`);
    t.ok(r.soglia === null, `config: senza contesto.compattaOltre il compact automatico è spento: ${r.soglia}`);
  }

  // ───── la sessione: compact a fine turno, riga di sistema, niente avviso né doppioni ─────
  {
    const r = esegui(CONFIG, `
const k = nuovo();
const ag = k.crea({ nome: "lavoro" }), o = k.orchestratore();
const scritti = vivo(k, ag), scrittiO = vivo(k, o);
turno(k, ag, 200, "piccolo");                       // 20%: niente
const dopoPiccolo = scritti.length;
turno(k, ag, 500, "grande");                          // 50%: compact
const avvisiPrima = scrittiO.length;                  // gli avvisi [cockpit] dei due turni normali
const compact = scritti.slice(dopoPiccolo);
const statoCompact = ag.stato, nonLettiCompact = ag.nonLetti;
const nota = k.eventi(ag.id).filter((e) => e.type === "cockpit_utente" && e.origine === "compact").map((e) => e.nota);
// durante il compact arriva un messaggio della persona: si accoda al processo
k.invia(ag.id, "ancora una cosa");
const accodato = scritti[scritti.length - 1], inCoda = k.inCoda.get(ag.id);
// fine del compact: il contesto riparte, nessun avviso, nessun secondo compact
k.gestisci(ag, { type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "manual", pre_tokens: 500 } });
k.gestisci(ag, { type: "result", subtype: "success", result: "", modelUsage: {} });
const dopoFineCompact = { scritti: scritti.length, avvisi: scrittiO.length, nonLetti: ag.nonLetti, fini: [...fini] };
// il turno accodato, subito dopo il compact: anche col contesto ancora alto niente compact di fila; il turno dopo sì
k.gestisci(ag, msg(450)); k.gestisci(ag, fine("risposta"));
const dopoAccodato = scritti.length;
turno(k, ag, 450, "di nuovo");
const dopoAltro = scritti.slice(dopoAccodato);
// e mai durante un turno in corso
ag.stato = "lavora"; const inCorso = k.compatta(ag, 0.5);
console.log(JSON.stringify({ dopoPiccolo, compact, statoCompact, nota, accodato, inCoda, dopoFineCompact, avvisiPrima, nonLettiCompact,
  dopoAccodato, dopoAltro, inCorso, avvisiTesto: scrittiO }));`);
    t.ok(r.dopoPiccolo === 0, `sotto la soglia nessun compact: ${r.dopoPiccolo}`);
    t.ok(r.compact.length === 1 && r.compact[0] === "/compact" && r.statoCompact === "lavora", `oltre la soglia, a turno chiuso, /compact al processo: ${JSON.stringify(r.compact)} ${r.statoCompact}`);
    t.ok(r.nota.length === 1 && r.nota[0] === "contesto al 50%, compattato", `riga di sistema in chat: ${r.nota}`);
    t.ok(r.accodato === "ancora una cosa" && r.inCoda === 2, `un messaggio durante il compact si accoda al processo: ${r.accodato} (in coda ${r.inCoda})`);
    t.ok(r.dopoFineCompact.scritti === 2 && r.dopoFineCompact.avvisi === r.avvisiPrima, `fine del compact: niente secondo compact, niente avviso [cockpit]: ${JSON.stringify(r.dopoFineCompact)}`);
    t.ok(!r.dopoFineCompact.fini.includes("compact") && r.dopoFineCompact.nonLetti === r.nonLettiCompact, `il turno di compact non passa dalla casella e non fa fumetto: ${JSON.stringify(r.dopoFineCompact)}`);
    t.ok(r.dopoAccodato === 2, `il turno accodato dopo il compact non ne lancia un altro di fila: ${r.dopoAccodato}`);
    t.ok(r.dopoAltro.length === 1 && r.dopoAltro[0] === "/compact", `un turno più in là, di nuovo oltre la soglia, compatta: ${JSON.stringify(r.dopoAltro)}`);
    t.ok(r.inCorso === false, `mai un compact durante un turno in corso`);
    t.ok(!r.avvisiTesto.some((x) => /compact/i.test(x)), `l'assistente non riceve avvisi sul compact`);
  }
  {
    const r = esegui({ assistente: { nome: "X" } }, `
const k = nuovo(); const ag = k.crea({ nome: "lavoro" }); const scritti = vivo(k, ag); vivo(k, k.orchestratore());
turno(k, ag, 900, "grande"); console.log(JSON.stringify({ scritti }));`);
    t.ok(r.scritti.length === 0, `soglia spenta: nessun compact nemmeno al 90%: ${JSON.stringify(r.scritti)}`);
  }

  // ───── la coda dopo un turno fuso: due messaggi, un result solo, l'assistente non resta «occupato» ─────
  {
    const r = esegui(CONFIG, `
const { occupato } = await import(${JSON.stringify(url("server/squadra.mjs"))});
const attendi = (ms) => new Promise((ok) => setTimeout(ok, ms));
const k = nuovo(); const o = k.orchestratore(); vivo(k, o); k.quieteCodaMs = 40;
k.invia(o.id, "primo"); k.invia(o.id, "secondo, a turno in corso");   // claude li prende nello stesso turno
k.gestisci(o, msg(100)); k.gestisci(o, fine("una risposta per tutti e due"));
const subito = { inCoda: k.inCoda.get(o.id), occupato: occupato(k, o) };
await attendi(120);
const dopo = { inCoda: k.inCoda.get(o.id), occupato: occupato(k, o) };
// un messaggio accodato davvero: dopo il result il processo riparte col suo turno, la coda non si azzera
k.invia(o.id, "terzo"); k.invia(o.id, "quarto");
k.gestisci(o, msg(100)); k.gestisci(o, fine("terzo"));
k.gestisci(o, { type: "stream_event", event: { type: "message_start" } });
await attendi(120);
const accodato = k.inCoda.get(o.id);
console.log(JSON.stringify({ subito, dopo, accodato }));`);
    t.ok(r.subito.inCoda === 1 && r.subito.occupato, `subito dopo il result la coda dice ancora 1: ${JSON.stringify(r.subito)}`);
    t.ok(r.dopo.inCoda === 0 && !r.dopo.occupato, `processo in silenzio dopo il result: coda a zero, assistente libero per ponte e squadra: ${JSON.stringify(r.dopo)}`);
    t.ok(r.accodato === 1, `se dopo il result il processo manda altro la coda resta com'è: ${r.accodato}`);
  }

  // ───── domande senza rimbalzo ─────
  {
    const r = esegui(CONFIG, `
const testo = "Ho finito la pagina.\\n\\nVuoi che la pubblichi adesso?\\n**Procedo col deploy?**";
const k = nuovo(1); const ag = k.crea({ nome: "pagina" }); vivo(k, ag); const so = vivo(k, k.orchestratore());
turno(k, ag, 100, testo);
const k2 = nuovo(0); const ag2 = k2.crea({ nome: "altra" }); vivo(k2, ag2); const so2 = vivo(k2, k2.orchestratore());
turno(k2, ag2, 100, "Fatto tutto.");
console.log(JSON.stringify({ con: so[so.length - 1], senza: so2[so2.length - 1], pulito: testoAvviso(testo, 1), intero: testoAvviso(testo, 0) }));`);
    t.ok(!/pubblichi|deploy/.test(r.con) && /Ho finito la pagina/.test(r.con), `con domande aperte l'avviso non porta le domande: ${JSON.stringify(r.con)}`);
    t.ok(/Non ripeterle, non riassumerle e non nominarle/.test(r.con) && /risponde direttamente a pagina/.test(r.con), `l'avviso dice che la domanda è già nella casella`);
    t.ok(!/Da decidere/.test(r.senza) && /Fatto tutto/.test(r.senza), `senza domande aperte l'avviso resta com'era: ${JSON.stringify(r.senza)}`);
    t.ok(r.intero.includes("deploy") && !r.pulito.includes("?"), `testoAvviso toglie le righe-domanda solo con domande aperte`);
  }

  // ───── la voce non legge il turno di compact (voce-motore.js è del browser: si controlla il testo) ─────
  {
    const v = readFileSync(path.join(t.plancia, "pagine", "condivisi", "voce-motore.js"), "utf8");
    t.ok(/if \(turno\.origine === "compact"\) return false;/.test(v), `voce: deveLeggere non legge il turno di compact`);
  }

  // ───── il prompt dell'assistente ─────
  {
    const p = readFileSync(path.join(t.plancia, "prompt", "assistente.md"), "utf8");
    t.ok(/non ripeti, non riassumi e non richiami le domande dell'agente/.test(p), `prompt/assistente.md: sulle notifiche [cockpit] le domande degli agenti non si ripetono`);
  }
}
