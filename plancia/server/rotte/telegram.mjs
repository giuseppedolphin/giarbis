// Telegram (logica in server/telegram.mjs).
//   GET /api/telegram (stato, mai il token) · GET /api/telegram/messaggi (?n=) · POST /api/telegram ({ testo, gruppo?, sessione? })
//   POST /api/telegram/controlla (un giro adesso: aggiornamenti e domande, anche in prova) · POST /api/telegram/abbina ({ nuovo? })
//   POST /api/telegram/scollega ({ cosa: persona|gruppo })
// Chi scrive lo dice `sessione`, provata dal token della sessione (identita.mjs): solo l'assistente; senza, è la persona.
// Senza token le risposte dicono «spento» e il motivo, mai un errore.
import { corpoDi } from "../identita.mjs";

export function rotte(nucleo) {
  const { telegram } = nucleo;
  return [
    { metodo: "GET", percorso: "/api/telegram", gestore: () => ({ telegram: telegram.stato() }) },
    { metodo: "GET", percorso: "/api/telegram/messaggi", gestore: (c) => telegram.messaggi({ n: Number(c.url.searchParams.get("n")) || 30 }) },
    { metodo: "POST", percorso: "/api/telegram", gestore: async (c) => telegram.scrivi(await corpoDi(c, nucleo, "sessione")) },
    { metodo: "POST", percorso: "/api/telegram/controlla", gestore: async () => ({ ...(await telegram.controlla()), telegram: telegram.stato() }) },
    { metodo: "POST", percorso: "/api/telegram/abbina", gestore: async (c) => telegram.abbina(await c.corpo()) },
    { metodo: "POST", percorso: "/api/telegram/scollega", gestore: async (c) => ({ telegram: await telegram.scollega((await c.corpo()).cosa) }) },
  ];
}
