// Il consumo del piano (server/consumo-pagina.mjs): ultima lettura delle percentuali e stima.
//   GET /api/consumo
import { statoConsumo } from "../consumo-pagina.mjs";

export function rotte() {
  return [{ metodo: "GET", percorso: "/api/consumo", gestore: () => statoConsumo() }];
}
