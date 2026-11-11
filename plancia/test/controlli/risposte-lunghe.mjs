// Una risposta a parole alla casella «Da decidere» arriva intera a chi ha chiesto, con i suoi a capo; oltre il tetto il server
// risponde con un errore e la domanda resta aperta, la pagina avvisa e non manda. Il tetto è uno solo e lo dà il server: una
// pagina nuova davanti a un server acceso da prima (che non lo dà, e taglierebbe a 280) non manda oltre quel taglio.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const D = { "x-dashboard": "1" };

export default async function (t) {
  const s = await t.avviaServer({});
  const post = (p, corpo) => t.post(s.base, p, corpo, D);
  const domande = async () => (await t.get(s.base, "/api/domande?tutte=1", D)).json();
  const ctl = (args, sessione = "") => t.ctl(args, { COCKPIT_STATO: s.stato, ...(sessione ? { COCKPIT_SESSIONE: sessione } : {}) });
  const chiedi = (testo, sessione = "prova") => { t.ok(ctl(["domanda", testo], sessione).codice === 0, `ctl domanda «${testo}»`); };
  const trova = (j, testo) => j.aperte.find((q) => q.testo === testo);

  t.ok(ctl(["crea", "prova", "un compito di prova"]).codice === 0, "crea l'agente prova");
  t.ok((await domande()).limiti?.libera === 4000, "GET /api/domande dà il tetto della risposta a parole: 4000");

  // 3000 battute su due paragrafi: intere nel messaggio [domanda], nella risposta salvata e in ctl domande
  chiedi("Quale campagna?");
  const lunga = `${"a".repeat(1500)}\n\n${"b".repeat(1498)}`;
  const q = trova(await domande(), "Quale campagna?");
  const r = await post(`/api/domande/${q.id}/risposta`, { risposta: lunga, come: "libera" });
  t.ok(r.codice === 200 && r.json().domanda?.risposta === lunga, `3000 battute salvate intere (${r.json().domanda?.risposta?.length})`);
  const ev = (await t.get(s.base, "/api/sessioni/prova/eventi", D)).json().eventi;
  const msg = ev.find((e) => e.type === "cockpit_utente" && e.origine === "domanda" && e.testo.startsWith("[domanda]") && e.testo.includes(q.id));
  t.ok(msg?.testo.endsWith(`(${q.id}): ${lunga}`), `il messaggio [domanda] porta la risposta intera, con gli a capo (${msg?.testo.length} battute)`);
  t.ok(ctl(["domande", "--tutte"]).out.includes(lunga), "ctl domande --tutte la stampa intera");

  // gli a capo restano; spazi e righe vuote in eccesso no
  chiedi("E gli a capo?");
  const qa = trova(await domande(), "E gli a capo?");
  const ra = await post(`/api/domande/${qa.id}/risposta`, { risposta: "  primo   punto \r\n\r\n\r\n\r\n secondo\npunto  ", come: "libera" });
  t.ok(ra.json().domanda?.risposta === "primo punto\n\nsecondo\npunto", `a capo tenuti, il resto ripulito: ${JSON.stringify(ra.json().domanda?.risposta)}`);

  // sul tetto passa, un carattere sopra no: errore, nessun messaggio, domanda aperta
  chiedi("Sul tetto?");
  const qt = trova(await domande(), "Sul tetto?");
  const oltre = await post(`/api/domande/${qt.id}/risposta`, { risposta: "x".repeat(4001), come: "libera" });
  t.ok(oltre.codice === 400 && /troppo lunga.*4001.*4000/.test(oltre.json().errore || ""), `4001 battute: errore (${oltre.codice} ${oltre.json().errore})`);
  const dopo = await domande();
  t.ok(trova(dopo, "Sul tetto?")?.stato === "aperta", "rifiutata, la domanda resta aperta");
  const evDopo = (await t.get(s.base, "/api/sessioni/prova/eventi", D)).json().eventi;
  t.ok(!evDopo.some((e) => e.type === "cockpit_utente" && e.testo.includes(qt.id)), "rifiutata, nessun messaggio alla sessione");
  const giusta = await post(`/api/domande/${qt.id}/risposta`, { risposta: "x".repeat(4000), come: "libera" });
  t.ok(giusta.codice === 200 && giusta.json().domanda?.risposta.length === 4000, "4000 battute passano");

  // una proposta si risponde come prima
  const p = (await post("/api/domande", { testo: "Sì o no?", opzioni: "Sì|No" })).json().domanda;
  t.ok((await post(`/api/domande/${p.id}/risposta`, { risposta: "Sì" })).json().domanda?.come === "opzione", "un'opzione resta un'opzione");

  // la pagina: un campo su più righe senza maxlength, che il browser userebbe per tagliare in silenzio incolla e dettato
  const pagina = path.join(t.plancia, "pagine", "condivisi", "domande.js");
  const url = JSON.stringify(pathToFileURL(pagina).href);
  const prova = `
    const { D, htmlDomanda, limiteRisposta, avvisoLunghezza } = await import(${url});
    const q = { id: "d-1", tipo: "domanda", testo: "Quale?", da: { sessione: "s", nome: "n", ruolo: "agente" }, opzioni: [], stato: "aperta", creata: new Date().toISOString() };
    D.stato = { aperte: [q], limiti: { libera: 4000 } };
    const nuovo = { html: htmlDomanda(q), max: limiteRisposta(), sotto: avvisoLunghezza(4000), sopra: avvisoLunghezza(4001) };
    D.stato = { aperte: [q] };
    const vecchio = { max: limiteRisposta(), sotto: avvisoLunghezza(280), sopra: avvisoLunghezza(281) };
    console.log(JSON.stringify({ nuovo, vecchio }));`;
  const e = spawnSync(process.execPath, ["--input-type=module", "-e", prova], { encoding: "utf8" });
  let k = {};
  try { k = JSON.parse(e.stdout); } catch { t.ok(false, `la pagina non si prova in Node: ${e.stderr.slice(0, 400)}`); }
  t.ok(/<textarea class="dq-lib"/.test(k.nuovo?.html || "") && !/maxlength/.test(k.nuovo?.html || ""), "la risposta si scrive in una textarea senza maxlength");
  t.ok(k.nuovo?.max === 4000 && !k.nuovo.sotto && /4001.*4000/.test(k.nuovo.sopra), `server nuovo: il tetto viene dal server, oltre si avvisa (${k.nuovo?.sopra})`);
  t.ok(k.vecchio?.max === 280 && !k.vecchio.sotto && /281.*280.*Riavvia/.test(k.vecchio.sopra), `server acceso da prima: la pagina si ferma al suo taglio e lo dice (${k.vecchio?.sopra})`);
  const src = readFileSync(pagina, "utf8"), chat = readFileSync(path.join(t.plancia, "pagine", "cockpit", "chat.js"), "utf8");
  t.ok(/\.dq-corpo\{[^}]*grid-template-columns:minmax\(0,1fr\)/.test(src), "un testo lungo non allarga la scheda oltre la tendina (la textarea cresce col contenuto)");
  t.ok(/querySelectorAll\("button, textarea"\)/.test(src) && !/querySelectorAll\("button, input"\)/.test(src), "durante l'invio si blocca anche la textarea");
  t.ok(/e\.key === "Enter" && !e\.shiftKey && !e\.isComposing/.test(src), "Invio manda, Maiusc+Invio va a capo, come nella chat");
  t.ok(/segnaLimite\(/.test(chat) && (src.match(/segnaLimite\(/g) || []).length >= 3, "l'avviso sulla lunghezza sopravvive ai ridisegni di tendina e chat");
}
