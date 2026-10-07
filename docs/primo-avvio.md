# Il primo avvio

> Cosa succede la prima volta che si lancia `giarbis` nella sua repo, passo per passo,
> e cosa fa l'agente di setup. Il prompt dell'agente è `prompt/setup.md`.

## 1. Dal comando alla pagina

```
cd ~/progetti/mio-progetto
giarbis
```

1. **Il lanciatore controlla i prerequisiti** (`bin/giarbis.mjs`, stessi controlli di `giarbis controlla`):
   Node ≥ 20, `claude` nel PATH, `claude auth status` con un login valido, `git` presente. Se uno manca si ferma con
   una frase che dice cosa fare (non uno stack trace) e il rimando alla sezione giusta del README.
2. **Cerca `plancia.config.json`** risalendo dalla cartella (come git).
   - **C'è** → avvio normale, sulla porta della config.
   - **Non c'è** → primo avvio: la cartella di lavoro è quella dove sei. Se non è una repo git o non c'è un `CLAUDE.md`,
     lo dice ma va avanti (il setup lo gestisce).
3. **Sceglie la porta**: config → `--porta` → 4747; se è occupata prova le successive e lo scrive.
4. **Avvia il server** del nucleo con `PLANCIA_PRIMO_AVVIO=1` (senza config apre il setup; con la config fa solo il benvenuto alla prima accensione) e `PLANCIA_MODULI_EXTRA` (i moduli del pacchetto) e apre il browser su
   `http://127.0.0.1:<porta>/`. Nel terminale resta una riga sola: dove guardare e come fermarlo (Ctrl+C).

## 2. La pagina in modalità setup

- La mappa ha **una sfera sola**, l'agente `setup`, al posto dell'assistente. In alto una striscia:
  «Configurazione in corso: rispondi alle domande nella chat».
- La chat dell'agente è già aperta e il primo messaggio lo manda il server da solo (`[primo avvio] …`), così chi lo usa
  non deve inventarsi cosa scrivere.
- Voce: in setup non c'è (non sappiamo ancora se la vuole). Si scrive.

## 3. Cosa fa l'agente di setup

Sei fasi, in quest'ordine, ciascuna con una domanda alla volta. Il prompt lo obbliga a dichiararle come piano
(anello di avanzamento) così chi lo usa vede a che punto è.

| Fase | Cosa fa | Cosa chiede | Cosa scrive |
|---|---|---|---|
| 1 · Guardo la repo | Legge `CLAUDE.md` (se c'è), `README`, la struttura delle cartelle (due livelli), `git log -5`, `.claude/skills/`, `claude auth status` (il piano: `subscriptionType`). Niente file grandi, niente segreti (`.env*` non si apre). | niente | niente |
| 2 · Ti presento cosa ho visto | Due-tre frasi: di cosa parla la repo, chi ci lavora, se c'è già una to-do. | «Ho capito bene?» | niente |
| 3 · Chi sei e come lo chiami | | il nome di chi lo usa (proposto da `git config user.name`); come vuole chiamare l'assistente (proposto: Giarbis; se cambia, frase di chiamata «Hey <nome>»); lingua (proposta dall'italiano della conversazione) | niente |
| 4 · Cosa accendiamo | Spiega in una riga ciascuno cosa costa. | conferma del **piano** Claude letto in fase 1 (Pro / Max) → modello di default; **voce** sì/no e motore (browser gratis; OpenAI o ElevenLabs con chiave); **to-do** sì/no e dove (un `TODO.md` esistente o nuovo, oppure niente); **battito** sì/no, orari e giorni | niente |
| 5 · Ti mostro cosa scrivo | Mostra come **foglio** sulla mappa (tabella) l'elenco dei file e cosa conterrà ciascuno; il contenuto della config in un blocco di codice. | «Scrivo?» | solo dopo il sì: `plancia.config.json`; `.plancia/prompt/assistente.md` (cosa deve sapere Giarbis di questa repo e di lui, max 40 righe); se voce con chiave, `.plancia/chiavi.env` con le righe vuote |
| 6 · Proposte | Propone, una per una, le cose fuori da `.plancia/`: la riga `.plancia/` in `.gitignore`; la skill `lavagna` adattata in `.claude/skills/lavagna/`; un paragrafo «Giarbis» in fondo al suo `CLAUDE.md` (cinque righe: cos'è il cockpit, dove sta la config); il `TODO.md` vuoto se l'ha chiesto e non c'è. | sì/no per ciascuna | solo quelle col sì |

Alla fine: controlla la config con `giarbis controlla --config` (JSON valido, campi noti, porta libera, file di chiavi
se serve), dice in due frasi cosa succede adesso e lancia `ctl setup fatto`. La pagina mostra «Avvia»:
il clic è di chi lo usa (riavvio del server, che spegne anche l'agente di setup).

## 4. Il primo avvio normale

- Il server legge la config, crea la sessione dell'assistente col nome scelto e manda il suo primo messaggio
  (`[benvenuto]`): l'assistente si presenta in due frasi e dice le tre cose che si possono fare subito
  (chiedergli qualcosa sulla repo, lanciare un agente, provare la voce con «Hey <nome>»).
- L'agente `setup` resta sulla mappa come sfera ferma: la sua chat è il registro di cosa è stato deciso. Si può
  togliere dalla scheda.
- Da qui Giarbis è una sessione Claude Code nella repo di chi lo usa: legge il suo `CLAUDE.md` da sé (è Claude Code),
  ha le sue skill, i suoi MCP, i suoi permessi utente.

## 5. Rifare il setup

`giarbis setup` rilancia il primo avvio anche con la config presente: l'agente parte dalla config esistente e
chiede solo cosa cambiare. Non cancella niente: la config vecchia diventa `plancia.config.json.prima`.

## 6. Casi limite

| Caso | Cosa succede |
|---|---|
| Cartella senza `CLAUDE.md` | Il setup lo dice e propone (fase 6) di crearne uno minimo con `/init` di Claude Code, che però lancia chi lo usa dal terminale: non lo scrive lui. |
| Cartella non git | Va avanti; la persona si prende dal nome detto in chat, non dall'email. Propone `git init` solo come suggerimento. |
| Chi lo usa chiude il browser a metà setup | Rilancia `giarbis`: la config non c'è ancora, quindi riparte il setup, che riprende la stessa sessione (`--resume`) e sa dove era rimasto. |
| Chiude il terminale | Il server si ferma. Si rilancia `giarbis`. |
| `claude` non loggato | Il lanciatore si ferma prima di avviare il server: «Apri un terminale e scrivi `claude`, fai il login, poi rilancia `giarbis`». |
| Piano senza modalità `auto` dei permessi | **Non verificato**: le sessioni partono con `--permission-mode auto`. Se un piano non la offre, serve un ripiego nel nucleo. |
| Repo enorme | La fase 1 legge solo due livelli di cartelle e i file citati da `CLAUDE.md`: niente scansioni complete. |
