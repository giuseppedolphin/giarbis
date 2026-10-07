// Le voci di un file markdown a caselle (di solito TODO.md nella cartella di lavoro). Una voce è una riga
//   - [ ] testo della voce P1 (entro 12/10/2026)
// con priorità facoltativa (P1, P2, P3 come parola a sé) e scadenza facoltativa «(entro GG/MM/AAAA)». Una voce fatta è
//   - [x] testo … (fatta il 07/10/2026: esito)
// L'id è un'impronta corta del testo (non della posizione): resta lo stesso se il file si riordina o si aggiungono righe.
// La scrittura cambia solo la riga della voce, rileggendo il file subito prima, e passa da un file temporaneo + rename.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const RIGA = /^(\s*[-*]\s+\[)([ xX])(\]\s+)(.*)$/;
const FATTA = /\s*\(fatta il (\d{2})\/(\d{2})\/(\d{4})(?::\s*(.*?))?\)\s*$/;
const ENTRO = /\(entro (\d{2})\/(\d{2})\/(\d{4})\)/;
const PRIO = /(?:^|\s)(P[123])(?=\s|$)/;

const iso = (g, m, a) => `${a}-${m}-${g}`;
const italiana = (d) => d.toISOString().slice(0, 10).split("-").reverse().join("/");
const impronta = (testo) => "t" + createHash("sha1").update(testo.replace(FATTA, "").trim().toLowerCase()).digest("hex").slice(0, 6);

export function leggiVoci(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").flatMap((riga, n) => {
    const m = riga.match(RIGA);
    if (!m) return [];
    const corpo = m[4];
    const fatta = m[2].toLowerCase() === "x";
    const f = corpo.match(FATTA), e = corpo.match(ENTRO), p = corpo.match(PRIO);
    const titolo = corpo.replace(FATTA, "").replace(ENTRO, "").replace(PRIO, " ").replace(/\s+/g, " ").trim();
    return [{
      id: impronta(corpo), riga: n, titolo, priorita: p ? p[1] : "", scadenza: e ? iso(e[1], e[2], e[3]) : "",
      stato: fatta ? "chiusa" : "aperta", chiusa: f ? iso(f[1], f[2], f[3]) : fatta ? "?" : "", esito: f?.[4] || "",
    }];
  });
}

function riscrivi(file, id, fn) {
  const righe = readFileSync(file, "utf8").split("\n");
  const voce = leggiVoci(file).find((v) => v.id === id);
  if (!voce) throw new Error(`nessuna voce ${id} in ${path.basename(file)}`);
  righe[voce.riga] = fn(righe[voce.riga], voce);
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, righe.join("\n"));
  renameSync(tmp, file);
  return leggiVoci(file).find((v) => v.riga === voce.riga) || voce;
}

export function chiudi(file, id, esito = "", oggi = new Date()) {
  const testo = String(esito).replace(/[()\n]/g, " ").trim().slice(0, 200) || "fatta";
  return riscrivi(file, id, (riga, v) => {
    if (v.stato === "chiusa") throw new Error(`${id} è già fatta`);
    return riga.replace(RIGA, (_, a, _x, b, corpo) => `${a}x${b}${corpo.trimEnd()} (fatta il ${italiana(oggi)}: ${testo})`);
  });
}

export function riapri(file, id) {
  return riscrivi(file, id, (riga, v) => {
    if (v.stato !== "chiusa") throw new Error(`${id} non è fatta`);
    return riga.replace(RIGA, (_, a, _x, b, corpo) => `${a} ${b}${corpo.replace(FATTA, "")}`);
  });
}
