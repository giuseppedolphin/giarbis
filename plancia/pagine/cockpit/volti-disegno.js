// I volti dei ruoli della squadra (proposta scelta): lo stesso vetro di volto.js con quattro facce, una per tipo
// (campo `volto` di un ruolo, nel file dei ruoli del modulo). Qui solo disegno e numeri, nessun accesso alla pagina: lo prova anche
// test/controlli/volti.mjs. Prestazioni: la faccia si disegna in una tela propria e si ridisegna solo quando cambia la `chiave`
// (espressione, passo dell'animazione, misura, colore); la mappa a ogni fotogramma copia soltanto l'immagine, senza `shadowBlur`.
const TIPI = ["casco", "visiera", "scintille", "occhiali"];
const STATI = ["riposo", "attende", "pensa", "lavora", "contento", "preoccupato", "sorpreso", "ferma"];

const rgba = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mix = (a, b, k) => a.map((x, i) => x + (b[i] - x) * k);
const lit = (c, n) => c.map((x) => Math.min(255, x + n));
const batte = (t, per, dur = 170) => { const k = t % per; return k < dur ? Math.sin((Math.PI * k) / dur) : 0; };

// la sfera di vetro, comune con l'assistente (volto.js)
function sferaVetro(cx, x, y, r, col, fioco, t, alone) {
  const core = mix(col.map((v) => v * 0.12), [4, 14, 24], 0.5);
  const g = cx.createRadialGradient(x, y - r * 0.1, r * 0.1, x, y, r);
  g.addColorStop(0, rgba(core)); g.addColorStop(0.7, rgba(mix(core, col, 0.22))); g.addColorStop(1, rgba(col, 0.95 - fioco * 0.4));
  cx.save(); cx.shadowColor = rgba(col, 0.75 * (1 - fioco)); cx.shadowBlur = alone;
  cx.beginPath(); cx.arc(x, y, r, 0, Math.PI * 2); cx.fillStyle = g; cx.fill(); cx.restore();
  cx.save(); cx.beginPath(); cx.arc(x, y, r - 1, 0, Math.PI * 2); cx.clip();
  for (let i = 0; i < 2; i++) {
    const k = (t / 3600 + i / 2) % 1;
    cx.beginPath();
    cx.arc(x, y, r * (0.15 + 0.85 * k), 0, Math.PI * 2);
    cx.strokeStyle = rgba(col, (1 - k) * 0.22 * (1 - fioco));
    cx.lineWidth = 1.2;
    cx.stroke();
  }
  cx.restore();
  cx.beginPath();
  cx.arc(x, y, r * 0.86, Math.PI * 1.08, Math.PI * 1.38);
  cx.strokeStyle = "rgba(255,255,255,.22)";
  cx.lineWidth = Math.max(1, r * 0.04);
  cx.lineCap = "round";
  cx.stroke();
}

// ---- l'espressione: un solo stato, che viene dai segnali veri dell'agente (volti.js) -------------------------------
function espressione(stato, t, seme = 0, verso = { x: -0.6, y: 0.6 }) {
  const u = t + seme * 1700, sguardo = [0, 0.3, 0, -0.3][Math.floor(u / 2300) % 4];
  const e = { stato, open: 1, gx: 0, gy: 0, sop: 0, bocca: "base", arco: false, ansia: false, puntini: false, lavoro: false, fioco: 0 };
  switch (stato) {
    case "riposo": e.gx = sguardo; e.open = 1 - batte(u, 4300); break;
    case "attende": e.gx = verso.x * 0.7; e.gy = verso.y * 0.6; e.sop = 0.5; e.open = 1 - batte(u, 3900); break;
    case "pensa": e.gx = 0.5; e.gy = -0.8; e.open = 0.86; e.bocca = "piatta"; e.puntini = true; break;
    case "lavora": e.gx = Math.sin(u / 620); e.gy = 0.35; e.open = 0.6; e.lavoro = true; break;
    case "contento": e.arco = true; e.bocca = "sorriso"; break;
    case "preoccupato": e.ansia = true; e.gx = -0.25; e.gy = 0.22; e.open = 0.9 - batte(u, 3900) * 0.9; e.sop = -1; e.bocca = "ansia"; break;
    case "sorpreso": e.open = 1.25; e.sop = 1; e.bocca = "o"; break;
    case "ferma": e.open = 0.12; e.bocca = "piatta"; e.fioco = 0.4; break;
  }
  return e;
}
// il passo dell'animazione: finché resta uguale, l'immagine in tela non si ridisegna. A riposo cambia solo con un battito o uno sguardo
function passoVolto(stato, t, seme = 0) {
  const u = t + seme * 1700;
  if (stato === "lavora" || stato === "pensa") return Math.floor(u / 160);
  if (stato === "contento") return Math.floor(u / 200);
  if (stato === "riposo") return `${Math.floor(u / 2300) % 4}.${batte(u, 4300) > 0.3 ? 1 : 0}`;
  if (stato === "attende" || stato === "preoccupato") return batte(u, stato === "attende" ? 3900 : 3900) > 0.3 ? 1 : 0;
  return 0;
}

// ---- i pezzi comuni ------------------------------------------------------------------------------------------------
function bocca(cx, x, y, r, tipo, t) {
  cx.beginPath();
  if (tipo === "o") { cx.arc(x, y, r * 0.09, 0, Math.PI * 2); cx.stroke(); return; }
  if (tipo === "sorriso") { cx.moveTo(x - r * 0.34, y - r * 0.05); cx.quadraticCurveTo(x, y + r * 0.34, x + r * 0.34, y - r * 0.05); cx.stroke(); return; }
  if (tipo === "ansia") {
    for (let i = 0; i <= 24; i++) { const u = i / 24, X = x - r * 0.3 + u * r * 0.6, Y = y + r * 0.05 - Math.sin(Math.PI * u) * r * 0.1 + Math.sin(u * 26 + t / 45) * r * 0.012; i ? cx.lineTo(X, Y) : cx.moveTo(X, Y); }
    cx.stroke(); return;
  }
  cx.moveTo(x - r * 0.2, y); cx.lineTo(x + r * 0.2, y); cx.stroke(); // piatta
}
function occhioPieno(cx, x, y, rx, ry, e, lw) {
  if (e.arco) { cx.beginPath(); cx.arc(x, y + ry * 0.7, rx * 1.5, Math.PI * 1.12, Math.PI * 1.88); cx.stroke(); return; }
  cx.beginPath(); cx.ellipse(x, y, rx, Math.max(ry * Math.min(e.open, 1.3), lw * 0.4), 0, 0, Math.PI * 2); cx.fill();
}
function puntini(cx, x, y, r, t) {
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + t / 420 + i * 0.42;
    cx.save(); cx.globalAlpha *= 1 - i * 0.28; cx.beginPath(); cx.arc(x + Math.cos(a) * r * 0.82, y + Math.sin(a) * r * 0.82, r * (0.06 - i * 0.012), 0, Math.PI * 2); cx.fill(); cx.restore();
  }
}

// ---- le quattro facce: `e` dice l'espressione, il disegno il carattere -----------------------------------------------
const FACCE = {
  // caschetto da cantiere, sguardo fisso, bocca a spunta
  casco(cx, x, y, r, e, t, lw) {
    const gx = 0.1 * r * e.gx, gy = 0.05 * r * e.gy;
    cx.beginPath(); cx.arc(x, y - r * 0.14, r * 0.74, Math.PI, 0); cx.closePath(); cx.save(); cx.globalAlpha *= 0.22; cx.fill(); cx.restore(); cx.stroke();
    cx.beginPath(); cx.moveTo(x, y - r * 0.88); cx.lineTo(x, y - r * 0.56); cx.stroke();
    for (const s of [-1, 1]) {
      const incl = e.ansia ? -0.14 : 0.1 - e.sop * 0.06;
      cx.beginPath(); cx.moveTo(x + s * r * 0.46 + gx, y - r * (0.02 + e.sop * 0.03) - r * incl * 0.5); cx.lineTo(x + s * r * 0.12 + gx, y + r * incl - r * e.sop * 0.03); cx.stroke();
      occhioPieno(cx, x + s * r * 0.3 + gx, y + r * 0.2 + gy, r * 0.09, r * 0.1, e, lw);
    }
    if (e.bocca !== "base") { bocca(cx, x, y + r * 0.56, r, e.bocca, t); return; }
    cx.beginPath(); cx.moveTo(x - r * 0.24, y + r * 0.5); cx.lineTo(x - r * 0.07, y + r * 0.66); cx.lineTo(x + r * 0.31, y + r * 0.38); cx.stroke();
  },
  // visiera unica con due fessure che scandiscono, antenna, bocca a onda quadra
  visiera(cx, x, y, r, e, t, lw) {
    const w = r * 0.66, h = r * 0.2, yy = y - r * 0.1;
    cx.beginPath(); cx.roundRect(x - w, yy - h, w * 2, h * 2, h * 0.7); cx.stroke();
    for (const s of [-1, 1]) {
      const px = x + s * r * 0.3 + e.gx * r * 0.1;
      if (e.arco) { cx.beginPath(); cx.arc(px, yy + h * 0.5, r * 0.12, Math.PI * 1.1, Math.PI * 1.9); cx.stroke(); continue; }
      const alta = h * 1.1 * Math.max(Math.min(e.open, 1.25), 0.14), inclina = e.ansia ? s * 0.28 : 0;
      cx.save(); cx.translate(px, yy + e.gy * h * 0.2); cx.rotate(inclina); cx.beginPath(); cx.roundRect(-r * 0.13, -alta / 2, r * 0.26, alta, r * 0.03); cx.fill(); cx.restore();
    }
    const ax = e.ansia ? -r * 0.1 : e.sop > 0 ? r * 0.1 : 0;
    cx.beginPath(); cx.moveTo(x + r * 0.28, yy - h); cx.lineTo(x + r * 0.4 + ax, y - r * 0.78); cx.stroke();
    cx.beginPath(); cx.arc(x + r * 0.42 + ax, y - r * 0.8, lw * 0.9, 0, Math.PI * 2); cx.fill();
    if (e.bocca !== "base") { bocca(cx, x, y + r * 0.42, r, e.bocca, t); return; }
    const my = y + r * 0.42, passi = 6, a = r * 0.08, l = r * 0.68, sc = e.lavoro ? Math.floor(t / 240) : 0; cx.beginPath();
    for (let i = 0; i <= passi; i++) {
      const X = x - l / 2 + (i * l) / passi, su = ((i + sc) % 2 ? -1 : 1) * a;
      i ? cx.lineTo(X, my + su) : cx.moveTo(X, my + su);
      if (i < passi) cx.lineTo(X + l / passi, my + su);
    }
    cx.stroke();
  },
  // occhiolino, sorriso largo, scintille attorno
  scintille(cx, x, y, r, e, t, lw) {
    const allegro = e.bocca === "base" || e.bocca === "sorriso", y0 = y - r * 0.02;
    if (e.arco || (allegro && e.stato === "riposo")) { cx.beginPath(); cx.arc(x - r * 0.3, y0, r * 0.2, Math.PI * 1.1, Math.PI * 1.9); cx.stroke(); }
    else occhioPieno(cx, x - r * 0.3 + e.gx * r * 0.06, y - r * 0.1, r * 0.1, r * 0.13, e, lw);
    if (e.arco) { cx.beginPath(); cx.arc(x + r * 0.3, y0, r * 0.2, Math.PI * 1.1, Math.PI * 1.9); cx.stroke(); }
    else if (e.open < 0.4) occhioPieno(cx, x + r * 0.3, y - r * 0.1, r * 0.1, r * 0.13, e, lw);
    else { cx.beginPath(); cx.arc(x + r * 0.3 + e.gx * r * 0.06, y - r * 0.1, r * 0.13 * Math.min(e.open, 1.25), 0, Math.PI * 2); cx.stroke(); }
    if (e.ansia) { for (const s of [-1, 1]) { cx.beginPath(); cx.moveTo(x + s * r * 0.48, y - r * 0.2); cx.lineTo(x + s * r * 0.14, y - r * 0.4); cx.stroke(); } }
    if (allegro) {
      cx.beginPath(); cx.moveTo(x - r * 0.5, y + r * 0.24); cx.quadraticCurveTo(x, y + r * 0.36, x + r * 0.5, y + r * 0.24); cx.quadraticCurveTo(x, y + r * 0.94, x - r * 0.5, y + r * 0.24); cx.closePath();
      cx.save(); cx.globalAlpha *= 0.3; cx.fill(); cx.restore(); cx.stroke();
    } else bocca(cx, x, y + r * 0.5, r, e.bocca, t);
    if (e.stato === "ferma" || e.ansia) return;
    const giro = e.lavoro || e.arco ? t / 700 : 0.6;
    for (let i = 0; i < 3; i++) {
      const a = giro + i * 2.1, px = x + Math.cos(a) * r * 0.78, py = y + Math.sin(a) * r * 0.78, s = r * (0.11 - i * 0.02);
      cx.beginPath(); cx.moveTo(px - s, py); cx.lineTo(px + s, py); cx.moveTo(px, py - s); cx.lineTo(px, py + s); cx.stroke();
    }
  },
  // occhiali tondi, un sopracciglio alzato, bocca piatta, barre di un grafico
  occhiali(cx, x, y, r, e, t, lw) {
    const gx = 0.06 * r * e.gx, gy = 0.05 * r * e.gy;
    for (const s of [-1, 1]) {
      cx.beginPath(); cx.arc(x + s * r * 0.32, y - r * 0.08, r * 0.23, 0, Math.PI * 2); cx.stroke();
      if (e.arco) { cx.beginPath(); cx.arc(x + s * r * 0.32, y - r * 0.02, r * 0.11, Math.PI * 1.1, Math.PI * 1.9); cx.stroke(); continue; }
      cx.beginPath(); cx.ellipse(x + s * r * 0.32 + gx, y - r * 0.08 + gy, r * 0.075, Math.max(r * 0.075 * Math.min(e.open, 1.3), lw * 0.35), 0, 0, Math.PI * 2); cx.fill();
    }
    cx.beginPath(); cx.moveTo(x - r * 0.09, y - r * 0.1); cx.lineTo(x + r * 0.09, y - r * 0.1); cx.stroke();
    const su = e.sop * r * 0.05;
    cx.beginPath(); cx.moveTo(x - r * 0.56, y - r * (e.ansia ? 0.38 : 0.46) - su); cx.lineTo(x - r * 0.12, y - r * (e.ansia ? 0.5 : 0.44) - su); cx.stroke();
    cx.beginPath(); cx.moveTo(x + r * 0.12, y - r * (e.ansia ? 0.5 : 0.5) - su); cx.quadraticCurveTo(x + r * 0.34, y - r * (e.ansia ? 0.46 : 0.66) - su, x + r * 0.56, y - r * (e.ansia ? 0.38 : 0.54) - su); cx.stroke();
    bocca(cx, x, y + r * 0.42, r, e.bocca === "base" ? "piatta" : e.bocca, t);
    cx.save(); cx.globalAlpha *= 0.75; cx.lineWidth = lw * 0.7; cx.beginPath();
    for (let i = 0; i < 5; i++) {
      const X = x - r * 0.34 + i * r * 0.17, hh = r * (0.05 + (e.lavoro ? 0.05 * (1 + Math.sin(t / 700 + i * 1.3)) : 0.04) + i * 0.02), Y = y + r * 0.72;
      cx.moveTo(X, Y); cx.lineTo(X, Y - hh);
    }
    cx.stroke(); cx.restore();
  },
};

// disegna vetro e faccia in un contesto; `col` è la terna del colore del ruolo
function disegnaFaccia(cx, x, y, r, tipo, col, e, t) {
  sferaVetro(cx, x, y, r, col, e.fioco, 900, 0); // il vetro è fermo: l'anello e l'alone della mappa dicono già se lavora
  const luce = lit(col, 120), lw = Math.max(1.5, r * 0.075);
  cx.save();
  cx.globalAlpha = 1 - e.fioco * 0.6; cx.strokeStyle = rgba(luce); cx.fillStyle = rgba(luce); cx.shadowColor = rgba(col); cx.shadowBlur = r * 0.18; cx.lineWidth = lw; cx.lineCap = "round"; cx.lineJoin = "round";
  FACCE[tipo](cx, x, y, r, e, t, lw);
  if (e.puntini) puntini(cx, x, y, r, t);
  cx.restore();
}

// La tela della faccia di un ruolo: una per slug, ridisegnata solo se cambia la chiave. crea(px) dà una tela quadrata.
const CHUNK = 16;
const misuraPx = (r, d) => Math.min(256, Math.max(32, Math.ceil((2 * r * d) / CHUNK) * CHUNK));
function tavolozza(crea) {
  const tele = new Map();
  return function immagine(slug, tipo, stato, r, d, col, t, seme, verso) {
    const px = misuraPx(r, d), passo = passoVolto(stato, t, seme);
    const v = stato === "attende" ? `${Math.round(verso.x * 3)},${Math.round(verso.y * 3)}` : "";
    const chiave = `${tipo}|${stato}|${passo}|${px}|${col.map(Math.round)}|${v}`;
    let c = tele.get(slug);
    if (c?.chiave === chiave) return c.tela;
    if (!c || c.px !== px) { c = { px, tela: crea(px), disegni: c?.disegni || 0 }; tele.set(slug, c); }
    const cx = c.tela.getContext("2d");
    cx.setTransform(1, 0, 0, 1, 0, 0); cx.clearRect(0, 0, px, px);
    disegnaFaccia(cx, px / 2, px / 2, px / 2 - 1, tipo, col, espressione(stato, t, seme, verso), t);
    c.chiave = chiave; c.disegni++;
    return c.tela;
  };
}

export { STATI, TIPI, disegnaFaccia, espressione, misuraPx, passoVolto, sferaVetro, tavolozza };
