// Le sfere spostate a mano sulla mappa del cockpit: la posizione in punti della mappa, per chiave stabile
// (pagine/cockpit/raggiera.js, chiavePosto: "tu", "assistente", "squadra:<nome>" per i ruoli della squadra, "s:<id>" per gli
// altri). Sul server e non nel browser, come i fogli: valgono per ogni browser della persona. Stato in <stato>/posti.json.
//   GET /api/posti → { posti: { chiave: { x, y } } } (senza le sessioni che non ci sono più)
//   POST /api/posti { chiave, x, y } · POST /api/posti/riordina { chiave } (solo quella) o {} (tutte: torna il layout automatico)
import { negozio } from "../stato.mjs";

const CHIAVE = /^(tu|assistente|squadra:[a-z0-9àèéìòù-]{1,32}|s:[a-z0-9-]{1,40})$/;
const LIMITE = 1e5; // punti della mappa: oltre, è un valore rotto

export function rotte({ cockpit }) {
  const memoria = negozio("posti", { base: { posti: {} } });
  // una sessione rimossa perde la sua posizione: la persona e l'assistente restano sempre
  const vive = () => new Set(["tu", "assistente", ...cockpit.elenco().map((s) => s.ruolo === "squadra" ? `squadra:${s.nome}` : `s:${s.id}`)]);
  const pota = (d) => {
    const v = vive();
    for (const k of Object.keys(d.posti || {})) if (!v.has(k)) delete d.posti[k];
  };
  return [
    {
      metodo: "GET", percorso: "/api/posti",
      async gestore() {
        const d = memoria.leggi(); d.posti ||= {};
        const prima = Object.keys(d.posti).length; pota(d);
        if (Object.keys(d.posti).length !== prima) await memoria.aggiorna(pota);
        return { posti: d.posti };
      },
    },
    {
      metodo: "POST", percorso: "/api/posti",
      async gestore(c) {
        const b = await c.corpo(), chiave = String(b.chiave || ""), x = Number(b.x), y = Number(b.y);
        if (!CHIAVE.test(chiave)) throw new Error(`chiave non valida: ${chiave.slice(0, 60)}`);
        if (![x, y].every((n) => Number.isFinite(n) && Math.abs(n) <= LIMITE)) throw new Error("x e y: numeri entro 100.000");
        const d = await memoria.aggiorna((d) => { d.posti ||= {}; d.posti[chiave] = { x: Math.round(x), y: Math.round(y) }; pota(d); });
        return { posti: d.posti };
      },
    },
    {
      metodo: "POST", percorso: "/api/posti/riordina",
      async gestore(c) {
        const b = await c.corpo(), chiave = b.chiave === undefined ? null : String(b.chiave);
        const d = await memoria.aggiorna((d) => { if (chiave === null) d.posti = {}; else delete (d.posti ||= {})[chiave]; });
        return { posti: d.posti };
      },
    },
  ];
}
