// Il battito e le proposte dell'assistente (logica in server/battito.mjs; i segnali di dominio li offrono i moduli).
//   GET/POST /api/battito · POST /api/battito/ora · GET/POST /api/proposte · POST /api/proposte/foglio · POST /api/proposte/:id/si|no|dopo
import { battitoOra, impostaBattito, nuovaProposta, rispondi, statoBattito, statoProposte } from "../battito.mjs";
import { trasmetti } from "../eventi.mjs";

// Il contesto che battito.mjs riceve: come prima, più i segnali dei moduli (funzioni che danno i segnali del momento).
export function contestoBattito({ cfg, persona, cockpit, fogli, moduli, ctxModulo }) {
  const segnali = moduli.filter((m) => typeof m.segnaliBattito === "function")
    .map((m) => (adesso = Date.now()) => m.segnaliBattito({ ...ctxModulo(m), adesso }) || []);
  return { root: cfg.cartella, cfg, cockpit, persona, trasmetti, assicuraFoglio: fogli.assicuraProposte, segnali };
}

export function rotte({ cfg, ctxBattito, fogli }) {
  const root = cfg.cartella;
  const annuncia = (extra = {}) => trasmetti({ type: "cockpit_proposte", azione: "battito", ...extra, ...statoProposte(root) });
  return [
    { metodo: "GET", percorso: "/api/battito", gestore: () => ({ battito: statoBattito(root) }) },
    {
      metodo: "POST", percorso: "/api/battito",
      async gestore(c) {
        const b = impostaBattito(root, await c.corpo());
        if (b.acceso) fogli.assicuraProposte();
        annuncia();
        return { battito: b };
      },
    },
    {
      metodo: "POST", percorso: "/api/battito/ora",
      gestore() { const r = battitoOra(ctxBattito, { forza: true }); annuncia({ esito: r.esito }); return r; },
    },
    { metodo: "GET", percorso: "/api/proposte", gestore: () => statoProposte(root) },
    { metodo: "POST", percorso: "/api/proposte", gestore: async (c) => ({ proposta: nuovaProposta(ctxBattito, await c.corpo()) }) },
    { metodo: "POST", percorso: "/api/proposte/foglio", gestore: () => ({ foglio: fogli.assicuraProposte() }) },
    { metodo: "POST", percorso: /^\/api\/proposte\/([\w\-]+)\/(si|no|dopo)$/, gestore: (c) => ({ proposta: rispondi(ctxBattito, c.parametri[0], c.parametri[1]) }) },
  ];
}
