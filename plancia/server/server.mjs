#!/usr/bin/env node
// Il server locale della plancia: il cockpit dell'assistente (/cockpit), le API /api/… con lo stream degli eventi (SSE),
// la voce, la lavagna, i fogli, e le pagine e le rotte dei moduli accesi in plancia.config.json. Questo file è SOLO
// l'avvio: config → migrazioni → pulizia → moduli → router → ascolto. Le rotte stanno in server/rotte/, la logica dei fogli
// in fogli.mjs. Elenco di rotte, eventi e comandi in plancia/CLAUDE.md.
//
// Ascolta solo su 127.0.0.1 e risponde solo se l'header Host è 127.0.0.1:<porta> o localhost:<porta> (un sito esterno che
// punta il suo DNS qui, il «DNS rebinding», riceve 403). Le /api/ vogliono l'header X-Dashboard (un sito esterno non può
// mandarlo senza un preflight CORS, che qui non viene mai concesso), salvo lo stream e la voce con chiave.
//
// Uso:  node plancia/server/server.mjs [porta]
//   porta: argomento → COCKPIT_PORTA → "porta" della config → il default di config.mjs
//   NO_OPEN=1 non apre il browser · COCKPIT_STATO=<cartella> per uno stato di prova · COCKPIT_PROVA=1 niente processi claude,
//   niente battito né consumo periodico, niente browser (lo usa test/fumo.mjs) · COCKPIT_PERSONA=<slug> forza la persona
// Il Riavvia (POST /api/riavvia) rilancia questo stesso file con la stessa porta: resta in questo percorso.
import http from "node:http";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { chiSono, config, portaServer } from "./config.mjs";
import { migra } from "./migrazioni.mjs";
import { pulisci, salvaFile } from "./stato.mjs";
import { caricaModuli } from "./moduli.mjs";
import { creaRouter } from "./rotte.mjs";
import { trasmetti } from "./eventi.mjs";
import { Cockpit } from "./sessioni.mjs";
import { creaFogli } from "./fogli.mjs";
import { avviaConsumo } from "./consumo-pagina.mjs";
import { avviaBattito } from "./battito.mjs";
import * as pagine from "./rotte/pagine.mjs";
import * as sessioni from "./rotte/sessioni.mjs";
import * as fogliRotte from "./rotte/fogli.mjs";
import * as lavagnaAllegati from "./rotte/lavagna-allegati.mjs";
import * as voceImpostazioni from "./rotte/voce-impostazioni.mjs";
import * as artifaxRotte from "./rotte/artifax.mjs";
import * as timerRotte from "./rotte/timer.mjs";
import * as battitoRotte from "./rotte/battito.mjs";
import * as consumoRotte from "./rotte/consumo.mjs";
import * as riavvioStream from "./rotte/riavvio-stream.mjs";

const PROVA = !!process.env.COCKPIT_PROVA;

export async function avvia() {
  const cfg = config();
  const passi = migra();
  if (passi.length) console.log(`stato migrato: ${passi.join(", ")}`);
  const pulito = pulisci();
  if (pulito.tmp || pulito.allegati) console.log(`stato ripulito: ${pulito.tmp} residui, ${pulito.allegati} allegati scaduti`);
  const persona = chiSono();
  const porta = portaServer();
  process.env.COCKPIT_PORTA = String(porta); // ctl.mjs, lanciato dagli agenti, parla con questa porta
  const moduli = await caricaModuli(cfg);

  // il cockpit e i fogli si conoscono: i fogli creano gli agenti di foglio, il cockpit chiede ai fogli il contesto
  let fogli = null;
  const cockpit = new Cockpit({
    cfg, persona, moduli,
    onEvento(id, ev) { try { trasmetti({ id, ...ev }); } catch (e) { console.error("evento senza tipo:", e.message); } },
    contestoFoglio: (id) => fogli.contestoFoglio(id),
  });
  fogli = creaFogli({ cfg, persona, cockpit, moduli });
  fogli.osservaLavagna();

  const ctxModulo = (m) => ({ cfg, persona, opzioni: m.opzioni, trasmetti, cockpit, fogli });
  const ctxBattito = battitoRotte.contestoBattito({ cfg, persona, cockpit, fogli, moduli, ctxModulo });

  let server = null;
  const chiudiServer = () => server?.close();
  const nucleo = { cfg, persona, moduli, porta, cockpit, fogli, ctxBattito, chiudiServer };

  const router = creaRouter({ porta });
  for (const gruppo of [pagine, sessioni, fogliRotte, lavagnaAllegati, voceImpostazioni, artifaxRotte, timerRotte, battitoRotte, consumoRotte, riavvioStream]) {
    router.aggiungi(gruppo.rotte(nucleo));
  }
  for (const m of moduli) if (m.rotte) router.aggiungi(await m.rotte(ctxModulo(m)) || []);
  router.aggiungi(pagine.rotteFinali());
  for (const m of moduli) if (m.avvio) await m.avvio(ctxModulo(m));

  server = http.createServer(async (req, res) => {
    try { if (await router.gestisci(req, res)) return; } catch (e) { console.error("richiesta:", e.message); }
    if (!res.headersSent) {
      res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, errore: "non trovato" }));
    }
  });

  let tentativi = 0;
  server.on("error", (e) => {
    // Dopo un riavvio dal cockpit il server vecchio può tenere la porta per qualche istante: si riprova.
    if (e.code === "EADDRINUSE" && process.env.COCKPIT_ATTESA && tentativi++ < 20) return setTimeout(() => server.listen(porta, "127.0.0.1"), 300);
    console.error(e.code === "EADDRINUSE" ? `porta ${porta} occupata: la plancia è già servita? Prova http://127.0.0.1:${porta}/` : e.message);
    process.exit(1);
  });
  for (const segnale of ["SIGINT", "SIGTERM"]) process.on(segnale, () => { cockpit.chiudiTutto(); process.exit(0); });

  server.listen(porta, "127.0.0.1", () => {
    // dove sta il server: lo leggono ctl.mjs e gli strumenti, anche su una copia di prova
    salvaFile("", "server.json", `${JSON.stringify({ porta, pid: process.pid, avviato: new Date().toISOString() })}\n`);
    const indirizzo = `http://127.0.0.1:${porta}${persona.pagina || "/"}`;
    console.log(`${cfg.assistente.nome}: ${indirizzo}  (Ctrl+C per fermare)`);
    if (PROVA) return;
    avviaConsumo(); // il widget del consumo del piano, ogni 5 minuti (consumo-pagina.mjs)
    avviaBattito(ctxBattito); // il battito dell'assistente: ogni 20 s guarda se è ora (battito.mjs), solo se acceso
    if (process.platform === "darwin" && !process.env.NO_OPEN) spawn("open", [indirizzo], { stdio: "ignore", detached: true }).unref();
  });
  return { server, porta, cockpit, fogli };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await avvia();
