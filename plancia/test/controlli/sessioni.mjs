// Sessioni, prompt e battito: prove sul nucleo senza server e senza processi claude (COCKPIT_PROVA=1), su cartelle temporanee.
// config e stato leggono l'ambiente e tengono una cache: ogni gruppo di prove gira in un processo a parte, con l'ambiente pulito.
import { spawnSync } from "node:child_process";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SPORCHE = ["PLANCIA_CONFIG", "COCKPIT_STATO", "COCKPIT_PERSONA", "COCKPIT_PORTA", "COCKPIT_PROVA"];

const CONFIG_BASE = {
  assistente: { nome: "Giarbis", slug: "giarbis", alias: ["jarvis", "giarvis"] },
  modelli: { default: "opus", foglio: "sonnet" },
};

export default async function (t) {
  const url = (...p) => pathToFileURL(path.join(t.plancia, ...p)).href;
  const scrivi = (file, dati) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, typeof dati === "string" ? dati : JSON.stringify(dati)); };

  // Esegue `corpo` (che termina con console.log(JSON.stringify(...))) in un processo pulito, dentro `cwd`, con quella config.
  function esegui(config, corpo, env = {}) {
    const cwd = realpathSync(t.tmp());
    scrivi(path.join(cwd, "plancia.config.json"), config);
    const pulito = Object.fromEntries(Object.entries(process.env).filter(([k]) => !SPORCHE.includes(k)));
    const pre = `const { Cockpit } = await import(${JSON.stringify(url("server/sessioni.mjs"))});
const { config, chiSono } = await import(${JSON.stringify(url("server/config.mjs"))});
const { caricaModuli } = await import(${JSON.stringify(url("server/moduli.mjs"))});
const Battito = await import(${JSON.stringify(url("server/battito.mjs"))});
const Stato = await import(${JSON.stringify(url("server/stato.mjs"))});
const eventi = [];
const nuovo = async (extra = {}) => { const cfg = config(); const moduli = await caricaModuli(cfg); return new Cockpit({ cfg, persona: { slug: "tester", nome: "Tester" }, moduli, onEvento: (id, ev) => eventi.push(ev.type), ...extra }); };`;
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", `${pre}\n${corpo}`], {
      cwd, encoding: "utf8", env: { ...pulito, COCKPIT_STATO: path.join(cwd, "stato"), COCKPIT_PROVA: "1", ...env },
    });
    if (r.status !== 0) throw new Error(`processo di prova uscito ${r.status}: ${String(r.stderr).slice(-500)}`);
    return JSON.parse(r.stdout.trim().split("\n").pop());
  }

  // ───── orchestratore, nomi, prova ─────
  {
    const r = esegui(CONFIG_BASE, `
const k = await nuovo();
const o = k.orchestratore();
const nomi = ["giarbis", "jarvis", "giarvis", "assistente", "GIARBIS", o.id].map((n) => k.trova(n)?.id === o.id);
let rimossa = ""; try { k.rimuovi(o.id); } catch (e) { rimossa = e.message; }
let doppio = ""; try { k.crea({ nome: "jarvis" }); } catch (e) { doppio = e.message; }
k.invia("jarvis", "ciao");
const dopo = k.trova("giarbis");
const evs = k.eventi(o.id).map((e) => e.type + (e.testo ? ":" + e.testo : ""));
const ag = k.crea({ nome: "Prova Uno", compito: "fai", genitore: "jarvis" });
const cambio = k.cambiaModello(ag.id, "sonnet");
const k2 = await nuovo();
console.log(JSON.stringify({ nome: o.nome, ruolo: o.ruolo, nomi, rimossa, doppio, stato: dopo.stato, evs, procs: k.proc.size,
  agente: ag.nome, genitore: ag.genitore, modello: cambio.sessione.modello, applicato: cambio.applicato,
  ricaricate: k2.elenco().map((s) => [s.nome, s.stato, s.modello]), sessioniJson: Stato.negozio("sessioni", { base: [] }).leggi().length }));`);
    t.ok(r.nome === "giarbis" && r.ruolo === "orchestratore", `orchestratore creato con lo slug dell'assistente: ${r.nome}`);
    t.ok(r.nomi.every(Boolean), `trova risolve assistente, slug e alias, in ogni forma: ${r.nomi}`);
    t.ok(/non si rimuove/.test(r.rimossa), `l'orchestratore non si rimuove: ${r.rimossa}`);
    t.ok(/esiste già/.test(r.doppio), `un agente con un alias dell'assistente non si crea: ${r.doppio}`);
    t.ok(r.stato === "errore" && r.evs.includes("cockpit_utente:ciao") && r.evs.includes("cockpit_errore:prova"), `in prova invia registra e va in errore: ${r.stato} ${r.evs}`);
    t.ok(r.procs === 0, `in prova nessun processo claude: ${r.procs}`);
    t.ok(r.agente === "prova-uno" && r.genitore === "giarbis", `agente creato, genitore risolto con l'alias: ${r.agente}/${r.genitore}`);
    t.ok(r.modello === "claude-sonnet-5-5" && r.applicato, `cambio di modello con l'alias: ${r.modello}`);
    t.ok(r.ricaricate.length === 2 && r.ricaricate.every(([, st]) => st === "ferma"), `riavvio: sessioni ricaricate ferme: ${JSON.stringify(r.ricaricate)}`);
  }

  // ───── il nome viene dalla config, non dal codice ─────
  {
    const r = esegui({ assistente: { nome: "Pippo" } }, `const k = await nuovo(); const p = k.prompt(k.orchestratore());
console.log(JSON.stringify({ nome: k.orchestratore().nome, c: p.startsWith("Sei Pippo,"), ctl: /node [^ ]*ctl\\.mjs lista/.test(p), alias: k.trova("assistente")?.nome }));`);
    t.ok(r.nome === "pippo" && r.c && r.ctl && r.alias === "pippo", `un altro nome in config: ${JSON.stringify(r)}`);
  }

  // ───── prompt composti: nessun segnaposto irrisolto, con e senza il modulo rd-repo ─────
  for (const [etichetta, moduli] of [["senza moduli", {}], ["con rd-repo", { "rd-repo": { todo: { azienda: "todo-azienda" } } }]]) {
    const r = esegui({ ...CONFIG_BASE, moduli }, `const k = await nuovo();
const f = k.crea({ nome: "foglio-x", ruolo: "foglio", foglio: "f1" });
const o = k.orchestratore(), a = k.crea({ nome: "lavoratore" });
const testi = { assistente: k.prompt(o), agente: k.prompt(a), foglio: k.prompt(f),
  battito: k.componiBattito({ ora: "11:00", data: "07/10/2026", segnali_nuovi: "- [x] y", segnali_visti: "", risposte: "" }) };
console.log(JSON.stringify({ residui: Object.entries(testi).filter(([, v]) => /\\{\\{|\\}\\}/.test(v)).map(([n]) => n),
  lunghezze: Object.fromEntries(Object.entries(testi).map(([n, v]) => [n, v.length])),
  repo: Object.fromEntries(Object.entries(testi).map(([n, v]) => [n, /todo chiudi/.test(v)])),
  giarbis: testi.assistente.includes("Sei Giarbis"), modello: /Opus 5\\.5/.test(testi.assistente), moduloModello: f.modello }));`);
    t.ok(r.residui.length === 0, `prompt ${etichetta}: segnaposto irrisolti in ${r.residui}`);
    t.ok(Object.values(r.lunghezze).every((n) => n > 100), `prompt ${etichetta}: testi non vuoti ${JSON.stringify(r.lunghezze)}`);
    t.ok(r.giarbis && r.modello, `prompt ${etichetta}: nome dell'assistente e modello predefinito dalla config`);
    t.ok(r.moduloModello === "claude-sonnet-5-5", `l'agente di foglio nasce col modello dei fogli della config: ${r.moduloModello}`);
    const conRepo = etichetta === "con rd-repo";
    t.ok(r.repo.assistente === conRepo && r.repo.foglio === conRepo, `prompt ${etichetta}: il frammento del modulo ${conRepo ? "c'è" : "non c'è"} ${JSON.stringify(r.repo)}`);
  }

  // ───── battito: segnali dei moduli, silenzio al secondo giro, orari dalla config ─────
  {
    const r = esegui({ ...CONFIG_BASE, battito: { orari: ["12:00", "16:30"], giorni: [1, 2, 3], oraMinima: "09:00" } }, `
const k = await nuovo();
const trasmessi = [];
const ctx = { cockpit: k, persona: { slug: "tester" }, trasmetti: (e) => trasmessi.push(e.type), assicuraFoglio: () => {},
  segnali: [() => [{ chiave: "uno", tipo: "prova", testo: "un fatto di prova" }]] };
const iniziale = Battito.statoBattito();
let presto = ""; try { Battito.impostaBattito(null, { orari: "08:30" }); } catch (e) { presto = e.message; }
Battito.impostaBattito(null, { acceso: true });
const primo = Battito.battitoOra(ctx, { forza: true });
const testoInviato = k.eventi(k.orchestratore().id).find((e) => e.type === "cockpit_utente" && e.origine === "battito");
const secondo = Battito.battitoOra(ctx, { forza: true });
const timer = Battito.avviaBattito(ctx);
const p = Battito.nuovaProposta(ctx, { testo: "una proposta", perche: "perché sì" });
let seconda = ""; try { Battito.nuovaProposta(ctx, { testo: "un'altra" }); } catch (e) { seconda = e.message; }
const risp = Battito.rispondi(ctx, p.id, "no");
console.log(JSON.stringify({ orari: iniziale.orari, giorni: iniziale.giorni, presto, primo, secondo, timer,
  segnale: /un fatto di prova/.test(testoInviato?.testo || ""), intestazione: /^\\[battito\\] Battito delle \\d\\d:\\d\\d/.test(testoInviato?.testo || ""),
  muto: testoInviato?.origine, seconda, stato: risp.stato, contatori: Battito.statoProposte().contatori, trasmessi: [...new Set(trasmessi)] }));`);
    t.ok(JSON.stringify(r.orari) === '["12:00","16:30"]' && JSON.stringify(r.giorni) === "[1,2,3]", `orari e giorni dalla config: ${r.orari} ${r.giorni}`);
    t.ok(/mai prima delle 09:00/.test(r.presto), `ora minima dalla config: ${r.presto}`);
    t.ok(r.primo.esito === "inviato" && r.primo.nuovi === 1, `il segnale di un modulo sveglia l'assistente: ${JSON.stringify(r.primo)}`);
    t.ok(r.segnale && r.intestazione && r.muto === "battito", "il messaggio [battito] viene da prompt/battito.md, con origine battito");
    t.ok(r.secondo.esito === "silenzio", `lo stesso segnale non sveglia due volte: ${JSON.stringify(r.secondo)}`);
    t.ok(r.timer === null, "con COCKPIT_PROVA lo scheduler non parte");
    t.ok(/una alla volta/.test(r.seconda) && r.stato === "no" && r.contatori.fatte === 1 && r.contatori.rifiutate === 1, `proposte: una alla volta, risposta contata ${JSON.stringify(r.contatori)}`);
    t.ok(r.trasmessi.includes("cockpit_proposte"), "gli eventi del battito escono dal catalogo dei tipi");
  }
}
