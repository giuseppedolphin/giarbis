// Togliere agenti dalla mappa senza passare dalla chat: il pulsante «Pulisci» (tutti gli agenti fermi, come `ctl.mjs rimuovi --fermi`),
// il cestino sulla sfera al passaggio del mouse e «Rimuovi» nella scheda del nodo (la via su touch, dove il passaggio non c'è).
// Conferma leggera dentro la pagina, mai confirm() del browser. Mai l'assistente; chi lavora non si toglie: il cestino è spento col motivo.
import { $, S, mostraBanner, nomeSessione } from "./comune.js";
import { M, raggioDi, schermo } from "./mappa.js";
import { api } from "/condivisi/api.js";
import { su } from "/condivisi/eventi.js";
import { esc } from "/condivisi/formati.js";

const lavora = (s) => s.stato === "lavora" || s.stato === "avvio";
// gli stessi di `rimuovi --fermi`: agenti (non di foglio) fermi, in attesa o in errore
const fermi = () => [...S.sessioni.values()].filter((s) => s.ruolo === "agente" && !lavora(s));

let sopraCestino = false, nascosto = true, kCestino = null;

// La conferma: una riga con il testo e due pulsanti, accanto a ciò che l'ha aperta (pulsante o sfera).
function chiedi(testo, etichetta, dove, azione) {
  const el = $("m-conferma");
  el.innerHTML = `<span>${esc(testo)}</span><button class="btn pericolo" id="mc-si">${esc(etichetta)}</button><button class="btn leggero" id="mc-no">Annulla</button>`;
  el.hidden = false;
  Object.assign(el.style, dove);
  $("mc-no").onclick = chiudiConferma;
  $("mc-si").onclick = async () => { chiudiConferma(); try { await azione(); } catch (e) { mostraBanner(e.message, 5000); } };
  $("mc-si").focus();
}
function chiudiConferma() { $("m-conferma").hidden = true; }

const togli = (s) => api("POST", `/api/sessioni/${encodeURIComponent(s.id)}/rimuovi`);
function chiediRimozione(s, dove) {
  if (!s || s.ruolo === "orchestratore" || s.ruolo === "squadra" || lavora(s)) return; // la squadra si spegne, non si toglie
  chiedi(`Togliere ${nomeSessione(s)} dalla mappa? La conversazione resta salvata da Claude Code.`, "Rimuovi", dove, () => togli(s));
}

function pulisci() {
  const lista = fermi();
  if (!lista.length) return mostraBanner("Nessun agente fermo da togliere", 3000);
  const nomi = lista.slice(0, 4).map(nomeSessione).join(", ") + (lista.length > 4 ? "…" : "");
  chiedi(`Togliere ${lista.length === 1 ? "1 agente fermo" : `${lista.length} agenti fermi`} (${nomi})?`, "Togli",
    { left: "", top: "", right: "14px", bottom: "52px" }, async () => { for (const s of lista) await togli(s); });
}

function aggiornaPulisci() {
  const n = fermi().length, b = $("m-pulisci");
  b.disabled = !n;
  b.title = n ? `Toglie dalla mappa ${n === 1 ? "l'agente fermo" : `i ${n} agenti fermi`} (in pausa, in attesa o in errore)` : "Nessun agente fermo da togliere";
}

// Il cestino segue la sfera sotto il mouse (in basso a destra: in alto ci sono il «?» e il contesto).
function posizionaCestino() {
  const b = $("m-cestino");
  if (!sopraCestino) kCestino = M.sopra && M.sopra.startsWith("a:") ? M.sopra : null;
  const n = !nascosto && kCestino && M.nodi.get(kCestino), s = n?.s;
  if (!s || s.ruolo === "orchestratore" || s.ruolo === "squadra" || !M.on || M.trascina) { b.hidden = true; return requestAnimationFrame(posizionaCestino); }
  const p = schermo(n.x, n.y), d = raggioDi(n) * M.cam.z * 0.78;
  b.hidden = false;
  b.style.transform = `translate(${Math.round(p.x + d)}px, ${Math.round(p.y + d)}px) translate(-50%, -50%)`;
  b.disabled = lavora(s);
  b.title = lavora(s) ? `${nomeSessione(s)} sta lavorando: prima fermalo (scheda o chat → Ferma), poi lo togli` : `Togli ${nomeSessione(s)} dalla mappa`;
  b.dataset.id = s.id;
  requestAnimationFrame(posizionaCestino);
}

function initPulizia() {
  $("m-pulisci").onclick = pulisci;
  const b = $("m-cestino");
  b.onclick = () => {
    const s = S.sessioni.get(b.dataset.id); if (!s) return;
    const r = b.getBoundingClientRect(), m = M.cv.getBoundingClientRect();
    const x = r.right - m.left + 8 + 380 > m.width ? r.left - m.left - 2 * raggioDi({ ruolo: s.ruolo }) * M.cam.z - 380 : r.right - m.left + 8; // a sinistra se a destra non c'è posto
    chiediRimozione(s, { left: Math.max(8, x) + "px", top: Math.max(8, r.top - m.top - 8) + "px", right: "", bottom: "" });
  };
  b.addEventListener("pointerenter", () => { sopraCestino = true; nascosto = false; });
  b.addEventListener("pointerleave", (e) => { sopraCestino = false; if (e.relatedTarget !== M.cv) nascosto = true; });
  M.cv.addEventListener("pointermove", () => { nascosto = false; });
  M.cv.addEventListener("pointerleave", (e) => { if (e.relatedTarget !== b) nascosto = true; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("m-conferma").hidden) chiudiConferma(); });
  su("cockpit_sessione", () => setTimeout(aggiornaPulisci, 0));
  su("cockpit_rimossa", () => setTimeout(aggiornaPulisci, 0));
  setTimeout(aggiornaPulisci, 500);
  requestAnimationFrame(posizionaCestino);
}

export { chiediRimozione, initPulizia };
