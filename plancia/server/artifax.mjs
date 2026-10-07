// Artifax: il registro di tutto ciò che l'assistente e gli agenti hanno prodotto e fatto vedere: file sulla lavagna,
// fogli sopra la mappa, pannelli fissati dai moduli. Sta in artifax.json nella cartella di stato (fuori da git) e
// sopravvive ai riavvii e alla chiusura dei fogli. Lo scrive solo il server (plancia/server/server.mjs). La rinomina del
// vecchio generati.json sta in migrazioni.mjs.
//
//   registra({percorso|tipo, titolo, da, origine, …})  → aggiunge una voce, o aggiorna quella dello stesso file
//   elenco()                                           → la lista per la dashboard: backfill dei file già nella lavagna
//                                                        (data = mtime) e dei pannelli registrati da un modulo, dal più recente
//   trova(id)
//   impostaTipi(lista)                                 → i tipi di foglio senza file che si possono registrare oltre a «tabella»
//                                                        (li offrono i moduli: una voce per tipo e tabella)
//
// `node plancia/server/artifax.mjs` stampa l'elenco (sul registro vero: fa il backfill).
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { negozio } from "./stato.mjs";
import { cartellaDi, fileDiFoglio, percorsoAmmesso, prefissiCartelle } from "./fogli-testo.mjs";

const TIPI_FILE = {
  html: "html", png: "immagine", jpg: "immagine", jpeg: "immagine", svg: "immagine", gif: "immagine", webp: "immagine",
  mp4: "video", webm: "video", mp3: "audio", wav: "audio", ogg: "audio", m4a: "audio",
};
const NOME_FILE = /^[\w.\-]+$/;
const registroFile = () => negozio("artifax", { base: [] });
const tipiExtra = new Set();

export const impostaTipi = (lista) => { tipiExtra.clear(); for (const t of lista || []) tipiExtra.add(String(t)); };
export const tipoDaEstensione = (p) => TIPI_FILE[String(p).split(".").pop().toLowerCase()] || "";
const leggi = () => { const g = registroFile().leggi(); return Array.isArray(g) ? g : []; };
const salva = (g) => registroFile().scrivi(g);
const titoloDa = (nome) => { const t = nome.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim(); return t ? t[0].toUpperCase() + t.slice(1) : nome; };
const messaggioPercorso = () => `percorso non valido: ${prefissiCartelle().map((p) => `${p}<file>`).join(" o ")}`;

// Una voce nuova, o l'aggiornamento di quella che c'è già: stesso file → stessa voce (risale in cima);
// i fogli dei moduli → una voce per tipo e tabella (sono vivi, leggono dal vivo); le tabelle sono istantanee, una voce ciascuna.
export function registra(v) {
  const g = leggi();
  const ora = new Date().toISOString();
  let tipo = v.tipo;
  if (v.percorso) {
    if (!percorsoAmmesso(v.percorso)) throw new Error(messaggioPercorso());
    tipo = tipoDaEstensione(v.percorso);
    if (!tipo) throw new Error(`tipo di file non gestito: ${v.percorso}`);
  } else if (tipo !== "tabella" && !tipiExtra.has(tipo)) throw new Error(`serve un percorso, oppure tipo ${["tabella", ...tipiExtra].join(", ")}`);
  const da = String(v.da || "").slice(0, 60);
  const titolo = String(v.titolo || "").slice(0, 120);
  const k = g.findIndex((x) => (v.percorso ? x.percorso === v.percorso : tipiExtra.has(tipo) ? x.tipo === tipo && x.tabella === v.tabella : false));
  const n = k >= 0 ? { ...g[k] } : { id: randomUUID().slice(0, 8), tipo };
  n.titolo = titolo || n.titolo || (v.percorso ? titoloDa(v.percorso.split("/").pop()) : tipo === "tabella" ? "Tabella" : "Foglio");
  if (da || k < 0) n.da = da;
  n.quando = ora;
  n.origine = v.origine || n.origine || "lavagna";
  if (v.descrizione) n.descrizione = String(v.descrizione).replace(/\s+/g, " ").trim().slice(0, 160);
  if (v.percorso) n.percorso = v.percorso;
  if (tipiExtra.has(tipo) && v.tabella !== undefined) n.tabella = v.tabella;
  if (tipo === "tabella") { n.colonne = v.colonne || []; n.righe = v.righe || []; }
  if (k >= 0) g[k] = n; else g.push(n);
  salva(g);
  return n;
}

export function elenco() {
  const g = leggi();
  const nota = new Set(g.filter((x) => x.percorso).map((x) => x.percorso));
  let cambiato = false;
  // Backfill: i file già nella lavagna che nessuno ha registrato (messi lì a mano, o prima del registro), con data = mtime.
  const cartellaLavagna = cartellaDi("/lavagna/");
  if (existsSync(cartellaLavagna)) for (const nome of readdirSync(cartellaLavagna)) {
    const tipo = tipoDaEstensione(nome);
    if (!tipo || !NOME_FILE.test(nome) || nota.has(`/lavagna/${nome}`)) continue;
    let s; try { s = statSync(path.join(cartellaLavagna, nome)); } catch { continue; }
    if (!s.isFile()) continue;
    g.push({ id: randomUUID().slice(0, 8), tipo, titolo: titoloDa(nome), percorso: `/lavagna/${nome}`, da: "", quando: new Date(s.mtimeMs).toISOString(), origine: "backfill" });
    cambiato = true;
  }
  // I pannelli fissati da un modulo (cartella registrata con pannelli.json): la data è quella di `creato`, se non sono già registrati con l'ora.
  const cartellaPannelli = cartellaDi("/pannelli/");
  if (cartellaPannelli) try {
    const pannelli = JSON.parse(readFileSync(path.join(cartellaPannelli, "pannelli.json"), "utf8"));
    for (const p of Array.isArray(pannelli) ? pannelli : []) {
      const tipo = tipoDaEstensione(p.file || ""), percorso = `/pannelli/${p.file}`;
      if (!tipo || !NOME_FILE.test(p.file) || nota.has(percorso)) continue;
      g.push({ id: randomUUID().slice(0, 8), tipo, titolo: p.titolo || titoloDa(p.file), percorso, da: p.da || "", quando: p.creato || new Date(0).toISOString(), origine: "pannello" });
      cambiato = true;
    }
  } catch { /* nessun registro dei pannelli */ }
  if (cambiato) salva(g);
  // In uscita niente righe delle tabelle (pesano): ne basta il conteggio; il file mancante si segnala.
  const mancante = (x) => x.percorso && !existsSync(fileDiFoglio(x.percorso) || "/nonesiste");
  return g.map(({ colonne, righe, ...x }) => ({
    ...x, ...(x.tipo === "tabella" ? { n_righe: (righe || []).length } : {}), ...(mancante(x) ? { mancante: true } : {}),
  }))
    .sort((a, b) => String(b.quando).localeCompare(String(a.quando)));
}

export const trova = (id) => leggi().find((x) => x.id === id) || null;

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const e = elenco();
  const riga = (x) => [
    `${String(x.quando).slice(0, 16).replace("T", " ")}  ${x.tipo.padEnd(8)} ${x.titolo}`, x.da ? `  (da ${x.da})` : "", x.mancante ? "  [file mancante]" : "",
  ].join("");
  console.log(e.map(riga).join("\n") || "nessun artifax");
}
