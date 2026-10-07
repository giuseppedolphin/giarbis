// Il microfono, in tre cose che cockpit e bolla non devono rifare:
//  1. il livello del segnale (0..1) da un AnalyserNode, aperto solo mentre serve;
//  2. il bip che dice «ti ascolto»;
//  3. il possesso: con più schede aperte microfono e voce stanno in una sola, e il possesso passa fra loro sul
//     BroadcastChannel «plancia-voce» (a chi torna in primo piano o a chi lo prende con un clic). Due dettature vive
//     insieme non vanno (Chrome ne tiene una sola) e due voci insieme si sovrappongono.
import { iniettaStile } from "./stile.js";

// ---- livello -----------------------------------------------------------------------------------
const L = { liv: 0, bump: 0, stream: null, ctx: null, an: null, buf: null, richiesta: 0 };

// Apre (true) o chiude (false) il microfono per misurare il livello. Se il browser non lo concede, il livello
// si regge sui colpetti (colpetto()), che decadono da soli.
export async function apriLivello(acceso) {
  const mia = ++L.richiesta;
  if (!acceso) {
    L.stream?.getTracks().forEach((t) => t.stop());
    L.ctx?.close().catch(() => {});
    L.stream = L.ctx = L.an = L.buf = null;
    L.liv = L.bump = 0;
    return;
  }
  try {
    const st = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    if (mia !== L.richiesta) { st.getTracks().forEach((t) => t.stop()); return; }
    const c = new (window.AudioContext || window.webkitAudioContext)();
    const an = c.createAnalyser();
    an.fftSize = 512;
    c.createMediaStreamSource(st).connect(an);
    Object.assign(L, { stream: st, ctx: c, an, buf: new Uint8Array(an.fftSize) });
  } catch {}
}

// Un colpetto di livello: ogni risultato del riconoscimento lo dà, così la grafica si muove anche senza accesso al segnale.
export const colpetto = (x = 0.6) => { L.bump = x; };

// Il livello addolcito: da chiamare una volta per fotogramma.
export function livello() {
  let l = 0;
  if (L.an) {
    L.an.getByteTimeDomainData(L.buf);
    let s = 0;
    for (const v of L.buf) { const x = (v - 128) / 128; s += x * x; }
    l = Math.min(1, Math.sqrt(s / L.buf.length) * 5);
  }
  L.bump *= 0.94;
  L.liv = L.liv * 0.65 + Math.max(l, L.bump) * 0.35;
  return L.liv;
}

export function bip() {
  try {
    const c = new (window.AudioContext || window.webkitAudioContext)();
    const o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(880, c.currentTime);
    o.frequency.linearRampToValueAtTime(1320, c.currentTime + 0.12);
    g.gain.setValueAtTime(0.0001, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.15, c.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.18);
    o.connect(g); g.connect(c.destination);
    o.start(); o.stop(c.currentTime + 0.2);
  } catch {}
}

// ---- possesso ------------------------------------------------------------------------------------
const idScheda = Math.random().toString(36).slice(2);
const P = { possiede: document.visibilityState === "visible", avviato: false, canale: null, avviso: null, altrove: false, ascoltatori: new Set(), inoltri: new Set() };
const CSS_AVVISO = `.pl-avviso-voce{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:2147482500;padding:6px 14px;border-radius:999px;
  border:1px solid var(--pl-line2);background:var(--pl-deep);color:var(--pl-text);font:12px system-ui,-apple-system,"Segoe UI",sans-serif;cursor:pointer;opacity:.9}
  .pl-avviso-voce[hidden]{display:none}`;

export const possiedo = () => P.possiede;

// Una cosa da dire a voce, da una scheda che non ha il possesso: la riceve quella che ce l'ha (fn(testo, chiave)).
// Restituisce false se non c'è canale (nessun'altra scheda può sentirla).
export function inoltraAlPossessore(testo, chiave) {
  if (!P.canale) return false;
  P.canale.postMessage({ t: "di", id: idScheda, testo, chiave });
  return true;
}
export function suInoltrato(fn) {
  P.inoltri.add(fn);
  return () => P.inoltri.delete(fn);
}

// fn(possiede) a ogni passaggio di mano; restituisce la funzione che toglie l'ascolto.
export function suPossesso(fn) {
  P.ascoltatori.add(fn);
  return () => P.ascoltatori.delete(fn);
}

const avvisa = () => { if (P.avviso) P.avviso.hidden = P.possiede || !P.altrove; };
const notifica = () => { for (const fn of P.ascoltatori) { try { fn(P.possiede); } catch (e) { console.error(e); } } };

function rilascia() {
  if (!P.possiede) return;
  P.possiede = false;
  P.altrove = true;
  avvisa();
  notifica();
}

// Prende il possesso e lo dice alle altre schede, che mollano microfono e voce.
export function prendi() {
  P.altrove = false;
  if (!P.possiede) { P.possiede = true; notifica(); }
  P.canale?.postMessage({ t: "presa", id: idScheda });
  avvisa();
}

// Accende il protocollo (una volta sola; richiamarla è innocuo). avviso: true mostra in basso «voce attiva in un'altra
// scheda · usa qui» quando il possesso è altrove (il cockpit lo vuole, la bolla ha già il suo messaggio).
export function avviaPossesso({ avviso = false } = {}) {
  if (avviso && !P.avviso) {
    iniettaStile("pl-avviso-voce", CSS_AVVISO);
    P.avviso = document.createElement("button");
    P.avviso.type = "button"; P.avviso.className = "pl-avviso-voce"; P.avviso.hidden = true;
    P.avviso.textContent = "Voce attiva in un'altra scheda · usa qui";
    P.avviso.onclick = () => prendi();
    document.body.append(P.avviso);
  }
  if (P.avviato) return;
  P.avviato = true;
  addEventListener("focus", () => { if (!P.possiede) prendi(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && !P.possiede) prendi(); });
  if (!("BroadcastChannel" in window)) return;
  const c = P.canale = new BroadcastChannel("plancia-voce");
  c.onmessage = (m) => {
    const d = m.data || {};
    if (d.id === idScheda) return;
    if (d.t === "presa") { P.altrove = true; rilascia(); avvisa(); }
    else if (d.t === "di") { if (P.possiede) for (const fn of P.inoltri) { try { fn(d.testo, d.chiave); } catch (e) { console.error(e); } } }
    else if (d.t === "chi" && P.possiede) c.postMessage({ t: "presente", id: idScheda });
    else if (d.t === "presente") { P.altrove = true; avvisa(); }
  };
  // All'apertura: una scheda in primo piano prende il possesso; una aperta in sottofondo lo prende solo se nessun'altra risponde.
  if (P.possiede) c.postMessage({ t: "presa", id: idScheda });
  else {
    c.postMessage({ t: "chi", id: idScheda });
    setTimeout(() => { if (!P.altrove && !P.possiede) prendi(); }, 400);
  }
}
