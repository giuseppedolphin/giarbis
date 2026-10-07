// Gli agenti di foglio: un pallino viola sul bordo di ogni foglio; il primo clic fa nascere l'agente di quel foglio
// (POST /api/fogli/:id/agente, sonnet), poi foglio e chat si aprono affiancati: il foglio occupa la mappa a sinistra, la chat
// sta nel pannello di destra. «← Mappa» (o Esc) rimette il foglio al suo posto e chiude la chat.
import { $, S, STATO, mostraBanner } from "./comune.js";
import { apri, chiudi } from "./chat.js";
import { C, accendiFoglio } from "./fogli.js";
import { vistaMappa } from "./mappa.js";
import { api } from "/condivisi/api.js";

const agenteDi = (idFoglio) => [...S.sessioni.values()].find((s) => s.foglio === idFoglio) || null;

// il pallino di ogni foglio segue la sua sessione: vuoto se l'agente non è ancora nato, pieno e col suo stato se c'è
function aggiornaPallini() {
  for (const [id, el] of C.el) {
    const p = el.querySelector(".foglio-pallino"); if (!p) continue;
    const s = agenteDi(id);
    p.className = `foglio-pallino${s ? ` nato ${s.stato}` : ""}`;
    p.title = s ? `${s.nome}: ${STATO[s.stato] || s.stato}. Clic per la chat accanto al foglio`
      : "Parla con un agente dedicato a questo foglio (nasce al primo clic)";
    p.setAttribute("aria-label", p.title);
  }
}

async function apriAgenteFoglio(idFoglio) {
  try {
    const { sessione } = await api("POST", `/api/fogli/${idFoglio}/agente`);
    S.sessioni.set(sessione.id, { ...(S.sessioni.get(sessione.id) || {}), ...sessione });
    affianca(idFoglio);
    await apri(sessione.id);
    aggiornaPallini();
  } catch (e) {
    mostraBanner(e.message, 6000);
  }
}

// foglio a sinistra (sopra la mappa) e chat a destra, nella schermata di sempre
function affianca(idFoglio) {
  const el = C.el.get(idFoglio); if (!el) return;
  vistaMappa(true);
  if (C.dati.get(idFoglio)?.attiva === false) accendiFoglio(idFoglio, true);
  staccaFogli(false);
  el.classList.remove("piena"); el.classList.add("affiancato"); el.style.zIndex = ++C.z;
}

// rimette i fogli affiancati al loro posto; con chiudiChat anche la chat si chiude (ritorno alla mappa)
function staccaFogli(chiudiChat = true) {
  const aperti = document.querySelectorAll(".foglio.affiancato");
  aperti.forEach((el) => el.classList.remove("affiancato"));
  if (chiudiChat && aperti.length && S.aperta) chiudi();
}

function initAgentiFoglio() {
  // il clic sul pallino (delegato: i fogli nascono e muoiono) e sul pulsante «← Mappa» del foglio affiancato
  $("fogli").addEventListener("click", (e) => {
    const p = e.target.closest(".foglio-pallino"); if (p) { e.stopPropagation(); apriAgenteFoglio(p.closest(".foglio").dataset.id); return; }
    if (e.target.closest('[data-a="mappa"]')) staccaFogli(true);
  });
  $("fogli").addEventListener("pointerdown", (e) => { if (e.target.closest(".foglio-pallino")) e.stopPropagation(); }, true);
  document.addEventListener(
    "keydown",
    (e) => { if (e.key === "Escape" && document.querySelector(".foglio.affiancato") && document.activeElement?.id !== "in-s") staccaFogli(true); }
  );
}

export { agenteDi, aggiornaPallini, apriAgenteFoglio, initAgentiFoglio, staccaFogli };
