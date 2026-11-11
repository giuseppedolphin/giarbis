// Le sessioni Claude Code del cockpit: un processo `claude -p` per sessione, con input e output
// in stream-json, pilotato dal server della plancia (plancia/server/server.mjs).
// Avvio con --chrome (se cfg.chrome non è false, o se il ruolo della squadra lo dice: campo chrome di ruoli.json): la sessione ha gli strumenti di Claude in Chrome (mcp__claude-in-chrome__*).
// Con --allowedTools solo le sessioni della squadra il cui ruolo dichiara `permessi` in ruoli.json: in modalità auto le regole di allow
// valgono prima del classificatore, che altrimenti nega le scritture su sistemi esterni (etichette Gmail, invii, calendario).
//
// Gira sul login dell'abbonamento (niente API key): è il binario ufficiale non modificato, per
// uso personale. Ogni sessione è un processo che resta vivo fra un messaggio e l'altro; se muore
// (o il server riparte) la sessione resta "ferma" e al messaggio successivo riparte con --resume.
// Con COCKPIT_PROVA=1 non parte mai nessun processo: `invia` registra il messaggio e mette la sessione in errore «prova».
//
// Cosa si salva, nella cartella di stato (stato.mjs, che è l'unico a toccarla):
//   sessioni.json      → l'elenco: nome, ruolo, id della sessione Claude, modello, stato
//   <id>.jsonl         → gli eventi di ogni sessione (senza i delta di streaming), per rivederli
//
// I testi per i modelli stanno in plancia/prompt/*.md (più i frammenti dei moduli): si rileggono a ogni avvio di processo.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { PLANCIA, comandoCtl, chiSono, config } from "./config.mjs";
import { modelloDefault, modelloFoglio, nomeModello, risolviModello } from "./modelli.mjs";
import { negozio, percorsoStato, registro } from "./stato.mjs";
import { componi } from "./prompt.mjs";
import { alRiavvio as timerAlRiavvio, potaOrfani as potaTimerOrfani, sospendi as sospendiTimer } from "./timer.mjs";
import { aggiorna as aggiornaSotto, interrompi as interrompiSotto } from "./sottoagenti.mjs";
import { registraLimiti } from "./consumo.mjs";
import { aggiornaContesto, daCompattare } from "./contesto.mjs";
import { avvisoAlCreatore, discendenti, esitoTurno, genitoreDi, ruoloInCima, testoAvviso } from "./catena.mjs";
import { chiudiProcesso, chiusuraDovuta, occupata, togliProcesso } from "./chiusura.mjs";
import { CONTROLLO_MCP_MS, avvisoConnettori, richiestaStatoMcp } from "./connettori.mjs";

const STATI = ["ferma", "avvio", "lavora", "attende", "errore"];
const GIORNI = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
const inProva = () => process.env.COCKPIT_PROVA === "1";
const senzaPrivate = ({ vivo, ...s }) => s;

// I job di CronCreate di una sessione tornano quando il suo processo riparte con --resume (verificato:
// un job creato dal processo di prima era in CronList del processo nuovo); si perdono solo con una conversazione nuova, senza claudeId.
export const conversazioneRipresa = (s) => !!s?.claudeId;

// La riga di comando di `claude -p` per una sessione (pura: la controlla il test senza lanciare processi).
// `cartelle`: le cartelle in più dove la sessione lavora oltre alla cartella di lavoro (--add-dir), solo se un ruolo le dichiara.
// `permessi`: le regole di allow del ruolo (--allowedTools), una per argomento perché alcune contengono spazi; vuoto = nessun flag.
const QUIETE_CODA_MS = 30000; // riallineaCoda: silenzio del processo dopo un result oltre il quale la coda è vuota

export function argomentiClaude({ modello, prompt, nome, claudeId = null, chrome = true, cartelle = [], permessi = [] }) {
  const args = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
    "--include-partial-messages", ...(chrome ? ["--chrome"] : []), "--model", modello, "--permission-mode", "auto", "--permission-prompts", "none",
    ...cartelle.flatMap((c) => ["--add-dir", c]), ...(permessi.length ? ["--allowedTools", ...permessi] : []), "--append-system-prompt", prompt, "-n", `cockpit · ${nome}`];
  if (claudeId) args.push("--resume", claudeId);
  return args;
}

export { testoAvviso }; // il testo dell'avviso di fine turno sta in catena.mjs

export class Cockpit {
  // cfg e persona vengono da config.mjs; contestoFoglio(idFoglio) → il testo del foglio per il suo agente; moduli = quelli accesi
  // osservatore = { fineTurno(s, {testo, origine, inizio}), messaggio(s, evento) }: lo usa la casella delle domande (domande.mjs)
  constructor({ cfg = config(), persona = chiSono(), onEvento = () => {}, contestoFoglio = () => "", moduli = [], osservatore = {} } = {}) {
    this.cfg = cfg;
    this.persona = persona;
    this.chi = persona.nome || "chi usa il cockpit";
    this.onEvento = onEvento; // (id, evento) → broadcast ai browser
    this.contestoFoglio = contestoFoglio;
    this.moduli = moduli;
    this.osservatore = osservatore;
    this.compositori = {}; // ruolo → (s) => prompt: lo registra chi porta un ruolo nuovo (la squadra)
    this.cartelle = {}; // ruolo → (s) => [cartelle in più, --add-dir]: lo registra chi porta un ruolo nuovo (la squadra)
    this.chrome = {}; // ruolo → (s) => vero/falso per --chrome, undefined = vale cfg.chrome: lo registra la squadra (campo chrome dei ruoli)
    this.permessi = {}; // ruolo → (s) => [regole di allow, --allowedTools]: lo registra la squadra (campo permessi dei ruoli)
    this.tettoUsaEGetta = () => 2; // (sessione della squadra) → quanti usa e getta vivi può avere: lo registra la squadra (campo usaEGetta dei ruoli)
    this.turno = new Map(); // id → { inizio, origine } del turno in corso, per l'osservatore a fine turno
    this.inCoda = new Map(); // id → messaggi scritti al processo e non ancora chiusi da un result (il compact aspetta che sia zero)
    this.visti = new Map(); // id → quanti eventi ha mandato il processo: dice se dopo un result è arrivato altro (riallineaCoda)
    this.quieteCodaMs = QUIETE_CODA_MS;
    this.compattata = new Map(); // id → il numero del turno di compact più recente (mai due di fila)
    this.chiusure = new Map(); // id → () => vale ancora: il processo da chiudere a fine turno (chiusura.mjs)
    this.negozio = negozio("sessioni", { base: [] });
    this.sessioni = new Map();
    this.proc = new Map();
    const salvate = this.negozio.leggi();
    for (const s of Array.isArray(salvate) ? salvate : []) {
      // un cambio di modello rimasto in attesa vale al riavvio (i processi sono morti); gli alias di prima sono già stati migrati
      let modello; try { modello = risolviModello(s.modelloPendente || s.modello); } catch { modello = modelloDefault(); }
      const { modelloPendente, ...resto } = s;
      if (Array.isArray(resto.sotto)) interrompiSotto(resto.sotto); // i processi sono morti: i sotto-agenti in corso non lo sono più
      this.sessioni.set(s.id, { ...resto, modello, stato: "ferma", vivo: false });
    }
    // Primo avvio: senza config e col lanciatore (PLANCIA_PRIMO_AVVIO=1) l'orchestratore è "setup"; con la config scritta la
    // sessione "setup" resta sulla mappa come agente fermo (ruolo "setup") e nasce l'orchestratore vero.
    this.modalita = !cfg.fileConfig && process.env.PLANCIA_PRIMO_AVVIO === "1" ? "setup" : "normale";
    const vecchio = this.orchestratore();
    if (vecchio && this.modalita === "normale" && vecchio.nome === "setup" && cfg.assistente.slug !== "setup") {
      vecchio.ruolo = "setup"; this.salva();
    }
    if (!this.orchestratore()) this.crea({ nome: this.modalita === "setup" ? "setup" : cfg.assistente.slug, ruolo: "orchestratore" });
    if (process.env.PLANCIA_PRIMO_AVVIO === "1") setImmediate(() => this.messaggioAvvio());
  }

  // Primo messaggio automatico (origine "sistema"): all'agente di setup [primo avvio], all'assistente al primo avvio con
  // config [benvenuto]. Solo se l'orchestratore non ha ancora turni né eventi: i riavvii non lo ripetono.
  messaggioAvvio() {
    const o = this.orchestratore();
    if (!o || o.turni || registro(o.id).leggi({ ultime: 1 }).length) return;
    try { this.invia(o.id, componi(this.modalita === "setup" ? "primo-avvio" : "benvenuto", this.variabili(), this.moduli).trim(), { origine: "sistema", mittente: "sistema" }); }
    catch (e) { console.error("messaggio di avvio:", e.message); }
  }

  salva() { this.negozio.scrivi([...this.sessioni.values()].map(senzaPrivate)); }

  elenco() {
    return [...this.sessioni.values()].map((s) => ({ ...senzaPrivate(s), processo: this.proc.has(s.id) })) // processo: c'è un claude vivo (la pagina)
      .sort((a, b) => (a.ruolo === "orchestratore" ? -1 : b.ruolo === "orchestratore" ? 1 : b.creata.localeCompare(a.creata)));
  }

  orchestratore() { return [...this.sessioni.values()].find((s) => s.ruolo === "orchestratore") || null; }

  // Per id, per nome, oppure per uno dei nomi dell'assistente («assistente», lo slug, gli alias della config): l'orchestratore.
  trova(chiave) {
    if (this.sessioni.has(chiave)) return this.sessioni.get(chiave);
    const k = String(chiave || "").toLowerCase();
    const { slug, alias } = this.cfg.assistente;
    if (["assistente", slug, ...alias].includes(k) && this.orchestratore()) return this.orchestratore();
    return [...this.sessioni.values()].find((s) => s.nome === k) || null;
  }

  // extra: campi in più della sessione (la squadra ci mette `squadra: { nome, capo, tipo }`)
  crea({ nome, ruolo = "agente", modello = "", compito = "", genitore = "", foglio = "", extra = {} }) {
    nome = String(nome || "").toLowerCase().trim().replace(/[^a-z0-9àèéìòù-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
    if (!nome) throw new Error("serve un nome");
    if (this.trova(nome)) throw new Error(`esiste già un agente "${nome}"`);
    // genitore: il nome di chi l'ha lanciato (l'assistente o un altro agente via ctl.mjs); vuoto = dalla pagina
    const p = genitore ? this.trova(genitore) : null, padre = p ? p.nome : "";
    // L'usa e getta di un ruolo della squadra (o di un altro usa e getta): i vivi sotto il ruolo in cima, a ogni profondità,
    // stanno nel suo tetto; Sonnet se chi lo crea non sceglie il modello; il suo prompt (catena.mjs).
    const capo = ruolo === "agente" && (p?.ruolo === "squadra" || p?.usaEGetta) ? ruoloInCima(this, p) : null;
    if (ruolo === "agente" && p?.usaEGetta && !capo) throw new Error(`${p.nome} non ha più il ruolo della squadra sopra di sé: non crea agenti`);
    if (capo) {
      const tetto = this.tettoUsaEGetta(capo), vivi = discendenti(this, capo).length;
      if (vivi >= tetto) throw new Error(tetto ? `${capo.nome} ha già ${vivi} agenti usa e getta (tetto ${tetto}): prima ${comandoCtl()} rimuovi <nome> di uno finito` : `${capo.nome} non crea agenti usa e getta (tetto 0 nel file dei ruoli)`);
    }
    modello = risolviModello(modello || (ruolo === "foglio" ? modelloFoglio() : capo ? "sonnet" : "")); // alias → id; vuoto = il predefinito
    const ora = new Date().toISOString();
    const s = {
      id: randomUUID().slice(0, 8), nome, ruolo, modello, genitore: padre, claudeId: null, stato: "ferma", creata: ora,
      aggiornata: ora, ultimo: "", costo: 0, turni: 0, nonLetti: 0, vivo: false, ...(foglio ? { foglio: String(foglio) } : {}),
      ...(capo ? { usaEGetta: true } : {}), ...extra,
    };
    this.sessioni.set(s.id, s);
    this.salva();
    this.emetti(s, { type: "cockpit_sessione" });
    if (compito) this.invia(s.id, compito, { mittente: padre || this.persona.slug || "tu" });
    return s;
  }

  // da: chi la toglie, quando passa dal ctl. Un agente toglie solo quelli che ha creato lui; l'assistente e la pagina (da vuoto) tutti.
  rimuovi(id, { forza = false, da = "" } = {}) {
    const s = this.trova(id);
    if (!s) throw new Error("sessione non trovata");
    if (s.ruolo === "orchestratore") throw new Error(`${s.nome} non si rimuove`);
    // un agente della squadra viene dal file dei ruoli: si spegne, non si toglie (lo toglie solo la squadra, se il ruolo sparisce)
    if (s.ruolo === "squadra" && !forza) throw new Error(`${s.nome} è della squadra: si spegne dal pannello Squadra, non si rimuove`);
    const chi = da ? this.trova(da) : null;
    if (chi && chi.ruolo !== "orchestratore" && s.genitore !== chi.nome) throw new Error(`${s.nome} non l'ha creato ${chi.nome}: lo toglie chi l'ha creato, ${this.cfg.assistente.nome} o ${this.chi} dalla pagina`);
    // con lui se ne vanno gli usa e getta che ha creato: lavoravano per lui, e il loro avviso non avrebbe più un destinatario
    const via = [s];
    for (let i = 0; i < via.length; i++) via.push(...[...this.sessioni.values()].filter((x) => x.usaEGetta && x.genitore === via[i].nome && !via.includes(x)));
    for (const x of via) { this.proc.get(x.id)?.kill("SIGTERM"); this.sessioni.delete(x.id); }
    this.salva();
    for (const x of via) this.onEvento(x.id, { type: "cockpit_rimossa" });
  }

  // L'orchestratore riparte da zero: nuova sessione Claude, storico del cockpit svuotato.
  nuovaConversazione(id) {
    const s = this.trova(id);
    if (!s) throw new Error("sessione non trovata");
    this.proc.get(s.id)?.kill("SIGTERM");
    s.claudeId = null; s.ultimo = ""; s.turni = 0; s.nonLetti = 0; s.costo = 0;
    registro(s.id).azzera();
    this.setStato(s, "ferma");
    this.onEvento(s.id, { type: "cockpit_azzerata" });
  }

  eventi(id) {
    const s = this.trova(id);
    return s ? registro(s.id).leggi() : [];
  }

  letta(id) {
    const s = this.trova(id);
    if (s && s.nonLetti) { s.nonLetti = 0; this.salva(); this.emetti(s, { type: "cockpit_sessione" }); }
  }

  // L'avanzamento di un agente (l'anello attorno alla sua sfera): lo dichiara l'agente con `ctl.mjs progresso`.
  //   {piano: ["passo", …]} lo apre · {avanti: true, passo?} fa un passo · {fatti, totale, passo?} lo scrive esplicito
  progresso(id, c = {}) {
    const s = this.trova(id);
    if (!s) throw new Error("sessione non trovata");
    const testo = (t) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    const att = s.progresso || null;
    let n;
    if (Array.isArray(c.piano)) {
      const piano = c.piano.map(testo).filter(Boolean).slice(0, 30);
      if (!piano.length) throw new Error("il piano è vuoto");
      n = { piano, fatti: 0, totale: piano.length, passo: piano[0] };
    } else if (c.avanti) {
      if (!att) throw new Error("nessun piano dichiarato: prima `progresso piano \"passo1|passo2\"` o `progresso <fatti>/<totale>`");
      const fatti = Math.min(att.totale, att.fatti + 1);
      n = { ...att, fatti, passo: testo(c.passo) || (att.piano ? att.piano[fatti] || "" : "") };
    } else {
      const fatti = Number(c.fatti), totale = Number(c.totale);
      const valido = Number.isInteger(fatti) && Number.isInteger(totale) && totale >= 1 && totale <= 99 && fatti >= 0 && fatti <= totale;
      if (!valido) throw new Error("serve <fatti>/<totale> con 0 ≤ fatti ≤ totale ≤ 99");
      n = { fatti, totale, passo: testo(c.passo) };
    }
    s.progresso = { ...n, t: Date.now() };
    this.salva();
    this.emetti(s, { type: "cockpit_sessione" });
    return s.progresso;
  }

  setStato(s, stato) {
    if (!STATI.includes(stato)) return;
    if (stato !== "lavora" && stato !== "avvio") delete s.progresso; // a turno chiuso (bene o male) il piano non vale più; l'anello si spegne sulla pagina
    s.stato = stato;
    s.aggiornata = new Date().toISOString();
    this.salva();
    this.emetti(s, { type: "cockpit_sessione" });
  }

  emetti(s, ev, registra = false) {
    if (registra) registro(s.id).aggiungi({ t: Date.now(), ...ev });
    const { vivo, ...pubblica } = s;
    this.onEvento(s.id, ev.type === "cockpit_sessione" ? { ...ev, sessione: { ...pubblica, processo: this.proc.has(s.id) } } : { t: Date.now(), ...ev });
  }

  // ───── i testi per i modelli (plancia/prompt/*.md + frammenti dei moduli), riletti a ogni avvio di processo ─────

  variabili(extra = {}) {
    const { assistente, battito } = this.cfg;
    const mappa = path.join(PLANCIA, "CLAUDE.md");
    const rel = path.relative(this.cfg.cartella, mappa);
    return {
      assistente: assistente.nome,
      assistente_slug: assistente.slug,
      persona: this.chi,
      riporta_a: assistente.nome, // a chi va l'avviso di fine turno di un agente (prompt/agente.md): l'assistente, se non l'ha creato un altro agente
      ctl: comandoCtl(),
      modello_default: nomeModello(modelloDefault()),
      mappa: rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : mappa,
      quaderno: percorsoStato("quaderno.md"),
      battito_orari: battito.orari.join(", "),
      battito_giorni: `nei giorni: ${battito.giorni.map((g) => GIORNI[g]).filter(Boolean).join(", ")}`,
      ...extra,
    };
  }

  prompt(s) {
    if (this.compositori[s.ruolo]) return this.compositori[s.ruolo](s); // ruoli che portano il loro prompt (la squadra, squadra.mjs)
    if (s.ruolo === "orchestratore") return componi(s.nome === "setup" && this.modalita === "setup" ? "setup" : "assistente", this.variabili(), this.moduli);
    if (s.ruolo === "foglio") {
      const contesto = this.contestoFoglio(s.foglio) || "(il foglio non c'è più: dillo e chiedi cosa fare)";
      return componi("foglio", this.variabili({ nome: s.nome, contesto }), this.moduli);
    }
    const capo = this.capoDi(s), g = genitoreDi(this, s);
    if (capo) {
      const creatore = !g || g.id === capo.id ? `@${capo.nome}, un ruolo della squadra` : `@${g.nome}, un altro agente usa e getta (sotto @${capo.nome})`;
      return componi("squadra-usa-e-getta", this.variabili({ nome: s.nome, capo: (g || capo).nome, creatore, appunti: this.relativo(percorsoStato("squadra", capo.nome, "appunti")) }), this.moduli);
    }
    return componi("agente", this.variabili({ nome: s.nome, ...(g ? { riporta_a: `"${g.nome}", l'agente che ti ha creato` } : {}) }), this.moduli);
  }

  // Il ruolo della squadra in cima alla catena di un usa e getta, se c'è ancora; null per ogni altra sessione.
  capoDi(s) { return s?.usaEGetta ? ruoloInCima(this, s) : null; }

  relativo(p) {
    const r = path.relative(this.cfg.cartella, p);
    return r && !r.startsWith("..") && !path.isAbsolute(r) ? r : p;
  }

  // Il messaggio [battito] (prompt/battito.md): lo chiama battito.mjs con ora, data, segnali nuovi, già visti, risposte.
  componiBattito(variabili) { return componi("battito", this.variabili(variabili), this.moduli).trim(); }

  // Gli argomenti di `claude -p` per una sessione: il modello è quello della sessione, e con --resume la conversazione continua.
  argomenti(s) {
    return argomentiClaude({ modello: s.modello, prompt: this.prompt(s), nome: s.nome, claudeId: s.claudeId, chrome: this.chrome[s.ruolo]?.(s) ?? this.cfg.chrome !== false, cartelle: this.cartelle[s.ruolo]?.(s) || [], permessi: this.permessi[s.ruolo]?.(s) || [] });
  }

  // Cambio di modello. Via scelta, la più sicura: un turno in corso non si interrompe mai. A sessione ferma (o in attesa) il cambio
  // vale subito; al lavoro resta in `modelloPendente` e scatta a fine turno. In entrambi i casi il processo `claude -p` di QUESTA
  // sessione riparte con --resume e il nuovo --model, al messaggio successivo: la conversazione non si perde e le altre sessioni non si toccano.
  cambiaModello(id, modello) {
    const s = this.trova(id);
    if (!s) throw new Error("sessione non trovata");
    const nuovo = risolviModello(modello);
    const inCorso = s.vivo && (s.stato === "lavora" || s.stato === "avvio");
    if (nuovo === s.modello) { // scegliere quello attuale annulla un cambio in attesa
      if (s.modelloPendente) { delete s.modelloPendente; this.salva(); this.emetti(s, { type: "cockpit_sessione" }); }
      return { sessione: s, applicato: true };
    }
    if (inCorso) {
      s.modelloPendente = nuovo; this.salva(); this.emetti(s, { type: "cockpit_sessione" });
      return { sessione: s, applicato: false };
    }
    this.applicaModello(s, nuovo);
    return { sessione: s, applicato: true };
  }

  applicaModello(s, nuovo) {
    s.modello = nuovo; delete s.modelloPendente;
    const p = this.proc.get(s.id);
    if (p) { this.proc.delete(s.id); s.vivo = false; p.kill("SIGTERM"); } // via subito dalla tabella: un messaggio che arriva ora avvia il processo nuovo
    this.salva();
    this.emetti(s, { type: "cockpit_sessione" });
  }

  avvia(s) {
    if (inProva()) throw new Error("prova: nessun processo claude"); // invia() non ci arriva: è una rete di sicurezza
    const args = this.argomenti(s);
    const p = spawn("claude", args, { cwd: this.cfg.cartella, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: { ...process.env, COCKPIT_SESSIONE: s.nome, COCKPIT_TOKEN: this.tokenDi?.(s) } });
    this.proc.set(s.id, p);
    this.inCoda.set(s.id, 0);
    this.chiusure.delete(s.id); // un processo nuovo: la chiusura chiesta per quello di prima è fatta
    s.vivo = true;
    // Con --resume i job di CronCreate tornano; una conversazione nuova non li ha più: i timer restano sulla mappa ma spenti, finché la sessione non li ricrea.
    try { if (!conversazioneRipresa(s) && sospendiTimer(s.nome)) this.onEvento(s.id, { type: "cockpit_timer", azione: "sospesi" }); } catch { /* il registro non deve fermare l'avvio */ }
    this.setStato(s, "avvio");
    let buf = "", errore = "";
    p.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const riga = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!riga) continue;
        let ev; try { ev = JSON.parse(riga); } catch { continue; }
        this.gestisci(s, ev);
      }
    });
    p.stderr.on("data", (d) => { errore = (errore + d).slice(-2000); });
    // qualche minuto dopo l'avvio, una volta: i connettori claude.ai si sono collegati? (connettori.mjs; all'init sono ancora «pending»)
    setTimeout(() => { if (this.proc.get(s.id) === p && !p.stdin.destroyed) try { p.stdin.write(richiestaStatoMcp()); } catch { /* processo già chiuso */ } }, this.controlloMcpMs ?? CONTROLLO_MCP_MS).unref?.();
    p.on("exit", (codice) => {
      if (this.proc.get(s.id) !== p) return; // processo sostituito (cambio di modello): lo stato lo governa quello nuovo, o resta com'è
      this.proc.delete(s.id);
      this.inCoda.delete(s.id);
      s.vivo = false;
      if (!this.sessioni.has(s.id)) return;
      if (codice && codice !== 143 && s.stato !== "attende") {
        this.emetti(s, { type: "cockpit_errore", testo: (errore.trim() || `il processo è uscito con codice ${codice}`).slice(-600) }, true);
        this.setStato(s, "errore");
      } else this.setStato(s, "ferma");
    });
    p.on("error", (e) => { this.emetti(s, { type: "cockpit_errore", testo: e.message }, true); this.setStato(s, "errore"); });
    return p;
  }

  // Subagenti (Agent) e workflow (Workflow) lanciati dentro la sessione: lo stato in `s.sotto` (sottoagenti.mjs), la mappa li
  // disegna come nodi figli. task_progress arriva spesso: si manda subito alla pagina, si salva su disco al massimo ogni 1,5 s.
  tracciaSotto(s, ev) {
    if (!aggiornaSotto(s.sotto || (s.sotto = []), ev)) return;
    if (!this.salvaSottoT) { this.salvaSottoT = setTimeout(() => { this.salvaSottoT = null; this.salva(); }, 1500); this.salvaSottoT.unref(); }
    this.emetti(s, { type: "cockpit_sessione" });
  }

  gestisci(s, ev) {
    // la risposta a mcp_status (connettori.mjs) prima di `visti`: non è attività del turno, se no riallineaCoda non azzera più la coda
    if (ev.type === "control_response") { const a = avvisoConnettori(ev); if (a) { console.error(`${s.nome}: ${a}`); this.emetti(s, { type: "cockpit_errore", testo: a }, true); } return; }
    this.visti.set(s.id, (this.visti.get(s.id) || 0) + 1);
    // la finestra di contesto (contesto.mjs): messaggi e fine turno la emettono già più sotto, la compattazione no
    if (aggiornaContesto(s, ev) && ev.type === "system") { this.salva(); this.emetti(s, { type: "cockpit_sessione" }); }
    if (ev.type === "system" || ev.type === "assistant" || ev.type === "user") this.tracciaSotto(s, ev);
    if (ev.type === "system" && ev.subtype === "init") {
      if (ev.session_id && s.claudeId !== ev.session_id) { s.claudeId = ev.session_id; this.salva(); }
      this.emetti(s, { type: "system", subtype: "init", model: ev.model }, false);
      return;
    }
    if (ev.type === "stream_event") {
      const e = ev.event || {};
      if (e.type === "content_block_delta" && e.delta?.type === "text_delta") this.emetti(s, { type: "delta", testo: e.delta.text });
      else if (e.type === "content_block_start" && e.content_block?.type === "tool_use") this.emetti(s, { type: "delta_tool", nome: e.content_block.name });
      else if (e.type === "content_block_start" && e.content_block?.type === "thinking") this.emetti(s, { type: "delta_pensa" });
      return;
    }
    if (ev.type === "assistant") {
      const blocchi = (ev.message?.content || []).filter((b) => b.type !== "thinking" && b.type !== "redacted_thinking");
      if (!blocchi.length) return;
      const testo = blocchi.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      if (testo) s.ultimo = testo.slice(0, 240);
      else { const t = blocchi.find((b) => b.type === "tool_use"); if (t) s.ultimo = `⚙ ${t.name}`; }
      this.emetti(s, { type: "assistant", blocchi, parent: ev.parent_tool_use_id || null }, true);
      if (s.stato !== "lavora") this.setStato(s, "lavora"); else { this.salva(); this.emetti(s, { type: "cockpit_sessione" }); }
      return;
    }
    if (ev.type === "user") {
      const contenuto = Array.isArray(ev.message?.content) ? ev.message.content : [];
      const testoRisultato = (b) => (Array.isArray(b.content)
        ? b.content.map((c) => c.text || (c.type === "image" ? "[immagine]" : "")).join("\n")
        : String(b.content ?? "")).slice(0, 6000);
      const risultati = contenuto.filter((b) => b.type === "tool_result").map((b) => ({ id: b.tool_use_id, errore: !!b.is_error, testo: testoRisultato(b) }));
      if (risultati.length) this.emetti(s, { type: "risultati", risultati }, true);
      return;
    }
    if (ev.type === "result") {
      const turno = this.turno.get(s.id) || {};
      this.turno.delete(s.id);
      this.inCoda.set(s.id, Math.max(0, (this.inCoda.get(s.id) || 0) - 1));
      const compact = turno.origine === "compact"; // il turno del compact automatico: niente fumetto, avviso, domande né voce
      s.turni += 1;
      s.costo = Math.round(((s.costo || 0) + (ev.total_cost_usd || 0)) * 10000) / 10000;
      if (!compact) {
        if (ev.result) s.ultimo = String(ev.result).slice(0, 240);
        s.nonLetti = (s.nonLetti || 0) + 1;
      }
      this.emetti(s, { type: "fine", esito: ev.subtype, errore: !!ev.is_error, durata_ms: ev.duration_ms, costo: ev.total_cost_usd, testo: ev.is_error ? String(ev.result || "") : "" }, true);
      this.setStato(s, "attende");
      if (s.modelloPendente) this.applicaModello(s, s.modelloPendente); // il turno è chiuso: ora si può cambiare
      if (compact) { this.compattata.set(s.id, s.turni); chiusuraDovuta(this, s); this.riallineaCoda(s); return; }
      // prima la casella (una domanda rimasta nel testo diventa «presa dal testo»), poi l'avviso, che così sa se l'agente chiede qualcosa
      try { this.osservatore.fineTurno?.(s, { testo: ev.is_error ? "" : String(ev.result || ""), origine: turno.origine || "", inizio: turno.inizio || 0 }); }
      catch (e) { console.error("fine turno:", e.message); }
      if (s.ruolo === "agente" && turno.origine !== "timer") this.avvisaFineTurno(s, ev); // i timer ricreati al riavvio non si annunciano
      if (chiusuraDovuta(this, s)) return; // la chiusura chiesta a turno in corso (spegni della squadra): il compact lo farà il processo nuovo
      const quota = daCompattare(s, { soglia: this.cfg.contesto?.compattaOltre, origine: turno.origine, errore: !!ev.is_error, inCoda: this.inCoda.get(s.id) || 0,
        dopoCompact: this.compattata.get(s.id) === s.turni - 1 });
      if (quota != null) this.compatta(s, quota);
      this.riallineaCoda(s);
      return;
    }
    if (ev.type === "rate_limit_event") { try { registraLimiti(ev.rate_limit_info); } catch { /* il consumo non deve fermare la sessione */ } }
    if (ev.type === "rate_limit_event" && ev.rate_limit_info?.status && ev.rate_limit_info.status !== "allowed") {
      this.emetti(s, { type: "cockpit_errore", testo: `limite dell'abbonamento: ${ev.rate_limit_info.status} (${ev.rate_limit_info.rateLimitType || ""})` }, true);
    }
  }

  // Un messaggio scritto al processo mentre un turno è in corso claude lo può prendere dentro quel turno: un result solo per due
  // messaggi, e inCoda resterebbe sopra zero per sempre, con l'assistente «occupato» per ponte, squadra e compact.
  // Dopo un result con inCoda ancora sopra zero: se per `quieteCodaMs` il processo non manda più niente e la sessione aspetta, in
  // coda non c'è nulla. Un messaggio accodato davvero fa partire il suo turno, e i primi eventi dello stream arrivano prima.
  riallineaCoda(s) {
    if (!((this.inCoda.get(s.id) || 0) > 0)) return;
    const p = this.proc.get(s.id), visto = this.visti.get(s.id) || 0;
    const t = setTimeout(() => {
      if (this.proc.get(s.id) !== p || (this.visti.get(s.id) || 0) !== visto || s.stato !== "attende") return;
      this.inCoda.set(s.id, 0);
      chiusuraDovuta(this, s);
    }, this.quieteCodaMs);
    t.unref?.();
  }

  // Il compact automatico (decisione): a turno chiuso, contesto oltre `contesto.compattaOltre`, `/compact` al processo
  // ancora vivo. Non passa da invia(): non chiude domande, non apre la voce; in chat resta solo la riga di sistema. Un messaggio della
  // persona che arriva intanto si accoda al processo come sempre.
  compatta(s, quota) {
    const p = this.proc.get(s.id);
    if (!p || !s.vivo || s.stato === "lavora" || s.stato === "avvio") return false;
    this.turno.set(s.id, { inizio: Date.now(), origine: "compact" });
    this.inCoda.set(s.id, (this.inCoda.get(s.id) || 0) + 1);
    this.emetti(s, { type: "cockpit_utente", testo: "/compact", nota: `contesto al ${Math.round(quota * 100)}%, compattato`, origine: "compact", mittente: "cockpit" }, true);
    p.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: "/compact" } }) + "\n");
    this.setStato(s, "lavora");
    return true;
  }

  // A fine turno di un agente: l'avviso va a chi l'ha creato, a qualunque profondità; all'assistente se l'ha creato lui, la
  // pagina, o se chi l'ha creato non c'è più (catena.mjs).
  avvisaFineTurno(s, ev) {
    const g = genitoreDi(this, s);
    if (!g) return this.avvisaOrchestratore(s, ev);
    let aperte = 0; try { aperte = this.osservatore.domandeAperte?.(s) || 0; } catch { /* la casella non deve fermare l'avviso */ }
    try { this.invia(g.id, avvisoAlCreatore(s, ev, { aperte, persona: this.chi }), { nota: `${s.nome} ${esitoTurno(ev)}`, origine: "agente", mittente: s.nome }); }
    catch { /* chi l'ha creato non è raggiungibile: la mappa lo mostra comunque */ }
  }

  avvisaOrchestratore(s, ev) {
    const o = this.orchestratore();
    if (!o) return;
    const esito = esitoTurno(ev);
    // Domande senza rimbalzo: se l'agente ha domande aperte nella casella, l'avviso non le porta (via le righe
    // che finiscono con «?») e dice all'assistente di non ripeterle: la persona risponde direttamente all'agente.
    let aperte = 0; try { aperte = this.osservatore.domandeAperte?.(s) || 0; } catch { /* la casella non deve fermare l'avviso */ }
    const risposta = testoAvviso(ev.result, aperte);
    const nota = aperte ? `\n\n${s.nome} ha ${aperte === 1 ? "una domanda aperta" : `${aperte} domande aperte`} nella casella «Da decidere»: ${this.chi} risponde direttamente a ${s.nome}. Non ripeterle, non riassumerle e non nominarle.` : "";
    // origine «agente»: il turno dell'assistente che ne nasce si legge ad alta voce (una coda sola, voce-motore.js)
    const testo = `[cockpit] L'agente "${s.nome}" ${esito}. La sua ultima risposta:\n${risposta}${nota}`;
    try { this.invia(o.id, testo, { nota: `${s.nome} ${esito}`, origine: "agente" }); } catch { /* l'orchestratore non è raggiungibile: la mappa lo mostra comunque */ }
  }

  // Al riavvio del server i processi claude sono morti, ma una sessione ripresa con --resume ritrova i suoi job di CronCreate:
  // il server non li vede, quindi ogni timer resta spento finché la sessione non controlla con CronList, riaccende quelli
  // che ci sono e ricrea solo quelli che mancano. L'avviso è anche ciò che fa ripartire il processo, e coi suoi job.
  // I timer di una sessione che non c'è più vanno all'assistente, poi escono dal registro: quei job erano di un'altra
  // conversazione e lì vanno ricreati. La memoria della cosa sta nella to-do o nella nota che ha dietro (prompt agente e assistente).
  avvisaTimerSpenti(adesso = Date.now()) {
    let spenti; try { spenti = timerAlRiavvio(); } catch (e) { console.error("timer al riavvio:", e.message); return 0; }
    const perSessione = new Map(), o = this.orchestratore();
    for (const t of spenti) {
      const s = this.trova(t.sessione), dest = s || o;
      if (!dest) continue;
      if (!perSessione.has(dest.id)) perSessione.set(dest.id, []);
      perSessione.get(dest.id).push({ t, ereditato: !s });
    }
    const ctl = comandoCtl(), quando = (ms) => new Date(ms).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    for (const [id, voci] of perSessione) {
      const ripresa = conversazioneRipresa(this.trova(id));
      const riga = ({ t, ereditato }) => {
        const passato = t.unaVolta && t.prossimo && Date.parse(t.prossimo) <= adesso;
        return `- «${t.descrizione}» · \`${t.ricorrenza}\`${t.unaVolta ? " · una volta" : ""} · timer \`${t.id}\`${t.idCron ? `, job \`${t.idCron}\`` : ""}`
          + (passato ? ` · doveva scattare il ${quando(Date.parse(t.prossimo))}, a server spento: non è successo` : "")
          + (ereditato ? ` · era di "${t.sessione}", che non c'è più: è già uscito dal registro` : "");
      };
      const suoi = voci.filter((v) => !v.ereditato && ripresa), daRicreare = voci.filter((v) => v.ereditato || !ripresa);
      const ricrea = `rileggi la to-do o la nota datata che ha dietro. Se la cosa è fatta o non serve più: \`${ctl} timer togli <id>\`. `
        + `Se è ancora da fare: lo ricrei con CronCreate (stessa espressione), poi \`${ctl} timer togli <id>\` e \`${ctl} timer aggiungi "descrizione" "<cron>" --id <id del job nuovo>\` `
        + `(per quelli usciti dal registro basta l'aggiungi). Un promemoria che doveva scattare a server spento lo fai adesso o lo rimetti.`;
      const parti = ["[cockpit] Il server del cockpit è ripartito: questi timer sono spenti sulla mappa finché non li riconfermi."];
      if (suoi.length) parti.push(`${suoi.map(riga).join("\n")}\n\nLa tua conversazione è ripresa con --resume e di solito i job di CronCreate tornano con lei: non ricrearli alla cieca. `
        + `Prima \`CronList\`, poi ricrea solo quelli che mancano. Se il job c'è ancora, lo riaccendi sulla mappa senza CronCreate: \`${ctl} timer aggiungi "descrizione" "<cron>" --id <lo stesso job>\` (con --una-volta se lo era). `
        + `Se due job fanno la stessa cosa, CronDelete del doppio. Se il job manca: ${ricrea}`);
      if (daRicreare.length) parti.push(`${daRicreare.map(riga).join("\n")}\n\n${suoi.length ? "Questi erano di un'altra conversazione e non sono nella tua CronList. " : ""}Per ciascuno ${ricrea}`);
      const testo = `${parti.join("\n")}\n\nSe dietro un timer non c'è né una to-do né una nota, scrivila adesso. Chiudi con una riga, non è un messaggio per ${this.chi}.`;
      const n = voci.length === 1 ? "un timer" : `${voci.length} timer`;
      try { this.invia(id, testo, { nota: `${n} ${daRicreare.length ? "da ricreare" : "da controllare"}`, origine: "timer", mittente: "cockpit" }); }
      catch (e) { console.error("avviso timer:", e.message); }
    }
    try { potaTimerOrfani(this.elenco().map((x) => x.nome)); } catch { /* il registro non deve fermare l'avvio */ }
    return perSessione.size;
  }

  invia(id, testo, meta = {}) {
    const s = this.trova(id);
    if (!s) throw new Error("sessione non trovata");
    testo = String(testo || "").trim();
    const cartellaAllegati = percorsoStato("allegati") + path.sep; // solo file dentro <stato>/allegati: niente percorsi altrui
    const allegati = (meta.allegati || []).filter((a) => typeof a === "string" && path.resolve(this.cfg.cartella, a).startsWith(cartellaAllegati));
    if (!testo && !allegati.length) throw new Error("messaggio vuoto");
    // Gli allegati arrivano come percorsi: Claude li apre con i suoi strumenti (Read legge PDF e immagini).
    const perClaude = allegati.length
      ? `${testo || "Leggi gli allegati e dimmi cosa contengono."}\n\nAllegati di ${this.chi}, da leggere prima di rispondere (PDF, immagini e testo con Read; .docx, .xlsx e .pptx con un breve script Python):\n${allegati.map((a) => `- ${a}`).join("\n")}`
      : testo;
    if (s.stato !== "lavora" && s.stato !== "avvio") { // un turno nuovo: riparte senza piano (l'anello è indeterminato finché non lo dichiara)
      delete s.progresso;
      this.turno.set(s.id, { inizio: Date.now(), origine: meta.origine || "" });
    }
    const evento = {
      type: "cockpit_utente", testo, ...(allegati.length ? { allegati } : {}), ...(meta.nota ? { nota: meta.nota } : {}),
      ...(meta.origine ? { origine: meta.origine } : {}), mittente: meta.mittente || (meta.nota ? "cockpit" : this.persona.slug || "tu"),
    };
    // l'osservatore può aggiungere una nota per il modello (le domande ancora aperte di chi riceve): non entra nella chat
    let aggiunta = "";
    try { aggiunta = this.osservatore.messaggio?.(s, evento) || ""; } catch (e) { console.error("messaggio:", e.message); }
    const perModello = typeof aggiunta === "string" && aggiunta ? `${perClaude}\n\n${aggiunta}` : perClaude;
    if (inProva()) { // il messaggio resta a registro, ma nessun processo claude parte
      this.emetti(s, evento, true);
      this.emetti(s, { type: "cockpit_errore", testo: "prova" }, true);
      this.setStato(s, "errore");
      return s;
    }
    const p = this.proc.get(s.id) || this.avvia(s);
    this.emetti(s, evento, true);
    this.inCoda.set(s.id, (this.inCoda.get(s.id) || 0) + 1);
    p.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: perModello } }) + "\n");
    this.setStato(s, "lavora");
    return s;
  }

  ferma(id) {
    const s = this.trova(id);
    if (!s) throw new Error("sessione non trovata");
    const p = this.proc.get(s.id);
    if (!p) return "nessun processo";
    // A sessione libera chiude solo il processo (il pulsante «Ricarica» della pagina), senza messaggio perché non c'era un turno.
    if (!occupata(this, s)) { togliProcesso(this, s); return "chiuso"; }
    // Interrompe il turno (o il messaggio già scritto al processo); la sessione resta riprendibile (--resume al messaggio successivo).
    p.kill("SIGTERM");
    this.emetti(s, { type: "cockpit_errore", testo: `turno interrotto da ${this.chi}` }, true);
    return "interrotto";
  }

  // Chiude il processo claude senza interrompere un turno: subito a sessione libera, se no a fine turno se `ancora()` (chiusura.mjs)
  chiudiProcesso(id, ancora) { const s = this.trova(id); if (!s) throw new Error("sessione non trovata"); return chiudiProcesso(this, s, ancora); }

  // La lavagna: l'assistente (o un agente) mostra un file HTML a schermo; la pagina lo apre in un riquadro.
  mostra(percorso, titolo, da) { this.onEvento("lavagna", { type: "cockpit_mostra", percorso, titolo: titolo || "", da: da || "" }); }

  chiudiTutto() { for (const p of this.proc.values()) p.kill("SIGTERM"); }
}

