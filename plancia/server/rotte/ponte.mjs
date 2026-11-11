// Il ponte con le plance delle altre persone, un filo per persona (logica in server/ponte.mjs).
//   GET /api/ponte (stato, con `altri`: un filo per persona) · GET /api/ponte/messaggi (?n=&a=<slug>: senza `a`, tutti i fili)
//   POST /api/ponte ({ testo, tipo?, domanda?, urgente?, risposta_a?, a?, sessione? }: `a` = a chi, obbligatorio con più fili
//   salvo per una risposta)
//   POST /api/ponte/controlla (un controllo della coda adesso, anche in prova)
// Chi scrive lo dice `sessione`, provata dal token della sessione (identita.mjs): solo l'assistente; senza, è la persona.
// Senza ponte le risposte hanno `disponibile: false` e il motivo, mai un errore.
import { corpoDi } from "../identita.mjs";

export function rotte(nucleo) {
  const { ponte } = nucleo;
  return [
    { metodo: "GET", percorso: "/api/ponte", gestore: () => ({ ponte: ponte.stato() }) },
    { metodo: "GET", percorso: "/api/ponte/messaggi", gestore: async (c) => ({ ...(await ponte.messaggi({ n: Number(c.url.searchParams.get("n")) || 50, a: c.url.searchParams.get("a") || "" })), ponte: ponte.stato() }) },
    { metodo: "POST", percorso: "/api/ponte", gestore: async (c) => ponte.scrivi(await corpoDi(c, nucleo, "sessione")) },
    { metodo: "POST", percorso: "/api/ponte/controlla", gestore: async () => ({ ...(await ponte.controlla({ forza: true })), ponte: ponte.stato() }) },
  ];
}
