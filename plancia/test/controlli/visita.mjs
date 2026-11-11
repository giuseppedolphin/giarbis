// La visita guidata (server/visita.mjs, pagine/cockpit/visita.js): compare solo su una plancia senza stato, mai su una già in uso,
// neanche dopo «Nuova conversazione»; chiusa una volta non torna, nemmeno dopo un riavvio.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const D = { "x-dashboard": "1" };

export default async function (t) {
  const stato = async (s) => (await t.get(s.base, "/api/visita", D)).json().visita;

  // plancia nuova: la visita c'è, e resta finché la persona non la chiude, anche dopo un riavvio
  const nuova = t.tmp();
  let s = await t.avviaServer({ COCKPIT_STATO: nuova });
  t.ok((await stato(s)).mostra === true, "stato vuoto: la visita compare");
  await s.chiudi();
  s = await t.avviaServer({ COCKPIT_STATO: nuova });
  t.ok((await stato(s)).mostra === true, "riavviata senza averla vista: compare ancora");
  t.ok((await t.post(s.base, "/api/visita/vista", { come: "boh" }, D)).codice === 400, "un esito sconosciuto: 400");
  t.ok((await t.post(s.base, "/api/visita/vista", { come: "saltata" }, D)).codice === 200, "saltata");
  t.ok((await stato(s)).mostra === false, "saltata: non compare più");
  await s.chiudi();
  s = await t.avviaServer({ COCKPIT_STATO: nuova });
  t.ok((await stato(s)).mostra === false, "saltata e riavviata: non torna");
  await s.chiudi();

  // le chiavi messe a mano prima del primo avvio non fanno una plancia usata
  const conChiavi = t.tmp();
  writeFileSync(path.join(conChiavi, "chiavi.env"), "NIENTE=1\n");
  s = await t.avviaServer({ COCKPIT_STATO: conChiavi });
  t.ok((await stato(s)).mostra === true, "solo chiavi.env nello stato: è nuova");
  await s.chiudi();

  // plancia già in uso che riceve il codice nuovo: stato con sessioni, senza visita.json
  const usata = t.tmp();
  mkdirSync(usata, { recursive: true });
  writeFileSync(path.join(usata, "sessioni.json"), JSON.stringify([{ id: "abc12345", nome: "assistente", ruolo: "orchestratore", modello: "claude-opus-4-5", genitore: "", claudeId: "x", stato: "ferma", creata: "2026-01-01T00:00:00.000Z", aggiornata: "2026-01-01T00:00:00.000Z", ultimo: "", costo: 0, turni: 4, nonLetti: 0 }]));
  s = await t.avviaServer({ COCKPIT_STATO: usata });
  t.ok((await stato(s)).mostra === false, "plancia già in uso: nessuna visita");
  const r = await t.post(s.base, "/api/sessioni/abc12345/nuova", {}, D);
  t.ok(r.codice === 200, `Nuova conversazione (${r.codice})`);
  t.ok((await stato(s)).mostra === false, "dopo Nuova conversazione: nessuna visita");
  await s.chiudi();
  s = await t.avviaServer({ COCKPIT_STATO: usata });
  t.ok((await stato(s)).mostra === false, "plancia già in uso, azzerata e riavviata: nessuna visita");

  // la pagina: parte solo dalla risposta del server e non scrive il nome dell'assistente
  const pagina = readFileSync(path.join(t.plancia, "pagine/cockpit/visita.js"), "utf8");
  t.ok(!/localStorage|memo\.js/.test(pagina), "la pagina non decide dalla memoria del browser");
  t.ok(/catch \{ \/\* server fermo/.test(pagina), "un server che non conosce /api/visita: niente visita, nessun errore");
  t.ok((await t.get(s.base, "/cockpit/visita.js")).codice === 200, "visita.js servito");
  t.ok(/id="m-visita"/.test((await t.get(s.base, "/cockpit")).testo), "il pulsante per riaprirla c'è");
}
