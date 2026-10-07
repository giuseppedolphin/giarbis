# Come è fatto Giarbis dentro

> Per chi vuole metterci le mani. La mappa dettagliata del nucleo è `plancia/CLAUDE.md`.

## 1. In una frase

Un server Node locale (nessuna dipendenza) che lancia e pilota dei processi `claude -p` (Claude Code in modalità
programmatica, sul login dell'abbonamento di chi lo usa) e mostra tutto in una pagina web su `127.0.0.1`.

```
 browser ──HTTP/SSE──▶ server Node (plancia/server) ──stdin/stdout stream-json──▶ claude -p  (assistente)
    ▲                        │                                               ├──▶ claude -p  (agente 1)
    │                        ├── .plancia/  (stato, fuori da git)            └──▶ claude -p  (agente N)
    └── voce (OpenAI / ElevenLabs / browser)                                       │
                                                       ctl.mjs ◀─── Bash degli agenti (comandano il cockpit)
```

## 2. Le cartelle del pacchetto

| Percorso | Cosa | Di chi |
|---|---|---|
| `bin/giarbis.mjs` | Il comando `giarbis`: controlli, scelta della cartella e della porta, primo avvio, `ctl`, `setup`, `controlla` | pacchetto |
| `plancia/` | **Il nucleo**, copiato dalla repo dove nasce con `scripts/importa-nucleo.mjs`. Non si modifica qui: le correzioni si fanno là e si reimporta. L'hash di provenienza sta in `plancia/NUCLEO.txt` | nucleo |
| `moduli/` | I moduli del pacchetto: `locale` (aggiunge al prompt `.plancia/prompt/*.md` della repo dell'utente), `todo-md` (to-do da un file markdown a caselle). Il nucleo li trova con `PLANCIA_MODULI_EXTRA`, che imposta `giarbis` | pacchetto |
| `prompt/` | Prompt del pacchetto (`setup.md`, `primo-avvio.md`, `benvenuto.md`); l'import li copia in `plancia/prompt/` | pacchetto |
| `nucleo/CLAUDE.md` | La mappa del cockpit per chi usa il pacchetto; l'import la mette in `plancia/CLAUDE.md` | pacchetto |
| `modelli/` | Cosa il setup copia nella repo dell'utente, solo col suo sì: config d'esempio, skill `lavagna` (`modelli/skill-lavagna/`) | pacchetto |
| `scripts/importa-nucleo.mjs` | Copia il nucleo, toglie i moduli della repo d'origine, sovrappone i file del pacchetto, lancia la scansione | pacchetto |
| `scripts/scansione.mjs` | Scansione di sicurezza: segreti, email, percorsi personali, parole private (lista fuori dalla repo); `--storia` anche la storia git | pacchetto |
| `test/` | La prova da zero (`prova-da-zero.md`) | pacchetto |
| `docs/` | Questo file e il primo avvio | pacchetto |

## 3. Nella repo di chi lo usa

| Percorso | Cosa | In git? |
|---|---|---|
| `plancia.config.json` | L'unico file che dice chi è, come si chiama l'assistente, cosa è acceso | sì (decide lui) |
| `.plancia/` | Lo stato: sessioni, eventi, fogli, lavagna, allegati, timer, battito, impostazioni della voce | **no** (`.gitignore`) |
| `.plancia/chiavi.env` | Chiavi della voce (`OPENAI_API_KEY`, `ELEVENLABS_API_KEY`) | **no** |
| `.plancia/prompt/assistente.md` | Cosa deve sapere l'assistente di questa repo, scritto dal setup | no |
| `.claude/skills/lavagna/` | La skill per far vedere le cose, se l'ha voluta | sì |

## 4. Il nucleo, per pezzi

- **Avvio** `server/server.mjs` → `config.mjs` (legge `plancia.config.json` risalendo dalla cartella) → `migrazioni.mjs`
  → `moduli.mjs` (carica i moduli accesi) → `rotte.mjs` (registro delle API) → ascolta su `127.0.0.1:<porta>`.
- **Sessioni** `server/sessioni.mjs`: una sessione = un processo `claude -p --input-format stream-json
  --output-format stream-json`, ripreso con `--resume` se muore. Prompt da `prompt/*.md` con segnaposto
  (`server/prompt.mjs`), riletti a ogni avvio di processo.
- **Stato** `server/stato.mjs`: l'unico che tocca `.plancia/`; scritture atomiche, registri con rotazione.
- **Eventi** `server/eventi.mjs`: lo stream SSE verso la pagina, con il catalogo dei tipi.
- **Telecomando** `ctl.mjs`: quello che gli agenti lanciano dal loro Bash per creare agenti, aprire fogli, dichiarare
  l'avanzamento e i timer. Parla col server via HTTP.
- **Pagina** `pagine/cockpit/` (moduli ES, nessun build step) e `pagine/condivisi/` (voce, microfono, chiamata,
  lavagna, client API).
- **Voce** `server/voce-realtime.mjs` (OpenAI), `server/voce-eleven.mjs` (ElevenLabs); senza chiavi la pagina usa la
  sintesi del browser. Il riconoscimento della frase di chiamata («Hey Giarbis») è nel browser (Web Speech API, quindi
  funziona bene in Chrome).
- **Battito** `server/battito.mjs`: scheduler interno, raccoglie segnali **senza** chiamare modelli e sveglia
  l'assistente solo se c'è qualcosa di nuovo.

## 5. Sicurezza

- Il server ascolta solo su `127.0.0.1` e rifiuta richieste con un `Host` diverso (contro il DNS rebinding); le API
  vogliono l'header `X-Dashboard: 1`.
- Le chiavi non arrivano mai alla pagina né ai prompt.
- Gli agenti girano con `--permission-mode auto`: quello che chiederebbe conferma viene rifiutato, non eseguito.
  Valgono anche i permessi di Claude Code dell'utente (`~/.claude/settings.json`, `.claude/settings.json` della repo).
- Ogni agente può fare quello che può fare Claude Code nella repo: leggere, scrivere, lanciare comandi. Il cockpit
  non aggiunge barriere oltre quelle di Claude Code.

## 6. Come si aggiunge una cosa

- **Al nucleo** (vale per tutti quelli che lo usano): si fa nella repo d'origine e si reimporta; da qui si propone a chi
  mantiene il pacchetto.
- **Al pacchetto**: un modulo in `moduli/<nome>/modulo.mjs` (forma descritta in testa a `server/moduli.mjs` del
  nucleo: rotte, tipi di foglio, segnali del battito, frammenti di prompt, `pagina.js`), acceso dalla config.
- Prima di dire «fatto»: `node scripts/scansione.mjs --storia` e la prova da zero (`test/prova-da-zero.md`). Il test di
  fumo del nucleo (`node plancia/test/fumo.mjs`) gira anche qui, ma alcuni controlli sono tarati sulla configurazione della
  repo d'origine e qui risultano rossi: conta che restino verdi `base`, `pagine` e `server`.
