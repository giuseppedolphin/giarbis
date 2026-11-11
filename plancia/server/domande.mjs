// Le domande alla persona: ogni volta che l'assistente, un agente o un agente di foglio chiede qualcosa, lo fa con
// `ctl.mjs domanda`, e la domanda finisce in una casella sola, «Da decidere» (barra in alto, segno «?» sulla sfera, riquadro
// in chat). La risposta data dalla casella torna alla sessione come messaggio; a un agente della squadra solo a turno chiuso
// (un sì arrivato a metà turno il classificatore non lo conta come richiesta), tutte insieme in un messaggio solo,
// col campo `daConsegnare` sulla domanda finché aspetta. Anche le proposte del battito sono domande
// (tipo «proposta», con Sì / No / Più tardi): battito.mjs le crea e le legge da qui, con la forma di prima per /api/proposte.
//
// Tipi: «domanda» (dal comando) · «proposta» (dal battito, ctl.mjs propone) · «testo» (un turno finito con una domanda che
// la sessione non ha registrato: in casella in grigio, senza pulsanti).
// Stati: aperta · rimandata (solo proposte, «Più tardi»: torna aperta al battito dopo) · risposta · ritirata · ignorata
// (solo proposte, senza risposta per un giorno).
//
// Stato (stato.mjs): domande.json = { domande: [...], contatori: {...}, impostazioni: { chiudeConChat } }. Si tengono le
// aperte e le ultime CHIUSE_MAX chiuse; i contatori sono a parte, così non si perdono quando le vecchie escono.
//
//   collega({ cockpit, persona, trasmetti, fogli })  → il server lo chiama all'avvio
//   nuova(c) · rispondi(id, risposta, come) · ritira(id) · rimanda(id) · elenco({ tutte, sessione })
//   dalTesto(s, { testo, origine, inizio })   → a fine turno (sessioni.mjs, onFineTurno); consegna anche le risposte in attesa
//   consegnaPendenti(s?)                       → le risposte in attesa di s (o di tutte le sessioni ferme: all'avvio, dopo un compact)
//   messaggioPersona(s)                        → un messaggio della persona a una sessione: chiude le «prese dal testo» (tutte,
//                                                 con l'impostazione accesa) e torna la nota per il modello sulle altre aperte
//   sessioneRimossa(id) · impostazioni(c)
import { randomUUID } from "node:crypto";
import { negozio } from "./stato.mjs";
import { comandoCtl } from "./config.mjs";
import { occupato } from "./squadra.mjs";

export const LIMITI = { testo: 200, proposta: 400, opzioni: 4, opzione: 30, libera: 4000, aperte: 3, contesto: 400, righeContesto: 3 };
const CHIUSE_MAX = 300;
const IGNORATA_DOPO = 24 * 3600000; // una proposta senza risposta per un giorno è ignorata
const OPZIONI_PROPOSTA = ["Sì", "No", "Più tardi"];
const RISPOSTA_PROPOSTA = { si: "Sì", no: "No", dopo: "Più tardi" };

let ctx = { cockpit: null, persona: {}, trasmetti: () => {}, fogli: null };
export function collega(c = {}) { ctx = { ...ctx, ...c }; }

const archivio = () => negozio("domande", { base: { domande: [], contatori: {}, impostazioni: {} } });
const BASE_CONTATORI = { fatte: 0, risposte: 0, ritirate: 0, ignorate: 0, dalTesto: 0, inChat: 0, proposte: { fatte: 0, accettate: 0, rifiutate: 0, ignorate: 0 } };
function leggi() {
  const d = archivio().leggi();
  return {
    domande: Array.isArray(d.domande) ? d.domande : [],
    contatori: { ...BASE_CONTATORI, ...(d.contatori || {}), proposte: { ...BASE_CONTATORI.proposte, ...(d.contatori?.proposte || {}) } },
    impostazioni: { chiudeConChat: false, ...(d.impostazioni || {}) },
  };
}
function salva(d) {
  const aperte = d.domande.filter(aperta), chiuse = d.domande.filter((x) => !aperta(x)).slice(-CHIUSE_MAX);
  d.domande = [...chiuse, ...aperte].sort((a, b) => a.creata.localeCompare(b.creata));
  archivio().scrivi(d);
}

export const aperta = (q) => q.stato === "aperta" || q.stato === "rimandata";
const pulisci = (t, max) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, max);
// La risposta della persona: mai accorciata e con i suoi a capo, tolti solo gli spazi doppi e le righe vuote di troppo.
const testoRisposta = (t) => String(t ?? "").replace(/\r\n?/g, "\n").replace(/[^\S\n]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
const ora = () => new Date().toISOString();
// Il «Perché te lo chiedo» scritto da chi chiede: fino a tre righe (da dove arriva,
// cosa è già verificato, cosa succede con ciascuna risposta), 400 battute in tutto; gli a capo si tengono, il resto si ripulisce.
// Anche «\n» scritto alla lettera sulla riga di comando vale come a capo.
export function pulisciContesto(t) {
  const righe = String(t ?? "").replace(/\r\n?/g, "\n").replace(/\\n/g, "\n").split("\n")
    .map((r) => r.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (righe.length > LIMITI.righeContesto) righe.splice(LIMITI.righeContesto - 1, righe.length, righe.slice(LIMITI.righeContesto - 1).join(" "));
  return righe.join("\n").slice(0, LIMITI.contesto).trim();
}

// lo stato intero per la pagina e per ctl: le aperte (urgenti in testa, poi dalla più vecchia), le ultime chiuse, i contatori
export function elenco({ tutte = false, sessione = "" } = {}) {
  scadi();
  const d = leggi();
  let lista = d.domande;
  if (sessione) lista = lista.filter((q) => q.da.sessione === sessione || q.da.nome === sessione);
  const aperte = lista.filter((q) => q.stato === "aperta")
    .sort((a, b) => (b.urgente - a.urgente) || a.creata.localeCompare(b.creata));
  const rimandate = lista.filter((q) => q.stato === "rimandata");
  const chiuse = lista.filter((q) => !aperta(q)).sort((a, b) => String(b.chiusa).localeCompare(String(a.chiusa))).slice(0, tutte ? 50 : 20);
  return { aperte, rimandate, chiuse, contatori: d.contatori, impostazioni: d.impostazioni, limiti: { libera: LIMITI.libera } }; // il tetto della risposta a parole: la pagina lo legge da qui
}

function annuncia(azione, domanda) {
  const { aperte, rimandate, contatori, impostazioni } = elenco();
  try { ctx.trasmetti({ type: "cockpit_domande", azione, domanda, aperte, rimandate, contatori, impostazioni }); } catch (e) { console.error("domande:", e.message); }
}

// chi chiede: la sessione (COCKPIT_SESSIONE, passata da ctl come `sessione`), altrimenti il terminale
function chiChiede(chiave) {
  const s = chiave && ctx.cockpit ? ctx.cockpit.trova(chiave) : null;
  if (s) return { s, da: { sessione: s.id, nome: s.nome, ruolo: s.ruolo } };
  return { s: null, da: { sessione: "", nome: chiave ? pulisci(chiave, 40) : "terminale", ruolo: "terminale" } };
}

// il contesto in una riga (140 battute), se chi chiede non lo dice: il passo dell'anello, il titolo del foglio, l'inizio del compito
function contestoDi(s) {
  if (!s) return "";
  if (s.progresso?.passo) return `passo «${s.progresso.passo}»`;
  if (s.ruolo === "foglio" && s.foglio && ctx.fogli) { const f = ctx.fogli.trova(s.foglio); if (f) return `foglio «${f.titolo}»`; }
  try {
    const primo = ctx.cockpit.eventi(s.id).find((e) => e.type === "cockpit_utente" && !e.nota && e.testo);
    if (primo) return `compito: ${pulisci(primo.testo, 131)}`;
  } catch { /* senza eventi: niente contesto */ }
  return "";
}

// il contesto scritto da chi chiede; senza, quello ricavato (una riga), segnato `contestoRicavato` perché la pagina lo dica
function contestoNuovo(scritto, s, tipo) {
  const c = pulisciContesto(scritto);
  if (c) return { contesto: c };
  const r = contestoDi(s);
  return r ? { contesto: r, contestoRicavato: tipo === "domanda" } : { contesto: "" };
}

function opzioniDi(o) {
  const lista = (Array.isArray(o) ? o : String(o ?? "").split("|")).map((x) => pulisci(x, 200)).filter(Boolean);
  if (lista.length > LIMITI.opzioni) throw new Error(`al massimo ${LIMITI.opzioni} opzioni`);
  for (const x of lista) if (x.length > LIMITI.opzione) throw new Error(`opzione troppo lunga (massimo ${LIMITI.opzione} battute): «${x}»`);
  return [...new Set(lista)];
}

// Una domanda nuova. c = { testo, opzioni, urgente, foglio, contesto, sessione, tipo, perche, battito }
export function nuova(c = {}) {
  const tipo = ["domanda", "proposta", "testo"].includes(c.tipo) ? c.tipo : "domanda";
  const grezzo = String(c.testo ?? "").replace(/\s+/g, " ").trim();
  if (!grezzo) throw new Error("serve il testo della domanda");
  const max = tipo === "proposta" ? LIMITI.proposta : tipo === "testo" ? 300 : LIMITI.testo;
  if (tipo === "domanda" && grezzo.length > max) throw new Error(`una domanda, frase breve: massimo ${max} battute (sono ${grezzo.length})`);
  const { s, da } = chiChiede(c.sessione);
  if (s?.usaEGetta) throw new Error(`${s.nome} è un agente usa e getta: non fa domande alla persona, porta la scelta a chi l'ha creato nella sua risposta`);
  const d = leggi();
  if (tipo === "domanda" && s) {
    const sue = d.domande.filter((q) => q.tipo === "domanda" && q.stato === "aperta" && q.da.sessione === s.id);
    if (sue.length >= LIMITI.aperte) {
      throw new Error(`hai già ${sue.length} domande aperte (${sue.map((q) => q.id).join(", ")}): aspetta una risposta o ritirane una con «domande ritira <id>»`);
    }
  }
  const foglio = pulisci(c.foglio, 40);
  if (foglio && ctx.fogli && !ctx.fogli.trova(foglio)) throw new Error(`nessun foglio "${foglio}"`);
  const q = {
    id: `d-${randomUUID().slice(0, 6)}`, tipo, da, testo: grezzo.slice(0, max),
    opzioni: tipo === "proposta" ? [...OPZIONI_PROPOSTA] : tipo === "testo" ? [] : opzioniDi(c.opzioni),
    urgente: !!c.urgente && c.urgente !== "false", foglio, ...contestoNuovo(c.contesto, s, tipo),
    perche: pulisci(c.perche, 200), battito: c.battito || "", creata: ora(), stato: "aperta", risposta: "", come: "", chiusa: "",
  };
  d.domande.push(q);
  d.contatori.fatte++;
  if (tipo === "testo") d.contatori.dalTesto++;
  if (tipo === "proposta") d.contatori.proposte.fatte++;
  salva(d);
  annuncia("nuova", q);
  return q;
}

function trovaAperta(d, id) {
  const q = d.domande.find((x) => x.id === id);
  if (!q) throw new Error(`nessuna domanda "${id}"`);
  if (!aperta(q)) throw new Error(`la domanda ha già una risposta (${q.stato}${q.risposta ? `: ${q.risposta}` : ""})`);
  return q;
}

// La risposta della persona. Per una proposta vale «si» | «no» | «dopo» (o le etichette Sì / No / Più tardi).
export function rispondi(id, risposta, come = "") {
  const d = leggi(), q = trovaAperta(d, id);
  let r = testoRisposta(risposta);
  if (!r) throw new Error("serve la risposta");
  if (r.length > LIMITI.libera) throw new Error(`risposta troppo lunga: ${r.length} battute, il massimo è ${LIMITI.libera}. Non è arrivata: accorciala.`);
  if (q.tipo === "proposta") {
    const k = { si: "si", sì: "si", no: "no", dopo: "dopo", "più tardi": "dopo", "piu tardi": "dopo" }[r.toLowerCase()];
    if (!k) throw new Error("risposta a una proposta: Sì, No o Più tardi");
    if (k === "dopo") return rimanda(id);
    r = RISPOSTA_PROPOSTA[k];
    d.contatori.proposte[k === "si" ? "accettate" : "rifiutate"]++;
  }
  q.stato = "risposta"; q.risposta = r; q.chiusa = ora();
  q.come = come === "libera" || !q.opzioni.includes(r) ? "libera" : "opzione";
  d.contatori.risposte++;
  // a un agente della squadra al lavoro la risposta aspetta il turno chiuso: domande.json è la coda, regge un riavvio
  const s = q.tipo !== "proposta" && q.da.sessione && ctx.cockpit ? ctx.cockpit.trova(q.da.sessione) : null;
  if (s?.ruolo === "squadra" && occupato(ctx.cockpit, s)) q.daConsegnare = true;
  // la risposta a un esecutore arriva anche al suo capo: una volta sola, a chi non lavora; il capo si legge dalla sessione
  const capo = q.tipo !== "proposta" && s?.squadra?.tipo === "esecutore" ? s.squadra.capo : "";
  if (capo && ctx.cockpit.trova(capo)) q.capoDaAvvisare = capo;
  salva(d);
  if (!q.daConsegnare) recapita(q);
  if (q.capoDaAvvisare) consegnaCapi();
  annuncia("risposta", q);
  return q;
}

// la risposta torna a chi ha chiesto, come messaggio; per le proposte, i messaggi di sempre all'assistente
function recapita(q) {
  const { cockpit, persona } = ctx;
  if (!cockpit) return;
  const chi = persona?.nome || "chi usa la plancia";
  try {
    if (q.tipo === "proposta") {
      const o = cockpit.orchestratore();
      if (!o) return;
      if (q.risposta === "Sì") {
        cockpit.invia(o.id, `[proposta] Sì a «${q.testo}». Eseguila adesso con le regole di sempre: proponi e prepara; `
          + "niente che esce dalla cartella di lavoro (mail, messaggi, pubblicazioni) e niente commit senza un altro sì esplicito. "
          + "Se è lunga, affidala a un agente.", { nota: "proposta accettata", mittente: "cockpit" });
      } else {
        cockpit.invia(o.id, `[proposta] No a «${q.testo}». Non fare niente: prendine nota per le prossime proposte e chiudi il turno con una parola.`,
          { nota: "proposta rifiutata", mittente: "cockpit", origine: "battito" });
      }
      return;
    }
    const s = q.da.sessione && cockpit.trova(q.da.sessione);
    if (!s) return;
    cockpit.invia(s.id, rigaRisposta(q, chi),
      { nota: `${chi}: «${q.risposta}» a «${pulisci(q.testo, 80)}»`, mittente: persona?.slug || "tu", origine: "domanda" });
  } catch (e) { console.error("domande, risposta non recapitata:", e.message); }
}
// Ai capi le risposte date ai loro esecutori, in un messaggio solo per capo (un capo non si sveglia due volte per le stesse risposte);
// a un capo che sta lavorando aspettano il turno chiuso, come per gli esecutori.
function consegnaCapi(sessione = null) {
  const { cockpit, persona } = ctx;
  if (!cockpit) return 0;
  const d = leggi(), chi = persona?.nome || "chi usa la plancia", perCapo = new Map();
  let cambiato = false;
  for (const q of d.domande.filter((x) => x.capoDaAvvisare)) {
    const c = cockpit.trova(q.capoDaAvvisare);
    if (!c) { delete q.capoDaAvvisare; cambiato = true; continue; }
    if ((sessione && c.id !== sessione.id) || occupato(cockpit, c)) continue;
    if (!perCapo.has(c.id)) perCapo.set(c.id, []);
    perCapo.get(c.id).push(q);
  }
  let n = 0;
  for (const [id, lista] of perCapo) {
    lista.sort((a, b) => String(a.chiusa).localeCompare(String(b.chiusa)));
    for (const q of lista) delete q.capoDaAvvisare;
    cambiato = true;
    const testo = lista.map((q) => `[domanda] ${chi} ha risposto a @${q.da.nome} su «${q.testo}» (${q.id}): ${q.risposta}`).join("\n");
    try { cockpit.invia(id, testo, { nota: lista.length === 1 ? `${chi} ha risposto a @${lista[0].da.nome}` : `${chi} ha risposto a ${lista.length} domande dei tuoi esecutori`, mittente: persona?.slug || "tu", origine: "domanda" }); n += lista.length; }
    catch (e) { console.error("domande, risposta al capo non recapitata:", e.message); }
  }
  if (cambiato) salva(d);
  return n;
}
const rigaRisposta = (q, chi) => `[domanda] ${chi} risponde a «${q.testo}» (${q.id}): ${q.risposta}`;

// Le risposte in attesa di una sessione ferma, in un messaggio solo (due invii di fila porterebbero il secondo dentro il
// turno appena aperto, lo stesso difetto). Senza sessione: tutte quelle ferme. Una sessione che non c'è più: si perdono.
export function consegnaPendenti(sessione = null) {
  const { cockpit, persona } = ctx;
  if (!cockpit) return 0;
  consegnaCapi(sessione); // le risposte date ai loro esecutori, ai capi fermi
  const d = leggi();
  const pendenti = d.domande.filter((q) => q.daConsegnare && (!sessione || q.da.sessione === sessione.id));
  if (!pendenti.length) return 0;
  const chi = persona?.nome || "chi usa la plancia";
  const perSessione = new Map();
  for (const q of pendenti) {
    const s = cockpit.trova(q.da.sessione);
    if (!s) { q.daConsegnare = false; continue; }
    if (occupato(cockpit, s)) continue;
    if (!perSessione.has(s.id)) perSessione.set(s.id, []);
    perSessione.get(s.id).push(q);
  }
  let n = 0;
  for (const [id, lista] of perSessione) {
    lista.sort((a, b) => String(a.chiusa).localeCompare(String(b.chiusa)));
    for (const q of lista) q.daConsegnare = false;
    const nota = lista.length === 1 ? `${chi}: «${lista[0].risposta}» a «${pulisci(lista[0].testo, 80)}»` : `${chi}: ${lista.length} risposte alle domande`;
    try {
      cockpit.invia(id, lista.map((q) => rigaRisposta(q, chi)).join("\n"), { nota, mittente: persona?.slug || "tu", origine: "domanda" });
      n += lista.length;
    } catch (e) { console.error("domande, risposte non recapitate:", e.message); }
  }
  salva(d);
  return n;
}

// Chi ha chiesto non ne ha più bisogno (o la persona la toglie dalla casella): chiusa senza messaggi.
export function ritira(id, { da = "" } = {}) {
  const d = leggi(), q = trovaAperta(d, id);
  if (da && q.da.nome !== da && q.da.sessione !== da && ctx.cockpit?.trova(da)?.id !== q.da.sessione) throw new Error(`la domanda ${id} non è tua`);
  q.stato = "ritirata"; q.chiusa = ora();
  d.contatori.ritirate++;
  salva(d);
  annuncia("ritirata", q);
  return q;
}

// «Più tardi» (solo proposte): esce dalla vista e torna aperta al battito dopo, senza modello.
export function rimanda(id) {
  const d = leggi(), q = trovaAperta(d, id);
  if (q.tipo !== "proposta") throw new Error("solo una proposta si rimanda");
  q.stato = "rimandata";
  salva(d);
  annuncia("rimandata", q);
  return q;
}

// al battito: la proposta rimandata torna in vista (con l'ora di adesso)
export function riprendiRimandata() {
  const d = leggi(), q = d.domande.find((x) => x.tipo === "proposta" && x.stato === "rimandata");
  if (!q) return null;
  q.stato = "aperta"; q.creata = ora();
  salva(d);
  annuncia("ripresa", q);
  return q;
}

// le proposte senza risposta da più di un giorno diventano ignorate
export function scadi(adesso = Date.now()) {
  const d = leggi(); let n = 0;
  for (const q of d.domande) {
    if (q.tipo === "proposta" && q.stato === "aperta" && adesso - Date.parse(q.creata) > IGNORATA_DOPO) {
      q.stato = "ignorata"; q.chiusa = new Date(adesso).toISOString(); n++;
      d.contatori.ignorate++; d.contatori.proposte.ignorate++;
    }
  }
  if (n) salva(d);
  return n;
}

// ---- dal testo, dalla chat, dalla mappa -----------------------------------------------------------
// l'ultima frase di un testo markdown, ripulita (la stessa idea dei fumetti della pagina)
export function ultimaFrase(md) {
  const righe = String(md || "").replace(/```[\s\S]*?(```|$)/g, " ").split("\n")
    .filter((r) => !/^\s*(#{1,6}\s|\||[-:| ]{3,}$|>?\s*$)/.test(r))
    .map((r) => r.replace(/^\s*(>\s*)?([-*+]|\d+[.)])\s+/, ""));
  const t = righe.join(" ").replace(/`([^`]*)`/g, "$1").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|\*|_|~~)(\S[\s\S]*?\S|\S)\1/g, "$2").replace(/[`*#|]/g, "").replace(/\s+/g, " ").trim();
  return t.split(/(?<=[.!?])\s+/).filter(Boolean).pop() || "";
}

// A fine turno: se l'ultima frase è una domanda e la sessione in questo turno non ne ha registrate, la si mette in casella
// come «presa dal testo». Mai per i turni del battito né per i messaggi automatici.
// Poi, a turno chiuso, le risposte in attesa.
export function dalTesto(s, info = {}) {
  const q = domandaDalTesto(s, info);
  if (s) { try { consegnaPendenti(s); } catch (e) { console.error("domande, consegna a fine turno:", e.message); } }
  return q;
}
function domandaDalTesto(s, { testo = "", origine = "", inizio = 0 } = {}) {
  if (!s || !["agente", "foglio", "orchestratore"].includes(s.ruolo)) return null;
  if (s.usaEGetta) return null; // l'usa e getta di un ruolo della squadra non chiede alla persona: risponde a chi l'ha creato
  if (origine === "battito" || origine === "sistema") return null;
  const frase = ultimaFrase(testo);
  if (!/\?\s*$/.test(frase)) return null;
  const d = leggi();
  const registrata = d.domande.some((q) => q.da.sessione === s.id && Date.parse(q.creata) >= inizio - 1000);
  if (registrata) return null;
  try { return nuova({ tipo: "testo", testo: frase, sessione: s.id }); } catch (e) { console.error("domande dal testo:", e.message); return null; }
}

// Un messaggio della persona a una sessione («risposta in chat»). Le domande prese dal testo si chiudono sempre: sono l'ultima
// frase della chat, senza pulsanti, e la persona risponde lì; l'agente non le ha registrate e non ne conosce l'id. Quelle
// registrate si chiudono solo con l'interruttore acceso, perché un messaggio in chat spesso parla d'altro; se restano aperte,
// torna una nota per il modello con id e testo, così chi ha chiesto le ritira se la risposta è quella, senza doverle cercare.
// → { chiuse, nota }: la nota va solo nel testo per il modello, mai nell'evento della chat.
export function messaggioPersona(s) {
  if (!s) return { chiuse: 0, nota: "" };
  const d = leggi();
  const sue = d.domande.filter((q) => q.stato === "aperta" && q.tipo !== "proposta" && q.da.sessione === s.id);
  const chiuse = sue.filter((q) => d.impostazioni.chiudeConChat || q.tipo === "testo");
  for (const q of chiuse) { q.stato = "risposta"; q.risposta = "risposta in chat"; q.come = "chat"; q.chiusa = ora(); d.contatori.risposte++; d.contatori.inChat++; }
  if (chiuse.length) { salva(d); for (const q of chiuse) annuncia("risposta", q); }
  const restano = sue.filter((q) => !chiuse.includes(q));
  const nota = restano.length
    ? `[cockpit] Nella casella «Da decidere» hai ancora ${restano.length === 1 ? "questa domanda aperta" : `${restano.length} domande aperte`}: `
      + `${restano.map((q) => `${q.id} «${q.testo}»`).join(" · ")}. Se questo messaggio risponde a una di loro, come prima cosa la ritiri con `
      + `\`${comandoCtl()} domande ritira <id>\`; se parla d'altro, restano aperte.`
    : "";
  return { chiuse: chiuse.length, nota };
}

// La sessione non c'è più: le sue domande aperte non hanno più a chi tornare.
export function sessioneRimossa(id) {
  const d = leggi();
  const sue = d.domande.filter((q) => aperta(q) && q.tipo !== "proposta" && q.da.sessione === id);
  for (const q of sue) { q.stato = "ritirata"; q.chiusa = ora(); q.risposta = "sessione rimossa"; d.contatori.ritirate++; }
  const pendenti = d.domande.filter((q) => q.daConsegnare && q.da.sessione === id); // risposte che non hanno più a chi arrivare
  for (const q of pendenti) q.daConsegnare = false;
  if (!sue.length && !pendenti.length) return 0;
  salva(d);
  for (const q of sue) annuncia("ritirata", q);
  return sue.length;
}

export function impostazioni(c = {}) {
  const d = leggi();
  if (c.chiudeConChat !== undefined) d.impostazioni.chiudeConChat = c.chiudeConChat === true || c.chiudeConChat === "true" || c.chiudeConChat === "on";
  salva(d);
  annuncia("impostazioni", null);
  return d.impostazioni;
}

// ---- le proposte, con la forma di prima (battito.mjs, /api/proposte, ctl.mjs proposte) ------------------------------
const STATO_PROPOSTA = { aperta: "attesa", rimandata: "dopo", ignorata: "ignorata", ritirata: "no" };
export function comeProposta(q) {
  if (!q) return null;
  const stato = q.stato === "risposta" ? (q.risposta === "Sì" ? "si" : "no") : STATO_PROPOSTA[q.stato] || q.stato;
  return { id: q.id, testo: q.testo, perche: q.perche, urgente: q.urgente, battito: q.battito, creata: q.creata, stato, risposta: q.chiusa || null };
}
export function proposte() {
  scadi();
  const d = leggi(), lista = d.domande.filter((q) => q.tipo === "proposta");
  const attuale = [...lista].reverse().find((q) => q.stato === "aperta") || [...lista].reverse().find((q) => q.stato === "rimandata") || null;
  const c = d.contatori.proposte;
  return {
    lista: lista.map(comeProposta),
    attuale: comeProposta(attuale),
    contatori: { fatte: c.fatte, accettate: c.accettate, rifiutate: c.rifiutate, ignorate: c.ignorate, inAttesa: lista.filter(aperta).length },
  };
}
