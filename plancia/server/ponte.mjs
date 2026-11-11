// Il ponte fra le plance (spec interna): un filo di messaggi fra l'assistente di questa plancia e
// quello di ogni altra persona della config col ponte acceso, su una coda durevole che porta un
// modulo. Il nucleo non sa dove sta la coda: un modulo offre il trasporto col campo `ponte(ctx)` di modulo.mjs, un oggetto con
//   nonLetti(persona) → [messaggio] · segnaLetti([id]) · scrivi({ mittente, destinatario, via, testo, tipo, urgente, risposta_a })
//   → messaggio · filo(a, b, n) → [messaggio], i più recenti in fondo · messaggio(id)? → messaggio o null (facoltativo: senza, il
//   numero di una risposta si cerca nei fili)
// messaggio = { id, creato, mittente, destinatario, via, testo, tipo, urgente, risposta_a, thread, letto_il }. Un errore del
// trasporto col campo `nonDisponibile` (o qualunque errore) rende il ponte «non disponibile», col motivo: niente turni, niente
// eccezioni a chi chiede.
//
// Il controllo è uno scheduler del server, come la squadra: ogni `ponte.intervalloMinuti` della config si chiedono i non letti
// della persona; un messaggio nuovo arriva all'assistente come turno [ponte] solo quando l'assistente è fermo (`occupato` della
// squadra), poi si segna letto. Fra un controllo e l'altro, ogni 20 secondi, si riprova la consegna di ciò che aspetta.
// Con COCKPIT_PROVA=1 lo scheduler non parte (il controllo si lancia a mano, POST /api/ponte/controlla).
//
// Stato (stato.mjs): ponte.json = { ultimoControllo, esito, consegnati: { id: t }, daSegnare: [id] }.
//
// Con più fili chi scrive dice a chi (`a`, lo slug); una risposta va da sola nel filo del messaggio a cui risponde; senza `a`,
// con una sola altra persona, si scrive a lei come prima. Un messaggio di una persona che non è fra le altre di questa plancia
// resta non letto sulla coda (lo consegna la plancia giusta, o questa quando avrà il filo).
//
//   creaPonte({ cfg, persona, cockpit, moduli, trasmetti, ctxModulo, trasporto? }) → { stato, controlla, consegna, scrivi,
//   messaggi, avvia, altri, altro }
import { negozio } from "./stato.mjs";
import { componi } from "./prompt.mjs";
import { occupato } from "./squadra.mjs";

const GIRO_MS = 20000;
const CONSEGNATI_GIORNI = 7;
export const MAX_TESTO = 4000;
export const TIPI = ["info", "domanda", "risposta"];

export function creaPonte({ cfg, persona = {}, cockpit, moduli = [], trasmetti = () => {}, ctxModulo = () => ({}), trasporto = null }) {
  const regole = cfg.ponte;
  // `ponte: false` nella riga di persone[] della config: quella persona non ha ponte e non è l'altra di nessuno
  const io = persona.slug ? persona : null;
  const spento = !!io && (io.ponte === false || (cfg.persone || []).find((p) => p.slug === io.slug)?.ponte === false);
  const altri = io && !spento ? (cfg.persone || []).filter((p) => p.slug && p.slug !== io.slug && p.ponte !== false) : [];
  const altro = altri[0] || null; // la prima: per chi legge ancora un filo solo (pagina e ctl di prima)
  const diAltri = new Map(altri.map((p) => [p.slug, p]));
  const nomeDi = (slug) => diAltri.get(slug)?.nome || slug;
  const breve = (p) => ({ slug: p.slug, nome: p.nome || p.slug });
  const mod = moduli.find((m) => typeof m.ponte === "function");
  let via = trasporto;
  if (!via && mod) { try { via = mod.ponte(ctxModulo(mod)) || null; } catch (e) { console.error(`ponte, modulo ${mod.nome}:`, e.message); } }

  const archivio = negozio("ponte", { base: { ultimoControllo: 0, esito: "", consegnati: {}, daSegnare: [] } });
  const leggi = () => {
    const d = archivio.leggi();
    return { ...d, consegnati: d.consegnati && typeof d.consegnati === "object" ? d.consegnati : {}, daSegnare: Array.isArray(d.daSegnare) ? d.daSegnare : [] };
  };
  const annuncia = (azione, extra = {}) => { try { trasmetti({ type: "cockpit_ponte", azione, ...extra }); } catch { /* lo stream non ferma il ponte */ } };

  // perché il ponte non c'è, o "" se c'è
  const mancanza = () => (!via ? "nessun modulo offre il ponte" : !io ? "persona sconosciuta (git config user.email)" : spento ? "ponte spento per questa persona (ponte: false nella config)" : !altri.length ? "nessun'altra persona nella config" : "");
  let motivo = mancanza(); // l'ultimo motivo per cui il ponte non risponde; "" = disponibile
  let attesa = []; // messaggi letti dalla coda e non ancora consegnati all'assistente
  const annunciati = new Set();

  function guasto(e) {
    const m = e?.nonDisponibile ? String(e.message || e) : `il ponte non risponde: ${e?.message || e}`;
    if (m !== motivo) { console.error(`ponte: ${m}`); motivo = m; annuncia("stato", { stato: stato() }); }
    return m;
  }
  function ripreso() { if (motivo) { motivo = ""; annuncia("stato", { stato: stato() }); } }

  function stato() {
    const d = leggi();
    return {
      disponibile: !mancanza() && !motivo, motivo: mancanza() || motivo, intervalloMinuti: regole.intervalloMinuti,
      io: io ? breve(io) : null, altro: altro ? breve(altro) : null, altri: altri.map(breve),
      ultimoControllo: d.ultimoControllo || 0, esito: d.esito || "", inAttesa: attesa.length,
    };
  }

  // ───── la consegna all'assistente ─────
  const quando = (t) => new Date(t).toLocaleString("it-IT", { timeZone: cfg.fuso, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const unaRiga = (t, max) => String(t || "").replace(/\s+/g, " ").trim().slice(0, max);
  function testoTurno(lista, citati) {
    const righe = lista.map((m) => {
      const dettagli = [`n. ${m.id}`, m.tipo !== "info" && m.tipo, m.urgente && "urgente", m.via === "persona" && `scritto da ${nomeDi(m.mittente)} in persona`, quando(m.creato)].filter(Boolean).join(" · ");
      const cit = m.risposta_a && citati.get(String(m.risposta_a));
      return `[ponte] ${nomeDi(m.mittente)} scrive: ${m.testo}\n(${dettagli}${m.risposta_a ? ` · risponde al n. ${m.risposta_a}${cit ? `: «${unaRiga(cit.testo, 200)}»` : ""}` : ""})`;
    });
    return componi("ponte", cockpit.variabili({ altro: elenco(chiScrive(lista)), messaggi: righe.join("\n\n") }), moduli).trim();
  }

  const chiScrive = (lista) => [...new Set(lista.map((m) => m.mittente))].map(nomeDi);
  const elenco = (nomi) => (nomi.length > 1 ? `${nomi.slice(0, -1).join(", ")} e ${nomi.at(-1)}` : nomi[0] || "");

  let consegnando = false;
  async function consegna() {
    if (consegnando || !attesa.length || !altri.length) return { esito: attesa.length ? "in corso" : "niente" };
    const o = cockpit.orchestratore();
    if (!o || occupato(cockpit, o)) return { esito: "occupato" };
    consegnando = true;
    try {
      const lista = attesa.slice().sort((a, b) => a.id - b.id);
      const citati = new Map();
      if (lista.some((m) => m.risposta_a)) {
        for (const chi of new Set(lista.filter((m) => m.risposta_a).map((m) => m.mittente))) {
          try { for (const m of await via.filo(io.slug, chi, 80)) citati.set(String(m.id), m); } catch { /* senza citazione */ }
        }
      }
      const urgente = lista.some((m) => m.urgente);
      cockpit.invia(o.id, testoTurno(lista, citati), {
        nota: `${elenco(chiScrive(lista))} ti ${chiScrive(lista).length > 1 ? "scrivono" : "scrive"} dal ponte${lista.length > 1 ? ` (${lista.length} messaggi)` : ""}${urgente ? ", urgente" : ""}`,
        mittente: lista[0].mittente, origine: "ponte",
      });
      const d = leggi(), adesso = Date.now();
      for (const m of lista) d.consegnati[m.id] = adesso;
      d.daSegnare = [...new Set([...d.daSegnare, ...lista.map((m) => m.id)])];
      d.esito = `consegnati ${lista.length}`;
      archivio.scrivi(d);
      attesa = attesa.filter((m) => !lista.includes(m));
      await segna();
      annuncia("consegnati", { ids: lista.map((m) => m.id) });
      return { esito: "consegnati", n: lista.length };
    } finally { consegnando = false; }
  }

  // segna letti sulla coda i messaggi già consegnati; se non riesce, riprova al controllo dopo (consegnati evita il doppio turno)
  async function segna() {
    const d = leggi();
    if (!d.daSegnare.length) return;
    try { await via.segnaLetti(d.daSegnare); const e = leggi(); e.daSegnare = e.daSegnare.filter((x) => !d.daSegnare.includes(x)); archivio.scrivi(e); }
    catch (e) { guasto(e); }
  }

  // ───── il controllo della coda ─────
  let controllando = false;
  async function controlla({ forza = false } = {}) {
    if (mancanza()) return { esito: "non disponibile", motivo: mancanza() };
    const d = leggi(), adesso = Date.now();
    if (!forza && adesso - (d.ultimoControllo || 0) < regole.intervalloMinuti * 60000) return consegna();
    if (controllando) return { esito: "in corso" };
    controllando = true;
    try {
      d.ultimoControllo = adesso;
      const limite = adesso - CONSEGNATI_GIORNI * 86400000;
      d.consegnati = Object.fromEntries(Object.entries(d.consegnati).filter(([, t]) => t > limite));
      let righe;
      try { righe = await via.nonLetti(io.slug); } catch (e) { d.esito = guasto(e); archivio.scrivi(d); return { esito: "non disponibile", motivo }; }
      ripreso();
      const giaDentro = new Set(attesa.map((m) => String(m.id)));
      const nuovi = righe.filter((m) => diAltri.has(m.mittente) && !d.consegnati[m.id] && !giaDentro.has(String(m.id)));
      // già consegnati ma ancora non letti sulla coda: si segnano di nuovo
      const vecchi = righe.filter((m) => d.consegnati[m.id]).map((m) => m.id);
      d.daSegnare = [...new Set([...d.daSegnare, ...vecchi])];
      d.esito = nuovi.length ? `${nuovi.length} nuovi` : "niente di nuovo";
      archivio.scrivi(d);
      attesa.push(...nuovi);
      const daDire = nuovi.filter((m) => !annunciati.has(String(m.id)));
      daDire.forEach((m) => annunciati.add(String(m.id)));
      if (daDire.length) annuncia("arrivati", { messaggi: daDire });
      await segna();
      const c = await consegna();
      return { esito: nuovi.length ? "nuovi" : "niente", nuovi: nuovi.length, consegna: c.esito };
    } finally { controllando = false; }
  }

  // ───── scrivere ─────
  // il messaggio n. id, se sta in un filo di questa plancia: dal trasporto se sa cercarlo, altrimenti nei fili
  async function trovaMessaggio(id) {
    if (typeof via.messaggio === "function") return via.messaggio(id);
    for (const p of altri) { const m = (await via.filo(io.slug, p.slug, 500)).find((x) => Number(x.id) === id); if (m) return m; }
    return null;
  }
  // lo slug di un'altra persona (o «n. 3» → errore chiaro); vuoto = nessuna
  function altraPersona(a) {
    const x = String(a ?? "").trim().replace(/^@/, "").toLowerCase();
    if (!x) return "";
    const p = altri.find((q) => q.slug === x || String(q.nome || "").toLowerCase() === x);
    if (!p) throw new Error(`sul ponte non c'è un filo con «${a}»: ${altri.map((q) => q.slug).join(", ") || "nessuno"}`);
    return p.slug;
  }
  const scegli = () => `con più fili dì a chi scrivi: --a ${altri.map((p) => p.slug).join("|")}`;

  // sessione = chi scrive dal ctl (COCKPIT_SESSIONE): solo l'assistente; senza sessione è la persona, dalla pagina o dal terminale
  // a = lo slug della persona a cui si scrive; con una risposta si ricava dal messaggio, senza e con una sola altra persona è lei
  async function scrivi({ testo, tipo, domanda, urgente, risposta_a, sessione, a } = {}) {
    if (sessione) {
      const s = cockpit.trova(sessione);
      if (!s) throw new Error(`sessione sconosciuta: ${sessione}`);
      if (s.ruolo !== "orchestratore") throw new Error(`il ponte è dell'assistente: scrivi a ${cfg.assistente.nome}, che lo gira`);
    }
    const t = String(testo ?? "").replace(/\r/g, "").trim();
    if (!t) throw new Error("messaggio vuoto");
    if (t.length > MAX_TESTO) throw new Error(`messaggio troppo lungo (${t.length} caratteri, massimo ${MAX_TESTO})`);
    const rispA = risposta_a === undefined || risposta_a === null || risposta_a === "" ? null : Number(String(risposta_a).replace(/^n\.?\s*/i, ""));
    if (rispA !== null && !(Number.isInteger(rispA) && rispA > 0)) throw new Error(`risposta a: un numero di messaggio (${risposta_a})`);
    const tipoFinale = tipo || (domanda ? "domanda" : rispA ? "risposta" : "info");
    if (!TIPI.includes(tipoFinale)) throw new Error(`tipo: ${TIPI.join(", ")}`);
    if (tipoFinale === "risposta" && !rispA) throw new Error("una risposta dice a quale messaggio risponde");
    if (mancanza()) return { disponibile: false, motivo: mancanza() };
    let dest = altraPersona(a);
    if (rispA) {
      let r;
      try { r = await trovaMessaggio(rispA); } catch (e) { return { disponibile: false, motivo: guasto(e) }; }
      const lato = r && (r.mittente === io.slug ? r.destinatario : r.destinatario === io.slug ? r.mittente : null);
      if (!lato || !diAltri.has(lato)) throw new Error(`il n. ${rispA} non è in un tuo filo del ponte`);
      if (dest && dest !== lato) throw new Error(`il n. ${rispA} è nel filo con ${nomeDi(lato)}, non con ${nomeDi(dest)}`);
      dest = lato;
    }
    if (!dest) { if (altri.length > 1) throw new Error(scegli()); dest = altro.slug; }
    let m;
    try {
      m = await via.scrivi({ mittente: io.slug, destinatario: dest, via: sessione ? "assistente" : "persona", testo: t, tipo: tipoFinale, urgente: !!urgente, risposta_a: rispA });
    } catch (e) { return { disponibile: false, motivo: guasto(e) }; }
    ripreso();
    annuncia("scritto", { messaggio: m });
    return { disponibile: true, messaggio: m };
  }

  // a = il filo con quella persona; senza, tutti i fili insieme, in ordine di numero (i più recenti in fondo)
  async function messaggi({ n = 50, a } = {}) {
    if (mancanza()) return { disponibile: false, motivo: mancanza(), messaggi: [] };
    const quanti = Math.max(1, Math.min(500, Number(n) || 50));
    const con = altraPersona(a);
    try {
      const fili = await Promise.all((con ? [con] : altri.map((p) => p.slug)).map((x) => via.filo(io.slug, x, quanti)));
      const lista = fili.length === 1 ? fili[0] : fili.flat().sort((x, y) => Number(x.id) - Number(y.id)).slice(-quanti);
      ripreso();
      return { disponibile: true, messaggi: lista, ...(con ? { a: con } : {}) };
    } catch (e) { return { disponibile: false, motivo: guasto(e), messaggi: [] }; }
  }

  function avvia() {
    if (process.env.COCKPIT_PROVA === "1" || mancanza()) return null;
    const tic = () => controlla().catch((e) => console.error("ponte:", e.message));
    setTimeout(tic, 3000).unref();
    return setInterval(tic, GIRO_MS).unref();
  }

  return { stato, controlla, consegna, scrivi, messaggi, avvia, altri, altro };
}
