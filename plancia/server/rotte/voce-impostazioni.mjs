// La voce dell'assistente e le impostazioni condivise da dashboard e cockpit (voce e tema scuro/chiaro), fuori da git.
//   GET/POST /api/impostazioni · GET/POST /api/voce
// Tre motori per la voce: "realtime" (gpt-realtime-2.1-mini, connessione aperta, voce dei modelli audio; scelto il 06/10/2026),
// "tts" (gpt-4o-mini-tts, il primo) ed "elevenlabs" (dal 07/10/2026: modello a scelta, voci dell'account lette da /v1/voices).
// Le voci disponibili cambiano col motore; per ElevenLabs sono id, e la pagina mostra i nomi (nomiVoci).
// Le chiavi (OpenAI, ElevenLabs) si leggono con config.chiave() e non si mandano mai alla pagina. GET /api/voce?k=<chiave>
// non può portare l'header X-Dashboard (un <audio src> non lo manda): è "locale" e si difende con la chiave che
// GET /api/impostazioni dà solo a chi manda l'header, così un altro sito non può far spendere la voce.
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import path from "node:path";
import { chiave as leggiChiave, comandoCtl, PLANCIA } from "../config.mjs";
import { negozio } from "../stato.mjs";
import { componi } from "../prompt.mjs";
import { VoceRealtime, VOCI_REALTIME, intestazioneWav } from "../voce-realtime.mjs";
import { chiaveEleven, vociEleven, parlaEleven, MODELLI_ELEVEN, VOCI_ELEVEN_BASE } from "../voce-eleven.mjs";

const VOCI_TTS = ["alloy", "ash", "ballad", "cedar", "coral", "echo", "fable", "marin", "nova", "onyx", "sage", "shimmer", "verse"];
const MODELLO_TTS = process.env.COCKPIT_TTS_MODELLO || "gpt-4o-mini-tts";
const BASE_IMP = { motore: "realtime", voce: "marin", velocita: 1.1, tono: "" };

// Le variabili standard dei prompt (le stesse di sessioni.mjs e dei moduli).
export function variabiliPrompt(cfg, persona) {
  return {
    assistente: cfg.assistente.nome,
    persona: persona.nome || "chi ascolta",
    ctl: comandoCtl(),
    modello_default: cfg.modelli.default,
    mappa: path.relative(cfg.cartella, path.join(PLANCIA, "CLAUDE.md")),
  };
}

export function rotte({ cfg, persona, moduli }) {
  const memoria = negozio("impostazioni", { base: {} });
  const impostazioni = () => { const { versione, ...imp } = memoria.leggi(); return { ...BASE_IMP, ...imp }; };
  const chiaveVoce = randomUUID();
  const variabili = variabiliPrompt(cfg, persona);
  // i testi si rileggono da disco a ogni uso: modificarli non richiede il Riavvia
  const tonoPredefinito = () => componi("voce", variabili, moduli).trim();
  const lettore = () => componi("lettore", variabili, moduli).trim();

  const motori = {
    realtime: { modello: process.env.COCKPIT_REALTIME_MODELLO || "gpt-realtime-2.1-mini", voci: VOCI_REALTIME, predefinita: "marin" },
    tts: { modello: MODELLO_TTS, voci: VOCI_TTS, predefinita: "marin" },
    elevenlabs: {
      modello: MODELLI_ELEVEN[0].id, voci: VOCI_ELEVEN_BASE.map((v) => v.id),
      nomi: Object.fromEntries(VOCI_ELEVEN_BASE.map((v) => [v.id, v.nome])), predefinita: VOCI_ELEVEN_BASE[0].id,
    },
  };
  let realtime = null;

  async function aggiornaVociEleven() {
    const v = await vociEleven(chiaveEleven());
    motori.elevenlabs.voci = v.map((x) => x.id);
    motori.elevenlabs.nomi = Object.fromEntries(v.map((x) => [x.id, x.nome]));
    if (!motori.elevenlabs.voci.includes(motori.elevenlabs.predefinita)) motori.elevenlabs.predefinita = motori.elevenlabs.voci[0];
  }
  const modelloEleven = (imp) => (MODELLI_ELEVEN.some((m) => m.id === imp.modelloEleven) ? imp.modelloEleven : motori.elevenlabs.modello);
  const motoreDi = (imp) => (motori[imp.motore] ? imp.motore : "realtime");

  async function leggiImpostazioni() {
    const imp = impostazioni(), m = motoreDi(imp);
    // per ElevenLabs: le voci dell'account, i modelli, e l'avviso se la chiave manca (senza mai mandare la chiave)
    let eleven = {};
    if (m === "elevenlabs") {
      await aggiornaVociEleven();
      eleven = {
        nomiVoci: motori.elevenlabs.nomi, modelliEleven: MODELLI_ELEVEN, modelloEleven: modelloEleven(imp),
        avviso: chiaveEleven() ? "" : `Manca ELEVENLABS_API_KEY nelle chiavi: finché non c'è, ${cfg.assistente.nome} parla con la voce del browser.`,
      };
    }
    return {
      ...imp, motore: m, voce: motori[m].voci.includes(imp.voce) ? imp.voce : motori[m].predefinita, voci: motori[m].voci,
      motori: Object.keys(motori), tonoPredefinito: tonoPredefinito(), chiaveVoce, ...eleven,
    };
  }

  async function scriviImpostazioni(c) {
    const motore = c.motore && motori[c.motore] ? c.motore : motoreDi(impostazioni());
    if (motore === "elevenlabs" && c.voce !== undefined && !motori.elevenlabs.voci.includes(c.voce)) await aggiornaVociEleven();
    if (c.modelloEleven !== undefined && !MODELLI_ELEVEN.some((m) => m.id === c.modelloEleven)) throw new Error(`modello ElevenLabs sconosciuto: ${c.modelloEleven}`);
    if (c.voce !== undefined && !motori[motore].voci.includes(c.voce)) throw new Error(`voce non disponibile con questo motore: ${c.voce}`);
    if (c.velocita !== undefined && !(Number(c.velocita) >= 0.7 && Number(c.velocita) <= 1.8)) throw new Error("velocità fra 0,7 e 1,8");
    if (c.tema !== undefined && c.tema !== "scuro" && c.tema !== "chiaro") throw new Error("tema: scuro o chiaro");
    const nuove = { ...impostazioni(), motore };
    if (c.voce) nuove.voce = c.voce;
    if (c.modelloEleven) nuove.modelloEleven = c.modelloEleven;
    if (c.velocita !== undefined) nuove.velocita = Math.round(Number(c.velocita) * 100) / 100;
    if (c.tono !== undefined) nuove.tono = String(c.tono).trim().slice(0, 600);
    if (c.tema) nuove.tema = c.tema; // il tema della plancia (interruttore in nav.js); finché nessuno lo sceglie il GET non lo restituisce
    memoria.scrivi(nuove);
    return nuove;
  }

  async function parla(c, testo, richiesta) {
    const imp = impostazioni();
    const motore = motoreDi(imp);
    const voce = motori[motore].voci.includes(richiesta.voce) ? richiesta.voce
      : motori[motore].voci.includes(imp.voce) ? imp.voce : motori[motore].predefinita;
    const tono = imp.tono || tonoPredefinito();
    const abort = new AbortController();
    c.res.on("close", () => { if (!c.res.writableFinished) abort.abort(); });

    if (motore === "elevenlabs") {
      const k = chiaveEleven();
      if (!k) return c.json(501, { ok: false, errore: "manca ELEVENLABS_API_KEY: la pagina usa la voce del browser" });
      let r;
      try { r = await parlaEleven({ chiave: k, voce, modello: modelloEleven(imp), testo, segnale: abort.signal }); }
      catch (e) { return c.json(502, { ok: false, errore: `ElevenLabs: ${e.message}` }); }
      if (!r.ok || !r.body) {
        const t = (await r.text()).slice(0, 200);
        console.error("voce ElevenLabs:", r.status, t);
        return c.json(502, { ok: false, errore: `ElevenLabs ${r.status}: ${t}` });
      }
      const flusso = Readable.fromWeb(r.body);
      flusso.on("error", () => c.res.end());
      return c.invia(200, "audio/mpeg", flusso, { "cache-control": "no-store" });
    }

    const chiave = leggiChiave("OPENAI_API_KEY");
    if (!chiave) return c.json(501, { ok: false, errore: "manca OPENAI_API_KEY: la pagina usa la voce del browser" });
    if (motore === "realtime") {
      // WAV in streaming: intestazione subito, poi il PCM man mano che il modello lo genera
      realtime = realtime && realtime.chiave === chiave ? realtime : new VoceRealtime(chiave, motori.realtime.modello);
      c.res.writeHead(200, { "content-type": "audio/wav", "cache-control": "no-store" });
      c.res.write(intestazioneWav(24000));
      let chiuso = false;
      const annulla = realtime.parla({ testo, voce, istruzioni: `${lettore()} ${tono}` },
        (pcm) => { if (!chiuso) c.res.write(pcm); },
        (e) => { if (e) console.error("voce realtime:", e.message); if (!chiuso) { chiuso = true; c.res.end(); } });
      c.res.on("close", () => { if (!chiuso) { chiuso = true; annulla(); } });
      return;
    }
    const r = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST", headers: { authorization: `Bearer ${chiave}`, "content-type": "application/json" }, signal: abort.signal,
      body: JSON.stringify({ model: MODELLO_TTS, voice: voce, input: String(testo || "").slice(0, 3000), instructions: tono, response_format: "mp3" }),
    });
    if (!r.ok || !r.body) return c.json(502, { ok: false, errore: `OpenAI ${r.status}: ${(await r.text()).slice(0, 200)}` });
    return c.invia(200, "audio/mpeg", Readable.fromWeb(r.body), { "cache-control": "no-store" });
  }

  return [
    { metodo: "GET", percorso: "/api/impostazioni", gestore: async () => leggiImpostazioni() },
    { metodo: "POST", percorso: "/api/impostazioni", gestore: async (c) => scriviImpostazioni(await c.corpo()) },
    {
      // l'mp3 arriva a pezzi mentre il motore lo genera e un <audio> lo suona mentre scarica
      metodo: "GET", percorso: "/api/voce", guardia: "locale",
      async gestore(c) {
        if (c.url.searchParams.get("k") !== chiaveVoce) return c.json(403, { ok: false, errore: "chiave della voce mancante" });
        await parla(c, c.url.searchParams.get("t"), {});
      },
    },
    { metodo: "POST", percorso: "/api/voce", gestore: async (c) => { const b = await c.corpo(); await parla(c, b.testo, b); } },
  ];
}
