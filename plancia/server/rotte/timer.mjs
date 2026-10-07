// I timer delle sessioni (logica in server/timer.mjs): ogni cambio dice alle pagine di rileggere l'elenco.
//   GET/POST /api/timer · POST /api/timer/:id/scattato|togli · DELETE /api/timer/:id
import * as timer from "../timer.mjs";
import { trasmetti } from "../eventi.mjs";

export function rotte({ cockpit }) {
  const evento = (azione, t) => trasmetti({ type: "cockpit_timer", azione, timer: t });
  return [
    {
      metodo: "GET", percorso: "/api/timer",
      gestore() {
        timer.potaOrfani(cockpit.elenco().map((x) => x.nome));
        return { timer: timer.elenco() };
      },
    },
    { metodo: "POST", percorso: "/api/timer", gestore: async (c) => { const t = timer.aggiungi(await c.corpo()); evento("aggiunto", t); return { timer: t }; } },
    {
      metodo: "POST", percorso: "/api/timer/:id/scattato",
      gestore(c) { const t = timer.scattato(c.parametri.id); evento(t.tolto ? "tolto" : "scattato", t); return { timer: t }; },
    },
    { metodo: "POST", percorso: "/api/timer/:id/togli", gestore: (c) => { const t = timer.togli(c.parametri.id); evento("tolto", t); return { timer: t }; } },
    { metodo: "DELETE", percorso: "/api/timer/:id", gestore: (c) => { const t = timer.togli(c.parametri.id); evento("tolto", t); return { timer: t }; } },
  ];
}
