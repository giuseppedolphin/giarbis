---
name: lavagna
description: Mostrare a chi usa il cockpit una cosa che si capisce meglio vista che detta - grafico, schema, tabella ricca, slide, animazione, video, immagine - aprendola sulla lavagna o come foglio sulla mappa del cockpit. Usare quando l'assistente o un agente del cockpit deve far vedere qualcosa, quando la persona dice "fammi vedere", "fammi un grafico", "mettimelo sulla mappa", o chiede di spegnere o togliere un foglio.
---

# lavagna — far vedere le cose nel cockpit

Il cockpit ha due posti dove far vedere: la **lavagna** (un riquadro grande, per guardare una cosa un attimo) e i
**fogli** (riquadri sopra la mappa degli agenti, che restano lì mentre si lavora). Il comando per parlare col
cockpit è `node plancia/ctl.mjs`: lo stesso in tutta questa skill.

## 1. Quando

Si mostra quando la risposta è un andamento, un confronto, una struttura, una sequenza, o quando la persona lo
chiede. A parole si dice in una frase cosa guardare; il resto lo fa la pagina. Non si mostra per abbellire una
risposta che sta bene a parole.

## 2. Come si fa il file

1. **Un file HTML solo, autosufficiente**, in `"$(node plancia/ctl.mjs cartella lavagna)/<nome>.html"` (fuori da
   git, mai un percorso fisso). Librerie solo da `cdnjs.cloudflare.com` (Chart.js per i grafici, D3 se serve di
   più), niente framework. Immagini e video accanto al file, citati col solo nome.
2. **I dati si leggono prima e si scrivono dentro il file** come JSON: il file gira in un riquadro isolato, senza
   accesso ai file della repo né a internet oltre la CDN.
3. **Riempie il riquadro**: `html,body{margin:0;height:100%}`, niente scroll orizzontale. Colori con
   `prefers-color-scheme` (il cockpit può essere chiaro o scuro).
4. **Slide**: una sezione per slide a tutto schermo, frecce e clic per avanzare, numero in basso. **Animazioni**:
   brevi, che spiegano un passaggio, rispettano `prefers-reduced-motion`.

## 3. Mostrare un attimo

```bash
node plancia/ctl.mjs mostra "$(node plancia/ctl.mjs cartella lavagna)/<nome>.html" "Titolo breve" --descrizione "una riga"
```

Se il cockpit non risponde, si dice alla persona il percorso del file da aprire a mano.

## 4. Fogli sulla mappa

```bash
node plancia/ctl.mjs foglio html <file.html> "titolo" --descrizione "una riga"
node plancia/ctl.mjs foglio tabella <file.json> "titolo" --descrizione "una riga"   # {"colonne":[…],"righe":[[…]]}
node plancia/ctl.mjs foglio immagine <file> "titolo" --descrizione "una riga"
node plancia/ctl.mjs fogli                            # tutti, accesi e spenti, con la descrizione
node plancia/ctl.mjs foglio leggi <id> --max 2000     # il solo testo di un foglio, troncato
node plancia/ctl.mjs foglio aggiorna <id> [--file <file>] [--titolo "…"] [--descrizione "…"]
node plancia/ctl.mjs foglio attiva|disattiva <id>     # spento = nascosto, non perso
node plancia/ctl.mjs chiudi-foglio <id>               # lo elimina del tutto
```

- Ogni foglio porta `--descrizione`: cosa contiene, in una riga, non il titolo ripetuto.
- Si tiene acceso ciò che serve adesso e si **spegne** il resto; `chiudi-foglio` solo per ciò che non servirà più.
  La persona ritrova tutto ciò che è stato prodotto in **Artifax** (pulsante nella barra in alto).
- Ogni foglio ha un pallino viola: apre una chat con un agente dedicato a quel foglio, che lo modifica. Lo usa la
  persona dalla pagina, non serve lanciarlo.
- Se c'è la to-do del cockpit: `node plancia/ctl.mjs foglio todo "titolo"` la apre sulla mappa, `todo chiudi <id> "esito"` spunta una voce.
