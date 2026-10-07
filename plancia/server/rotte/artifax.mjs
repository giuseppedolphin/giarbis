// Artifax, il registro di ciò che è stato mostrato (logica in server/artifax.mjs).
//   GET/POST /api/artifax · POST /api/artifax/:id/foglio (lo riapre come foglio)
import { registra, elenco, trova } from "../artifax.mjs";

export function rotte({ fogli }) {
  return [
    { metodo: "GET", percorso: "/api/artifax", gestore: () => ({ artifax: elenco() }) },
    {
      metodo: "POST", percorso: "/api/artifax",
      async gestore(c) {
        const b = await c.corpo();
        return { artifax: registra({ percorso: b.percorso, titolo: b.titolo, descrizione: b.descrizione, da: b.da, origine: b.origine === "pannello" ? "pannello" : "lavagna" }) };
      },
    },
    {
      metodo: "POST", percorso: "/api/artifax/:id/foglio",
      gestore(c) { // riapre come foglio: se ce n'è già uno (anche spento) lo riaccende; il registro non si tocca
        const g = trova(c.parametri.id);
        if (!g) return c.json(404, { ok: false, errore: "nessun artifax con questo id" });
        const senzaFile = !g.percorso && g.tipo !== "tabella";
        const esistente = fogli.elenco().find((x) => (g.percorso ? x.percorso === g.percorso : senzaFile && x.tipo === g.tipo && x.tabella === g.tabella));
        if (esistente) return { foglio: fogli.crea({ id: esistente.id, attiva: true }, { registrare: false }) };
        if (!fogli.tipi[g.tipo] || g.tipo === "proposte") return c.json(400, { ok: false, errore: "audio e video si aprono dalla lavagna, non come foglio" });
        const { tipo, titolo, descrizione, da, percorso, tabella, colonne, righe } = g;
        return { foglio: fogli.crea({ tipo, titolo, descrizione, da, percorso, tabella, colonne, righe }, { registrare: false }) };
      },
    },
  ];
}
