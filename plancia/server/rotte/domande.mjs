// Le domande alla persona, la casella «Da decidere» (logica in server/domande.mjs).
//   GET /api/domande[?tutte=1&sessione=<nome|id>] · POST /api/domande · POST /api/domande/:id/risposta · POST /api/domande/:id/ritira
//   POST /api/domande/:id/dopo (solo proposte) · POST /api/domande/impostazioni ({ chiudeConChat })
import * as D from "../domande.mjs";
import { statoProposte } from "../battito.mjs";
import { trasmetti } from "../eventi.mjs";
import { corpoDi } from "../identita.mjs";

export function rotte(nucleo) { // chi chiede o ritira (sessione) lo dice il token della sessione (identita.mjs)
  // una risposta a una proposta cambia anche lo stato delle proposte: chi ascolta cockpit_proposte (battito, ctl) lo sa
  const seProposta = (q, azione) => {
    if (q?.tipo === "proposta") trasmetti({ type: "cockpit_proposte", azione, proposta: D.comeProposta(q), ...statoProposte() });
    return q;
  };
  return [
    {
      metodo: "GET", percorso: "/api/domande",
      gestore: (c) => D.elenco({ tutte: c.url.searchParams.get("tutte") === "1", sessione: c.url.searchParams.get("sessione") || "" }),
    },
    { metodo: "POST", percorso: "/api/domande", gestore: async (c) => ({ domanda: D.nuova({ ...(await corpoDi(c, nucleo, "sessione")), tipo: "domanda" }) }) },
    { metodo: "POST", percorso: "/api/domande/impostazioni", gestore: async (c) => ({ impostazioni: D.impostazioni(await c.corpo()) }) },
    {
      metodo: "POST", percorso: "/api/domande/:id/risposta",
      async gestore(c) {
        const b = await c.corpo();
        const q = D.rispondi(c.parametri.id, b.risposta, b.come);
        return { domanda: seProposta(q, q.stato === "rimandata" ? "dopo" : q.risposta === "Sì" ? "si" : "no") };
      },
    },
    { metodo: "POST", percorso: "/api/domande/:id/ritira", gestore: async (c) => ({ domanda: D.ritira(c.parametri.id, { da: (await corpoDi(c, nucleo, "sessione")).sessione || "" }) }) },
    { metodo: "POST", percorso: "/api/domande/:id/dopo", gestore: (c) => ({ domanda: seProposta(D.rimanda(c.parametri.id), "dopo") }) },
  ];
}
