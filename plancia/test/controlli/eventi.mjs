// Lo stream della pagina (pagine/condivisi/eventi.js) dopo una caduta: se il browser chiude l'EventSource
// per sempre (readyState CLOSED: una ripresa ha trovato una risposta che non è uno stream), appena /api/chi risponde se ne apre
// uno nuovo e arriva «_aperto»; mentre il browser riprova da solo (CONNECTING) o col server giù non se ne apre nessuno.
// EventSource e fetch finti: niente browser, niente server. Modulo della pagina importato in Node.
import path from "node:path";
import { pathToFileURL } from "node:url";

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function (t) {
  const aperte = [];
  class EventSourceFinto {
    constructor(url) { this.url = url; this.readyState = 0; this.chiusa = false; aperte.push(this); }
    close() { this.chiusa = true; this.readyState = 2; }
  }
  let serverSu = false, chiamate = 0;
  const prima = { window: globalThis.window, EventSource: globalThis.EventSource, fetch: globalThis.fetch };
  globalThis.window = { PLANCIA_BASE: "http://127.0.0.1:1" };
  globalThis.EventSource = EventSourceFinto;
  globalThis.fetch = async (url) => { chiamate++; if (!serverSu) throw new Error("ECONNREFUSED"); return { ok: /\/api\/chi$/.test(url) }; };
  try {
    const E = await import(`${pathToFileURL(path.join(t.plancia, "pagine", "condivisi", "eventi.js")).href}?prova=${Date.now()}`);
    const visti = [];
    E.su("_aperto", () => visti.push("aperto"));
    E.su("_errore", () => visti.push("errore"));
    const es = E.connetti();
    t.ok(aperte.length === 1 && es.url === "http://127.0.0.1:1/api/stream" && E.connetti() === es, "connetti: un EventSource solo, su /api/stream");
    es.readyState = 1; es.onopen();
    t.ok(visti.join() === "aperto", `aperto: ${visti}`);

    // caduta col browser che riprova da solo: nessun EventSource nuovo
    es.readyState = 0; es.onerror();
    await pausa(E.RIPROVA_MS + 300);
    t.ok(aperte.length === 1 && chiamate === 0, `CONNECTING: si lascia riprovare il browser (${aperte.length} stream, ${chiamate} chiamate)`);

    // il browser chiude per sempre, il server è giù: si chiede a /api/chi ma non si riapre
    es.readyState = 2; es.onerror();
    await pausa(E.RIPROVA_MS + 300);
    t.ok(aperte.length === 1 && chiamate >= 1, `CLOSED col server giù: nessuno stream nuovo (${aperte.length}, ${chiamate} chiamate)`);

    // il server torna: si chiude il vecchio e se ne apre uno nuovo, che porta «_aperto»
    serverSu = true;
    await pausa(E.RIPROVA_MS + 300);
    const nuovo = aperte[1];
    t.ok(aperte.length === 2 && es.chiusa && nuovo && nuovo.url === es.url, `CLOSED col server su: stream riaperto (${aperte.length})`);
    if (nuovo) {
      es.onerror(); // un evento tardivo del vecchio non conta
      nuovo.readyState = 1; nuovo.onopen();
      t.ok(visti.filter((v) => v === "aperto").length === 2 && visti.filter((v) => v === "errore").length === 2, `«_aperto» dallo stream nuovo, il vecchio ignorato: ${visti}`);
      const dopo = chiamate;
      await pausa(E.RIPROVA_MS + 300);
      t.ok(chiamate === dopo && aperte.length === 2, "stream aperto: la sorveglianza si ferma");
    }
  } finally {
    for (const [k, v] of Object.entries(prima)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; }
  }
}
