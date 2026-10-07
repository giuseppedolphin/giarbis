# giarbis — il pacchetto

Questa repo è il **pacchetto** che porta il cockpit (un assistente e agenti Claude Code in parallelo, su una mappa nel
browser) nella repo di chiunque. Il codice del cockpit, il **nucleo**, nasce in un'altra repo e qui si importa.

## Mappa

| Percorso | Cosa | Si modifica qui? |
|---|---|---|
| `README.md` | Per chi lo usa (anche non tecnico): installazione, primo avvio, uso, voce, problemi | sì |
| `docs/primo-avvio.md` | Il flusso del primo avvio e dell'agente di setup | sì |
| `docs/architettura.md` | Come è fatto dentro, per chi ci mette le mani | sì |
| `bin/giarbis.mjs` | Il comando `giarbis` | sì |
| `prompt/` | Prompt del pacchetto (`setup.md`, `primo-avvio.md`, `benvenuto.md`), con segnaposto `{{…}}` | sì |
| `moduli/` | Moduli del pacchetto (`locale`, `todo-md`) | sì |
| `modelli/` | Ciò che il setup copia nella repo dell'utente, solo col suo sì | sì |
| `nucleo/CLAUDE.md` | La mappa del cockpit che l'assistente legge; l'import la copia in `plancia/` | sì |
| `scripts/importa-nucleo.mjs`, `scripts/scansione.mjs` | Import del nucleo; scansione di sicurezza | sì |
| `plancia/` | **Il nucleo importato** | **no**: si corregge all'origine e si reimporta |
| `test/prova-da-zero.md` | La prova da fare prima di ogni versione | sì |

## Regole

- **Niente di privato nel pacchetto**: né segreti, né email, né percorsi personali, né nomi di persone, aziende o clienti di
  chi lo mantiene. Lo controlla `node scripts/scansione.mjs --storia` (anche la storia git), con le parole private in un file
  fuori dalla repo (`~/.config/giarbis/parole-private.txt`). Verde prima di ogni commit.
- **La repo dell'utente è sua**: il setup scrive solo dopo un sì esplicito, e fuori da `.plancia/` una cosa alla volta.
  Le chiavi non passano mai dalla chat.
- **Zero dipendenze npm**, Node ≥ 20.
- Il README è per una persona non tecnica: frasi brevi, cosa si vede a ogni passo, nessun gergo non spiegato. Ogni
  messaggio del terminale citato nel README è quello vero (si ricontrolla nella prova da zero).
- Italiano per tutto. Date per esteso (`07/10/2026`).
- Prove sempre in una cartella di prova, mai in una repo vera, e su una porta che non sia quella di un cockpit già acceso.
