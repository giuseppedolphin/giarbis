// Il modulo todo-md: la to-do da un file markdown a caselle (voci.mjs dice il formato). Foglio «todo» sulla mappa, chiusura e
// riapertura (rotte /api/todo*, comandi di ctl in ctl.mjs), segnali del battito sulle scadenze, un frammento di prompt.
// Opzioni (plancia.config.json, moduli["todo-md"]): file — percorso relativo alla cartella di lavoro (default TODO.md).
// L'id di una voce che si cerca si accetta anche senza la «t» iniziale.
import path from "node:path";
import { leggiVoci, chiudi, riapri } from "./voci.mjs";

const CHIAVE = "todo";
const fileDi = (ctx) => path.resolve(ctx.cfg.cartella, ctx.opzioni?.file || "TODO.md");
const idDi = (x) => { const s = String(x || "").trim(); return /^[0-9a-f]{6}$/.test(s) ? `t${s}` : s; };
const RECENTI_GIORNI = 7;

function giorni(ctx, adesso) {
  const giorno = new Intl.DateTimeFormat("sv-SE", { timeZone: ctx.cfg.fuso }).format(new Date(adesso));
  const d = new Date(`${giorno}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1);
  return { giorno, domani: d.toISOString().slice(0, 10) };
}

function dati(ctx) {
  const voci = leggiVoci(fileDi(ctx));
  const limite = new Date(Date.now() - RECENTI_GIORNI * 86400000).toISOString().slice(0, 10);
  const ordine = (v) => ({ P1: 1, P2: 2, P3: 3 }[v.priorita] || 4);
  return {
    [CHIAVE]: voci.filter((v) => v.stato !== "chiusa").sort((a, b) => ordine(a) - ordine(b)),
    chiuse: { [CHIAVE]: voci.filter((v) => v.stato === "chiusa" && v.chiusa >= limite).sort((a, b) => b.chiusa.localeCompare(a.chiusa)) },
  };
}

function segnaliBattito(ctx) {
  const { giorno, domani } = giorni(ctx, ctx.adesso ?? Date.now());
  return leggiVoci(fileDi(ctx)).filter((v) => v.stato !== "chiusa" && v.scadenza && v.scadenza <= domani).map((v) => {
    const quando = v.scadenza < giorno ? "scaduta" : v.scadenza === giorno ? "oggi" : "domani";
    return { chiave: `scadenza:${v.id}:${quando}:${giorno}`, tipo: "scadenza", testo: `«${v.titolo}» scade ${quando === "scaduta" ? `(già scaduta il ${v.scadenza})` : quando}` };
  });
}

function rotte(ctx) {
  const azione = (fn) => async (c) => {
    const corpo = await c.corpo();
    const v = fn(corpo);
    const r = { id: v.id, stato: v.stato, chiusa: v.chiusa, esito: v.esito, priorita: v.priorita || "" };
    ctx.trasmetti({ type: "cockpit_todo", ...r });
    return r;
  };
  return [
    { metodo: "GET", percorso: "/api/todo", gestore: async () => dati(ctx) },
    { metodo: "POST", percorso: "/api/todo/chiudi", gestore: azione((c) => chiudi(fileDi(ctx), idDi(c.id), c.esito)) },
    { metodo: "POST", percorso: "/api/todo/riapri", gestore: azione((c) => riapri(fileDi(ctx), idDi(c.id))) },
  ];
}

const tipoTodo = {
  testo(foglio, ctx) {
    return dati(ctx)[CHIAVE].map((v) => `${v.id} ${v.priorita || "--"} ${v.titolo}${v.scadenza ? ` (scade ${v.scadenza})` : ""}`).join("\n") || "nessuna voce aperta";
  },
  descrizione(foglio, ctx) { return `Le voci aperte di ${path.basename(fileDi(ctx))}, lette dal vivo`; },
  valida() { return { tabella: CHIAVE }; },
  contesto(foglio, ctx) { return `file della to-do: ${path.relative(ctx.cfg.cartella, fileDi(ctx))}`; },
};

export default {
  nome: "todo-md",
  tipiEvento: ["cockpit_todo"],
  tipiFoglio: { todo: tipoTodo },
  rotte,
  segnaliBattito,
  pagina: "pagina.js",
  prompt: { assistente: "prompt-assistente.md", foglio: "prompt-foglio.md" },
};
