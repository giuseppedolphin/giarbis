// Le menzioni della persona lato pagina (server/menzioni.mjs): i messaggi della bacheca e del ponte che la taggano (@slug, @nome,
// gli alias della config, @tutti, @team). Uno stato per pagina (M), caricato da GET /api/menzioni e tenuto vivo dallo stream
// (cockpit_menzioni). Lo usano la barra comune (montaMenzioni: la pillola «@ N», solo con menzioni non lette, porta a
// /cockpit#bacheca) e il pannello «Bacheca» del cockpit (bacheca.js, ponte.js: numero sul pulsante e sulle schede, messaggi in
// evidenza, segnaLette quando la persona apre la scheda). Il ponte ha una scheda per filo: «ponte:<slug>» conta e segna solo i
// messaggi di quella persona, «ponte» tutti. Server vecchio senza la rotta: niente menzioni fino al Riavvia.
import { api } from "./api.js";
import { connetti, su } from "./eventi.js";
import { iniettaStile } from "./stile.js";

export const POSTI = ["bacheca", "ponte"];
// bacheca/ponte = le non lette; viste = le lette in questa pagina, che restano in evidenza finché la pagina è aperta
export const M = { pronto: false, persona: null, alias: [], bacheca: [], ponte: [], viste: { bacheca: new Set(), ponte: new Set() } };
const ascoltatori = new Set();
const avvisa = (ev) => ascoltatori.forEach((f) => { try { f(ev); } catch (e) { console.error("menzioni:", e); } });
// fn(ev): ev = l'evento cockpit_menzioni che ha cambiato lo stato, o niente (caricamento)
export const suMenzioni = (fn) => { ascoltatori.add(fn); return () => ascoltatori.delete(fn); };

const norma = (x) => String(x || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
// vero se il testo tagga la persona (la stessa regola del server)
export function citaMe(testo) {
  if (!M.alias.length) return false;
  for (const m of String(testo || "").matchAll(/(^|[^\w@])@([a-z0-9][a-z0-9-]*)/gi)) if (M.alias.includes(norma(m[2]).replace(/-+$/, ""))) return true;
  return false;
}
const filo = (dove) => (String(dove || "").startsWith("ponte:") ? dove.slice(6) : "");
const diFilo = (dove) => M.ponte.filter((m) => m.mittente === filo(dove));
export const nonLette = (dove) => (filo(dove) ? diFilo(dove).length : dove ? M[dove].length : M.bacheca.length + M.ponte.length);
// un messaggio da mettere in evidenza come nuovo: non letto, o letto da questa pagina
export const nuova = (dove, id) => M.viste[dove].has(String(id)) || M[dove].some((m) => String(m.id) === String(id));

function lette(dove) {
  if (filo(dove)) {
    for (const m of diFilo(dove)) M.viste.ponte.add(String(m.id));
    M.ponte = M.ponte.filter((m) => m.mittente !== filo(dove));
    return;
  }
  for (const m of M[dove]) M.viste[dove].add(String(m.id));
  M[dove] = [];
}

export async function segnaLette(dove) {
  if (!M.pronto || !nonLette(dove)) return;
  lette(dove);
  avvisa();
  try { await api("POST", "/api/menzioni/letto", { dove }); } catch { /* al prossimo caricamento tornano non lette */ }
}

let avvio = null;
export function avviaMenzioni() {
  if (avvio) return avvio;
  avvio = (async () => {
    try {
      const j = await api("GET", "/api/menzioni");
      Object.assign(M, { pronto: true, persona: j.persona, alias: j.alias || [], bacheca: j.bacheca || [], ponte: j.ponte || [] });
    } catch { return false; }
    su("cockpit_menzioni", (ev) => {
      if (!POSTI.includes(ev.dove) && !filo(ev.dove)) return;
      if (ev.azione === "nuova" && ev.messaggio && !nuova(ev.dove, ev.messaggio.id)) M[ev.dove].push(ev.messaggio);
      else if (ev.azione === "letto") lette(ev.dove); // letta da un'altra scheda del browser
      else return;
      avvisa(ev);
    });
    // dopo una caduta dello stream si ricarica: le menzioni arrivate intanto
    su("_aperto", () => api("GET", "/api/menzioni").then((j) => { M.bacheca = j.bacheca || []; M.ponte = j.ponte || []; avvisa(); }).catch(() => {}));
    connetti();
    avvisa();
    return true;
  })();
  return avvio;
}

// ---- la pillola della barra comune -----------------------------------------------------------------
const CSS = `
.rdnav a.menzioni{display:flex;align-items:center;gap:6px;color:#fff;background:var(--pl-coral);text-decoration:none;font-weight:650;
  padding:6px 11px;border-radius:999px;margin-right:6px;white-space:nowrap}
.rdnav a.menzioni[hidden]{display:none}
.rdnav a.menzioni:hover{filter:brightness(1.08)}`;

export function montaMenzioni(prima) {
  iniettaStile("pl-menzioni", CSS);
  const a = document.createElement("a");
  a.className = "menzioni"; a.href = "/cockpit#bacheca"; a.hidden = true;
  prima.before(a);
  const disegna = () => {
    const n = nonLette();
    a.hidden = !n;
    a.textContent = `@ ${n}`;
    a.title = `${n === 1 ? "Un messaggio ti tagga" : `${n} messaggi ti taggano`}${M.ponte.length ? " (anche dal ponte)" : ""}: apri la bacheca`;
  };
  suMenzioni(disegna);
  avviaMenzioni();
  return a;
}
