// Il primo avvio: finché la plancia non ha una configurazione (/api/chi dice modalita «setup») una striscia in alto dice
// «Configurazione in corso». Quando la configurazione è scritta il server manda cockpit_setup con pronto: compare il pulsante
// «Avvia <assistente>», che fa il Riavvia di sempre (POST /api/riavvia) e, a server tornato, ricarica la pagina.
import { riavvia } from "./chat.js";
import { $, assistente, istanza } from "./comune.js";
import { su } from "/condivisi/eventi.js";

const ALTEZZA = "34px";
let avviato = false;

function mostra() {
  $("setup").hidden = false;
  document.documentElement.style.setProperty("--setup-h", ALTEZZA);
}

// «Avvia Nome»; con il nome predefinito («Assistente») suona meglio «Avvia l'assistente»
function etichettaAvvia(ev) {
  const nome = ev.assistente?.nome || (assistente.slug === "assistente" ? "" : assistente.nome);
  return nome ? `Avvia ${nome}` : "Avvia l'assistente";
}

function configurazionePronta(ev) {
  mostra();
  $("setup-t").textContent = "Configurazione pronta";
  const b = $("setup-avvia");
  b.hidden = false;
  b.disabled = false;
  b.textContent = etichettaAvvia(ev);
  b.onclick = async () => {
    b.disabled = true;
    avviato = true;
    await riavvia();
  };
}

function initSetup() {
  if (istanza.modalita === "setup") mostra();
  su("cockpit_setup", (ev) => { if (ev.pronto) configurazionePronta(ev); });
  su("_aperto", () => { if (avviato) location.reload(); }); // il server è ripartito: la pagina riparte con la configurazione nuova
}
export { initSetup };
