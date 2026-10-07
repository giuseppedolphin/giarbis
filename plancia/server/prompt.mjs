// I testi per i modelli stanno in plancia/prompt/<nome>.md, con segnaposto {{chiave}}. Ogni modulo acceso può aggiungere
// in coda un suo frammento (modulo.prompt[nome], percorso relativo alla cartella del modulo). Si rileggono dal disco a
// ogni chiamata: modificare un testo non richiede il Riavvia. Un segnaposto senza valore è un errore, non una stringa vuota.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { PLANCIA, comandoCtl, config } from "./config.mjs";

export const CARTELLA_PROMPT = path.join(PLANCIA, "prompt");

const SEGNAPOSTO = /\{\{\s*([\w.\-]+)\s*\}\}/g;

// {{skill_lavagna}}: la skill lavagna se c'è nella cartella di lavoro, altrimenti le tre righe essenziali.
export function skillLavagna() {
  const rel = ".claude/skills/lavagna/SKILL.md";
  if (existsSync(path.join(config().cartella, rel))) return `la skill lavagna (${rel})`;
  return `queste regole: la lavagna mostra un file html autosufficiente (niente file esterni), salvato nella cartella "
    + "che dà \"${comandoCtl()} cartella lavagna\"; con --descrizione sempre (una riga su cosa contiene); un foglio per ogni cosa da far vedere`;
}

// Un frammento di modulo: "file.md" oppure { file, opzionale }. Il percorso è relativo al modulo, ma può essere assoluto.
// Mancante: errore, salvo opzionale (allora si salta in silenzio).
function frammento(m, nome) {
  const f = m.prompt?.[nome];
  if (!f) return null;
  const { file, opzionale = false } = typeof f === "string" ? { file: f } : f;
  const percorso = path.resolve(m.cartella, file);
  if (opzionale && !existsSync(percorso)) return null;
  return readFileSync(percorso, "utf8");
}

// `cartella` serve alle prove; di solito è plancia/prompt
export function componi(nome, variabili = {}, moduli = [], cartella = CARTELLA_PROMPT) {
  if (!/^[\w\-]+$/.test(nome)) throw new Error(`nome di prompt non valido: ${nome}`);
  const pezzi = [readFileSync(path.join(cartella, `${nome}.md`), "utf8")];
  for (const m of moduli) {
    const testo = frammento(m, nome);
    if (testo !== null) pezzi.push(testo);
  }
  const ha = (k) => variabili[k] !== undefined && variabili[k] !== null;
  if (!ha("skill_lavagna") && pezzi.some((p) => p.includes("{{skill_lavagna}}"))) variabili = { ...variabili, skill_lavagna: skillLavagna() };
  const mancanti = new Set();
  const testo = pezzi.map((p) => p.replace(/\s+$/, "")).join("\n\n").replace(SEGNAPOSTO, (tutto, k) => {
    if (variabili[k] === undefined || variabili[k] === null) { mancanti.add(k); return tutto; }
    return String(variabili[k]);
  });
  if (mancanti.size) throw new Error(`prompt "${nome}": segnaposto senza valore: ${[...mancanti].join(", ")}`);
  return testo + "\n";
}
