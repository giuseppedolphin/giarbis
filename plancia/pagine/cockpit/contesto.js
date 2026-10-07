// Il cerchiolino della finestra di contesto: un anello piccolo che si riempie, nella testata di ogni chat (l'assistente in alto, la
// sessione aperta nel pannello) e accanto a ogni sfera della mappa (disegnaContesto, chiamata da mappa.js). Legge `s.contesto`, che
// il server tiene aggiornato dal flusso (server/contesto.mjs). Verde, giallo da 70%, rosso da 90% (vicino alla compattazione
// automatica); ↺ se la conversazione è stata compattata. Diverso dall'anello di avanzamento, che sta attorno alla sfera e non ha numeri.
import { nomeModello } from "./comune.js";
import { esc, ora, tok } from "/condivisi/formati.js";

// { p: percentuale o null, livello: ""|"attenz"|"critico", testo, righe } — null se non c'è niente da mostrare
function datiContesto(s) {
  const c = s?.contesto;
  if (!c || (c.usati == null && !c.compattata)) return null;
  const p = c.usati != null && c.finestra ? Math.min(100, Math.round((c.usati / c.finestra) * 100)) : null;
  const livello = p == null ? "" : p >= 90 ? "critico" : p >= 70 ? "attenz" : "";
  const come = c.compattata?.trigger === "manual" ? "a mano" : "in automatico";
  const prima = c.compattata?.prima ? `, prima erano ${tok(c.compattata.prima)} token` : "";
  const comp = c.compattata ? `compattata ${come} alle ${ora(c.compattata.t)}${prima}` : "";
  const finestra = c.finestra ? ` su ${tok(c.finestra)} token (${p}%)` : " token (la finestra del modello si conosce a fine turno)";
  const righe = [
    c.usati == null ? "Contesto appena compattato: il conto riparte dal prossimo messaggio" : `Contesto: ${tok(c.usati)}${finestra}`,
    c.modello ? `Modello: ${nomeModello(c.modello)}` : "",
    livello ? "Vicino alla compattazione automatica" : "",
    comp ? comp[0].toUpperCase() + comp.slice(1) : "",
  ].filter(Boolean);
  return { p, usati: c.usati, livello, compattata: !!c.compattata, testo: c.usati == null ? "↺" : p != null ? `${p}%` : tok(c.usati), righe };
}
export const testoContesto = (s) => datiContesto(s)?.righe.join("\n") || "";

// testata della chat: anello SVG di 16 px e la percentuale accanto
export function cerchioContesto(s) {
  const d = datiContesto(s);
  if (!d) return "";
  const R = 6, L = 2 * Math.PI * R, pieno = ((d.p ?? 0) / 100) * L;
  return `<span class="ctx"${d.livello ? ` data-livello="${d.livello}"` : ""} title="${esc(d.righe.join("\n"))}" aria-label="${esc(d.righe.join(". "))}">`
    + `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle class="ctx-pista" cx="8" cy="8" r="${R}"/>`
    + `<circle class="ctx-pieno" cx="8" cy="8" r="${R}" stroke-dasharray="${pieno.toFixed(2)} ${L.toFixed(2)}" transform="rotate(-90 8 8)"/></svg>`
    + `<span class="ctx-n">${d.testo}</span>${d.compattata && d.p != null ? '<span class="ctx-c" aria-hidden="true">↺</span>' : ""}</span>`;
}

// mappa: un piccolo quadrante staccato in alto a sinistra della sfera, col numero dentro. Restituisce la posizione per il passaggio
// del mouse (title), o null. col = { sonar, sand, coral, testo, testo2, fondo } come terne RGB.
export function disegnaContesto(cx, s, p, r, z, col) {
  const d = datiContesto(s);
  if (!d) return null;
  const R = 11 * z, dist = r + 7 * z + R + 5 * z, a = -Math.PI * 0.75;
  const q = { x: p.x + Math.cos(a) * dist, y: p.y + Math.sin(a) * dist, r: R };
  const tinta = d.livello === "critico" ? col.coral : d.livello === "attenz" ? col.sand : col.sonar;
  cx.save();
  cx.beginPath(); cx.arc(q.x, q.y, R, 0, Math.PI * 2); cx.fillStyle = `rgba(${col.fondo},.94)`; cx.fill();
  cx.lineWidth = 2.2 * z; cx.strokeStyle = `rgba(${col.testo2},.22)`; cx.stroke();
  if (d.p) {
    cx.beginPath();
    cx.arc(q.x, q.y, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.02, d.p / 100));
    cx.strokeStyle = `rgb(${tinta})`;
    cx.lineCap = "round";
    cx.stroke();
  }
  // dentro: la percentuale; senza finestra nota i token in migliaia; appena compattato ↺
  const dentro = d.p != null ? String(d.p) : d.usati == null ? "↺" : `${Math.round(d.usati / 1000)}k`;
  cx.fillStyle = `rgb(${d.livello ? tinta : col.testo})`;
  cx.font = `600 ${Math.round((dentro.length > 2 ? 7.5 : 9) * z)}px Instrument Sans, sans-serif`;
  cx.textAlign = "center";
  cx.textBaseline = "middle";
  cx.fillText(dentro, q.x, q.y + 0.5);
  cx.restore();
  return q;
}
