// Chiudere il processo `claude -p` di una sessione senza interrompere un turno. La conversazione resta:
// il processo nuovo lo fa partire il messaggio dopo (invia → avvia, con --resume), che rilegge prompt e connettori claude.ai
// e ritrova i job di CronCreate (conversazioneRipresa). Un processo nato quando i connettori non si collegavano non li
// riprende più da solo: questa è la via per rifarlo, da «spegni» della squadra e dal pulsante della pagina a sessione ferma.
// Lo stato delle chiusure in attesa sta in `cockpit.chiusure` (id → ancora), in memoria: al riavvio del server i processi sono già morti.

// una sessione al lavoro, in compact o con messaggi già scritti al processo: un SIGTERM adesso spezzerebbe un turno
export const occupata = (k, s) => s.stato === "lavora" || s.stato === "avvio" || (k.inCoda.get(s.id) || 0) > 0 || k.turno.get(s.id)?.origine === "compact";

// via il processo adesso: prima dalla tabella (un messaggio che arriva ora ne avvia uno nuovo invece di scrivere a uno che muore), poi il SIGTERM
export function togliProcesso(k, s) {
  const p = k.proc.get(s.id);
  k.chiusure.delete(s.id);
  if (!p) return false;
  k.proc.delete(s.id); k.inCoda.delete(s.id); k.turno.delete(s.id); s.vivo = false;
  try { p.kill("SIGTERM"); } catch { /* già uscito */ }
  k.setStato(s, "ferma");
  return true;
}

// Subito se la sessione è libera; se no a fine turno, e solo se `ancora()` è ancora vero (la squadra: l'agente è ancora spento).
// → "chiuso" | "a fine turno" | "nessun processo"
export function chiudiProcesso(k, s, ancora = () => true) {
  if (!k.proc.has(s.id)) { k.chiusure.delete(s.id); return "nessun processo"; }
  if (!occupata(k, s)) { togliProcesso(k, s); return "chiuso"; }
  k.chiusure.set(s.id, ancora);
  return "a fine turno";
}

// A fine turno (result) e quando la coda si riallinea: chiude se una chiusura aspettava, la coda è vuota e vale ancora.
export function chiusuraDovuta(k, s) {
  const ancora = k.chiusure.get(s.id);
  if (!ancora || (k.inCoda.get(s.id) || 0) > 0) return false;
  k.chiusure.delete(s.id);
  let si = false; try { si = !!ancora(); } catch { /* nel dubbio il processo resta */ }
  return si && togliProcesso(k, s);
}
