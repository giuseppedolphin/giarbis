# Prova da zero

Da fare prima di ogni versione. Si seguono **solo** le istruzioni del README, come chi lo installa per la prima volta.
Mai sulla porta di un cockpit già acceso. Stato e cartella di prova in una cartella temporanea, cancellati alla fine.

1. Prefisso npm di prova, per non toccare l'installazione globale vera:
   `export NPM_CONFIG_PREFIX=/tmp/giarbis-prova/npm && export PATH=/tmp/giarbis-prova/npm/bin:$PATH`
2. Il comando di installazione del README, oppure dalla cartella del pacchetto `npm install -g .` (stesso contenuto, prima del
   push) → nessun errore.
3. `giarbis controlla` → le spunte del README.
4. Cartella finta: `mkdir -p /tmp/giarbis-prova/progetto && cd $_ && git init -q`, un `CLAUDE.md` finto (un progetto
   inventato, tre righe), un `README.md` e un `TODO.md` con due caselle.
5. `giarbis` → il messaggio del README, la pagina in modalità setup, il primo messaggio dell'agente di setup.
6. Setup completo dalla chat: nome, nome dell'assistente, piano, voce del browser, to-do sì, battito no; sì a tutte le
   proposte. Controlli: `plancia.config.json` valido e uguale a quello mostrato; `.plancia/prompt/assistente.md` ≤ 40
   righe; `.gitignore` con `.plancia/`; `.claude/skills/lavagna/SKILL.md` con il percorso vero di `ctl`; nessun file scritto
   prima del sì (`git status` prima e dopo la fase 5).
7. «Avvia» → l'assistente si presenta; `giarbis ctl lista` lo mostra; un agente lanciato dalla chat compare sulla mappa;
   il foglio della to-do mostra le due voci; una voce si spunta.
8. Ctrl+C nel terminale → si ferma anche dopo il Riavvia; nessun processo `claude -p` rimasto.
9. `node scripts/scansione.mjs --storia` nella cartella del pacchetto → pulita.
