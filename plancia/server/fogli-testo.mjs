// Il testo leggibile di un foglio e la sua descrizione di una riga: servono all'assistente e agli agenti per guardare dentro un
// foglio senza leggerne il markup (`ctl.mjs foglio leggi`, `ctl.mjs fogli`) e al server per dare una descrizione a chi
// non la scrive. Legge solo file dentro le cartelle note: la lavagna dello stato e quelle che un modulo registra.
//
//   testoFoglio(foglio, ctx)       → testo semplice: html → testo, tabella → righe, immagine → metadati, proposte → riepilogo;
//                                    i tipi dei moduli passano da ctx.tipi[tipo].testo(foglio, ctx)
//   descrizioneDi(foglio, ctx)     → la descrizione scritta da chi l'ha creato, oppure ricavata (primo titolo dell'html, titolo)
//   fileDiFoglio(percorso)         → il file di un foglio html o immagine, "" se il percorso non è ammesso
//   registraCartella(prefisso, dir) → una cartella servita sotto un prefisso (la lavagna c'è già; il resto lo offrono i moduli)
//   testoDaHtml(html), primoTitolo(html)
//
// ctx = { tipi } con il registro dei tipi di foglio di fogli.mjs; senza ctx valgono i soli tipi del nucleo.
// Transitorio: `testoFoglio`, `descrizioneDi` e `fileDiFoglio` accettano ancora la firma di prima, con `root` davanti
// (una stringa), che viene ignorata.
//
// Prova a mano: `node plancia/server/fogli-testo.mjs <file.html>` stampa il testo e il primo titolo.
import { readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "./config.mjs";
import { percorsoStato } from "./stato.mjs";
import { testoProposte } from "./battito.mjs";

const ENTITA = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", egrave: "è", eacute: "é", agrave: "à", ograve: "ò", ugrave: "ù",
  igrave: "ì", rarr: "→", middot: "·", hellip: "…", ndash: "–", mdash: "—", times: "×",
};
const codicePunto = (e) => String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
const decodifica = (t) => t.replace(/&(#x?[\da-f]+|\w+);/gi, (m, e) => (e[0] === "#" ? codicePunto(e) : ENTITA[e.toLowerCase()] ?? m));
export const unaRiga = (t, max = 160) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export function testoDaHtml(html) {
  return decodifica(String(html)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1>/gi, (m, tag) => tag.toLowerCase() === "head" ? (m.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "") + "\n" : "")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<(br|hr)\b[^>]*>|<\/(p|div|section|article|li|tr|h[1-6]|table|ul|ol|header|footer|figure|blockquote|pre)>/gi, "\n")
    .replace(/<[^>]+>/g, ""))
    .split("\n").map((r) => r.replace(/[ \t ]+/g, " ").replace(/\s*\|\s*$/, "").trim()).filter((r, i, a) => r || (a[i - 1] && i < a.length - 1))
    .join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function primoTitolo(html) {
  const m = String(html).match(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i) || String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? unaRiga(decodifica(m[1].replace(/<[^>]+>/g, " "))) : "";
}

// ---- le cartelle dei file di un foglio ------------------------------------------------------------
const cartelle = new Map([["/lavagna/", () => percorsoStato("lavagna")]]); // prefisso URL → funzione che dà la cartella

export function registraCartella(prefisso, dir) {
  const p = String(prefisso);
  if (!/^\/[\w\-]+\/$/.test(p)) throw new Error(`prefisso di cartella non valido: ${prefisso} (serve /nome/)`);
  const assoluta = path.resolve(config().cartella, dir);
  cartelle.set(p, () => assoluta);
}
export const prefissiCartelle = () => [...cartelle.keys()];
export const cartellaDi = (prefisso) => cartelle.get(prefisso)?.() || "";

const NOME_FILE = /^(?!\.\.?$)[\w.\-]+$/;
// Un percorso `/<prefisso>/<file>` → file su disco; solo prefissi noti e nomi semplici, mai altrove.
export function fileDiFoglio(...a) {
  const percorso = String(a[a.length - 1] ?? "");
  const m = percorso.match(/^(\/[\w\-]+\/)([\w.\-]+)$/);
  if (!m || !cartelle.has(m[1]) || !NOME_FILE.test(m[2])) return "";
  return path.join(cartelle.get(m[1])(), m[2]);
}
// Il percorso è nella forma ammessa per un foglio html o immagine (la cartella può non esistere ancora)?
export const percorsoAmmesso = (p) => { const m = String(p).match(/^(\/[\w\-]+\/)([\w.\-]+)$/); return !!m && cartelle.has(m[1]) && NOME_FILE.test(m[2]); };

function misureImmagine(buf) {
  if (buf.length > 24 && buf.toString("ascii", 1, 4) === "PNG") return `${buf.readUInt32BE(16)}×${buf.readUInt32BE(20)}`;
  if (buf.length > 10 && buf.toString("ascii", 0, 3) === "GIF") return `${buf.readUInt16LE(6)}×${buf.readUInt16LE(8)}`;
  return "";
}

// ---- i tipi del nucleo ----------------------------------------------------------------------------
function testoHtml(f) {
  const file = fileDiFoglio(f.percorso);
  if (!file || !existsSync(file)) return `file non trovato: ${f.percorso || "(nessun percorso)"}`;
  return testoDaHtml(readFileSync(file, "utf8"));
}
function testoImmagine(f) {
  const file = fileDiFoglio(f.percorso);
  if (!file || !existsSync(file)) return `file non trovato: ${f.percorso || "(nessun percorso)"}`;
  const s = statSync(file), est = path.extname(file).slice(1).toLowerCase();
  const misure = ["png", "gif"].includes(est) ? misureImmagine(readFileSync(file).subarray(0, 32)) : "";
  const lingua = config().lingua;
  return [
    `${f.tipo}: ${path.basename(file)}`, `formato: ${est}${misure ? `, ${misure} px` : ""}`, `peso: ${s.size.toLocaleString(lingua)} byte`,
    `modificato: ${s.mtime.toLocaleString(lingua)}`, `percorso: ${f.percorso}`,
  ].join("\n");
}

export const TIPI_NUCLEO = {
  html: {
    testo: testoHtml,
    descrizione(f) {
      const file = fileDiFoglio(f.percorso);
      const t = file && existsSync(file) ? primoTitolo(readFileSync(file, "utf8")) : "";
      return t && t !== unaRiga(f.titolo) ? t : "";
    },
  },
  immagine: { testo: testoImmagine, descrizione: () => "" },
  tabella: {
    testo: (f) => [`${(f.colonne || []).join(" | ")}`, ...(f.righe || []).map((r) => r.join(" | "))].join("\n"),
    descrizione: (f) => unaRiga(`${f.titolo || "Tabella"}: ${(f.righe || []).length} righe, colonne ${(f.colonne || []).slice(0, 6).join(", ")}`),
  },
  proposte: { testo: () => testoProposte(config().cartella), descrizione: () => "" },
};

const tipoDi = (f, ctx) => (ctx?.tipi || TIPI_NUCLEO)[f.tipo] || null;
// la firma di prima era (root, foglio): il foglio è l'ultimo argomento oggetto, l'eventuale ctx il successivo
const separa = (a) => (typeof a[0] === "string" ? [a[1], a[2]] : [a[0], a[1]]);

export function testoFoglio(...a) {
  const [f, ctx] = separa(a);
  const t = tipoDi(f, ctx);
  if (!t) return `(tipo di foglio senza testo: ${f.tipo})`;
  return t.testo(f, ctx);
}

export function descrizioneDi(...a) {
  const [f, ctx] = separa(a);
  if (unaRiga(f.descrizione)) return unaRiga(f.descrizione);
  const d = unaRiga(tipoDi(f, ctx)?.descrizione?.(f, ctx));
  return d || unaRiga(f.titolo) || "";
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const f = process.argv[2];
  if (!f) { console.error("uso: node plancia/server/fogli-testo.mjs <file.html>"); process.exit(1); }
  const html = readFileSync(f, "utf8");
  console.log(`titolo: ${primoTitolo(html)}\n---\n${testoDaHtml(html)}`);
}
