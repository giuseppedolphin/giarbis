// Le sessioni del cockpit (un processo `claude -p` ciascuna, gestito da server/sessioni.mjs).
//   GET/POST /api/sessioni · GET …/eventi · POST …/messaggio|ferma|letta|rimuovi|nuova|progresso|modello
// Chi crea (genitore), chi scrive (mittente) e chi toglie (da) li dice il token della sessione, non il corpo (identita.mjs).
import { MODELLI, MODELLO_DEFAULT } from "../modelli.mjs";
import { controllaMittente } from "../catena.mjs";
import { corpoDi, soloSeStessa } from "../identita.mjs";

export function rotte(nucleo) {
  const { cockpit, persona } = nucleo;
  const pubblica = (s) => cockpit.elenco().find((x) => x.id === s.id);
  // Risolve la sessione dal nome o dall'id; senza, 404. Il gestore riceve la sessione dopo il contesto.
  const conSessione = (gestore) => async (c) => {
    const chiave = c.parametri.chiave;
    const s = cockpit.trova(chiave);
    if (!s) return c.json(404, { ok: false, errore: `nessuna sessione "${chiave}"` });
    return gestore(c, s);
  };
  const POST = (azione, gestore) => ({ metodo: "POST", percorso: `/api/sessioni/:chiave/${azione}`, gestore: conSessione(gestore) });

  return [
    { metodo: "GET", percorso: "/api/sessioni", gestore: () => ({ sessioni: cockpit.elenco(), modelli: MODELLI, modelloDefault: MODELLO_DEFAULT }) },
    {
      metodo: "POST", percorso: "/api/sessioni",
      async gestore(c) {
        const b = await corpoDi(c, nucleo, "genitore");
        const s = cockpit.crea({ nome: b.nome, compito: b.compito, modello: b.modello, genitore: b.genitore || "" });
        return { sessione: pubblica(s) };
      },
    },
    { metodo: "GET", percorso: "/api/sessioni/:chiave/eventi", gestore: conSessione((c, s) => ({ sessione: pubblica(s), eventi: cockpit.eventi(s.id) })) },
    POST("messaggio", async (c, s) => {
      const b = await corpoDi(c, nucleo, "mittente");
      const mittente = b.mittente ? cockpit.trova(b.mittente) : null;
      controllaMittente(cockpit, mittente, s); // un usa e getta scrive solo a chi l'ha creato e ai suoi
      cockpit.invia(s.id, b.testo, {
        allegati: b.allegati,
        origine: b.origine === "widget" ? "widget" : mittente ? "agente" : undefined,
        mittente: mittente ? mittente.nome : persona.slug || "tu",
      });
      return { sessione: pubblica(s) };
    }),
    POST("ferma", (c, s) => ({ esito: cockpit.ferma(s.id) })), // interrotto | chiuso (a sessione ferma: solo il processo) | nessun processo
    POST("letta", (c, s) => { cockpit.letta(s.id); return {}; }),
    POST("modello", async (c, s) => {
      const r = cockpit.cambiaModello(s.id, (await c.corpo()).modello);
      return { sessione: pubblica(s), applicato: r.applicato };
    }),
    POST("progresso", async (c, s) => { soloSeStessa(c, nucleo, s); return { progresso: cockpit.progresso(s.id, await c.corpo()) }; }),
    POST("nuova", (c, s) => { cockpit.nuovaConversazione(s.id); return {}; }),
    POST("rimuovi", async (c, s) => { cockpit.rimuovi(s.id, { da: (await corpoDi(c, nucleo, "da")).da || "" }); return {}; }), // da: chi toglie
  ];
}
