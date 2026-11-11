// La visita guidata (logica in server/visita.mjs, pagina in pagine/cockpit/visita.js).
//   GET /api/visita → { visita: { mostra, vista } } · POST /api/visita/vista { come: finita|saltata }
import * as Visita from "../visita.mjs";

export function rotte() {
  return [
    { metodo: "GET", percorso: "/api/visita", gestore: () => ({ visita: Visita.stato() }) },
    { metodo: "POST", percorso: "/api/visita/vista", gestore: async (c) => ({ visita: await Visita.segna((await c.corpo()).come) }) },
  ];
}
