#!/usr/bin/env node
// La favicon della plancia: la sfera dell'assistente col suo volto (volto.js: vetro scuro col bordo acceso, occhi ad anello,
// bocca a onda), semplificata perché si legga a 16 px. Un solo disegno, tre file generati in questa cartella:
//   icona.svg              la favicon principale; segue il tema del sistema (prefers-color-scheme), come la barra delle schede
//   favicon.ico            ripiego per chi non legge l'SVG: PNG da 16, 32 e 48 px dentro un ICO
//   apple-touch-icon.png   180 px a fondo pieno (Safari e iOS)
// I colori si leggono da condivisi/palette.css (sonar e abisso, nei due temi): mai scritti a mano. Si rilancia dopo aver
// cambiato il disegno o la palette:  node plancia/pagine/icona/genera.mjs   (Node puro, niente pacchetti)
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const QUI = path.dirname(fileURLToPath(import.meta.url));

// ───── colori dalla palette ─────
const palette = readFileSync(path.join(QUI, "..", "condivisi", "palette.css"), "utf8");
function terna(blocco, nome) {
  const m = blocco.match(new RegExp(`--pl-${nome}-rgb:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)`));
  if (!m) throw new Error(`palette.css: manca --pl-${nome}-rgb`);
  return m.slice(1, 4).map(Number);
}
const scuroCss = palette.slice(palette.indexOf(":root{"), palette.indexOf(":root[data-tema=chiaro]"));
const chiaroCss = palette.slice(palette.indexOf(":root[data-tema=chiaro]"));
const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
function colori(css, chiaro) {
  const col = terna(css, "sonar"), abisso = terna(css, "abyss");
  // come sferaVetro in volto.js: nucleo scuro, alone che sale verso il bordo acceso; nel chiaro il vetro è chiaro e i tratti scuri
  const nucleo = chiaro ? mix(abisso, [255, 255, 255], 0.6) : mix(col.map((v) => v * 0.12), abisso, 0.5);
  return { col, abisso, nucleo, medio: mix(nucleo, col, 0.22), tratto: chiaro ? col : mix(col, [255, 255, 255], 0.6) };
}
const SCURO = colori(scuroCss, false), CHIARO = colori(chiaroCss, true);

// ───── il disegno, in un quadrato di 64 ─────
const R = 30, C = 32, BORDO = 3, SEGNO = 3.4;
const OCCHI = [-10, 10].map((dx) => ({ x: C + dx, y: 27, rx: 4.6, ry: 4.2 }));
const BOCCA = Array.from({ length: 13 }, (_, i) => { const u = i / 12; return { x: 21 + u * 22, y: 40 + Math.sin(Math.PI * u) * 2.6 }; });

// ───── SVG ─────
const hex = (c) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
const n = (v) => +v.toFixed(2);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<!-- GENERATO da genera.mjs in questa cartella (colori da condivisi/palette.css). Non si scrive a mano. -->
<style>
.s0{stop-color:${hex(SCURO.nucleo)}}.s1{stop-color:${hex(SCURO.medio)}}.s2{stop-color:${hex(SCURO.col)}}.b{stroke:${hex(SCURO.col)}}.t{stroke:${hex(SCURO.tratto)}}
@media (prefers-color-scheme:light){.s0{stop-color:${hex(CHIARO.nucleo)}}.s1{stop-color:${hex(CHIARO.medio)}}.s2{stop-color:${hex(CHIARO.col)}}.b{stroke:${hex(CHIARO.col)}}.t{stroke:${hex(CHIARO.tratto)}}}
</style>
<defs><radialGradient id="v" cx="${C}" cy="${C - 3}" r="${R}" gradientUnits="userSpaceOnUse"><stop offset="0" class="s0"/><stop offset=".7" class="s1"/><stop offset="1" class="s2"/></radialGradient></defs>
<circle cx="${C}" cy="${C}" r="${R}" fill="url(#v)"/>
<circle class="b" cx="${C}" cy="${C}" r="${R - BORDO / 2}" fill="none" stroke-width="${BORDO}"/>
<g class="t" fill="none" stroke-width="${SEGNO}" stroke-linecap="round" stroke-linejoin="round">
${OCCHI.map((o) => `<ellipse cx="${o.x}" cy="${o.y}" rx="${o.rx}" ry="${o.ry}"/>`).join("")}
<polyline points="${BOCCA.map((p) => `${n(p.x)},${n(p.y)}`).join(" ")}"/>
</g>
</svg>
`;

// ───── raster (tema scuro), 4×4 campioni per pixel ─────
function distSegmento(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, k = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (a.x + k * dx), py - (a.y + k * dy));
}
function colore(x, y, pieno) { // [r,g,b,a] del punto (x,y) nel quadrato di 64
  const c = SCURO, d = Math.hypot(x - C, y - C);
  let px = pieno ? [...c.abisso, 1] : [0, 0, 0, 0];
  if (d <= R) {
    const t = Math.hypot(x - C, y - (C - 3)) / R;
    const g = t < 0.7 ? mix(c.nucleo, c.medio, t / 0.7) : mix(c.medio, c.col, Math.min(1, (t - 0.7) / 0.3));
    px = [...(d >= R - BORDO ? c.col : g), 1];
    const occhio = OCCHI.some((o) => Math.abs(Math.hypot((x - o.x) / o.rx, (y - o.y) / o.ry) - 1) * Math.min(o.rx, o.ry) <= SEGNO / 2);
    const bocca = BOCCA.some((p, i) => i && distSegmento(x, y, BOCCA[i - 1], p) <= SEGNO / 2);
    if (occhio || bocca) px = [...c.tratto, 1];
  }
  return px;
}
function rgba(lato, pieno, scala = 1) { // pieno: fondo abisso a tutto quadro e sfera ridotta di `scala` (icona di iOS)
  const out = Buffer.alloc(lato * lato * 4), K = 4;
  for (let j = 0; j < lato; j++) for (let i = 0; i < lato; i++) {
    const s = [0, 0, 0, 0];
    for (let b = 0; b < K; b++) for (let a = 0; a < K; a++) {
      const x = ((i + (a + 0.5) / K) / lato * 64 - C) / scala + C, y = ((j + (b + 0.5) / K) / lato * 64 - C) / scala + C;
      const p = colore(x, y, pieno);
      for (let q = 0; q < 3; q++) s[q] += p[q] * p[3];
      s[3] += p[3];
    }
    const o = (j * lato + i) * 4;
    for (let q = 0; q < 3; q++) out[o + q] = s[3] ? Math.round(s[q] / s[3]) : 0;
    out[o + 3] = Math.round((s[3] / (K * K)) * 255);
  }
  return out;
}

// ───── PNG e ICO ─────
const CRC = Array.from({ length: 256 }, (_, k) => { let c = k; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function pezzo(tipo, dati) {
  const lun = Buffer.alloc(4), crc = Buffer.alloc(4), td = Buffer.concat([Buffer.from(tipo, "ascii"), dati]);
  lun.writeUInt32BE(dati.length); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([lun, td, crc]);
}
function png(lato, pixel) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lato, 0); ihdr.writeUInt32BE(lato, 4); ihdr[8] = 8; ihdr[9] = 6; // 8 bit, RGBA
  const righe = Buffer.alloc(lato * (lato * 4 + 1));
  for (let j = 0; j < lato; j++) pixel.copy(righe, j * (lato * 4 + 1) + 1, j * lato * 4, (j + 1) * lato * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pezzo("IHDR", ihdr), pezzo("IDAT", deflateSync(righe, { level: 9 })), pezzo("IEND", Buffer.alloc(0))]);
}
function ico(immagini) { // [{ lato, dati: png }]
  const testa = Buffer.alloc(6 + 16 * immagini.length);
  testa.writeUInt16LE(0, 0); testa.writeUInt16LE(1, 2); testa.writeUInt16LE(immagini.length, 4);
  let scarto = testa.length;
  immagini.forEach(({ lato, dati }, k) => {
    const o = 6 + 16 * k;
    testa[o] = lato % 256; testa[o + 1] = lato % 256; testa.writeUInt16LE(1, o + 4); testa.writeUInt16LE(32, o + 6);
    testa.writeUInt32LE(dati.length, o + 8); testa.writeUInt32LE(scarto, o + 12);
    scarto += dati.length;
  });
  return Buffer.concat([testa, ...immagini.map((i) => i.dati)]);
}

writeFileSync(path.join(QUI, "icona.svg"), svg);
writeFileSync(path.join(QUI, "favicon.ico"), ico([16, 32, 48].map((lato) => ({ lato, dati: png(lato, rgba(lato, false)) }))));
writeFileSync(path.join(QUI, "apple-touch-icon.png"), png(180, rgba(180, true, 0.8)));
console.log("scritti icona.svg, favicon.ico, apple-touch-icon.png in", QUI);
