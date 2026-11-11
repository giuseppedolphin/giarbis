// La catena di chi crea chi. Ogni agente riporta a chi l'ha creato, a qualunque profondità: l'avviso di fine turno va al
// creatore, e all'assistente solo per gli agenti suoi, per quelli lanciati dalla pagina e per quelli il cui creatore non c'è più.
// Un usa e getta (un agente creato da un ruolo della squadra o da un altro usa e getta) sta sotto il ruolo in cima alla sua
// catena: ne usa gli appunti e ne consuma il tetto. Scrive solo a chi l'ha creato e a quelli che ha creato lui.
//
//   genitoreDi(cockpit, s)          → chi l'ha creato, se c'è ancora e non è l'assistente; altrimenti null
//   ruoloInCima(cockpit, s)         → il ruolo della squadra in cima alla catena di un usa e getta (o s stesso, se è un ruolo); null se la catena è rotta
//   discendenti(cockpit, capo)      → gli usa e getta vivi sotto un ruolo, a ogni profondità
//   controllaMittente(cockpit, da, a) → errore se un usa e getta scrive a chi non è il suo creatore né uno dei suoi
//   testoAvviso(risultato, aperte) · avvisoAlCreatore(s, ev, { aperte, persona }) → i testi [cockpit] di fine turno
import { comandoCtl } from "./config.mjs";

const PROFONDITA = 8; // oltre, la catena gira su se stessa (un nome riusato): ci si ferma

export function genitoreDi(cockpit, s) {
  const p = s?.genitore ? cockpit.trova(s.genitore) : null;
  return p && p.id !== s.id && p.ruolo !== "orchestratore" ? p : null;
}

export function ruoloInCima(cockpit, s) {
  let x = s;
  for (let i = 0; x && i < PROFONDITA; i++) {
    if (x.ruolo === "squadra") return x;
    if (!x.usaEGetta) return null;
    x = genitoreDi(cockpit, x);
  }
  return null;
}

export const discendenti = (cockpit, capo) => [...cockpit.sessioni.values()].filter((x) => x.usaEGetta && ruoloInCima(cockpit, x)?.id === capo.id);

export function controllaMittente(cockpit, da, a) {
  if (!da?.usaEGetta || !a || a.id === da.id) return;
  if (a.nome === da.genitore || (a.usaEGetta && a.genitore === da.nome)) return;
  throw new Error(`${da.nome} è un agente usa e getta: scrive solo a chi l'ha creato (${da.genitore || "nessuno"}). Ciò che va oltre il compito lo metti nella tua risposta: a fine turno arriva a ${da.genitore || "chi ti ha creato"}, che lo passa a chi di dovere`);
}

export const esitoTurno = (ev) => (ev.is_error ? "ha chiuso un turno con un errore" : "ha finito un turno");

// Il testo della risposta di un agente nell'avviso [cockpit]: con domande aperte nella casella, senza le righe che finiscono con «?».
export function testoAvviso(risultato, aperte = 0) {
  let t = String(risultato || "");
  if (aperte) t = t.split("\n").filter((r) => !/\?[\s*_)»"”]*$/.test(r.trim())).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return t.slice(0, 2000);
}

// L'avviso a chi ha creato l'agente: la risposta intera (senza le domande aperte, a cui la persona risponde all'agente), e come
// scrivergli o toglierlo.
export function avvisoAlCreatore(s, ev, { aperte = 0, persona = "" } = {}) {
  const ctl = comandoCtl(), chi = s.usaEGetta ? `Il tuo agente usa e getta "${s.nome}"` : `L'agente "${s.nome}", che hai creato tu,`;
  const nota = aperte ? `\n\n${s.nome} ha ${aperte === 1 ? "una domanda aperta" : `${aperte} domande aperte`} nella casella «Da decidere»: ${persona} risponde direttamente a ${s.nome}. Non ripeterle, non riassumerle e non nominarle.` : "";
  return `[cockpit] ${chi} ${esitoTurno(ev)}. La sua ultima risposta:\n${testoAvviso(ev.result, aperte)}${nota}\n\n`
    + `Se ti serve altro gli scrivi con \`${ctl} invia ${s.nome} "…"\`; quando hai il risultato lo togli con \`${ctl} rimuovi ${s.nome}\`.`;
}
