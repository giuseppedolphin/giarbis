// La bacheca della squadra: un pannello apribile sopra la mappa (pulsante «Bacheca», chiuso di default) con due schede,
// la chat di gruppo e i messaggi diretti fra due agenti (l'elenco dei fili, poi il filo scelto). La persona scrive in
// bacheca dal compositore in fondo (con @ruolo sveglia quel ruolo; senza menzioni lo leggono i capi). Il pulsante porta il
// numero dei messaggi arrivati da quando l'hai guardata l'ultima volta (memo «squadra.letto»). Dati: /api/squadra/bacheca e
// /api/squadra/dm; aggiornamenti dallo stream (cockpit_squadra). Lo stato aperto/chiuso resta fra un caricamento e l'altro.
// Se c'è il ponte con le plance di altre persone, una scheda per persona, col suo nome, porta quel filo (ponte.js; scheda
// «ponte:<slug>»).
// Le menzioni della persona (condivisi/menzioni.js): il numero «@N» in corallo sul pulsante e sulla scheda, il messaggio in
// evidenza, un banner se arriva a pannello chiuso; aprire la scheda le segna lette. /cockpit#bacheca apre il pannello.
import { $, assistente, mostraBanner, nomeVisibile, persona } from "./comune.js";
import { altriPonte, caricaPonte, htmlPonte, initPonte, nomeDi, nuoviPonte, ponteDisponibile, ponteLetto, ponteScrivibile, scriviPonte } from "./ponte.js";
import { api } from "/condivisi/api.js";
import { su } from "/condivisi/eventi.js";
import { esc } from "/condivisi/formati.js";
import { attrColore, caricaColori, suColori } from "/condivisi/colori.js";
import { memo } from "/condivisi/memo.js";
import { M, avviaMenzioni, citaMe, nonLette, nuova, segnaLette, suMenzioni } from "/condivisi/menzioni.js";

const B = { scheda: "bacheca", filo: null, messaggi: [], fili: [], nomi: new Map(), nuovi: 0 };
// lo slug della persona se la scheda è un filo del ponte («ponte:<slug>»), altrimenti ""
const filoPonte = (scheda = B.scheda) => (String(scheda).startsWith("ponte:") ? scheda.slice(6) : "");
const ora = (t) => new Date(t).toLocaleString("it-IT", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const chi = (slug) => B.nomi.get(slug) || nomeVisibile(slug);
// il nome di un ruolo della squadra col suo colore e un pallino (condivisi/colori.js); gli altri come sempre
const nome = (slug) => `<b${attrColore(slug, "nome-ag ag-pt")}>${esc(chi(slug))}</b>`;
// il testo con le menzioni in evidenza (quelle della persona di più); a capo conservati
const corpo = (t) => esc(t).replace(/(^|[^\w@])@([a-z0-9-]+)/gi, (_, pre, tag) => `${pre}<b class="bc-men${citaMe(`@${tag}`) ? " bc-men-te" : ""}">@${tag}</b>`).replace(/\n/g, "<br>");
// un messaggio della bacheca che tagga la persona: in evidenza, «nuovo» se non l'aveva ancora visto
const classe = (m) => (m.a || m.da === persona.slug || !citaMe(m.testo) ? "" : ` bc-per-te${nuova("bacheca", m.id) ? " bc-nuova" : ""}`);
const messaggio = (m) => `<div class="bc-msg${classe(m)}"><div class="bc-da">${nome(m.da)}${m.a ? ` → ${nome(m.a)}` : ""}<span>${esc(ora(m.t))}</span></div><div class="bc-t">${corpo(m.testo)}</div></div>`;

function disegna() {
  const box = $("bacheca");
  if (!box || box.hidden) return;
  box.querySelectorAll("[data-scheda]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.scheda === B.scheda)));
  const lista = $("bc-lista");
  const con = filoPonte(), ponte = !!con;
  if (ponte) {
    lista.innerHTML = htmlPonte(con);
  } else if (B.scheda === "bacheca") {
    lista.innerHTML = B.messaggi.map(messaggio).join("") || '<p class="bc-vuoto">Ancora nessun messaggio. Quando la squadra è accesa, qui gli agenti si scrivono.</p>';
  } else if (B.filo) {
    lista.innerHTML = `<button type="button" class="bc-indietro" data-indietro>← Diretti</button><p class="bc-titolo">${nome(B.filo.a)} ↔ ${nome(B.filo.b)}</p>`
      + (B.messaggi.map(messaggio).join("") || '<p class="bc-vuoto">Nessun messaggio.</p>');
  } else {
    lista.innerHTML = B.fili.map((f) => `<button type="button" class="bc-filo" data-a="${esc(f.a)}" data-b="${esc(f.b)}"><b>${nome(f.a)} ↔ ${nome(f.b)}</b>`
      + `<span>${f.n} · ${esc(ora(f.ultimo.t))}</span><em>${esc(f.ultimo.testo.slice(0, 120))}</em></button>`).join("")
      || '<p class="bc-vuoto">Nessun messaggio diretto fra gli agenti.</p>';
  }
  $("bc-scrivi").hidden = ponte ? !ponteScrivibile(con) : B.scheda !== "bacheca";
  $("bc-opz").hidden = !ponte;
  $("bc-testo").placeholder = ponte ? `Messaggio per ${nomeDi(con)}: lo legge il suo assistente` : "Scrivi alla squadra; @ruolo sveglia quel ruolo";
  if (ponte) ponteLetto(con);
  if (B.scheda === "bacheca" || ponte) segnaLette(B.scheda);
  contatore();
  if (B.scheda === "bacheca" || B.filo || ponte) lista.scrollTop = lista.scrollHeight;
}

async function carica() {
  try {
    if (!B.nomi.size) {
      const { squadra } = await api("GET", "/api/squadra");
      for (const r of squadra.ruoli) B.nomi.set(r.slug, r.nome);
      if (persona.slug) B.nomi.set(persona.slug, persona.nome || persona.slug);
      B.nomi.set(assistente.slug, assistente.nome);
    }
    if (filoPonte()) await caricaPonte(filoPonte());
    else if (B.scheda === "bacheca") B.messaggi = (await api("GET", "/api/squadra/bacheca?n=80")).messaggi;
    else if (B.filo) B.messaggi = (await api("GET", `/api/squadra/dm/${encodeURIComponent(B.filo.a)}/${encodeURIComponent(B.filo.b)}?n=80`)).messaggi;
    else B.fili = (await api("GET", "/api/squadra/dm")).fili;
  } catch (e) { mostraBanner(/non trovato/.test(e.message) ? "La bacheca della squadra arriva col Riavvia della plancia" : e.message, 5000); }
  disegna();
}

const pillola = (k, dove) => (k ? `<span class="bc-badge" title="${k === 1 ? "Un messaggio ti tagga" : `${k} messaggi ti taggano`}${dove}">@${k}</span>` : "");
function contatore() {
  const b = $("m-bacheca");
  const n = B.nuovi + nuoviPonte();
  if (b) b.innerHTML = `Bacheca${n ? ` · ${n}` : ""}${pillola(nonLette(), "")}`;
  $("bacheca")?.querySelectorAll(".bc-schede [data-scheda]").forEach((s) => {
    const dove = s.dataset.scheda;
    if (dove !== "bacheca" && !filoPonte(dove)) return;
    s.querySelector(".bc-badge")?.remove();
    if (nonLette(dove)) s.insertAdjacentHTML("beforeend", pillola(nonLette(dove), filoPonte(dove) ? " sul ponte" : " in bacheca"));
  });
}
// i numeri per la bacheca sulla mappa (bacheca-mappa.js): messaggi nuovi e quanti taggano la persona
export const conteggi = () => ({ nuovi: B.nuovi + nuoviPonte(), tag: nonLette() });
function letta() { memo.set("squadra.letto", String(Date.now())); B.nuovi = 0; contatore(); }

export function apriBacheca(scheda = B.scheda) {
  const box = $("bacheca");
  if (!box) return;
  box.hidden = false; memo.set("squadra.bacheca", "1");
  $("m-bacheca").setAttribute("aria-expanded", "true");
  if (scheda !== B.scheda) { B.scheda = scheda; B.filo = null; }
  letta(); disegna(); carica();
}
function chiudiBacheca() {
  $("bacheca").hidden = true; memo.set("squadra.bacheca", "0");
  $("m-bacheca").setAttribute("aria-expanded", "false");
}

export function initBacheca() {
  const box = $("bacheca"), bottone = $("m-bacheca");
  if (!box || !bottone) return;
  bottone.onclick = () => (box.hidden ? apriBacheca() : chiudiBacheca());
  $("bc-chiudi").onclick = chiudiBacheca;
  box.addEventListener("click", (e) => {
    const s = e.target.closest("[data-scheda]");
    if (s) { B.scheda = s.dataset.scheda; B.filo = null; disegna(); carica(); return; }
    if (e.target.closest("[data-indietro]")) { B.filo = null; disegna(); carica(); return; }
    const f = e.target.closest(".bc-filo");
    if (f) { B.filo = { a: f.dataset.a, b: f.dataset.b }; B.messaggi = []; disegna(); carica(); }
  });
  $("bc-scrivi").addEventListener("submit", async (e) => {
    e.preventDefault();
    const t = $("bc-testo");
    if (!t.value.trim()) return;
    try {
      if (filoPonte()) {
        await scriviPonte(filoPonte(), t.value, { domanda: $("bc-domanda").checked, urgente: $("bc-urgente").checked });
        $("bc-domanda").checked = $("bc-urgente").checked = false;
      } else await api("POST", "/api/squadra/bacheca", { testo: t.value });
      t.value = "";
    } catch (x) { mostraBanner(x.message, 5000); }
  });
  $("bc-testo").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("bc-scrivi").requestSubmit(); } });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !box.hidden && box.contains(document.activeElement)) { e.stopPropagation(); chiudiBacheca(); } });
  su("cockpit_squadra", (ev) => {
    if (!ev.messaggio) return;
    if (box.hidden) { B.nuovi++; contatore(); return; }
    const m = ev.messaggio;
    if (ev.azione === "bacheca" && B.scheda === "bacheca") { B.messaggi.push(m); disegna(); }
    else if (ev.azione === "dm" && B.scheda === "diretti") carica();
    letta();
  });
  // i messaggi arrivati mentre la pagina era chiusa, per il numero sul pulsante
  const dopo = Number(memo.get("squadra.letto", "0")) || 0;
  api("GET", "/api/squadra/bacheca?n=200").then(({ messaggi }) => { if (box.hidden) { B.nuovi = messaggi.filter((m) => m.t > dopo).length; contatore(); } }).catch(() => {});
  // le schede del ponte, una per persona col suo nome: solo se il server ha un ponte
  const inVista = () => (box.hidden ? "" : filoPonte());
  initPonte({ aggiorna: () => (inVista() ? disegna() : contatore()), inVista }).then((c) => {
    if (!c) return;
    for (const p of altriPonte()) {
      const s = document.createElement("button");
      s.type = "button"; s.setAttribute("role", "tab"); s.dataset.scheda = `ponte:${p.slug}`; s.textContent = p.nome;
      s.title = `Il ponte con la plancia di ${p.nome}: i messaggi fra i due assistenti`;
      box.querySelector(".bc-schede").append(s);
    }
    disegna();
  });
  // le menzioni della persona: numeri, evidenza, banner a pannello chiuso o su un'altra scheda; lette se la scheda è in vista
  suMenzioni((ev) => {
    const scheda = (e) => (e.dove === "ponte" ? `ponte:${e.messaggio?.mittente}` : e.dove);
    if (ev?.azione === "nuova") {
      if (!box.hidden && B.scheda === scheda(ev)) { segnaLette(B.scheda); disegna(); return; }
      const m = ev.messaggio;
      const da = ev.dove === "ponte" ? nomeDi(m.mittente) : chi(m.da);
      mostraBanner(`${da} ti tagga ${ev.dove === "ponte" ? "sul ponte" : "in bacheca"}: «${String(m.testo || "").replace(/\s+/g, " ").slice(0, 110)}»`, 8000, ev.dove === "ponte" ? "" : m.da);
    }
    if (!ev && !box.hidden) disegna(); // menzioni appena caricate: l'evidenza sui messaggi già in vista
    contatore();
  });
  avviaMenzioni();
  caricaColori(); suColori(disegna); // i colori dei ruoli: arrivano dopo il primo disegno
  // /cockpit#bacheca (la pillola «@ N» della barra): apre il pannello sulla scheda con menzioni
  const daIndirizzo = () => {
    if (location.hash !== "#bacheca") return;
    history.replaceState(null, "", location.pathname + location.search);
    const filo = ponteDisponibile() && !nonLette("bacheca") && altriPonte().find((p) => nonLette(`ponte:${p.slug}`));
    apriBacheca(filo ? `ponte:${filo.slug}` : "bacheca");
  };
  addEventListener("hashchange", daIndirizzo);
  if (location.hash === "#bacheca") avviaMenzioni().then(daIndirizzo);
  else if (memo.get("squadra.bacheca", "0") === "1") apriBacheca();
}
