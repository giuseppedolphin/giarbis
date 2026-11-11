// Telegram (spec interna): la chat diretta fra la persona e il suo assistente, e il gruppo delle
// persone. Un bot per persona; il token è la chiave TELEGRAM_BOT_TOKEN (config.chiave: ambiente, file delle chiavi, <stato>/chiavi.env)
// e non si stampa mai. Senza token, o con `telegram.acceso` falso nella config, il modulo è spento: niente polling, niente errori.
//
// Ricezione con long polling di getUpdates (niente webhook: la plancia non si espone). Si accettano solo la chat privata della
// persona e il gruppo, abbinati con un codice (/start <codice> in privato, /abbina <codice> nel gruppo, solo dalla persona). I bot
// non vedono i messaggi di altri bot: gli assistenti si parlano sul ponte, e qui si rispecchia nel gruppo ciò che la propria parte
// scrive sul ponte (`specchioPonte`). Le domande della casella aperte da troppo vanno sulla chat della persona, coi pulsanti.
//
// Stato (stato.mjs): telegram.json = { codice, persona: { chat, utente, nome }, gruppo: { chat, titolo }, offset,
// mandate: { idDomanda: { messaggio, testo } }, registro: [...], ignorati }.
//
//   creaTelegram({ cfg, persona, cockpit, trasmetti, token?, api? }) → { stato, controlla, giroDomande, scrivi, messaggi, abbina,
//   scollega, osserva, avvia }
import { randomBytes } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { chiave } from "./config.mjs";
import { componi } from "./prompt.mjs";
import { negozio } from "./stato.mjs";
import * as Domande from "./domande.mjs";
import { trascrivi as trascriviAudio } from "./trascrizione.mjs";

const GIRO_MS = 20000;
const ATTESA_POLL_S = 25;
const SECONDI = 15; // il limite di una chiamata, oltre l'attesa del long polling
const TENTATIVI = 3; // solo per le chiamate che non sono arrivate
const REGISTRO_MAX = 200;
export const MAX_TESTO = 1000;
const MAX_ENTRATA = 4096; // il tetto di Telegram per un messaggio: quello che la persona scrive arriva intero
const MAX_ECO = 300; // la risposta sul messaggio della domanda: a chi ha chiesto è già arrivata intera, qui deve stare nei 4096 caratteri
const MAX_SPECCHIO = 3800; // sotto il tetto di 4096 caratteri di Telegram: lo specchio porta il messaggio intero
export const MAX_VOCALE_S = 300; // oltre, un vocale non si trascrive (telegram.vocaleMaxSecondi nella config)
const MAX_FILE = 20 * 1024 * 1024; // il tetto di getFile della Bot API

const hhmm = (s) => { const [h, m] = String(s).split(":").map(Number); return h * 60 + m; };
// l'ora (minuti dalla mezzanotte) e il giorno della settimana (0 = domenica) nel fuso della config
function adessoNelFuso(fuso, t = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: fuso, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { minuti: (Number(p.hour) % 24) * 60 + Number(p.minute), giorno: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday) };
}
const dentro = (min, f) => (f ? (hhmm(f.dalle) <= hhmm(f.alle) ? min >= hhmm(f.dalle) && min < hhmm(f.alle) : min >= hhmm(f.dalle) || min < hhmm(f.alle)) : false);
export function inOrario(regole, fuso, t = Date.now()) {
  const o = regole.orario;
  if (!o) return true;
  const { minuti, giorno } = adessoNelFuso(fuso, t);
  return (!o.giorni || o.giorni.includes(giorno)) && dentro(minuti, o);
}
export const inSilenzio = (regole, fuso, t = Date.now()) => dentro(adessoNelFuso(fuso, t).minuti, regole.silenzio);

export function creaTelegram({ cfg, persona = {}, cockpit, trasmetti = () => {}, token = null, api = null, secondi = SECONDI, trascrivi = trascriviAudio }) {
  const regole = cfg.telegram;
  const tok = token ?? chiave("TELEGRAM_BOT_TOKEN");
  const base = String(api || process.env.TELEGRAM_API || "https://api.telegram.org").replace(/\/+$/, "");
  const nomePersona = persona.nome || persona.slug || "la persona";
  const nomeDi = (slug) => (cfg.persone || []).find((p) => p.slug === slug)?.nome || slug;
  const spento = () => (!regole.acceso ? "spento nella config (telegram.acceso)" : !tok ? "nessun token (TELEGRAM_BOT_TOKEN)" : "");

  const archivio = negozio("telegram", { base: { codice: "", persona: null, gruppo: null, offset: 0, mandate: {}, registro: [], ignorati: 0 } });
  const leggi = () => {
    const d = archivio.leggi();
    return { ...d, mandate: d.mandate && typeof d.mandate === "object" ? d.mandate : {}, registro: Array.isArray(d.registro) ? d.registro : [], offset: Number(d.offset) || 0, ignorati: Number(d.ignorati) || 0 };
  };
  const annuncia = (azione, extra = {}) => { try { trasmetti({ type: "cockpit_telegram", azione, ...extra }); } catch { /* lo stream non ferma telegram */ } };
  const nascondi = (s) => String(s ?? "").split(tok || "\u0000").join("***");

  // le letture-modifiche-scritture dello stato una dopo l'altra: il polling, il giro delle domande e lo specchio si alternano
  let catena = Promise.resolve();
  const inSerie = (fn) => { const p = catena.then(fn, fn); catena = p.catch(() => {}); return p; };
  let bot = null; // { id, username } da getMe
  let motivo = ""; // l'ultimo guasto; "" = risponde

  // Niente fetch: l'API parla HTTP/2 e il fetch di Node mette ogni chiamata sulla stessa connessione, in coda dietro il long
  // polling di getUpdates (fino a 25 s), e sendMessage scadeva. node:https è HTTP/1.1 e senza keep-alive ogni chiamata
  // ha una connessione sua: nessuna coda e nessun socket vecchio. Si ritenta da sola solo una chiamata fallita prima di essere
  // collegata (DNS, TCP, TLS), che quindi non è arrivata; una scaduta dopo può essere arrivata: errore `incerto`, mai ripetuta.
  const rete = new URL(base).protocol === "http:" ? http : https;
  const agente = new rete.Agent({ keepAlive: false });
  function unaChiamata(metodo, corpo, limiteMs) {
    return new Promise((ok, no) => {
      const dati = Buffer.from(JSON.stringify(corpo));
      let collegata = false, finita = false;
      const fine = (fn, v) => { if (!finita) { finita = true; clearTimeout(t); fn(v); } };
      const errore = (testo, extra = {}) => fine(no, Object.assign(new Error(nascondi(testo)), extra));
      const req = rete.request(`${base}/bot${tok}/${metodo}`, { method: "POST", agent: agente, headers: { "content-type": "application/json", "content-length": dati.length } }, (r) => {
        let testo = "";
        r.setEncoding("utf8");
        r.on("data", (x) => { testo += x; });
        r.on("error", (e) => errore(`${metodo}: ${e.code || e.message}`, { incerto: true }));
        r.on("end", () => {
          let j = {};
          try { j = JSON.parse(testo); } catch { /* non JSON: vale lo stato HTTP */ }
          if (j.ok) return fine(ok, j.result);
          errore(j.description || `HTTP ${r.statusCode}`, { codice: j.error_code || r.statusCode });
        });
      });
      req.on("socket", (s) => {
        if (!s.connecting) collegata = true;
        else s.once(rete === https ? "secureConnect" : "connect", () => { collegata = true; });
      });
      const persa = (testo) => errore(`${metodo}: ${testo}`, collegata ? { incerto: true } : { nonArrivata: true });
      req.on("error", (e) => persa(e.code || e.message));
      const t = setTimeout(() => { persa("nessuna risposta"); req.destroy(); }, limiteMs);
      req.end(dati);
    });
  }
  async function chiama(metodo, corpo = {}, { attesaS = 0 } = {}) {
    for (let n = 1; ; n++) {
      try { return await unaChiamata(metodo, corpo, (attesaS + secondi) * 1000); }
      catch (e) {
        // getUpdates no: il ciclo del polling ha già la sua attesa crescente
        if (!e.nonArrivata || metodo === "getUpdates" || n >= TENTATIVI) throw e;
        await new Promise((r) => setTimeout(r, 1000 * n));
      }
    }
  }
  function guasto(e) {
    const m = /409|conflict/i.test(e.message) ? "un'altra plancia usa lo stesso bot (409)" : `Telegram non risponde: ${e.message}`;
    if (m !== motivo) { console.error(`telegram: ${m}`); motivo = m; annuncia("stato", { stato: stato() }); }
  }
  function ripreso() { if (motivo) { motivo = ""; annuncia("stato", { stato: stato() }); } }
  // un file di Telegram (getFile, poi /file/bot<token>/<percorso>), come Buffer
  async function scaricaFile(idFile) {
    const f = await chiama("getFile", { file_id: idFile });
    if (!f.file_path) throw new Error("getFile senza percorso");
    return new Promise((ok, no) => {
      const req = rete.get(`${base}/file/bot${tok}/${f.file_path}`, { agent: agente }, (r) => {
        if (r.statusCode !== 200) { r.resume(); return no(new Error(`scaricamento: HTTP ${r.statusCode}`)); }
        const pezzi = []; let n = 0;
        r.on("data", (x) => { n += x.length; if (n > MAX_FILE) { req.destroy(); no(new Error("file oltre 20 MB")); } else pezzi.push(x); });
        r.on("end", () => ok(Buffer.concat(pezzi)));
        r.on("error", (e) => no(new Error(nascondi(`scaricamento: ${e.message}`))));
      });
      req.on("error", (e) => no(new Error(nascondi(`scaricamento: ${e.code || e.message}`))));
      req.setTimeout(secondi * 2000, () => req.destroy(new Error("nessuna risposta")));
    });
  }
  // un vocale o un file audio → { testo } con la trascrizione, o { errore } col motivo (mai un'eccezione: il chiamante avvisa)
  async function ascolta(a) {
    const max = Number(regole.vocaleMaxSecondi) || MAX_VOCALE_S;
    if (a.duration > max) return { errore: `dura ${a.duration} s, oltre il limite di ${max} s` };
    if (a.file_size > MAX_FILE) return { errore: "file oltre 20 MB" };
    try {
      const audio = await scaricaFile(a.file_id);
      const r = await trascrivi({ audio, nome: a.file_name || "vocale.ogg", tipo: a.mime_type || "audio/ogg" });
      return { testo: pulisci(r.testo, Infinity) }; // la trascrizione intera: la lunghezza la limita già vocaleMaxSecondi
    } catch (e) { console.error("telegram, vocale:", e.message); return { errore: nascondi(e.message).slice(0, 300) }; }
  }
  // il nome dell'assistente in una trascrizione (un vocale nel gruppo non può menzionare il bot con @)
  const nomiAssistente = [cfg.assistente?.nome, ...(cfg.assistente?.varianti?.nomi || []), ...(cfg.assistente?.alias || [])].filter(Boolean).map((x) => String(x).toLowerCase());
  const chiamaAssistente = (t) => { const p = t.toLowerCase().split(/[^\p{L}\p{N}]+/u); return nomiAssistente.some((n) => p.includes(n)); };

  async function chiSonoIo() {
    if (!bot) { const r = await chiama("getMe"); bot = { id: r.id, username: r.username || "" }; }
    return bot;
  }

  function stato() {
    const d = leggi();
    const s = spento();
    return {
      acceso: !s, motivo: s || motivo, disponibile: !s && !motivo, bot: bot ? { username: bot.username } : null,
      persona: d.persona ? { nome: d.persona.nome } : null, gruppo: d.gruppo ? { titolo: d.gruppo.titolo } : null,
      codice: !s && (!d.persona || !d.gruppo) ? d.codice || null : null,
      inOrario: inOrario(regole, cfg.fuso), mandate: Object.keys(d.mandate).length, ignorati: d.ignorati,
      regole: { urgentiDopoMinuti: regole.urgentiDopoMinuti, fuoriOrarioDopoMinuti: regole.fuoriOrarioDopoMinuti, specchioPonte: regole.specchioPonte, gruppoPersone: regole.gruppoPersone },
    };
  }

  // ───── abbinamento ─────
  const abbina = (o) => inSerie(() => abbinaOra(o));
  function abbinaOra({ nuovo = false } = {}) {
    if (spento()) return { acceso: false, motivo: spento() };
    const d = leggi();
    if (!d.codice || nuovo) { d.codice = randomBytes(6).toString("base64url").replace(/[-_]/g, "x").slice(0, 8); archivio.scrivi(d); }
    return { acceso: true, codice: d.codice, persona: !!d.persona, gruppo: !!d.gruppo, bot: bot?.username || "" };
  }
  function scollega(cosa) {
    if (!["persona", "gruppo"].includes(cosa)) throw new Error("scollega: persona o gruppo");
    return inSerie(() => scollegaOra(cosa));
  }
  function scollegaOra(cosa) {
    const d = leggi();
    d[cosa] = null;
    if (cosa === "persona") { d.gruppo = null; d.mandate = {}; }
    archivio.scrivi(d);
    annuncia("stato", { stato: stato() });
    return stato();
  }

  // ───── registro e turni ─────
  const pulisci = (t, max) => String(t ?? "").replace(/\r/g, "").trim().slice(0, max);
  function registra(d, voce) { d.registro.push({ t: Date.now(), ...voce }); d.registro = d.registro.slice(-REGISTRO_MAX); }
  function turno(righe, dove) {
    const o = cockpit.orchestratore();
    if (!o) return;
    const testo = componi(dove === "gruppo" ? "telegram-gruppo" : "telegram", cockpit.variabili({ messaggi: righe.join("\n\n") }), cockpit.moduli || []).trim();
    try { cockpit.invia(o.id, testo, { nota: `${dove} su Telegram`, mittente: persona.slug || "tu", origine: "telegram" }); }
    catch (e) { console.error("telegram, turno non consegnato:", e.message); }
  }

  async function manda(chat, testo, extra = {}) {
    return chiama("sendMessage", { chat_id: chat, text: testo, disable_notification: inSilenzio(regole, cfg.fuso), ...extra });
  }

  // ───── un aggiornamento di Telegram ─────
  async function gestisci(u, d, turni) {
    const io = await chiSonoIo();
    if (u.callback_query) {
      const q = u.callback_query;
      if (!d.persona || q.from?.id !== d.persona.utente) { d.ignorati++; return; }
      const [, id, i] = String(q.data || "").split("|");
      let avviso = "Fatto";
      try {
        const dom = Domande.elenco({ tutte: true });
        const x = [...dom.aperte, ...dom.rimandate].find((y) => y.id === id);
        if (!x) throw new Error("questa domanda ha già una risposta");
        Domande.rispondi(id, x.opzioni[Number(i)], "opzione");
      } catch (e) { avviso = e.message.slice(0, 180); }
      await chiama("answerCallbackQuery", { callback_query_id: q.id, text: avviso }).catch(() => {});
      return;
    }
    const m = u.message || u.edited_message;
    if (!m || m.from?.is_bot) return;
    const chat = m.chat?.id, privata = m.chat?.type === "private";
    let testo = pulisci(m.text ?? m.caption ?? "", MAX_ENTRATA);
    const audio = m.voice || m.audio;
    const comando = /^\/(\w+)(?:@(\w+))?(?:\s+(.*))?$/s.exec(testo);
    const perMe = comando && (!comando[2] || comando[2].toLowerCase() === io.username.toLowerCase());

    // abbinamento della persona: /start <codice> in privato, solo se non c'è già una persona
    if (privata && perMe && comando[1] === "start") {
      if (!d.persona && d.codice && pulisci(comando[3], 40) === d.codice) {
        d.persona = { chat, utente: m.from.id, nome: m.from.first_name || nomePersona };
        await manda(chat, `Abbinato: sono l'assistente di ${nomePersona}. Ti scrivo qui quando non sei al PC; rispondimi qui.`).catch(() => {});
        annuncia("abbinato", { cosa: "persona" });
      } else d.ignorati++;
      return;
    }
    // abbinamento del gruppo: /abbina <codice> nel gruppo, solo dalla persona già abbinata
    if (!privata && perMe && comando[1] === "abbina") {
      if (d.persona && m.from?.id === d.persona.utente && d.codice && pulisci(comando[3], 40) === d.codice) {
        d.gruppo = { chat, titolo: m.chat.title || "gruppo" };
        await manda(chat, `Ci sono: sono l'assistente di ${nomePersona}. Mi sveglio se mi menzionate o rispondete a un mio messaggio.`).catch(() => {});
        annuncia("abbinato", { cosa: "gruppo" });
      } else d.ignorati++;
      return;
    }

    const daPersona = d.persona && m.from?.id === d.persona.utente;
    if (privata && d.persona && chat === d.persona.chat) {
      if (audio) {
        const v = await ascolta(audio);
        if (v.errore) {
          registra(d, { dove: "privata", da: nomePersona, testo: `[vocale non trascritto] ${v.errore}` });
          turni.push({ dove: "privata", riga: `[telegram] ${nomePersona} ha mandato un vocale di ${audio.duration ?? "?"} s che non sono riuscito a trascrivere (${v.errore}). Diglielo e chiedi di scriverlo.` });
          return;
        }
        testo = `[vocale] ${v.testo}${testo ? `\n${testo}` : ""}`;
      }
      if (!testo) { await manda(chat, "Per ora leggo solo testo e vocali.").catch(() => {}); return; }
      registra(d, { dove: "privata", da: nomePersona, testo });
      // una risposta a una domanda mandata qui chiude la domanda; il resto è un turno per l'assistente
      const rif = m.reply_to_message?.message_id;
      const id = rif && Object.keys(d.mandate).find((k) => d.mandate[k].messaggio === rif);
      if (id) {
        try { Domande.rispondi(id, testo.replace(/^\[vocale\] /, ""), "libera"); }
        catch (e) { await manda(chat, e.message.slice(0, 200), { reply_to_message_id: m.message_id }).catch(() => {}); }
        return;
      }
      turni.push({ dove: "privata", riga: `[telegram] ${nomePersona} scrive: ${testo}` });
      return;
    }
    if (!privata && d.gruppo && chat === d.gruppo.chat) {
      const chi = daPersona ? nomePersona : m.from?.first_name || "qualcuno";
      // nel gruppo un vocale si trascrive solo se risponde al bot o viene dalla persona (ogni trascrizione costa)
      if (audio) {
        const perBot = m.reply_to_message?.from?.id === io.id;
        if (!perBot && !daPersona) { registra(d, { dove: "gruppo", da: chi, testo: "[vocale non trascritto]" }); return; }
        const v = await ascolta(audio);
        if (v.errore) {
          registra(d, { dove: "gruppo", da: chi, testo: `[vocale non trascritto] ${v.errore}` });
          if (perBot) turni.push({ dove: "gruppo", riga: `[telegram] Nel gruppo «${d.gruppo.titolo}», ${chi} ha mandato un vocale per te che non sono riuscito a trascrivere (${v.errore}). Diglielo e chiedi di scriverlo.` });
          return;
        }
        testo = `[vocale] ${v.testo}${testo ? `\n${testo}` : ""}`;
        registra(d, { dove: "gruppo", da: chi, testo });
        if (perBot || chiamaAssistente(testo) || (io.username && testo.toLowerCase().includes(`@${io.username.toLowerCase()}`))) turni.push({ dove: "gruppo", riga: `[telegram] Nel gruppo «${d.gruppo.titolo}», ${chi} scrive: ${testo}` });
        return;
      }
      if (!testo) return;
      registra(d, { dove: "gruppo", da: chi, testo });
      const menzione = io.username && testo.toLowerCase().includes(`@${io.username.toLowerCase()}`);
      const rispostaAMe = m.reply_to_message?.from?.id === io.id;
      if (menzione || rispostaAMe || perMe) turni.push({ dove: "gruppo", riga: `[telegram] Nel gruppo «${d.gruppo.titolo}», ${chi} scrive: ${testo}` });
      return;
    }
    d.ignorati++; // una chat che non è né la persona né il gruppo
  }

  // un giro: gli aggiornamenti (attesaS > 0 = long polling), poi le domande
  let controllando = false;
  async function controlla({ attesaS = 0 } = {}) {
    if (spento()) return { esito: "spento", motivo: spento() };
    if (controllando) return { esito: "in corso" };
    controllando = true;
    try {
      let aggiornamenti;
      try {
        await chiSonoIo();
        aggiornamenti = await chiama("getUpdates", { offset: leggi().offset, timeout: attesaS, allowed_updates: ["message", "edited_message", "callback_query"] }, { attesaS });
      } catch (e) { guasto(e); return { esito: "non disponibile", motivo }; }
      ripreso();
      const turni = [];
      await inSerie(async () => {
        const d = leggi();
        for (const u of aggiornamenti) {
          d.offset = Math.max(d.offset, u.update_id + 1);
          try { await gestisci(u, d, turni); } catch (e) { console.error("telegram, aggiornamento:", e.message); }
        }
        archivio.scrivi(d);
      });
      for (const dove of ["privata", "gruppo"]) {
        const righe = turni.filter((x) => x.dove === dove).map((x) => x.riga);
        if (righe.length) turno(righe, dove === "privata" ? "un messaggio" : "una menzione nel gruppo");
      }
      if (aggiornamenti.length) annuncia("arrivati", { n: aggiornamenti.length, stato: stato() });
      const g = await giroDomande();
      return { esito: aggiornamenti.length ? "nuovi" : "niente", aggiornamenti: aggiornamenti.length, turni: turni.length, domande: g };
    } finally { controllando = false; }
  }

  // ───── le domande della casella su Telegram ─────
  const pulsanti = (q) => (q.opzioni.length ? { reply_markup: { inline_keyboard: [q.opzioni.map((o, i) => ({ text: o, callback_data: `d|${q.id}|${i}` }))] } } : {});
  function daMandare(q, adesso) {
    if (q.tipo === "testo" || q.stato !== "aperta") return false;
    const eta = (adesso - Date.parse(q.creata)) / 60000;
    if (!inOrario(regole, cfg.fuso, adesso)) return eta >= regole.fuoriOrarioDopoMinuti;
    return q.urgente && eta >= regole.urgentiDopoMinuti;
  }
  const giroDomande = (adesso = Date.now()) => inSerie(() => giro(adesso));
  async function giro(adesso) {
    const d = leggi();
    if (spento() || !d.persona) return { mandate: 0, chiuse: 0 };
    const { aperte, rimandate } = Domande.elenco();
    const vive = new Set([...aperte, ...rimandate].map((q) => q.id));
    let mandate = 0, chiuse = 0;
    for (const q of aperte) {
      if (d.mandate[q.id] || !daMandare(q, adesso)) continue;
      const chi = q.da?.nome && q.da.nome !== cfg.assistente.slug ? ` (chiede ${q.da.nome})` : "";
      const testo = `${q.urgente ? "❗ " : "❓ "}${q.testo}${chi}${q.opzioni.length ? "" : "\nRispondi a questo messaggio."}`;
      try { const r = await manda(d.persona.chat, testo, pulsanti(q)); d.mandate[q.id] = { messaggio: r.message_id, testo }; mandate++; }
      catch (e) { guasto(e); break; }
    }
    // le domande chiuse (da qui o dalla plancia): il messaggio dice com'è finita e perde i pulsanti
    for (const [id, x] of Object.entries(d.mandate)) {
      if (vive.has(id)) continue;
      const q = Domande.elenco({ tutte: true }).chiuse.find((y) => y.id === id);
      const eco = q?.risposta?.length > MAX_ECO ? `${q.risposta.slice(0, MAX_ECO - 1)}…` : q?.risposta;
      const fine = q ? (q.stato === "risposta" ? `✓ risposta: ${eco}` : `— ${q.stato}`) : "— chiusa";
      await chiama("editMessageText", { chat_id: d.persona.chat, message_id: x.messaggio, text: `${x.testo}\n${fine}` }).catch(() => {});
      delete d.mandate[id];
      chiuse++;
    }
    if (mandate || chiuse) { archivio.scrivi(d); annuncia("domande", { mandate, chiuse }); }
    return { mandate, chiuse };
  }

  // ───── scrivere ─────
  async function scrivi({ testo, gruppo = false, sessione } = {}) {
    if (sessione) {
      const s = cockpit.trova(sessione);
      if (!s) throw new Error(`sessione sconosciuta: ${sessione}`);
      if (s.ruolo !== "orchestratore") throw new Error(`Telegram è dell'assistente: scrivi a ${cfg.assistente.nome}, che lo gira`);
    }
    const t = pulisci(testo, Infinity);
    if (!t) throw new Error("messaggio vuoto");
    if (t.length > MAX_TESTO) throw new Error(`messaggio troppo lungo (${t.length} caratteri, massimo ${MAX_TESTO}): su Telegram vanno messaggi brevi`);
    if (spento()) return { inviato: false, motivo: spento() };
    const d = leggi(), dest = gruppo ? d.gruppo : d.persona;
    if (!dest) return { inviato: false, motivo: gruppo ? "gruppo non abbinato (ctl telegram abbina)" : "persona non abbinata (ctl telegram abbina)" };
    try { await manda(dest.chat, t); }
    catch (e) {
      guasto(e);
      if (e.incerto) return { inviato: false, incerto: true, motivo: `${e.message}: forse è arrivato, guarda la chat prima di ripetere` };
      return { inviato: false, motivo: motivo || e.message };
    }
    ripreso();
    await inSerie(() => { const d2 = leggi(); registra(d2, { dove: gruppo ? "gruppo" : "privata", da: cfg.assistente.nome, testo: t, mio: true }); archivio.scrivi(d2); });
    annuncia("scritto", { dove: gruppo ? "gruppo" : "privata" });
    return { inviato: true, dove: gruppo ? "gruppo" : "privata" };
  }

  function messaggi({ n = 30 } = {}) {
    const d = leggi();
    return { ...stato(), messaggi: d.registro.slice(-Math.max(1, Math.min(REGISTRO_MAX, Number(n) || 30))) };
  }

  // lo specchio del ponte: ciò che questa parte scrive sul ponte compare nel gruppo, accorciato (l'altra parte fa lo stesso).
  // Con `gruppoPersone` solo i messaggi fra due persone che stanno nel gruppo: un filo con chi nel gruppo non c'è resta fuori,
  // perché lì lo leggerebbe chi non è nel filo e non chi lo riceve
  const nelGruppo = (m) => !regole.gruppoPersone || (regole.gruppoPersone.includes(m.mittente) && regole.gruppoPersone.includes(m.destinatario));
  async function osserva(ev) {
    if (ev?.type !== "cockpit_ponte" || ev.azione !== "scritto" || !ev.messaggio || !regole.specchioPonte || spento()) return;
    const d = leggi();
    if (!d.gruppo || !nelGruppo(ev.messaggio)) return;
    const m = ev.messaggio;
    const chi = m.via === "persona" ? nomeDi(m.mittente) : `${cfg.assistente.nome} di ${nomeDi(m.mittente)}`;
    const corto = m.testo.length > MAX_SPECCHIO ? `${m.testo.slice(0, MAX_SPECCHIO - 1)}…` : m.testo;
    const testo = `↔ Ponte n. ${m.id}, ${chi} → ${nomeDi(m.destinatario)}${m.urgente ? " (urgente)" : ""}: ${corto}`;
    try { await manda(d.gruppo.chat, testo); await inSerie(() => { const d2 = leggi(); registra(d2, { dove: "gruppo", da: cfg.assistente.nome, testo, mio: true }); archivio.scrivi(d2); }); }
    catch (e) { guasto(e); }
  }

  function avvia() {
    if (process.env.COCKPIT_PROVA === "1" || spento()) return null;
    let attesa = 0;
    const ciclo = async () => {
      const r = await controlla({ attesaS: ATTESA_POLL_S }).catch((e) => ({ esito: "errore", motivo: e.message }));
      attesa = r.esito === "non disponibile" || r.esito === "errore" ? Math.min(300000, (attesa || 5000) * 2) : 0;
      setTimeout(ciclo, attesa || 200).unref();
    };
    setTimeout(ciclo, 3000).unref();
    // le domande anche quando il polling aspetta: un giro ogni 20 s
    return setInterval(() => { giroDomande().catch((e) => console.error("telegram, domande:", e.message)); }, GIRO_MS).unref();
  }

  return { stato, controlla, giroDomande, scrivi, messaggi, abbina, scollega, osserva, avvia };
}
