// I percorsi citati nelle pagine (chat, fogli): quali sono file veri della cartella di lavoro, per farne link che li aprono
// nell'editor (pagine/cockpit/percorsi.js).
//   POST /api/percorsi { percorsi: ["a/b.md", "c.csv:12", …] } → { cartella, esistono: [quelli che sono file] }
// Solo percorsi relativi dentro la cartella di lavoro: niente assoluti, niente "..", niente "~"; al massimo 200 per chiamata.
import { statSync } from "node:fs";
import path from "node:path";

const MASSIMO = 200;

function eFile(cartella, voce) {
  const p = String(voce || "").trim().replace(/^\.\//, "").replace(/(:\d+){1,2}$/, "");
  if (!p || p.length > 300 || path.isAbsolute(p) || p.startsWith("~") || p.split("/").includes("..")) return false;
  const pieno = path.resolve(cartella, p);
  if (!pieno.startsWith(cartella + path.sep)) return false;
  try { return statSync(pieno).isFile(); } catch { return false; }
}

export function rotte(n) {
  return [{
    metodo: "POST", percorso: "/api/percorsi",
    async gestore(c) {
      const b = await c.corpo();
      const lista = Array.isArray(b.percorsi) ? b.percorsi.slice(0, MASSIMO).map(String) : [];
      return { cartella: n.cfg.cartella, esistono: lista.filter((p) => eFile(n.cfg.cartella, p)) };
    },
  }];
}
