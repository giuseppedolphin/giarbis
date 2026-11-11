# Voce: una coda sola

Letta solo quando si tocca la voce dell'assistente (coda, pulsante, pannello, microfono, frase di chiamata).

`pagine/condivisi/voce-motore.js` è la **coda unica e seriale** delle cose da dire, condivisa fra cockpit e bolla: parla una sola scheda (possesso su `BroadcastChannel` `plancia-voce`), mai due audio insieme, un messaggio
nuovo va in coda dopo quello in corso. `deveLeggere(turno)`: i turni dell'assistente aperti da un agente (`origine: "agente"`) si leggono, quelli del battito no. **Pulsante della voce** (`pulsante-voce.js`, in cockpit e
bolla): visibile solo mentre l'assistente parla; quadrato = ferma se la coda è vuota, «>>» = prossimo se c'è altro; Esc ferma tutto (anche dal campo di testo, ma solo mentre parla). Il volto e il sonar leggono lo stato dalla coda. Pannello Voce unico
(`voce-pannello.js`), microfono e bip in `microfono.js`. **Dettatura a mano** (`cockpit/ascolto.js`, e la bolla dopo un clic): le pause non mandano, si manda solo con Invia o col secondo clic sul pallino; la frase di chiamata a mani libere manda ancora al silenzio. La frase di chiamata (`chiamata.js`) è un prefisso più il nome, mai il nome da solo: si costruisce da `assistente.chiamata` e `assistente.varianti` della config.
BroadcastChannel: `plancia-voce`, `plancia-cockpit`; localStorage sotto il prefisso `plancia.` (`memo.js`).
