// I fogli sopra la mappa (pagine, tabelle, immagini e i tipi dei moduli): stato sul server, accesi e spenti, trascinamento.
// Ogni tipo di foglio ha un disegnatore registrato con registraTipoFoglio: il nucleo conosce html, immagine e tabella, il
// foglio delle proposte lo registra proposte.js, gli altri arrivano dalle pagine dei moduli.
import { $, COL, assistente, mostraBanner, md } from "./comune.js";
import { M, raggioDi, schermo, vistaMappa } from "./mappa.js";
import { aggiornaPallini } from "./agenti-foglio.js";
import { api } from "/condivisi/api.js";
import { su } from "/condivisi/eventi.js";
import { esc } from "/condivisi/formati.js";
import { apriLavagna } from "/condivisi/lavagna.js";

// Lo stato sta sul server (fogli.json nella cartella di stato): sopravvive al ricarico e arriva a tutte le schede con gli
// eventi cockpit_foglio / cockpit_foglio_chiuso. Le coordinate sono in pixel dentro la mappa.
const C = {
  el: new Map(), // id → elemento del foglio
  dati: new Map(), // id → foglio come lo manda il server
  firma: new Map(), // id → firma dell'ultimo contenuto disegnato
  z: 10, // il foglio in primo piano
  trascina: null, // l'id del foglio che si sta spostando o ridimensionando
};

// ---- il registro dei tipi di foglio -------------------------------------------------------------
// def = { nome, disegna(corpo, foglio, ctx), aggiorna?(foglio) }: nome è il testo dell'elenco «Fogli» (o una funzione);
// disegna riempie il corpo del foglio al primo disegno e quando cambiano titolo o contenuto; con aggiorna il foglio mostra ↻.
const TIPI = new Map();
const ctxFogli = { mostraBanner, md, apriLavagna };
function registraTipoFoglio(tipo, def) {
  TIPI.set(tipo, def);
  for (const [id, c] of C.dati) {
    if (c.tipo !== tipo) continue;
    C.firma.delete(id);
    upsertFoglio(c, false);
  }
}
const nomeTipo = (tipo) => {
  const n = TIPI.get(tipo)?.nome;
  return (typeof n === "function" ? n() : n) || tipo;
};

registraTipoFoglio("html", {
  nome: "pagina",
  disegna: (corpo, c) => {
    corpo.innerHTML = `<iframe sandbox="allow-scripts allow-popups" title="${esc(c.titolo)}" src="${esc(c.percorso)}?v=${esc(c.agg || "")}"></iframe>`;
  },
});
registraTipoFoglio("immagine", {
  nome: "immagine",
  disegna: (corpo, c) => { corpo.innerHTML = `<img alt="${esc(c.titolo)}" src="${esc(c.percorso)}">`; },
});
registraTipoFoglio("tabella", {
  nome: "tabella",
  disegna(corpo, c) {
    const colonne = c.colonne || [];
    const th = colonne.map((x) => `<th>${esc(x)}</th>`).join("");
    const tr = (c.righe || []).map((r) => `<tr>${colonne.map((_, i) => `<td title="${esc(r[i])}">${esc(r[i])}</td>`).join("")}</tr>`).join("");
    corpo.innerHTML = tr ? `<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>` : '<div class="foglio-vuota">Tabella vuota.</div>';
  },
});

// ---- ciclo di vita ---------------------------------------------------------------------------------
async function caricaFogli() {
  const j = await api("GET", "/api/fogli");
  const ids = new Set(j.fogli.map((c) => c.id));
  for (const id of [...C.el.keys()]) if (!ids.has(id)) togliFoglio(id);
  for (const c of j.fogli) upsertFoglio(c, false);
}
const firmaFoglio = (c) => JSON.stringify([c.agg, c.titolo, c.percorso, c.tabella]);
const HTML_FOGLIO = '<button type="button" class="foglio-pallino"></button><div class="foglio-testa">'
  + '<button data-a="mappa" class="torna-mappa" title="Torna alla mappa (Esc)">← Mappa</button><b></b><span class="meta"></span>'
  + '<button data-a="aggiorna" title="Rileggi i dati" hidden>↻</button><button data-a="piena" title="A tutto schermo">⤢</button>'
  + '<button data-a="spegni" title="Spegni: il foglio si nasconde ma non si perde (si riaccende da «Fogli»)">–</button></div>'
  + '<div class="foglio-corpo"></div><div class="foglio-grip" title="Ridimensiona"></div>';

function creaElementoFoglio(c) {
  const el = document.createElement("div");
  el.className = "foglio";
  el.dataset.id = c.id;
  el.innerHTML = HTML_FOGLIO;
  $("fogli").appendChild(el);
  C.el.set(c.id, el);
  el.addEventListener("pointerdown", () => { el.style.zIndex = ++C.z; });
  el.querySelector(".foglio-testa").addEventListener("pointerdown", (e) => iniziaTrascina(e, el, "sposta"));
  el.querySelector(".foglio-grip").addEventListener("pointerdown", (e) => iniziaTrascina(e, el, "misura"));
  el.querySelector(".foglio-testa").addEventListener("click", (e) => {
    const a = e.target.closest("button")?.dataset.a;
    if (a) azioneFoglio(c.id, a);
  });
  el.style.zIndex = ++C.z;
  return el;
}

function upsertFoglio(c, nuova) {
  const riaccesa = !!C.dati.get(c.id) && C.dati.get(c.id).attiva === false && c.attiva !== false;
  C.dati.set(c.id, c);
  const el = C.el.get(c.id) || creaElementoFoglio(c);
  if (C.trascina !== c.id) {
    Object.assign(el.style, { left: `${c.x}px`, top: `${c.y}px`, width: `${c.w}px`, height: `${c.h}px` });
  }
  el.querySelector("b").textContent = c.titolo || "Foglio";
  el.querySelector(".meta").textContent = c.da ? `da ${c.da}` : "";
  el.querySelector('[data-a="aggiorna"]').hidden = !TIPI.get(c.tipo)?.aggiorna;
  const f = firmaFoglio(c);
  if (C.firma.get(c.id) !== f) { C.firma.set(c.id, f); rendiCorpoFoglio(c, el); }
  el.hidden = c.attiva === false; // spento: nascosto, ma posizione e misura restano
  contieniFoglio(el);
  if ((nuova || riaccesa) && c.attiva !== false && !M.on) {
    if (innerWidth > 900) vistaMappa(true); else mostraBanner(`Foglio sulla mappa: ${c.titolo}`, 5000);
  }
  rendiElencoFogli();
  aggiornaPallini();
}
function togliFoglio(id) {
  C.el.get(id)?.remove();
  C.el.delete(id); C.dati.delete(id); C.firma.delete(id);
  rendiElencoFogli();
}
function contieniFoglio(el) { // un foglio non resta fuori dalla mappa dopo un ridimensionamento della finestra
  if (el.hidden || el.classList.contains("piena") || !M.w) return;
  const x = Math.max(0, Math.min(el.offsetLeft, M.w - 80)), y = Math.max(0, Math.min(el.offsetTop, M.h - 40));
  if (x !== el.offsetLeft) el.style.left = `${x}px`;
  if (y !== el.offsetTop) el.style.top = `${y}px`;
}
function rendiCorpoFoglio(c, el) {
  const corpo = el.querySelector(".foglio-corpo");
  const def = TIPI.get(c.tipo);
  if (!def) {
    corpo.innerHTML = `<div class="foglio-vuota">Foglio di tipo «${esc(c.tipo)}»: non so disegnarlo, il modulo che lo offre non è acceso.</div>`;
    return;
  }
  def.disegna(corpo, c, ctxFogli);
}
function azioneFoglio(id, a) {
  const c = C.dati.get(id), el = C.el.get(id);
  if (!c || !el) return;
  if (a === "spegni") accendiFoglio(id, false);
  else if (a === "chiudi") eliminaFoglio(id);
  else if (a === "aggiorna") {
    Promise.resolve(TIPI.get(c.tipo)?.aggiorna?.(c)).catch((e) => mostraBanner(e.message, 4000));
  } else if (a === "piena") {
    if (c.tipo === "html" || c.tipo === "immagine") {
      apriLavagna({ titolo: c.titolo, src: c.percorso, da: c.da });
      return;
    } // la lavagna modale fa da ingrandimento
    el.classList.toggle("piena");
    el.style.zIndex = el.classList.contains("piena") ? "" : ++C.z;
  }
}
// accesi e spenti: lo stato sta sul server (fogli.json), vale per tutte le schede e lo può cambiare anche l'assistente (ctl foglio attiva|disattiva)
function accendiFoglio(id, acceso) {
  const c = C.dati.get(id), el = C.el.get(id);
  if (!c || !el) return;
  c.attiva = acceso;
  el.hidden = !acceso;
  if (acceso) el.style.zIndex = ++C.z;
  rendiElencoFogli();
  api("POST", "/api/fogli", { id, attiva: acceso }).catch((e) => mostraBanner(e.message, 4000));
}
function eliminaFoglio(id) {
  togliFoglio(id);
  api("POST", `/api/fogli/${id}/chiudi`).catch(() => {});
}
function dove(c) { // a parole, dove sta sulla mappa
  if (!M.w) return `x ${c.x} y ${c.y}`;
  const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
  const v = cy < M.h / 3 ? "in alto" : cy > (M.h * 2) / 3 ? "in basso" : "al centro";
  const o = cx < M.w / 3 ? "a sinistra" : cx > (M.w * 2) / 3 ? "a destra" : "";
  return `${v}${o ? ` ${o}` : ""}`;
}
function rendiElencoFogli() {
  const tutte = [...C.dati.values()];
  $("m-fogli").textContent = tutte.length ? `Fogli · ${tutte.filter((c) => c.attiva !== false).length}/${tutte.length}` : "Fogli";
  if ($("elenco-fogli").hidden) return;
  $("ec-lista").innerHTML = tutte.map((c) => `<div class="ec-riga${c.attiva === false ? " spenta" : ""}" data-id="${esc(c.id)}">`
    + `<input type="checkbox" role="switch" data-a="switch" ${c.attiva === false ? "" : "checked"} aria-label="Acceso: ${esc(c.titolo)}">`
    + `<span class="ec-t" title="${esc(c.titolo)}">${esc(c.titolo)}</span>`
    + '<button data-a="trova" title="Portalo in primo piano e fallo lampeggiare">Trova</button>'
    + '<button data-a="elimina" title="Elimina il foglio per sempre">Elimina</button>'
    + `<span class="ec-m">${esc(nomeTipo(c.tipo))}${c.da ? ` · da ${esc(c.da)}` : ""} · ${c.attiva === false ? "spento, " : ""}${dove(c)}`
    + ` · x ${c.x} y ${c.y} · ${c.w}×${c.h}</span></div>`).join("")
    || `<div class="ec-vuoto">Nessun foglio. ${esc(assistente.nome)} li apre con ctl.mjs foglio …, o li riapri da Artifax.</div>`;
}
// trascinamento e ridimensionamento: si salvano sul server solo al rilascio
function iniziaTrascina(e, el, modo) {
  const affiancato = el.classList.contains("piena") || el.classList.contains("affiancato");
  if (e.button !== 0 || affiancato || (modo === "sposta" && e.target.closest("button"))) return;
  e.preventDefault();
  const id = el.dataset.id;
  const o = { px: e.clientX, py: e.clientY, x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
  C.trascina = id;
  $("fogli").classList.add("in-uso");
  e.target.setPointerCapture(e.pointerId);
  const muovi = (m) => {
    const dx = m.clientX - o.px, dy = m.clientY - o.py;
    if (modo === "sposta") {
      el.style.left = `${Math.max(0, Math.min(M.w - 80, o.x + dx))}px`;
      el.style.top = `${Math.max(0, Math.min(M.h - 40, o.y + dy))}px`;
    } else {
      el.style.width = `${Math.max(240, Math.min(M.w - o.x, o.w + dx))}px`;
      el.style.height = `${Math.max(140, Math.min(M.h - o.y, o.h + dy))}px`;
    }
  };
  const fine = () => {
    e.target.removeEventListener("pointermove", muovi);
    e.target.removeEventListener("pointerup", fine);
    e.target.removeEventListener("pointercancel", fine);
    C.trascina = null;
    $("fogli").classList.remove("in-uso");
    const g = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
    Object.assign(C.dati.get(id) || {}, g);
    rendiElencoFogli();
    api("POST", "/api/fogli", { id, ...g }).catch(() => {});
  };
  e.target.addEventListener("pointermove", muovi);
  e.target.addEventListener("pointerup", fine);
  e.target.addEventListener("pointercancel", fine);
}
// una linea sottile da ogni foglio alla sfera dell'agente che l'ha prodotto
function disegnaLegamiFogli(cx) {
  for (const [id, c] of C.dati) {
    const el = C.el.get(id);
    if (!c.da || !el || el.hidden || el.classList.contains("piena")) continue;
    const n = [...M.nodi.values()].find((v) => v.s && v.s.nome === c.da);
    if (!n) continue;
    const p = schermo(n.x, n.y), r = raggioDi(n) * M.cam.z;
    const rx = el.offsetLeft, ry = el.offsetTop, rw = el.offsetWidth, rh = el.offsetHeight;
    const q = { x: Math.max(rx, Math.min(p.x, rx + rw)), y: Math.max(ry, Math.min(p.y, ry + rh)) }; // il punto del foglio più vicino alla sfera
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < r + 4) continue; // la sfera è sotto il foglio
    const a = { x: p.x + ((q.x - p.x) / d) * r, y: p.y + ((q.y - p.y) / d) * r };
    const colore = COL[n.s.stato] || COL.ferma;
    cx.beginPath(); cx.moveTo(a.x, a.y); cx.lineTo(q.x, q.y);
    cx.strokeStyle = `rgba(${colore},.55)`; cx.lineWidth = 1; cx.setLineDash([4, 4]); cx.stroke(); cx.setLineDash([]);
    cx.beginPath(); cx.arc(q.x, q.y, 3, 0, Math.PI * 2); cx.fillStyle = `rgba(${colore},.9)`; cx.fill();
  }
}

function initFogli() {
  su("cockpit_foglio", (ev) => upsertFoglio(ev.foglio, ev.nuova));
  su("cockpit_foglio_chiuso", (ev) => togliFoglio(ev.id));
  su("_aperto", () => caricaFogli().catch(() => {})); // i fogli aperti prima del ricarico
  // l'elenco «Fogli»: il pulsante lo apre e lo chiude; si chiude anche con Esc e con un clic fuori
  const elencoFogli = (acceso) => {
    $("elenco-fogli").hidden = !acceso;
    $("m-fogli").setAttribute("aria-expanded", String(acceso));
    if (acceso) rendiElencoFogli();
  };
  $("m-fogli").onclick = () => elencoFogli($("elenco-fogli").hidden);
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("elenco-fogli").hidden) { e.stopPropagation(); elencoFogli(false); }
  }, true);
  document.addEventListener("pointerdown", (e) => {
    if (!$("elenco-fogli").hidden && !e.target.closest("#elenco-fogli, #m-fogli")) elencoFogli(false);
  });
  $("ec-lista").addEventListener("click", (e) => {
    const riga = e.target.closest(".ec-riga"), a = e.target.closest("[data-a]")?.dataset.a;
    if (!riga || !a) return;
    const id = riga.dataset.id;
    if (a === "switch") accendiFoglio(id, e.target.checked);
    else if (a === "trova") trovaFoglio(id);
    else if (a === "elimina") { // due passi: il primo clic chiede conferma
      const b = e.target.closest("button");
      if (b.classList.contains("sicura")) { eliminaFoglio(id); return; }
      b.classList.add("sicura");
      b.textContent = "Sicuro?";
      setTimeout(() => { b.classList.remove("sicura"); b.textContent = "Elimina"; }, 3000);
    }
  });
  // Esc chiude il tutto schermo e basta: in cattura, così non chiude anche la chat aperta (che ascolta Esc su document)
  addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const p = document.querySelector(".foglio.piena");
    if (!p) return;
    e.stopPropagation();
    p.classList.remove("piena");
    p.style.zIndex = ++C.z;
  }, true);
  if ("ResizeObserver" in window) new ResizeObserver(() => C.el.forEach(contieniFoglio)).observe($("fogli"));
}
function trovaFoglio(id) {
  if (C.dati.get(id)?.attiva === false) accendiFoglio(id, true);
  const el = C.el.get(id);
  if (!el) return;
  if (!M.on) vistaMappa(true);
  el.style.zIndex = ++C.z;
  el.classList.remove("lampo");
  void el.offsetWidth;
  el.classList.add("lampo");
}
export { C, accendiFoglio, caricaFogli, disegnaLegamiFogli, initFogli, registraTipoFoglio, togliFoglio, trovaFoglio, upsertFoglio };
