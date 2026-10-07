# Prompt della plancia

Testi per i modelli, uno per file (`assistente.md`, `agente.md`, `foglio.md`, ...), letti da `server/prompt.mjs` a ogni uso.
Segnaposto `{{chiave}}`: `assistente`, `persona`, `ctl`, `modello_default`, `mappa` (più quelli che passa chi compone).
Un segnaposto senza valore è un errore: nessuna stringa vuota in silenzio.
I moduli accesi aggiungono in coda un frammento (`prompt: { assistente: "file.md" }` in `modulo.mjs`).
Si rileggono dal disco a ogni chiamata: per modificarli non serve il Riavvia.
