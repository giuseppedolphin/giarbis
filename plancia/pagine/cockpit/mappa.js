// La mappa: le sessioni come sfere collegate (tu → assistente → agenti), anelli di avanzamento, alone di ascolto,
// pan e zoom, la scheda di un nodo e l'attività in corso di ogni agente.
import { ascolto, livelloMic, sv } from "./ascolto.js";
import { C, disegnaLegamiFogli } from "./fogli.js";
import { fumettoVisibile } from "./fumetti.js";
import { apriAgenteFoglio } from "./agenti-foglio.js";
import { apri, caricaEventi } from "./chat.js";
import {
  $, COL, NOMI_TOOL, RICARICA, RIDOTTO, S, STATO, TEMA, eAssistente, fermo, mostraBanner, nomeModello, nomeSessione, nomeVisibile, persona, selettoreModello,
} from "./comune.js";
import { SA, apriSchedaSotto, disegnaSotto, infoSotto, rendiSottoScheda, sottoA } from "./sottoagenti.js";
import { T, apriSchedaTimer, dettaglioTimer, disegnaTimer, rendiTimerTutti, timerA } from "./timer.js";
import { disegnaContesto, testoContesto } from "./contesto.js";
import { disegnaVolto, statoVolto, tracciaVolto } from "./volto.js";
import { disegnaSfera, fotoVolto, tracciaVolti } from "./volti.js";
import { ZOOM_MAX, fermaZoom, initZoom } from "./zoom.js";
import { apriDomandeDi, disegnaSegnoDomande, segnoA, testoSegno } from "./domande.js";
import { chiediRimozione } from "./pulizia.js";
import * as BM from "./bacheca-mappa.js";
import { conPosti, ingombro, posizioni } from "./raggiera.js";
import * as PO from "./posti.js";
import { api } from "/condivisi/api.js";
import { su } from "/condivisi/eventi.js";
import { esc, unaRiga } from "/condivisi/formati.js";
import { attrColore, rgbRuolo } from "/condivisi/colori.js";

// ---- la mappa: gli agenti come sfere collegate --------------------------------------------
// lo zoom più lontano, per rotella e «Centra»; da lontano spariscono prima le
// righe dell'attività e la finestra di contesto (sotto LONTANO), poi i nomi degli esecutori (sotto LONTANISSIMO)
const ZOOM_MIN = 0.12, LONTANO = 0.55, LONTANISSIMO = 0.38;
const M = {
  ctx: new Map(), cv: $("mappa"), cx: $("mappa").getContext("2d"), nodi: new Map(), cam: { x: 0, y: 0, z: 1 }, attivita: new Map(),
  impulsi: [], sel: null, sopra: null, on: false, t0: performance.now(),
  selTimer: null, // il timer la cui scheda è aperta
  anelli: new Map(), // k del nodo → stato dell'anello di avanzamento
  d: 1, w: 0, h: 0, // pixel per punto della tela e la sua misura in punti, aggiornati da ridimensionaMappa
  toccata: 0, ultimoT: 0, sporca: true, // l'ultimo gesto sulla mappa, l'ultimo fotogramma disegnato, un cambio da mostrare subito (passoMappa)
  trascina: null, // il k della sfera che si sta spostando a mano (posti.js)
};
// La mappa è l'unica vista del cockpit (la vista a Lista è stata tolta): si accende all'avvio e resta accesa.
function vistaMappa() {
  if (M.on) return;
  M.on = true; $("app").classList.add("mappa-on");
  layout(); ridimensionaMappa(); inquadra(); requestAnimationFrame(disegnaMappa);
}
function ridimensionaMappa() {
  const r = M.cv.getBoundingClientRect(), d = devicePixelRatio || 1;
  M.cv.width = r.width * d; M.cv.height = r.height * d; M.d = d; M.w = r.width; M.h = r.height;
}

// albero: tu → assistente → agenti (genitore), tu → agenti lanciati dalla pagina; la disposizione è in raggiera.js, le sfere
// spostate a mano (posti.js) restano dove le ha messe la persona, quella che si sta trascinando (M.trascina) non si tocca
function layout() {
  M.sporca = true;
  const auto = posizioni(S.sessioni.values(), persona.nome), voci = auto.voci, { pos } = conPosti(voci, auto.pos, PO.POSTI);
  const vivi = new Set(); // aggiorna i nodi animati
  for (const v of voci) {
    vivi.add(v.k);
    const p = pos.get(v.k) || { x: 0, y: 0 };
    const n = M.nodi.get(v.k) || { x: p.x, y: p.y + 40, nato: performance.now() };
    Object.assign(n, { k: v.k, s: v.s, nome: v.nome, ruolo: v.ruolo, padre: v.padre }, M.trascina === v.k ? {} : { tx: p.x, ty: p.y });
    M.nodi.set(v.k, n);
  }
  for (const k of [...M.nodi.keys()]) if (!vivi.has(k)) M.nodi.delete(k);
}
// agenti di foglio col colore del loro pallino (l'errore resta corallo), gli altri dello stato; esecutori della squadra più piccoli dei capi
const coloreStato = (n) => n.ruolo === "tu" ? COL.tu : n.ruolo === "foglio" && n.s?.stato !== "errore" ? COL.foglio : COL[n.s?.stato] || COL.ferma;
// la squadra col colore del suo ruolo (condivisi/colori.js) su sfera, tentacolo ed etichetta; lo stato resta su alone e anello.
// L'etichetta prende il colore del tema (contrasto da testo); la sfera quello acceso del tema scuro in entrambi i temi, che sul
// chiaro il colore da testo è troppo cupo; in pausa sbiadisce un po' verso il grigio, in errore la sfera resta corallo
const coloreRuoloNodo = (n) => (n.ruolo === "squadra" && n.s?.stato !== "errore" ? rgbRuolo(n.s?.nome, TEMA.chiaro) : null);
const coloreNodo = (n) => {
  const c = n.ruolo === "squadra" && n.s?.stato !== "errore" ? rgbRuolo(n.s?.nome, false) : null;
  if (!c) return coloreStato(n);
  return n.s?.stato === "ferma" ? c.map((x, i) => Math.round(x * 0.75 + COL.ferma[i] * 0.25)) : c;
};
const raggioDi = (n) => n.ruolo === "orchestratore" ? 46 : n.ruolo === "tu" ? 22 : n.s?.squadra?.tipo === "esecutore" ? 25 : 30;
const schermo = (x, y) => ({ x: (x - M.cam.x) * M.cam.z + M.w / 2, y: (y - M.cam.y) * M.cam.z + M.h / 2 });
const mondo = (x, y) => ({ x: (x - M.w / 2) / M.cam.z + M.cam.x, y: (y - M.h / 2) / M.cam.z + M.cam.y });
function attivitaDi(n) {
  if (n.ruolo === "tu") return ""; // il nome sta già nell'etichetta della sfera
  const a = M.attivita.get(n.s.id); if (a && Date.now() - a.t < 60000 && (n.s.stato === "lavora" || n.s.stato === "avvio")) return a.testo;
  return ({
    lavora: "sta lavorando",
    avvio: "si avvia",
    attende: "ha finito, aspetta te",
    ferma: "in pausa",
    errore: "errore"
  })[n.s.stato] + (n.s.ultimo && !fumettoVisibile(n.s) ? ` · ${unaRiga(n.s.ultimo)}` : "");
  // col fumetto, l'anteprima sta lì
}
function puntoCurva(a, b, k, t) {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
  const onda = Math.sin(t / 900 + k) * 0.12 * l;
  const c = { x: mx - dy / l * onda, y: my + dx / l * onda };
  return (u) => ({ x: (1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * c.x + u * u * b.x, y: (1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * c.y + u * u * b.y, c });
}
function righe(cx, testo, larg) {
  const parole = testo.split(/\s+/); const out = []; let r = "";
  for (const p of parole) {
    const prova = r ? r + " " + p : p;
    if (cx.measureText(prova).width > larg && r) {
      out.push(r);
      r = p;
      if (out.length === 2) break;
    } else r = prova;
  }
  if (out.length < 2 && r) out.push(r); else if (r && out.length === 2) out[1] = out[1].replace(/\s*\S*$/, "") + "…";
  return out.slice(0, 2);
}
// L'anello di avanzamento attorno alla sfera di un agente: sottile, senza numeri. Se l'agente ha dichiarato un piano
// (ctl.mjs progresso) l'arco si riempie in proporzione; altrimenti è indeterminato, un arco che gira piano mentre lavora.
// A turno chiuso bene si completa e svanisce; fermo o in errore svanisce soltanto. Il passo corrente è nel tooltip.
function disegnaAnello(cx, p, R, colore, n, t, vivo) {
  const a = M.anelli.get(n.k) || { v: null, vis: 0, fineT: 0, completa: 0 };
  M.anelli.set(n.k, a);
  const pr = vivo ? n.s.progresso : null;
  if (a.completa && !a.fineT) { a.fineT = t; }
  // valore mostrato (0..1): bersaglio dal piano, 1 se il turno è finito bene; addolcito, a scatto se si chiede meno movimento
  const bersaglio = a.completa ? 1 : pr && pr.totale ? Math.min(1, pr.fatti / pr.totale) : null;
  if (bersaglio !== null) a.v = a.v === null ? (pr ? 0 : 0.15) : RIDOTTO.matches ? bersaglio : a.v + (bersaglio - a.v) * 0.07;
  const visibile = vivo || (a.completa && t - a.fineT < 1300);
  a.vis = RIDOTTO.matches ? (visibile ? 1 : 0) : a.vis + ((visibile ? 1 : 0) - a.vis) * (visibile ? 0.12 : 0.08);
  if (a.completa && t - a.fineT >= 1300 && a.vis < 0.02) { a.completa = 0; a.fineT = 0; a.v = null; } // pronto per il prossimo turno
  if (!visibile && a.vis < 0.02) { a.vis = 0; a.v = null; return; }
  const z = Math.min(1.3, M.cam.z), fondo = -Math.PI / 2;
  cx.save(); cx.lineCap = "round";
  cx.beginPath();
  cx.arc(p.x, p.y, R, 0, Math.PI * 2);
  cx.strokeStyle = `rgba(${colore},${0.14 * a.vis})`;
  cx.lineWidth = 1.2 * z;
  cx.stroke();
  // la pista
  cx.shadowColor = `rgba(${colore},.7)`; cx.shadowBlur = 7 * z;
  cx.strokeStyle = `rgba(${colore},${0.9 * a.vis})`; cx.lineWidth = 1.8 * z;
  cx.beginPath();
  if (bersaglio === null) { const g = RIDOTTO.matches ? fondo : t / 1100; cx.arc(p.x, p.y, R, g, g + 1.1); } // indeterminato
  else cx.arc(p.x, p.y, R, fondo, fondo + Math.PI * 2 * Math.max(0.012, a.v));
  cx.stroke(); cx.restore();
}
// Alone di ascolto attorno all'assistente: un anello corallo che si apre col livello del microfono e due onde lente; a movimento ridotto resta un anello fisso.
function disegnaAscolto(cx, p, r, t) {
  const z = M.cam.z, liv = fermo ? 0 : livelloMic();
  cx.save();
  if (!fermo) for (let k = 0; k < 2; k++) {
    const u = ((t / 1500) + k * 0.5) % 1;
    cx.beginPath();
    cx.arc(p.x, p.y, r + (10 + u * 34) * z, 0, Math.PI * 2);
    cx.strokeStyle = `rgba(${TEMA.coral},${(1 - u) * 0.35})`;
    cx.lineWidth = 1.5;
    cx.stroke();
  }
  cx.beginPath(); cx.arc(p.x, p.y, r + (9 + liv * 18) * z, 0, Math.PI * 2);
  cx.strokeStyle = `rgba(${TEMA.coral},${0.55 + liv * 0.4})`;
  cx.lineWidth = (2 + liv * 3) * Math.min(1.3, z);
  cx.shadowColor = `rgba(${TEMA.coral},.8)`;
  cx.shadowBlur = 10 + liv * 22;
  cx.stroke();
  cx.restore();
}
// Ogni quanti ms si ridisegna la tela: mentre qualcosa si muove (gesto, sfere in viaggio,
// impulsi, volto che parla, ascolta o cambia espressione) al più 60 fotogrammi al secondo, con un agente al lavoro 30, a riposo 10.
function passoMappa(t) {
  if (M.sporca) return 0;
  const nodi = [...M.nodi.values()], assestati = nodi.every((n) => Math.abs(n.tx - n.x) < 0.3 && Math.abs(n.ty - n.y) < 0.3);
  if (t - M.toccata < 1500 || M.impulsi.length || !assestati || !["riposo", "pensa", "lavora"].includes(statoVolto(performance.now()))) return 15;
  return nodi.some((n) => n.s && (n.s.stato === "lavora" || n.s.stato === "avvio")) ? 33 : 100;
}
const toccaMappa = () => { M.toccata = performance.now(); }; let pan = null; // il gesto in corso sulla tela
function disegnaMappa(t) {
  if (!M.on) return;
  if (t - M.ultimoT < passoMappa(t)) { requestAnimationFrame(disegnaMappa); return; }
  M.ultimoT = t; M.sporca = false;
  const { cx, d } = M; cx.setTransform(d, 0, 0, d, 0, 0); cx.clearRect(0, 0, M.w, M.h);
  // griglia leggera, come un fondale
  const passo = 80 * M.cam.z, o = schermo(0, 0);
  cx.fillStyle = `rgba(${TEMA.sonar},${TEMA.chiaro ? 0.16 : 0.07})`;
  for (let x = ((o.x % passo) + passo) % passo; x < M.w; x += passo) for (let y = ((o.y % passo) + passo) % passo; y < M.h; y += passo) cx.fillRect(x - 1, y - 1, 2, 2);
  for (const n of M.nodi.values()) { n.x += (n.tx - n.x) * 0.12; n.y += (n.ty - n.y) * 0.12; }
  // tentacoli
  for (const n of M.nodi.values()) {
    const p = n.padre && M.nodi.get(n.padre); if (!p) continue;
    const a = schermo(p.x, p.y), b = schermo(n.x, n.y);
    const f = puntoCurva(a, b, n.k.length, t);
    const colore = coloreNodo(n);
    const g = cx.createLinearGradient(a.x, a.y, b.x, b.y); g.addColorStop(0, `rgba(${TEMA.sonar},.35)`); g.addColorStop(1, `rgba(${colore},.55)`);
    cx.strokeStyle = g; cx.lineCap = "round";
    for (let s = 0; s < 3; s++) { cx.lineWidth = (6 - s * 2) * Math.min(1.4, M.cam.z); cx.globalAlpha = s === 0 ? 0.25 : s === 1 ? 0.5 : 1;
      cx.beginPath(); cx.moveTo(a.x, a.y); cx.quadraticCurveTo(f(0).c.x, f(0).c.y, b.x, b.y); cx.stroke(); }
    cx.globalAlpha = 1;
  }
  // impulsi: messaggi lungo i tentacoli e, in linea retta, fra due sfere o verso la bacheca (disegnata sotto, bacheca-mappa.js)
  M.impulsi = M.impulsi.filter((i) => t - i.t0 < 1400); BM.disegna(cx);
  for (const i of M.impulsi) {
    const da = M.nodi.get(i.da), bb = i.a === "bacheca" ? BM.box() : null, a2 = bb ? { x: bb.x + bb.w / 2, y: bb.y + bb.h / 2 } : M.nodi.get(i.a); if (!da || !a2) continue;
    const u = Math.min(1, (t - i.t0) / 1100);
    const A = schermo(da.x, da.y), B = schermo(a2.x, a2.y);
    const padreFiglio = !i.diretto && a2.padre === i.da, pa = padreFiglio ? A : B, pb = padreFiglio ? B : A;
    const q = i.diretto ? { x: A.x + (B.x - A.x) * u, y: A.y + (B.y - A.y) * u } : puntoCurva(pa, pb, (padreFiglio ? a2 : da).k.length, t)(padreFiglio ? u : 1 - u);
    cx.beginPath();
    cx.arc(q.x, q.y, 5, 0, Math.PI * 2);
    cx.fillStyle = `rgb(${TEMA.punto})`;
    cx.shadowColor = `rgb(${TEMA.sonar})`;
    cx.shadowBlur = 16;
    cx.fill();
    cx.shadowBlur = 0;
  }
  // sfere ed etichette
  cx.textAlign = "center"; M.ctx.clear();
  for (const n of M.nodi.values()) {
    const p = schermo(n.x, n.y), r = raggioDi(n) * M.cam.z;
    const colore = coloreNodo(n), stato = coloreStato(n);
    const vivo = n.s && (n.s.stato === "lavora" || n.s.stato === "avvio");
    if (vivo || n.s?.stato === "attende") {
      const periodo = vivo ? 1300 : 2600, k = ((t + n.k.length * 300) % periodo) / periodo;
      cx.beginPath();
      cx.arc(p.x, p.y, r * (1 + k * 0.9), 0, Math.PI * 2);
      cx.strokeStyle = `rgba(${stato},${(1 - k) * 0.6})`;
      cx.lineWidth = 2;
      cx.stroke();
    }
    if (n.ruolo === "orchestratore" && (ascolto || sv.comando)) disegnaAscolto(cx, p, r, t);
    if ((n.ruolo === "agente" || n.ruolo === "squadra") && n.s) disegnaAnello(cx, p, r + 7 * M.cam.z, stato, n, t, vivo);
    else if (vivo) {
      cx.beginPath();
      cx.arc(p.x, p.y, r + 7 * M.cam.z, t / 300, t / 300 + 1.4);
      cx.strokeStyle = `rgba(${stato},.9)`;
      cx.lineWidth = 2.5;
      cx.stroke();
    }
    if (n.ruolo === "orchestratore") { // la sfera dell'assistente col volto (volto.js), che guarda verso la tua quando ascolta
      const tu = M.nodi.get("tu"), dx = tu ? tu.x - n.x : -1, dy = tu ? tu.y - n.y : 1, dl = Math.hypot(dx, dy) || 1;
      disegnaVolto(cx, p, r, t, (M.sel === n.k || M.sopra === n.k ? 34 : 18) * Math.min(1.3, M.cam.z), { x: dx / dl, y: dy / dl });
    } else {
      disegnaSfera(cx, n, p, r, colore, (M.sel === n.k || M.sopra === n.k ? 34 : 18) * Math.min(1.3, M.cam.z), t, M.nodi.get("tu")); // volti.js
    }
    if (M.sel === n.k) {
      cx.beginPath();
      cx.arc(p.x, p.y, r + 4, 0, Math.PI * 2);
      cx.strokeStyle = `rgb(${TEMA.testo})`;
      cx.lineWidth = 1.5;
      cx.stroke();
    }
    // la misura dei testi: segue lo zoom fra 0,75 e 1,25; da lontano scende ancora un po', fino a 0,6
    const z = M.cam.z, zt = Math.max(0.6, Math.min(1.25, z < LONTANO ? z + 0.2 : Math.max(0.75, z)));
    // una domanda aperta nella casella «Da decidere» (domande.js): il segno «?» al posto del pallino dei non letti dell'assistente
    const chiede = disegnaSegnoDomande(cx, n.s, p, r, zt, { coral: TEMA.coral, fondo: TEMA.fondo });
    // il pallino dei non letti solo sull'assistente: gli agenti non si guardano uno per uno
    if (!chiede && n.s?.ruolo === "orchestratore" && n.s.nonLetti && n.s.stato === "attende") {
      cx.beginPath();
      cx.arc(p.x + r * 0.75, p.y - r * 0.75, 8, 0, Math.PI * 2);
      cx.fillStyle = `rgb(${COL.attende})`;
      cx.fill();
      cx.fillStyle = `rgb(${TEMA.suSand})`;
      cx.font = "600 10px Instrument Sans, sans-serif";
      cx.fillText(String(n.s.nonLetti), p.x + r * 0.75, p.y - r * 0.75 + 3.5);
    }
    if (n.s && z >= LONTANO) {
      const q = disegnaContesto(
        cx,
        n.s,
        p,
        r,
        zt,
        { sonar: TEMA.sonar, sand: COL.attende, coral: TEMA.coral, testo: TEMA.testo, testo2: TEMA.testo2, fondo: TEMA.fondo }
      );
      if (q) M.ctx.set(n.k, { ...q, s: n.s });
      else M.ctx.delete(n.k);
    } else M.ctx.delete(n.k); // la finestra di contesto, staccata dall'anello
    cx.fillStyle = `rgb(${coloreRuoloNodo(n) || TEMA.testo})`; // il nome di un ruolo nel suo colore, leggibile su entrambi i temi
    cx.textAlign = "center";
    cx.textBaseline = "alphabetic";
    if (z < LONTANISSIMO && n.s?.squadra?.tipo === "esecutore") continue;
    cx.font = `600 ${Math.round((n.ruolo === "orchestratore" ? 16 : 14) * zt)}px Bricolage Grotesque, sans-serif`;
    cx.fillText(n.s ? nomeSessione(n.s) : n.nome, p.x, p.y + r + 20 * zt);
    if (z < LONTANO) continue;
    cx.font = `${Math.round(12 * zt)}px Instrument Sans, sans-serif`; cx.fillStyle = `rgb(${TEMA.testo2})`;
    // le righe dell'attività stanno nel riquadro della sfera (raggiera.js, ingombro: più stretto per un esecutore) e da lontano si stringono
    const w = ingombro(n).w;
    righe(cx, attivitaDi(n), Math.min((w - 25) * zt, (w - 20) * z)).forEach((rg, i) => cx.fillText(rg, p.x, p.y + r + (37 + i * 15) * zt));
  }
  disegnaSotto(cx, t);
  disegnaTimer(cx, t);
  disegnaLegamiFogli(cx);
  posizionaComandoVoce();
  posizionaScheda();
  requestAnimationFrame(disegnaMappa);
}
function nodoA(x, y) {
  for (const n of [...M.nodi.values()].reverse()) {
    const p = schermo(n.x, n.y);
    if (Math.hypot(p.x - x, p.y - y) <= raggioDi(n) * M.cam.z + 6) return n;
  }
  return null;
}
// inquadra tutti i nodi: i riquadri sfera+etichetta in punti della mappa, più un bordo in pixel (in basso la barra dei comandi)
function inquadra() {
  toccaMappa();
  const n = [...M.nodi.values()]; if (!n.length || !M.w) return;
  const x0 = Math.min(...n.map((v) => v.tx - ingombro(v).w / 2)), x1 = Math.max(...n.map((v) => v.tx + ingombro(v).w / 2));
  const y0 = Math.min(...n.map((v) => v.ty)) - 70, y1 = Math.max(...n.map((v) => v.ty)) + 105 + 54 + 20; // più la bacheca sotto
  const lato = 24, sopra = 24, sotto = 90;
  const z = Math.max(ZOOM_MIN, Math.min(1.25, (M.w - 2 * lato) / (x1 - x0), (M.h - sopra - sotto) / (y1 - y0)));
  M.cam = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 + (sotto - sopra) / 2 / z, z };
}
// la scheda di un nodo: gli ultimi messaggi, chi li ha mandati, e il passaggio alla chat
// «Tu» per la persona di /api/chi e per il mittente predefinito «tu»; l'assistente col suo nome (anche negli eventi vecchi)
function etichettaMittente(m) {
  if (eAssistente(m)) return nomeVisibile(m);
  if (m === "cockpit") return "Avviso del cockpit";
  return !m || m === "tu" || (persona.slug && m === persona.slug) ? "Tu" : m;
}
async function apriScheda(n) {
  M.sel = n.k; M.selTimer = null; SA.sel = null; const s = n.s; const el = $("scheda-nodo");
  try { await caricaEventi(s.id); } catch {}
  const conTesto = (e) => e.blocchi.some((b) => b.type === "text" && b.text.trim());
  const ev = (S.eventi.get(s.id) || [])
    .filter((e) => e.type === "cockpit_utente" || (e.type === "assistant" && conTesto(e)) || e.type === "cockpit_errore").slice(-8);
  const nome = nomeSessione(s);
  const riga = (da, testo, stile = "") => `<div class="sn-m"><span class="sn-da">${esc(da)}</span><span class="sn-t"${stile}>${esc(testo)}</span></div>`;
  const msg = ev.map((e) => {
    if (e.type === "cockpit_utente") return riga(`${e.nota ? "Avviso del cockpit" : etichettaMittente(e.mittente)} → ${nome}`, e.nota || e.testo);
    if (e.type === "cockpit_errore") return riga("errore", e.testo, ' style="color:var(--coral)"');
    return riga(nome, unaRiga(e.blocchi.filter((b) => b.type === "text").map((b) => b.text).join(" ")));
  }).join("");
  const colore = (COL[s.stato] || COL.ferma).join(",");
  const lavora = s.stato === "lavora" || s.stato === "avvio";
  const foto = s.ruolo === "squadra" ? fotoVolto(s.nome) : "";
  el.innerHTML = `<div class="sn-testa">${foto ? `<img class="volto-foto" alt="" src="${foto}" style="box-shadow:0 0 0 2px rgb(${colore})">` : `<span class="dot ${s.stato}" style="width:9px;height:9px;border-radius:50%;background:rgb(${colore})"></span>`}`
    + `<b${attrColore(s.ruolo === "squadra" ? s.nome : "", "nome-ag")}>${esc(nome)}</b>${selettoreModello(s)}<span class="meta">${esc(STATO[s.stato] || s.stato)}</span>`
    + '<button class="x" id="sn-x" title="Chiudi">✕</button></div>'
    + `<div class="sn-corpo"><div id="sn-timer" hidden></div>${msg || '<div class="meta">Nessun messaggio ancora.</div>'}<div id="sn-sotto" hidden></div></div>`
    + `<div class="sn-piede"><button class="btn primario" id="sn-chat">${s.ruolo === "foglio" ? "Apri" : "Apri la chat"}</button>`
    + `${lavora || s.processo ? `<button class="btn leggero" id="sn-ferma" title="${lavora ? "Interrompe il turno in corso" : RICARICA}">${lavora ? "Ferma" : "Ricarica"}</button>` : ""}`
    + `${!lavora && s.ruolo !== "orchestratore" && s.ruolo !== "squadra" ? '<button class="btn pericolo" id="sn-rimuovi">Rimuovi</button>' : ""}`
    + `${PO.aMano(n) ? '<button class="btn leggero" id="sn-posto" title="La rimette dove la mette la disposizione automatica">Al suo posto</button>' : ""}</div>`;
  el.hidden = false;
  rendiTimerTutti(); rendiSottoScheda();
  const corpo = el.querySelector(".sn-corpo"); corpo.scrollTop = corpo.scrollHeight;
  $("sn-x").onclick = chiudiScheda;
  // l'agente di un foglio si apre col suo foglio accanto (se il foglio non c'è più, solo la chat)
  $("sn-chat").onclick = () => { chiudiScheda(); if (s.ruolo === "foglio" && C.el.has(s.foglio)) apriAgenteFoglio(s.foglio); else apri(s.id); };
  if ($("sn-posto")) $("sn-posto").onclick = () => { PO.riordina(n); $("sn-posto").remove(); };
  if ($("sn-ferma")) $("sn-ferma").onclick = () => api("POST", `/api/sessioni/${s.id}/ferma`).catch((e) => mostraBanner(e.message, 5000));
  if ($("sn-rimuovi")) $("sn-rimuovi").onclick = () => { const dove = { left: el.style.left, top: el.style.top, right: "", bottom: "" }; chiudiScheda(); chiediRimozione(s, dove); }; // anche su touch (pulizia.js)
  posizionaScheda();
}
function chiudiScheda() { M.sel = null; M.selTimer = null; SA.sel = null; $("scheda-nodo").hidden = true; }
function posizionaScheda() {
  const el = $("scheda-nodo"); if (el.hidden || (!M.sel && !M.selTimer && !SA.sel)) return;
  const v = M.selTimer ? T.pos.get(M.selTimer) : SA.sel ? SA.pos.find((x) => x.q.k === SA.sel.k && x.sess.id === SA.sel.sess) : null;
  if (SA.sel && !v) return chiudiScheda();
  if (M.selTimer && !v) return;
  const n = v ? { x: 0, y: 0 } : M.nodi.get(M.sel); if (!n) return chiudiScheda();
  const p = v ? { x: v.x, y: v.y } : schermo(n.x, n.y), r = v ? v.r : raggioDi(n) * M.cam.z;
  let x = p.x + r + 18, y = p.y - 60;
  if (x + 340 > M.w - 10) x = p.x - r - 18 - 340;
  y = Math.max(10, Math.min(M.h - el.offsetHeight - 10, y));
  el.style.left = Math.max(10, x) + "px"; el.style.top = y + "px";
}
// cosa sta facendo adesso ogni agente, e i messaggi che passano fra i nodi
function tracciaMappa(ev) {
  M.sporca = true; // ogni evento può cambiare un colore, un'etichetta o un anello: il prossimo fotogramma si disegna
  const s = S.sessioni.get(ev.id);
  tracciaVolto(ev); tracciaVolti(ev); // i volti dell'assistente e dei ruoli (volto.js, volti.js)
  if (ev.type === "delta_tool") M.attivita.set(ev.id, { testo: `⚙ ${NOMI_TOOL[ev.nome] || ev.nome}`, t: Date.now() });
  else if (ev.type === "delta_pensa") M.attivita.set(ev.id, { testo: "ragiona…", t: Date.now() });
  else if (ev.type === "delta") {
    const a = M.attivita.get(ev.id);
    if (!a || !a.scrive) M.attivita.set(ev.id, { testo: "scrive…", scrive: true, t: Date.now() });
  }
  else if (ev.type === "fine") M.attivita.delete(ev.id);
  else if (ev.type === "cockpit_utente" && s) {
    const chiave = (x) => x.ruolo === "orchestratore" ? "j:" + x.id : "a:" + x.id;
    const mittente = ev.nota ? null : [...S.sessioni.values()].find((x) => x.nome === ev.mittente);
    const verso = chiave(s);
    if (ev.nota) {
      const a = [...S.sessioni.values()].find((x) => ev.nota.startsWith(x.nome + " "));
      if (a) M.impulsi.push({ da: chiave(a), a: verso, t0: performance.now() });
    }
    else M.impulsi.push({ da: mittente ? chiave(mittente) : "tu", a: verso, t0: performance.now() });
  }
  if (ev.type === "cockpit_sessione" || ev.type === "cockpit_rimossa") setTimeout(layout, 0);
  if (ev.type === "cockpit_sessione" && M.on) setTimeout(() => { // le schede aperte seguono i sotto-agenti che avanzano
    if (M.sel && M.sel.endsWith(":" + ev.id)) rendiSottoScheda();
    if (SA.sel && SA.sel.sess === ev.id) {
      const v = SA.pos.find((x) => x.q.k === SA.sel.k && x.sess.id === SA.sel.sess);
      if (v) apriSchedaSotto(v, true);
    }
  }, 60);
}
// A turno chiuso bene l'anello di avanzamento di un agente si completa.
function completaAnello(ev) {
  if (ev.errore) return;
  const n = M.on && M.nodi.get(`a:${ev.id}`);
  if (!n || (n.ruolo !== "agente" && n.ruolo !== "squadra")) return;
  const a = M.anelli.get(n.k) || { v: null, vis: 0, fineT: 0, completa: 0 };
  M.anelli.set(n.k, a);
  a.completa = 1;
}
// Il pulsante della voce sta sopra il volto dell'assistente e si vede solo mentre parla (condivisi/pulsante-voce.js).
function posizionaComandoVoce() {
  const box = $("voce-comando"), n = [...M.nodi.values()].find((v) => v.ruolo === "orchestratore");
  if (!box || !n) return;
  const p = schermo(n.x, n.y), zt = Math.max(0.75, Math.min(1.25, M.cam.z));
  box.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y - raggioDi(n) * M.cam.z - 44 * zt)}px) translateX(-50%)`;
}

function initMappa() {
  su("*", tracciaMappa);
  su("fine", completaAnello); BM.initBachecaMappa({ M, schermo, righe, LONTANO });
  // la tela segue le dimensioni reali (finestra, pannello della chat che si apre o si chiude)
  if ("ResizeObserver" in window) new ResizeObserver(() => { toccaMappa(); if (M.on) ridimensionaMappa(); }).observe(M.cv);
  else addEventListener("resize", () => M.on && ridimensionaMappa());
  // sulla mappa intera, non solo sulla tela: anche un foglio trascinato sposta il legame disegnato verso la sua sfera
  for (const tipo of ["pointerdown", "pointermove", "pointerup", "wheel"]) (M.cv.closest(".mappa") || M.cv).addEventListener(tipo, toccaMappa, { passive: true });
  M.cv.addEventListener(
    "pointerdown",
    (e) => { const r = M.cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      pan = { x: e.clientX, y: e.clientY, cx: M.cam.x, cy: M.cam.y, mosso: false, nodo: nodoA(x, y), timer: timerA(x, y), segno: segnoA(x, y), sotto: sottoA(x, y), bacheca: BM.sopra(x, y) };
      if (pan.nodo && !pan.sotto && !pan.bacheca) PO.prendi(pan, x, y); // si trascina la sfera, non la mappa (posti.js)
      M.cv.setPointerCapture(e.pointerId); }
  );
  M.cv.addEventListener("pointermove", (e) => {
    const r = M.cv.getBoundingClientRect();
    if (pan) {
      const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
      if (Math.hypot(dx, dy) > 4) {
        pan.mosso = true;
        M.cv.classList.add("trascina");
      } if (pan.mosso && pan.presa) PO.muovi(pan, e.clientX - r.left, e.clientY - r.top);
      else if (pan.mosso) { M.cam.x = pan.cx - dx / M.cam.z; M.cam.y = pan.cy - dy / M.cam.z; }
      return;
    }
    const sa = sottoA(e.clientX - r.left, e.clientY - r.top);
    if (sa) {
      M.sopra = null;
      M.cv.classList.add("su-nodo");
      const info = infoSotto(sa);
      if (M.cv.title !== info) M.cv.title = info;
      return;
    } // un sotto-agente: etichetta, fase, stato, durata
    const cz = [...M.ctx.values()].find((v) => Math.hypot(v.x - (e.clientX - r.left), v.y - (e.clientY - r.top)) <= v.r + 3);
    if (cz) {
      M.sopra = null; M.cv.classList.remove("su-nodo");
      const info = testoContesto(cz.s);
      if (M.cv.title !== info) M.cv.title = info;
      return;
    } // il cerchiolino del contesto: token, modello, compattazione
    const sg = segnoA(e.clientX - r.left, e.clientY - r.top);
    if (sg) {
      M.sopra = null;
      M.cv.classList.add("su-nodo");
      const info = testoSegno(sg.id);
      if (M.cv.title !== info) M.cv.title = info;
      return;
    } // il segno «?»: cosa chiede
    const tm = timerA(e.clientX - r.left, e.clientY - r.top);
    if (tm) {
      M.sopra = null;
      M.cv.classList.add("su-nodo");
      const info = `⏲ ${tm.descrizione} — ${dettaglioTimer(tm)}`;
      if (M.cv.title !== info) M.cv.title = info;
      return;
    } // il timer: cosa controlla e fra quanto scatta
    const bc = BM.sopra(e.clientX - r.left, e.clientY - r.top);
    if (bc || ["bacheca", "ing", "cuore", "scopa"].includes(M.sopra)) M.sporca = true;
    if (bc) { M.sopra = bc.k; M.cv.classList.add("su-nodo"); M.cv.title = bc.titolo; return; }
    const n = nodoA(e.clientX - r.left, e.clientY - r.top); M.sopra = n?.k || null; M.cv.classList.toggle("su-nodo", !!n);
    const passo = n?.s && (n.s.stato === "lavora" || n.s.stato === "avvio") ? n.s.progresso?.passo || "" : ""; // il passo corrente, a parole e senza numeri
    const info = n?.s ? [nomeModello(n.s.modello), passo].filter(Boolean).join(" · ") : ""; // al passaggio del mouse: il modello e il passo
    if (M.cv.title !== info) M.cv.title = info;
  });
  M.cv.addEventListener("pointerup", () => { M.cv.classList.remove("trascina"); if (pan?.mosso && pan.presa) PO.lascia(pan); if (pan && !pan.mosso) {
    if (pan.bacheca) pan.bacheca.clic();
    else if (pan.segno) apriDomandeDi(pan.segno.id);
    else if (pan.sotto) {
      if (pan.sotto.q.tipo === "gruppo") {
        SA.espansi.has(pan.sotto.q.k) ? SA.espansi.delete(pan.sotto.q.k) : SA.espansi.add(pan.sotto.q.k);
      } else apriSchedaSotto(pan.sotto);
    } else if (pan.timer) apriSchedaTimer(pan.timer.id);
    else if (pan.nodo && pan.nodo.ruolo !== "tu") apriScheda(pan.nodo);
    else chiudiScheda();
  } pan = null; });
  M.cv.addEventListener("pointercancel", () => { M.cv.classList.remove("trascina"); if (pan?.mosso && pan.presa) PO.lascia(pan); pan = null; });
  M.cv.addEventListener("dblclick", (e) => { const r = M.cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; const n = nodoA(x, y); if (n && n.s) apri(n.s.id); });
  initZoom({ M, zMin: ZOOM_MIN, mondo, tocca: toccaMappa, vuoto: (x, y) => !(nodoA(x, y) || sottoA(x, y) || timerA(x, y) || segnoA(x, y) || BM.sopra(x, y) || [...M.ctx.values()].some((v) => Math.hypot(v.x - x, v.y - y) <= v.r + 3)) });
  M.cv.addEventListener("wheel", (e) => {
    e.preventDefault(); fermaZoom(); const r = M.cv.getBoundingClientRect(); const px = e.clientX - r.left, py = e.clientY - r.top;
    const prima = mondo(px, py); M.cam.z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, M.cam.z * Math.exp(-e.deltaY * 0.0015)));
    const dopo = mondo(px, py); M.cam.x += prima.x - dopo.x; M.cam.y += prima.y - dopo.y;
  }, { passive: false });
  $("m-centra").onclick = inquadra; PO.initPosti({ M, mondo, layout, inquadra });
  setTimeout(vistaMappa, 300);
}
export { M, chiudiScheda, initMappa, layout, posizionaScheda, puntoCurva, raggioDi, schermo, tracciaMappa, vistaMappa };
