// I comandi in basso della mappa (Nuovo agente, Fogli, Centra…) e lo zoom si nascondono solo con un foglio a tutto schermo
// o affiancato e visibile: un foglio spento col «–» o da `ctl foglio disattiva` mentre era a tutto
// schermo teneva la classe `piena`, e la regola `.mappa:has(.foglio.piena)` nascondeva tutta la barra fino al ricarico.
// Controllo del testo di stile.css e fogli.js; con Chrome sul Mac anche la prova vera nel browser, headless, sullo stile.css.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export default async function (t) {
  const cockpit = path.join(t.plancia, "pagine", "cockpit");
  const css = readFileSync(path.join(cockpit, "stile.css"), "utf8");
  const regole = css.match(/\.mappa:has\([^)]*\)[^{,]*/g) ?? [];
  const suiFogli = regole.filter((r) => /\.foglio\.(piena|affiancato)/.test(r));
  t.ok(suiFogli.length > 0, "comandi-mappa: stile.css ha la regola che nasconde i comandi con un foglio a tutto schermo");
  t.ok(suiFogli.every((r) => !/\.foglio\.(piena|affiancato)(?!:not\(\[hidden\]\))/.test(r)), "comandi-mappa: la regola vale solo per fogli visibili (:not([hidden]))");
  const js = readFileSync(path.join(cockpit, "fogli.js"), "utf8");
  const accendi = js.slice(js.indexOf("function accendiFoglio"), js.indexOf("function eliminaFoglio"));
  t.ok(/if \(!acceso\) el\.classList\.remove\("piena", "affiancato"\)/.test(accendi), "comandi-mappa: spegnere un foglio lo toglie dal tutto schermo e dall'affiancato");
  t.ok(/if \(el\.hidden\) el\.classList\.remove\("piena", "affiancato"\)/.test(js), "comandi-mappa: un foglio spento dal server esce dal tutto schermo");

  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (process.platform !== "darwin" || !existsSync(chrome)) return;
  const dir = mkdtempSync(path.join(os.tmpdir(), "comandi-mappa-"));
  try {
    const f = path.join(dir, "prova.html");
    writeFileSync(f, `<!doctype html><html><head><link rel="stylesheet" href="${pathToFileURL(path.join(cockpit, "stile.css")).href}"></head><body>
<section class="mappa"><div class="mappa-com" id="com"><button>Centra</button></div><div class="fogli"><div class="foglio" id="f"></div></div></section>
<pre id="out"></pre><script>
const f = document.getElementById("f"), d = () => getComputedStyle(document.getElementById("com")).display, r = [d()];
f.classList.add("piena"); r.push(d()); f.hidden = true; r.push(d());
document.getElementById("out").textContent = "esito:" + r.join(",") + ":fine";
</script></body></html>`);
    const p = spawnSync(chrome, ["--headless=new", "--disable-gpu", "--allow-file-access-from-files", `--user-data-dir=${path.join(dir, "profilo")}`, "--dump-dom", pathToFileURL(f).href], { encoding: "utf8", timeout: 30000 });
    const esito = p.stdout?.match(/esito:([^:]*):fine/)?.[1];
    if (!esito) return; // Chrome non risponde in tempo: resta il controllo del testo
    t.ok(esito === "flex,none,flex", `comandi-mappa: nel browser i comandi ci sono, spariscono col foglio a tutto schermo e tornano quando il foglio si spegne (${esito})`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
