# Giarbis

Giarbis è un **cockpit per Claude Code**: una pagina nel browser dove un assistente lavora sul tuo progetto insieme
a te e, quando un lavoro è lungo, lo affida ad altri agenti Claude Code che lavorano in parallelo. Li vedi tutti su
una mappa, a che punto sono, cosa stanno facendo. Puoi scrivergli o parlargli a voce («Hey Giarbis»), e lui ti fa
vedere grafici, tabelle e schemi su dei fogli sopra la mappa.

Gira sul tuo computer e usa il tuo abbonamento a Claude: non serve nessuna chiave a pagamento in più.

---

## Cosa ti serve prima

1. **Node.js**, versione 20 o più recente. Per vedere se ce l'hai, apri il Terminale e scrivi:
   ```
   node --version
   ```
   Se vedi qualcosa come `v22.16.0` sei a posto. Se vedi `command not found`, scaricalo da
   [nodejs.org](https://nodejs.org) (il pulsante «LTS») e installalo come un programma qualsiasi.
2. **Claude Code**, installato e collegato al tuo account Claude (Pro o Max). Prova:
   ```
   claude --version
   ```
   Se non c'è, segui [le istruzioni ufficiali](https://docs.claude.com/en/docs/claude-code/setup). Poi scrivi
   `claude` una volta, fai il login quando te lo chiede, ed esci con `/exit`.
3. **git**. Sul Mac c'è già, o te lo propone il sistema la prima volta che lo usi: `git --version` per controllare.
4. **Google Chrome** (consigliato): la voce e il riconoscimento di «Hey Giarbis» funzionano meglio lì.

---

## Installazione (una volta sola)

Nel Terminale:

```
npm install -g github:giuseppedolphin/giarbis
```

Cosa vedi: qualche secondo di attesa e poi una riga tipo `added 1 package in 4s`. Se vedi un errore con
`EACCES` o `permission denied`, guarda [Problemi frequenti](#problemi-frequenti).

Per controllare che sia tutto a posto:

```
giarbis controlla
```

Cosa vedi: un elenco di spunte, tipo

```
✓ Node 22.16.0
✓ Claude Code 2.1.292, collegato come marco@esempio.it
✓ git
· nessuna configurazione in questa cartella: al primo avvio parte il setup
```

Se una riga ha la ✗, accanto c'è scritto cosa fare.

---

## Primo avvio

1. Nel Terminale, vai nella cartella del tuo progetto. Per esempio:
   ```
   cd ~/progetti/mio-progetto
   ```
2. Lancia:
   ```
   giarbis
   ```
   Cosa vedi nel Terminale: `Primo avvio: la configurazione si fa nel browser, su http://127.0.0.1:4747/  (per
   fermarlo premi Ctrl+C)`. Il browser si apre da solo su quella pagina (se non si apre, copia l'indirizzo nel browser). **Lascia il Terminale aperto**: se lo chiudi, Giarbis si ferma.
3. Sulla pagina vedi una mappa con una sola sfera, l'**agente di setup**, e accanto la sua chat. È lui che parla
   per primo. Ti fa qualche domanda, una alla volta, e per ognuna ti propone già una risposta:
   - ti dice cosa ha capito del tuo progetto (legge il tuo `CLAUDE.md` e il README, se ci sono);
   - come ti chiami e come vuoi chiamare l'assistente (puoi tenere «Giarbis» o sceglierne un altro);
   - che abbonamento Claude hai, per scegliere il modello giusto;
   - se vuoi la voce, la to-do e il battito (spiegati più sotto).
4. Prima di scrivere qualcosa ti fa vedere **cosa scrive e dove**, su un foglio sulla mappa, e aspetta il tuo sì.
   Nella tua cartella crea `plancia.config.json` (la configurazione) e la cartella `.plancia/` (lo stato di Giarbis,
   che resta solo sul tuo computer). Tutto il resto (una riga nel `.gitignore`, una skill, un paragrafo nel tuo
   `CLAUDE.md`) te lo chiede una cosa alla volta.
5. Alla fine, nella striscia in alto della pagina, compare il pulsante **«Avvia»**. Premilo: la pagina si ricarica e al posto
   dell'agente di setup c'è il tuo assistente, che si presenta.

Ci vogliono cinque minuti. Se ti interrompi a metà, rilancia `giarbis`: il setup riprende da dove era.

### Se vuoi la voce "vera"

Senza fare niente, Giarbis parla con la voce del browser (gratis, un po' robotica). Per una voce naturale serve una
chiave di [OpenAI](https://platform.openai.com/api-keys) o di [ElevenLabs](https://elevenlabs.io), a pagamento su
quel conto (pochi centesimi al giorno). **Non scriverla mai nella chat**: il setup ti prepara il file
`.plancia/chiavi.env` nella tua cartella, tu lo apri con un editor di testo e incolli la chiave dopo l'uguale:

```
OPENAI_API_KEY=sk-...
```

Poi premi «Riavvia» in alto nella pagina.

---

## Uso di tutti i giorni

```
cd ~/progetti/mio-progetto
giarbis
```

e lavori nel browser. Ctrl+C nel Terminale per fermarlo.

- **Parlare con l'assistente**: scrivi nella chat in alto, o tieni premuto il microfono, o di' **«Hey Giarbis»**
  seguito da cosa vuoi. Lui risponde a voce (se l'hai accesa) e per iscritto.
- **Gli agenti**: quando chiedi una cosa lunga («sistemami i test», «scrivi la pagina dei prezzi»), l'assistente
  lancia un agente che ci lavora in parallelo. Lo vedi sulla mappa come una sfera collegata all'assistente;
  l'anello attorno si riempie man mano che avanza. Clic sulla sfera per vedere cosa fa, doppio clic per parlargli.
  Quando finisce, l'assistente te lo dice.
- **I fogli**: grafici, tabelle e schemi che l'assistente o gli agenti ti fanno vedere compaiono come riquadri sopra
  la mappa. Si spostano, si ingrandiscono, si spengono col «–». Il pallino viola sul bordo apre una chat dedicata a
  quel foglio («fallo a barre», «aggiungi una colonna»). Tutto quello che è stato prodotto lo ritrovi in
  **Artifax**, in alto.
- **Il modello**: in alto accanto al nome dell'assistente scegli Sonnet (veloce, consuma poco), Opus (più bravo,
  consuma molto di più) o Haiku. Vale anche per ogni agente, dalla sua scheda.
- **Il consumo**: il pulsante «Consumo» in alto ti dice quanto del tuo piano Claude hai usato nelle ultime 5 ore e
  nella settimana. Ogni agente consuma il tuo piano: con tanti agenti insieme il limite arriva prima.
- **La to-do** (se l'hai accesa): un foglio con le voci aperte del tuo `TODO.md`. Puoi spuntarle tu o dire
  all'assistente «segna come fatta la voce sul logo».
- **Il battito** (se l'hai acceso): a orari fissi Giarbis guarda se c'è qualcosa che ti aspetta (un agente che ha
  una domanda, una scadenza) e, solo se c'è, ti propone **una** cosa da fare, con Sì / No / Più tardi. Si accende e
  spegne dal pulsante «Battito» sulla mappa.

### Comandi a voce

Funzionano in Chrome, col microfono permesso alla pagina. Si dice **«Hey Giarbis»** (o «Ehi Giarbis») e poi la
frase, tutto di fila; quando smetti di parlare il messaggio parte. Il nome da solo non lo sveglia, apposta.

| Dici | Succede |
|---|---|
| «Hey Giarbis, cosa stanno facendo gli agenti?» | Ti riassume la mappa |
| «Hey Giarbis, fammi vedere i commit di questa settimana in un grafico» | Apre un foglio col grafico |
| «Hey Giarbis, lancia un agente che sistema i test» | Nasce un agente sulla mappa |
| «Hey Giarbis, ferma l'agente dei test» | Lo interrompe |
| «Hey Giarbis, passa a Sonnet» | Cambia il suo modello |
| «Hey Giarbis» mentre parla | Lo interrompe e ascolta te |
| tasto **Esc** | Lo zittisce |

Se hai dato un altro nome all'assistente, si dice «Hey» più quel nome.

### Aggiornare Giarbis

Rilancia lo stesso comando dell'installazione: `npm install -g github:giuseppedolphin/giarbis`. La configurazione e lo
stato nella tua cartella non si toccano.

### Cambiare la configurazione

```
giarbis setup
```

Riparte l'agente di setup, che legge la configurazione di adesso e ti chiede solo cosa vuoi cambiare.

---

## Problemi frequenti

**`npm install -g` dà `EACCES` o `permission denied`.** Node è installato in una cartella di sistema. Soluzione
che non chiede la password:
```
mkdir -p ~/.npm-global
npm config set prefix ~/.npm-global
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.zshrc
source ~/.zshrc
```
e rilancia `npm install -g github:giuseppedolphin/giarbis`.

**`giarbis: command not found`.** Chiudi e riapri il Terminale. Se non basta, è lo stesso problema di sopra: segui
quei quattro comandi.

**`giarbis controlla` dice che Claude Code non è collegato.** Scrivi `claude` nel Terminale, fai il login, esci con
`/exit` e rilancia.

**La pagina non si apre da sola.** Copia l'indirizzo che vedi nel Terminale (`http://127.0.0.1:...`) nel browser.

**Dice che la porta è occupata.** Giarbis ne prende un'altra da solo e te la scrive: usa quella. Per sceglierla tu:
`giarbis --porta 4800`.

**«Hey Giarbis» non funziona.** Usa Chrome; la prima volta il browser chiede il permesso del microfono: dai «Consenti».
Se l'hai negato, clic sul lucchetto a sinistra dell'indirizzo → Microfono → Consenti, e ricarica la pagina.
Con le casse alte senza cuffie il microfono può sentire Giarbis che parla.

**La voce è robotica.** È quella del browser: vedi «Se vuoi la voce "vera"».

**Un agente resta fermo con un errore di permessi.** Gli agenti non possono chiederti conferme a metà lavoro, quindi
quello che di solito Claude Code ti chiederebbe viene rifiutato. Dì all'assistente cosa voleva fare l'agente: ti
propone come farlo, o te lo fa fare a mano.

**Ho finito il piano Claude in un attimo.** Ogni agente consuma il tuo abbonamento. Usa Sonnet per gli agenti
(selettore del modello), lancia meno agenti insieme, e tieni il battito spento.

**Voglio fermare tutto.** Ctrl+C nel Terminale. Gli agenti si fermano con lui; quando rilanci `giarbis` li ritrovi
sulla mappa, fermi, con la loro conversazione.

**Voglio togliere Giarbis da un progetto.** Cancella `plancia.config.json` e la cartella `.plancia/` (e, se le avevi
accettate, `.claude/skills/lavagna/` e il paragrafo nel `CLAUDE.md`). Per disinstallarlo del tutto:
`npm uninstall -g giarbis`.

---

## Cosa fa Giarbis sul tuo computer, in breve

- Avvia un piccolo server raggiungibile **solo dal tuo computer** (`127.0.0.1`).
- Lancia Claude Code (lo stesso programma che usi nel Terminale) una volta per l'assistente e una per ogni agente,
  nella cartella del tuo progetto. Possono leggere e modificare i file del progetto e lanciare comandi, come Claude
  Code quando lo usi tu, ma senza poterti chiedere conferma: quello che chiederebbe conferma viene rifiutato.
- Non manda niente a nessuno oltre a quello che manda già Claude Code (e, se l'hai accesa, il testo da leggere ad alta
  voce al servizio della voce che hai scelto).
- Tiene tutto quello che gli serve in `.plancia/` nella tua cartella.

Per chi vuole metterci le mani: [docs/architettura.md](docs/architettura.md) e [docs/primo-avvio.md](docs/primo-avvio.md).

## Licenza

MIT, vedi [LICENSE](LICENSE). Giarbis usa Claude Code, che resta soggetto ai termini di Anthropic e del tuo abbonamento.
