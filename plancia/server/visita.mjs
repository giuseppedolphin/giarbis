// La visita guidata: pochi passi che spiegano il cockpit, alla prima apertura di una plancia nuova (pagine/cockpit/visita.js).
// Chi è nuova lo decide il server una volta sola, a ogni avvio finché il file non c'è: dopo le migrazioni e prima che nasca il
// Cockpit, che crea sessioni.json. Con sessioni.json già nello stato la plancia era in uso: niente visita, né adesso né dopo.
// Un chiavi.env messo a mano prima del primo avvio non conta. Stato in <stato>/visita.json: { nata, mostra, vista, come }.
import { existsSync } from "node:fs";
import { negozio, percorsoStato } from "./stato.mjs";

const COME = ["finita", "saltata"];
const archivio = () => negozio("visita", { base: { nata: null, mostra: false, vista: null, come: "" } });

export async function decidi() {
  const a = archivio();
  if (existsSync(a.file)) return a.leggi();
  const nuova = !existsSync(percorsoStato("sessioni.json"));
  return a.aggiorna((d) => { d.nata = new Date().toISOString(); d.mostra = nuova; });
}

export const stato = () => { const d = archivio().leggi(); return { mostra: !!d.mostra && !d.vista, vista: d.vista || null }; };

// La persona ha chiuso la visita (finita o saltata): non si riapre da sola, su nessun browser. Riaprirla a mano la risegna e basta.
export async function segna(come) {
  if (!COME.includes(come)) throw new Error(`come: ${COME.join(" oppure ")}`);
  await archivio().aggiorna((d) => { d.vista = new Date().toISOString(); d.come = come; });
  return stato();
}
