// I comandi della squadra per ctl.mjs (stessa forma dei comandi dei moduli: `comandi`, `aiuto`): bacheca, messaggi diretti,
// interruttori e advisor. Chi scrive è COCKPIT_SESSIONE (io); da terminale, senza sessione, si scrive come la persona.
const ora = (t) => new Date(t).toLocaleString("it-IT", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const riga = (m) => `${ora(m.t)}  @${m.da}${m.a ? ` → @${m.a}` : ""}: ${m.testo.replace(/\s*\n\s*/g, " ⏎ ")}`;
const quando = (t) => (t ? ora(t) : "—");

function descrivi(sq) {
  const righe = [`squadra ${sq.acceso ? "accesa" : "spenta"}${sq.quiete ? " · di notte (quiete)" : ""} · ogni ${sq.regole.intervalloMinuti} min, a vuoto ogni ${sq.regole.vuotoOgniMinuti} min, ${sq.regole.messaggiOra} messaggi l'ora`];
  for (const r of sq.ruoli) {
    righe.push(`  ${(r.tipo === "capo" ? "" : "  ") + r.slug}`.padEnd(18) + ` ${(r.acceso ? "on" : "off").padEnd(4)} ${String(r.intervalloOra ?? "notte").padStart(5)} min  ${r.modello.padEnd(11)} ${r.autonomia.padEnd(10)} `
      + `${(r.stato || "—").padEnd(8)} ultimo turno ${quando(r.ultimoTurno)}${r.esito ? ` (${r.esito})` : ""}`);
  }
  return righe.join("\n");
}

async function bacheca({ args, opz, api, uso, io }) {
  const [sub = "ultimi", ...resto] = args;
  if (sub === "ultimi") {
    const n = Number(resto[0]) || 20;
    const { messaggi } = await api("GET", `/api/squadra/bacheca?n=${n}`);
    return console.log(messaggi.map(riga).join("\n") || "bacheca vuota");
  }
  if (sub === "cerca") {
    const q = resto.join(" ").trim();
    if (!q) uso('ctl.mjs bacheca cerca "parola"');
    const { messaggi } = await api("GET", `/api/squadra/bacheca?n=200&cerca=${encodeURIComponent(q)}`);
    return console.log(messaggi.map(riga).join("\n") || `niente in bacheca con «${q}»`);
  }
  if (sub === "scrivi") {
    const testo = resto.join(" ").trim();
    if (!testo) uso('ctl.mjs bacheca scrivi "testo" (con @ruolo svegli quel ruolo)');
    const { messaggio: m } = await api("POST", "/api/squadra/bacheca", { testo, sessione: io });
    return console.log(`in bacheca${m.menzioni.length ? `, sveglia ${m.menzioni.map((x) => `@${x}`).join(" ")}` : ""}`);
  }
  return uso('ctl.mjs bacheca [ultimi [n]] | bacheca scrivi "testo" | bacheca cerca "parola"');
}

async function dm({ args, api, uso, errore, io }) {
  const [a, ...resto] = args;
  if (!a) uso('ctl.mjs dm <ruolo> ["testo"]  (senza testo: il vostro filo)');
  const verso = a.replace(/^@/, "").toLowerCase();
  const testo = resto.join(" ").trim();
  if (!testo) {
    if (!io) errore("leggere un filo vale per una sessione del cockpit (manca COCKPIT_SESSIONE)");
    const { messaggi } = await api("GET", `/api/squadra/dm/${encodeURIComponent(io)}/${encodeURIComponent(verso)}?n=30`);
    return console.log(messaggi.map(riga).join("\n") || `nessun messaggio fra te e @${verso}`);
  }
  await api("POST", "/api/squadra/dm", { sessione: io, a: verso, testo });
  console.log(`messaggio diretto a @${verso}`);
}

async function squadra({ args, api, uso }) {
  const [sub = "stato", ...resto] = args;
  if (sub === "stato") return console.log(descrivi((await api("GET", "/api/squadra")).squadra));
  if (sub === "on" || sub === "off") return console.log(descrivi((await api("POST", "/api/squadra", { acceso: sub === "on" })).squadra));
  if (sub === "advisor") {
    const testo = resto.join(" ").trim();
    if (!testo) uso('ctl.mjs squadra advisor "testo"');
    const io = process.env.COCKPIT_SESSIONE || "";
    await api("POST", "/api/squadra/advisor", { sessione: io, testo });
    return console.log("messaggio all'advisor");
  }
  if (sub === "intervallo") {
    const [ruolo, minuti] = resto;
    if (!ruolo || minuti === undefined) uso("ctl.mjs squadra intervallo <ruolo> <minuti|default>");
    return console.log(descrivi((await api("POST", "/api/squadra", { ruolo, intervalloMinuti: minuti === "default" ? null : Number(minuti) })).squadra));
  }
  if (sub === "giro") {
    const j = await api("POST", "/api/squadra/giro", { ruolo: resto[0] || "" });
    return console.log(`giro: ${j.esito}${(j.esiti || []).length ? ` · ${j.esiti.map((e) => `${e.ruolo} ${e.esito}`).join(", ")}` : ""}`);
  }
  if (resto[0] === "on" || resto[0] === "off") return console.log(descrivi((await api("POST", "/api/squadra", { ruolo: sub, acceso: resto[0] === "on" })).squadra));
  return uso('ctl.mjs squadra [stato] | on | off | <ruolo> on|off | intervallo <ruolo> <minuti|default> | advisor "testo" | giro [<ruolo>]');
}

export const comandi = { bacheca, dm, squadra };
export const aiuto = [
  'bacheca [ultimi [n]] | scrivi "testo" | cerca "parola"   la chat di gruppo della squadra (@ruolo nel testo sveglia quel ruolo, @tutti tutti)',
  'dm <ruolo> ["testo"]                           un messaggio diretto a un agente della squadra (lo sveglia); senza testo il vostro filo',
  'squadra [stato]|on|off|<ruolo> on|off|intervallo <ruolo> <min>|advisor "testo"|giro [<ruolo>]   la squadra di agenti permanenti',
];
