// I comandi del modulo todo-md per ctl.mjs del nucleo: `todo chiudi|riapri <id>` e `foglio todo`.
// Il contesto c è quello del ctl del nucleo (c.args, c.opz, c.api, c.uso): qui si parla solo col server.
export const comandi = {
  async todo({ args, api, uso }) {
    const [azione, id, ...resto] = args;
    if (!["chiudi", "riapri"].includes(azione) || !id) uso('ctl todo chiudi <id> ["esito"]  |  todo riapri <id>');
    if (azione === "chiudi") {
      const j = await api("POST", "/api/todo/chiudi", { id, esito: resto.join(" ") });
      console.log(`${j.id} fatta: ${j.esito}`);
    } else {
      const j = await api("POST", "/api/todo/riapri", { id });
      console.log(`${j.id} riaperta`);
    }
  },

  async "foglio todo"({ args, opz, api }) {
    const corpo = { tipo: "todo", titolo: args.join(" ") || "To-do" };
    if (opz.descrizione) corpo.descrizione = opz.descrizione;
    const { foglio } = await api("POST", "/api/fogli", corpo);
    console.log(`foglio todo "${foglio.titolo}" sulla mappa (${foglio.id}); chiudi con: ctl chiudi-foglio ${foglio.id}`);
  },
};

export default comandi;
