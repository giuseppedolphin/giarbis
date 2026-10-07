// Il cockpit: punto d'ingresso. Chiede a /api/chi chi usa la pagina e come si chiama l'assistente, carica le pagine dei moduli
// accesi (che registrano i loro tipi di foglio e i loro esempi), collega i moduli e li inizializza nello stesso ordine del
// vecchio script unico (l'ordine conta per i listener di Esc e di focus, registrati su document e window), poi apre lo stream.
import { initAllegati } from "./allegati.js";
import { initDettatura, initPossesso, initSveglia } from "./ascolto.js";
import { initFogli, registraTipoFoglio } from "./fogli.js";
import { initAgentiFoglio } from "./agenti-foglio.js";
import { initFumetti } from "./fumetti.js";
import { initProposte } from "./proposte.js";
import { aggiornaInvia, initChat, initModello, registraEsempi, rendiPannello, rendiStat, vista } from "./chat.js";
import { $, assistente, caricaChi, istanza, leggiPalette, md, mostraBanner } from "./comune.js";
import { initMappa } from "./mappa.js";
import { initSetup } from "./setup.js";
import { initSonar } from "./sonar.js";
import { initTimer } from "./timer.js";
import { initVoce } from "./voce.js";
import { BASE } from "/condivisi/api.js";
import { fraseChiamata } from "/condivisi/chiamata.js";
import { connetti } from "/condivisi/eventi.js";
import { apriLavagna } from "/condivisi/lavagna.js";
import { caricaPalette } from "/condivisi/stile.js";

// Chi usa la pagina e come si chiama l'assistente: arrivano prima di ogni disegno (senza server restano i valori neutri).
await caricaChi();
await caricaPalette();
leggiPalette(); // i colori del canvas, ora che la palette c'è

// Il nome dell'assistente e la frase di chiamata non sono scritti nella pagina: dove c'è data-t, data-title, data-placeholder
// o data-label il testo è un modello con {nome} e {chiamata}.
function applicaNome() {
  const sostituisci = (t) => t.replaceAll("{nome}", assistente.nome).replaceAll("{chiamata}", fraseChiamata(assistente));
  const attributi = { t: null, title: "title", placeholder: "placeholder", label: "aria-label" };
  for (const [dato, attributo] of Object.entries(attributi)) {
    document.querySelectorAll(`[data-${dato}]`).forEach((el) => {
      const testo = sostituisci(el.dataset[dato]);
      if (attributo) el.setAttribute(attributo, testo); else el.textContent = testo;
    });
  }
  document.title = `${assistente.nome} — cockpit`;
}
applicaNome();

// Le pagine dei moduli accesi: ognuna esporta una funzione che riceve ciò che il cockpit offre. Si aspetta che abbiano finito
// prima di aprire lo stream, così ogni foglio trova il suo disegnatore già registrato.
async function caricaPagineModuli() {
  const offerta = { registraTipoFoglio, registraEsempi, mostraBanner, md };
  const caricamenti = istanza.moduli.filter((m) => m.pagina).map((m) => import(BASE + m.pagina)
    .then((mod) => mod.default?.(offerta))
    .catch((e) => console.error(`pagina del modulo ${m.nome}:`, e)));
  await Promise.all(caricamenti);
}
await caricaPagineModuli();

// la lavagna si apre anche da fuori del cockpit con apriLavagna({ titolo, src, da })
window.apriLavagna = apriLavagna;

initModello();
initAllegati();
initChat();
initDettatura();
initVoce();
initSonar();
initSveglia();
initMappa();
initFogli();
initTimer();
initAgentiFoglio();
initFumetti();
initProposte();
initSetup();
setInterval(rendiStat, 30000);
initPossesso();

// La bolla della barra sa che il cockpit è aperto e gli lascia la voce delle risposte non sue.
if ("BroadcastChannel" in window) {
  const bc = new BroadcastChannel("plancia-cockpit");
  setInterval(() => bc.postMessage("cockpit-vivo"), 2000);
  bc.postMessage("cockpit-vivo");
}
addEventListener("resize", () => vista($("app").dataset.vista));
rendiPannello();
aggiornaInvia();
connetti();
