// Le pagine statiche e /api/chi. Le pagine del cockpit, della barra e della bolla stanno in plancia/pagine/; quelle di un
// modulo (e le sue dashboard) le serve il modulo stesso con le sue rotte.
//   GET /cockpit · /cockpit/<file>.js|css · /condivisi/<file>.js|css · /moduli/<nome>/<file>.js|css (solo moduli accesi)
//   GET /nav.js · /widget.js (moduli ES per <script type="module">)
//   GET /api/chi → chi usa la plancia, il nome dell'assistente, la modalità (setup|normale) e i moduli accesi
//   POST /api/setup/fatto → controlla plancia.config.json e manda cockpit_setup (primo avvio)
// `rotteFinali` va registrata dopo quelle dei moduli: senza moduli, / porta al cockpit; un modulo che serve / vince.
import { readFileSync } from "node:fs";
import { trasmetti } from "../eventi.mjs";
import path from "node:path";
import { PLANCIA } from "../config.mjs";
import { dirStato, percorsoStato } from "../stato.mjs";

const PAGINE = path.join(PLANCIA, "pagine");
const TIPI = { js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8", html: "text/html; charset=utf-8" };

// Un file di pagina letto dal disco a ogni richiesta (niente cache: modificarlo non richiede il Riavvia).
export function inviaPagina(c, file, intestazioni = {}) {
  let corpo;
  try { corpo = readFileSync(file); } catch { return c.json(404, { ok: false, errore: "file non trovato" }); }
  const tipo = TIPI[path.extname(file).slice(1)] || "application/octet-stream";
  c.invia(200, tipo, corpo, { "cache-control": "no-store", ...intestazioni });
}

export function rotte(n) {
  const moduloAcceso = (nome) => n.moduli.find((m) => m.nome === nome);
  return [
    { metodo: "GET", percorso: "/cockpit", gestore: (c) => inviaPagina(c, path.join(PAGINE, "cockpit/index.html")) },
    { metodo: "GET", percorso: /^\/cockpit\/([\w-]+\.(?:js|css))$/, gestore: (c) => inviaPagina(c, path.join(PAGINE, "cockpit", c.parametri[0])) },
    { metodo: "GET", percorso: /^\/condivisi\/([\w-]+\.(?:js|css))$/, gestore: (c) => inviaPagina(c, path.join(PAGINE, "condivisi", c.parametri[0])) },
    {
      metodo: "GET", percorso: /^\/moduli\/([\w-]+)\/([\w-]+\.(?:js|css))$/,
      gestore(c) {
        const m = moduloAcceso(c.parametri[0]);
        if (!m) return c.json(404, { ok: false, errore: "modulo non acceso" });
        return inviaPagina(c, path.join(m.cartella, c.parametri[1]));
      },
    },
    { metodo: "GET", percorso: "/nav.js", gestore: (c) => inviaPagina(c, path.join(PAGINE, "nav.js"), { "access-control-allow-origin": "*" }) },
    { metodo: "GET", percorso: "/widget.js", gestore: (c) => inviaPagina(c, path.join(PAGINE, "widget.js")) },
    {
      // Il setup ha scritto plancia.config.json: se c'è ed è JSON valido, la pagina mostra «Avvia» (= Riavvia).
      metodo: "POST", percorso: "/api/setup/fatto",
      gestore(c) {
        const file = path.join(n.cfg.cartella, "plancia.config.json");
        let testo;
        try { testo = readFileSync(file, "utf8"); } catch { return c.json(400, { ok: false, errore: `manca plancia.config.json in ${n.cfg.cartella}` }); }
        try { JSON.parse(testo); } catch (e) { return c.json(400, { ok: false, errore: `plancia.config.json non è JSON valido: ${e.message}` }); }
        trasmetti({ type: "cockpit_setup", pronto: true });
        return {};
      },
    },
    {
      metodo: "GET", percorso: "/api/chi",
      gestore() {
        const { email, ...persona } = n.persona;
        const a = n.cfg.assistente;
        return {
          ...persona,
          modalita: n.cockpit.modalita || "normale",
          assistente: { nome: a.nome, slug: a.slug, chiamata: a.chiamata, varianti: a.varianti, alias: a.alias },
          cartelle: { stato: dirStato(), lavagna: percorsoStato("lavagna"), allegati: percorsoStato("allegati") },
          moduli: n.moduli.map((m) => ({ nome: m.nome, pagina: m.pagina ? `/moduli/${m.nome}/${path.basename(m.pagina)}` : null })),
        };
      },
    },
  ];
}

export function rotteFinali() {
  return [{
    metodo: "GET", percorso: "/",
    gestore: (c) => c.invia(302, "text/plain; charset=utf-8", "", { location: "/cockpit", "cache-control": "no-store" }),
  }];
}
