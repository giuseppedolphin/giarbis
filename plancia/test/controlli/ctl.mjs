// ctl.mjs contro un server di prova: lista, fogli (tabella, leggi, chiudi), sessione di prova con progresso e timer,
// come si trova il server (COCKPIT_PORTA, --porta, server.json) e che gli alias di prima non esistano più.
// Ogni chiamata a ctl passa COCKPIT_PORTA e COCKPIT_SESSIONE espliciti: niente può arrivare per sbaglio al server vero.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";

const portaVuota = () => new Promise((ok) => {
  const srv = net.createServer();
  srv.listen(0, "127.0.0.1", () => { const { port } = srv.address(); srv.close(() => ok(port)); });
});

export default async function (t) {
  const s = await t.avviaServer({});
  const dir = t.tmp();
  const base = { COCKPIT_STATO: s.stato, COCKPIT_SESSIONE: "" };
  const ctl = (args, env = {}) => t.ctl(args, { ...base, COCKPIT_PORTA: String(s.porta), ...env });

  // lista
  const lista = ctl(["lista"]);
  t.ok(lista.codice === 0, `lista: uscita ${lista.codice}: ${lista.out}`);
  t.ok(/nessun agente/.test(lista.out), `lista: atteso "nessun agente", trovato: ${lista.out.trim().slice(0, 120)}`);

  // aiuto, comando sconosciuto, alias di prima
  const aiuto = ctl(["aiuto"]);
  t.ok(aiuto.codice === 0 && /foglio tabella/.test(aiuto.out) && !/carta|carte\b/i.test(aiuto.out), "aiuto: manca l'elenco o nomina le carte");
  for (const vecchio of ["carta", "carte", "chiudi-carta"]) {
    const r = ctl([vecchio]);
    t.ok(r.codice === 1 && /comando sconosciuto/.test(r.out), `alias "${vecchio}" ancora accettato: ${r.out.slice(0, 80)}`);
  }

  // foglio tabella → fogli → leggi → chiudi
  const file = path.join(dir, "tabella.json");
  writeFileSync(file, JSON.stringify([{ nome: "uno", valore: 1 }, { nome: "due", valore: 2 }]));
  const crea = ctl(["foglio", "tabella", file, "Tabella di prova", "--descrizione", "due righe per il controllo"]);
  const id = /\(([\w-]+)\); chiudi con/.exec(crea.out)?.[1];
  t.ok(crea.codice === 0 && id, `foglio tabella: uscita ${crea.codice}: ${crea.out}`);
  if (id) {
    const elenco = ctl(["fogli"]);
    t.ok(elenco.codice === 0 && elenco.out.includes(id) && /due righe per il controllo/.test(elenco.out), `fogli: ${elenco.out.slice(0, 200)}`);
    const leggi = ctl(["foglio", "leggi", id, "--max", "20"]);
    t.ok(leggi.codice === 0 && /nome \| valore/.test(leggi.out) && /troncato/.test(leggi.out), `foglio leggi: ${leggi.out.slice(0, 200)}`);
    const intero = ctl(["foglio", "leggi", id]);
    t.ok(/uno \| 1/.test(intero.out) && /due \| 2/.test(intero.out), `foglio leggi intero: ${intero.out.slice(0, 200)}`);
    const sposta = ctl(["foglio", "sposta", id, "10", "20", "300", "200"]);
    t.ok(sposta.codice === 0 && /x 10 y 20/.test(sposta.out), `foglio sposta: ${sposta.out}`);
    const chiudi = ctl(["chiudi-foglio", id]);
    t.ok(chiudi.codice === 0, `chiudi-foglio: uscita ${chiudi.codice}: ${chiudi.out}`);
    t.ok(!ctl(["fogli"]).out.includes(id), "chiudi-foglio: il foglio c'è ancora");
  }
  t.ok(ctl(["foglio", "leggi", "non-esiste"]).codice === 1, "foglio leggi di un id sbagliato deve fallire");

  // foglio html: il file arriva nella lavagna dello stato, per il server (carica) o, finché non c'è la rotta, per salvaFile
  const html = path.join(dir, "pagina.html");
  writeFileSync(html, "<h1>Titolo di prova</h1><p>testo uno</p>");
  const fh = ctl(["foglio", "html", html, "Pagina di prova"]);
  const idH = /\(([\w-]+)\); chiudi con/.exec(fh.out)?.[1];
  t.ok(fh.codice === 0 && idH, `foglio html: ${fh.out}`);
  t.ok(existsSync(path.join(s.stato, "lavagna", "pagina.html")), "foglio html: il file non è nella lavagna dello stato");
  if (idH) {
    const l = ctl(["foglio", "leggi", idH]);
    t.ok(/testo uno/.test(l.out), `foglio leggi html: ${l.out.slice(0, 200)}`);
    ctl(["chiudi-foglio", idH]);
  }

  // una sessione di prova (senza compito: nessun processo), poi progresso e timer che valgono per lei
  const prova = ctl(["crea", "prova-ctl"]);
  t.ok(prova.codice === 0 && /prova-ctl/.test(prova.out), `crea: ${prova.out}`);
  const miaSessione = { COCKPIT_SESSIONE: "prova-ctl" };
  t.ok(ctl(["lista"]).out.includes("prova-ctl"), "lista: manca la sessione di prova");
  const prog = ctl(["progresso", "piano", "uno|due|tre"], miaSessione);
  t.ok(prog.codice === 0 && /avanzamento: 0 di 3/.test(prog.out), `progresso piano: ${prog.out}`);
  const avanti = ctl(["progresso", "avanti", "due"], miaSessione);
  t.ok(avanti.codice === 0 && /1 di 3/.test(avanti.out), `progresso avanti: ${avanti.out}`);
  t.ok(ctl(["progresso", "avanti"]).codice === 1, "progresso senza sessione deve fallire");
  const tagg = ctl(["timer", "aggiungi", "controllo di prova", "ogni 30 minuti", "--id", "cron-prova"], miaSessione);
  const idT = /timer ([\w-]+) registrato/.exec(tagg.out)?.[1];
  t.ok(tagg.codice === 0 && idT, `timer aggiungi: ${tagg.out}`);
  if (idT) {
    t.ok(ctl(["timer", "lista"], miaSessione).out.includes("controllo di prova"), "timer lista: manca il timer");
    const via = ctl(["timer", "togli", idT], miaSessione);
    t.ok(via.codice === 0 && /tolto dal registro/.test(via.out), `timer togli: ${via.out}`);
    t.ok(/nessun timer/.test(ctl(["timer", "lista"], miaSessione).out), "timer lista dopo togli: ne resta uno");
  }
  const mod = ctl(["modello", "prova-ctl"]);
  t.ok(mod.codice === 0 && /prova-ctl: \S/.test(mod.out) && !/Opus 5\.5/.test(ctl(["aiuto"]).out), `modello: ${mod.out}`);

  // l'orchestratore si risolve con nome, slug e alias della config
  const { sessioni } = (await t.get(s.base, "/api/sessioni", { "x-dashboard": "1" })).json();
  const orch = sessioni.find((x) => x.ruolo === "orchestratore");
  if (orch) {
    const n = ctl(["modello", "orchestratore"]);
    t.ok(n.codice === 0 && n.out.startsWith(`${orch.nome}:`), `modello orchestratore: ${n.out}`);
    for (const nome of ["jarvis", "giarvis", "giarbis"]) {
      const r = ctl(["modello", nome]);
      t.ok(r.out === n.out, `modello ${nome} (alias dalla config): ${r.out.trim()} invece di ${n.out.trim()}`);
    }
  } else t.nota("nessuna sessione orchestratore nello stato di prova: alias non verificati");

  // dove sta il server
  // uno stato senza server.json: il ctl fallisce, non ripiega né su COCKPIT_PORTA né sulla plancia viva della cartella
  const nessuno = ctl(["lista"], { COCKPIT_PORTA: "1", COCKPIT_STATO: t.tmp() });
  t.ok(nessuno.codice === 1 && /non risponde su http:\/\/127\.0\.0\.1:0\b/.test(nessuno.out), `server assente: ${nessuno.out}`);
  const conOpzione = t.ctl(["lista", "--porta", String(s.porta)], { ...base, COCKPIT_PORTA: "" });
  t.ok(conOpzione.codice === 0, `--porta: ${conOpzione.out}`);
  const fileServer = path.join(s.stato, "server.json");
  if (!existsSync(fileServer)) writeFileSync(fileServer, JSON.stringify({ porta: s.porta, pid: process.pid })); // il server nuovo lo scrive da solo
  else t.ok(Number(JSON.parse(readFileSync(fileServer, "utf8")).porta) === s.porta, "server.json: porta diversa da quella del server");
  const dalFile = t.ctl(["lista"], { ...base, COCKPIT_PORTA: "" });
  t.ok(dalFile.codice === 0, `server.json: ${dalFile.out}`);
  // COCKPIT_STATO batte COCKPIT_PORTA: un agente della plancia viva ha COCKPIT_PORTA=4173, ma con lo stato di prova va sul server di prova
  const porta0 = await portaVuota();
  const sulloStato = t.ctl(["lista"], { COCKPIT_STATO: s.stato, COCKPIT_SESSIONE: "", COCKPIT_PORTA: String(porta0) });
  t.ok(sulloStato.codice === 0 && /nessun agente|prova-ctl/.test(sulloStato.out), `COCKPIT_STATO deve battere COCKPIT_PORTA: ${sulloStato.out.slice(0, 160)}`);
  // server.json di un processo morto: si ignora (la config di prova punta a una porta chiusa, mai a quella vera)
  const stato2 = t.tmp(), config2 = path.join(t.tmp(), "plancia.config.json");
  writeFileSync(config2, JSON.stringify({ porta: 1 }));
  writeFileSync(path.join(stato2, "server.json"), JSON.stringify({ porta: s.porta, pid: 2147483646 }));
  const vecchio = t.ctl(["lista"], { COCKPIT_STATO: stato2, COCKPIT_SESSIONE: "", COCKPIT_PORTA: "", PLANCIA_CONFIG: config2 });
  t.ok(vecchio.codice === 1 && /127\.0\.0\.1:0\b/.test(vecchio.out), `server.json di un processo morto: ${vecchio.out}`);

  // un ctl in una cartella col proprio server.json (pid vivo) va sul proprio server, anche con COCKPIT_PORTA ereditata verso una porta vuota
  const cartella2 = t.tmp(), config3 = path.join(cartella2, "plancia.config.json");
  writeFileSync(config3, JSON.stringify({ porta: 1 }));
  mkdirSync(path.join(cartella2, ".plancia"), { recursive: true });
  writeFileSync(path.join(cartella2, ".plancia", "server.json"), JSON.stringify({ porta: s.porta, pid: process.pid }));
  const propria = t.ctl(["lista"], { COCKPIT_STATO: "", COCKPIT_SESSIONE: "", COCKPIT_PORTA: String(porta0), PLANCIA_CONFIG: config3 });
  t.ok(propria.codice === 0 && /nessun agente|prova-ctl/.test(propria.out), `ctl in una cartella col proprio server.json: ${propria.out.slice(0, 160)}`);
  const config4 = path.join(t.tmp(), "plancia.config.json");
  writeFileSync(config4, JSON.stringify({ porta: 1 }));
  const senzaFile = t.ctl(["lista"], { COCKPIT_STATO: "", COCKPIT_SESSIONE: "", COCKPIT_PORTA: String(porta0), PLANCIA_CONFIG: config4 });
  t.ok(senzaFile.codice === 1 && new RegExp(`:${porta0}\\b`).test(senzaFile.out), `senza server.json vale COCKPIT_PORTA: ${senzaFile.out}`);
  // cartella: la dice il server con cui si parla, e l'aiuto dice la porta
  const cart = ctl(["cartella"]);
  t.ok(cart.codice === 0 && cart.out.trim().length > 0, `cartella: ${cart.out}`);
  const dir2 = JSON.parse((await t.get(s.base, "/api/chi", { "x-dashboard": "1" })).testo).cartelle;
  t.ok(dir2 && path.resolve(dir2.stato) === path.resolve(s.stato), `/api/chi senza cartelle.stato: ${JSON.stringify(dir2)}`);
  t.ok(new RegExp(`porta ${s.porta} \\(`).test(ctl(["aiuto"]).out), "l'aiuto non dice con quale porta parla il ctl");

  // ctl non scrive lo stato: dopo tutto questo nella cartella di stato non ci sono i file che scriveva prima (pannelli, artifax diretti)
  t.ok(!existsSync(path.join(s.stato, "pannelli.json")), "ctl ha scritto pannelli.json nello stato");
}
