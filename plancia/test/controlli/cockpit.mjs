// Il cockpit (pagina del browser), verificato con un server di prova, senza browser:
//  1. GET /cockpit risponde 200 HTML;
//  2. ogni file che index.html e main.js importano (scorrendo gli import di ogni modulo, anche quelli delle pagine dei moduli
//     accesi) risponde 200 col tipo giusto: .js text/javascript, .css text/css;
//  3. /moduli/rd-repo/pagina.js risponde 200 col modulo acceso (404 se il modulo non c'è);
//  4. /api/chi dà l'assistente (nome, slug, chiamata, varianti, alias) e i moduli accesi con la loro pagina;
//  5. la pagina non porta il nome dell'assistente scritto: i nomi vengono da /api/chi (segnaposto {nome}, {chiamata});
//  6. il primo avvio: la striscia «Configurazione in corso» e il pulsante «Avvia» ci sono, /api/setup/fatto risponde;
//  7. il registro dei tipi di foglio e il resto del contratto con i moduli (registraTipoFoglio, registraEsempi).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const TIPI = { js: /^text\/javascript/, css: /^text\/css/, html: /^text\/html/ };
const GUARDIA = { "x-dashboard": "1" };

// Gli import di un file JS: statici (`from "x"`), a effetto (`import "x"`) e dinamici con percorso scritto.
function importDi(codice) {
  const senza = codice.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
  const out = new Set();
  for (const m of senza.matchAll(/\b(?:import|export)\s+(?:[\p{L}\p{N}_$*\s,{}]|\bas\b)+?\s+from\s+["']([^"']+)["']/gu)) out.add(m[1]);
  for (const m of senza.matchAll(/\bimport\s+["']([^"']+)["']/g)) out.add(m[1]);
  for (const m of senza.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) out.add(m[1]);
  return [...out];
}

// I file locali che una pagina HTML carica (script e fogli di stile).
function risorseHtml(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) out.push(m[1]);
  for (const m of html.matchAll(/<link[^>]*\shref="([^"]+)"/g)) out.push(m[1]);
  return out.filter((p) => p.startsWith("/"));
}

export default async function (t) {
  const s = await t.avviaServer();

  // 1. la pagina
  const pagina = await t.get(s.base, "/cockpit");
  t.ok(pagina.codice === 200 && TIPI.html.test(pagina.header["content-type"] || ""), `GET /cockpit: ${pagina.codice} ${pagina.header["content-type"]}`);

  // 4. chi usa la pagina
  const chi = await t.get(s.base, "/api/chi", GUARDIA);
  t.ok(chi.codice === 200, `GET /api/chi: ${chi.codice}`);
  const c = chi.json();
  const a = c.assistente || {};
  t.ok(a.nome && a.slug && Array.isArray(a.chiamata) && a.chiamata.length, `/api/chi: assistente senza nome, slug o chiamata (${JSON.stringify(a)})`);
  t.ok(Array.isArray(a.varianti?.prefissi) && Array.isArray(a.varianti?.nomi) && Array.isArray(a.alias), "/api/chi: varianti o alias dell'assistente mancanti");
  t.ok(Array.isArray(c.moduli), "/api/chi: manca l'elenco dei moduli");
  t.ok(["normale", "setup"].includes(c.modalita), `/api/chi: modalita «${c.modalita}»`);
  const paginaRdRepo = (c.moduli || []).find((m) => m.nome === "rd-repo")?.pagina;
  // Se il modulo dichiara la pagina, è quella; se non la dichiara il cockpit non la carica (moduli/rd-repo/modulo.mjs vuole
  // `pagina: "pagina.js"`, come rd-dashboard): lo si segnala, non è un file del cockpit.
  if (paginaRdRepo) t.ok(paginaRdRepo === "/moduli/rd-repo/pagina.js", `/api/chi: la pagina di rd-repo è «${paginaRdRepo}»`);
  else t.nota("ATTENZIONE: /api/chi non elenca la pagina di rd-repo, il foglio to-do non si carica: manca pagina: \"pagina.js\" in moduli/rd-repo/modulo.mjs");

  // 2. tutto ciò che la pagina importa risponde col tipo giusto
  const visti = new Set(), coda = [];
  const aggiungi = (percorso) => { if (!visti.has(percorso)) { visti.add(percorso); coda.push(percorso); } };
  for (const p of risorseHtml(pagina.testo)) aggiungi(p);
  for (const m of c.moduli || []) if (m.pagina) aggiungi(m.pagina);
  aggiungi("/moduli/rd-repo/pagina.js"); // anche se /api/chi non la elenca (vedi sotto), i suoi import devono rispondere
  t.ok(visti.has("/cockpit/main.js"), "index.html non carica /cockpit/main.js");
  t.ok(visti.has("/nav.js"), "index.html non carica /nav.js");
  t.ok(visti.has("/condivisi/palette.css") && visti.has("/condivisi/palette-cockpit.css"), "index.html non carica la palette comune");
  const risolvi = (da, spec) => (spec.startsWith("/") ? spec : spec.startsWith(".") ? new URL(spec, `http://x${da}`).pathname : null);
  const corpi = new Map();
  while (coda.length) {
    const p = coda.shift();
    const r = await t.get(s.base, p);
    const ext = path.extname(p).slice(1);
    t.ok(r.codice === 200, `GET ${p}: ${r.codice}`);
    t.ok(TIPI[ext]?.test(r.header["content-type"] || ""), `GET ${p}: tipo «${r.header["content-type"]}»`);
    if (r.codice !== 200 || ext !== "js") continue;
    corpi.set(p, r.testo);
    for (const spec of importDi(r.testo)) { const dest = risolvi(p, spec); if (dest) aggiungi(dest); }
  }
  t.nota(`${visti.size} file raggiunti dalla pagina del cockpit`);

  // 3. la pagina del modulo acceso e un modulo non acceso
  const modulo = await t.get(s.base, "/moduli/rd-repo/pagina.js");
  t.ok(modulo.codice === 200 && TIPI.js.test(modulo.header["content-type"] || ""), `GET /moduli/rd-repo/pagina.js: ${modulo.codice}`);
  t.ok(/export default (async )?function/.test(modulo.testo), "/moduli/rd-repo/pagina.js: manca la funzione di default");
  const spento = await t.get(s.base, "/moduli/non-acceso/pagina.js");
  t.ok(spento.codice === 404, `GET /moduli/non-acceso/pagina.js: ${spento.codice}`);

  // il vecchio chiamata.js del cockpit non c'è più: sta in condivisi/
  t.ok(!existsSync(path.join(t.plancia, "pagine/cockpit/chiamata.js")), "pagine/cockpit/chiamata.js esiste ancora");
  t.ok((await t.get(s.base, "/cockpit/chiamata.js")).codice === 404, "/cockpit/chiamata.js risponde ancora");
  t.ok((await t.get(s.base, "/condivisi/chiamata.js")).codice === 200, "/condivisi/chiamata.js non risponde");

  // 5. nessun nome scritto nella pagina: segnaposto sostituiti da main.js con ciò che dice /api/chi
  const html = pagina.testo;
  t.ok(!html.toLowerCase().includes(String(a.nome).toLowerCase()) || a.nome.length < 4, `index.html porta il nome «${a.nome}» scritto`);
  t.ok(/data-t="\{nome\}"/.test(html) && /\{chiamata\}/.test(html), "index.html: mancano i segnaposto {nome} e {chiamata}");
  const main = corpi.get("/cockpit/main.js") || "";
  t.ok(/replaceAll\("\{nome\}", assistente\.nome\)/.test(main) && /fraseChiamata\(assistente\)/.test(main), "main.js non sostituisce {nome} e {chiamata}");
  t.ok(!/4173/.test(main + (corpi.get("/cockpit/chat.js") || "")), "main.js o chat.js nominano la porta");
  t.ok(!/cockpit_carta|apiFogli|api\/carte/.test([...corpi.values()].join("\n")), "restano i ripieghi verso il server di prima (carte)");
  t.ok(!/window\.\w+\s*=/.test([...corpi].filter(([p]) => p.startsWith("/cockpit/")).map(([, x]) => x).join("\n").replace(/window\.apriLavagna\s*=/g, "")),
    "il cockpit mette su window altro che apriLavagna");

  // 6. primo avvio
  t.ok(/id="setup"/.test(html) && /Configurazione in corso/.test(html) && /id="setup-avvia"/.test(html), "index.html: manca la striscia del primo avvio");
  const setup = corpi.get("/cockpit/setup.js") || "";
  t.ok(/cockpit_setup/.test(setup) && /pronto/.test(setup) && /riavvia/.test(setup) && /l'assistente/.test(setup), "setup.js: non gestisce cockpit_setup con pronto e «Avvia»");
  const fatto = await t.post(s.base, "/api/setup/fatto", {}, GUARDIA);
  t.ok(fatto.codice === 200, `POST /api/setup/fatto con la configurazione scritta: ${fatto.codice}`);

  // 7. il contratto con i moduli: il cockpit offre registraTipoFoglio e registraEsempi, la pagina di rd-repo li usa
  const fogli = corpi.get("/cockpit/fogli.js") || "";
  t.ok(/export \{[^}]*\bregistraTipoFoglio\b/.test(fogli), "fogli.js non esporta registraTipoFoglio");
  t.ok(/\bregistraTipoFoglio\("todo"/.test(modulo.testo) && /\bregistraEsempi\b/.test(modulo.testo), "rd-repo/pagina.js non registra il foglio to-do e gli esempi");
  t.ok(/registraTipoFoglio, registraEsempi/.test(main), "main.js non offre registraTipoFoglio e registraEsempi alle pagine dei moduli");
  t.ok(!/to-do|todo|TikTok/i.test(fogli + (corpi.get("/cockpit/chat.js") || "")), "fogli.js o chat.js parlano ancora di to-do");

  // i file della cartella cockpit non superano le 500 righe
  for (const [p, x] of corpi) {
    if (p.startsWith("/cockpit/")) t.ok(x.split("\n").length <= 500, `${p}: ${x.split("\n").length} righe, il tetto è 500`);
  }
  const css = readFileSync(path.join(t.plancia, "pagine/cockpit/stile.css"), "utf8");
  t.ok(css.split("\n").length <= 500, `stile.css: ${css.split("\n").length} righe, il tetto è 500`);
  t.ok(!/--abyss-rgb\s*:\s*\d/.test(css), "stile.css ridefinisce i colori: vengono da condivisi/palette.css");
}
