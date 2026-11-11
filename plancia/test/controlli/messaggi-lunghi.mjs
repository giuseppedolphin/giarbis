// Messaggi e compiti lunghi: un testo da 100.000 caratteri arriva intero alla sessione dalla rotta,
// dal ctl con --file e con --file - (stdin), e come compito di `crea`; oltre il vecchio tetto di 1 MB la rotta regge (il 413
// oltre limiti.corpoMB, default 8, lo prova server.mjs). Server di prova con COCKPIT_PROVA=1: il messaggio resta a registro come
// cockpit_utente, nessun processo claude parte.
import { writeFileSync } from "node:fs";
import path from "node:path";

const D = { "x-dashboard": "1" };

// un testo riconoscibile: righe numerate con accenti, un capo e una coda unici, nessuno spazio ai bordi (invia() fa trim)
function testo(n, segno) {
  let t = `INIZIO-${segno}\n`;
  for (let i = 0; t.length < n - 20; i++) t += `riga ${i}: perché così è più lungo, àèìòù — "virgolette" e $dollari\n`;
  return `${t}FINE-${segno}`;
}

export default async function (t) {
  const s = await t.avviaServer({});
  const dir = t.tmp();
  const base = { COCKPIT_STATO: s.stato, COCKPIT_SESSIONE: "", COCKPIT_PORTA: String(s.porta) };
  const ctl = (args, input) => t.ctl(args, base, input);

  const ultimo = async (nome) => {
    const r = await t.get(s.base, `/api/sessioni/${encodeURIComponent(nome)}/eventi`, D);
    if (r.codice !== 200) return null;
    return r.json().eventi.filter((e) => e.type === "cockpit_utente").pop()?.testo ?? null;
  };
  const assistente = (await t.get(s.base, "/api/sessioni", D)).json().sessioni.find((x) => x.ruolo === "orchestratore")?.nome;
  t.ok(assistente, "c'è l'orchestratore a cui scrivere");

  // dalla rotta, come la chat del cockpit e la bolla
  const a = testo(100000, "rotta");
  let r = await t.post(s.base, `/api/sessioni/${assistente}/messaggio`, { testo: a }, D);
  t.ok(r.codice === 200, `rotta: 100.000 caratteri, ${r.codice} ${r.testo.slice(0, 120)}`);
  const arrivato = await ultimo(assistente);
  t.ok(arrivato === a, `rotta: il messaggio non arriva intero (${arrivato?.length} di ${a.length} caratteri)`);

  // oltre il vecchio tetto di 1 MB: passa; oltre limiti.corpoMB: 413
  const grande = testo(2.2e6, "grande");
  r = await t.post(s.base, `/api/sessioni/${assistente}/messaggio`, { testo: grande }, D);
  t.ok(r.codice === 200 && (await ultimo(assistente)) === grande, `rotta: 2,2 MB non arrivano interi (${r.codice})`);

  // dal ctl con --file, col testo degli argomenti in testa
  const b = testo(100000, "file");
  const file = path.join(dir, "messaggio.md");
  writeFileSync(file, `﻿${b}`); // col BOM, come lo scrive PowerShell: il ctl lo toglie
  let c = ctl(["invia", assistente, "leggi qui sotto:", "--file", file]);
  t.ok(c.codice === 0, `ctl invia --file: uscita ${c.codice}: ${c.out.slice(0, 200)}`);
  t.ok((await ultimo(assistente)) === `leggi qui sotto:\n\n${b}`, "ctl invia --file: il messaggio non arriva intero");

  // dal ctl con --file - (stdin)
  const d = testo(100000, "stdin");
  c = ctl(["invia", assistente, "--file", "-"], d);
  t.ok(c.codice === 0 && (await ultimo(assistente)) === d, `ctl invia --file -: ${c.codice} ${c.out.slice(0, 200)}`);

  // file che non c'è: errore, niente messaggio vuoto
  c = ctl(["invia", assistente, "--file", path.join(dir, "non-c-e.md")]);
  t.ok(c.codice === 1 && /non trovo/.test(c.out), `ctl invia --file inesistente: ${c.codice} ${c.out.slice(0, 120)}`);

  // il compito di crea, da file
  const e = testo(100000, "compito");
  const compito = path.join(dir, "compito.md");
  writeFileSync(compito, e);
  c = ctl(["crea", "lungo", "--file", compito]);
  t.ok(c.codice === 0, `ctl crea --file: ${c.codice} ${c.out.slice(0, 200)}`);
  t.ok((await ultimo("lungo")) === e, "ctl crea --file: il compito non arriva intero");

  // senza --file la forma di sempre; oltre i ~32.000 caratteri solo dove la riga di comando li regge (non Windows)
  c = ctl(["invia", assistente, "corto", "e", "semplice"]);
  t.ok(c.codice === 0 && (await ultimo(assistente)) === "corto e semplice", `ctl invia senza --file: ${c.out.slice(0, 120)}`);
  if (process.platform !== "win32") {
    const f = testo(100000, "argomento");
    c = ctl(["invia", assistente, f]);
    t.ok(c.codice === 0 && (await ultimo(assistente)) === f, `ctl invia con 100.000 caratteri come argomento: ${c.codice}`);
  }
}
