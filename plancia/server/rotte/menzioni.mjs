// Le menzioni della persona in bacheca e sul ponte (logica in server/menzioni.mjs).
//   GET /api/menzioni → { persona, alias, letto, bacheca: [messaggio], ponte: [messaggio] } (le non lette)
//   POST /api/menzioni/letto ({ dove: "bacheca"|"ponte"|"ponte:<slug>"|"tutto" }) → { letto } (ponte:<slug> = un filo solo)
export function rotte({ menzioni }) {
  return [
    { metodo: "GET", percorso: "/api/menzioni", gestore: () => menzioni.stato() },
    { metodo: "POST", percorso: "/api/menzioni/letto", gestore: async (c) => menzioni.segna(String((await c.corpo()).dove || "")) },
  ];
}
