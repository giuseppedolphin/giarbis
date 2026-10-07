// Quanto è piena la finestra di contesto di una sessione del cockpit, dal flusso stream-json di Claude Code. Lo usa sessioni.mjs;
// la pagina lo legge da `s.contesto` (barretta nella testata della chat, pagine/cockpit/contesto.js).
//
//   token usati  → l'ultimo messaggio dell'assistente della sessione (non dei suoi subagenti): input + lettura e scrittura in cache
//                  + output, cioè quello che il prossimo turno si porta dietro
//   finestra     → `contextWindow` del modello, che Claude Code riporta in `result.modelUsage` a fine turno. Nessuna tabella scritta a mano:
//                  finché il primo turno del modello non si chiude la finestra non è nota e la pagina mostra i soli token. Si conserva
//                  per modello in `s.finestre`, così vale anche dopo un riavvio o un cambio di modello avanti e indietro
//   compattazione → l'evento `system` con `subtype: "compact_boundary"` (trigger auto|manual, token di prima): i token usati
//                  ripartono dal messaggio successivo
export function aggiornaContesto(s, ev) {
  if (ev.type === "assistant" && !ev.parent_tool_use_id && ev.message?.usage) {
    const u = ev.message.usage, modello = ev.message.model || s.contesto?.modello || "";
    if (modello === "<synthetic>") return false;
    const usati = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0);
    s.contesto = { ...s.contesto, usati, modello, finestra: s.finestre?.[modello] || null, t: Date.now() };
    return true;
  }
  if (ev.type === "result" && ev.modelUsage && s.contesto?.modello) {
    const voce = ev.modelUsage[s.contesto.modello];
    if (!voce?.contextWindow) return false;
    s.finestre = { ...s.finestre, [s.contesto.modello]: voce.contextWindow };
    s.contesto = { ...s.contesto, finestra: voce.contextWindow };
    return true;
  }
  if (ev.type === "system" && ev.subtype === "compact_boundary") {
    const m = ev.compact_metadata || {};
    s.contesto = { ...s.contesto, usati: null, t: Date.now(), compattata: { t: Date.now(), trigger: m.trigger || "", prima: m.pre_tokens || null } };
    return true;
  }
  return false;
}
