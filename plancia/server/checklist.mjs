// La checklist di primo avvio: le cose che servono perché chi apre la plancia sia operatore, ognuna verificata dal codice.
// Il nucleo porta le voci generiche (chi sei per git, claude che lavora, le chiavi della voce, Telegram); i moduli accesi
// aggiungono le loro col campo `checklist(ctx)` (server/moduli.mjs). Una voce:
//   { id, titolo, ordine, facoltativa?, tipo: "codice" | "spunta" | "assistente", come: "una riga: cosa fare se non è verde",
//     controlla?: async () => ({ esito: "ok" | "no" | "attesa", dettaglio }) }   (solo tipo "codice")
// «spunta» la mette la persona (l'unica non verificabile: una lettura); «assistente» la verifica l'assistente con i suoi
// strumenti (un connettore dell'account claude, che il server non vede) e la registra con `ctl setup verificato`.
// Colore: verde = ok; giallo = facoltativa non ok, o in attesa; rosso = obbligatoria non ok. Operatore = tutte le
// obbligatorie verdi. Stato in <stato>/checklist.json: spunte, verifiche dell'assistente, ultimo controllo, completata.
import { spawn } from "node:child_process";
import { chiave } from "./config.mjs";
import { negozio, registro } from "./stato.mjs";
import { componi } from "./prompt.mjs";

const LIMITE_MS = 25000; // una voce che non risponde in 25 s è rossa (o gialla se facoltativa), non blocca le altre
const unaRiga = (t, max = 200) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// Un comando con limite di tempo: { codice, out, err }. Non lancia: un comando che non c'è torna codice -1.
export function esegui(comando, argomenti, { cwd, ms = 20000, env } = {}) {
  return new Promise((ok) => {
    let out = "", err = "", finito = false;
    const fine = (codice) => { if (!finito) { finito = true; clearTimeout(timer); ok({ codice, out, err }); } };
    let p;
    try { p = spawn(comando, argomenti, { cwd, env: env || process.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true }); } catch (e) { err = e.message; return fine(-1); }
    const timer = setTimeout(() => { err = `nessuna risposta in ${ms / 1000} s`; p.kill("SIGKILL"); fine(-2); }, ms);
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", (e) => { err = e.message; fine(-1); });
    p.on("close", (c) => fine(c ?? -1));
  });
}

// ───── le voci del nucleo ─────
function vociNucleo({ cfg, cockpit, telegram, eseguiCmd }) {
  return [
    {
      id: "persona", ordine: 10, tipo: "codice", titolo: "Git ti riconosce",
      come: 'git config user.email <la tua email> nella cartella di lavoro: deve essere quella della tua riga in persone[] di plancia.config.json',
      async controlla() {
        const r = await eseguiCmd("git", ["config", "user.email"], { cwd: cfg.cartella, ms: 5000 });
        const email = r.out.trim().toLowerCase();
        if (!email) return { esito: "no", dettaglio: "git config user.email è vuoto" };
        const p = cfg.persone.find((x) => x.email === email);
        if (!p) return { esito: "no", dettaglio: `${email} non è nella config (${cfg.persone.length} persone)` };
        return { esito: "ok", dettaglio: `${email}: sei ${p.nome || p.slug}` };
      },
    },
    {
      id: "claude", ordine: 20, tipo: "codice", titolo: "Claude collegato al tuo account",
      come: "claude installato e collegato al TUO account claude.ai (in un terminale: claude, poi /login); la prova vera è un turno dell'assistente finito senza errori",
      async controlla() {
        // la prova: un turno finito senza errore in una sessione della plancia; senza turni, almeno il comando c'è
        const sessioni = cockpit.elenco();
        let errore = "";
        for (const s of sessioni) {
          const fini = registro(s.id).leggi({ ultime: 300 }).filter((e) => e.type === "fine");
          if (fini.some((e) => !e.errore)) return { esito: "ok", dettaglio: `«${s.nome}» ha finito un turno senza errori` };
          if (fini.length && !errore) errore = unaRiga(fini.at(-1).testo || "turno chiuso con un errore", 160);
        }
        if (errore) return { esito: "no", dettaglio: `i turni finiscono in errore: ${errore}` };
        const v = await eseguiCmd("claude", ["--version"], { cwd: cfg.cartella, ms: 15000 });
        if (v.codice !== 0) return { esito: "no", dettaglio: "il comando claude non risponde: non è installato o non è nel PATH" };
        return { esito: "attesa", dettaglio: `claude ${unaRiga(v.out, 40)} c'è; aspetto il primo turno dell'assistente per dire che è collegato` };
      },
    },
    {
      id: "voce", ordine: 40, tipo: "codice", facoltativa: true, titolo: "Chiavi della voce (ElevenLabs, OpenAI)",
      come: "ELEVENLABS_API_KEY o OPENAI_API_KEY nel file delle chiavi; senza, la voce usa quella del browser",
      async controlla() {
        const ci = ["ELEVENLABS_API_KEY", "OPENAI_API_KEY"].filter((k) => chiave(k));
        return ci.length ? { esito: "ok", dettaglio: `presenti: ${ci.join(", ")}` } : { esito: "no", dettaglio: "nessuna: la voce ripiega su quella del browser" };
      },
    },
    {
      id: "telegram", ordine: 60, tipo: "codice", facoltativa: true, titolo: "Bot Telegram abbinato",
      come: "un bot tuo da BotFather, TELEGRAM_BOT_TOKEN nelle chiavi di questa macchina, poi «ctl telegram abbina» e /start <codice> dalla tua chat",
      async controlla() {
        const t = telegram?.stato?.();
        if (!t) return { esito: "no", dettaglio: "Telegram non c'è in questa plancia" };
        if (!t.acceso) return { esito: "no", dettaglio: `spento: ${unaRiga(t.motivo, 120)}` };
        if (!t.persona) return { esito: "no", dettaglio: `bot ${t.bot?.username ? `@${t.bot.username} ` : ""}acceso ma non abbinato alla tua chat` };
        return { esito: "ok", dettaglio: `abbinato${t.bot?.username ? ` (@${t.bot.username})` : ""}${t.disponibile ? "" : `, ma ora non risponde: ${unaRiga(t.motivo, 80)}`}` };
      },
    },
  ];
}

const colore = (v, esito) => (esito === "ok" ? "verde" : v.facoltativa || esito === "attesa" ? "giallo" : "rosso");

export function creaChecklist({ cfg, persona = {}, cockpit, moduli = [], ctxModulo = () => ({}), telegram = null, trasmetti = () => {}, eseguiCmd = esegui }) {
  const archivio = negozio("checklist", { base: { spunte: {}, assistente: {}, ultimo: null, completata: null, nascosta: false, nata: null, guida: null } });

  function voci() {
    const tutte = [...vociNucleo({ cfg, cockpit, telegram, eseguiCmd })];
    for (const m of moduli) {
      if (typeof m.checklist !== "function") continue;
      try { for (const v of m.checklist(ctxModulo(m)) || []) tutte.push({ ...v, modulo: m.nome }); }
      catch (e) { tutte.push({ id: `${m.nome}-errore`, ordine: 999, tipo: "codice", titolo: `Le voci del modulo ${m.nome}`, come: "", controlla: async () => ({ esito: "no", dettaglio: unaRiga(e.message) }) }); }
    }
    return tutte.sort((a, b) => (a.ordine ?? 500) - (b.ordine ?? 500));
  }

  async function esito(v, d) {
    if (v.tipo === "spunta") {
      const s = d.spunte[v.id];
      return s ? { esito: "ok", dettaglio: `spuntata il ${s.quando.slice(0, 10)}` } : { esito: "no", dettaglio: "da spuntare quando l'hai fatto" };
    }
    if (v.tipo === "assistente") {
      const a = d.assistente[v.id];
      if (!a) return { esito: "attesa", dettaglio: "non si vede dal codice del server: la verifica l'assistente con i suoi strumenti" };
      return { esito: a.esito === "ok" ? "ok" : "no", dettaglio: `${a.esito === "ok" ? "verificato" : "non funziona"} dall'assistente il ${a.quando.slice(0, 10)}${a.nota ? `: ${a.nota}` : ""}` };
    }
    let limite;
    const tempo = new Promise((ok) => { limite = setTimeout(() => ok({ esito: "no", dettaglio: `nessuna risposta in ${LIMITE_MS / 1000} s` }), LIMITE_MS); });
    try { return await Promise.race([v.controlla(), tempo]); }
    catch (e) { return { esito: "no", dettaglio: unaRiga(e.message) }; }
    finally { clearTimeout(limite); }
  }

  const pubblica = (v, r) => ({
    id: v.id, titolo: v.titolo, tipo: v.tipo, facoltativa: !!v.facoltativa, come: v.come || "", modulo: v.modulo || "",
    esito: r.esito, colore: colore(v, r.esito), dettaglio: unaRiga(r.dettaglio, 300),
  });

  function riassunto(d, lista) {
    const obbligatorie = lista.filter((v) => !v.facoltativa);
    return {
      voci: lista, quando: d.ultimo?.quando || null, completata: d.completata, nascosta: !!d.nascosta,
      operatore: !!lista.length && obbligatorie.every((v) => v.esito === "ok"),
      mancano: obbligatorie.filter((v) => v.esito !== "ok").length, persona: persona.nome || "",
    };
  }

  // Controlla tutte le voci (in parallelo) e salva il risultato. La prima volta che sono tutte verdi: completata.
  let inCorso = null;
  function controlla() {
    if (inCorso) return inCorso;
    inCorso = (async () => {
      const d = archivio.leggi(), lista = voci();
      const esiti = await Promise.all(lista.map((v) => esito(v, d)));
      const pubbliche = lista.map((v, i) => pubblica(v, esiti[i]));
      const r = riassunto({ ...d, ultimo: { quando: new Date().toISOString() } }, pubbliche);
      const salvato = await archivio.aggiorna((x) => {
        x.ultimo = { quando: r.quando || new Date().toISOString(), voci: pubbliche };
        if (r.operatore && !x.completata) x.completata = new Date().toISOString();
      });
      const out = riassunto(salvato, pubbliche);
      trasmetti({ type: "cockpit_checklist", checklist: out });
      return out;
    })().finally(() => { inCorso = null; });
    return inCorso;
  }

  // L'ultimo controllo senza rifarlo (null se non è mai stato fatto).
  function stato() {
    const d = archivio.leggi();
    return d.ultimo ? riassunto(d, d.ultimo.voci) : { ...riassunto(d, []), voci: null };
  }

  function voceDi(id, tipo) {
    const v = voci().find((x) => x.id === id);
    if (!v) throw new Error(`voce sconosciuta: ${id} (${voci().map((x) => x.id).join(", ")})`);
    if (v.tipo !== tipo) throw new Error(`«${id}» non è una voce da ${tipo === "spunta" ? "spuntare" : "far verificare all'assistente"}: la controlla il codice`);
    return v;
  }

  async function spunta({ id, fatto = true }) {
    voceDi(id, "spunta");
    await archivio.aggiorna((d) => { if (fatto) d.spunte[id] = { quando: new Date().toISOString() }; else delete d.spunte[id]; });
    return controlla();
  }

  async function verificato({ id, esito: e, nota = "" }) {
    if (!["ok", "no"].includes(e)) throw new Error("esito: ok oppure no");
    voceDi(id, "assistente");
    await archivio.aggiorna((d) => { d.assistente[id] = { esito: e, nota: unaRiga(nota, 160), quando: new Date().toISOString() }; });
    return controlla();
  }

  async function nascondi(si = true) {
    await archivio.aggiorna((d) => { d.nascosta = !!si; });
    const s = stato();
    trasmetti({ type: "cockpit_checklist", checklist: s });
    return s;
  }

  // Il turno [checklist] all'assistente: lo stato voce per voce e cosa fare (prompt/checklist.md + i frammenti dei moduli).
  function testoVoci(r) {
    return r.voci.map((v) => `- ${v.colore === "verde" ? "✓" : v.colore === "giallo" ? "~" : "✗"} ${v.id} · ${v.titolo}${v.facoltativa ? " (facoltativa)" : ""}`
      + ` — ${v.dettaglio}${v.esito !== "ok" && v.come ? `\n    come: ${v.come}` : ""}${v.tipo !== "codice" ? `\n    (voce da ${v.tipo === "spunta" ? "spuntare: la spunta la mette la persona" : "verificare tu, l'assistente"})` : ""}`).join("\n");
  }
  async function guida() {
    const r = await controlla();
    const o = cockpit.orchestratore();
    if (!o) throw new Error("l'assistente non c'è");
    const testo = componi("checklist", { ...cockpit.variabili(), checklist: testoVoci(r), mancano: String(r.mancano) }, moduli).trim();
    cockpit.invia(o.id, testo, { origine: "sistema", mittente: "sistema" });
    await archivio.aggiorna((d) => { d.guida = new Date().toISOString(); d.nascosta = false; });
    return r;
  }

  // All'avvio del server (non in prova): la prima volta si annota se la plancia è nuova. Una plancia che già lavorava
  // (l'assistente ha dei turni) parte con la checklist nascosta; una nuova la controlla e manda la guida all'assistente una volta.
  async function avvio() {
    const o = cockpit.orchestratore();
    const d = await archivio.aggiorna((x) => {
      if (!x.nata) { x.nata = new Date().toISOString(); x.nascosta = !!(o && o.turni > 0); }
    });
    if (d.completata || d.nascosta) return null;
    if (!d.guida) return guida();
    return controlla();
  }

  return { voci, controlla, stato, spunta, verificato, nascondi, guida, avvio };
}
