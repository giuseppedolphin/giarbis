// Le menzioni della persona: un messaggio della bacheca della squadra (bacheca.mjs) o del ponte (ponte.mjs) che la tagga.
// Chi è la persona lo dice la config (la persona di questa plancia, chiSono); i suoi tag sono lo slug, il nome, gli `alias`
// della sua riga in `persone[]` della config e quelli di gruppo (@tutti, @team). Nel ponte conta anche un messaggio scritto
// da un'altra persona in persona (via "persona"), su ogni filo del ponte. I messaggi della persona stessa non contano mai.
//
// «Letto» è un istante per posto (bacheca, ponte): si segna quando la persona apre quella scheda del pannello «Bacheca». Il ponte
// ha una scheda per filo: «ponte:<slug>» segna letto solo il filo con quella persona, «ponte» tutti i fili.
// Stato (stato.mjs): menzioni.json = { letto: { bacheca: t, ponte: t, "ponte:<slug>": t } }.
// Un messaggio nuovo che tagga la persona esce sullo stream come cockpit_menzioni { azione: "nuova", dove, messaggio };
// la lettura come { azione: "letto", dove }. Il server passa a squadra e ponte un trasmetti che passa da osserva().
//
//   GRUPPO · aliasPersona(persona) → [tag] · citaPersona(testo, alias) → bool
//   creaMenzioni({ persona, ponte: () => ponte, trasmetti }) → { stato, segna, osserva, alias }
import { negozio } from "./stato.mjs";
import * as B from "./bacheca.mjs";

export const GRUPPO = ["tutti", "team"];
export const POSTI = ["bacheca", "ponte"];
const PONTE_N = 100;

const norma = (x) => String(x || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function aliasPersona(p = {}) {
  if (!p.slug) return [];
  const nome = norma(p.nome).split(/\s+/)[0];
  const extra = Array.isArray(p.alias) ? p.alias.map(norma) : [];
  return [...new Set([norma(p.slug), nome, ...extra, ...GRUPPO].filter((x) => /^[a-z0-9][a-z0-9-]*$/.test(x)))];
}

export function citaPersona(testo, alias = []) {
  if (!alias.length) return false;
  for (const m of String(testo || "").matchAll(/(^|[^\w@])@([a-z0-9][a-z0-9-]*)/gi)) {
    if (alias.includes(norma(m[2]).replace(/-+$/, ""))) return true;
  }
  return false;
}

export function creaMenzioni({ persona = {}, ponte = () => null, trasmetti = () => {} }) {
  const alias = aliasPersona(persona);
  const archivio = negozio("menzioni", { base: { letto: { bacheca: 0, ponte: 0 } } });
  const letto = () => ({ bacheca: 0, ponte: 0, ...(archivio.leggi().letto || {}) });
  const annuncia = (extra) => { try { trasmetti({ type: "cockpit_menzioni", ...extra }); } catch { /* lo stream non ferma niente */ } };

  const perMeBacheca = (m) => m.da !== persona.slug && citaPersona(m.testo, alias);
  // altri = gli slug delle persone dei fili del ponte; letto del filo = il più recente fra «ponte» e «ponte:<slug>»
  const perMePonte = (m, altri) => altri.includes(m.mittente) && (m.via === "persona" || citaPersona(m.testo, alias));
  const lettoFilo = (l, slug) => Math.max(l.ponte || 0, l[`ponte:${slug}`] || 0);
  const altriDi = (st) => (Array.isArray(st?.altri) ? st.altri : [st?.altro].filter(Boolean)).map((x) => x.slug);

  // le menzioni non lette, dei due posti; il ponte solo se c'è e risponde
  async function stato() {
    const l = letto();
    const bacheca = alias.length ? B.ultimi({ n: 500 }).filter((m) => m.t > l.bacheca && perMeBacheca(m)) : [];
    let sulPonte = [];
    const p = ponte();
    const st = p?.stato();
    if (alias.length && st?.disponibile && altriDi(st).length) {
      const j = await p.messaggi({ n: PONTE_N });
      sulPonte = (j.messaggi || []).filter((m) => Date.parse(m.creato) > lettoFilo(l, m.mittente) && perMePonte(m, altriDi(st)));
    }
    return { persona: persona.slug ? { slug: persona.slug, nome: persona.nome || persona.slug } : null, alias, letto: l, bacheca, ponte: sulPonte };
  }

  async function segna(dove) {
    const posti = dove === "tutto" ? POSTI : [dove];
    const filo = (x) => /^ponte:[a-z][a-z0-9-]*$/.test(x) && altriDi(ponte()?.stato()).includes(x.slice(6));
    if (!posti.every((x) => POSTI.includes(x) || filo(x))) throw new Error(`dove: ${POSTI.join(", ")}, ponte:<persona> o tutto`);
    const adesso = Date.now();
    const d = await archivio.aggiorna((x) => { x.letto = { bacheca: 0, ponte: 0, ...(x.letto || {}), ...Object.fromEntries(posti.map((p) => [p, adesso])) }; });
    for (const x of posti) annuncia({ azione: "letto", dove: x, t: adesso });
    return { letto: d.letto };
  }

  // gli eventi di squadra e ponte, prima dello stream: un messaggio che tagga la persona diventa cockpit_menzioni
  function osserva(ev) {
    if (!alias.length || !ev) return;
    if (ev.type === "cockpit_squadra" && ev.azione === "bacheca" && ev.messaggio && perMeBacheca(ev.messaggio)) {
      annuncia({ azione: "nuova", dove: "bacheca", messaggio: ev.messaggio });
    }
    if (ev.type === "cockpit_ponte" && ev.azione === "arrivati") {
      const p = ponte();
      const altri = (p?.altri || [p?.altro].filter(Boolean)).map((x) => x.slug);
      for (const m of ev.messaggi || []) if (perMePonte(m, altri)) annuncia({ azione: "nuova", dove: "ponte", messaggio: m });
    }
  }

  return { stato, segna, osserva, alias };
}
