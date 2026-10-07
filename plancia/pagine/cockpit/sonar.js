// Il sonar: la sfera dell'assistente al centro, che cambia colore e ritmo con lo stato (pronto, ascolto, pensa, parla).
// «Parla» viene dalla coda della voce (condivisi/voce-motore.js): la sfera smette appena la voce si ferma o si salta.
import { ascolto, livelloMic, sv, tickMic } from "./ascolto.js";
import { $, S, TEMA, fermo } from "./comune.js";
import { analizzatoreVoce, stato, suStato } from "/condivisi/voce-motore.js";

// ---- il sonar ---------------------------------------------------------------------------
const cv = $("orb"), cx = cv.getContext("2d");
let modo = "pronto";
let livelloVoce = 0; // il volume della voce, addolcito: fa pulsare la sfera
function aggiornaOrb() {
  const j = S.orchestratore && S.sessioni.get(S.orchestratore);
  const lavora = j && (j.stato === "lavora" || j.stato === "avvio");
  modo = ascolto || sv.comando ? "ascolto" : stato().parlando ? "parla" : lavora ? "pensa" : "pronto";
  $("orb-stato").textContent = { pronto: "Pronto", ascolto: "Ti ascolto", pensa: "Ci sto lavorando", parla: "Sto parlando" }[modo];
}
const onde = []; let ultimaOnda = 0, fase = 0;
function disegna(t) {
  tickMic();
  const W = cv.width, H = cv.height, c = W / 2;
  cx.clearRect(0, 0, W, H);
  const colore = modo === "ascolto" ? TEMA.coral : modo === "parla" ? TEMA.violet : TEMA.sonar;
  const ritmo = { pronto: 2600, ascolto: 700, pensa: 1100, parla: 520 }[modo];
  if (!fermo && t - ultimaOnda > ritmo) { onde.push({ nata: t }); ultimaOnda = t; }
  const vita = modo === "pronto" ? 4200 : 2400;
  for (let i = onde.length - 1; i >= 0; i--) {
    const k = (t - onde[i].nata) / vita;
    if (k >= 1) { onde.splice(i, 1); continue; }
    const r = 70 + k * (c - 72);
    cx.beginPath(); cx.arc(c, c, r, 0, Math.PI * 2);
    cx.strokeStyle = `rgba(${colore},${(1 - k) * 0.55})`; cx.lineWidth = 2.2 * (1 - k) + 0.6; cx.stroke();
  }
  fase += modo === "pensa" ? 0.035 : 0.008;
  if (modo === "pensa") {
    for (let a = 0; a < 3; a++) { cx.beginPath(); cx.arc(c, c, 84 + a * 16, fase * (a % 2 ? -1.3 : 1) + a, fase * (a % 2 ? -1.3 : 1) + a + 1.1);
      cx.strokeStyle = `rgba(${colore},${0.75 - a * 0.2})`; cx.lineWidth = 3; cx.lineCap = "round"; cx.stroke(); }
  }
  const analizzatore = analizzatoreVoce();
  if (analizzatore) {
    const d = new Uint8Array(analizzatore.frequencyBinCount);
    analizzatore.getByteFrequencyData(d);
    let somma = 0;
    for (const v of d) somma += v;
    livelloVoce = livelloVoce * 0.6 + (somma / d.length / 255) * 0.4;
  } else livelloVoce *= 0.9;
  let respiro = 2 * Math.sin(t / 900);
  if (modo === "parla") respiro = analizzatore ? 4 + livelloVoce * 46 : 6 * Math.abs(Math.sin(t / 90)) + 3 * Math.abs(Math.sin(t / 37));
  else if (modo === "ascolto") respiro = fermo ? 0 : 3 + livelloMic() * 26;
  const R = 60 + respiro;
  const g = cx.createRadialGradient(c - 10, c - 12, 4, c, c, R);
  g.addColorStop(0, `rgba(${colore.map((x) => Math.min(255, x + 90))},1)`);
  g.addColorStop(0.55, `rgba(${colore},0.95)`);
  g.addColorStop(1, `rgba(${colore.map((x) => x * 0.35 | 0)},0.9)`);
  cx.shadowColor = `rgba(${colore},0.8)`; cx.shadowBlur = 38;
  cx.beginPath(); cx.arc(c, c, R, 0, Math.PI * 2); cx.fillStyle = g; cx.fill(); cx.shadowBlur = 0;
  requestAnimationFrame(disegna);
}

function initSonar() {
  requestAnimationFrame(disegna);
  suStato(aggiornaOrb); // la voce parte, finisce, si salta o si ferma: il modo cambia subito
}
export { aggiornaOrb, initSonar };
