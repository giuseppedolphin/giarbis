// La lavagna (i file che l'assistente e gli agenti creano e mostrano) e gli allegati dei messaggi.
//   GET /lavagna/<file> · POST /api/lavagna · POST /api/lavagna/carica?nome= · POST /api/allegati?nome=
// I file della lavagna si servono solo dalla cartella della lavagna (e dalle altre che un modulo registra), e la pagina li
// apre in un iframe senza la stessa origine (sandbox), quindi non possono chiamare le API. Gli allegati arrivano grezzi nel
// corpo, il nome nel parametro: si salvano in <stato>/allegati/<giorno>/, fuori da git (stato.mjs li ripulisce dopo
// conservazione.allegatiGiorni giorni).
import { readFileSync } from "node:fs";
import path from "node:path";
import { salvaFile } from "../stato.mjs";
import { registra } from "../artifax.mjs";
import { fileDiFoglio, percorsoAmmesso, prefissiCartelle } from "../fogli-testo.mjs";

const TIPI = {
  html: "text/html; charset=utf-8", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml", gif: "image/gif",
  webp: "image/webp", mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4",
  json: "application/json", csv: "text/csv; charset=utf-8", js: "text/javascript", css: "text/css",
};
const ESTENSIONI = new RegExp(`\\.(?:${Object.keys(TIPI).join("|")})$`, "i");
const MAX_ALLEGATO = 30e6;

// Un file servito da una cartella nota: lo usano anche i moduli che servono i propri file (pannelli).
export function inviaFile(c, percorso) {
  const file = fileDiFoglio(percorso);
  if (!file || !ESTENSIONI.test(file)) return c.json(404, { ok: false, errore: "file non trovato" });
  let corpo;
  try { corpo = readFileSync(file); } catch { return c.json(404, { ok: false, errore: "file non trovato" }); }
  c.invia(200, TIPI[path.extname(file).slice(1).toLowerCase()] || "application/octet-stream", corpo, { "cache-control": "no-store" });
}

export function rotte({ cfg, cockpit }) {
  return [
    { metodo: "GET", percorso: /^\/lavagna\/([\w.\-]+)$/, gestore: (c) => inviaFile(c, `/lavagna/${c.parametri[0]}`) },
    {
      metodo: "POST", percorso: "/api/lavagna",
      async gestore(c) {
        const b = await c.corpo();
        const p = String(b.percorso || "");
        if (!percorsoAmmesso(p)) return c.json(400, { ok: false, errore: `percorso non valido: ${prefissiCartelle().map((x) => `${x}<file>`).join(" o ")}` });
        cockpit.mostra(p, b.titolo, b.da);
        try { registra({ percorso: p, titolo: b.titolo, descrizione: b.descrizione, da: b.da, origine: p.startsWith("/pannelli/") ? "pannello" : "lavagna" }); }
        catch (e) { console.error("artifax:", e.message); }
        return {};
      },
    },
    {
      // il file di un foglio o di un mostra: arriva grezzo (ctl non scrive mai lo stato), il nome nel parametro
      metodo: "POST", percorso: "/api/lavagna/carica",
      async gestore(c) {
        const nome = path.basename(String(c.url.searchParams.get("nome") || "")).replace(/[^\w.\-]+/g, "-").replace(/^\.+/, "").slice(0, 120);
        if (!nome || !ESTENSIONI.test(nome)) return c.json(400, { ok: false, errore: `nome non valido (estensioni ammesse: ${Object.keys(TIPI).join(", ")})` });
        salvaFile("lavagna", nome, await c.grezzo(MAX_ALLEGATO));
        return { percorso: `/lavagna/${nome}` };
      },
    },
    {
      metodo: "POST", percorso: "/api/allegati",
      async gestore(c) {
        // il percorso torna relativo alla cartella di lavoro se ci sta dentro (lo stato di default), altrimenti assoluto
        const nome = path.basename(String(c.url.searchParams.get("nome") || "file")).replace(/[^\w.\-]+/g, "_").replace(/^\.+/, "_").slice(0, 120) || "file";
        const corpo = await c.grezzo(MAX_ALLEGATO);
        const file = salvaFile(`allegati/${new Date().toISOString().slice(0, 10)}`, `${Date.now().toString(36)}-${nome}`, corpo);
        const rel = path.relative(cfg.cartella, file);
        return { percorso: rel.startsWith("..") || path.isAbsolute(rel) ? file : rel, nome, byte: corpo.length };
      },
    },
  ];
}
