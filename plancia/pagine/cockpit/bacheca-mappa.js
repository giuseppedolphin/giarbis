// I comandi sulla mappa, disegnati sulla tela e legati ai pulsanti di sempre, che restano nascosti come regia:
// la bacheca (rettangolo sotto il campo delle sfere, apre il pannello «Bacheca»), l'ingranaggio sopra la sfera dell'assistente
// (menu: Squadra, Primo avvio, Visita guidata), il cuore del battito e la scopa di «Pulisci» accanto a lei. Più i pallini dei messaggi: un dm
// va da una sfera all'altra, un messaggio di bacheca alla bacheca (cockpit_squadra, nessun evento in più).
import { $, S, TEMA, assistente, eAssistente, nomeVisibile, persona } from "./comune.js";
import { conteggi } from "./bacheca.js";
import { api } from "/condivisi/api.js";
import { su } from "/condivisi/eventi.js";

const BM = { ultimo: null };
let V = null; // la vista della mappa: { M, schermo, righe, LONTANO }, data da initBachecaMappa
const P = {
  ingranaggio: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  scopa: "M14 3l5 5M13 4l-2.5 6.5M10.5 10.5L5 20h12l-1-9.5zM8 15h7M9.5 18h4",
  cuore: "M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 5 6.4 5c2 0 3.7 1.1 5.6 3 1.9-1.9 3.6-3 5.6-3 3.4 0 5.5 3.4 4 6.8C19.5 16.4 12 21 12 21z",
};
for (const k of Object.keys(P)) P[k] = new Path2D(P[k]);

// ---- le icone intorno alla sfera dell'assistente (posizioni nel mondo: seguono pan e zoom) ----------------------------
const centro = () => [...V.M.nodi.values()].find((n) => n.ruolo === "orchestratore");
const ICONE = [
  { k: "ing", dx: 0, dy: -84, glifo: "ingranaggio", titolo: () => "Impostazioni della squadra, primo avvio e visita guidata", clic: () => menu() },
  { k: "cuore", dx: 84, dy: -8, glifo: "cuore", colore: () => `rgb(${TEMA.coral})`, titolo: () => `Battito di ${assistente.nome}: acceso o spento, orari, ultimo scatto e ultima proposta`, clic: () => $("m-battito").click() },
  { k: "scopa", dx: -84, dy: -8, glifo: "scopa", spenta: () => $("m-pulisci").disabled, titolo: () => $("m-pulisci").title || "Pulisci", clic: () => $("m-pulisci").click() },
];
// Dove sta la sfera dell'assistente nella finestra: la visita guidata la lascia scoperta (la tela non ha un elemento per ogni sfera).
function sferaAssistente() {
  const c = V && centro(); if (!c) return null;
  const p = V.schermo(c.x, c.y), t = V.M.cv.getBoundingClientRect(), r = 52 * V.M.cam.z;
  return { left: t.left + p.x - r, top: t.top + p.y - r, right: t.left + p.x + r, bottom: t.top + p.y + r, width: r * 2, height: r * 2 };
}
function posIcona(i) { const c = centro(); return c ? V.schermo(c.x + i.dx, c.y + i.dy) : null; }
function disegnaIcone(cx) {
  const z = V.M.cam.z, s = Math.max(z, 0.6);
  for (const i of ICONE) {
    const p = posIcona(i); if (!p) continue;
    const r = 15 * s, su2 = V.M.sopra === i.k, spenta = i.spenta?.();
    cx.save(); cx.globalAlpha = spenta ? 0.4 : 1;
    cx.beginPath(); cx.arc(p.x, p.y, r, 0, Math.PI * 2);
    cx.fillStyle = `rgba(${TEMA.fondo},.85)`; cx.fill();
    cx.strokeStyle = `rgba(${TEMA.sonar},${su2 ? 0.9 : 0.45})`; cx.lineWidth = 1.5; cx.stroke();
    cx.translate(p.x - 9 * s, p.y - 9 * s); cx.scale(0.75 * s, 0.75 * s);
    cx.lineWidth = 1.8 / (0.75 * s); cx.lineCap = cx.lineJoin = "round";
    const col = i.colore?.() || `rgb(${TEMA.testo2})`;
    if (i.glifo === "cuore") { cx.fillStyle = col; cx.fill(P.cuore); } else { cx.strokeStyle = col; cx.stroke(P[i.glifo]); }
    cx.restore();
  }
}
// ---- la bacheca: sotto il campo delle sfere, centrata sui bersagli dei nodi (ferma anche mentre le sfere si assestano) ----
function box() {
  const n = [...V.M.nodi.values()]; if (!n.length) return null;
  const w = 230, h = 56;
  return { x: (Math.min(...n.map((v) => v.tx)) + Math.max(...n.map((v) => v.tx))) / 2 - w / 2, y: Math.max(...n.map((v) => v.ty)) + 105, w, h };
}
function disegnaBacheca(cx) {
  const b = box(); if (!b) return;
  const { M, schermo, righe, LONTANO } = V, z = M.cam.z, p = schermo(b.x, b.y), w = b.w * z, h = b.h * z, zt = Math.max(z, 0.5);
  cx.beginPath(); cx.roundRect(p.x, p.y, w, h, 12 * z);
  cx.fillStyle = `rgba(${TEMA.sonar},${M.sopra === "bacheca" ? 0.14 : 0.07})`; cx.fill();
  cx.strokeStyle = `rgba(${TEMA.sonar},.45)`; cx.lineWidth = 1.5; cx.stroke();
  // la bacheca di sughero: tavola, due biglietti e due puntine
  const u = 34 * zt / 34, ox = p.x + 10 * z, oy = p.y + (h - 30 * u) / 2;
  cx.fillStyle = "#b98a55"; cx.strokeStyle = "#7a5630"; cx.lineWidth = 1.5; cx.beginPath(); cx.roundRect(ox, oy, 34 * u, 30 * u, 3); cx.fill(); cx.stroke();
  cx.fillStyle = "#f4f0d8"; cx.fillRect(ox + 5 * u, oy + 5 * u, 11 * u, 8 * u); cx.fillStyle = "#cfe8ff"; cx.fillRect(ox + 18 * u, oy + 7 * u, 11 * u, 9 * u); cx.fillStyle = "#ffe3a8"; cx.fillRect(ox + 9 * u, oy + 18 * u, 15 * u, 7 * u);
  cx.fillStyle = "#d2453d"; cx.beginPath(); cx.arc(ox + 10 * u, oy + 5 * u, 1.6 * u, 0, 7); cx.fill(); cx.fillStyle = "#3d7fd2"; cx.beginPath(); cx.arc(ox + 23 * u, oy + 7 * u, 1.6 * u, 0, 7); cx.fill();
  cx.textAlign = "left"; cx.textBaseline = "alphabetic";
  const tx = ox + 34 * u + 10 * z;
  cx.font = `600 ${Math.round(13 * zt)}px Bricolage Grotesque, sans-serif`; cx.fillStyle = `rgb(${TEMA.testo})`; cx.fillText("Bacheca", tx, p.y + 22 * z);
  const c = conteggi(), n = c.nuovi;
  if (n || c.tag) { // il contatore: i messaggi nuovi, in corallo quanti taggano la persona
    const t = c.tag ? `@${c.tag}` : String(n), bw = (t.length * 7 + 12) * zt;
    cx.fillStyle = c.tag ? `rgb(${TEMA.coral})` : "#f2a54a"; cx.beginPath(); cx.roundRect(p.x + w - bw - 6 * z, p.y - 8 * z, bw, 17 * zt, 9 * zt); cx.fill();
    cx.fillStyle = "#111"; cx.font = `700 ${Math.round(11 * zt)}px Instrument Sans, sans-serif`; cx.textAlign = "center"; cx.fillText(t, p.x + w - bw / 2 - 6 * z, p.y + 4.5 * z); cx.textAlign = "left";
  }
  if (z < LONTANO) return;
  cx.font = `${Math.round(11.5 * zt)}px Instrument Sans, sans-serif`; cx.fillStyle = `rgb(${TEMA.testo2})`;
  const ul = BM.ultimo, riga = ul ? `${nomeVisibile(ul.da)}: ${String(ul.testo).replace(/\s+/g, " ")}` : "ancora nessun messaggio";
  cx.fillText(righe(cx, riga, w - (tx - p.x) - 10 * z)[0] || "", tx, p.y + 40 * z);
}
const titoloBacheca = "Bacheca della squadra: la chat di gruppo, i messaggi diretti fra gli agenti e il ponte con l'altra plancia";
const disegna = (cx) => { disegnaBacheca(cx); disegnaIcone(cx); };
// cosa c'è sotto il punto (x, y) della tela: la bacheca o un'icona, con il suo titolo e cosa fa al clic
function sopra(x, y) {
  if (!V) return null;
  for (const i of ICONE) { const p = posIcona(i); if (p && Math.hypot(p.x - x, p.y - y) <= 17 * Math.max(V.M.cam.z, 0.6)) return { k: i.k, titolo: i.titolo(), clic: i.clic }; }
  const b = box(); if (!b) return null;
  const p = V.schermo(b.x, b.y), z = V.M.cam.z;
  return x >= p.x && x <= p.x + b.w * z && y >= p.y && y <= p.y + b.h * z ? { k: "bacheca", titolo: titoloBacheca, clic: () => $("m-bacheca").click() } : null;
}
// ---- il menu dell'ingranaggio: la squadra e il primo avvio (la checklist, nascosta dalla barra a lavoro finito) ----------
function menu() {
  let m = $("m-menu-squadra");
  if (!m) {
    m = document.createElement("div"); m.id = "m-menu-squadra"; m.className = "m-menu"; m.hidden = true;
    m.innerHTML = '<button type="button" data-v="m-squadra">Squadra: accesa, intervalli</button><button type="button" data-v="m-avvio">Primo avvio: checklist</button><button type="button" data-v="m-visita">Visita guidata</button>';
    m.addEventListener("click", (e) => { e.stopPropagation(); const v = e.target.closest("[data-v]")?.dataset.v; m.hidden = true; if (v) $(v).click(); });
    document.addEventListener("click", () => { m.hidden = true; });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !m.hidden) { e.stopPropagation(); m.hidden = true; } }, true);
    V.M.cv.closest(".mappa").appendChild(m);
  }
  const i = ICONE[0], p = posIcona(i);
  m.style.left = Math.max(8, p.x + 20) + "px"; m.style.top = Math.max(8, p.y - 10) + "px"; m.hidden = !m.hidden;
}

// ---- i pallini: dal mittente al destinatario, o alla bacheca --------------------------------------------------------------
function chiaveDi(slug) {
  if (slug && slug === persona.slug) return "tu";
  const s = [...S.sessioni.values()].find((x) => (eAssistente(slug) ? x.ruolo === "orchestratore" : x.ruolo === "squadra" && x.nome === slug));
  return s ? (s.ruolo === "orchestratore" ? "j:" : "a:") + s.id : null;
}
function pallino(da, a) { if (da && a) { V.M.impulsi.push({ da, a, t0: performance.now(), diretto: true }); V.M.sporca = true; } }

function initBachecaMappa(vista) {
  V = vista;
  api("GET", "/api/squadra/bacheca?n=1").then(({ messaggi }) => { BM.ultimo = messaggi[messaggi.length - 1] || null; }).catch(() => {});
  su("cockpit_squadra", (ev) => {
    const m = ev.messaggio; if (!m || (ev.azione !== "bacheca" && ev.azione !== "dm")) return;
    pallino(chiaveDi(m.da), ev.azione === "dm" ? chiaveDi(m.a) : "bacheca");
    if (ev.azione === "bacheca") BM.ultimo = m;
  });
  // un clic su un comando della mappa non deve arrivare al documento: i pannelli si chiudono al clic fuori
  V.M.cv.addEventListener("click", (e) => { const r = V.M.cv.getBoundingClientRect(); if (sopra(e.clientX - r.left, e.clientY - r.top)) e.stopPropagation(); });
}
export { BM, box, disegna, initBachecaMappa, sferaAssistente, sopra };
