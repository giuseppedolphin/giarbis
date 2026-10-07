// La voce dell'assistente col modello realtime di OpenAI (gpt-realtime-2.1-mini): una connessione WebSocket
// che resta aperta, così ogni frase parte senza rifare l'handshake. Il modello fa da lettore, non da
// assistente: riceve il testo fra <leggi> e lo pronuncia identico. Ogni frase è una risposta "fuori
// conversazione" (conversation: "none"), quindi le frasi non si accumulano nel contesto e non si
// influenzano a vicenda. Le richieste passano in fila, una alla volta: la generazione è molto più
// veloce del parlato, e la pagina prepara la frase dopo mentre suona quella prima.
//
// Le istruzioni del lettore (chi è, cosa fa) stanno in plancia/prompt/lettore.md e le compone il chiamante
// (rotte/voce-impostazioni.mjs) insieme al tono scelto: qui arrivano già intere in `istruzioni`.
//
// Uso (da rotte/voce-impostazioni.mjs):
//   const v = new VoceRealtime(chiave, "gpt-realtime-2.1-mini");
//   v.parla({ testo, voce, istruzioni }, (pcm) => …, (errore) => …)   // pcm: Buffer 16 bit, 24 kHz, mono
export const VOCI_REALTIME = ["alloy", "ash", "ballad", "cedar", "coral", "echo", "marin", "sage", "shimmer", "verse"];

export class VoceRealtime {
  constructor(chiave, modello) {
    this.chiave = chiave; this.modello = modello;
    this.ws = null; this.pronto = null; this.voce = ""; this.istruzioni = "";
    this.fila = []; this.corrente = null;
  }

  // Apre (o riapre) la connessione con voce e istruzioni date. La voce non si cambia a sessione
  // avviata, quindi un cambio di voce chiude e riapre.
  apri(voce, istruzioni) {
    if (this.ws && this.voce === voce && this.istruzioni === istruzioni && this.pronto) return this.pronto;
    this.chiudi();
    this.voce = voce; this.istruzioni = istruzioni;
    const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${this.modello}`, { headers: { Authorization: `Bearer ${this.chiave}` } });
    this.ws = ws;
    this.pronto = new Promise((ok, ko) => {
      const timer = setTimeout(() => ko(new Error("la connessione realtime non risponde")), 10000);
      ws.onopen = () => ws.send(JSON.stringify({ type: "session.update", session: { type: "realtime", output_modalities: ["audio"],
        audio: { output: { voice: voce, format: { type: "audio/pcm", rate: 24000 } } }, instructions: istruzioni } }));
      ws.onmessage = (m) => {
        let e; try { e = JSON.parse(m.data); } catch { return; }
        if (e.type === "session.updated") { clearTimeout(timer); ok(); }
        else this.evento(e);
      };
      ws.onerror = () => { clearTimeout(timer); ko(new Error("errore della connessione realtime")); };
      ws.onclose = () => {
        clearTimeout(timer);
        if (this.ws === ws) { this.ws = null; this.pronto = null; }
        if (this.corrente) { const c = this.corrente; this.corrente = null; c.fine(new Error("connessione chiusa")); this.prossima(); }
      };
    });
    this.pronto.catch(() => { this.chiudi(); });
    return this.pronto;
  }

  chiudi() { if (this.ws) { try { this.ws.close(); } catch {} } this.ws = null; this.pronto = null; }

  parla({ testo, voce, istruzioni }, suPcm, fine) {
    const r = { testo: String(testo || "").slice(0, 3000), voce, istruzioni, suPcm, fine, annullata: false };
    this.fila.push(r);
    if (!this.corrente) this.prossima();
    return () => { r.annullata = true; };
  }

  async prossima() {
    const r = this.fila.shift();
    if (!r) return;
    if (r.annullata) return this.prossima();
    this.corrente = r;
    try {
      await this.apri(r.voce, r.istruzioni);
      r.limite = setTimeout(() => { if (this.corrente === r) { this.corrente = null; r.fine(new Error("la voce non è arrivata in tempo")); this.chiudi(); this.prossima(); } }, 20000);
      this.ws.send(JSON.stringify({ type: "response.create", response: { conversation: "none", output_modalities: ["audio"],
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: `<leggi>${r.testo}</leggi>` }] }] } }));
    } catch (e) {
      this.corrente = null; r.fine(e); this.prossima();
    }
  }

  evento(e) {
    const r = this.corrente;
    if (!r) return;
    if ((e.type === "response.output_audio.delta" || e.type === "response.audio.delta") && !r.annullata) r.suPcm(Buffer.from(e.delta, "base64"));
    else if (e.type === "response.done" || e.type === "error") {
      clearTimeout(r.limite);
      this.corrente = null;
      r.fine(e.type === "error" ? new Error(e.error?.message || "errore realtime") : null);
      this.prossima();
    }
  }
}

// Intestazione WAV per un flusso di lunghezza ignota: il browser lo suona mentre arriva.
export function intestazioneWav(rate = 24000) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(0xffffffff, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(0xffffffff, 40);
  return h;
}
