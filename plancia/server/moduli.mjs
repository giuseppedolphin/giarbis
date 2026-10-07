// I moduli: pezzi opzionali che si accendono in plancia.config.json (sezione "moduli") e vivono in plancia/moduli/<nome>/.
// Il nucleo non sa niente di loro: caricaModuli() li legge e raccoglie ciò che offrono. Un modulo è il default export
// di modulo.mjs:
//   { nome, tipiEvento?: [], tipiFoglio?: { tipo: { testo(foglio, ctx), descrizione(foglio, ctx), valida?(c, base, ctx) } },
//     rotte?(ctx) → [rotte], segnaliBattito?(ctx) → [segnale], prompt?: { assistente?, agente?, foglio?: "file.md" },
//     pagina?: "pagina.js", avvio?(ctx) }
// I percorsi di prompt e pagina sono relativi alla cartella del modulo. Un modulo si cerca prima in plancia/moduli, poi
// nella cartella indicata da PLANCIA_MODULI_EXTRA (percorso assoluto): i moduli di un pacchetto non si mescolano col nucleo.
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PLANCIA } from "./config.mjs";
import { registraTipi } from "./eventi.mjs";

export const CARTELLA_MODULI = path.join(PLANCIA, "moduli");

// `cartellaModuli` serve alle prove; di solito è plancia/moduli
export async function caricaModuli(cfg, cartellaModuli = CARTELLA_MODULI) {
  const out = [];
  for (const nome of Object.keys(cfg.moduli || {})) {
    if (!/^[\w\-]+$/.test(nome)) throw new Error(`nome di modulo non valido: ${nome}`);
    const extra = process.env.PLANCIA_MODULI_EXTRA;
    const cartella = [cartellaModuli, extra && path.isAbsolute(extra) ? extra : ""].filter(Boolean)
      .map((base) => path.join(base, nome)).find((c) => existsSync(path.join(c, "modulo.mjs"))) || path.join(cartellaModuli, nome);
    const file = path.join(cartella, "modulo.mjs");
    if (!existsSync(file)) {
      console.error(`modulo "${nome}" acceso in config ma non trovato (${file}): saltato`);
      continue;
    }
    const mod = (await import(pathToFileURL(file).href)).default;
    if (!mod || typeof mod !== "object") throw new Error(`modulo "${nome}": modulo.mjs deve esportare un oggetto di default`);
    const m = { ...mod, nome: mod.nome || nome, cartella, opzioni: cfg.moduli[nome] || {} };
    if (m.pagina && !existsSync(path.join(cartella, m.pagina))) throw new Error(`modulo "${nome}": pagina "${m.pagina}" non esiste`);
    registraTipi(m.tipiEvento);
    out.push(m);
  }
  return out;
}
