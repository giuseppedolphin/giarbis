// La trascrizione di un audio (i vocali di Telegram). Prima whisper.cpp sul Mac, se c'è: ffmpeg converte l'audio in wav mono a
// 16 kHz in una cartella temporanea, whisper-cli lo trascrive in italiano, la cartella si cancella. I percorsi vengono da
// telegram.whisper della config ({ cli, modello, ffmpeg, secondi }; false = spento), i predefiniti solo se i file esistono;
// senza, il servizio si salta in silenzio. Poi ElevenLabs speech-to-text (POST /v1/speech-to-text, modello Scribe), e se manca
// la chiave o la chiamata fallisce OpenAI (POST /v1/audio/transcriptions, whisper-1). Lingua fissata all'italiano. Le chiavi
// sono ELEVENLABS_API_KEY e OPENAI_API_KEY, lette da config.chiave() come per la voce; mai stampate. ELEVENLABS_API e OPENAI_API
// sostituiscono gli indirizzi nelle prove (come TELEGRAM_API): nessun servizio vero nel fumo.
//
//   const { testo, servizio } = await trascrivi({ audio, nome, tipo });   // audio: Buffer; errore se nessun servizio riesce
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chiave, config } from "./config.mjs";
import { temporanea } from "./stato.mjs";

const SECONDI = 60;
const base = (variabile, predefinita) => String(process.env[variabile] || predefinita).replace(/\/+$/, "");

async function chiamata(url, chiaveApi, intestazione, campi, audio, nome, tipo) {
  const corpo = new FormData();
  for (const [k, v] of Object.entries(campi)) corpo.append(k, v);
  corpo.append("file", new Blob([audio], { type: tipo }), nome);
  const r = await fetch(url, { method: "POST", headers: { [intestazione]: chiaveApi }, body: corpo, signal: AbortSignal.timeout(SECONDI * 1000) });
  let j = {};
  try { j = await r.json(); } catch { /* non JSON: vale lo stato HTTP */ }
  if (!r.ok) throw new Error(`HTTP ${r.status}${j.detail?.message || j.error?.message ? `: ${String(j.detail?.message || j.error?.message).slice(0, 120)}` : ""}`);
  const testo = String(j.text ?? "").trim();
  if (!testo) throw new Error("trascrizione vuota");
  return testo;
}

// whisper.cpp in locale: su un M1 col modello large-v3-turbo un vocale di 30 s si trascrive in circa 6 s, uno di 300 s in 35 s
const SECONDI_LOCALE = 120;
const PREDEFINITI = { cli: "/opt/homebrew/bin/whisper-cli", modello: path.join(os.homedir(), "ggml-large-v3-turbo.bin"), ffmpeg: "/opt/homebrew/bin/ffmpeg" };

// i percorsi del servizio locale, o null se è spento o manca un file (si salta in silenzio)
function whisper() {
  const w = config().telegram?.whisper;
  if (w === false) return null;
  const p = { cli: w?.cli || PREDEFINITI.cli, modello: w?.modello || PREDEFINITI.modello, ffmpeg: w?.ffmpeg || PREDEFINITI.ffmpeg, secondi: w?.secondi || SECONDI_LOCALE };
  return [p.cli, p.modello, p.ffmpeg].every((f) => existsSync(f)) ? p : null;
}

// un programma con un termine comune ai due passi; l'errore porta l'ultima riga di stderr
function esegui(chi, file, argomenti, fine, secondi) {
  return new Promise((ok, no) => {
    execFile(file, argomenti, { timeout: Math.max(1, fine - Date.now()), killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (e, out, err) => {
      if (!e) return ok(String(out));
      if (e.killed || e.signal) return no(new Error(`nessuna risposta in ${secondi} s`));
      const riga = String(err || "").trim().split("\n").pop() || e.message;
      no(new Error(`${chi}: ${riga.slice(0, 120)}`));
    });
  });
}

async function locale(w, audio, nome) {
  const tmp = await temporanea("plancia-vocale");
  try {
    const ingresso = await tmp.scrivi(`vocale${(path.extname(nome) || ".ogg").replace(/[^.\w]/g, "")}`, audio), wav = path.join(tmp.dir, "vocale.wav");
    const fine = Date.now() + w.secondi * 1000;
    await esegui("ffmpeg", w.ffmpeg, ["-nostdin", "-loglevel", "error", "-y", "-i", ingresso, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav], fine, w.secondi);
    const out = await esegui("whisper", w.cli, ["-m", w.modello, "-f", wav, "-l", "it", "-nt", "-np"], fine, w.secondi);
    const testo = out.replace(/\[BLANK_AUDIO\]/g, " ").replace(/\s+/g, " ").trim();
    if (!testo) throw new Error("trascrizione vuota");
    return testo;
  } finally { await tmp.togli(); }
}

const SERVIZI = [
  { nome: "Whisper locale", pronto: whisper, fai: (w, a, n) => locale(w, a, n) },
  { nome: "ElevenLabs", chiave: "ELEVENLABS_API_KEY", fai: (k, a, n, t) => chiamata(`${base("ELEVENLABS_API", "https://api.elevenlabs.io")}/v1/speech-to-text`, k, "xi-api-key", { model_id: "scribe_v1", language_code: "ita", tag_audio_events: "false" }, a, n, t) },
  { nome: "OpenAI", chiave: "OPENAI_API_KEY", fai: (k, a, n, t) => chiamata(`${base("OPENAI_API", "https://api.openai.com")}/v1/audio/transcriptions`, `Bearer ${k}`, "authorization", { model: "whisper-1", language: "it" }, a, n, t) },
];

export async function trascrivi({ audio, nome = "vocale.ogg", tipo = "audio/ogg" }) {
  const guasti = [];
  for (const s of SERVIZI) {
    if (s.pronto) {
      const w = s.pronto();
      if (!w) continue;
      try { return { testo: await s.fai(w, audio, nome, tipo), servizio: s.nome }; }
      catch (e) { guasti.push(`${s.nome}: ${e.message}`); continue; }
    }
    const k = chiave(s.chiave).trim();
    if (!k) { guasti.push(`${s.nome}: nessuna chiave`); continue; }
    try { return { testo: await s.fai(k, audio, nome, tipo), servizio: s.nome }; }
    catch (e) { guasti.push(`${s.nome}: ${(e.name === "TimeoutError" ? `nessuna risposta in ${SECONDI} s` : e.message).split(k).join("***")}`); }
  }
  throw new Error(guasti.join("; "));
}
