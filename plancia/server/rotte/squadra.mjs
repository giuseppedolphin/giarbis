// La squadra di agenti permanenti (logica in server/squadra.mjs, bacheca in server/bacheca.mjs).
//   GET/POST /api/squadra (interruttore, { ruolo, acceso, intervalloMinuti }) · GET /api/squadra/colori (slug → { nome, capo, volto, scuro, chiaro }) · POST /api/squadra/giro ({ ruolo }: un giro adesso)
//   GET/POST /api/squadra/bacheca (?n=&cerca=) · GET /api/squadra/dm (?di=) · GET /api/squadra/dm/:a/:b (?n=) · POST /api/squadra/dm
//   POST /api/squadra/advisor
// Chi scrive lo dice `sessione`, provata dal token della sessione (identita.mjs); senza, è la persona.
import * as B from "../bacheca.mjs";
import { corpoDi } from "../identita.mjs";

export function rotte(nucleo) {
  const { squadra } = nucleo;
  const n = (c, base) => Number(c.url.searchParams.get("n")) || base;
  return [
    { metodo: "GET", percorso: "/api/squadra", gestore: () => ({ squadra: squadra.stato() }) },
    { metodo: "GET", percorso: "/api/squadra/colori", gestore: () => ({ colori: squadra.colori() }) },
    { metodo: "POST", percorso: "/api/squadra", gestore: async (c) => ({ squadra: squadra.imposta(await c.corpo()) }) },
    { metodo: "POST", percorso: "/api/squadra/giro", gestore: async (c) => squadra.giro({ forza: String((await c.corpo()).ruolo || "") }) },
    { metodo: "GET", percorso: "/api/squadra/bacheca", gestore: (c) => ({ messaggi: B.ultimi({ n: n(c, 30), cerca: c.url.searchParams.get("cerca") || "" }) }) },
    { metodo: "POST", percorso: "/api/squadra/bacheca", gestore: async (c) => ({ messaggio: squadra.scriviBacheca(await corpoDi(c, nucleo, "sessione")) }) },
    { metodo: "GET", percorso: "/api/squadra/dm", gestore: (c) => ({ fili: B.fili({ di: c.url.searchParams.get("di") || "" }) }) },
    { metodo: "GET", percorso: "/api/squadra/dm/:a/:b", gestore: (c) => ({ messaggi: B.filo(c.parametri.a, c.parametri.b, { n: n(c, 50) }) }) },
    { metodo: "POST", percorso: "/api/squadra/dm", gestore: async (c) => ({ messaggio: squadra.dm(await corpoDi(c, nucleo, "sessione")) }) },
    { metodo: "POST", percorso: "/api/squadra/advisor", gestore: async (c) => ({ messaggio: squadra.advisor(await corpoDi(c, nucleo, "sessione")) }) },
  ];
}
