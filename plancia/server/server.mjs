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
import * as domandeRotte from "./rotte/domande.mjs";
import * as percorsiRotte from "./rotte/percorsi.mjs";
import * as terminaleRotte from "./rotte/terminale.mjs";
import * as Domande from "./domande.mjs";
import * as riavvioStream from "./rotte/riavvio-stream.mjs";
import * as squadraRotte from "./rotte/squadra.mjs";
import { creaSquadra } from "./squadra.mjs";
import * as ponteRotte from "./rotte/ponte.mjs";
import { creaPonte } from "./ponte.mjs";
import * as menzioniRotte from "./rotte/menzioni.mjs";
import { creaMenzioni } from "./menzioni.mjs";
import * as telegramRotte from "./rotte/telegram.mjs";
import { creaTelegram } from "./telegram.mjs";
import * as checklistRotte from "./rotte/checklist.mjs";
import * as postiRotte from "./rotte/posti.mjs";
import * as visitaRotte from "./rotte/visita.mjs";
import { decidi as decidiVisita } from "./visita.mjs";
import { creaChecklist } from "./checklist.mjs";
import { tokenDi } from "./identita.mjs";

const PROVA = !!process.env.COCKPIT_PROVA;

export async function avvia() {
  const cfg = config();
  const passi = migra();
  if (passi.length) console.log(`stato migrato: ${passi.join(", ")}`);
  await decidiVisita(); // plancia nuova o già in uso: si guarda adesso, prima che il Cockpit scriva sessioni.json
  const pulito = pulisci();
  if (pulito.tmp || pulito.allegati) console.log(`stato ripulito: ${pulito.tmp} residui, ${pulito.allegati} allegati scaduti`);
  const persona = chiSono();
  const porta = portaServer();
  process.env.COCKPIT_PORTA = String(porta); // ctl.mjs, lanciato dagli agenti, parla con questa porta
  delete process.env.COCKPIT_TOKEN; // un token ereditato (server lanciato da un agente) non vale qui: ogni sessione riceve il suo
  const moduli = await caricaModuli(cfg);

  // il cockpit e i fogli si conoscono: i fogli creano gli agenti di foglio, il cockpit chiede ai fogli il contesto
  let fogli = null;
  const cockpit = new Cockpit({
    cfg, persona, moduli,
    onEvento(id, ev) {
      try { trasmetti({ id, ...ev }); } catch (e) { console.error("evento senza tipo:", e.message); }
      if (ev.type === "cockpit_rimossa") Domande.sessioneRimossa(id);
      // anche dopo il turno del compact, che non passa da fineTurno: le risposte in attesa a sessione ferma
      if (ev.type === "fine") setImmediate(() => { try { const s = cockpit.trova(id); if (s) Domande.consegnaPendenti(s); } catch (e) { console.error("domande:", e.message); } });
    },
    contestoFoglio: (id) => fogli.contestoFoglio(id),
    // la casella delle domande: un turno finito con una domanda non registrata, le domande aperte di un agente, un messaggio della persona a una sessione
    osservatore: {
      fineTurno: (s, info) => Domande.dalTesto(s, info),
      domandeAperte: (s) => Domande.elenco({ sessione: s.id }).aperte.length, // per l'avviso [cockpit]: domande senza rimbalzo
      messaggio(s, ev) {
        const dallaPersona = ev.mittente === (persona.slug || "tu") && !ev.nota && ev.origine !== "agente" && ev.origine !== "sistema";
        if (dallaPersona) return Domande.messaggioPersona(s).nota; // la nota sulle domande aperte va al modello, non in chat
      },
    },
  });
  cockpit.tokenDi = tokenDi; // il token di ogni sessione, nell'ambiente del suo processo: dice al server chi scrive (identita.mjs)
  fogli = creaFogli({ cfg, persona, cockpit, moduli });
  fogli.osservaLavagna();
  Domande.collega({ cockpit, persona, trasmetti, fogli });

  const ctxModulo = (m) => ({ cfg, persona, opzioni: m.opzioni, trasmetti, cockpit, fogli });
  const ctxBattito = battitoRotte.contestoBattito({ cfg, persona, cockpit, fogli, moduli, ctxModulo });

  // le menzioni della persona: squadra e ponte trasmettono passando da qui, un messaggio che la tagga diventa cockpit_menzioni (menzioni.mjs)
  let ponte = null;
  const menzioni = creaMenzioni({ persona, ponte: () => ponte, trasmetti });
  let telegram = null;
  const osservato = (ev) => { trasmetti(ev); menzioni.osserva(ev); telegram?.osserva(ev).catch((e) => console.error("telegram:", e.message)); };
  // la squadra di agenti permanenti: ruoli dai moduli, prompt suo, risveglio con codice (squadra.mjs)
  const squadra = creaSquadra({ cfg, persona, cockpit, moduli, trasmetti: osservato, segnali: ctxBattito.segnali });
  cockpit.compositori.squadra = (s) => squadra.prompt(s);
  cockpit.cartelle.squadra = (s) => squadra.cartelle(s); // le cartelle in più dei ruoli che le dichiarano (--add-dir)
  cockpit.chrome.squadra = (s) => squadra.chrome(s); // il browser per ruolo (campo chrome del file dei ruoli), se no la config
  cockpit.permessi.squadra = (s) => squadra.permessi(s); // le regole di allow per ruolo (campo permessi del file dei ruoli, --allowedTools)
  cockpit.tettoUsaEGetta = (s) => squadra.tettoUsaEGetta(s); // quanti usa e getta vivi può avere un ruolo (campo usaEGetta)
  // il ponte con le plance delle altre persone, un filo per persona: trasporto da un modulo, controllo con codice, consegna ad assistente fermo (ponte.mjs)
  ponte = creaPonte({ cfg, persona, cockpit, moduli, trasmetti: osservato, ctxModulo });
  // Telegram: la chat della persona col suo assistente e il gruppo; spento senza token (telegram.mjs)
  telegram = creaTelegram({ cfg, persona, cockpit, trasmetti });
  // la checklist di primo avvio: voci del nucleo e dei moduli, ognuna verificata dal codice (checklist.mjs)
  const checklist = creaChecklist({ cfg, persona, cockpit, moduli, ctxModulo, telegram, trasmetti });

  let server = null;
  const chiudiServer = () => server?.close();
  const nucleo = { cfg, persona, moduli, porta, cockpit, fogli, ctxBattito, squadra, ponte, menzioni, telegram, checklist, chiudiServer };

  const router = creaRouter({ porta, limiteJson: cfg.limiti.corpoMB * 1e6 });
  for (const gruppo of [pagine, sessioni, fogliRotte, lavagnaAllegati, voceImpostazioni, artifaxRotte, timerRotte, battitoRotte, domandeRotte, consumoRotte, percorsiRotte, terminaleRotte, riavvioStream, squadraRotte, ponteRotte, menzioniRotte, telegramRotte, checklistRotte, postiRotte, visitaRotte]) {
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
    squadra.avvia(); // la squadra: sessioni dal file dei ruoli se accesa; il risveglio ogni 20 s (non in prova, squadra.mjs)
    Domande.consegnaPendenti(); // le risposte date mentre il server era giù, agli agenti fermi; le altre a fine turno
    telegram.avvia(); // Telegram: long polling di getUpdates e le domande ogni 20 s (non in prova, non senza token, telegram.mjs)
    ponte.avvia(); // il ponte: la coda ogni ponte.intervalloMinuti, la consegna ogni 20 s (non in prova, ponte.mjs)
    cockpit.avvisaTimerSpenti(); // a chi possiede un timer, l'elenco da controllare con CronList (--resume ridà i job) o da ricreare (sessioni.mjs)
    if (PROVA) return;
    checklist.avvio().catch((e) => console.error("checklist:", e.message)); // una plancia nuova: controllo e guida dell'assistente, una volta
    avviaConsumo(); // il widget del consumo del piano, ogni 5 minuti (consumo-pagina.mjs)
    avviaBattito(ctxBattito); // il battito dell'assistente: ogni 20 s guarda se è ora (battito.mjs), solo se acceso
    // le risposte in attesa anche quando la sessione si libera senza un result (coda riallineata, ferma, processo uscito): ogni 20 s, senza modelli
    setInterval(() => { try { Domande.consegnaPendenti(); } catch (e) { console.error("domande:", e.message); } }, 20000).unref?.();
    if (process.platform === "darwin" && !process.env.NO_OPEN) spawn("open", [indirizzo], { stdio: "ignore", detached: true }).unref();
    // Windows: «start» di cmd apre il browser predefinito, senza finestra di cmd (la stringa vuota è il titolo di start)
    if (process.platform === "win32" && !process.env.NO_OPEN) spawn(process.env.ComSpec || "cmd.exe", ["/d", "/c", "start", "", indirizzo], { stdio: "ignore", detached: true, windowsHide: true }).on("error", () => {}).unref();
  });
  return { server, porta, cockpit, fogli };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await avvia();
