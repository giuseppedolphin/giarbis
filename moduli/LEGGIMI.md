# Moduli del pacchetto

Il nucleo li trova con `PLANCIA_MODULI_EXTRA` (lo imposta `giarbis`) e li accende se compaiono in `moduli` di
`plancia.config.json`. La forma di un modulo è scritta in testa a `plancia/server/moduli.mjs`.

| Modulo | Cosa fa | Opzioni |
|---|---|---|
| `locale` | Aggiunge in coda ai prompt di assistente, agenti e agenti di foglio `.plancia/prompt/<nome>.md` della repo, se c'è (lo scrive il setup) | nessuna |
| `todo-md` | To-do da un file markdown a caselle: foglio «todo» sulla mappa, `ctl todo chiudi\|riapri`, segnali del battito sulle scadenze | `file` (default `TODO.md`) |

Formato della to-do: `- [ ] testo`, con `P1`/`P2`/`P3` e `(entro GG/MM/AAAA)` facoltativi; una voce fatta diventa
`- [x] testo (fatta il GG/MM/AAAA: esito)`.
