// Un prompt si rilegge dal disco a ogni avvio di un processo, il codice che passa i valori solo col Riavvia: un segnaposto
// nuovo in un prompt fa fallire ogni avvio finché il server non è riavviato; e il ripiego {{chiave|testo}}, sintassi nuova
// anch'essa, un server che non la conosce la lascia alla lettera nel testo. Qui: (1) il ripiego di componi; (2) ogni segnaposto
// dei prompt è già noto al server in esercizio (ELENCO); (3) i ripieghi nei prompt solo se anche componi in esercizio li legge.
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// I nomi che il server in esercizio sa riempire. Si allunga solo con un Riavvia che porta il codice nuovo (la patch dice
// «Riavvia subito dopo il merge»), nello stesso commit del prompt che li usa.
// Vero solo dopo un Riavvia con la sintassi {{chiave|ripiego}} in componi: prima, il ripiego in un prompt esce alla lettera.
const RIPIEGO_IN_ESERCIZIO = false;
const ELENCO = new Set(`altro appunti assistente assistente_slug autonomia bagaglio battito_giorni battito_orari cartella
cartella_squadra capo checklist contesto ctl data giorno intervallo istruzioni mancano mappa mandato messaggi messaggi_ora
modello_default motivo nome ora creatore persona posto quaderno riporta_a risposte ruolo_nome ruoli_mattino segnali segnali_nuovi
segnali_visti skill_lavagna squadra_elenco testo quando`.split(/\s+/));
const SEGNAPOSTO = /\{\{\s*([\w.\-]+)\s*(\|[^}]*)?\}\}/g;

function md(dir, out = []) {
  for (const v of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, v.name);
    if (v.isDirectory()) { if (v.name !== "node_modules" && !v.name.startsWith(".")) md(p, out); }
    else if (v.name.endsWith(".md") && v.name !== "README.md" && v.name !== "CLAUDE.md") out.push(p);
  }
  return out;
}

export default async function (t) {
  const { componi } = await import(pathToFileURL(path.join(t.plancia, "server/prompt.mjs")).href);
  const cp = t.tmp();
  mkdirSync(cp, { recursive: true });
  writeFileSync(path.join(cp, "p.md"), "A {{x|il tuo capo}}, B {{ y | altro }}, C {{z|}}.\n");
  t.ok(componi("p", {}, [], cp) === "A il tuo capo, B altro, C .\n", "componi: senza valore vale il ripiego");
  t.ok(componi("p", { x: "Zeta", y: "", z: "k" }, [], cp) === "A Zeta, B , C k.\n", "componi: il valore passato vince sul ripiego (anche la stringa vuota)");
  writeFileSync(path.join(cp, "q.md"), "A {{x}} {{w|ok}}.\n");
  let errore = ""; try { componi("q", {}, [], cp); } catch (e) { errore = e.message; }
  t.ok(/senza valore: x$/.test(errore), `componi: senza ripiego resta l'errore (${errore})`);

  for (const f of md(path.join(t.plancia, "prompt")).concat(md(path.join(t.plancia, "moduli")))) {
    const rel = path.relative(t.plancia, f).split(path.sep).join("/");
    for (const [, nome, ripiego] of readFileSync(f, "utf8").matchAll(SEGNAPOSTO)) {
      t.ok(ELENCO.has(nome),
        `${rel}: {{${nome}}} non è nell'elenco dei segnaposto che il server in esercizio riempie: o il valore lo passa codice già in esercizio (aggiungi il nome a ELENCO) o la patch dice «Riavvia subito dopo il merge» e il nome entra in ELENCO con lei`);
      t.ok(ripiego === undefined || RIPIEGO_IN_ESERCIZIO,
        `${rel}: {{${nome}|…}}: il ripiego è nel prompt solo dopo il Riavvia che porta componi nuovo (RIPIEGO_IN_ESERCIZIO); prima il server lo lascia alla lettera nel testo`);
    }
  }
}
