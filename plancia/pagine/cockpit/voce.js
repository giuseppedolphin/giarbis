// La voce dell'assistente nel cockpit: collega gli eventi del suo turno alla coda unica di condivisi/voce-motore.js (la stessa
// della bolla: una cosa alla volta, parla una scheda sola) e monta il pannello Voce, il pulsante stop/avanti e l'interruttore.
// Cosa si legge lo decide deveLeggere(turno): i turni aperti da te o da un agente sì, quelli del battito no (salvo l'urgente).
import { $, S } from "./comune.js";
import { su } from "/condivisi/eventi.js";
import { montaPulsanteVoce } from "/condivisi/pulsante-voce.js";
import { accendiVoce, attesaPensiero, dì, guardiaTurno, sbloccaVoce, voceAccesa } from "/condivisi/voce-motore.js";
import { montaPannelloVoce } from "/condivisi/voce-pannello.js";

// La guardia di turno sta nel motore (guardiaTurno): un flusso per turno, stop e «avanti» silenziano anche il resto del turno.
const G = guardiaTurno();
let contaTurni = 0;

function chiudiTurno() {
  G.chiudi();
  attesaPensiero.annulla();
}
function apriTurno(ev) {
  chiudiTurno();
  S.turno = { id: ++contaTurni, origine: ev.origine || "" };
  attesaPensiero.nuovoTurno();
  G.apri(`${S.orchestratore}:${S.turno.id}`, S.turno);
}
// il flusso su cui scrivere adesso, o null se questo turno non si legge (o è stato fermato)
function segmento() {
  if (!S.turno.id) apriTurno({}); // pagina aperta a turno già iniziato: non si sa chi l'ha aperto, si legge
  return G.segmento();
}

const dellAssistente = (ev) => ev.id === S.orchestratore;

function initVoce() {
  su("cockpit_utente", (ev) => { if (dellAssistente(ev)) apriTurno(ev); });
  su("delta", (ev) => { if (dellAssistente(ev)) segmento()?.nutri(ev.testo); });
  su("delta_pensa", (ev) => {
    if (!dellAssistente(ev)) return;
    G.chiudiSegmento();
    attesaPensiero.avvia(S.turno);
  });
  su("delta_tool", (ev) => { if (dellAssistente(ev)) G.chiudiSegmento(); });
  su("assistant", (ev) => {
    if (!dellAssistente(ev)) return;
    if ((ev.blocchi || []).some((b) => b.type === "text")) attesaPensiero.testoArrivato();
    G.chiudiSegmento();
  });
  for (const tipo of ["fine", "cockpit_errore", "cockpit_azzerata", "cockpit_rimossa"]) {
    su(tipo, (ev) => { if (dellAssistente(ev)) chiudiTurno(); });
  }

  // il pannello Voce (motore, modello, voce, velocità, tono, «Salva e prova») e l'interruttore «Risposte a voce»
  const pannello = montaPannelloVoce($("pop-voce-corpo"));
  const pop = $("pop-voce");
  pop.addEventListener("toggle", () => { if (pop.open) pannello.ricarica(); });
  document.addEventListener("click", (e) => { if (!e.target.closest("#pop-voce")) pop.open = false; });
  const interruttore = $("voce");
  const mostraInterruttore = () => interruttore.setAttribute("aria-pressed", voceAccesa());
  mostraInterruttore();
  interruttore.onclick = () => {
    accendiVoce(!voceAccesa());
    mostraInterruttore();
    if (voceAccesa()) { sbloccaVoce(); dì("Voce attiva.", { subito: true }); }
  };
  // il pulsante stop/avanti: sulla mappa, sopra il volto (lo piazza mappa.js), e accanto al microfono; visibile solo mentre parla
  montaPulsanteVoce($("voce-comando"));
  montaPulsanteVoce($("voce-comando-centro"));
}
export { initVoce };
