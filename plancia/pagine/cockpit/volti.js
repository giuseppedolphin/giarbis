// I volti dei ruoli della squadra sulla pagina: quale tipo ha un ruolo (campo `volto` del file dei ruoli, arriva con i colori da
// GET /api/squadra/colori), quale espressione ha adesso e il disegno sulla mappa. Chi non ha un volto dichiarato, o un tipo che
// qui non esiste, resta con la sfera di sempre. L'espressione viene solo da segnali veri, gli stessi dell'assistente (volto.js):
//   pensa/lavora  sessione in `lavora`/`avvio`, `delta_tool` aperto = lavora, altrimenti pensa
//   contento 3 s  `fine` senza errore · preoccupato 8 s  `fine` con errore, `cockpit_errore`, e finché lo stato è `errore`
//   sorpreso 1,3 s  `cockpit_utente` · attende (guarda verso la tua sfera) · ferma (occhi quasi chiusi) · riposo
// Non chiede fotogrammi in più: il ritmo resta quello di passoMappa in mappa.js.
import { RIDOTTO, S } from "./comune.js";
import { disegnaFaccia, espressione, TIPI, tavolozza } from "./volti-disegno.js";
import { coloreRuolo, rgbRuolo } from "/condivisi/colori.js";

const DURATA = { sorpreso: 1300, preoccupato: 8000, contento: 3000 };
const V = new Map(); // id sessione → { tool, fino }
const di = (id) => { let v = V.get(id); if (!v) { v = { tool: false, fino: {} }; V.set(id, v); } return v; };
const tela = (px) => { const c = document.createElement("canvas"); c.width = c.height = px; return c; };
const immagine = tavolozza(tela);
const tipoDi = (slug) => { const t = coloreRuolo(slug)?.volto; return TIPI.includes(t) ? t : ""; };
// un numero piccolo per ruolo: i capi non battono le ciglia tutti insieme
const semeDi = (slug) => [...String(slug)].reduce((a, c) => a + c.charCodeAt(0), 0) % 7;

function tracciaVolti(ev) {
  if (!ev?.id) return;
  const s = S.sessioni.get(ev.id);
  if (s?.ruolo !== "squadra" || !tipoDi(s.nome)) return;
  const v = di(ev.id), lampo = (k) => { v.fino[k] = performance.now() + DURATA[k]; };
  if (ev.type === "delta_tool") v.tool = true;
  else if (ev.type === "delta" || ev.type === "delta_pensa" || ev.type === "risultati") v.tool = false;
  else if (ev.type === "fine") { v.tool = false; lampo(ev.errore ? "preoccupato" : "contento"); }
  else if (ev.type === "cockpit_errore") { v.tool = false; lampo("preoccupato"); }
  else if (ev.type === "cockpit_utente") lampo("sorpreso");
}
function statoRuolo(s, now) {
  const v = V.get(s.id);
  if (s.stato === "errore") return "preoccupato";
  if (v) for (const k of ["sorpreso", "preoccupato", "contento"]) if (now < (v.fino[k] || 0)) return k;
  if (s.stato === "lavora" || s.stato === "avvio") return v?.tool ? "lavora" : "pensa";
  return s.stato === "attende" ? "attende" : s.stato === "ferma" ? "ferma" : "riposo";
}

// la sfera di un nodo che non è l'assistente: col volto se il ruolo ne ha uno, altrimenti quella di sempre.
// L'alone resta in tela (come per ogni sfera); la faccia è un'immagine già pronta.
function disegnaSfera(cx, n, p, r, colore, alone, t, tu) {
  const tipo = n.ruolo === "squadra" && n.s ? tipoDi(n.s.nome) : "";
  if (tipo) {
    const dx = tu ? tu.x - n.x : -1, dy = tu ? tu.y - n.y : 1, dl = Math.hypot(dx, dy) || 1;
    const img = immagine(n.s.nome, tipo, statoRuolo(n.s, performance.now()), r, cx.getTransform().a, colore, RIDOTTO.matches ? 1400 : t, semeDi(n.s.nome), { x: dx / dl, y: dy / dl });
    cx.shadowColor = `rgba(${colore},.7)`; cx.shadowBlur = alone;
    cx.beginPath(); cx.arc(p.x, p.y, r - 1, 0, Math.PI * 2); cx.fillStyle = `rgb(${colore})`; cx.fill(); cx.shadowBlur = 0;
    cx.drawImage(img, p.x - r, p.y - r, r * 2, r * 2);
    return;
  }
  const g = cx.createRadialGradient(p.x - r * 0.3, p.y - r * 0.35, r * 0.1, p.x, p.y, r);
  g.addColorStop(0, `rgba(${colore.map((x) => Math.min(255, x + 90))},1)`);
  g.addColorStop(0.55, `rgba(${colore},.95)`);
  g.addColorStop(1, `rgba(${colore.map((x) => x * 0.3 | 0)},.95)`);
  cx.shadowColor = `rgba(${colore},.7)`; cx.shadowBlur = alone;
  cx.beginPath(); cx.arc(p.x, p.y, r, 0, Math.PI * 2); cx.fillStyle = g; cx.fill(); cx.shadowBlur = 0;
}

// il volto fermo per scheda e chat: un'immagine sola per ruolo, disegnata una volta. "" se il ruolo non ha un volto
const FOTO = new Map();
function fotoVolto(slug) {
  const tipo = tipoDi(slug), col = tipo && rgbRuolo(slug, false);
  if (!col) return "";
  if (!FOTO.has(slug)) {
    const c = tela(96);
    disegnaFaccia(c.getContext("2d"), 48, 48, 47, tipo, col, espressione("riposo", 1400), 1400);
    FOTO.set(slug, c.toDataURL("image/png"));
  }
  return FOTO.get(slug);
}

function mostraFoto(img, slug) { const f = fotoVolto(slug); img.hidden = !f; if (f) img.src = f; }

export { disegnaSfera, fotoVolto, mostraFoto, statoRuolo, tracciaVolti };
