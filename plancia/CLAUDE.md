# plancia/ — il cockpit

Questo file è la mappa del cockpit: l'assistente la legge quando si parla di lui o di come migliorarlo. Il cockpit è una pagina
web locale (`http://127.0.0.1:<porta>/cockpit`) dove l'assistente e gli agenti Claude Code lavorano in parallelo sulla
cartella di lavoro, sul login dell'abbonamento di chi lo avvia (non sull'API di Anthropic). Lo si lancia col comando `giarbis`
del pacchetto; il codice qui sotto è il **nucleo**, uguale per tutti.

## Configurazione e stato

- **Config**: `plancia.config.json` nella radice della cartella di lavoro, cercato risalendo come fa git (`PLANCIA_CONFIG` lo forza).
  Campi: `assistente` (`nome`, `slug`, `chiamata`, `varianti`, `alias`), `lingua`, `fuso`, `porta`, `chiavi` (un file `.env`),
  `persone[]` (`email`, `slug`, `nome`, `pagina`), `modelli` (`default`, `foglio`), `battito` (`orari`, `giorni`, `oraMinima`),
  `conservazione` (`allegatiGiorni`, `registriMB`), `chrome` (false: niente Claude in Chrome nelle sessioni), `moduli` (nome → opzioni).
- **Stato** fuori da git in `.plancia/` della cartella di lavoro: sessioni, eventi, fogli, lavagna, allegati, timer, battito,
  impostazioni. Si tocca solo da `server/stato.mjs`. Gli allegati si cancellano dopo `allegatiGiorni` (30).
- **Chiavi** della voce (`OPENAI_API_KEY`, `ELEVENLABS_API_KEY`): variabile d'ambiente, poi il file `chiavi` della config, poi
  `.plancia/chiavi.env`. Mai stampate, mai mandate alla pagina. Senza, la voce è quella del browser.
- **Primo avvio**: senza config e con `PLANCIA_PRIMO_AVVIO=1` (lo imposta `giarbis`) l'orchestratore è la sessione `setup`
  (prompt `prompt/setup.md`); finito il setup, `ctl setup fatto` fa comparire «Avvia» sulla pagina e al riavvio nasce l'assistente.

## Mappa dei file

| Percorso | Cosa fa |
|---|---|
| `ctl.mjs` | Il telecomando che l'assistente e gli agenti usano dal loro Bash; parla col server via HTTP |
| `server/server.mjs` | L'avvio: config → migrazioni → pulizia → moduli → router → ascolto |
| `server/config.mjs` | Config, persona, chiavi, porta, `comandoCtl()` |
| `server/stato.mjs`, `migrazioni.mjs` | Lo stato (JSON atomici, registri con rotazione) e i suoi passi di migrazione |
| `server/rotte.mjs`, `server/rotte/` | Il router e le API, un file per tema |
| `server/eventi.mjs` | Lo stream SSE verso la pagina, col catalogo dei tipi |
| `server/moduli.mjs`, `prompt.mjs` | Caricamento dei moduli accesi; composizione dei prompt da `prompt/*.md` + frammenti dei moduli |
| `server/sessioni.mjs` | Una sessione = un processo `claude -p` in stream-json |
| `server/fogli.mjs`, `fogli-testo.mjs` | I fogli sulla mappa e il loro testo leggibile |
| `server/sottoagenti.mjs`, `modelli.mjs`, `timer.mjs`, `artifax.mjs`, `contesto.mjs` | Subagenti e workflow sulla mappa; modelli ammessi; timer; catalogo Artifax; finestra di contesto |
| `server/battito.mjs` | Il battito: a orari fissi raccoglie segnali senza chiamare modelli e, solo se c'è qualcosa di nuovo, sveglia l'assistente |
| `server/consumo*.mjs` | Quanto del piano Claude è stato usato, letto dallo stream e dai transcript locali |
| `server/voce-realtime.mjs`, `voce-eleven.mjs` | Voce OpenAI ed ElevenLabs |
| `prompt/` | I testi per i modelli, con segnaposto `{{…}}`; si rileggono a ogni avvio di un agente, non serve il Riavvia |
| `pagine/cockpit/` | La pagina del cockpit (moduli ES, nessun build step): mappa, chat, fogli, volto, voce, timer |
| `pagine/condivisi/` | Moduli comuni a cockpit, barra e bolla: API, eventi, voce, microfono, frase di chiamata, lavagna, colori |
| `test/fumo.mjs` | Il controllo automatico, senza modelli: `node <questa cartella>/test/fumo.mjs` |

I moduli del pacchetto (`locale`: istruzioni della repo in `.plancia/prompt/`; `todo-md`: la to-do da un file markdown) stanno
nella cartella `moduli/` accanto a questa, e si accendono nella config.

## Comandi di ctl

`lista` · `crea <nome> "<compito>" [--modello opus|sonnet|haiku]` · `modello <nome> [alias]` · `invia <nome> "<msg>"` ·
`guarda <nome> [n]` · `ferma <nome>` · `mostra <file> ["titolo"] [--descrizione "…"]` · `foglio html|tabella|immagine … [--descrizione "…"]` ·
`fogli` · `foglio leggi <id> [--max 4000]` · `foglio aggiorna <id> [--file] [--titolo] [--descrizione]` · `foglio attiva|disattiva|sposta <id>` ·
`chiudi-foglio <id>` · `progresso piano|avanti|<fatti>/<totale>` · `timer aggiungi|scattato|togli|lista` · `cartella [lavagna|allegati|stato]` ·
`propone "…" --perche "…" [--urgente]` · `proposte` · `battito [stato]|on|off|ora|orari "11:00,…"|giorni "1,…,5"` · `setup fatto`.
Con `todo-md` acceso: `todo chiudi|riapri <id>`, `foglio todo`. `ctl aiuto` stampa l'elenco vero.

## Cosa richiede il Riavvia

- **Sì**: i file di `server/`, i moduli, `plancia.config.json`. Pulsante «Riavvia» della pagina. Il riavvio chiude tutti i processi,
  compreso quello dell'assistente: **un agente non lo lancia mai da solo**, lo dice alla persona a lavoro finito.
- **No**: i prompt, le pagine (si ricarica la pagina), `ctl.mjs`.

## Limiti noti

- Gli agenti lavorano tutti nella stessa cartella: due agenti sugli stessi file si pestano.
- I permessi sono in modalità `auto` senza prompt: ciò che chiederebbe conferma viene rifiutato (anche lo strumento Workflow).
- Ogni agente consuma il piano dell'abbonamento; anche ogni avviso all'assistente costa un turno breve.
- Il codice del nucleo arriva da un'altra repo: una correzione fatta qui si perde al prossimo aggiornamento del pacchetto.
  Si propone a chi mantiene il pacchetto.
