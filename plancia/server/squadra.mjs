// La squadra: agenti permanenti con un ruolo, un mandato e una metrica (spec in spec interna).
// Una squadra è di una persona. I ruoli li porta un modulo (campo `squadra` di modulo.mjs, relativo alla cartella del modulo):
// una cartella con una sottocartella per persona, `<slug>/ruoli.json` coi mandati, il seme del bagaglio e il prompt accanto,
// oppure un file json (la stessa squadra per chiunque). L'override locale `<stato>/squadra/ruoli.json`, se c'è, vince sui
// moduli. Una persona senza file non ha squadra: all'avvio le sessioni della squadra rimaste nello stato si tolgono (con una
// persona sconosciuta no: non si tocca niente). Le regole comuni stanno nella sezione `squadra` della config. Ogni ruolo è una
// sessione con `ruolo: "squadra"`, nome uguale allo slug, figlia dell'assistente (i capi) o del suo capo (gli esecutori).
//
// Il risveglio è uno scheduler del server, come il battito: ogni 20 secondi, per ogni agente acceso il cui intervallo è
// passato (o che ha appena ricevuto un messaggio), se l'agente lavora, è in compact o ha messaggi in coda si salta e si
// riprova al giro dopo; altrimenti si guarda CON CODICE se c'è qualcosa di nuovo per lui (messaggi della bacheca e diretti,
// segnali del suo dominio mai visti) e solo allora parte il turno [squadra]. Ogni `vuotoOgniMinuti` un turno a vuoto per il
// lavoro proprio. Al massimo un turno nuovo per giro; col piano oltre `consumoMax` nella finestra di cinque ore, pausa.
// Spenta finché la persona non la accende. Con COCKPIT_PROVA=1 lo scheduler non parte (il giro si lancia a mano).
//
// Stato (stato.mjs): squadra.json = { acceso, agenti: { slug: { acceso?, intervalloMinuti?, ultimoGiro, ultimoTurno,
// letto, visti, sveglia, svegliaUltima, esito, bagaglio } }, registro } · cartelle di lavoro in <stato>/squadra/<slug>/ · bacheca in bacheca.mjs ·
// il bagaglio di ogni agente in bagaglio.mjs: nel prompt all'avvio del processo, nel turno [squadra] quando è cambiato.
//
// Quattro campi facoltativi del file dei ruoli. `chrome` (del file, o del ruolo, che vince): vero o falso dice se la sessione parte
// con gli strumenti del browser (--chrome); senza, vale la config. `permessi` (solo del ruolo, mai di tutta la squadra): le regole
// di allow che la sessione riceve con --allowedTools, in modalità auto prima del classificatore. `mattino` (solo del file): { ora, fino, giorni, ruoli,
// assistente, istruzioni } — una volta al giorno, dopo `ora` e prima di `fino` (anche in ritardo, se il server era spento), i
// ruoli elencati fanno il «giro del mattino» anche senza novità, e dopo `assistente` l'assistente riceve [squadra] con le
// istruzioni (file relativo al file dei ruoli) per comporre la giornata. Lo stato del giorno sta in squadra.json (`mattino`).
// `sveglie` (solo del ruolo): { ore, giorni } — a ogni ora un turno anche di notte, come il mattino, recuperato entro un'ora
// (svegliaDovuta in squadra-orari.mjs); un ruolo senza il campo si comporta come prima.
//
//   definizioni(moduli, { persona, locale }) → [{ nome, file, dati }] e dove si cercano · caricaRuoli(moduli, { persona, locale }) → i ruoli,
//   capi prima, ciascuno coi suoi colori · creaSquadra(ctx) → { ruoli, stato, colori, imposta, assicura, giro, avvia, prompt,
//   cartelle, scriviBacheca, dm, advisor }   (ctx = { cfg, persona, cockpit, moduli, trasmetti, segnali: [(adesso) => [segnale]] })
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { comandoCtl } from "./config.mjs";
import { cartellaStato, negozio, percorsoStato, salvaFile, seManca } from "./stato.mjs";
import { componi } from "./prompt.mjs";
import { nomeModello, risolviModello } from "./modelli.mjs";
import { statoConsumo } from "./consumo-pagina.mjs";
import * as B from "./bacheca.mjs";
import * as Bg from "./bagaglio.mjs";
import { coloriSquadra } from "./colori.mjs";
import { hm, minutiOra, mattinoDi, momentoMattino, sveglieDi, svegliaDovuta } from "./squadra-orari.mjs";

const GIRO_MS = 20000;
const VISTI_GIORNI = 7;
const REGISTRO_MAX = 60;
const AUTONOMIE = ["rodaggio", "operativo"];
const lista = (x) => (Array.isArray(x) ? x.map((v) => String(v)) : []);
const positivo = (x) => (Number(x) > 0 ? Number(x) : undefined);
const lavora = (s) => s.stato === "lavora" || s.stato === "avvio";
// un percorso del file dei ruoli: ~ è la home di chi avvia la plancia, un relativo parte dalla cartella del file
const espandi = (p, dir) => path.resolve(dir, String(p).replace(/^~(?=$|[\\/])/, os.homedir()));

// ───── i ruoli ─────
const booleano = (x) => (typeof x === "boolean" ? x : undefined);
function normalizza(r, dir, seme = "", chromeFile) {
  const slug = String(r.slug || "").toLowerCase();
  if (!/^[a-z][a-z0-9-]{0,23}$/.test(slug) || ["dm", "tutti"].includes(slug)) throw new Error(`ruolo con slug non valido: "${r.slug}"`);
  risolviModello(r.modello || "sonnet"); // un modello sbagliato si scopre qui, non all'avvio del processo
  return {
    slug, nome: String(r.nome || slug), capo: r.capo ? String(r.capo).toLowerCase() : "",
    mandato: String(r.mandato || ""), metrica: String(r.metrica || ""), modello: String(r.modello || "sonnet"), perche: String(r.perche || ""),
    intervalloMinuti: positivo(r.intervalloMinuti), vuotoOgniMinuti: r.vuotoOgniMinuti === 0 ? 0 : positivo(r.vuotoOgniMinuti),
    segnali: { tipi: lista(r.segnali?.tipi), aree: lista(r.segnali?.aree) },
    autonomia: AUTONOMIE.includes(r.autonomia) ? r.autonomia : "rodaggio", acceso: r.acceso !== false,
    mandatoFile: r.mandatoFile ? path.resolve(dir, String(r.mandatoFile)) : "", semeBagaglio: seme,
    cartelle: lista(r.cartelle).filter(Boolean).map((p) => espandi(p, dir)), // cartelle in più dove lavora (--add-dir); vuoto per chi non le dichiara
    colore: r.capo ? "" : String(r.colore || ""), // solo dei capi: gli esecutori prendono una sfumatura del capo (colori.mjs)
    volto: /^[a-z][a-z0-9-]{0,23}$/.test(String(r.volto || "")) ? String(r.volto) : "", // il tipo di faccia sulla mappa (pagine/cockpit/volti-disegno.js); vuoto = la sfera di sempre
    chrome: booleano(r.chrome) ?? chromeFile, // undefined = vale la config (cfg.chrome)
    permessi: lista(r.permessi).map((p) => p.trim()).filter(Boolean), // regole di allow del ruolo (--allowedTools); vuoto = nessuna
    sveglie: sveglieDi(r.sveglie, slug), // gli orari a cui si sveglia da solo (squadra-orari.mjs); null = nessuno, come prima
    // quanti agenti usa e getta vivi può avere (ctl crea): di default 2 per un capo, nessuno per un esecutore
    usaEGetta: Number.isInteger(r.usaEGetta) && r.usaEGetta >= 0 ? r.usaEGetta : r.capo ? 0 : 2,
  };
}

// I file della squadra di questa persona: l'override locale, se c'è, altrimenti quelli dei moduli. `cercati`: dove si è guardato.
const SLUG_PERSONA = /^[a-z0-9][a-z0-9-]*$/;
export function definizioni(moduli = [], { persona = {}, locale = "" } = {}) {
  const leggiFile = (nome, file) => {
    try { return { nome, file, dati: JSON.parse(readFileSync(file, "utf8")) }; } catch (e) { throw new Error(`squadra del modulo ${nome}: ${file} (${e.message})`); }
  };
  if (locale && existsSync(locale)) return { trovate: [leggiFile("locale", locale)], cercati: [locale] };
  const trovate = [], cercati = [], slug = String(persona.slug || "");
  for (const m of moduli) {
    if (!m.squadra) continue;
    const dove = path.resolve(m.cartella, m.squadra);
    if (/\.json$/i.test(dove)) { cercati.push(dove); trovate.push(leggiFile(m.nome, dove)); continue; } // una squadra per tutti
    if (!SLUG_PERSONA.test(slug)) continue; // persona sconosciuta: nessuna squadra
    const file = path.join(dove, slug, "ruoli.json");
    cercati.push(file);
    if (existsSync(file)) trovate.push(leggiFile(m.nome, file));
  }
  return { trovate, cercati };
}

export function caricaRuoli(moduli = [], opzioni = {}) { return daDefinizioni(definizioni(moduli, opzioni).trovate); }

function daDefinizioni(trovate) {
  const out = [];
  for (const { file, dati } of trovate) {
    const seme = dati.bagaglio ? path.resolve(path.dirname(file), String(dati.bagaglio)) : ""; // il seme comune del bagaglio
    for (const r of dati.ruoli || []) out.push(normalizza(r, path.dirname(file), seme, booleano(dati.chrome)));
  }
  const visti = new Set();
  for (const r of out) { if (visti.has(r.slug)) throw new Error(`ruolo doppio: ${r.slug}`); visti.add(r.slug); }
  for (const r of out.filter((x) => x.capo)) {
    const c = out.find((x) => x.slug === r.capo);
    if (!c) throw new Error(`il capo di ${r.slug} non esiste: ${r.capo}`);
    if (c.capo) throw new Error(`${r.slug}: il suo capo ${c.slug} ha a sua volta un capo (la squadra ha due livelli)`);
  }
  const colori = coloriSquadra(out); // un colore per tema a ogni ruolo; errore se un capo ha un colore riservato
  for (const r of out) r.colori = colori.get(r.slug);
  return [...out.filter((r) => !r.capo), ...out.filter((r) => r.capo)];
}

// ───── ore nel fuso della config ─────
export function inQuiete(cfg, t = Date.now()) {
  const q = cfg.squadra.quiete;
  if (!q) return false;
  const x = minutiOra(cfg, t), a = hm(q.dalle), b = hm(q.alle);
  return a <= b ? x >= a && x < b : x >= a || x < b;
}

// La regola dura del risveglio: mai su un agente al lavoro, in compact o con messaggi in coda. Pura, la prova il controllo.
export function occupato(cockpit, s) {
  if (!s) return true;
  return lavora(s) || (cockpit.inCoda?.get(s.id) || 0) > 0 || cockpit.turno?.get(s.id)?.origine === "compact";
}

export function creaSquadra({ cfg, persona = {}, cockpit, moduli = [], trasmetti = () => {}, segnali = [] }) {
  const def = definizioni(moduli, { persona, locale: percorsoStato("squadra", "ruoli.json") });
  const ruoli = daDefinizioni(def.trovate);
  const mattino = mattinoDi(def.trovate, ruoli);
  // il prompt della persona (campo `prompt` del file dei ruoli) entra in coda al prompt della squadra come un frammento di modulo
  const frammenti = def.trovate.filter((d) => d.dati.prompt).map((d) => ({ nome: `squadra-${d.nome}`, cartella: path.dirname(d.file), prompt: { squadra: String(d.dati.prompt) } }));
  const regole = cfg.squadra;
  const chi = persona.nome || "chi usa la plancia";
  const assistente = cfg.assistente;
  const archivio = negozio("squadra", { base: { acceso: false, agenti: {}, registro: [] } });
  const leggi = () => {
    const d = archivio.leggi();
    return { ...d, acceso: !!d.acceso, agenti: d.agenti && typeof d.agenti === "object" ? d.agenti : {}, registro: Array.isArray(d.registro) ? d.registro : [] };
  };
  const salva = (d) => archivio.scrivi(d);
  const ruolo = (slug) => ruoli.find((r) => r.slug === slug) || null;
  const esecutoriDi = (slug) => ruoli.filter((r) => r.capo === slug);
  const agente = (d, slug) => (d.agenti[slug] ||= {});
  const accesoDi = (r, a) => (a.acceso === undefined ? r.acceso : !!a.acceso);
  // spegnere chiude il processo claude: subito se l'agente è fermo, a fine turno se è ancora spento; rinasce col messaggio dopo
  const chiudiSpenti = (slugs) => { for (const x of slugs) { const s = cockpit.trova(x); if (s?.ruolo === "squadra") cockpit.chiudiProcesso(s.id, () => { const d = leggi(); return !d.acceso || !accesoDi(ruolo(x), d.agenti[x] || {}); }); } };
  const baseIntervallo = (r, a) => a.intervalloMinuti || r.intervalloMinuti || regole.intervalloMinuti;
  // minuti fra un giro e l'altro adesso; null = di notte la squadra dorme
  const intervalloDi = (r, a, t) => (inQuiete(cfg, t) ? (regole.quiete.intervalloMinuti ? Math.max(baseIntervallo(r, a), regole.quiete.intervalloMinuti) : null) : baseIntervallo(r, a));
  const vuotoDi = (r) => (r.vuotoOgniMinuti === undefined ? regole.vuotoOgniMinuti : r.vuotoOgniMinuti);
  const annuncia = (azione, extra = {}) => { try { trasmetti({ type: "cockpit_squadra", azione, ...extra }); } catch { /* lo stream non deve fermare la squadra */ } };
  const annota = (d, voce) => { d.registro.push({ t: Date.now(), ...voce }); d.registro = d.registro.slice(-REGISTRO_MAX); };
  const relativo = (p) => { const r = path.relative(cfg.cartella, p); return r && !r.startsWith("..") && !path.isAbsolute(r) ? r : p; };

  // ───── la cartella di lavoro e il mandato ─────
  function mandatoLungo(r) {
    if (!r.mandatoFile) return "";
    try { return readFileSync(r.mandatoFile, "utf8").trim(); } catch (e) { return `(il mandato lungo non si legge: ${e.message})`; }
  }
  function testoMandato(r) {
    const capo = r.capo ? ruolo(r.capo) : null;
    const lungo = mandatoLungo(r);
    return [`# ${r.nome}`, "", "> Copia rigenerata a ogni avvio dal file dei ruoli: non la modificare, proponi le modifiche.", "",
      `- **Mandato**: ${r.mandato || "—"}`, `- **Metrica**: ${r.metrica || "—"}`,
      `- **Capo**: ${capo ? `${capo.nome} (@${capo.slug})` : `${chi}, con ${assistente.nome} come advisor`}`,
      `- **Esecutori**: ${esecutoriDi(r.slug).map((e) => `${e.nome} (@${e.slug})`).join(", ") || "nessuno"}`,
      `- **Modello**: ${nomeModello(risolviModello(r.modello))}${r.perche ? ` — ${r.perche}` : ""}`,
      `- **Autonomia**: ${r.autonomia}`, "", lungo, ""].join("\n");
  }
  function preparaCartella(r) {
    const sotto = `squadra/${r.slug}`;
    cartellaStato(`${sotto}/appunti`);
    salvaFile(sotto, "mandato.md", testoMandato(r));
    seManca(sotto, "diario.md", `# Diario — ${r.nome}\n\nUna riga per turno, con data e ora: cosa hai guardato, cosa hai trovato, cosa hai proposto. Le righe vecchie di una settimana si riassumono in una.\n`);
    let comuni = "";
    if (r.semeBagaglio) { try { comuni = readFileSync(r.semeBagaglio, "utf8"); } catch (e) { console.error(`squadra, seme del bagaglio: ${e.message}`); } }
    const b = Bg.prepara(sotto, r, { mandatoLungo: mandatoLungo(r), capo: r.capo, chi, comuni });
    if (b.migrato || b.archivio) console.log(`squadra, ${r.slug}: imparato.md nel bagaglio (${b.migrato} voci), originale in ${relativo(b.archivio)}`);
  }
  // Il bagaglio in forma compatta (bagaglio.mjs); se il file non si legge, lo dice invece di fermare il turno
  function bagaglioDi(r) {
    try { return Bg.compatto(readFileSync(percorsoStato("squadra", r.slug, "bagaglio.md"), "utf8")); }
    catch (e) { return { testo: `(il bagaglio non si legge: ${e.message})`, oltre: false }; }
  }

  // ───── le sessioni dal file dei ruoli ─────
  function assicura() {
    const o = cockpit.orchestratore();
    for (const r of ruoli) {
      try {
        preparaCartella(r);
        let s = cockpit.trova(r.slug);
        if (s && s.ruolo !== "squadra") { console.error(`squadra: c'è già una sessione "${r.slug}" che non è della squadra: ruolo saltato`); continue; }
        const meta = { nome: r.nome, capo: r.capo, tipo: r.capo ? "esecutore" : "capo", colore: r.colori };
        const genitore = r.capo || o?.nome || "";
        if (!s) { cockpit.crea({ nome: r.slug, ruolo: "squadra", modello: r.modello, genitore, extra: { squadra: meta } }); continue; }
        s.squadra = meta; s.genitore = cockpit.trova(genitore)?.nome || "";
        const voluto = risolviModello(r.modello);
        if (voluto !== s.modello && voluto !== s.modelloPendente) cockpit.cambiaModello(s.id, voluto); // il modello lo decide il file dei ruoli
        cockpit.salva(); cockpit.emetti(s, { type: "cockpit_sessione" });
      } catch (e) { console.error(`squadra, ruolo ${r.slug}:`, e.message); }
    }
    togliOrfane();
  }
  // le sessioni della squadra il cui ruolo non è (più) nella squadra di questa persona: via dalla mappa
  function togliOrfane() {
    for (const s of cockpit.elenco()) {
      if (s.ruolo === "squadra" && !ruolo(s.nome) && !lavora(s)) { try { cockpit.rimuovi(s.id, { forza: true }); } catch { /* resta sulla mappa */ } }
    }
  }

  // le cartelle in più di un ruolo (--add-dir), solo quelle che esistono su questa macchina: un percorso che manca non ferma il processo
  const cartelleDi = (r) => r.cartelle.filter((c) => existsSync(c));
  const cartelle = (s) => { const r = ruolo(s.nome); return r ? cartelleDi(r) : []; };
  // il browser di un ruolo: vero o falso se il file dei ruoli lo dice, undefined = vale la config
  const chrome = (s) => ruolo(s.nome)?.chrome;
  // le regole di allow di un ruolo (--allowedTools): vuoto per chi non le dichiara e per le sessioni fuori dalla squadra
  const permessi = (s) => ruolo(s.nome)?.permessi || [];
  // il tetto degli usa e getta vivi di un ruolo (campo usaEGetta); 0 per una sessione che non è più nel file dei ruoli
  const tettoUsaEGetta = (s) => ruolo(s.nome)?.usaEGetta ?? 0;

  // ───── il prompt di un agente della squadra (prompt/squadra.md + frammenti dei moduli) ─────
  function prompt(s) {
    const r = ruolo(s.nome);
    if (!r) return componi("agente", cockpit.variabili({ nome: s.nome }), moduli);
    const capo = r.capo ? ruolo(r.capo) : null, esecutori = esecutoriDi(r.slug);
    const posto = capo
      ? `Sei un esecutore: il tuo capo è ${capo.nome} (@${capo.slug}). Lavori su ciò che ti chiede e sul tuo mandato, e gli riporti con un messaggio diretto.`
      : `Sei un capo${esecutori.length ? `: i tuoi esecutori sono ${esecutori.map((e) => `${e.nome} (@${e.slug})`).join(", ")}; li attivi con un messaggio diretto` : ", senza esecutori"}. Rispondi a ${chi}; ${assistente.nome} è l'advisor sopra tutta la squadra.`;
    const elenco = ruoli.map((x) => `- @${x.slug} — ${x.nome}${x.capo ? ` (esecutore di @${x.capo})` : " (capo)"}`).join("\n");
    const bg = bagaglioDi(r), extra = cartelleDi(r);
    try { const d = leggi(); agente(d, r.slug).bagaglio = Bg.impronta(bg.testo); salva(d); } catch { /* il prompt non si ferma per lo stato */ }
    return componi("squadra", cockpit.variabili({
      nome: r.slug, ruolo_nome: r.nome, posto, squadra_elenco: elenco, mandato: testoMandato(r).trim(), bagaglio: bg.testo,
      cartella: relativo(percorsoStato("squadra", r.slug)), cartella_squadra: relativo(percorsoStato("squadra")),
      intervallo: String(baseIntervallo(r, {})), messaggi_ora: String(regole.messaggiOra),
      autonomia: (r.autonomia === "operativo"
        ? "operativo: oltre alla tua cartella puoi scrivere nella cartella di lavoro dentro il tuo perimetro, con le regole di sempre"
        : "rodaggio: leggi, ti agganci alle fonti, scrivi solo nella tua cartella e proponi; fuori dalla tua cartella non modifichi niente")
        + (extra.length ? `. Cartelle in più del tuo ruolo, aperte a questa sessione oltre alla cartella di lavoro: ${extra.join(", ")}; ci lavori dentro il perimetro del tuo mandato` : ""),
    }), [...moduli, ...frammenti]);
  }

  // ───── le novità di un ruolo, con codice ─────
  function novita(r, a, adesso, segnaliOra) {
    const esecutori = esecutoriDi(r.slug).map((e) => e.slug);
    const tutti = B.perRuolo(r.slug, { dopo: a.letto || 0, esecutori, persona: persona.slug || "", capo: !r.capo, conoscenza: true });
    const messaggi = tutti.filter((m) => !m.conoscenza), conoscenza = tutti.filter((m) => m.conoscenza); // per conoscenza: nel turno, ma non sveglia
    const limite = adesso - VISTI_GIORNI * 86400000;
    a.visti = Object.fromEntries(Object.entries(a.visti || {}).filter(([, t]) => t > limite));
    const { tipi, aree } = r.segnali;
    const suoi = tipi.length ? segnaliOra().filter((x) => tipi.includes(x.tipo) && (!aree.length || x.area === undefined || aree.includes(x.area))) : [];
    return { messaggi, conoscenza, segnali: suoi.filter((x) => !a.visti[x.chiave]), fino: Math.max(a.letto || 0, ...tutti.map((m) => m.t)) };
  }

  const rigaMessaggio = (m) => `- ${m.dove === "dm" ? "diretto" : "bacheca"} · @${m.da}${m.conoscenza ? ` → @${m.a}` : ""} · ${new Date(m.t).toLocaleString("it-IT", { timeZone: cfg.fuso, dateStyle: "short", timeStyle: "short" })}: ${ritaglia(m)}`;
  // Un messaggio lungo non si perde a metà: oltre il tetto, il rimando al testo intero.
  const ritaglia = (m) => { const t = m.testo.replace(/\s+/g, " "); return t.length <= 2000 ? t : `${t.slice(0, 2000)}… [troncato: testo intero con ${m.dove === "dm" ? `ctl.mjs dm ${m.da}` : `ctl.mjs bacheca cerca`}]`; };
  // Ciò che il turno porta del bagaglio: tutto se è cambiato da quando l'agente l'ha visto, l'invito a compattare se è oltre
  // il tetto, e la regola dei feedback se fra i messaggi ce n'è uno della persona
  function bagaglioGiro(r, a, nov, bg) {
    const pezzi = [];
    if (Bg.impronta(bg.testo) !== a.bagaglio) pezzi.push(`Il tuo bagaglio è cambiato da quando l'hai letto; com'è adesso:\n${bg.testo}`);
    else if (bg.oltre) pezzi.push("Il tuo bagaglio è oltre il tetto o ha sezioni non previste: compattalo in questo turno.");
    if (persona.slug && nov.messaggi.some((m) => m.da === persona.slug)) pezzi.push(`Fra i messaggi ce n'è di ${chi}: se ti dà un feedback su come lavori (un sì, un no, una correzione, una preferenza), diventa una voce del bagaglio, con la data.`);
    return pezzi.length ? `\n\n${pezzi.join("\n\n")}` : "";
  }
  function testoGiro(r, nov, vuoto, adesso, bagaglio = "", delMattino = false, sveglia = "") {
    const ora = new Date(adesso).toLocaleString("it-IT", { timeZone: cfg.fuso, weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    return componi("squadra-giro", cockpit.variabili({
      nome: r.slug, quando: ora,
      motivo: delMattino
        ? `Giro del mattino: scrivi in bacheca il tuo contributo per la giornata di ${chi} (cosa è successo da quando sei passato l'ultima volta, cosa c'è da fare oggi, cosa chiedergli), come dice il tuo mandato${mattino.assistente ? `, prima delle ${mattino.assistente}` : ""}; poi avvisa ${assistente.nome} con \`${comandoCtl()} squadra advisor "…"\` in una riga.`
        : sveglia ? `Sveglia delle ${sveglia}: è l'ora del lavoro che il tuo mandato fissa per quest'ora.`
        : vuoto ? "Giro a vuoto: niente di nuovo da fuori, è il momento del tuo lavoro proprio (il mandato, il diario, le fonti)." : "C'è qualcosa di nuovo per te.",
      messaggi: (nov.messaggi.length ? `Messaggi (${nov.messaggi.length}):\n${nov.messaggi.slice(-20).map(rigaMessaggio).join("\n")}` : "Nessun messaggio nuovo.")
        + (nov.conoscenza?.length ? `\n\nPer conoscenza, i diretti dei tuoi esecutori ad altri (${nov.conoscenza.length}; non sono per te, non chiedono risposta):\n${nov.conoscenza.slice(-10).map(rigaMessaggio).join("\n")}` : ""),
      segnali: nov.segnali.length ? `Segnali del tuo dominio (${nov.segnali.length}):\n${nov.segnali.slice(0, 15).map((x) => `- [${x.tipo}] ${x.testo}`).join("\n")}` : "Nessun segnale nuovo.",
      bagaglio,
    }), moduli).trim();
  }

  // ───── il giro ─────
  let inCorso = false;
  function giro({ forza = "" } = {}) {
    if (inCorso) return { esito: "in corso" };
    inCorso = true;
    try {
      const d = leggi(), adesso = Date.now();
      if (!d.acceso && !forza) return { esito: "spenta" };
      try {
        const c = statoConsumo();
        if (c.cinque && c.cinque.u >= regole.consumoMax) {
          if (d.pausa !== c.cinque.reset) { d.pausa = c.cinque.reset; annota(d, { esito: "pausa", nota: `piano al ${c.cinque.u}% nella finestra di cinque ore` }); salva(d); annuncia("pausa"); }
          return { esito: "pausa" };
        }
      } catch { /* consumo non ancora letto */ }
      let cache = null;
      const segnaliOra = () => (cache ??= segnali.flatMap((f) => { try { return f(adesso) || []; } catch (e) { console.error("squadra, segnali:", e.message); return []; } }));
      const esiti = [];
      let avviati = 0;
      const mt = momentoMattino(cfg, mattino, adesso);
      if (!forza && mt?.ruoli && d.mattino?.giorno !== mt.giorno) { // il mattino di oggi: una volta sola, anche in ritardo fino a `fino`
        d.mattino = { giorno: mt.giorno, assistente: false };
        for (const slug of mattino.ruoli) agente(d, slug).mattino = mt.giorno;
        annota(d, { esito: "mattino", nota: `giro del mattino per ${mattino.ruoli.join(", ")}` });
      }
      const mattinoOggi = (a) => !!mt?.ruoli && a.mattino === mt.giorno;
      for (const r of ruoli) {
        if (forza && forza !== r.slug) continue;
        const a = agente(d, r.slug), s = cockpit.trova(r.slug);
        if (!s || s.ruolo !== "squadra" || (!forza && !accesoDi(r, a))) continue;
        if (a.mattino && !mattinoOggi(a)) delete a.mattino; // il mattino di un altro giorno, o passato `fino`: non si recupera
        const delMattino = mattinoOggi(a);
        const sv = delMattino ? null : svegliaDovuta(cfg, r.sveglie, adesso), allaSveglia = !!sv && a.svegliaUltima !== sv.chiave; // come il mattino: scavalca quiete e intervallo
        const intervallo = intervalloDi(r, a, adesso);
        if (intervallo === null && !forza && !delMattino && !allaSveglia) continue; // di notte dorme
        if (!forza && !a.sveglia && !delMattino && !allaSveglia && adesso - (a.ultimoGiro || 0) < intervallo * 60000) continue;
        if (occupato(cockpit, s)) { esiti.push({ ruolo: r.slug, esito: "occupato" }); continue; } // salta: riprova al giro dopo
        if (avviati >= 1) continue; // uno per giro: gli altri al prossimo, fra venti secondi
        a.ultimoGiro = adesso;
        const nov = novita(r, a, adesso, segnaliOra);
        const vuotoOgni = vuotoDi(r);
        const vuoto = !delMattino && !allaSveglia && !nov.messaggi.length && !nov.segnali.length && (!!forza || (vuotoOgni > 0 && adesso - (a.ultimoTurno || 0) >= vuotoOgni * 60000));
        a.sveglia = false;
        if (!delMattino && !allaSveglia && !nov.messaggi.length && !nov.segnali.length && !vuoto) { a.esito = "silenzio"; esiti.push({ ruolo: r.slug, esito: "silenzio" }); continue; }
        const nota = delMattino ? "giro del mattino" : allaSveglia ? `sveglia delle ${sv.ora}` : vuoto ? "risveglio a vuoto" : `risveglio: ${[nov.messaggi.length && `${nov.messaggi.length} messaggi`, nov.segnali.length && `${nov.segnali.length} segnali`].filter(Boolean).join(", ")}`;
        const bg = bagaglioDi(r);
        try {
          cockpit.invia(s.id, testoGiro(r, nov, vuoto, adesso, bagaglioGiro(r, a, nov, bg), delMattino, allaSveglia ? sv.ora : ""), { nota, mittente: "cockpit", origine: "squadra" });
        } catch (e) { a.esito = `errore: ${e.message}`; esiti.push({ ruolo: r.slug, esito: "errore" }); continue; }
        a.bagaglio = Bg.impronta(bg.testo);
        for (const x of nov.segnali) a.visti[x.chiave] = adesso;
        delete a.mattino;
        if (allaSveglia) a.svegliaUltima = sv.chiave;
        a.letto = nov.fino; a.ultimoTurno = adesso; a.esito = delMattino ? "mattino" : allaSveglia ? "sveglia" : vuoto ? "a vuoto" : "novità";
        annota(d, { ruolo: r.slug, esito: a.esito, nota });
        esiti.push({ ruolo: r.slug, esito: "turno", nota });
        avviati++;
      }
      if (!forza && mt?.assistente && d.mattino?.giorno === mt.giorno && !d.mattino.assistente && mattinoAssistente(d, mt.giorno)) avviati++;
      salva(d);
      if (avviati) annuncia("giro", { stato: stato() });
      return { esito: avviati ? "turno" : "silenzio", esiti };
    } finally { inCorso = false; }
  }

  // L'ora dell'assistente nel mattino: un turno [squadra] con le istruzioni della persona per comporre la giornata. Ad
  // assistente al lavoro si riprova al giro dopo; vero se il messaggio è partito.
  function mattinoAssistente(d, giorno) {
    const o = cockpit.orchestratore();
    if (!o || occupato(cockpit, o)) return false;
    let istruzioni = "";
    if (mattino.istruzioni) { try { istruzioni = readFileSync(mattino.istruzioni, "utf8").trim(); } catch (e) { istruzioni = `(le istruzioni del mattino non si leggono: ${e.message})`; } }
    const fatti = ruoli.filter((r) => mattino.ruoli.includes(r.slug)).map((r) => `- @${r.slug} — ${r.nome}: ${d.agenti[r.slug]?.mattino === giorno ? "giro del mattino non ancora partito" : "giro del mattino fatto"}`).join("\n");
    try {
      cockpit.invia(o.id, componi("squadra-mattino", cockpit.variabili({ giorno, ruoli_mattino: fatti, istruzioni: istruzioni || "Componi per la persona la giornata dai contributi: una cosa da fare adesso e la coda." }), moduli).trim(),
        { nota: "il mattino della squadra", mittente: "cockpit", origine: "squadra" });
    } catch (e) { console.error("squadra, mattino:", e.message); return false; }
    d.mattino.assistente = true;
    annota(d, { esito: "mattino", nota: `${assistente.nome}: componi la giornata` });
    return true;
  }

  function sveglia(slug) {
    if (!ruolo(slug)) return;
    const d = leggi(); agente(d, slug).sveglia = true; salva(d);
    setImmediate(() => { try { giro(); } catch (e) { console.error("squadra:", e.message); } });
  }

  // ───── stato e regolazioni ─────
  function stato() {
    const d = leggi(), adesso = Date.now();
    return {
      acceso: d.acceso, quiete: inQuiete(cfg, adesso), regole, registro: d.registro.slice(-20).reverse(),
      mattino: mattino ? { ...mattino, istruzioni: mattino.istruzioni ? relativo(mattino.istruzioni) : "", oggi: d.mattino || null } : null,
      // senza ruoli la pagina non mostra la squadra: solo l'invito a crearla, con dove la si definisce
      definita: ruoli.length > 0, persona: persona.slug || "", file: def.trovate.map((x) => relativo(x.file)), cercati: def.cercati.map(relativo),
      ruoli: ruoli.map((r) => {
        const a = d.agenti[r.slug] || {}, s = cockpit.trova(r.slug), intervallo = intervalloDi(r, a, adesso);
        return {
          slug: r.slug, nome: r.nome, capo: r.capo, tipo: r.capo ? "esecutore" : "capo", colore: r.colori, mandato: r.mandato, metrica: r.metrica,
          modello: nomeModello(risolviModello(r.modello)), perche: r.perche, autonomia: r.autonomia, acceso: accesoDi(r, a),
          intervalloMinuti: baseIntervallo(r, a), intervalloOra: intervallo, vuotoOgniMinuti: vuotoDi(r),
          ultimoGiro: a.ultimoGiro || 0, ultimoTurno: a.ultimoTurno || 0, esito: a.esito || "", sveglie: r.sveglie,
          prossimo: d.acceso && accesoDi(r, a) && intervallo ? (a.ultimoGiro || adesso) + intervallo * 60000 : 0,
          sessione: s?.ruolo === "squadra" ? s.id : "", stato: s?.ruolo === "squadra" ? s.stato : "",
        };
      }),
    };
  }

  const vero = (v) => v === true || v === "true" || v === "on" || v === 1;
  function imposta(c = {}) {
    const d = leggi();
    if (c.ruolo) {
      const r = ruolo(String(c.ruolo).toLowerCase());
      if (!r) throw new Error(`nessun ruolo "${c.ruolo}" (${ruoli.map((x) => x.slug).join(", ")})`);
      const a = agente(d, r.slug);
      if (c.acceso !== undefined) a.acceso = vero(c.acceso);
      if (c.intervalloMinuti !== undefined) {
        if (c.intervalloMinuti === null || c.intervalloMinuti === "") delete a.intervalloMinuti;
        else {
          const n = Number(c.intervalloMinuti);
          if (!Number.isInteger(n) || n < 1 || n > 1440) throw new Error("intervallo: minuti interi da 1 a 1440");
          a.intervalloMinuti = n;
        }
      }
    } else if (c.acceso !== undefined) {
      if (vero(c.acceso) && !ruoli.length) throw new Error(`nessuna squadra per questa persona: la si definisce in ${def.cercati.map(relativo).join(" o ") || "un modulo con il campo squadra"}`);
      d.acceso = vero(c.acceso);
    }
    salva(d);
    if (c.acceso !== undefined && !vero(c.acceso)) chiudiSpenti(c.ruolo ? [String(c.ruolo).toLowerCase()] : ruoli.map((x) => x.slug));
    if (d.acceso) assicura();
    const st = stato();
    annuncia("imposta", { stato: st });
    return st;
  }

  // ───── bacheca, messaggi diretti, advisor ─────
  function chiScrive(sessione) {
    if (!sessione) return { slug: persona.slug || "persona", tipo: "persona" };
    const s = cockpit.trova(sessione);
    if (!s) throw new Error(`sessione sconosciuta: ${sessione}`);
    if (s.ruolo === "orchestratore") return { slug: assistente.slug, tipo: "assistente", s };
    if (s.ruolo === "squadra" && ruolo(s.nome)) return { slug: s.nome, tipo: "squadra", s };
    throw new Error("la bacheca è della squadra: scrivono i suoi agenti, l'assistente e la persona");
  }
  function limite(c) {
    if (c.tipo !== "squadra") return;
    if (B.contaOra(c.slug) >= regole.messaggiOra) throw new Error(`limite di ${regole.messaggiOra} messaggi l'ora raggiunto: metti insieme quello che hai da dire in un messaggio solo, più tardi`);
  }
  const eAssistente = (x) => [assistente.slug, assistente.nome.toLowerCase(), ...assistente.alias.map((y) => y.toLowerCase())].includes(String(x || "").toLowerCase());

  function scriviBacheca({ sessione, testo }) {
    const c = chiScrive(sessione);
    limite(c);
    const m = B.scrivi({ da: c.slug, testo, noti: ruoli.map((r) => r.slug) });
    const destinatari = new Set(m.menzioni);
    const mio = ruolo(c.slug);
    if (mio?.capo) destinatari.add(mio.capo); // un esecutore che scrive in bacheca: lo legge il suo capo
    if (c.tipo === "persona" && !m.menzioni.length) ruoli.filter((r) => !r.capo).forEach((r) => destinatari.add(r.slug));
    destinatari.delete(c.slug);
    for (const x of destinatari) sveglia(x);
    annuncia("bacheca", { messaggio: m });
    return m;
  }

  function advisor({ sessione, testo }) {
    const c = chiScrive(sessione);
    if (c.tipo !== "squadra") throw new Error(`a ${assistente.nome} come advisor scrive un agente della squadra`);
    limite(c);
    const m = B.scriviDm({ da: c.slug, a: assistente.slug, testo });
    const o = cockpit.orchestratore();
    if (o) {
      const r = ruolo(c.slug);
      cockpit.invia(o.id, componi("squadra-advisor", cockpit.variabili({ ruolo_nome: r.nome, nome: r.slug, testo: m.testo }), moduli).trim(),
        { nota: `${r.slug} ti scrive`, mittente: r.slug, origine: "squadra" });
    }
    annuncia("dm", { messaggio: m });
    return m;
  }

  function dm({ sessione, a, testo }) {
    if (eAssistente(a)) return advisor({ sessione, testo });
    const c = chiScrive(sessione);
    if (c.tipo === "persona") throw new Error("la persona scrive a un agente nella sua chat o in bacheca con @ruolo");
    const verso = String(a || "").toLowerCase().replace(/^@/, "");
    if (!ruolo(verso)) throw new Error(`nessun ruolo "${a}" nella squadra (${ruoli.map((r) => r.slug).join(", ")})`);
    limite(c);
    const m = B.scriviDm({ da: c.slug, a: verso, testo });
    sveglia(verso);
    annuncia("dm", { messaggio: m });
    return m;
  }

  // ───── avvio ─────
  function avvia() {
    if (leggi().acceso) assicura();
    else if (persona.slug) togliOrfane(); // spenta o senza squadra: le sessioni di ruoli che non sono di questa persona si tolgono lo stesso
    if (process.env.COCKPIT_PROVA === "1") return null;
    const tic = () => { try { giro(); } catch (e) { console.error("squadra:", e.message); } };
    setTimeout(tic, 5000).unref();
    return setInterval(tic, GIRO_MS).unref();
  }

  // i colori dei ruoli per la pagina, anche a squadra spenta: slug → { nome, capo, volto, scuro, chiaro }
  const colori = () => Object.fromEntries(ruoli.map((r) => [r.slug, { nome: r.nome, capo: r.capo, volto: r.volto, ...r.colori }]));

  return { ruoli, ruolo, mattino, stato, colori, imposta, assicura, giro, avvia, prompt, cartelle, chrome, permessi, tettoUsaEGetta, scriviBacheca, dm, advisor, sveglia, ctl: comandoCtl() };
}
