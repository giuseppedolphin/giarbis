// Il pulsante «Copia» sotto le risposte della chat: il testo copiato è il
// markdown sorgente della risposta finale (solo blocchi di testo), l'attributo lo porta intero, la copia ripiega su
// execCommand se navigator.clipboard manca o rifiuta; chat.js lo mette solo a turno chiuso, main.js lo accende, lo stile c'è.
// Il modulo importa /condivisi/formati.js (percorso servito): qui se ne prova una copia con l'import riscritto sul file.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export default async function (t) {
  const cockpit = path.join(t.plancia, "pagine", "cockpit");
  const sorgente = readFileSync(path.join(cockpit, "copia.js"), "utf8");
  const formati = pathToFileURL(path.join(t.plancia, "pagine", "condivisi", "formati.js")).href;
  const dir = mkdtempSync(path.join(os.tmpdir(), "copia-"));
  try {
    const f = path.join(dir, "copia.mjs");
    writeFileSync(f, sorgente.replace('"/condivisi/formati.js"', JSON.stringify(formati)));
    const { copiaTesto, htmlCopia, testoRisposta } = await import(pathToFileURL(f).href);

    const md = "## Titolo\n\nUna **frase** con `codice`, \"virgolette\" & <tag>.\n\n- uno\n- due\n\n```js\nconst a = 1;\n```";
    const blocchi = [{ type: "text", text: md }, { type: "tool_use", id: "x", name: "Bash", input: {} }, { type: "text", text: "  Seconda parte.  " }];
    t.ok(testoRisposta(blocchi) === `${md}\n\nSeconda parte.`, "copia: il testo è il markdown dei soli blocchi di testo, separati da una riga vuota");
    const html = htmlCopia(blocchi);
    const attr = html.match(/data-copia="([^"]*)"/)?.[1] ?? "";
    const torna = attr.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    t.ok(torna === testoRisposta(blocchi), "copia: l'attributo porta il testo intero, senza rompere l'html");
    t.ok(/aria-label="Copia la risposta"/.test(html) && /<button type="button"/.test(html), "copia: pulsante vero con aria-label");
    t.ok(htmlCopia([{ type: "text", text: "  " }]) === "" && htmlCopia([]) === "", "copia: niente pulsante senza testo");

    // la copia: clipboard che rifiuta → textarea nascosto ed execCommand; clipboard che va → nessun ripiego
    const scritti = [];
    let comandi = 0;
    const ta = { value: "", style: {}, setAttribute() {}, select() {}, remove() {} };
    globalThis.document = { activeElement: null, createElement: () => ta, body: { append() {} }, execCommand: (c) => { comandi++; scritti.push(ta.value); return c === "copy"; } };
    Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async () => { throw new Error("negato"); } } }, configurable: true });
    t.ok(await copiaTesto("abc") === true && scritti[0] === "abc" && comandi === 1, "copia: se clipboard rifiuta, ripiego con execCommand");
    Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async (x) => { scritti.push(`clip:${x}`); } } }, configurable: true });
    t.ok(await copiaTesto("def") === true && scritti.at(-1) === "clip:def" && comandi === 1, "copia: con clipboard nessun ripiego");
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    t.ok(await copiaTesto("ghi") === true && scritti.at(-1) === "ghi", "copia: senza clipboard, ripiego");
    delete globalThis.document;
  } finally { rmSync(dir, { recursive: true, force: true }); }

  const chat = readFileSync(path.join(cockpit, "chat.js"), "utf8");
  t.ok(/if \(!inCorso\) parti\.push\(htmlCopia\(finale\)\)/.test(chat), "chat.js: «Copia» sotto la risposta finale, solo a turno chiuso");
  t.ok(/initCopia\(\);/.test(readFileSync(path.join(cockpit, "main.js"), "utf8")), "main.js: initCopia acceso");
  const css = readFileSync(path.join(cockpit, "stile.css"), "utf8");
  t.ok(/\.turno:last-child \.copia/.test(css) && /@media \(hover:none\)\{\.copia\{opacity:1\}\}/.test(css), "stile.css: visibile sull'ultima risposta e su touch");
  t.ok(!/\.copia[^{]*\{[^}]*#[0-9a-f]{3,6}/i.test(css), "stile.css: nessun colore scritto a mano nel pulsante");
}
