// I fogli sopra la mappa (logica in server/fogli.mjs).
//   GET/POST /api/fogli · GET /api/fogli/:id/testo?max=N · POST /api/fogli/:id/agente · POST /api/fogli/:id/chiudi · DELETE /api/fogli/:id
export function rotte({ fogli }) {
  return [
    { metodo: "GET", percorso: "/api/fogli", gestore: () => ({ fogli: fogli.elenco() }) },
    { metodo: "POST", percorso: "/api/fogli", gestore: async (c) => ({ foglio: fogli.crea(await c.corpo()) }) },
    {
      // il solo testo di un foglio, per chi non può leggerlo da sé (ctl.mjs foglio leggi): include i tipi dei moduli
      metodo: "GET", percorso: "/api/fogli/:id/testo",
      gestore(c) {
        const max = Number(c.url.searchParams.get("max")) || Infinity;
        const { foglio, testo, lunghezza, troncato } = fogli.testo(c.parametri.id, max);
        return { foglio, testo, lunghezza, troncato };
      },
    },
    { metodo: "POST", percorso: "/api/fogli/:id/agente", gestore: (c) => ({ sessione: fogli.agente(c.parametri.id) }) },
    { metodo: "POST", percorso: "/api/fogli/:id/chiudi", gestore: (c) => { fogli.chiudi(c.parametri.id); return {}; } },
    { metodo: "DELETE", percorso: "/api/fogli/:id", gestore: (c) => { fogli.chiudi(c.parametri.id); return {}; } },
  ];
}
