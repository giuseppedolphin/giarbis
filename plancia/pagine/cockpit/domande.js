// Le domande nel cockpit (la casella sta in condivisi/domande.js, montata dalla barra): il segno «?» sulla sfera di chi
// ha chiesto (clic = la tendina filtrata su quella sessione), la voce per le domande urgenti (coda unica di voce-motore.js),
// «apri la chat» e «apri il foglio» dalla tendina, i link /cockpit#chat=<id> e #foglio=<id> che arrivano dalle dashboard
// (il pulsante «Battito» della mappa apre il suo pannello: battito.js).
import { S, mostraBanner } from "./comune.js";
import { apri } from "./chat.js";
import { C, accendiFoglio, trovaFoglio } from "./fogli.js";
import { aggiornaFumetti } from "./fumetti.js";
import { aperteDi, apriDomande, suDomande } from "/condivisi/domande.js";
import { diUrgente } from "/condivisi/voce-motore.js";

const segni = new Map(); // id della sessione → { x, y, r } del segno disegnato in questo fotogramma

// il segno sulla sfera: in alto a destra (il cerchiolino del contesto sta in alto a sinistra), col numero se più di una
export function disegnaSegnoDomande(cx, s, p, r, zt, colori) {
  const n = s ? aperteDi(s.id).length : 0;
  if (!n) { if (s) segni.delete(s.id); return false; }
  const x = p.x + r * 0.75, y = p.y - r * 0.75, rr = (n > 1 ? 10 : 9) * zt;
  cx.save();
  cx.beginPath(); cx.arc(x, y, rr, 0, Math.PI * 2);
  cx.fillStyle = `rgb(${colori.coral})`; cx.shadowColor = `rgb(${colori.coral})`; cx.shadowBlur = 10; cx.fill();
  cx.shadowBlur = 0; cx.lineWidth = 1.5; cx.strokeStyle = `rgb(${colori.fondo})`; cx.stroke();
  cx.fillStyle = "#fff"; cx.textAlign = "center"; cx.textBaseline = "middle";
  cx.font = `700 ${Math.round((n > 1 ? 10 : 12) * zt)}px Instrument Sans, sans-serif`;
  cx.fillText(n > 1 ? `?${n}` : "?", x, y + 0.5);
  cx.restore();
  segni.set(s.id, { x, y, r: rr });
  return true;
}
export function segnoA(x, y) {
  // solo le sessioni che ci sono ancora e hanno domande aperte: una sfera sparita non resta cliccabile
  for (const [id, q] of segni) if (S.sessioni.has(id) && aperteDi(id).length && Math.hypot(q.x - x, q.y - y) <= q.r + 4) return { id };
  return null;
}
export const testoSegno = (id) => {
  const a = aperteDi(id);
  return a.length ? `${a.length === 1 ? "Ti chiede" : `${a.length} domande`}: ${a.map((q) => q.testo).join(" · ")} — clic per rispondere` : "";
};
export const apriDomandeDi = (id) => apriDomande({ sessione: id });

function apriFoglio(id) {
  const f = C.dati.get(id);
  if (!f) { mostraBanner("Quel foglio non c'è più.", 4000); return; }
  if (f.attiva === false) accendiFoglio(id, true);
  trovaFoglio(id);
}

// /cockpit#chat=<id> e #foglio=<id> (da «apri la chat» sulle dashboard): appena le sessioni e i fogli ci sono
function seguiAncora() {
  const m = location.hash.match(/^#(chat|foglio)=(.+)$/);
  if (!m) return;
  const chiave = decodeURIComponent(m[2]);
  let giri = 0;
  const prova = () => {
    const pronto = m[1] === "chat" ? S.sessioni.has(chiave) : C.dati.has(chiave);
    if (pronto) { history.replaceState(null, "", location.pathname); if (m[1] === "chat") apri(chiave); else apriFoglio(chiave); return; }
    if (++giri < 40) setTimeout(prova, 250);
  };
  prova();
}

export function initDomande() {
  suDomande((ev) => {
    aggiornaFumetti();
    const q = ev?.domanda;
    if (q?.urgente && (ev.azione === "nuova" || ev.azione === "ripresa")) {
      const chi = q.tipo === "proposta" ? `${q.da.nome} propone` : `${q.da.nome} ti chiede`;
      diUrgente(`${chi}: ${q.testo}`, `domanda:${q.id}:${q.creata}`);
    }
  });
  addEventListener("plancia:apri-chat", (e) => {
    const id = e.detail?.sessione;
    if (!id || !S.sessioni.has(id)) { mostraBanner("Quella sessione non c'è più.", 4000); return; }
    document.getElementById("rdnav-domande")?.removeAttribute("open");
    apri(id);
  });
  addEventListener("plancia:apri-foglio", (e) => { document.getElementById("rdnav-domande")?.removeAttribute("open"); apriFoglio(e.detail?.id); });
  seguiAncora();
}
