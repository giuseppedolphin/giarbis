// Il terminale del cockpit: una shell vera (server/terminale.mjs), aperta solo dalla pagina del cockpit.
//   POST /api/terminali { righe, colonne }            → { id, token, righe, colonne }   (X-Dashboard + Origin della plancia)
//   GET  /api/terminali/:id/stream?token=…            → SSE: { storia, righe, colonne } poi { o: "<output>" }…, { fine, codice }
//   POST /api/terminali/:id/input      { dati }       (header X-Terminale: <token>)
//   POST /api/terminali/:id/dimensioni { righe, colonne }
//   POST /api/terminali/:id/chiudi
//   POST /api/terminali/:id/fine?token=…               (sendBeacon della pagina che si chiude: niente header propri, Origin obbligatoria)
// Oltre all'Host del router, ogni richiesta passa il controllo d'origine: se c'è l'header Origin deve essere la plancia stessa
// (http://127.0.0.1:<porta> o http://localhost:<porta>; un foglio o la lavagna, in iframe sandbox, mandano «null» e sono
// fuori), e se il browser manda Sec-Fetch-Site deve essere «same-origin». La creazione vuole l'Origin presente. Token sbagliato
// o terminale che non c'è: 404, senza dire quale dei due.
import * as T from "../terminale.mjs";
import { origineAmmessa } from "../identita.mjs";

export function rotte({ cfg, porta }) {
  const rifiuta = (c) => c.json(403, { ok: false, errore: "origine non ammessa" });
  const conToken = (gestore, { query = false } = {}) => async (c) => {
    if (!origineAmmessa(c.req, porta, query && c.req.method === "POST")) return rifiuta(c);
    const token = query ? c.url.searchParams.get("token") : c.req.headers["x-terminale"];
    const t = T.trova(c.parametri.id, token);
    if (!t) return c.json(404, { ok: false, errore: "terminale non trovato" });
    return gestore(c, t);
  };
  return [
    {
      metodo: "POST", percorso: "/api/terminali",
      async gestore(c) {
        if (!origineAmmessa(c.req, porta, true)) return rifiuta(c);
        const b = await c.corpo();
        return T.crea({ cartella: cfg.cartella, righe: b.righe, colonne: b.colonne });
      },
    },
    {
      // lo stream non può mandare header (EventSource): il token sta nella query, l'Host e l'origine sono controllati lo stesso
      metodo: "GET", percorso: "/api/terminali/:id/stream", guardia: "locale",
      gestore: conToken((c, t) => { T.collega(t, c.req, c.res); }, { query: true }),
    },
    {
      metodo: "POST", percorso: "/api/terminali/:id/input",
      gestore: conToken(async (c, t) => { const b = await c.corpo(); T.scrivi(t, b.dati); return {}; }),
    },
    {
      metodo: "POST", percorso: "/api/terminali/:id/dimensioni",
      gestore: conToken(async (c, t) => { const b = await c.corpo(); return T.ridimensiona(t, b.righe, b.colonne); }),
    },
    {
      metodo: "POST", percorso: "/api/terminali/:id/chiudi",
      gestore: conToken((c, t) => { T.chiudi(t.id); return {}; }),
    },
    {
      // la pagina che si chiude: sendBeacon non manda X-Dashboard né X-Terminale, quindi token nella query e Origin obbligatoria
      metodo: "POST", percorso: "/api/terminali/:id/fine", guardia: "locale",
      gestore: conToken((c, t) => { T.chiudi(t.id); return {}; }, { query: true }),
    },
  ];
}
