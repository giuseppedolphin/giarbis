// «Consumo»: le due percentuali del piano (finestra di 5 ore e settimana) da GET /api/consumo, che il server rilegge ogni
// 5 minuti. Al clic una tendina: due barre, stima a fine settimana, token di oggi per modello, ora della lettura; «dettaglio»
// apre il widget completo nella lavagna. Colore: ≥70% attenzione, ≥90% o stima oltre il limite critico, sempre col segno
// accanto (! o ⚠), mai il solo colore.
import { api } from "./api.js";
import { esc, giornoOra, livello, tok } from "./formati.js";
import { apriLavagna } from "./lavagna.js";

const AGGIORNA_MS = 60000;
const VECCHIO_MS = 15 * 60e3;
const MODELLI = { Opus: "opus", Sonnet: "sonnet", Haiku: "haiku", Fable: "fable" };
const pct = (w) => (w ? `${w.u}%` : "—");

function barra(titolo, w) {
  return `<div data-livello="${w ? livello(w.u) : ""}"><div class="r"><span>${titolo}</span><b>${pct(w)}</b></div>
    <div class="barra" role="img" aria-label="${titolo}: ${pct(w)}"><i style="width:${Math.min(w?.u || 0, 100)}%"></i></div>
    <div class="m">${w ? `si azzera ${giornoOra(w.reset)}` : "nessuna lettura valida per la finestra in corso"}</div></div>`;
}

function bloccoStima(c) {
  const s = c.stima, u7 = c.sette?.u || 0;
  if (!s || !c.sette) return "";
  const dettaglio = s.sbatti ? `⚠ limite ${giornoOra(s.sbatti)}` : s.fine >= 80 ? "! vicino al limite" : "✓ il limite non si tocca";
  return `<div class="stima"><div class="r"><span>Stima a fine settimana</span><b>~${s.fine}%</b></div>
    <div class="barra${s.fine >= 100 ? " oltre" : ""}" role="img" aria-label="usato ${u7}%, stima ${s.fine}%"><i style="width:${Math.min(u7, 100)}%"></i><u style="left:${Math.min(u7, 100)}%;width:${Math.max(0, Math.min(s.fine, 100) - Math.min(u7, 100))}%"></u></div>
    <div class="m">${dettaglio} · ${esc(s.nome)} · è una stima</div></div>`;
}

// Monta la tendina Consumo dopo l'elemento `dopo` della barra.
export function montaConsumo(dopo) {
  const consumo = document.createElement("details");
  consumo.className = "consumo"; consumo.id = "rdnav-consumo";
  consumo.innerHTML = '<summary><i aria-hidden="true"></i><span>Consumo</span></summary><div class="pop rdc"></div>';
  consumo.style.marginRight = "6px";
  dopo.after(consumo);
  const somm = consumo.querySelector("summary"), pop = consumo.querySelector(".pop");
  let percorso = "/lavagna/consumo-max.html";

  async function aggiorna() {
    try {
      const c = await api("GET", "/api/consumo");
      percorso = c.percorso || percorso;
      const alto = Math.max(c.cinque?.u ?? 0, c.sette?.u ?? 0);
      const liv = c.stima?.sbatti || alto >= 90 ? "critico" : livello(alto);
      const vecchio = c.lettura && Date.now() - c.lettura > VECCHIO_MS;
      consumo.dataset.livello = liv;
      if (vecchio) consumo.dataset.vecchio = ""; else delete consumo.dataset.vecchio;
      const segno = liv ? `<span class="seg" aria-hidden="true">${liv === "critico" ? "⚠" : "!"}</span>` : "";
      somm.innerHTML = `<i aria-hidden="true"></i>${segno}<span><span class="et">5 ore </span><b>${pct(c.cinque)}</b> · <span class="et">settimana </span><b>${pct(c.sette)}</b></span>`;
      somm.title = `Consumo del piano: finestra di 5 ore ${pct(c.cinque)}, settimana ${pct(c.sette)}`;
      const oggi = Object.entries(c.oggi || {});
      const token = oggi.length ? oggi.map(([m, n]) => `<span style="--c:var(--pl-${MODELLI[m] || "muted"})">${esc(m)} ${tok(n)}</span>`).join("") : "nessuno";
      const lettura = c.lettura ? `lettura ${giornoOra(c.lettura)}${vecchio ? ": nessuna sessione da allora" : ""}` : "nessuna lettura ancora";
      pop.innerHTML = `${barra("Finestra di 5 ore", c.cinque)}${barra("Settimana del piano", c.sette)}${bloccoStima(c)}
        <div><div class="m" style="margin-bottom:4px">Token di oggi su questo Mac</div><div class="mod">${token}</div></div>
        <div class="piede m"><span>${lettura}</span><a role="button" tabindex="0" data-dettaglio>dettaglio</a></div>`;
    } catch {
      somm.innerHTML = '<i aria-hidden="true"></i><span>Consumo</span>';
      somm.title = "Consumo del piano";
      pop.innerHTML = '<div class="m">Il server non dà ancora le percentuali: serve il Riavvia.</div><div class="piede m"><span></span><a role="button" tabindex="0" data-dettaglio>dettaglio</a></div>';
    }
  }

  const dettaglio = () => {
    consumo.open = false;
    const tema = document.documentElement.dataset.tema === "chiaro" ? "chiaro" : "scuro";
    apriLavagna({ titolo: "Consumo del piano Max", src: `${percorso}?tema=${tema}`, da: "" });
  };
  aggiorna();
  setInterval(aggiorna, AGGIORNA_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) aggiorna(); });
  consumo.addEventListener("toggle", () => { if (consumo.open) aggiorna(); });
  pop.addEventListener("click", (e) => { if (e.target.closest("[data-dettaglio]")) dettaglio(); });
  pop.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.closest("[data-dettaglio]")) { e.preventDefault(); dettaglio(); } });
  document.addEventListener("click", (e) => { if (consumo.open && !e.target.closest("#rdnav-consumo")) consumo.open = false; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && consumo.open) { consumo.open = false; somm.focus(); } });
  return consumo;
}
