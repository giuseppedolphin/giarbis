# Prompt del pacchetto

Testi che il pacchetto mette al posto di quelli del nucleo. Lo script di import li copia in `plancia/prompt/`
(stesso meccanismo: `server/prompt.mjs`, segnaposto `{{chiave}}`, un segnaposto senza valore è un errore).

| File | Chi lo usa | Note |
|---|---|---|
| `setup.md` | la sessione `setup` del primo avvio | `{{modello_config}}` lo sostituisce l'import col contenuto di `modelli/plancia.config.esempio.json`; gli altri segnaposto sono quelli del nucleo (`ctl`, `mappa`) |
| `primo-avvio.md` | il primo messaggio automatico all'agente di setup | |
| `benvenuto.md` | il primo messaggio automatico all'assistente, dopo il setup | |
