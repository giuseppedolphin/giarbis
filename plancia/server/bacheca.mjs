// La bacheca della squadra (squadra.mjs): una chat di gruppo di tutti gli agenti permanenti e un filo diretto per ogni coppia.
// Solo dati, niente sessioni: chi scrive, chi è menzionato, cosa è arrivato a un ruolo dopo un certo istante. Chi sveglia
// i destinatari è squadra.mjs.
//
// Stato (stato.mjs): <stato>/squadra/bacheca.jsonl · <stato>/squadra/dm/<a>--<b>.jsonl (la coppia in ordine alfabetico).
// Un messaggio: { id, t, da, testo, menzioni: [slug] } (in bacheca) · { id, t, da, a, testo } (diretto).
//
//   menzioni(testo, noti)               → gli slug citati con @slug (@tutti = tutti i noti)
//   scrivi({ da, testo, noti })          → un messaggio in bacheca · scriviDm({ da, a, testo }) → un messaggio diretto
//   ultimi({ n, cerca })                 → la bacheca, i più recenti in fondo · filo(a, b, { n }) · fili() → le coppie con l'ultimo messaggio
//   perRuolo(slug, { dopo, esecutori, persona, capo, conoscenza }) → cosa è arrivato a un ruolo dopo `dopo` (diretti, menzioni, i suoi
//                                        esecutori; con `conoscenza` anche i diretti dei suoi esecutori ad altri, segnati `conoscenza: true`)
//   contaOra(da, adesso)                 → quanti messaggi ha scritto `da` nell'ultima ora (bacheca + diretti)
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { percorsoStato, registro } from "./stato.mjs";

export const MAX_TESTO = 2000;
const ORA = 3600000;
const bacheca = () => registro("squadra/bacheca");
const coppia = (a, b) => [String(a), String(b)].sort().join("--");
const filoDi = (a, b) => registro(`squadra/dm/${coppia(a, b)}`);
const slugValido = (x) => /^[a-z0-9][a-z0-9-]{0,31}$/.test(String(x || ""));

function pulisci(testo) {
  const t = String(testo ?? "").replace(/\r/g, "").trim();
  if (!t) throw new Error("messaggio vuoto");
  if (t.length > MAX_TESTO) throw new Error(`messaggio troppo lungo (${t.length} caratteri, massimo ${MAX_TESTO}): scrivi il dettaglio nella tua cartella e qui una riga`);
  return t;
}

export function menzioni(testo, noti = []) {
  const trovate = new Set();
  for (const m of String(testo || "").matchAll(/(^|[^\w@])@([a-z0-9][a-z0-9-]*)/gi)) {
    const k = m[2].toLowerCase().replace(/-+$/, "");
    if (k === "tutti") noti.forEach((x) => trovate.add(x));
    else if (noti.includes(k)) trovate.add(k);
  }
  return [...trovate];
}

export function scrivi({ da, testo, noti = [] }) {
  if (!da) throw new Error("manca chi scrive");
  const t = pulisci(testo);
  const m = { id: randomUUID().slice(0, 8), t: Date.now(), da: String(da), testo: t, menzioni: menzioni(t, noti).filter((x) => x !== da) };
  bacheca().aggiungi(m);
  return m;
}

export function scriviDm({ da, a, testo }) {
  if (!slugValido(da) || !slugValido(a)) throw new Error("mittente o destinatario non validi");
  if (da === a) throw new Error("un messaggio diretto a te stesso non serve: scrivilo nel tuo diario");
  const m = { id: randomUUID().slice(0, 8), t: Date.now(), da, a, testo: pulisci(testo) };
  filoDi(da, a).aggiungi(m);
  return m;
}

export function ultimi({ n = 20, cerca = "" } = {}) {
  let lista = bacheca().leggi();
  const q = String(cerca || "").trim().toLowerCase();
  if (q) lista = lista.filter((m) => m.testo.toLowerCase().includes(q) || m.da.includes(q));
  return lista.slice(-Math.max(1, Math.min(500, Number(n) || 20)));
}

export function filo(a, b, { n = 50 } = {}) {
  if (!slugValido(a) || !slugValido(b)) throw new Error("ruoli non validi");
  return filoDi(a, b).leggi().slice(-Math.max(1, Math.min(500, Number(n) || 50)));
}

// le coppie che si sono scritte, con l'ultimo messaggio; `di` filtra quelle di un ruolo
export function fili({ di = "" } = {}) {
  let nomi; try { nomi = readdirSync(percorsoStato("squadra", "dm")).filter((f) => /^[a-z0-9-]+--[a-z0-9-]+\.jsonl$/.test(f)); } catch { return []; }
  return nomi.map((f) => {
    const [a, b] = f.slice(0, -6).split("--");
    const righe = filoDi(a, b).leggi();
    return { a, b, n: righe.length, ultimo: righe[righe.length - 1] || null };
  }).filter((x) => x.ultimo && (!di || x.a === di || x.b === di)).sort((x, y) => y.ultimo.t - x.ultimo.t);
}

// Cosa è arrivato a un ruolo dopo `dopo`: i diretti a lui, le menzioni, i messaggi dei suoi esecutori, quelli della persona
// senza menzioni (per i capi). Mai i suoi. Con `conoscenza`, anche i diretti che i suoi esecutori hanno scritto ad altri: il capo
// li legge per conoscenza, e non sono una novità che lo sveglia (lo decide squadra.mjs).
export function perRuolo(slug, { dopo = 0, esecutori = [], persona = "", capo = false, conoscenza = false } = {}) {
  const inBacheca = bacheca().leggi().filter((m) => m.t > dopo && m.da !== slug && (
    (m.menzioni || []).includes(slug) || esecutori.includes(m.da) || (capo && persona && m.da === persona && !(m.menzioni || []).length)));
  const diretti = fili({ di: slug }).flatMap((f) => filoDi(f.a, f.b).leggi()).filter((m) => m.t > dopo && m.a === slug);
  const cc = !conoscenza ? [] : fili().filter((f) => f.a !== slug && f.b !== slug && (esecutori.includes(f.a) || esecutori.includes(f.b)))
    .flatMap((f) => filoDi(f.a, f.b).leggi()).filter((m) => m.t > dopo && esecutori.includes(m.da));
  return [...inBacheca.map((m) => ({ ...m, dove: "bacheca" })), ...diretti.map((m) => ({ ...m, dove: "dm" })), ...cc.map((m) => ({ ...m, dove: "dm", conoscenza: true }))]
    .sort((x, y) => x.t - y.t);
}

export function contaOra(da, adesso = Date.now()) {
  const dopo = adesso - ORA;
  const inBacheca = bacheca().leggi().filter((m) => m.t > dopo && m.da === da).length;
  const diretti = fili({ di: da }).reduce((n, f) => n + filoDi(f.a, f.b).leggi().filter((m) => m.t > dopo && m.da === da).length, 0);
  return inBacheca + diretti;
}
