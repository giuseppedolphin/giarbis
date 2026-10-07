// Il widget «Consumo del piano»: una pagina html nella lavagna (<stato>/lavagna/consumo-max.html) e un riassunto
// (<stato>/consumo-riassunto.json) per il pulsante nella barra comune (nav.js, via GET /api/consumo).
// La rigenera il server ogni 5 minuti (avviaConsumo, da server.mjs); a mano: node plancia/server/consumo-pagina.mjs [--sonda].
// La pagina è il modello consumo-widget.html, con i dati al posto di __DATI__.
//
// Da dove vengono i numeri:
//   - percentuali della finestra di 5 ore e della settimana: l'ultima lettura che Claude Code stesso riporta nello stream
//     (`rate_limit_event`), salvata da consumo.mjs. È il dato del piano, vale per tutti i dispositivi.
//     Arriva solo quando una sessione parla col modello: senza sessioni attive resta l'ultima, con la sua ora.
//   - token per giorno e per modello: i transcript locali di Claude Code in ~/.claude/projects (solo questo Mac).
// Nessuna credenziale letta, nessuna chiamata a modelli per aggiornare. Solo `--sonda`, a mano, fa una chiamata minima (Haiku) per una
// lettura fresca: costa un filo di quota. Fuso e lingua vengono dalla config.
//
// Chi chiama `statoConsumo` o `avviaConsumo` con la firma di prima (un `root` davanti) funziona ancora: l'argomento è ignorato.
import { readdirSync, readFileSync, statSync, createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config } from "./config.mjs";
import { leggiLimiti, sonda } from "./consumo.mjs";
import { negozio, salvaFile } from "./stato.mjs";

export const FILE_WIDGET = "consumo-max.html";
export const OGNI_MS = 5 * 60 * 1000;
const ORA = 3600e3, GIORNO = 24 * ORA;
const riassuntoStato = () => negozio("consumo-riassunto", { base: null });
const MODELLO_PAGINA = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "consumo-widget.html"), "utf8");

export async function generaConsumo({ conSonda = false } = {}) {
  const cfg = config();
  if (conSonda) sonda();
  const { ultima } = leggiLimiti();
  const adesso = Date.now();

  // ---- la settimana del piano: dalla lettura (reset - 7 giorni), altrimenti gli ultimi 7 giorni ----------------
  const fineSett = ultima?.sette?.reset ? ultima.sette.reset * 1000 : null;
  const inizioSett = fineSett && fineSett > adesso ? fineSett - 7 * GIORNO : adesso - 7 * GIORNO;
  const fine5 = ultima?.cinque?.reset ? ultima.cinque.reset * 1000 : null;
  const inizio5 = fine5 && fine5 > adesso ? fine5 - 5 * ORA : adesso - 5 * ORA;

  // ---- token dai transcript locali --------------------------------------------------------------------------
  const famiglia = (m) => /opus/i.test(m) ? "Opus" : /sonnet/i.test(m) ? "Sonnet" : /haiku/i.test(m) ? "Haiku" : /fable/i.test(m) ? "Fable" : null;
  function fileJsonl(dir, dopo, acc = []) {
    let voci = [];
    try { voci = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
    for (const v of voci) {
      const p = path.join(dir, v.name);
      if (v.isDirectory()) fileJsonl(p, dopo, acc);
      else if (v.name.endsWith(".jsonl")) { try { if (statSync(p).mtimeMs >= dopo) acc.push(p); } catch { /* sparito nel frattempo */ } }
    }
    return acc;
  }
  const visti = new Set();
  const messaggi = []; // { t, fam, lavoro, out, cacheLettura }
  for (const f of fileJsonl(path.join(os.homedir(), ".claude/projects"), inizioSett)) {
    const rl = createInterface({ input: createReadStream(f), crlfDelay: Infinity });
    for await (const riga of rl) {
      if (!riga.includes('"usage"') || !riga.includes('"assistant"')) continue;
      let d; try { d = JSON.parse(riga); } catch { continue; }
      const m = d.message, u = m?.usage;
      if (d.type !== "assistant" || !u) continue;
      const t = Date.parse(d.timestamp);
      if (!(t >= inizioSett)) continue;
      const fam = famiglia(m.model || "");
      if (!fam) continue;
      const chiave = `${m.id}:${d.requestId}`; // un messaggio è scritto una volta per blocco, con lo stesso usage
      if (visti.has(chiave)) continue;
      visti.add(chiave);
      const out = u.output_tokens || 0;
      messaggi.push({ t, fam, lavoro: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + out, out, cacheLettura: u.cache_read_input_tokens || 0 });
    }
  }

  // ---- giorni della settimana del piano (ora di Roma) --------------------------------------------------------
  const MODELLI = ["Opus", "Sonnet", "Haiku", "Fable"];
  const chiaveGiorno = (t) => new Date(t).toLocaleDateString("sv-SE", { timeZone: cfg.fuso });
  const giorni = [];
  for (let t = inizioSett; ; t += GIORNO) {
    const k = chiaveGiorno(Math.min(t, inizioSett + 7 * GIORNO));
    if (!giorni.some((g) => g.k === k)) {
      const quando = Math.min(t, inizioSett + 7 * GIORNO);
      giorni.push({
        k, etichetta: new Date(quando).toLocaleDateString(cfg.lingua, { timeZone: cfg.fuso, weekday: "short", day: "numeric" }),
        futuro: k > chiaveGiorno(adesso), per: Object.fromEntries(MODELLI.map((x) => [x, 0])), out: 0, cache: 0,
      });
    }
    if (t >= inizioSett + 7 * GIORNO) break;
  }
  const somma = (filtro) => { const r = Object.fromEntries(MODELLI.map((x) => [x, 0])); for (const m of messaggi) if (filtro(m)) r[m.fam] += m.lavoro; return r; };
  for (const m of messaggi) { const g = giorni.find((x) => x.k === chiaveGiorno(m.t)); if (g) { g.per[m.fam] += m.lavoro; g.out += m.out; g.cache += m.cacheLettura; } }
  const sett = somma(() => true);
  const cinque = somma((m) => m.t >= inizio5);
  const tot = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  const ultime24 = tot(somma((m) => m.t >= adesso - GIORNO));

  // ---- stima: dove arrivi a fine settimana e quando sbatteresti nel limite ------------------------------------
  // Si proietta la percentuale del piano, non i token: il piano pesa i modelli in modo diverso e lo sa solo il server.
  //   ritmo della settimana = percentuale letta / tempo passato dall'inizio della settimana del piano
  //   ritmo delle ultime 24 ore = percentuale letta × (token locali delle ultime 24 ore / token locali della settimana), per giorno
  const lettAt = ultima?.t || 0;
  const valida = (w) => w && w.reset * 1000 > adesso;
  const stima = [];
  if (valida(ultima?.sette)) {
    const u = ultima.sette.u, passato = lettAt - inizioSett, resta = fineSett - lettAt;
    const ritmi = [];
    if (passato > 2 * ORA) ritmi.push({ nome: "al ritmo medio di questa settimana", perMs: u / passato });
    if (tot(sett) > 0 && ultime24 > 0) ritmi.push({ nome: "al ritmo delle ultime 24 ore", perMs: (u * ultime24 / tot(sett)) / GIORNO });
    for (const r of ritmi) {
      const fine = u + r.perMs * resta;
      const sbatti = r.perMs > 0 && fine >= 1 ? lettAt + (1 - u) / r.perMs : null;
      stima.push({ nome: r.nome, fine: Math.round(fine * 100), sbatti });
    }
  }

  // ---- l'HTML ------------------------------------------------------------------------------------------------
  const tema = negozio("impostazioni", { base: {} }).leggi().tema; // sola lettura: le impostazioni sono del server
  const temaValido = tema === "chiaro" || tema === "scuro" ? tema : "";
  const DATI = {
    generato: adesso, lettura: lettAt, lingua: cfg.lingua, fuso: cfg.fuso,
    cinque: valida(ultima?.cinque) ? { u: Math.round(ultima.cinque.u * 100), reset: ultima.cinque.reset * 1000 } : null,
    sette: valida(ultima?.sette) ? { u: Math.round(ultima.sette.u * 100), reset: fineSett, inizio: inizioSett } : null,
    stima, giorni, tokSett: sett, tok5: cinque, inizio5, modelli: MODELLI.filter((x) => sett[x] > 0 || x !== "Fable"),
  };
  const dati = JSON.stringify(DATI).replace(/</g, "\\u003c");
  const html = MODELLO_PAGINA
    .replace("__LINGUA__", () => cfg.lingua)
    .replace("__TEMA__", () => (temaValido ? ` data-tema="${temaValido}"` : ""))
    .replace("__DATI__", () => dati);
  salvaFile("lavagna", FILE_WIDGET, html);
  const oggi = giorni.find((g) => g.k === chiaveGiorno(adesso));
  const riassunto = {
    generato: adesso, lettura: lettAt, cinque: DATI.cinque, sette: DATI.sette, stima: stima[0] || null,
    oggi: oggi ? Object.fromEntries(Object.entries(oggi.per).filter(([, n]) => n > 0)) : {},
    percorso: `/lavagna/${FILE_WIDGET}`,
  };
  riassuntoStato().scrivi(riassunto);
  return { ...riassunto, messaggi: messaggi.length, inizioSett };
}

// Per il pulsante della barra (GET /api/consumo): le percentuali dall'ultima lettura (la più fresca, la scrive consumo.mjs a ogni
// evento), la stima dall'ultimo giro del widget. Una finestra già azzerata dopo la lettura vale null: non si inventa.
export function statoConsumo() {
  const { ultima } = leggiLimiti();
  const r = riassuntoStato().leggi(); // null finché il primo giro non è fatto
  const w = (x) => (x && x.reset * 1000 > Date.now() ? { u: Math.round(x.u * 100), reset: x.reset * 1000 } : null);
  return {
    lettura: ultima?.t || 0, cinque: w(ultima?.cinque), sette: w(ultima?.sette), stima: r?.stima || null,
    oggi: r?.oggi || {}, generato: r?.generato || 0, percorso: `/lavagna/${FILE_WIDGET}`,
  };
}

// Il timer del server: subito e poi ogni 5 minuti; un giro alla volta (se uno si trascina, il successivo salta).
export function avviaConsumo() {
  let inCorso = false;
  const giro = async () => {
    if (inCorso) return;
    inCorso = true;
    try { await generaConsumo(); } catch (e) { console.error("consumo:", e.message); } finally { inCorso = false; }
  };
  giro();
  return setInterval(giro, OGNI_MS).unref();
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const r = await generaConsumo({ conSonda: process.argv.includes("--sonda") });
  console.log(`consumo: ${r.messaggi} messaggi dal ${new Date(r.inizioSett).toLocaleString(config().lingua)}; 5h ${r.cinque?.u ?? "—"}%, settimana ${r.sette?.u ?? "—"}%`);
}
