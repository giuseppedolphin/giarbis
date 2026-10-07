// Il volto dell'assistente sulla mappa, stile «Sonar»: una sfera di vetro col bordo acceso, occhi come anelli di luce e una
// bocca che è un'onda. Lo stato viene solo da segnali veri:
//   parla     la coda della voce (condivisi/voce-motore.js `stato().parlando`): smette appena la voce si ferma o si salta;
//             l'onda segue `analizzatoreVoce()`
//   ascolta   microfono aperto (ascolto.js `ascolto` / `sv.comando`), l'onda segue `livelloMic()`, lo sguardo va verso la sfera «Tu»
//   sorpreso  `cockpit_utente` sull'assistente (messaggio nuovo, tuo o avviso di un agente), 1,3 s
//   preoccupato `fine` con errore o `cockpit_errore`, dell'assistente o di un agente, 8 s, sfera ambra
//   contento  `fine` senza errore di un agente, 3 s
//   lavora    `delta_tool` dell'assistente, finché non tornano i `risultati`
//   pensa     l'assistente in `lavora`/`avvio` senza tool aperto (ragionamento, `delta_pensa`, o in attesa del modello)
//   stanco    contesto dell'assistente ≥ 70%, o ≥ 4 agenti al lavoro insieme, o piano (finestra di 5 ore) ≥ 80%; molto stanco:
//             ≥ 90% / ≥ 95%
// La stanchezza si somma agli altri stati (palpebre pesanti, luce fioca). Il volto sta dentro la sfera: anello, cerchiolino del
// contesto e fumetti restano fuori. mappa.js chiama tracciaVolto(ev) per ogni evento e disegnaVolto() al posto della sfera
// dell'assistente.
import { ascolto, livelloMic, sv } from "./ascolto.js";
import { COL, RIDOTTO, S, TEMA } from "./comune.js";
import { api } from "/condivisi/api.js";
import { analizzatoreVoce, stato } from "/condivisi/voce-motore.js";

const DURATA = { sorpreso: 1300, preoccupato: 8000, contento: 3000 };
const VS = {
  pensa: false, tool: false, fino: { sorpreso: 0, preoccupato: 0, contento: 0 }, consumo: null, ultimoConsumo: 0, vol: 0, cur: null,
  ultimoT: 0, forza: null, forzaStanco: null, // gli ultimi due servono solo alle prove da console (forzaVolto)
};
const lampo = (tipo) => { VS.fino[tipo] = performance.now() + DURATA[tipo]; };

function tracciaVolto(ev) {
  if (!ev || !ev.id) return;
  if (ev.id === S.orchestratore) {
    if (ev.type === "delta_pensa") { VS.pensa = true; VS.tool = false; }
    else if (ev.type === "delta_tool") { VS.tool = true; VS.pensa = false; }
    else if (ev.type === "delta" || ev.type === "risultati") { VS.pensa = false; VS.tool = false; }
    else if (ev.type === "fine") { VS.pensa = VS.tool = false; if (ev.errore) lampo("preoccupato"); }
    else if (ev.type === "cockpit_errore") { VS.pensa = VS.tool = false; lampo("preoccupato"); }
    else if (ev.type === "cockpit_utente") lampo("sorpreso");
    return;
  }
  const s = S.sessioni.get(ev.id);
  if (!s || s.ruolo === "orchestratore") return;
  if (ev.type === "fine") lampo(ev.errore ? "preoccupato" : "contento");
  else if (ev.type === "cockpit_errore") lampo("preoccupato");
}

// il consumo del piano si rilegge al più ogni minuto (il server lo aggiorna ogni 5)
function leggiConsumo(now) {
  if (now - VS.ultimoConsumo < 60000) return;
  VS.ultimoConsumo = now;
  api("GET", "/api/consumo").then((r) => { VS.consumo = r?.cinque?.u ?? null; }).catch(() => {});
}
function stanchezza() {
  const j = S.orchestratore && S.sessioni.get(S.orchestratore), c = j?.contesto;
  const p = c && c.usati != null && c.finestra ? (c.usati / c.finestra) * 100 : 0;
  const attivi = [...S.sessioni.values()].filter((s) => s.ruolo !== "orchestratore" && (s.stato === "lavora" || s.stato === "avvio")).length;
  const u = VS.consumo ?? 0;
  return p >= 90 || u >= 95 ? 2 : p >= 70 || attivi >= 4 || u >= 80 ? 1 : 0;
}
function statoVolto(now) {
  if (stato().parlando) return "parla";
  if (ascolto || sv.comando) return "ascolta";
  for (const k of ["sorpreso", "preoccupato", "contento"]) if (now < VS.fino[k]) return k;
  const j = S.orchestratore && S.sessioni.get(S.orchestratore), vivo = j && (j.stato === "lavora" || j.stato === "avvio");
  if (!vivo) { VS.pensa = VS.tool = false; return "riposo"; }
  return VS.tool ? "lavora" : "pensa";
}

// ---- l'espressione: numeri, non disegno -------------------------------------------------------
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const blink = (t, per, dur = 170) => { const k = t % per; return k < dur ? Math.sin((Math.PI * k) / dur) : 0; };
function espressione(st, t, stanco, vol, mic, verso) {
  const e = {
    stato: st,
    gx: 0,
    gy: 0,
    open: 1,
    scala: 1,
    arco: 0,
    ansia: 0,
    tondo: 0,
    puntini: 0,
    lavoro: 0,
    salto: 0,
    fioco: 0,
    parla: 0,
    ascolta: 0,
    tinta: "sonar"
  };
  switch (st) {
    case "riposo":
      if (stanco === 2) {
        const n = Math.max(0, Math.sin(t / 1900));
        e.gy = 0.45 + 0.18 * n;
        e.open = 0.2 + 0.12 * Math.max(0, Math.sin(t / 1900 + 2));
        e.fioco = 0.55;
        e.salto = -0.04 * n;
      }
      else if (stanco === 1) {
        e.gy = 0.28;
        e.gx = 0.1 * Math.sin(t / 4000);
        e.open = (0.5 - 0.08 * (0.5 + 0.5 * Math.sin(t / 1700))) * (1 - blink(t, 3400, 650));
        e.fioco = 0.3;
      }
      else { e.gx = 0.35 * Math.sin(t / 2300) + 0.12 * Math.sin(t / 870); e.gy = 0.18 * Math.sin(t / 3100); e.open = 1 - blink(t, 4300); }
      break;
    case "ascolta":
      e.ascolta = 1;
      e.gx = verso.x * 0.7;
      e.gy = verso.y * 0.6;
      e.open = 1.05 - blink(t, 6100) * 1.05;
      e.scala = 1.04 + mic * 0.1;
      e.tinta = "coral";
      break;
    case "pensa": e.gx = 0.5 + 0.1 * Math.sin(t / 800); e.gy = -0.8; e.open = 0.86 - blink(t, 5200) * 0.86; e.puntini = 1; break;
    case "lavora": e.gx = 0.32 * Math.sin(t / 620); e.gy = 0.35; e.open = 0.4; e.lavoro = 1; break;
    case "parla": e.parla = 1; e.gx = 0.08 * Math.sin(t / 1500); e.open = 0.96 - blink(t, 5300) * 0.96; e.tinta = "violet"; break;
    case "contento": e.arco = 1; e.salto = 0.06 * Math.abs(Math.sin(t / 260)) * ((t % 2400) < 1050 ? 1 : 0); e.gx = 0.05 * Math.sin(t / 900); break;
    case "preoccupato":
      e.ansia = 1;
      e.gx = -0.25 + 0.22 * Math.sin(t / 1300);
      e.gy = 0.22;
      e.open = 0.9 - blink(t, 3900) * 0.9;
      e.tinta = "sand";
      break;
    case "sorpreso": {
      const k = clamp((VS.fino.sorpreso - performance.now()) / DURATA.sorpreso),
      env = k > 0.9 ? (1 - k) / 0.1 : k > 0.35 ? 1 : k / 0.35; e.scala = 1 + 0.3 * env; e.open = 1 + 0.15 * env; e.tondo = env; break;
    }
  }
  // la stanchezza si somma agli stati attivi
  if (st !== "riposo" && stanco && !e.arco) { e.open *= stanco === 2 ? 0.45 : 0.7; e.fioco = Math.max(e.fioco, stanco === 2 ? 0.4 : 0.2); }
  e.stanco = st === "riposo" ? stanco : 0;
  e.vol = vol; e.mic = mic;
  return e;
}

// ---- disegno ----------------------------------------------------------------------------------
const rgba = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const lit = (c, n) => c.map((x) => Math.min(255, x + n));
const mix = (a, b, k) => a.map((x, i) => x + (b[i] - x) * k);
const coloreDi = (tinta) => tinta === "coral" ? TEMA.coral : tinta === "violet" ? TEMA.violet : tinta === "sand" ? COL.attende : TEMA.sonar;
// ambra = --sand, come «attende»

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
// un occhio ad anello di luce; ad arco se contento; tagliato da una palpebra inclinata se preoccupato
function occhio(cx, ex, ey, w, h, e, side) {
  if (e.arco > 0.5) { cx.beginPath(); cx.arc(ex, ey + h * 0.28, w * 0.55, Math.PI * 1.12, Math.PI * 1.88); cx.stroke(); return; }
  const hh = Math.max(h * clamp(e.open, 0, 1.3), w * 0.14);
  cx.save();
  if (e.ansia > 0.05) {
    const s = e.ansia * 0.5 * side, top = ey - hh * 0.5 + hh * 0.3;
    cx.beginPath();
    cx.moveTo(ex - w * 2, top - w * 2 * s);
    cx.lineTo(ex + w * 2, top + w * 2 * s);
    cx.lineTo(ex + w * 2, ey + h * 2);
    cx.lineTo(ex - w * 2, ey + h * 2);
    cx.closePath();
    cx.clip();
  }
  cx.beginPath(); cx.ellipse(ex, ey, w / 2, hh / 2, 0, 0, Math.PI * 2); cx.stroke();
  cx.restore();
}
function volto(cx, x, y0, r, e, t) {
  const col = e.col, luce = lit(col, 150), a = 1 - e.fioco * 0.55, y = y0 - e.salto * r;
  if (e.lavoro) {
    cx.save(); cx.beginPath(); cx.arc(x, y0, r - 1, 0, Math.PI * 2); cx.clip();
    const a0 = t / 520;
    for (let i = 0; i < 8; i++) {
      cx.beginPath();
      cx.moveTo(x, y0);
      cx.arc(x, y0, r, a0 - (i + 1) * 0.11, a0 - i * 0.11);
      cx.closePath();
      cx.fillStyle = rgba(col, 0.2 * (1 - i / 8));
      cx.fill();
    }
    cx.restore();
  }
  cx.save();
  cx.strokeStyle = rgba(luce, a); cx.fillStyle = rgba(luce, a); cx.shadowColor = rgba(col); cx.shadowBlur = r * 0.18 * a;
  cx.lineWidth = Math.max(1.1, r * 0.055); cx.lineCap = "round";
  const ox = e.gx * r * 0.14, oy = e.gy * r * 0.1, w = r * 0.23 * e.scala, h = r * 0.2 * e.scala;
  for (const side of [-1, 1]) occhio(cx, x + side * r * 0.29 + ox, y - r * 0.1 + oy, w, h, e, side);
  const mx = x + ox * 0.5, my = y + r * 0.33 + oy * 0.4;
  if (e.tondo > 0.15) { cx.beginPath(); cx.arc(mx, my, r * (0.04 + 0.06 * e.tondo), 0, Math.PI * 2); cx.stroke(); }
  else {
    cx.strokeStyle = e.ascolta ? rgba(lit(TEMA.coral, 120), a) : rgba(luce, e.puntini || e.lavoro ? a * 0.5 : a);
    cx.lineWidth = Math.max(1, r * 0.04); cx.beginPath();
    const N = 42, larga = e.stanco === 2 ? 0.22 : 0.36;
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1), env = Math.sin(Math.PI * u), X = mx - r * larga + u * r * larga * 2;
      let Y = my;
      if (e.parla) Y += env * r * (0.02 + 0.16 * e.vol) * (0.6 * Math.sin(u * 14 - t / 60) + 0.4 * Math.sin(u * 23 + t / 37));
      else if (e.ascolta) Y += env * r * (0.015 + 0.09 * e.mic) * Math.sin(u * 10 - t / 90);
      else if (e.arco > 0.5) Y += env * r * 0.1 + env * r * 0.012 * Math.sin(u * 9 - t / 200);
      else if (e.ansia > 0.5) Y += -env * r * 0.07 + env * r * 0.01 * Math.sin(u * 30 + t / 45);
      else if (e.stanco) Y += env * r * 0.03;
      else if (!e.puntini && !e.lavoro) Y += env * r * 0.014 * Math.sin(u * 6 - t / 600);
      i ? cx.lineTo(X, Y) : cx.moveTo(X, Y);
    }
    cx.stroke();
  }
  if (e.puntini) for (let i = 0; i < 3; i++) {
    const ang = -Math.PI / 2 + t / 420 + i * 0.42;
    cx.beginPath();
    cx.arc(x + Math.cos(ang) * r * 0.8, y0 + Math.sin(ang) * r * 0.8, r * (0.05 - i * 0.01), 0, Math.PI * 2);
    cx.fillStyle = rgba(luce, 1 - i * 0.28);
    cx.fill();
  }
  cx.restore();
}

// La sfera dell'assistente col volto. p: centro sullo schermo, r: raggio, alone: shadowBlur della mappa, verso: {x,y} unitario verso la sfera «Tu».
function disegnaVolto(cx, p, r, t, alone, verso = { x: -0.6, y: 0.6 }) {
  const now = performance.now(), fermo = RIDOTTO.matches, tt = fermo ? 1400 : t;
  leggiConsumo(now);
  const analizzatore = analizzatoreVoce();
  if (analizzatore) {
    const d = new Uint8Array(analizzatore.frequencyBinCount);
    analizzatore.getByteFrequencyData(d);
    let somma = 0;
    for (const v of d) somma += v;
    VS.vol = VS.vol * 0.6 + (somma / d.length / 255) * 0.4 * 2.2;
  } else { // voce del browser: niente analizzatore, si simula
    VS.vol = stato().parlando || VS.forza === "parla" ? 0.35 + 0.35 * Math.abs(Math.sin(t / 110)) : VS.vol * 0.9;
  }
  const st = VS.forza || statoVolto(now), mic = VS.forza === "ascolta" ? 0.3 + 0.3 * Math.abs(Math.sin(t / 160)) : livelloMic();
  const e = espressione(st, tt, VS.forzaStanco ?? stanchezza(), clamp(VS.vol), clamp(mic), verso);
  e.col = coloreDi(e.tinta);
  // le transizioni fra stati si addolciscono; colore compreso
  const k = fermo ? 1 : 1 - Math.pow(0.84, Math.min(4, (now - (VS.ultimoT || now)) / 16.7));
  VS.ultimoT = now;
  if (!VS.cur) VS.cur = { ...e, col: [...e.col] };
  for (const q in e) if (typeof e[q] === "number" && ![
    "vol",
    "mic",
    "arco",
    "puntini",
    "lavoro",
    "parla",
    "ascolta",
    "stanco"
  ].includes(q)) VS.cur[q] += (e[q] - VS.cur[q]) * k;
  VS.cur.col = VS.cur.col.map((v, i) => v + (e.col[i] - v) * k);
  const d = { ...e, ...Object.fromEntries(["gx", "gy", "open", "scala", "ansia", "tondo", "salto", "fioco"].map((q) => [q, VS.cur[q]])), col: VS.cur.col };
  sferaVetro(cx, p.x, p.y, r, d.col, d.fioco, tt, alone);
  volto(cx, p.x, p.y, r, d, tt);
}

// solo per le prove, dalla console: (await import("/cockpit/volto.js")).forzaVolto("parla", 1); forzaVolto() torna ai segnali veri
function forzaVolto(quale = null, stanco = null) {
  VS.forza = quale;
  VS.forzaStanco = stanco;
  if (quale === "sorpreso") lampo("sorpreso");
}

export { disegnaVolto, forzaVolto, statoVolto, tracciaVolto };
