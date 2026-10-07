// I modelli che una sessione del cockpit può usare: alias breve → id per `claude --model`. Un solo posto, usato da
// sessioni.mjs (avvio e cambio di modello), ctl.mjs (crea, modello), migrazioni.mjs e dalla pagina (selettori, via GET
// /api/sessioni). Il modello predefinito è `modelli.default` di plancia.config.json (un alias o un id), quello degli
// agenti di foglio `modelli.foglio`.
import { config } from "./config.mjs";

export const MODELLI = [
  { alias: "opus", id: "claude-opus-5-5", nome: "Opus 5.5" },
  { alias: "sonnet", id: "claude-sonnet-5-5", nome: "Sonnet 5.5" },
  { alias: "haiku", id: "claude-haiku-4-5-20251001", nome: "Haiku 4.5" },
];

const trova = (v) => MODELLI.find((x) => x.alias === v || x.id === v);
const normalizza = (m) => String(m ?? "").trim().toLowerCase();

// il predefinito della config; se la config dice un modello che non c'è, il primo dell'elenco
export function modelloDefault() {
  return (trova(normalizza(config().modelli.default)) || MODELLI[0]).id;
}
export function modelloFoglio() {
  return (trova(normalizza(config().modelli.foglio)) || trova(modelloDefault())).id;
}
export const MODELLO_DEFAULT = modelloDefault();

// alias o id → id; vuoto → il default; altro → errore (un modello sbagliato farebbe morire il processo all'avvio)
export function risolviModello(m) {
  const v = normalizza(m);
  if (!v) return modelloDefault();
  const trovato = trova(v);
  if (!trovato) throw new Error(`modello non ammesso: ${m} (${MODELLI.map((x) => x.alias).join(", ")})`);
  return trovato.id;
}
export const nomeModello = (id) => trova(normalizza(id))?.nome || String(id);
