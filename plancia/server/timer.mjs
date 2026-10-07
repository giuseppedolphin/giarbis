// I timer e i promemoria agganciati a una sessione: i risvegli che l'assistente e gli agenti si programmano con CronCreate.
// Vivono dentro il processo claude della sessione e il server non li vede, quindi la sessione li dichiara qui
// (ctl.mjs timer …) e la mappa li disegna come un simbolo a sé, legato alla sfera di chi li ha creati.
// Stato in timer.json nella cartella di stato (fuori da git, vedi stato.mjs); lo scrive solo il server (plancia/server/server.mjs).
//
//   aggiungi({sessione, descrizione, ricorrenza, idCron?, unaVolta?})  → registra (stessa sessione + stesso idCron = aggiorna)
//   scattato(id)       → ultimo scatto = adesso, ricalcola il prossimo; se è una tantum lo toglie
//   togli(id)          → lo toglie dal registro (non cancella il job di CronCreate: lo fa la sessione con CronDelete)
//   sospendi(sessione) → il processo della sessione è ripartito: i suoi job di CronCreate sono morti, i timer restano a vista ma spenti
//   elenco()           → tutti, con prec/prossimo aggiornati a adesso
//   potaOrfani(nomiVivi)
//
// Transitorio: `sospendi` accetta ancora un primo argomento `root` davanti alla sessione e lo ignora (la firma di prima,
// usata da sessioni.mjs); si toglie quando il chiamante è passato alla nuova.
//
// Ricorrenze ammesse: espressione cron a 5 campi (minuto ora giorno-del-mese mese giorno-della-settimana, ora locale, come CronCreate)
// oppure «ogni N minuti» / «ogni N ore». Un'espressione senza ricorrenza vera (giorno e mese fissi) va con unaVolta.
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { negozio } from "./stato.mjs";

const registroTimer = () => negozio("timer", { base: [] });
const leggi = () => { const t = registroTimer().leggi(); return Array.isArray(t) ? t : []; };
const salva = (t) => registroTimer().scrivi(t);
const MIN = 60000;

// ---- ricorrenza -------------------------------------------------------------------------------
// Un campo cron → insieme dei valori ammessi (liste, intervalli, passi, *).
function campo(testo, min, max, nome) {
  const ok = new Set();
  for (const parte of String(testo).split(",")) {
    const m = parte.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/);
    if (!m) throw new Error(`campo cron non valido (${nome}): "${testo}"`);
    let [a, b] = m[1] === "*" ? [min, max] : m[1].split("-").map(Number);
    if (b === undefined) b = m[2] ? max : a; // «5/15» = da 5 in avanti ogni 15
    const passo = m[2] ? Number(m[2]) : 1;
    if (!passo || a < min || b > max || a > b) throw new Error(`campo cron fuori scala (${nome}): "${testo}"`);
    for (let v = a; v <= b; v += passo) ok.add(v);
  }
  return ok;
}
// Restituisce {tipo:"cron", campi} oppure {tipo:"intervallo", ms}.
export function leggiRicorrenza(testo) {
  const t = String(testo || "").trim().toLowerCase();
  const m = t.match(/^ogni\s+(\d+)\s*(min|minut[oi]|m|or[ae]|h)$/);
  if (m) {
    const ms = Number(m[1]) * (/^(or|h)/.test(m[2]) ? 60 : 1) * MIN;
    if (ms < MIN) throw new Error("la ricorrenza minima è un minuto");
    return { tipo: "intervallo", ms };
  }
  const p = t.split(/\s+/);
  if (p.length !== 5) throw new Error('ricorrenza non valida: serve un cron a 5 campi ("7,37 * * * *") oppure "ogni N minuti" / "ogni N ore"');
  const dow = campo(p[4].replace(/\b7\b/g, "0"), 0, 6, "giorno della settimana");
  return {
    tipo: "cron",
    campi: {
      min: campo(p[0], 0, 59, "minuto"), ora: campo(p[1], 0, 23, "ora"), gm: campo(p[2], 1, 31, "giorno del mese"),
      mese: campo(p[3], 1, 12, "mese"), gs: dow, gmStar: p[2] === "*", gsStar: p[4] === "*",
    },
  };
}
const combacia = (c, d) => {
  if (!c.min.has(d.getMinutes()) || !c.ora.has(d.getHours()) || !c.mese.has(d.getMonth() + 1)) return false;
  const gm = c.gm.has(d.getDate()), gs = c.gs.has(d.getDay());
  return c.gmStar || c.gsStar ? gm && gs : gm || gs; // come cron: con entrambi i giorni limitati basta uno dei due
};
// Il primo scatto dopo `da` (verso = 1) o l'ultimo prima (verso = -1); null se non ce n'è entro un anno.
function scatto(rc, da, verso, ancora) {
  if (rc.tipo === "intervallo") {
    const base = ancora || da, k = Math.floor((da - base) / rc.ms);
    return verso > 0 ? base + (k + 1) * rc.ms : base + (Math.ceil((da - base) / rc.ms) - 1) * rc.ms;
  }
  const d = new Date(da); d.setSeconds(0, 0); d.setMinutes(d.getMinutes() + verso);
  for (let i = 0; i < 366 * 24 * 60; i++, d.setMinutes(d.getMinutes() + verso)) if (combacia(rc.campi, d)) return d.getTime();
  return null;
}
export const prossimoScatto = (ricorrenza, da = Date.now(), ancora) => scatto(leggiRicorrenza(ricorrenza), da, 1, ancora);

// ---- registro ---------------------------------------------------------------------------------
function ricalcola(t, adesso) {
  const rc = leggiRicorrenza(t.ricorrenza), ancora = Date.parse(t.creato);
  t.prossimo = scatto(rc, adesso, 1, ancora);
  t.prec = scatto(rc, t.prossimo ? t.prossimo : adesso, -1, ancora); // lo scatto precedente a quello in arrivo: serve all'arco, che si riempie fra i due
  if (t.prec !== null && t.prec < Date.parse(t.creato) - MIN) t.prec = Date.parse(t.creato);
  return t;
}
const iso = (ms) => (ms === null || ms === undefined ? null : new Date(ms).toISOString());

export function elenco(adesso = Date.now()) {
  const tutti = leggi(); let toccato = false;
  for (const t of tutti) {
    if (t.prossimo && Date.parse(t.prossimo) <= adesso && !t.sospeso) { // lo scatto è passato senza che la sessione lo dicesse: si rimette in pari con l'orologio
      try { const n = ricalcola({ ...t }, adesso); Object.assign(t, { prossimo: iso(n.prossimo), prec: iso(n.prec) }); toccato = true; } catch { /* ricorrenza rovinata a mano: resta com'è */ }
    }
  }
  if (toccato) salva(tutti);
  return tutti.map((t) => ({ ...t }));
}

export function aggiungi({ sessione, descrizione, ricorrenza, idCron = "", unaVolta = false }) {
  sessione = String(sessione || "").trim();
  if (!sessione) throw new Error("serve la sessione (COCKPIT_SESSIONE)");
  descrizione = String(descrizione || "").trim().slice(0, 140);
  if (!descrizione) throw new Error("serve una descrizione breve");
  const ric = String(ricorrenza || "").trim().replace(/\s+/g, " ");
  const adesso = Date.now();
  const tutti = leggi();
  idCron = String(idCron || "").slice(0, 60);
  const k = idCron ? tutti.findIndex((x) => x.sessione === sessione && x.idCron === idCron) : -1;
  const t = k >= 0 ? tutti[k] : { id: randomUUID().slice(0, 8), sessione, creato: new Date(adesso).toISOString(), ultimo: null };
  Object.assign(t, { descrizione, ricorrenza: ric, idCron, unaVolta: !!unaVolta, sospeso: false });
  ricalcola(t, adesso);
  if (t.prossimo === null) throw new Error("questa ricorrenza non scatta mai (entro un anno)");
  t.prossimo = iso(t.prossimo); t.prec = iso(t.prec);
  if (k >= 0) tutti[k] = t; else tutti.push(t);
  salva(tutti);
  return { ...t };
}

export function scattato(id) {
  const tutti = leggi(), k = tutti.findIndex((x) => x.id === id || (x.idCron && x.idCron === id));
  if (k < 0) throw new Error(`nessun timer "${id}"`);
  const t = tutti[k], adesso = Date.now();
  t.ultimo = new Date(adesso).toISOString(); t.sospeso = false;
  if (t.unaVolta) { tutti.splice(k, 1); salva(tutti); return { ...t, tolto: true }; }
  const n = ricalcola({ ...t }, adesso); t.prossimo = iso(n.prossimo); t.prec = iso(adesso);
  salva(tutti);
  return { ...t };
}

export function togli(id) {
  const tutti = leggi(), k = tutti.findIndex((x) => x.id === id || (x.idCron && x.idCron === id));
  if (k < 0) throw new Error(`nessun timer "${id}"`);
  const [t] = tutti.splice(k, 1); salva(tutti);
  return { ...t };
}

export function sospendi(...argomenti) {
  const sessione = argomenti[argomenti.length - 1];
  const tutti = leggi(); let n = 0;
  for (const t of tutti) if (t.sessione === sessione && !t.sospeso) { t.sospeso = true; n++; }
  if (n) salva(tutti);
  return n;
}

// Si toglie dal registro ciò che appartiene a sessioni che non esistono più.
export function potaOrfani(nomiVivi) {
  const tutti = leggi(), resta = tutti.filter((t) => nomiVivi.includes(t.sessione));
  if (resta.length !== tutti.length) salva(resta);
  return tutti.length - resta.length;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) console.log(JSON.stringify(elenco(), null, 1));
