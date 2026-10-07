// Le sessioni Claude Code del cockpit: un processo `claude -p` per sessione, con input e output
// in stream-json, pilotato dal server della plancia (plancia/server/server.mjs).
// Avvio con --chrome (se cfg.chrome non è false): ogni sessione ha gli strumenti di Claude in Chrome (mcp__claude-in-chrome__*).
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
import { sospendi as sospendiTimer } from "./timer.mjs";
import { aggiorna as aggiornaSotto, interrompi as interrompiSotto } from "./sottoagenti.mjs";
import { registraLimiti } from "./consumo.mjs";
import { aggiornaContesto } from "./contesto.mjs";

const STATI = ["ferma", "avvio", "lavora", "attende", "errore"];
const GIORNI = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
const inProva = () => process.env.COCKPIT_PROVA === "1";
const senzaPrivate = ({ vivo, ...s }) => s;

// La riga di comando di `claude -p` per una sessione (pura: la controlla il test senza lanciare processi).
export function argomentiClaude({ modello, prompt, nome, claudeId = null, chrome = true }) {
  const args = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
    "--include-partial-messages", ...(chrome ? ["--chrome"] : []), "--model", modello, "--permission-mode", "auto", "--permission-prompts", "none",
    "--append-system-prompt", prompt, "-n", `cockpit · ${nome}`];
  if (claudeId) args.push("--resume", claudeId);
  return args;
}

export class Cockpit {
  // cfg e persona vengono da config.mjs; contestoFoglio(idFoglio) → il testo del foglio per il suo agente; moduli = quelli accesi
  constructor({ cfg = config(), persona = chiSono(), onEvento = () => {}, contestoFoglio = () => "", moduli = [] } = {}) {
    this.cfg = cfg;
    this.persona = persona;
    this.chi = persona.nome || "chi usa il cockpit";
    this.onEvento = onEvento; // (id, evento) → broadcast ai browser
    this.contestoFoglio = contestoFoglio;
    this.moduli = moduli;
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
    return [...this.sessioni.values()].map(senzaPrivate)
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

  crea({ nome, ruolo = "agente", modello = "", compito = "", genitore = "", foglio = "" }) {
    nome = String(nome || "").toLowerCase().trim().replace(/[^a-z0-9àèéìòù-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
    if (!nome) throw new Error("serve un nome");
    if (this.trova(nome)) throw new Error(`esiste già un agente "${nome}"`);
    modello = risolviModello(modello || (ruolo === "foglio" ? modelloFoglio() : "")); // alias → id; vuoto = il predefinito
    // genitore: il nome di chi l'ha lanciato (l'assistente o un altro agente via ctl.mjs); vuoto = dalla pagina
    const padre = genitore && this.trova(genitore) ? this.trova(genitore).nome : "";
    const ora = new Date().toISOString();
    const s = {
      id: randomUUID().slice(0, 8), nome, ruolo, modello, genitore: padre, claudeId: null, stato: "ferma", creata: ora,
      aggiornata: ora, ultimo: "", costo: 0, turni: 0, nonLetti: 0, vivo: false, ...(foglio ? { foglio: String(foglio) } : {}),
    };
    this.sessioni.set(s.id, s);
    this.salva();
    this.emetti(s, { type: "cockpit_sessione" });
    if (compito) this.invia(s.id, compito, { mittente: padre || this.persona.slug || "tu" });
    return s;
  }

  rimuovi(id) {
    const s = this.trova(id);
    if (!s) throw new Error("sessione non trovata");
    if (s.ruolo === "orchestratore") throw new Error(`${s.nome} non si rimuove`);
    this.proc.get(s.id)?.kill("SIGTERM");
    this.sessioni.delete(s.id);
    this.salva();
    this.onEvento(s.id, { type: "cockpit_rimossa" });
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
    this.onEvento(s.id, ev.type === "cockpit_sessione" ? { ...ev, sessione: pubblica } : { t: Date.now(), ...ev });
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
      ctl: comandoCtl(),
      modello_default: nomeModello(modelloDefault()),
      mappa: rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : mappa,
      battito_orari: battito.orari.join(", "),
      battito_giorni: `nei giorni: ${battito.giorni.map((g) => GIORNI[g]).filter(Boolean).join(", ")}`,
      ...extra,
    };
  }

  prompt(s) {
    if (s.ruolo === "orchestratore") return componi(s.nome === "setup" && this.modalita === "setup" ? "setup" : "assistente", this.variabili(), this.moduli);
    if (s.ruolo === "foglio") {
      const contesto = this.contestoFoglio(s.foglio) || "(il foglio non c'è più: dillo e chiedi cosa fare)";
      return componi("foglio", this.variabili({ nome: s.nome, contesto }), this.moduli);
    }
    return componi("agente", this.variabili({ nome: s.nome }), this.moduli);
  }

  // Il messaggio [battito] (prompt/battito.md): lo chiama battito.mjs con ora, data, segnali nuovi, già visti, risposte.
  componiBattito(variabili) { return componi("battito", this.variabili(variabili), this.moduli).trim(); }

  // Gli argomenti di `claude -p` per una sessione: il modello è quello della sessione, e con --resume la conversazione continua.
  argomenti(s) {
    return argomentiClaude({ modello: s.modello, prompt: this.prompt(s), nome: s.nome, claudeId: s.claudeId, chrome: this.cfg.chrome !== false });
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
    const p = spawn("claude", args, { cwd: this.cfg.cartella, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, COCKPIT_SESSIONE: s.nome } });
    this.proc.set(s.id, p);
    s.vivo = true;
    // Un processo nuovo non ha più i job di CronCreate del precedente: i timer registrati restano sulla mappa ma spenti, finché la sessione non li riconferma.
    try { if (sospendiTimer(s.nome)) this.onEvento(s.id, { type: "cockpit_timer", azione: "sospesi" }); } catch { /* il registro non deve fermare l'avvio */ }
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
    p.on("exit", (codice) => {
      if (this.proc.get(s.id) !== p) return; // processo sostituito (cambio di modello): lo stato lo governa quello nuovo, o resta com'è
      this.proc.delete(s.id);
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
      s.turni += 1;
      s.costo = Math.round(((s.costo || 0) + (ev.total_cost_usd || 0)) * 10000) / 10000;
      if (ev.result) s.ultimo = String(ev.result).slice(0, 240);
      s.nonLetti = (s.nonLetti || 0) + 1;
      this.emetti(s, { type: "fine", esito: ev.subtype, errore: !!ev.is_error, durata_ms: ev.duration_ms, costo: ev.total_cost_usd, testo: ev.is_error ? String(ev.result || "") : "" }, true);
      this.setStato(s, "attende");
      if (s.modelloPendente) this.applicaModello(s, s.modelloPendente); // il turno è chiuso: ora si può cambiare
      if (s.ruolo === "agente") this.avvisaOrchestratore(s, ev);
      return;
    }
    if (ev.type === "rate_limit_event") { try { registraLimiti(ev.rate_limit_info); } catch { /* il consumo non deve fermare la sessione */ } }
    if (ev.type === "rate_limit_event" && ev.rate_limit_info?.status && ev.rate_limit_info.status !== "allowed") {
      this.emetti(s, { type: "cockpit_errore", testo: `limite dell'abbonamento: ${ev.rate_limit_info.status} (${ev.rate_limit_info.rateLimitType || ""})` }, true);
    }
  }

  avvisaOrchestratore(s, ev) {
    const o = this.orchestratore();
    if (!o) return;
    const esito = ev.is_error ? "ha chiuso un turno con un errore" : "ha finito un turno";
    // origine «agente»: il turno dell'assistente che ne nasce si legge ad alta voce (una coda sola, voce-motore.js)
    const testo = `[cockpit] L'agente "${s.nome}" ${esito}. La sua ultima risposta:\n${String(ev.result || "").slice(0, 2000)}`;
    try { this.invia(o.id, testo, { nota: `${s.nome} ${esito}`, origine: "agente" }); } catch { /* l'orchestratore non è raggiungibile: la mappa lo mostra comunque */ }
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
    if (s.stato !== "lavora" && s.stato !== "avvio") delete s.progresso; // un turno nuovo riparte senza piano: l'anello è indeterminato finché non lo dichiara
    const evento = {
      type: "cockpit_utente", testo, ...(allegati.length ? { allegati } : {}), ...(meta.nota ? { nota: meta.nota } : {}),
      ...(meta.origine ? { origine: meta.origine } : {}), mittente: meta.mittente || (meta.nota ? "cockpit" : this.persona.slug || "tu"),
    };
    if (inProva()) { // il messaggio resta a registro, ma nessun processo claude parte
      this.emetti(s, evento, true);
      this.emetti(s, { type: "cockpit_errore", testo: "prova" }, true);
      this.setStato(s, "errore");
      return s;
    }
    const p = this.proc.get(s.id) || this.avvia(s);
    this.emetti(s, evento, true);
    p.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: perClaude } }) + "\n");
    this.setStato(s, "lavora");
    return s;
  }

  ferma(id) {
    const s = this.trova(id);
    if (!s) throw new Error("sessione non trovata");
    const p = this.proc.get(s.id);
    if (!p) return s;
    // Interrompe il turno; la sessione resta riprendibile (--resume al messaggio successivo).
    p.kill("SIGTERM");
    this.emetti(s, { type: "cockpit_errore", testo: `turno interrotto da ${this.chi}` }, true);
    return s;
  }

  // La lavagna: l'assistente (o un agente) mostra un file HTML a schermo; la pagina lo apre in un riquadro.
  mostra(percorso, titolo, da) { this.onEvento("lavagna", { type: "cockpit_mostra", percorso, titolo: titolo || "", da: da || "" }); }

  chiudiTutto() { for (const p of this.proc.values()) p.kill("SIGTERM"); }
}

