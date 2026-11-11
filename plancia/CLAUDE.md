# plancia/ — il cockpit dell'assistente

Questo file è la mappa che l'assistente legge per conoscere se stesso. La plancia è un server locale (`server/server.mjs`, solo `127.0.0.1`) che tiene in vita sessioni `claude -p` (l'assistente e gli agenti), più una pagina senza build (`pagine/cockpit/`) e un telecomando a riga di comando (`ctl.mjs`).

## Dove stanno le cose

| Percorso | Cosa fa |
|---|---|
| `../plancia.config.json` | L'unico file che dice chi siamo: assistente, persone, modelli, battito, moduli. Si cerca risalendo dalla cartella corrente; senza file valgono i default |
| `ctl.mjs` | Client HTTP del server: `lista`, `crea`, `invia`, `guarda`, `foglio`, `domanda`, `progresso`, `timer`, `setup`… `node plancia/ctl.mjs aiuto` stampa l'elenco vero |
| `server/` | Un file per tema: `sessioni.mjs` (i processi claude), `fogli.mjs`, `domande.mjs`, `battito.mjs`, `squadra.mjs`, `ponte.mjs`, `telegram.mjs`, `checklist.mjs`, `visita.mjs`; le rotte in `server/rotte/`; lo stato si tocca solo da `stato.mjs` |
| `pagine/` | La pagina: `cockpit/` (moduli ES, ingresso `main.js`), `condivisi/` (api, eventi, palette), `nav.js` (la barra) |
| `prompt/` | I testi per i modelli, con segnaposto `{{chiave}}`; si rileggono a ogni avvio di un processo |
| `test/fumo.mjs` | Il controllo automatico: nessun modello chiamato, meno di un minuto |
| `.plancia/` (nella cartella di lavoro) | Lo stato, fuori da git |

## Moduli

Tutto ciò che è specifico di un'azienda o di un progetto sta in un modulo: `moduli/<nome>/modulo.mjs` con default export (`nome`, `tipiEvento`, `tipiFoglio`, `rotte(ctx)`, `segnaliBattito(ctx)`, `prompt`, `squadra`, `ponte(ctx)`, `pagina`, `avvio(ctx)`, `checklist(ctx)`), più un `ctl.mjs` opzionale. Un modulo si accende in `moduli` della config. Dettagli in `pacchetto.md`.

## Regole

- Le modifiche a `server/` richiedono il pulsante «Riavvia», che preme la persona: né l'assistente né un agente riavviano il server da soli, perché spegnerebbe anche loro. Pagine e prompt non lo richiedono.
- Prima di dire «fatto»: `node plancia/test/fumo.mjs`. Prove sempre con `COCKPIT_STATO` temporaneo, su una porta diversa.
- Un file server non supera le 500 righe; una funzione nuova ha il suo controllo in `test/controlli/`.
- I colori stanno in `pagine/condivisi/palette.css`, in entrambi i temi; un colore non si scrive a mano.

## Cosa non c'è

- La squadra di agenti permanenti e il ponte fra plance sono nel codice ma vuoti: li riempie un modulo. Senza, la plancia lo dice e prosegue.
- La voce usa quella del browser se mancano le chiavi; il Terminale è provato solo su macOS.
