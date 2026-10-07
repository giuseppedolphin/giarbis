// I fogli sopra la mappa: lo stato sta in fogli.json (fuori da git) così sopravvive al ricarico e lo vedono tutte le schede.
// Un foglio ha un tipo; i tipi del nucleo sono html, immagine, tabella e proposte, gli altri li offre un modulo
// (modulo.tipiFoglio). Un tipo è { testo(foglio, ctx), descrizione(foglio, ctx), valida?(c, base, ctx), misure?: {w, h},
// titolo?: "…", contesto?(foglio, ctx) → righe in più per l'agente di foglio }. `valida` controlla i campi propri del tipo:
// lancia un errore se non vanno, e restituisce i campi da scrivere sul foglio (oppure li scrive su ctx.foglio, il foglio in
// costruzione).
//
//   const fogli = creaFogli({ cfg, persona, cockpit, moduli })
//   fogli.elenco() · fogli.trova(id) · fogli.crea(c, { registrare = true }) → il foglio (nuovo o aggiornato)
//   fogli.chiudi(id) · fogli.agente(id) → la sessione dell'agente del foglio (la crea al primo clic)
//   fogli.assicuraProposte() → il foglio «proposte» del battito: uno solo, lo crea o lo riaccende
//   fogli.contestoFoglio(id) → il testo che l'agente di foglio riceve a ogni avvio del processo
//   fogli.testo(id, max) → il solo testo del foglio, troncato · fogli.osservaLavagna() → ricarica i fogli quando il file cambia
//   fogli.registraCartella(prefisso, dir) · fogli.tipi (il registro)
//
// Lo stato passa solo da stato.mjs. Le letture e le scritture qui sono sincrone: nessun intreccio fra due richieste.
import { watch } from "node:fs";
import { randomUUID } from "node:crypto";
import { slug, comandoCtl } from "./config.mjs";
import { negozio, percorsoStato, salvaFile } from "./stato.mjs";
import { trasmetti } from "./eventi.mjs";
import { registra, impostaTipi } from "./artifax.mjs";
import {
  TIPI_NUCLEO, cartellaDi, descrizioneDi, fileDiFoglio, percorsoAmmesso, prefissiCartelle, registraCartella, testoFoglio,
} from "./fogli-testo.mjs";

const MISURE_BASE = { w: 520, h: 380 };
const LIMITE_CONTESTO = 6000;

const numero = (v, min, max) => (Number.isFinite(Number(v)) && v !== "" && v !== null ? Math.min(max, Math.max(min, Math.round(Number(v)))) : undefined);

function validaPercorso(c, base) {
  if (c.percorso === undefined && base) return {};
  const p = String(c.percorso || "");
  if (!percorsoAmmesso(p)) throw new Error(`percorso non valido: ${prefissiCartelle().map((x) => `${x}<file>`).join(" o ")}`);
  return { percorso: p };
}

function validaTabella(c, base) {
  if (c.colonne === undefined && c.righe === undefined && base) return {};
  if (!Array.isArray(c.colonne) || !Array.isArray(c.righe)) throw new Error("tabella: servono colonne[] e righe[][]");
  if (c.righe.length > 2000 || c.colonne.length > 40) throw new Error("tabella troppo grande (2000 righe, 40 colonne)");
  return {
    colonne: c.colonne.map((x) => String(x ?? "").slice(0, 80)),
    righe: c.righe.map((r) => (Array.isArray(r) ? r : []).map((x) => (x === null || x === undefined ? "" : typeof x === "object" ? JSON.stringify(x) : String(x).slice(0, 2000)))),
  };
}

// Le funzioni di un tipo di modulo ricevono il ctx dei tipi con in più le opzioni del loro modulo (ctx.opzioni).
function conOpzioni(tipo, opzioni) {
  const out = { ...tipo };
  for (const [k, f] of Object.entries(tipo)) {
    if (typeof f !== "function") continue;
    out[k] = (...args) => f(...args.slice(0, -1), { ...args.at(-1), opzioni });
  }
  return out;
}

function registroTipi(moduli) {
  const tipi = {
    html: { ...TIPI_NUCLEO.html, valida: validaPercorso },
    immagine: { ...TIPI_NUCLEO.immagine, valida: validaPercorso },
    tabella: { ...TIPI_NUCLEO.tabella, valida: validaTabella },
    proposte: { ...TIPI_NUCLEO.proposte },
  };
  for (const m of moduli) {
    for (const [nome, tipo] of Object.entries(m.tipiFoglio || {})) {
      if (tipi[nome]) throw new Error(`il modulo "${m.nome}" ridefinisce il tipo di foglio "${nome}"`);
      tipi[nome] = conOpzioni(tipo, m.opzioni || {});
    }
  }
  return tipi;
}

export function creaFogli({ cfg, persona = {}, cockpit, moduli = [] }) {
  const tipi = registroTipi(moduli);
  const memoria = negozio("fogli", { base: [] });
  const ctxTipi = { cfg, persona, tipi };
  const leggi = () => { const c = memoria.leggi(); return Array.isArray(c) ? c : []; };
  const salva = (c) => memoria.scrivi(c);
  // i tipi senza file, oltre alla tabella, che Artifax può registrare (non «proposte»: è un foglio del battito)
  impostaTipi(Object.keys(tipi).filter((t) => !["html", "immagine", "tabella", "proposte"].includes(t)));
  for (const m of moduli) for (const [prefisso, dir] of Object.entries(m.cartelle || {})) registraCartella(prefisso, dir);

  const elenco = () => leggi();
  const trova = (id) => leggi().find((x) => x.id === id) || null;

  function crea(c, { registrare = true } = {}) {
    const fogli = leggi();
    const k = c.id ? fogli.findIndex((x) => x.id === c.id) : -1;
    if (c.id && k < 0) throw new Error(`nessun foglio "${c.id}"`);
    const base = k >= 0 ? fogli[k] : null;
    const tipo = base ? base.tipo : c.tipo;
    const def = tipi[tipo];
    if (!def) throw new Error(`tipo di foglio sconosciuto: ${tipo} (${Object.keys(tipi).join(", ")})`);
    let cambiato = !base; // il contenuto è cambiato: le schede rifanno il foglio; spostarlo o ridimensionarlo non basta
    const misure = { ...MISURE_BASE, ...def.misure };
    const n = base ? { ...base } : {
      id: randomUUID().slice(0, 8), tipo, attiva: true, creata: new Date().toISOString(), da: String(c.da || "").slice(0, 60),
      x: 24 + (fogli.length % 6) * 28, y: 24 + (fogli.length % 6) * 28, w: misure.w, h: misure.h,
    };
    if (c.titolo !== undefined || !base) { n.titolo = String(c.titolo || def.titolo || "Foglio").slice(0, 120); cambiato = true; }
    if (c.ricarica) cambiato = true; // il file del foglio è cambiato (osservatore o ctl foglio aggiorna): le schede lo rileggono
    // la descrizione di una riga: la scrive chi crea il foglio; se manca si ricava (primo titolo dell'html, titolo)
    if (c.descrizione !== undefined) { n.descrizione = String(c.descrizione).replace(/\s+/g, " ").trim().slice(0, 160); cambiato = true; }
    for (const [campo, min, max] of [["x", -4000, 8000], ["y", -4000, 8000], ["w", 240, 4000], ["h", 140, 4000]]) {
      const v = numero(c[campo], min, max);
      if (v !== undefined) n[campo] = v;
    }
    if (def.valida) {
      const campi = def.valida(c, base, { ...ctxTipi, foglio: n }) || {};
      for (const [campo, valore] of Object.entries(campi)) {
        if (JSON.stringify(n[campo]) !== JSON.stringify(valore)) cambiato = true;
        n[campo] = valore;
      }
    }
    if (!n.descrizione) { try { n.descrizione = descrizioneDi(n, ctxTipi); } catch { n.descrizione = n.titolo; } }
    if (c.attiva !== undefined) n.attiva = c.attiva !== false && c.attiva !== "false"; // spento = nascosto ma non perso
    if (cambiato) n.agg = Date.now();
    if (k >= 0) fogli[k] = n; else fogli.push(n);
    salva(fogli);
    trasmetti({ id: n.id, type: "cockpit_foglio", foglio: n, nuova: k < 0 });
    if (registrare && k < 0) { // Artifax non deve mai bloccare il foglio
      try {
        registra({
          tipo: n.tipo === "html" || n.tipo === "immagine" ? undefined : n.tipo, percorso: n.percorso, titolo: n.titolo, da: n.da,
          origine: "foglio", descrizione: n.descrizione, tabella: n.tabella, colonne: n.colonne, righe: n.righe,
        });
      } catch (e) { console.error("artifax:", e.message); }
    }
    return n;
  }

  function chiudi(id) {
    const fogli = leggi();
    if (!fogli.some((x) => x.id === id)) throw new Error(`nessun foglio "${id}"`);
    salva(fogli.filter((x) => x.id !== id));
    trasmetti({ id, type: "cockpit_foglio_chiuso" });
  }

  // L'agente di un foglio: uno per foglio, nasce al primo clic sul pallino; il modello di default è quello dei fogli della config.
  function agente(id) {
    const f = trova(id);
    if (!f) throw new Error(`nessun foglio "${id}"`);
    const esistente = cockpit.elenco().find((s) => s.foglio === id);
    if (esistente) return esistente;
    const base = `foglio-${slug(f.titolo || f.tipo).slice(0, 22) || f.id}`;
    let nome = base;
    for (let i = 2; cockpit.trova(nome); i++) nome = `${base}-${i}`;
    const s = cockpit.crea({ nome, ruolo: "foglio", modello: cfg.modelli.foglio, foglio: id });
    return cockpit.elenco().find((x) => x.id === s.id);
  }

  function testo(id, max = Infinity) {
    const f = trova(id);
    if (!f) throw new Error(`nessun foglio "${id}"`);
    let t = "";
    try { t = testoFoglio(f, ctxTipi); } catch (e) { t = `(non riesco a leggerlo: ${e.message})`; }
    return { foglio: f, testo: t.length > max ? t.slice(0, max) : t, lunghezza: t.length, troncato: t.length > max };
  }

  // Il contesto che l'agente di foglio riceve a ogni avvio del suo processo: il foglio com'è in quel momento.
  function contestoFoglio(id) {
    const f = trova(id);
    if (!f) return "";
    const file = fileDiFoglio(f.percorso);
    let t = ""; try { t = testoFoglio(f, ctxTipi); } catch (e) { t = `(non riesco a leggerlo: ${e.message})`; }
    if (t.length > LIMITE_CONTESTO) t = `${t.slice(0, LIMITE_CONTESTO)}\n… [troncato: per il resto, ${comandoCtl()} foglio leggi ${f.id} --max ${t.length}]`;
    let extra = []; try { extra = tipi[f.tipo]?.contesto?.(f, ctxTipi) || []; } catch { /* il tipo non ha altro da dire */ }
    return [
      `id: ${f.id} · tipo: ${f.tipo} · titolo: ${f.titolo || ""}`,
      f.descrizione ? `descrizione: ${f.descrizione}` : "",
      file ? `file: ${file}` : "",
      f.tabella ? `tabella: ${f.tabella}` : "",
      ...[].concat(extra),
      `contenuto all'avvio (solo testo):\n${t}`,
    ].filter(Boolean).join("\n");
  }

  // Il foglio «proposte» del battito è uno solo; se manca lo si crea, se è spento si riaccende.
  function assicuraProposte() {
    const f = leggi().find((x) => x.tipo === "proposte");
    if (f) return f.attiva === false ? crea({ id: f.id, attiva: true }, { registrare: false }) : f;
    return crea({
      tipo: "proposte", titolo: `${cfg.assistente.nome} propone`, da: cfg.assistente.slug,
      descrizione: `La proposta del battito di ${cfg.assistente.nome}, con Sì / No / Più tardi, e i contatori`, w: 380, h: 340,
    }, { registrare: false });
  }

  // Il file di un foglio html o immagine cambiato su disco (lo ha modificato il suo agente, o chiunque): il foglio si ricarica da solo.
  function osservaLavagna() {
    const ritardi = new Map();
    try {
      salvaFile("lavagna", ".presente", ""); // la cartella la crea stato.mjs: qui non si scrive niente sullo stato
      const dir = cartellaDi("/lavagna/") || percorsoStato("lavagna");
      const w = watch(dir, (_, nome) => {
        if (!nome) return;
        clearTimeout(ritardi.get(nome));
        ritardi.set(nome, setTimeout(() => {
          ritardi.delete(nome);
          for (const f of leggi().filter((x) => x.percorso === `/lavagna/${nome}`)) {
            try { crea({ id: f.id, ricarica: true }, { registrare: false }); } catch { /* foglio sparito nel frattempo */ }
          }
        }, 400));
      });
      w.unref?.();
      return w;
    } catch (e) { console.error("fogli: niente ricarica automatica:", e.message); return null; }
  }

  return { tipi, elenco, trova, crea, chiudi, agente, testo, contestoFoglio, assicuraProposte, osservaLavagna, registraCartella };
}
