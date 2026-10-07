// Il consumo del piano Claude (finestra di 5 ore e settimana), come lo riporta Claude Code stesso: ogni processo `claude -p` in
// stream-json emette un evento `rate_limit_event` con `rate_limit_info.unifiedWindows.{five_hour,seven_day}.utilization` (0..1)
// e `resetsAt` (secondi). Nessuna credenziale: è l'output del binario ufficiale, che il cockpit legge già.
//
//   registraLimiti(info) → lo chiama sessioni.mjs a ogni evento: salva l'ultima lettura in <stato>/consumo-limiti.json,
//                          e accoda una riga a consumo-limiti.jsonl quando le percentuali cambiano (il widget lo rigenera
//                          consumo-pagina.mjs, col suo timer)
//   leggiLimiti()        → { ultima, storia } per il widget
//   sonda()              → una chiamata minima a Claude Code (Haiku, nessuno strumento) solo per avere una lettura fresca:
//                          consuma un filo di quota, si usa a mano (`node plancia/server/consumo-pagina.mjs --sonda`)
//
// Le funzioni accettano ancora un primo argomento `root` davanti agli altri e lo ignorano: transitorio, per chi le chiama
// con la firma di prima; si toglie quando tutti i chiamanti sono passati alla nuova.
import { spawnSync } from "node:child_process";
import { config } from "./config.mjs";
import { negozio, registro } from "./stato.mjs";

const ultimaLettura = () => negozio("consumo-limiti", { base: null });
const storiaLimiti = () => registro("consumo-limiti");

export function registraLimiti(...argomenti) {
  const info = argomenti[argomenti.length - 1];
  const w = info?.unifiedWindows;
  if (!w) return;
  const riga = {
    t: Date.now(),
    stato: info.status || "",
    cinque: w.five_hour ? { u: w.five_hour.utilization, reset: w.five_hour.resetsAt } : null,
    sette: w.seven_day ? { u: w.seven_day.utilization, reset: w.seven_day.resetsAt } : null,
  };
  const n = ultimaLettura();
  const prima = n.leggi();
  n.scrivi(riga);
  if (!prima || prima.cinque?.u !== riga.cinque?.u || prima.sette?.u !== riga.sette?.u || prima.sette?.reset !== riga.sette?.reset) {
    storiaLimiti().aggiungi(riga);
  }
}

export function leggiLimiti() {
  return { ultima: ultimaLettura().leggi(), storia: storiaLimiti().leggi() };
}

export function sonda() {
  const r = spawnSync("claude", ["-p", "rispondi solo: ok", "--model", "haiku", "--output-format", "stream-json", "--verbose", "--tools", "", "--no-session-persistence"], {
    cwd: config().cartella, encoding: "utf8", timeout: 90000, stdio: ["ignore", "pipe", "pipe"],
  });
  for (const l of String(r.stdout || "").split("\n")) {
    try { const ev = JSON.parse(l); if (ev.type === "rate_limit_event") { registraLimiti(ev.rate_limit_info); return true; } } catch { /* righe non JSON */ }
  }
  return false;
}
