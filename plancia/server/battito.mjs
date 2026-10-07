// Il battito dell'assistente: l'assistente in modalità push. Uno scheduler del server, non CronCreate, quindi sopravvive ai riavvii.
// A orari fissi (fuso, giorni e ora minima da plancia.config.json) il server raccoglie i segnali con codice, senza modelli.
// Nel nucleo restano solo quelli generici: agenti che aspettano da più di mezz'ora e consumo del piano. Gli altri (per noi
// to-do e incidenti) li portano i moduli accesi con `segnaliBattito`, passati qui in `ctx.segnali`.
// Solo se c'è almeno un segnale NUOVO (mai visto da un battito precedente) manda all'assistente un messaggio [battito]
// (testo in plancia/prompt/battito.md); altrimenti silenzio, a costo zero. L'assistente risponde con al massimo una proposta
// (ctl.mjs propone), che la pagina mostra nel foglio delle proposte con Sì / No / Più tardi; la risposta torna
// all'assistente e finisce nei contatori.
//
// Stato (stato.mjs): battito.json (interruttore, orari, ultimo scatto, segnali già visti, registro) e proposte.json
// (le proposte con il loro esito: fatte = tutte, accettate, rifiutate, ignorate). Il primo argomento `root` delle funzioni
// d'insieme resta per compatibilità con i chiamanti di prima ed è ignorato: la cartella di stato la dice stato.mjs.
//
//   ctx = { cockpit, persona, trasmetti, assicuraFoglio, segnali: [info => [segnale]] }   (info = { adesso, giorno, domani, persona, cockpit })
//   avviaBattito(ctx)                              → il timer del server (ogni 20 s); con COCKPIT_PROVA=1 non parte
//   statoBattito() · impostaBattito(root, {acceso, orari, giorni})   → interruttore e orari
//   battitoOra(ctx, {forza})  → un battito adesso (ctl.mjs battito ora); forza = anche fuori orario
//   segnali(ctx, adesso)      → i segnali di adesso, senza modello (node plancia/server/battito.mjs li stampa)
//   nuovaProposta(ctx, {testo, perche, urgente}) · rispondi(ctx, id, "si"|"no"|"dopo") · statoProposte() · testoProposte()
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "./config.mjs";
import { negozio } from "./stato.mjs";
import { statoConsumo } from "./consumo-pagina.mjs";

const RITARDO_MAX = 15 * 60000; // un battito mancato di poco (server riavviato, assistente al lavoro) parte entro un quarto d'ora, poi si salta
const ATTESA_AGENTE = 30 * 60000; // un agente che aspetta da più di mezz'ora conta come segnale
const IGNORATA_DOPO = 24 * 3600000; // una proposta senza risposta per un giorno è ignorata
const VISTI_GIORNI = 7;

// ---- ore nel fuso della config ----------------------------------------------------------------
const GS = { dom: 0, lun: 1, mar: 2, mer: 3, gio: 4, ven: 5, sab: 6 };
function roma(t = Date.now()) {
  const fmt = new Intl.DateTimeFormat("it-IT", { timeZone: config().fuso, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false });
  const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  const ora = `${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
  return { giorno: `${p.year}-${p.month}-${p.day}`, ora, gs: GS[String(p.weekday).slice(0, 3).toLowerCase()], data: `${p.day}/${p.month}/${p.year}` };
}
const minuti = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const domani = (giorno) => { const d = new Date(`${giorno}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

// ---- interruttore e orari ---------------------------------------------------------------------
// Spento finché la persona non lo accende: un battito costa quota, e la prima volta si sceglie a mano.
const archivioB = () => negozio("battito", { base: {} });
const baseB = () => { const b = config().battito; return { acceso: false, orari: [...b.orari], giorni: [...b.giorni], ultimoSlot: "", visti: {}, registro: [] }; };
const leggiB = () => ({ ...baseB(), ...archivioB().leggi() });
const salvaB = (b) => archivioB().scrivi(b);

export function normalizzaOrari(orari) {
  const minima = config().battito.oraMinima;
  const lista = (Array.isArray(orari) ? orari : String(orari || "").split(/[,\s]+/)).map((x) => String(x).trim()).filter(Boolean);
  const out = [];
  for (const x of lista) {
    const m = x.match(/^(\d{1,2})(?:[:.](\d{2}))?$/);
    if (!m || Number(m[1]) > 23 || Number(m[2] || 0) > 59) throw new Error(`orario non valido: "${x}" (HH:MM)`);
    const hhmm = `${m[1].padStart(2, "0")}:${m[2] || "00"}`;
    if (minuti(hhmm) < minuti(minima)) throw new Error(`mai prima delle ${minima}: "${hhmm}"`);
    if (!out.includes(hhmm)) out.push(hhmm);
  }
  if (!out.length) throw new Error("serve almeno un orario");
  return out.sort();
}

// il prossimo scatto previsto (per la pagina e per ctl), fino a otto giorni avanti
function prossimo(b, adesso = Date.now()) {
  if (!b.acceso) return null;
  for (let g = 0; g < 8; g++) {
    for (const o of b.orari) {
      // un istante vicino a quell'ora: si parte dall'ora di adesso, si sposta di giorni e si corregge al minuto
      const base = adesso + g * 86400000, r = roma(base);
      if (!b.giorni.includes(r.gs)) continue;
      const delta = (minuti(o) - minuti(r.ora)) * 60000, t = Math.floor((base + delta) / 60000) * 60000;
      if (t > adesso && roma(t).ora === o) return t;
    }
  }
  return null;
}

export function statoBattito() {
  const b = leggiB();
  return { acceso: b.acceso, orari: b.orari, giorni: b.giorni, prossimo: prossimo(b), ultimo: b.registro[b.registro.length - 1] || null, registro: b.registro.slice(-10) };
}

export function impostaBattito(root, c = {}) {
  const b = leggiB();
  if (c.acceso !== undefined) b.acceso = c.acceso === true || c.acceso === "true" || c.acceso === "on" || c.acceso === 1;
  if (c.orari !== undefined) b.orari = normalizzaOrari(c.orari);
  if (c.giorni !== undefined) {
    const g = (Array.isArray(c.giorni) ? c.giorni : String(c.giorni).split(/[,\s]+/)).map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6);
    if (!g.length) throw new Error("giorni: numeri da 0 (domenica) a 6 (sabato)");
    b.giorni = [...new Set(g)].sort();
  }
  salvaB(b);
  return statoBattito();
}

// ---- i segnali, senza modello -----------------------------------------------------------------
// Ogni segnale ha una chiave stabile: lo stesso fatto non sveglia l'assistente due volte (visti, per sette giorni).
function generici({ cockpit }, adesso) {
  const out = [];
  // agenti che aspettano una risposta (non letti) da più di mezz'ora
  for (const s of cockpit ? cockpit.elenco() : []) {
    if (s.ruolo !== "agente" || s.stato !== "attende" || !s.nonLetti) continue;
    if (adesso - Date.parse(s.aggiornata || 0) < ATTESA_AGENTE) continue;
    const minutiAttesa = Math.round((adesso - Date.parse(s.aggiornata)) / 60000);
    out.push({ chiave: `attesa:${s.nome}:${s.turni}`, tipo: "agente", testo: `l'agente ${s.nome} aspetta da ${minutiAttesa} minuti: «${String(s.ultimo || "").slice(0, 160)}»` });
  }
  // consumo del piano: a scaglioni, così un aumento di dieci punti è un segnale nuovo
  try {
    const c = statoConsumo();
    if (c.sette && c.sette.u >= 70) {
      const scaglione = Math.floor(c.sette.u / 10) * 10, reset = new Date(c.sette.reset).toISOString().slice(0, 10);
      out.push({ chiave: `consumo:settimana:${scaglione}:${reset}`, tipo: "consumo", testo: `piano usato al ${c.sette.u}% della settimana` });
    }
    if (c.cinque && c.cinque.u >= 85) {
      out.push({ chiave: `consumo:cinque:${Math.floor(c.cinque.u / 5) * 5}:${c.cinque.reset}`, tipo: "consumo", testo: `finestra di cinque ore al ${c.cinque.u}%` });
    }
  } catch { /* consumo non ancora letto */ }
  return out;
}

export function segnali(ctx = {}, adesso = Date.now()) {
  const r = roma(adesso);
  const info = { adesso, giorno: r.giorno, domani: domani(r.giorno), persona: ctx.persona || {}, cockpit: ctx.cockpit || null };
  const out = generici(info, adesso);
  for (const f of ctx.segnali || []) {
    try { out.push(...(f(info) || [])); } catch (e) { console.error("segnale di un modulo:", e.message); }
  }
  return out;
}

// ---- proposte ---------------------------------------------------------------------------------
const archivioP = () => negozio("proposte", { base: [] });
const leggiP = () => { const p = archivioP().leggi(); return Array.isArray(p) ? p : []; };
const salvaP = (p) => archivioP().scrivi(p.slice(-300));
const aperta = (p) => p.stato === "attesa" || p.stato === "dopo";

function contatori(lista) {
  const n = (st) => lista.filter((p) => p.stato === st).length;
  return { fatte: lista.length, accettate: n("si"), rifiutate: n("no"), ignorate: n("ignorata"), inAttesa: lista.filter(aperta).length };
}
export function statoProposte() {
  const lista = leggiP();
  return { attuale: [...lista].reverse().find(aperta) || null, contatori: contatori(lista), recenti: lista.slice(-8).reverse(), battito: statoBattito() };
}
export function testoProposte() { // per ctl.mjs foglio leggi
  const s = statoProposte(), c = s.contatori;
  return [s.attuale ? `In attesa: ${s.attuale.testo} (perché: ${s.attuale.perche || "—"})` : "Nessuna proposta in attesa.",
    `Proposte fatte ${c.fatte} · accettate ${c.accettate} · rifiutate ${c.rifiutate} · ignorate ${c.ignorate}`,
    `Battito ${s.battito.acceso ? `acceso, alle ${s.battito.orari.join(", ")}` : "spento"}`,
    ...s.recenti.filter((p) => !aperta(p)).map((p) => `- ${p.stato}: ${p.testo}`)].join("\n");
}

// le proposte senza risposta da più di un giorno diventano ignorate (si chiama a ogni battito e a ogni nuova proposta)
function scadi(adesso = Date.now()) {
  const lista = leggiP(); let n = 0;
  for (const p of lista) if (p.stato === "attesa" && adesso - Date.parse(p.creata) > IGNORATA_DOPO) { p.stato = "ignorata"; p.risposta = new Date(adesso).toISOString(); n++; }
  if (n) salvaP(lista);
  return n;
}

const pulisciTesto = (t, max) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, max);
export function nuovaProposta(ctx, c = {}) {
  scadi();
  const testo = pulisciTesto(c.testo, 400), perche = pulisciTesto(c.perche, 200);
  if (!testo) throw new Error("serve il testo della proposta");
  const lista = leggiP(), b = leggiB();
  const inCorso = lista.find(aperta);
  if (inCorso) throw new Error(`c'è già una proposta in attesa (${inCorso.id}): una alla volta`);
  const ultimoBattito = b.registro[b.registro.length - 1];
  const battito = ultimoBattito && ultimoBattito.esito === "inviato" && Date.now() - ultimoBattito.t < 3 * 3600000 ? ultimoBattito.id || ultimoBattito.slot : "";
  if (battito && lista.some((p) => p.battito === battito)) throw new Error("questo battito ha già la sua proposta: al massimo una per battito");
  const p = { id: randomUUID().slice(0, 6), testo, perche, urgente: !!c.urgente && c.urgente !== "false", battito, creata: new Date().toISOString(), stato: "attesa", risposta: null };
  lista.push(p); salvaP(lista);
  ctx.assicuraFoglio?.();
  ctx.trasmetti({ type: "cockpit_proposte", azione: "nuova", proposta: p, ...statoProposte() });
  return p;
}

// Sì → l'assistente la esegue (con le regole di sempre); No → lo sa, senza lavoro; Più tardi → torna al battito successivo, senza modello.
export function rispondi(ctx, id, risposta) {
  const { cockpit } = ctx;
  if (!["si", "no", "dopo"].includes(risposta)) throw new Error("risposta: si, no o dopo");
  const lista = leggiP(), p = lista.find((x) => x.id === id);
  if (!p) throw new Error(`nessuna proposta "${id}"`);
  if (!aperta(p)) throw new Error(`la proposta ha già una risposta (${p.stato})`);
  p.stato = risposta; p.risposta = new Date().toISOString();
  salvaP(lista);
  const o = cockpit.orchestratore();
  if (o && risposta === "si") {
    const testo = `[proposta] Sì a «${p.testo}». Eseguila adesso con le regole di sempre: proponi e prepara; `
      + "niente che esce dalla cartella di lavoro (mail, messaggi, pubblicazioni) e niente commit senza un altro sì esplicito. "
      + "Se è lunga, affidala a un agente.";
    cockpit.invia(o.id, testo, { nota: "proposta accettata", mittente: "cockpit" });
  }
  if (o && risposta === "no") {
    const testo = `[proposta] No a «${p.testo}». Non fare niente: prendine nota per le prossime proposte e chiudi il turno con una parola.`;
    cockpit.invia(o.id, testo, { nota: "proposta rifiutata", mittente: "cockpit", origine: "battito" });
  }
  ctx.trasmetti({ type: "cockpit_proposte", azione: risposta, proposta: p, ...statoProposte() });
  return p;
}

// ---- lo scatto --------------------------------------------------------------------------------
function annota(b, voce) { b.registro.push({ t: Date.now(), ...voce }); b.registro = b.registro.slice(-50); }

export function battitoOra(ctx, { forza = false, slot = "" } = {}) {
  const { cockpit } = ctx, adesso = Date.now(), r = roma(adesso);
  const b = leggiB();
  slot = slot || `${r.giorno} ${r.ora}${forza ? " (a mano)" : ""}`;
  scadi(adesso);
  const lista = leggiP();
  const chiudiSlot = () => { if (!forza) b.ultimoSlot = slot; };
  // «più tardi»: la proposta rimandata torna in attesa, col fumetto, senza svegliare l'assistente
  const rimandata = lista.find((p) => p.stato === "dopo");
  if (rimandata) {
    rimandata.stato = "attesa"; rimandata.creata = new Date(adesso).toISOString(); salvaP(lista);
    ctx.assicuraFoglio?.();
    ctx.trasmetti({ type: "cockpit_proposte", azione: "ripresa", proposta: rimandata, ...statoProposte() });
    annota(b, { slot, esito: "ripresa", nota: "proposta rimandata di nuovo in vista" }); chiudiSlot(); salvaB(b);
    return { esito: "ripresa", proposta: rimandata };
  }
  if (lista.some(aperta)) { annota(b, { slot, esito: "silenzio", nota: "proposta ancora in attesa" }); chiudiSlot(); salvaB(b); return { esito: "silenzio", motivo: "proposta in attesa" }; }
  const o = cockpit.orchestratore();
  if (!o) { annota(b, { slot, esito: "silenzio", nota: "nessun assistente" }); chiudiSlot(); salvaB(b); return { esito: "silenzio", motivo: "nessun assistente" }; }
  if (o.stato === "lavora" || o.stato === "avvio") return { esito: "rimandato", motivo: "l'assistente sta lavorando" }; // si riprova al giro dopo, entro il quarto d'ora
  // segnali nuovi: mai visti negli ultimi sette giorni
  const limite = adesso - VISTI_GIORNI * 86400000;
  b.visti = Object.fromEntries(Object.entries(b.visti || {}).filter(([, t]) => t > limite));
  const tutti = segnali(ctx, adesso), nuovi = tutti.filter((s) => !b.visti[s.chiave]);
  // le risposte arrivate dall'ultimo battito inviato (rifiutate e ignorate si contano anche qui, come promemoria)
  const ultimoInvio = [...b.registro].reverse().find((x) => x.esito === "inviato")?.t || 0;
  const esiti = lista.filter((p) => p.risposta && Date.parse(p.risposta) > ultimoInvio && p.stato !== "attesa");
  chiudiSlot();
  if (!nuovi.length) { annota(b, { slot, esito: "silenzio", nota: `${tutti.length} segnali, nessuno nuovo` }); salvaB(b); return { esito: "silenzio", motivo: "niente di nuovo", segnali: tutti.length }; }
  for (const s of tutti) b.visti[s.chiave] = adesso;
  const righe = (xs) => xs.map((s) => `- [${s.tipo}] ${s.testo}`).join("\n");
  const vecchi = tutti.filter((s) => !nuovi.includes(s));
  const testo = cockpit.componiBattito({
    ora: r.ora, data: r.data, segnali_nuovi: righe(nuovi),
    segnali_visti: vecchi.length ? `\nGià visti nei battiti precedenti (${vecchi.length}): ${vecchi.map((s) => s.testo.split(" ")[0]).slice(0, 12).join(", ")}` : "",
    risposte: esiti.length ? `\nRisposte alle tue proposte dall'ultimo battito: ${esiti.map((p) => `${p.stato} a «${p.testo.slice(0, 80)}»`).join("; ")}` : "",
  });
  cockpit.invia(o.id, testo, { nota: `battito delle ${r.ora}`, mittente: "cockpit", origine: "battito" });
  annota(b, { id: randomUUID().slice(0, 8), slot, esito: "inviato", nuovi: nuovi.length, segnali: tutti.length }); // l'id lega la proposta a questo battito
  salvaB(b);
  return { esito: "inviato", nuovi: nuovi.length, segnali: tutti.length };
}

// Il timer del server: ogni 20 secondi guarda se un orario è arrivato. Lo slot già fatto sta su disco (ultimoSlot),
// quindi un riavvio nello stesso minuto non lo ripete e uno poco dopo l'orario lo recupera (entro RITARDO_MAX).
// Con COCKPIT_PROVA=1 lo scheduler non parte.
export function avviaBattito(ctx) {
  if (process.env.COCKPIT_PROVA === "1") return null;
  const giro = () => {
    try {
      const b = leggiB();
      if (!b.acceso) return;
      const adesso = Date.now(), r = roma(adesso);
      if (!b.giorni.includes(r.gs)) return;
      const dovuto = b.orari.filter((o) => minuti(o) <= minuti(r.ora) && (minuti(r.ora) - minuti(o)) * 60000 <= RITARDO_MAX).pop();
      if (!dovuto) return;
      const slot = `${r.giorno} ${dovuto}`;
      if (b.ultimoSlot === slot) return;
      const esito = battitoOra(ctx, { slot });
      ctx.trasmetti({ type: "cockpit_proposte", azione: "battito", esito: esito.esito, ...statoProposte() });
      if (esito.esito !== "rimandato") console.log(new Date().toLocaleTimeString("it-IT"), `battito ${slot}: ${esito.esito}${esito.motivo ? ` (${esito.motivo})` : ""}`);
    } catch (e) { console.error("battito:", e.message); }
  };
  setTimeout(giro, 3000).unref();
  return setInterval(giro, 20000).unref();
}

// A mano: `node plancia/server/battito.mjs` stampa i segnali di adesso (senza sessioni) e lo stato del battito; non manda niente.
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const { chiSono } = await import("./config.mjs");
  const { caricaModuli } = await import("./moduli.mjs");
  const cfg = config(), persona = chiSono();
  const moduli = await caricaModuli(cfg);
  const fns = moduli.filter((m) => m.segnaliBattito).map((m) => (info) => m.segnaliBattito({ cfg, persona, opzioni: m.opzioni, ...info }));
  console.log(JSON.stringify({ battito: statoBattito(), segnali: segnali({ persona, segnali: fns }) }, null, 1));
}
