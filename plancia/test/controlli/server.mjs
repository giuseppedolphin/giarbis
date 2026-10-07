// Il server (server.mjs, rotte/, fogli.mjs, artifax, timer, consumo, voce): avvia una copia di prova e prova pagine, guardie,
// /api/chi, sessioni, fogli, lavagna e allegati, timer, artifax, impostazioni, consumo, battito, server.json.
// Mai la voce con una chiave vera (farebbe una chiamata a pagamento) e mai un messaggio che lancerebbe un processo claude.
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";

const D = { "x-dashboard": "1" };
const JSON_ = { ...D, "content-type": "application/json" };

export default async function (t) {
  const s = await t.avviaServer({});
  const get = (p, h = D) => t.get(s.base, p, h);
  const post = (p, corpo, h = D) => t.post(s.base, p, corpo, h);
  const del = (p, h = D) => t.richiesta(s.base, "DELETE", p, h);

  // ───── pagine ─────
  for (const p of ["/cockpit", "/cockpit/main.js", "/cockpit/stile.css", "/nav.js", "/widget.js"]) {
    const r = await get(p, {});
    t.ok(r.codice === 200, `GET ${p}: ${r.codice} (atteso 200)`);
  }
  t.ok((await get("/nav.js", {})).header["content-type"].startsWith("text/javascript"), "nav.js servito come javascript");
  t.ok((await get("/cockpit/non-esiste.js", {})).codice === 404, "una pagina che non c'è dà 404");
  t.ok((await get("/cockpit/..%2Fserver%2Fserver.mjs", {})).codice !== 200, "il percorso non esce dalla cartella delle pagine");
  t.ok((await get("/moduli/non-acceso/pagina.js", {})).codice === 404, "un modulo non acceso non serve pagine");
  const radice = await get("/", {});
  t.ok(radice.codice === 200 || radice.codice === 302, `GET /: ${radice.codice} (200 con un modulo, 302 al cockpit senza)`);

  // ───── guardie ─────
  t.ok((await t.get(s.base, "/cockpit", { host: "esempio.test" })).codice === 403, "Host sbagliato: 403");
  t.ok((await t.get(s.base, "/api/fogli", { host: "esempio.test", ...D })).codice === 403, "Host sbagliato anche con X-Dashboard: 403");
  t.ok((await get("/api/fogli", {})).codice === 403, "GET /api/fogli senza X-Dashboard: 403");
  t.ok((await get("/api/impostazioni", {})).codice === 403, "GET /api/impostazioni senza X-Dashboard: 403 (dava la chiave della voce)");
  t.ok((await get("/api/chi", {})).codice === 403, "GET /api/chi senza X-Dashboard: 403");
  t.ok((await post("/api/fogli", { tipo: "tabella" }, {})).codice === 403, "POST /api/fogli senza X-Dashboard: 403");
  t.ok((await get("/api/voce?k=sbagliata", {})).codice === 403, "GET /api/voce con la chiave sbagliata: 403");
  t.ok((await get("/api/non-esiste")).codice === 404, "una /api/ che non c'è dà 404");
  t.ok((await get("/api/carte")).codice === 404 && (await post("/api/artifax/x/carta", {})).codice === 404, "gli alias carte non ci sono più");

  // lo stream passa senza header (EventSource non può mandarlo) e dice il tipo giusto
  const stream = await new Promise((ok) => {
    const u = new URL(s.base);
    const req = http.get({ host: u.hostname, port: u.port, path: "/api/stream", headers: { host: u.host } }, (res) => {
      res.once("data", (d) => { ok({ codice: res.statusCode, tipo: res.headers["content-type"], testo: String(d) }); req.destroy(); });
    });
    req.on("error", () => ok({ codice: 0 }));
    setTimeout(() => { req.destroy(); ok({ codice: -1 }); }, 5000);
  });
  t.ok(stream.codice === 200 && /text\/event-stream/.test(stream.tipo || ""), `GET /api/stream: ${stream.codice} ${stream.tipo}`);

  // ───── /api/chi ─────
  const chi = (await get("/api/chi")).json();
  t.ok(chi.ok && chi.assistente?.nome && chi.assistente.slug && Array.isArray(chi.assistente.chiamata), "/api/chi: assistente con nome, slug e chiamata");
  t.ok(Array.isArray(chi.assistente?.varianti?.prefissi) && Array.isArray(chi.assistente?.alias), "/api/chi: varianti e alias");
  t.ok(chi.slug === "prova" && typeof chi.pagina === "string", "/api/chi: la persona (COCKPIT_PERSONA)");
  t.ok(Array.isArray(chi.moduli) && chi.moduli.every((m) => m.nome && (m.pagina === null || m.pagina.startsWith(`/moduli/${m.nome}/`))), "/api/chi: elenco dei moduli");
  t.ok(!("email" in chi), "/api/chi non rimanda l'email");
  for (const m of chi.moduli) if (m.pagina) t.ok((await get(m.pagina, {})).codice === 200, `la pagina del modulo ${m.nome} (${m.pagina}) si serve`);

  // ───── sessioni (solo letture e un errore) ─────
  const ss = (await get("/api/sessioni")).json();
  t.ok(ss.ok && Array.isArray(ss.sessioni) && Array.isArray(ss.modelli) && ss.modelloDefault, "GET /api/sessioni: sessioni, modelli, modelloDefault");
  t.ok((await get("/api/sessioni/non-esiste/eventi")).codice === 404, "una sessione che non c'è dà 404");
  const orchestratore = ss.sessioni.find((x) => x.ruolo === "orchestratore") || ss.sessioni[0];
  if (orchestratore) {
    const ev = (await get(`/api/sessioni/${encodeURIComponent(orchestratore.nome)}/eventi`)).json();
    t.ok(ev.ok && Array.isArray(ev.eventi) && ev.sessione?.id === orchestratore.id, "GET …/eventi di una sessione che c'è");
  } else t.nota("nessuna sessione all'avvio: provato solo l'elenco");

  // ───── fogli: crea, leggi, aggiorna, chiudi, elimina ─────
  const f1 = (await post("/api/fogli", { tipo: "tabella", titolo: "Prova", colonne: ["a", "b"], righe: [["1", "2"], ["3", "4"]], da: "prova" })).json();
  t.ok(f1.ok && f1.foglio?.id && f1.foglio.tipo === "tabella" && f1.foglio.descrizione, "POST /api/fogli: tabella creata, con descrizione");
  const lista = (await get("/api/fogli")).json();
  t.ok(lista.fogli.some((x) => x.id === f1.foglio.id), "GET /api/fogli la contiene");
  const testo = (await get(`/api/fogli/${f1.foglio.id}/testo`)).json();
  t.ok(testo.ok && testo.testo.includes("a | b") && testo.testo.includes("3 | 4"), "GET /api/fogli/:id/testo: il testo della tabella");
  const corto = (await get(`/api/fogli/${f1.foglio.id}/testo?max=3`)).json();
  t.ok(corto.testo.length === 3 && corto.troncato === true, "…/testo?max=3 tronca");
  const agg = (await post("/api/fogli", { id: f1.foglio.id, titolo: "Prova 2", x: 100, y: 120, w: 300, h: 200 })).json();
  t.ok(agg.foglio?.titolo === "Prova 2" && agg.foglio.x === 100 && agg.foglio.w === 300, "POST /api/fogli con id aggiorna titolo e misure");
  t.ok((await post("/api/fogli", { tipo: "inesistente" })).codice === 400, "tipo di foglio sconosciuto: 400");
  t.ok((await post("/api/fogli", { id: "nope", titolo: "x" })).codice === 400, "foglio che non c'è: 400");
  t.ok((await post("/api/fogli", { tipo: "html", percorso: "/fuori/x.html" })).codice === 400, "percorso fuori dalle cartelle note: 400");
  t.ok((await post("/api/fogli", { tipo: "tabella", colonne: "x", righe: [] })).codice === 400, "tabella senza colonne[]: 400");

  // la lavagna: un file, il foglio che lo mostra, la rotta che lo serve
  mkdirSync(path.join(s.stato, "lavagna"), { recursive: true });
  writeFileSync(path.join(s.stato, "lavagna", "prova.html"), "<!doctype html><title>t</title><h1>Titolo di prova</h1><p>Ciao</p>");
  const html = await get("/lavagna/prova.html", {});
  t.ok(html.codice === 200 && html.header["content-type"].startsWith("text/html") && html.testo.includes("Titolo di prova"), "GET /lavagna/prova.html");
  t.ok((await get("/lavagna/manca.html", {})).codice === 404, "un file che non c'è nella lavagna: 404");
  t.ok((await get("/lavagna/..%2Fsessioni.json", {})).codice !== 200, "la lavagna non esce dalla sua cartella");
  t.ok((await post("/api/lavagna", { percorso: "/lavagna/prova.html", titolo: "Prova lavagna" })).codice === 200, "POST /api/lavagna");
  t.ok((await post("/api/lavagna", { percorso: "/etc/passwd" })).codice === 400, "POST /api/lavagna con un percorso fuori: 400");
  const f2 = (await post("/api/fogli", { tipo: "html", percorso: "/lavagna/prova.html", titolo: "Pagina" })).json();
  t.ok(f2.foglio?.descrizione === "Titolo di prova", `foglio html: descrizione dal primo titolo (${f2.foglio?.descrizione})`);
  const testoHtml = (await get(`/api/fogli/${f2.foglio.id}/testo`)).json();
  t.ok(testoHtml.testo.includes("Titolo di prova") && testoHtml.testo.includes("Ciao") && !testoHtml.testo.includes("<h1>"), "…/testo di un html: solo testo");

  // artifax: i fogli e la lavagna ci sono, e un artifax si riapre come foglio
  const art = (await get("/api/artifax")).json();
  const vTab = art.artifax.find((x) => x.tipo === "tabella" && x.titolo === "Prova");
  const vHtml = art.artifax.find((x) => x.percorso === "/lavagna/prova.html");
  t.ok(art.ok && vTab && vHtml, "GET /api/artifax: la tabella e il file della lavagna sono registrati");
  t.ok(vTab && !("righe" in vTab) && vTab.n_righe === 2, "artifax: le righe di una tabella non escono, solo il conteggio");
  const reg = (await post("/api/artifax", { percorso: "/lavagna/prova.html", titolo: "Pagina registrata", da: "prova" })).json();
  t.ok(reg.artifax?.id === vHtml?.id, "POST /api/artifax: stesso file, stessa voce");
  t.ok((await post("/api/artifax", { percorso: "/lavagna/x.exe" })).codice === 400, "POST /api/artifax con un tipo non gestito: 400");
  t.ok((await post("/api/artifax/non-esiste/foglio", {})).codice === 404, "riaprire un artifax che non c'è: 404");

  // chiudi, riapri da artifax (stesso foglio, riacceso), elimina
  t.ok((await post(`/api/fogli/${f2.foglio.id}/chiudi`, {})).codice === 200, "POST /api/fogli/:id/chiudi");
  t.ok(!(await get("/api/fogli")).json().fogli.some((x) => x.id === f2.foglio.id), "il foglio chiuso non c'è più");
  const riaperto = (await post(`/api/artifax/${vHtml.id}/foglio`, {})).json();
  t.ok(riaperto.ok && riaperto.foglio?.percorso === "/lavagna/prova.html", "POST /api/artifax/:id/foglio riapre il foglio");
  t.ok((await del(`/api/fogli/${riaperto.foglio.id}`)).codice === 200, "DELETE /api/fogli/:id");
  t.ok((await del(`/api/fogli/${riaperto.foglio.id}`)).codice === 400, "eliminare due volte: 400");
  t.ok((await post(`/api/fogli/${f1.foglio.id}/chiudi`, {})).codice === 200, "chiusa la tabella di prova");
  t.ok((await get("/api/fogli")).json().fogli.length === 0, "nessun foglio rimasto");
  t.ok((await post("/api/fogli/non-esiste/agente", {})).codice === 400, "agente di un foglio che non c'è: 400");

  // il foglio delle proposte è uno solo
  const p1 = (await post("/api/proposte/foglio", {})).json(), p2 = (await post("/api/proposte/foglio", {})).json();
  t.ok(p1.foglio?.tipo === "proposte" && p1.foglio.id === p2.foglio?.id, "POST /api/proposte/foglio: un solo foglio proposte");
  t.ok((await post(`/api/fogli/${p1.foglio.id}/chiudi`, {})).codice === 200, "chiuso il foglio proposte");

  // ───── allegati ─────
  const nomeAlle = "relazione finale (1).txt";
  const alle = await t.richiesta(s.base, "POST", `/api/allegati?nome=${encodeURIComponent(nomeAlle)}`, { ...D, "content-type": "application/octet-stream" }, Buffer.from("contenuto"));
  const aj = alle.json();
  const fileAlle = aj.percorso ? path.resolve(aj.percorso.startsWith("/") ? aj.percorso : path.join(t.cartella, aj.percorso)) : "";
  t.ok(alle.codice === 200 && aj.byte === 9 && fileAlle && existsSync(fileAlle) && readFileSync(fileAlle, "utf8") === "contenuto", `POST /api/allegati: ${alle.codice} ${aj.percorso}`);
  t.ok(aj.percorso && path.resolve(fileAlle).startsWith(path.resolve(s.stato)), "l'allegato sta nella cartella di stato");
  t.ok((await t.richiesta(s.base, "POST", "/api/allegati?nome=x", {}, Buffer.from("x"))).codice === 403, "POST /api/allegati senza X-Dashboard: 403");

  // ───── timer ─────
  const sessioneTimer = (await get("/api/sessioni")).json().sessioni[0]?.nome;
  if (sessioneTimer) {
    const tm = (await post("/api/timer", { sessione: sessioneTimer, descrizione: "prova", ricorrenza: "ogni 30 minuti" })).json();
    t.ok(tm.ok && tm.timer?.id && tm.timer.prossimo, "POST /api/timer: timer con il prossimo scatto");
    t.ok((await get("/api/timer")).json().timer.some((x) => x.id === tm.timer.id), "GET /api/timer lo contiene");
    t.ok((await post(`/api/timer/${tm.timer.id}/scattato`, {})).json().timer?.ultimo, "POST …/scattato registra l'ultimo scatto");
    t.ok((await post(`/api/timer/${tm.timer.id}/togli`, {})).codice === 200, "POST …/togli");
    t.ok(!(await get("/api/timer")).json().timer.some((x) => x.id === tm.timer.id), "il timer tolto non c'è più");
    const tm2 = (await post("/api/timer", { sessione: sessioneTimer, descrizione: "seconda", ricorrenza: "ogni 2 ore" })).json();
    t.ok((await del(`/api/timer/${tm2.timer.id}`)).codice === 200, "DELETE /api/timer/:id");
  } else t.nota("nessuna sessione: timer non provato");
  t.ok((await post("/api/timer", { sessione: "x", descrizione: "y", ricorrenza: "mai" })).codice === 400, "ricorrenza non valida: 400");
  t.ok((await post("/api/timer/non-esiste/togli", {})).codice === 400, "togliere un timer che non c'è: 400");

  // ───── impostazioni ─────
  const imp = (await get("/api/impostazioni")).json();
  t.ok(imp.ok && imp.motore && imp.voce && Array.isArray(imp.voci) && Array.isArray(imp.motori), "GET /api/impostazioni: motore, voce, voci, motori");
  t.ok(typeof imp.chiaveVoce === "string" && imp.chiaveVoce.length > 10, "GET /api/impostazioni: dà la chiave della voce (con l'header)");
  t.ok(imp.tonoPredefinito.includes(chi.assistente.nome), "il tono predefinito nomina l'assistente (prompt/voce.md)");
  t.ok(!("versione" in imp), "la versione dello stato non esce dalle impostazioni");
  t.ok((await post("/api/impostazioni", { tema: "chiaro", velocita: 1.3, motore: "tts", voce: "nova" })).json().tema === "chiaro", "POST /api/impostazioni: tema, velocità, motore, voce");
  const imp2 = (await get("/api/impostazioni")).json();
  t.ok(imp2.tema === "chiaro" && imp2.velocita === 1.3 && imp2.motore === "tts" && imp2.voce === "nova", "le impostazioni restano");
  t.ok((await post("/api/impostazioni", { velocita: 9 })).codice === 400, "velocità fuori scala: 400");
  t.ok((await post("/api/impostazioni", { tema: "blu" })).codice === 400, "tema sconosciuto: 400");
  t.ok((await post("/api/impostazioni", { voce: "non-esiste" })).codice === 400, "voce che il motore non ha: 400");
  t.ok((await post("/api/voce", { testo: "ciao" }, {})).codice === 403, "POST /api/voce senza X-Dashboard: 403");

  // ───── consumo, battito, proposte ─────
  const cons = (await get("/api/consumo")).json();
  t.ok(cons.ok && "lettura" in cons && "cinque" in cons && "sette" in cons && cons.percorso?.startsWith("/lavagna/"), "GET /api/consumo: lettura, finestre, percorso del widget");
  const bat = (await get("/api/battito")).json();
  t.ok(bat.ok && bat.battito && Array.isArray(bat.battito.orari) && bat.battito.acceso === false, "GET /api/battito: spento di default, con gli orari");
  const prop = (await get("/api/proposte")).json();
  t.ok(prop.ok && prop.contatori && "attuale" in prop, "GET /api/proposte: contatori e proposta attuale");

  // ───── lavagna/carica (per ctl), corpo troppo grande, pulizia all'avvio ─────
  const carica = await t.richiesta(s.base, "POST", "/api/lavagna/carica?nome=" + encodeURIComponent("../strano nome.html"), D, Buffer.from("<p>caricato</p>"));
  t.ok(carica.codice === 200 && carica.json().percorso === "/lavagna/strano-nome.html", `POST /api/lavagna/carica: ${carica.codice} ${carica.testo.slice(0, 100)}`);
  t.ok(readFileSync(path.join(s.stato, "lavagna", "strano-nome.html"), "utf8") === "<p>caricato</p>", "lavagna/carica: il file è nella lavagna dello stato, col nome sanificato");
  t.ok((await get("/lavagna/strano-nome.html", {})).testo === "<p>caricato</p>", "lavagna/carica: il file si serve");
  t.ok((await t.richiesta(s.base, "POST", "/api/lavagna/carica?nome=x.exe", D, Buffer.from("x"))).codice === 400, "lavagna/carica: estensione non ammessa, 400");
  t.ok((await t.richiesta(s.base, "POST", "/api/lavagna/carica?nome=a.html", {}, Buffer.from("x"))).codice === 403, "lavagna/carica senza X-Dashboard: 403");
  let grande = 0;
  try { grande = (await t.richiesta(s.base, "POST", "/api/fogli", JSON_, Buffer.alloc(1.2e6, 32))).codice; } catch { grande = 413; } // il server chiude il socket: anche un reset vale
  t.ok(grande === 413, `corpo JSON oltre 1 MB: ${grande} (atteso 413)`);
  t.ok((await get("/api/chi")).codice === 200, "il server risponde ancora dopo il 413");
  const vecchioStato = t.tmp(), residuo = path.join(vecchioStato, "fogli.json.tmp-123");
  writeFileSync(residuo, "{}");
  utimesSync(residuo, new Date(Date.now() - 3600e3), new Date(Date.now() - 3600e3));
  const s2 = await t.avviaServer({ COCKPIT_STATO: vecchioStato });
  t.ok(!existsSync(residuo), "pulisci() all'avvio: il residuo .tmp- vecchio è stato tolto");
  await s2.chiudi();

  // ───── server.json ─────
  const fileSrv = path.join(s.stato, "server.json");
  t.ok(existsSync(fileSrv), "server.json scritto all'avvio");
  if (existsSync(fileSrv)) {
    const sj = JSON.parse(readFileSync(fileSrv, "utf8"));
    t.ok(sj.porta === s.porta && Number.isInteger(sj.pid) && sj.avviato, `server.json: porta ${sj.porta}, pid ${sj.pid}, avviato ${sj.avviato}`);
  }
  t.ok(!/evento fuori catalogo/.test(s.log()), "nessun evento fuori catalogo nel log del server");
  t.ok(!/Error|Traceback/.test(s.log()), `nessun errore nel log del server: ${s.log().split("\n").filter((r) => /Error/.test(r)).slice(0, 2).join(" | ")}`);
}
