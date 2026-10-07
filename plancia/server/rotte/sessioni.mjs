// Le sessioni del cockpit (un processo `claude -p` ciascuna, gestito da server/sessioni.mjs).
//   GET/POST /api/sessioni · GET …/eventi · POST …/messaggio|ferma|letta|rimuovi|nuova|progresso|modello
import { MODELLI, MODELLO_DEFAULT } from "../modelli.mjs";

export function rotte({ cockpit, persona }) {
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
        const b = await c.corpo();
        const s = cockpit.crea({ nome: b.nome, compito: b.compito, modello: b.modello, genitore: b.genitore || "" });
        return { sessione: pubblica(s) };
      },
    },
    { metodo: "GET", percorso: "/api/sessioni/:chiave/eventi", gestore: conSessione((c, s) => ({ sessione: pubblica(s), eventi: cockpit.eventi(s.id) })) },
    POST("messaggio", async (c, s) => {
      const b = await c.corpo();
      const mittente = b.mittente ? cockpit.trova(b.mittente) : null;
      cockpit.invia(s.id, b.testo, {
        allegati: b.allegati,
        origine: b.origine === "widget" ? "widget" : mittente ? "agente" : undefined,
        mittente: mittente ? mittente.nome : persona.slug || "tu",
      });
      return { sessione: pubblica(s) };
    }),
    POST("ferma", (c, s) => { cockpit.ferma(s.id); return {}; }),
    POST("letta", (c, s) => { cockpit.letta(s.id); return {}; }),
    POST("modello", async (c, s) => {
      const r = cockpit.cambiaModello(s.id, (await c.corpo()).modello);
      return { sessione: pubblica(s), applicato: r.applicato };
    }),
    POST("progresso", async (c, s) => ({ progresso: cockpit.progresso(s.id, await c.corpo()) })),
    POST("nuova", (c, s) => { cockpit.nuovaConversazione(s.id); return {}; }),
    POST("rimuovi", (c, s) => { cockpit.rimuovi(s.id); return {}; }),
  ];
}
