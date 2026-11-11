// La visita guidata: pochi passi sopra la pagina vera, con un velo che lascia scoperto ciò di cui si parla. Parte da sola solo se
// il server dice che la plancia è nuova (server/visita.mjs): la memoria del browser non basta, un browser vuoto su una plancia già
// in uso non deve vederla. Un server che non conosce /api/visita, fermo a prima del Riavvia, non la fa partire. Si riapre dal menu
// dell'ingranaggio sulla mappa (pulsante nascosto #m-visita). Il nome dell'assistente viene da assistente.nome.
import { sferaAssistente } from "./bacheca-mappa.js";
import { $, assistente, fermo, istanza } from "./comune.js";
import { api } from "/condivisi/api.js";

const passi = () => {
  const nome = assistente.nome;
  return [
    { titolo: "La mappa", su: ".mappa", testo: `Qui vedi tutto il lavoro in corso: ${nome} al centro, tu accanto, gli agenti attorno. Trascini lo sfondo per spostarti, con la rotella ti avvicini; una sfera si trascina dove preferisci.` },
    { titolo: nome, su: sferaAssistente, testo: `Un clic sulla sfera di ${nome} apre la sua scheda, e da «Apri la chat» scrivi o usi il microfono. Coordina invece di eseguire: una cosa veloce la risolve, un lavoro lungo lo affida a un agente.` },
    { titolo: "Gli agenti", su: "#apri-nuovo", testo: `Ogni agente è una sfera sulla mappa e lavora in parallelo. Lo lanci da qui, oppure lo chiedi a ${nome}. L'anello attorno alla sfera dice a che punto è; un clic apre la sua scheda.` },
    { titolo: "I fogli", su: "#m-fogli", testo: "Quello che c'è da guardare, un grafico, una tabella, una bozza, arriva come foglio sulla mappa. Da qui li ritrovi, li accendi e li spegni. Il pallino viola sul bordo di un foglio fa nascere un agente solo per quel foglio." },
    { titolo: "Da decidere", su: "#rdnav-domande", testo: `Quando a ${nome} o a un agente serve una tua risposta, la domanda arriva in questa casella e sulla sua sfera compare un «?». Rispondi da qui con un tocco. La visita si riapre dall'ingranaggio sopra la sfera di ${nome}.` },
  ];
};

let aperta = null;

// Dove sta il bersaglio: null se non c'è o non si vede (su uno schermo stretto una parte della pagina è nascosta): il passo resta, al centro.
function bersaglio(su) {
  const el = typeof su === "function" ? null : document.querySelector(su);
  const r = typeof su === "function" ? su() : el?.getBoundingClientRect();
  if (!r) return null;
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight ? r : null;
}

function posiziona() {
  const { velo, buco, carta, lista, i } = aperta;
  const r = bersaglio(lista[i].su), M = 12, C = carta.getBoundingClientRect();
  velo.classList.toggle("vs-senza", !r); buco.hidden = !r;
  let x = (innerWidth - C.width) / 2, y = (innerHeight - C.height) / 2;
  if (r) {
    const P = 6;
    Object.assign(buco.style, { left: `${r.left - P}px`, top: `${r.top - P}px`, width: `${r.width + P * 2}px`, height: `${r.height + P * 2}px` });
    const sotto = r.bottom + P + M, sopra = r.top - P - M - C.height;
    // un bersaglio grande come la mappa non lascia spazio attorno: la carta ci sta sopra, in basso
    y = sotto + C.height <= innerHeight - M ? sotto : sopra >= M ? sopra : innerHeight - C.height - M * 2;
    x = r.left + r.width / 2 - C.width / 2;
  }
  carta.style.left = `${Math.max(M, Math.min(x, innerWidth - C.width - M))}px`;
  carta.style.top = `${Math.max(M, y)}px`;
}

function disegna() {
  const { carta, lista, i } = aperta, p = lista[i], ultimo = i === lista.length - 1;
  carta.querySelector(".vs-n").textContent = `${i + 1} di ${lista.length}`;
  carta.querySelector("h2").textContent = p.titolo;
  carta.querySelector("p").textContent = p.testo;
  carta.querySelector(".vs-punti").innerHTML = lista.map((_, n) => `<i class="${n === i ? "on" : ""}"></i>`).join("");
  const indietro = carta.querySelector("[data-v=indietro]"), avanti = carta.querySelector("[data-v=avanti]");
  indietro.hidden = i === 0;
  avanti.textContent = ultimo ? "Fine" : "Avanti";
  carta.querySelector("[data-v=salta]").hidden = ultimo;
  posiziona();
  avanti.focus({ preventScroll: true });
}

function vai(d) {
  const n = aperta.i + d;
  if (n < 0) return;
  if (n >= aperta.lista.length) return chiudi("finita");
  aperta.i = n; disegna();
}

function chiudi(come) {
  if (!aperta) return;
  const { velo, prima } = aperta;
  removeEventListener("resize", posiziona); document.removeEventListener("keydown", tasti, true);
  velo.remove(); aperta = null;
  prima?.focus?.({ preventScroll: true });
  api("POST", "/api/visita/vista", { come }).catch(() => {}); // server vecchio: si richiuderà da sola soltanto dopo il Riavvia
}

function tasti(e) {
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); chiudi("saltata"); }
  else if (e.key === "ArrowRight") { e.preventDefault(); vai(1); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); vai(-1); }
  else if (e.key === "Tab") { // il fuoco resta nella carta
    const b = [...aperta.carta.querySelectorAll("button:not([hidden])")], q = b.indexOf(document.activeElement);
    e.preventDefault();
    b[(q + (e.shiftKey ? -1 : 1) + b.length) % b.length].focus();
  }
}

function apri() {
  if (aperta) return;
  const velo = document.createElement("div");
  velo.className = `visita${fermo ? " vs-fermo" : ""}`;
  velo.innerHTML = '<div class="vs-buco" aria-hidden="true"></div><div class="vs-carta" role="dialog" aria-modal="true" aria-labelledby="vs-titolo" aria-describedby="vs-testo">'
    + '<span class="vs-n"></span><h2 id="vs-titolo"></h2><p id="vs-testo"></p><div class="vs-piede"><span class="vs-punti" aria-hidden="true"></span>'
    + '<button type="button" class="btn leggero" data-v="salta">Salta</button><button type="button" class="btn leggero" data-v="indietro">Indietro</button>'
    + '<button type="button" class="btn primario" data-v="avanti">Avanti</button></div></div>';
  document.body.appendChild(velo);
  aperta = { velo, buco: velo.querySelector(".vs-buco"), carta: velo.querySelector(".vs-carta"), lista: passi(), i: 0, prima: document.activeElement };
  velo.addEventListener("click", (e) => {
    const v = e.target.closest("[data-v]")?.dataset.v;
    if (v === "salta") chiudi("saltata"); else if (v === "indietro") vai(-1); else if (v === "avanti") vai(1);
  });
  addEventListener("resize", posiziona);
  document.addEventListener("keydown", tasti, true);
  disegna();
}

export async function initVisita() {
  $("m-visita").onclick = (e) => { e.stopPropagation(); apri(); };
  if (istanza.modalita === "setup") return; // la visita viene dopo la configurazione, con l'assistente vero
  try { if ((await api("GET", "/api/visita")).visita.mostra) apri(); } catch { /* server fermo a prima del Riavvia: niente visita */ }
}
