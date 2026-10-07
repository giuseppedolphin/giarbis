// Le pagine (browser): analisi statica, senza avviare niente.
//  1. ogni file .js sotto pagine/ e ogni moduli/*/pagina.js: sintassi da modulo ES (node --check su una copia .mjs);
//  2. ogni import (statico, a effetto o import() con percorso scritto) risolve a un file esistente, e ogni nome importato è
//     esportato da quel file; percorsi serviti: /condivisi, /cockpit, /moduli/<nome>, /nav.js, /widget.js;
//  3. nessun nome dell'assistente nel codice delle pagine del nucleo (fuori dai commenti): viene sempre da chi().assistente;
//  4. ogni variabile --pl-* usata dalle pagine condivise è definita nella palette (tema scuro, che è la base);
//  5. prove vere di chiamata.js, formati.js e memo.js in un processo di Node.
import { spawnSync } from "node:child_process";
import {
  existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Il cockpit è dell'ondata 3: finché non è adattato il nome dell'assistente scritto lì si segnala, non fa fallire. Da togliere all'ondata 3.
const COCKPIT_ESENTE_DAL_NOME = false;

const IDENT = String.raw`[\p{L}\p{N}_$]+`;

function senzaCommenti(testo) {
  return testo.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

function cerca(dir, filtro, out = []) {
  if (!existsSync(dir)) return out;
  for (const v of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, v.name);
    if (v.isDirectory()) cerca(p, filtro, out);
    else if (filtro(p)) out.push(p);
  }
  return out;
}

// Gli import di un file: [{ spec, nomi: [..] | null (a effetto o import()), predefinito, spazio }]
function importDi(codice) {
  const out = [];
  const stat = new RegExp(String.raw`\b(import|export)\s+((?:[\p{L}\p{N}_$*\s,{}]|\bas\b)+?)\s+from\s+["']([^"']+)["']`, "gu");
  for (const m of codice.matchAll(stat)) {
    const clausola = m[2];
    const imp = { spec: m[3], tipo: m[1], nomi: [], predefinito: false, spazio: false };
    const graffe = clausola.match(/\{([^}]*)\}/);
    if (graffe) {
      for (const parte of graffe[1].split(",")) {
        const nome = parte.trim().split(/\s+as\s+/)[0].trim();
        if (nome) imp.nomi.push(nome);
      }
    }
    const fuori = clausola.replace(/\{[^}]*\}/, "").replace(/,/g, " ").trim();
    if (/^\*\s+as\s+/.test(fuori)) imp.spazio = true;
    else if (fuori && m[1] === "import") imp.predefinito = true;
    out.push(imp);
  }
  for (const m of codice.matchAll(/\bimport\s+["']([^"']+)["']/g)) out.push({ spec: m[1], tipo: "import", nomi: [], predefinito: false, spazio: false });
  for (const m of codice.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) out.push({ spec: m[1], tipo: "dinamico", nomi: [], predefinito: false, spazio: false });
  return out;
}

// I nomi esportati da un file: { nomi:Set, predefinito, stella }
function esportatiDa(codice) {
  const nomi = new Set();
  let predefinito = false, stella = false;
  for (const m of codice.matchAll(new RegExp(String.raw`\bexport\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+(${IDENT})`, "gu"))) nomi.add(m[1]);
  for (const m of codice.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const parte of m[1].split(",")) {
      const p = parte.trim().split(/\s+as\s+/);
      const nome = (p[1] || p[0]).trim();
      if (nome) nomi.add(nome);
    }
  }
  if (/\bexport\s+default\b/.test(codice)) predefinito = true;
  if (/\bexport\s*\*\s*from\b/.test(codice)) stella = true;
  return { nomi, predefinito, stella };
}

export default async function (t) {
  const pagine = path.join(t.plancia, "pagine");
  const moduli = path.join(t.plancia, "moduli");
  const files = [
    ...cerca(pagine, (p) => p.endsWith(".js")),
    ...cerca(moduli, (p) => /moduli[\\/][^\\/]+[\\/]pagina\.js$/.test(p)),
  ];
  const rel = (f) => path.relative(t.plancia, f);
  t.ok(files.length > 0, "nessun file .js sotto pagine/");

  const risolvi = (da, spec) => {
    if (spec.startsWith(".")) return path.resolve(path.dirname(da), spec);
    if (spec === "/nav.js" || spec === "/widget.js") return path.join(pagine, spec.slice(1));
    let m = spec.match(/^\/(condivisi|cockpit)\/(.+)$/);
    if (m) return path.join(pagine, m[1], m[2]);
    m = spec.match(/^\/moduli\/([^/]+)\/(.+)$/);
    if (m) return path.join(moduli, m[1], m[2]);
    return null; // altro (percorsi serviti a runtime, indirizzi esterni): non si controlla
  };

  const cache = new Map();
  const leggi = (f) => { if (!cache.has(f)) cache.set(f, senzaCommenti(readFileSync(f, "utf8"))); return cache.get(f); };

  // 1. sintassi
  const tmp = t.tmp();
  mkdirSync(tmp, { recursive: true });
  for (const f of files) {
    const copia = path.join(tmp, `${rel(f).replace(/[\\/]/g, "__")}.mjs`);
    writeFileSync(copia, readFileSync(f, "utf8"));
    const r = spawnSync(process.execPath, ["--check", copia], { encoding: "utf8" });
    t.ok(r.status === 0, `sintassi ${rel(f)}: ${String(r.stderr).split("\n").slice(0, 4).join(" | ")}`);
  }

  // 2. import ed export
  let controllati = 0;
  for (const f of files) {
    for (const imp of importDi(leggi(f))) {
      const dest = risolvi(f, imp.spec);
      if (!dest) continue;
      controllati++;
      if (!existsSync(dest)) { t.ok(false, `${rel(f)}: import di ${imp.spec}, il file non esiste`); continue; }
      if (!imp.nomi.length && !imp.predefinito) continue;
      const es = esportatiDa(leggi(dest));
      for (const n of imp.nomi) t.ok(es.stella || es.nomi.has(n), `${rel(f)}: importa «${n}» da ${imp.spec}, che non lo esporta`);
      if (imp.predefinito) t.ok(es.predefinito, `${rel(f)}: importa il predefinito da ${imp.spec}, che non ne ha`);
    }
  }
  t.nota(`${files.length} file di pagina, ${controllati} import controllati`);

  // 3. il nome dell'assistente non sta nel codice del nucleo
  const nucleo = files.filter((f) => !rel(f).startsWith("moduli"));
  for (const f of nucleo) {
    const dentroCockpit = rel(f).startsWith(path.join("pagine", "cockpit"));
    const righe = leggi(f).split("\n");
    const trovate = righe.map((r, i) => (/jarvis/i.test(r) ? i + 1 : 0)).filter(Boolean);
    if (!trovate.length) continue;
    if (dentroCockpit && COCKPIT_ESENTE_DAL_NOME) t.nota(`da adattare all'ondata 3: ${rel(f)} nomina l'assistente nel codice (${trovate.length} righe)`);
    else t.ok(false, `${rel(f)}: nomina l'assistente nel codice, righe ${trovate.slice(0, 6).join(", ")}`);
  }

  // 4. variabili della palette
  const palette = readFileSync(path.join(pagine, "condivisi", "palette.css"), "utf8");
  const base = palette.slice(0, palette.indexOf(":root[data-tema=chiaro]"));
  const chiaro = palette.slice(palette.indexOf(":root[data-tema=chiaro]"));
  const definite = new Set([...base.matchAll(/(--pl-[\w-]+)\s*:/g)].map((m) => m[1]));
  for (const n of [...chiaro.matchAll(/(--pl-[\w-]+)\s*:/g)].map((m) => m[1])) t.ok(definite.has(n), `palette: ${n} è nel tema chiaro ma non nel base`);
  const usanti = [...files.filter((f) => rel(f).startsWith(path.join("pagine", "condivisi")) || /pagine[\\/](nav|widget)\.js$/.test(f)),
    path.join(pagine, "condivisi", "palette-cockpit.css")];
  for (const f of usanti) {
    for (const m of readFileSync(f, "utf8").matchAll(/var\((--pl-[\w-]+)/g)) t.ok(definite.has(m[1]), `${rel(f)}: usa ${m[1]}, che la palette non definisce`);
  }
  // le variabili con tema: il chiaro deve ridefinire tutte le terne di colore (altrimenti il tema chiaro resta scuro in quel punto)
  for (const n of [...definite].filter((x) => /-rgb$/.test(x) && !/^--pl-(ombra|tinta)/.test(x) || /^--pl-(ombra|tinta)-rgb$/.test(x))) {
    t.ok(chiaro.includes(`${n}:`), `palette: ${n} non è ridefinita nel tema chiaro`);
  }

  // 6. la barra carica le pagine dei moduli da /api/chi e le chiama con { registraVoceBarra }; le pagine dei moduli lo accettano
  const nav = readFileSync(path.join(pagine, "nav.js"), "utf8");
  t.ok(/\.moduli\b|\bmoduli\b/.test(nav) && /caricaPagineModuli\(c\.moduli\)/.test(nav), "nav.js: legge i moduli da chi() (/api/chi)");
  t.ok(/import\(BASE \+ m\.pagina\)/.test(nav) && /mod\.default\?\.\(\{ registraVoceBarra \}\)/.test(nav), "nav.js: importa la pagina del modulo e ne chiama il default con { registraVoceBarra }");
  for (const f of cerca(path.join(t.plancia, "moduli"), (p) => p.endsWith("/pagina.js"))) {
    t.ok(/export default (async )?function\s*\w*\s*\(\s*\{[^}]*registraVoceBarra/.test(readFileSync(f, "utf8")), `${path.relative(t.cartella, f)}: il default accetta { registraVoceBarra }`);
  }

  // 5. prove vere in un processo di Node (nessun DOM: i tre file non ne hanno bisogno)
  const url = (f) => pathToFileURL(path.join(pagine, "condivisi", f)).href;
  const prova = `
    globalThis.localStorage = (() => { const m = new Map([["plancia-tema","chiaro"],["cockpit.voce","0"],["jw.pos","{\\"x\\":1}"],["altro","x"]]);
      return { get length() { return m.size; }, key: (i) => [...m.keys()][i], getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; })();
    const { riconosciChiamata, costruisciChiamata, fraseChiamata } = await import(${JSON.stringify(url("chiamata.js"))});
    const { tok, livello, unaRiga, data } = await import(${JSON.stringify(url("formati.js"))});
    const { memo } = await import(${JSON.stringify(url("memo.js"))});
    const A = { nome: "Alfa", slug: "alfa", chiamata: ["hey alfa"], varianti: { prefissi: ["hey", "ehi", "e"], nomi: ["alfa", "alfo"] }, alias: ["beta"] };
    const r = (x) => riconosciChiamata(x, A);
    console.log(JSON.stringify({
      a: r("Hey Alfa, apri la lavagna"), b: r("ehi, alfo dimmi"), c: r("hey beta"), d: r("alfa"), e: r("hey alfabeto"), f: r("ciao a tutti"),
      g: r("Hey al fa vai").trovata, h: fraseChiamata(A), vuota: costruisciChiamata({}).test("hey alfa"),
      tok: [tok(950), tok(12400), tok(2400000)], liv: [livello(10), livello(70), livello(95)], riga: unaRiga("## Titolo\\n\\n| a | b |\\n\\nUna **frase** con [link](http://x)"),
      memo: [memo.get("tema", ""), memo.get("voce", ""), memo.json("widget.pos", null), memo.get("altro", "d"), localStorage.getItem("plancia-tema"), localStorage.getItem("cockpit.voce")],
    }));`;
  const e = spawnSync(process.execPath, ["--input-type=module", "-e", prova], { encoding: "utf8" });
  t.ok(e.status === 0, `prova di chiamata/formati/memo uscita ${e.status}: ${String(e.stderr).slice(-300)}`);
  if (e.status === 0) {
    const j = JSON.parse(e.stdout.trim().split("\n").pop());
    t.ok(j.a.trovata && j.a.resto === "apri la lavagna", `chiamata: «Hey Alfa, apri la lavagna» → ${JSON.stringify(j.a)}`);
    t.ok(j.b.trovata && j.b.resto === "dimmi", `chiamata: variante di nome e prefisso → ${JSON.stringify(j.b)}`);
    t.ok(j.c.trovata, "chiamata: l'alias vale come nome");
    t.ok(!j.d.trovata, "chiamata: il solo nome non basta");
    t.ok(!j.e.trovata, "chiamata: una parola che comincia come il nome non basta");
    t.ok(!j.f.trovata, "chiamata: una frase qualsiasi non accende");
    t.ok(j.g === true, "chiamata: il nome si riconosce anche staccato");
    t.ok(j.h === "Hey Alfa", `fraseChiamata: ${j.h}`);
    t.ok(j.vuota === false, "chiamata: senza assistente non si riconosce niente");
    t.ok(j.tok.join("|") === "950|12 k|2,4 M", `tok: ${j.tok.join("|")}`);
    t.ok(j.liv.join("|") === "|attenz|critico", `livello: ${j.liv.join("|")}`);
    t.ok(j.riga === "Titolo", `unaRiga: «${j.riga}»`);
    t.ok(j.memo[0] === "chiaro" && j.memo[1] === "0" && j.memo[2]?.x === 1 && j.memo[3] === "d", `memo, migrazione: ${JSON.stringify(j.memo)}`);
    t.ok(j.memo[4] === "chiaro" && j.memo[5] === null, `memo: plancia-tema resta, le altre chiavi vecchie si tolgono: ${JSON.stringify(j.memo)}`);
  }
}
