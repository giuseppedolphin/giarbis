// Il comando `ponte` di ctl.mjs (stessa forma dei comandi dei moduli: `comandi`, `aiuto`, `opzioni`): i fili dei messaggi con
// gli assistenti delle plance delle altre persone, uno per persona. Scrive solo l'assistente (COCKPIT_SESSIONE); da terminale
// scrive la persona. Con più fili `--a <slug>` dice a chi; una risposta (`--risposta <n>`) va da sola nel filo giusto.
const ora = (t) => new Date(t).toLocaleString("it-IT", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const riga = (m, nomi, conDest) => `n. ${m.id}  ${ora(m.creato)}  ${nomi[m.mittente] || m.mittente}${conDest ? ` → ${nomi[m.destinatario] || m.destinatario}` : ""}${m.via === "persona" ? " (in persona)" : ""}`
  + `${m.tipo !== "info" ? ` · ${m.tipo}` : ""}${m.urgente ? " · urgente" : ""}${m.risposta_a ? ` · risponde al n. ${m.risposta_a}` : ""}${m.letto_il ? "" : " · non letto"}: ${m.testo.replace(/\s*\n\s*/g, " ⏎ ")}`;
// le altre persone del ponte; un server di prima del ponte a tre ha solo `altro`
const altriDi = (p) => (Array.isArray(p.altri) ? p.altri : [p.altro].filter(Boolean));
const nomiDi = (p) => Object.fromEntries([p.io, ...altriDi(p)].filter(Boolean).map((x) => [x.slug, x.nome]));
const nonDisponibile = (p) => `ponte non disponibile: ${p.motivo}`;
const RIAVVIA = "il server acceso ha ancora il ponte a un filo solo: serve il Riavvia della plancia";

async function ponte({ args, opz, api, uso, errore, io }) {
  const [sub = "stato", ...resto] = args;
  const a = opz.a ? String(opz.a).replace(/^@/, "").toLowerCase() : "";
  if (sub === "stato") {
    const { ponte: p } = await api("GET", "/api/ponte");
    if (!p.disponibile) return console.log(nonDisponibile(p));
    return console.log(`ponte con ${altriDi(p).map((x) => `${x.nome} (${x.slug})`).join(", ")}: disponibile · controllo ogni ${p.intervalloMinuti} min · ultimo ${p.ultimoControllo ? ora(p.ultimoControllo) : "—"}${p.esito ? ` (${p.esito})` : ""}${p.inAttesa ? ` · ${p.inAttesa} da consegnare` : ""}`);
  }
  if (sub === "ultimi") {
    const n = Number(resto[0]) || 15;
    const j = await api("GET", `/api/ponte/messaggi?n=${n}${a ? `&a=${encodeURIComponent(a)}` : ""}`);
    if (!j.disponibile) return console.log(nonDisponibile(j));
    const tanti = altriDi(j.ponte).length > 1;
    if (a && !Array.isArray(j.ponte.altri) && a !== j.ponte.altro?.slug) errore(RIAVVIA);
    const con = a ? nomiDi(j.ponte)[a] || a : altriDi(j.ponte).map((x) => x.nome).join(", ");
    return console.log(j.messaggi.map((m) => riga(m, nomiDi(j.ponte), tanti && !a)).join("\n") || `nessun messaggio con ${con}`);
  }
  if (sub === "scrivi") {
    const testo = resto.join(" ").trim();
    if (!testo) uso('ctl.mjs ponte scrivi "testo" [--a <persona>] [--domanda] [--urgente] [--risposta <n>]');
    if (a) {
      // un server vecchio ignorerebbe `a` e scriverebbe alla sua unica altra persona: meglio fermarsi
      const { ponte: p } = await api("GET", "/api/ponte");
      if (!Array.isArray(p.altri) && p.altro && a !== p.altro.slug) errore(RIAVVIA);
    }
    const j = await api("POST", "/api/ponte", { testo, a, domanda: !!opz.domanda, urgente: !!opz.urgente, risposta_a: opz.risposta, sessione: io });
    if (!j.disponibile) return console.log(`${nonDisponibile(j)}: messaggio non mandato`);
    const m = j.messaggio;
    return console.log(`al ponte, a ${m.destinatario}, n. ${m.id}${m.tipo !== "info" ? ` (${m.tipo})` : ""}${m.urgente ? ", urgente" : ""}`);
  }
  if (sub === "controlla") {
    const j = await api("POST", "/api/ponte/controlla");
    return console.log(j.esito === "non disponibile" ? nonDisponibile(j.ponte) : `controllo: ${j.esito}${j.consegna ? ` · consegna ${j.consegna}` : ""}`);
  }
  return uso('ctl.mjs ponte [stato] | ultimi [n] [--a <persona>] | scrivi "testo" [--a <persona>] [--domanda] [--urgente] [--risposta <n>] | controlla');
}

export const comandi = { ponte };
export const opzioni = { valore: ["risposta", "a"], booleane: ["domanda"] };
export const aiuto = [
  'ponte [stato] | ultimi [n] [--a <persona>] | scrivi "testo" [--a <persona>] [--domanda] [--urgente] [--risposta <n>] | controlla   i fili con gli assistenti delle plance delle altre persone, uno per persona (scrive solo l\'assistente; con più fili --a dice a chi, una risposta va nel filo del messaggio)',
];
