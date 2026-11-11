// La checklist di primo avvio (logica in server/checklist.mjs; le voci della repo le offrono i moduli col campo `checklist`).
//   GET /api/checklist → l'ultimo controllo, senza rifarlo · POST /api/checklist/controlla → controlla tutte le voci adesso
//   POST /api/checklist/spunta { id, fatto } (voci «spunta», della persona) · POST /api/checklist/verificato { id, esito: ok|no, nota }
//   (voci «assistente») · POST /api/checklist/nascondi { nascosta } · POST /api/checklist/guida → il turno [checklist] all'assistente
export function rotte({ checklist }) {
  return [
    { metodo: "GET", percorso: "/api/checklist", gestore: () => ({ checklist: checklist.stato() }) },
    { metodo: "POST", percorso: "/api/checklist/controlla", gestore: async () => ({ checklist: await checklist.controlla() }) },
    { metodo: "POST", percorso: "/api/checklist/spunta", gestore: async (c) => { const b = await c.corpo(); return { checklist: await checklist.spunta({ id: b.id, fatto: b.fatto !== false }) }; } },
    { metodo: "POST", percorso: "/api/checklist/verificato", gestore: async (c) => { const b = await c.corpo(); return { checklist: await checklist.verificato({ id: b.id, esito: b.esito, nota: b.nota }) }; } },
    { metodo: "POST", percorso: "/api/checklist/nascondi", gestore: async (c) => ({ checklist: await checklist.nascondi((await c.corpo()).nascosta !== false) }) },
    { metodo: "POST", percorso: "/api/checklist/guida", gestore: async () => ({ checklist: await checklist.guida() }) },
  ];
}
