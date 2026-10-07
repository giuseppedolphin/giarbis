// La voce dell'assistente con ElevenLabs: una frase alla volta sull'endpoint di streaming HTTP
// (POST /v1/text-to-speech/{voice_id}/stream), l'mp3 arriva a pezzi mentre il modello lo genera e il
// server lo gira alla pagina così com'è. La chiave è ELEVENLABS_API_KEY, letta da config.chiave() (ambiente, file delle
// chiavi della config, chiavi.env dello stato): senza chiave il motore resta selezionabile, ma il pannello Voce lo dice e
// la pagina ripiega sulla voce del browser.
//
// Uso (da rotte/voce-impostazioni.mjs):
//   const r = await parlaEleven({ chiave, voce, modello, testo });   // Response di fetch, corpo mp3
//   const voci = await vociEleven(chiave);                          // [{ id, nome }], in cache 10 minuti
//
// `node plancia/server/voce-eleven.mjs` dice se la chiave c'è e quante voci vede l'account (non la stampa).
import { pathToFileURL } from "node:url";
import { chiave as leggiChiave } from "./config.mjs";

const API = "https://api.elevenlabs.io/v1";

// I modelli che hanno senso per una voce che legge frase per frase. Il primo è il predefinito.
export const MODELLI_ELEVEN = [
// v4 Turbo (uscito il 28/09/2026): ~100 ms, il più espressivo fra i modelli in tempo reale, stesso prezzo di Flash.
  { id: "eleven_v4_turbo", nome: "v4 Turbo (naturale, ~100 ms)" },
  { id: "eleven_flash_v2_5", nome: "Flash v2.5 (latenza minima, ~75 ms)" },
  { id: "eleven_v4", nome: "v4 (qualità massima, più lento)" },
  { id: "eleven_multilingual_v2", nome: "Multilingual v2 (stabile, più lento)" },
];

// Voci predefinite di ElevenLabs (multilingue, parlano italiano): servono finché la lista dell'account
// non arriva, o se /v1/voices non risponde. Con la chiave vale la lista vera, voci clonate comprese.
export const VOCI_ELEVEN_BASE = [
  { id: "JBFqnCBsd6RMkjVDRZzb", nome: "George" },
  { id: "onwK4e9ZLuTAKqWW03F9", nome: "Daniel" },
  { id: "nPczCjzI2devNBz1zQrb", nome: "Brian" },
  { id: "pNInz6obpgDQGcFmaJgB", nome: "Adam" },
  { id: "IKne3meq5aSn9XLyUdCD", nome: "Charlie" },
  { id: "cjVigY5qzO86Huf0OWal", nome: "Eric" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", nome: "Liam" },
  { id: "CwhRBWXzGAHq8TQ4Fs17", nome: "Roger" },
  { id: "EXAVITQu4vr4xnSDxMaL", nome: "Sarah" },
  { id: "XrExE9yKIg1WjnnlVkGX", nome: "Matilda" },
  { id: "Xb7hH8MSUJpSbSDYk0k2", nome: "Alice" },
];

export const chiaveEleven = () => leggiChiave("ELEVENLABS_API_KEY").trim();

let cache = { chiave: "", quando: 0, voci: null };
export async function vociEleven(chiave) {
  if (!chiave) return VOCI_ELEVEN_BASE;
  if (cache.voci && cache.chiave === chiave && Date.now() - cache.quando < 10 * 60 * 1000) return cache.voci;
  try {
    const r = await fetch(`${API}/voices`, { headers: { "xi-api-key": chiave }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`ElevenLabs ${r.status}${r.status === 401 ? " (alla chiave manca il permesso voices_read: restano le voci predefinite)" : ""}`);
    const voci = ((await r.json()).voices || []).map((v) => ({ id: v.voice_id, nome: v.name + (v.category && v.category !== "premade" ? ` (${v.category})` : "") }));
    if (voci.length) { cache = { chiave, quando: Date.now(), voci }; return voci; }
  } catch (e) { console.error("voci ElevenLabs:", e.message); }
  // anche il ripiego resta in cache: una chiave senza il permesso voices_read non deve riprovare a ogni apertura del pannello
  cache = { chiave, quando: Date.now(), voci: VOCI_ELEVEN_BASE };
  return VOCI_ELEVEN_BASE;
}

// Una frase: la Response di fetch, il cui corpo è l'mp3 in streaming. La velocità resta alla pagina
// (playbackRate), come per gli altri motori; la lingua è fissata all'italiano dove il modello lo accetta.
export function parlaEleven({ chiave, voce, modello, testo, segnale }) {
  const corpo = { text: String(testo || "").slice(0, 3000), model_id: modello };
  if (/flash_v2_5|turbo_v2_5/.test(modello)) corpo.language_code = "it"; // sui v4 language_code non è verificato: decide il testo
  return fetch(`${API}/text-to-speech/${encodeURIComponent(voce)}/stream?output_format=mp3_44100_128`, {
    method: "POST", signal: segnale,
    headers: { "xi-api-key": chiave, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify(corpo),
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const k = chiaveEleven();
  if (!k) { console.log("ELEVENLABS_API_KEY: assente (ambiente, file delle chiavi o chiavi.env dello stato)"); process.exit(1); }
  const v = await vociEleven(k);
  console.log(`ELEVENLABS_API_KEY: presente · voci viste: ${v.length}${v === VOCI_ELEVEN_BASE ? " (lista di riserva: /v1/voices non ha risposto)" : ""}`);
}
