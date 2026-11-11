// I colori della squadra: ogni capo ha un colore forte, i suoi esecutori sfumature dello stesso colore, distinguibili fra
// fratelli; un colore per tema (scuro e chiaro), sempre col contrasto da testo (4,5:1) sullo sfondo dei pannelli.
// Una fonte sola: il campo `colore` dei capi nel file dei ruoli (da lì si prendono tinta e saturazione; la luminosità la
// decide il tema), e per un capo senza colore una tinta scelta qui, lontana da quelle già prese. Sfondi e colori riservati
// (viola dei fogli, corallo delle menzioni, il colore dell'assistente) si leggono dalla palette delle pagine, palette.css:
// nessun valore copiato a mano.
//
//   leggiPalette([file]) → { scuro, chiaro } (terne --pl-*-rgb di ogni tema)
//   coloriSquadra(ruoli, [palette]) → Map slug → { scuro: "#rrggbb", chiaro: "#rrggbb" }   (errore se un colore è riservato)
//   contrasto(a, b) · deltaE(a, b) · hex(rgb) · rgb(hex)   (per i controlli)
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PALETTE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "pagine", "condivisi", "palette.css");
const TESTO = 4.5; // contrasto minimo per il testo (WCAG AA)
const RISERVATI = ["foglio", "violet", "coral", "sonar"]; // fogli, menzioni, assistente: nessun ruolo ci si avvicina
const LONTANO = 22; // distanza minima (ΔE) di un colore di ruolo da un riservato
// tinte di riserva per i capi senza colore, negli spazi lasciati liberi dai riservati
const TINTE = [25, 210, 88, 310, 50, 128, 195, 290, 70, 145, 10, 330];
// le sfumature degli esecutori, in ordine: posizione nella fascia di luminosità del tema (0 = la più accesa, 1 = la più
// lontana dallo sfondo), scarto di tinta e quota della saturazione del capo; il capo sta a 0,2
const CAPO = 0.2;
const SFUMATURE = [{ p: 1, dt: 0, s: 0.85 }, { p: 0.55, dt: 8, s: 0.6 }, { p: 0.1, dt: -8, s: 0.45 }, { p: 0.8, dt: -6, s: 0.45 }, { p: 0.35, dt: 6, s: 1 }];

// ───── conversioni ─────
export const rgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || "").trim()); return m ? m[1].match(/../g).map((x) => parseInt(x, 16)) : null; };
export const hex = (c) => `#${c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0")).join("")}`;
function hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l * 100];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s * 100, l * 100];
}
function daHsl(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map((n) => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
}
const lineare = (x) => { x /= 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
const luminanza = (c) => { const [r, g, b] = c.map(lineare); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrasto = (a, b) => { const x = luminanza(a), y = luminanza(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
function lab(c) {
  const [r, g, b] = c.map(lineare);
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), y = f(0.2126 * r + 0.7152 * g + 0.0722 * b), z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
export const deltaE = (a, b) => { const p = lab(a), q = lab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
const distTinta = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };

// ───── la palette delle pagine ─────
export function leggiPalette(file = PALETTE) {
  const css = readFileSync(file, "utf8");
  const blocco = (sel) => { const i = css.indexOf(`${sel}{`); return i < 0 ? "" : css.slice(i, css.indexOf("}", i)); };
  const terne = (b) => Object.fromEntries([...b.matchAll(/--pl-([a-z0-9-]+)-rgb:\s*(\d+)\s+(\d+)\s+(\d+)/g)].map((m) => [m[1], [+m[2], +m[3], +m[4]]]));
  const scuro = terne(blocco(":root")), chiaro = { ...scuro, ...terne(blocco(":root[data-tema=chiaro]")) };
  for (const k of ["panel", "abyss", "deep", ...RISERVATI]) if (!scuro[k]) throw new Error(`palette: manca --pl-${k}-rgb in ${file}`);
  return { scuro, chiaro };
}

// gli sfondi su cui sta il testo: si misura il contrasto col peggiore
const sfondi = (t) => ["panel", "abyss", "deep"].map((k) => t[k]);
const regge = (c, t) => sfondi(t).every((f) => contrasto(c, f) >= TESTO);

// la fascia di luminosità leggibile per una tinta in un tema: [la più accesa, la più lontana dallo sfondo]
function fascia(h, s, t, scuro) {
  const ok = (l) => regge(daHsl(h, s, l), t);
  if (scuro) { let l = 30; while (l < 95 && !ok(l)) l += 0.5; return [l, Math.max(l, 74)]; } // non oltre 74: più chiaro diventa bianco, il colore della persona
  let l = 70; while (l > 5 && !ok(l)) l -= 0.5; return [l, Math.min(l, 22)];
}
function tono(h, s, p, t, scuro) {
  const [a, b] = fascia((h + 360) % 360, s, t, scuro);
  return daHsl((h + 360) % 360, s, a + (b - a) * p);
}

// la tinta di riserva per un capo senza colore: la più lontana da quelle già prese
function tintaLibera(prese) {
  let meglio = TINTE[0], dist = -1;
  for (const h of TINTE) {
    const d = prese.length ? Math.min(...prese.map((x) => distTinta(x, h))) : 360;
    if (d > dist + 1) { meglio = h; dist = d; }
  }
  return meglio;
}

export function coloriSquadra(ruoli = [], palette = leggiPalette()) {
  const out = new Map();
  const capi = ruoli.filter((r) => !r.capo), prese = [];
  const base = new Map();
  for (const r of capi) {
    let h, s;
    if (r.colore) {
      const c = rgb(r.colore);
      if (!c) throw new Error(`ruolo ${r.slug}: colore non valido "${r.colore}" (serve #rrggbb)`);
      [h, s] = hsl(c); s = Math.max(s, 45);
    } else { h = tintaLibera(prese); s = 75; }
    prese.push(h); base.set(r.slug, { h, s });
  }
  // il colore di una sfumatura nei due temi, o il riservato a cui si avvicina troppo
  const prova = (b, f) => {
    const c = {};
    for (const tema of ["scuro", "chiaro"]) {
      const t = palette[tema], v = tono(b.h + f.dt, b.s * (f.s ?? 1), f.p, t, tema === "scuro");
      const k = RISERVATI.find((x) => deltaE(v, t[x]) < LONTANO);
      if (k) return { riservato: k };
      c[tema] = hex(v);
    }
    return { c };
  };
  const usate = new Map(); // capo → indici delle sfumature già date ai fratelli
  for (const r of ruoli) {
    const b = base.get(r.capo || r.slug);
    if (!b) continue;
    let esito;
    if (!r.capo) esito = prova(b, { p: CAPO, dt: 0 });
    else {
      // la sfumatura del suo posto fra i fratelli; se cade su un riservato, la prima non ancora data che regge
      const prese = usate.get(r.capo) || [], primo = prese.length % SFUMATURE.length;
      for (let i = 0; i < SFUMATURE.length; i++) {
        const j = (primo + i) % SFUMATURE.length;
        if (prese.includes(j) && prese.length < SFUMATURE.length) continue;
        const e = prova(b, SFUMATURE[j]);
        if (e.c) { esito = e; prese.push(j); break; }
        esito = esito || e;
      }
      usate.set(r.capo, prese);
    }
    if (!esito.c) {
      const k = esito.riservato;
      throw new Error(`ruolo ${r.slug}: il suo colore è troppo vicino a un colore riservato (${k === "foglio" || k === "violet" ? "il viola dei fogli" : k === "coral" ? "il corallo delle menzioni" : "il colore dell'assistente"}): scegli un altro colore per ${r.capo || r.slug}`);
    }
    out.set(r.slug, esito.c);
  }
  return out;
}
