// Lo stato della plancia (sessioni, fogli, timer, Artifax, impostazioni, lavagna, allegati) vive in UNA cartella, fuori
// da git, e questo è l'unico file che la tocca: gli altri chiedono qui.
//
//   dirStato() / percorsoStato(...)  → COCKPIT_STATO (assoluto o relativo alla cartella di lavoro, per le prove),
//                                      altrimenti <cartella di lavoro>/.plancia
//   negozio(nome, {base, versione})  → un file JSON: leggi(), scrivi(dati), aggiorna(fn); scrittura atomica (tmp + rename),
//                                      file rotto messo da parte come .rotto-<ts>; un oggetto porta il campo `versione`
//   registro(nome)                   → un file <nome>.jsonl: aggiungi(obj), leggi({ultime}), azzera(); ruota oltre registriMB
//   salvaFile(sottocartella, nome, contenuto) → file binari o di testo, scrittura atomica
//   pulisci()                        → residui .tmp-* e allegati oltre la conservazione, all'avvio
import {
  appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import path from "node:path";
import { config } from "./config.mjs";

export function dirStato() {
  const cfg = config();
  if (process.env.COCKPIT_STATO) return path.resolve(cfg.cartella, process.env.COCKPIT_STATO);
  return path.join(cfg.cartella, ".plancia");
}
export const percorsoStato = (...parti) => path.join(dirStato(), ...parti);

const èOggetto = (x) => x !== null && typeof x === "object" && !Array.isArray(x);

function scriviAtomico(file, contenuto) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`;
  writeFileSync(tmp, contenuto);
  renameSync(tmp, file);
}

function leggiConRotto(file, base) {
  if (!existsSync(file)) return base;
  try { return JSON.parse(readFileSync(file, "utf8")); } catch (e) {
    const messo = `${file}.rotto-${Date.now()}`;
    try { renameSync(file, messo); } catch { /* sola lettura: si riparte comunque dal valore di base */ }
    console.error(`${path.basename(file)} non è JSON valido (${e.message}): messo da parte in ${path.basename(messo)}, si riparte da vuoto`);
    return base;
  }
}

export function negozio(nome, { base = {}, versione = 1 } = {}) {
  const file = percorsoStato(`${nome}.json`);
  const nuovo = () => structuredClone(base);
  const conVersione = (d) => (èOggetto(d) && d.versione === undefined ? { ...d, versione } : d);
  let coda = Promise.resolve();
  const n = {
    file,
    leggi() { return conVersione(leggiConRotto(file, nuovo())); },
    scrivi(dati) { scriviAtomico(file, JSON.stringify(conVersione(dati), null, 1) + "\n"); return dati; },
    // lettura-modifica-scrittura una dopo l'altra nel processo: fn(dati) restituisce i dati nuovi, o niente se li ha modificati sul posto
    aggiorna(fn) {
      const giro = coda.then(async () => {
        const dati = n.leggi();
        const nuovi = await fn(dati);
        return n.scrivi(nuovi === undefined ? dati : nuovi);
      });
      coda = giro.catch(() => {});
      return giro;
    },
  };
  return n;
}

export function registro(nome) {
  const file = percorsoStato(`${nome}.jsonl`);
  const ruotato = percorsoStato(`${nome}.1.jsonl`);
  return {
    file,
    aggiungi(obj) {
      mkdirSync(path.dirname(file), { recursive: true });
      const massimo = config().conservazione.registriMB * 1024 * 1024;
      try { if (statSync(file).size > massimo) renameSync(file, ruotato); } catch { /* il file non c'è ancora */ }
      appendFileSync(file, JSON.stringify(obj) + "\n");
    },
    leggi({ ultime } = {}) {
      let righe; try { righe = readFileSync(file, "utf8").split("\n"); } catch { return []; }
      const out = [];
      for (const r of righe) { if (!r) continue; try { out.push(JSON.parse(r)); } catch { /* riga a metà: si salta */ } }
      return ultime ? out.slice(-ultime) : out;
    },
    azzera() { rmSync(ruotato, { force: true }); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, ""); },
  };
}

// Sottocartella e nome non possono uscire dallo stato: niente separatori, niente ".."
export function salvaFile(sottocartella, nome, contenuto) {
  const bene = (s) => /^[\w.\-]+$/.test(s) && s !== "." && s !== "..";
  const sotto = String(sottocartella || "");
  if (sotto && !sotto.split("/").every(bene)) throw new Error(`sottocartella non valida: ${sottocartella}`);
  if (!bene(String(nome))) throw new Error(`nome di file non valido: ${nome}`);
  const file = percorsoStato(sotto, nome);
  scriviAtomico(file, contenuto);
  return file;
}

// All'avvio: i residui .tmp-* lasciati da un processo morto a metà scrittura (non quelli recenti, forse in corso) e gli
// allegati più vecchi di allegatiGiorni.
export function pulisci() {
  const esito = { tmp: 0, allegati: 0 };
  const ora = Date.now();
  const giri = (dir, fn) => {
    let voci; try { voci = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const v of voci) {
      const p = path.join(dir, v.name);
      if (v.isDirectory()) giri(p, fn); else fn(p, v.name);
    }
  };
  giri(dirStato(), (p, nome) => {
    if (!/\.tmp-/.test(nome)) return;
    try { if (ora - statSync(p).mtimeMs > 60000) { rmSync(p, { force: true }); esito.tmp++; } } catch { /* sparito nel frattempo */ }
  });
  const limite = ora - config().conservazione.allegatiGiorni * 86400000;
  giri(percorsoStato("allegati"), (p) => {
    try { if (statSync(p).mtimeMs < limite) { rmSync(p, { force: true }); esito.allegati++; } } catch { /* sparito nel frattempo */ }
  });
  return esito;
}
