// Gli orari della squadra nel fuso della config: minuti del giorno, il giorno e la settimana, e il giro del mattino del file dei
// ruoli (campo `mattino`, vedi squadra.mjs), e le sveglie a orario di un ruolo (campo `sveglie`). Funzioni pure: le prova il
// controllo della squadra.
import path from "node:path";

const lista = (x) => (Array.isArray(x) ? x.map((v) => String(v)) : []);

export const hm = (x) => { const [h, m] = String(x).split(":").map(Number); return h * 60 + m; };
export function minutiOra(cfg, t) {
  const p = new Intl.DateTimeFormat("it-IT", { timeZone: cfg.fuso, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(t));
  const v = Object.fromEntries(p.map((x) => [x.type, x.value]));
  return (Number(v.hour) % 24) * 60 + Number(v.minute);
}
// il giorno (AAAA-MM-GG) e il giorno della settimana (0 = domenica) nel fuso della config
function giornoDi(cfg, t) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: cfg.fuso, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { giorno: `${p.year}-${p.month}-${p.day}`, settimana: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday) };
}
// A che punto è il mattino adesso: { giorno, ruoli: vero se è l'ora del giro dei ruoli, assistente: vero se è l'ora dell'assistente }.
// Pura, la prova il controllo.
export function momentoMattino(cfg, m, t = Date.now()) {
  if (!m) return null;
  const { giorno, settimana } = giornoDi(cfg, t), x = minutiOra(cfg, t);
  const oggi = m.giorni.includes(settimana) && x < hm(m.fino);
  return { giorno, ruoli: oggi && x >= hm(m.ora), assistente: oggi && !!m.assistente && x >= hm(m.assistente) };
}
// Il giro del mattino del file dei ruoli (il primo che lo dichiara), con gli orari controllati: null se non c'è.
const ORA = /^([01]\d|2[0-3]):[0-5]\d$/;
export function mattinoDi(trovate, ruoli) {
  const x = trovate.find((d) => d.dati.mattino);
  if (!x) return null;
  const m = x.dati.mattino, dir = path.dirname(x.file);
  for (const k of ["ora", "fino", "assistente"]) if (m[k] !== undefined && !ORA.test(String(m[k]))) throw new Error(`mattino della squadra: ${k} non è un'ora HH:MM ("${m[k]}")`);
  if (!ORA.test(String(m.ora || ""))) throw new Error("mattino della squadra: manca l'ora (HH:MM)");
  const elenco = lista(m.ruoli).map((v) => v.toLowerCase());
  for (const slug of elenco) if (!ruoli.some((r) => r.slug === slug)) throw new Error(`mattino della squadra: il ruolo ${slug} non esiste`);
  const giorni = Array.isArray(m.giorni) && m.giorni.length ? m.giorni.map(Number) : [1, 2, 3, 4, 5];
  if (giorni.some((g) => !Number.isInteger(g) || g < 0 || g > 6)) throw new Error("mattino della squadra: giorni da 0 (domenica) a 6");
  return {
    ora: String(m.ora), fino: String(m.fino || "12:00"), giorni, ruoli: elenco.length ? elenco : ruoli.map((r) => r.slug),
    assistente: m.assistente ? String(m.assistente) : "", istruzioni: m.istruzioni ? path.resolve(dir, String(m.istruzioni)) : "",
  };
}

// Le sveglie a orario di un ruolo (campo `sveglie` del file dei ruoli: { ore: ["HH:MM"], giorni: [0-6] }, di default lunedì-venerdì):
// null senza il campo, così un ruolo che non le dichiara si comporta come prima. Orari sbagliati: errore al caricamento.
export function sveglieDi(x, slug = "") {
  if (x === undefined || x === null) return null;
  const ore = [...new Set(lista(x.ore))].sort();
  if (!ore.length || ore.some((o) => !ORA.test(o))) throw new Error(`sveglie del ruolo ${slug}: ore HH:MM, almeno una`);
  const giorni = Array.isArray(x.giorni) && x.giorni.length ? x.giorni.map(Number) : [1, 2, 3, 4, 5];
  if (giorni.some((g) => !Number.isInteger(g) || g < 0 || g > 6)) throw new Error(`sveglie del ruolo ${slug}: giorni da 0 (domenica) a 6`);
  return { ore, giorni };
}
// La sveglia dovuta adesso: l'ultima ora di oggi già passata da meno di RECUPERO_SVEGLIA_MIN minuti (un server spento o un
// agente occupato la recuperano entro la finestra, poi si perde), come { chiave: "AAAA-MM-GG HH:MM", ora }; altrimenti null. Pura.
export const RECUPERO_SVEGLIA_MIN = 60;
export function svegliaDovuta(cfg, sv, t = Date.now()) {
  if (!sv) return null;
  const { giorno, settimana } = giornoDi(cfg, t), x = minutiOra(cfg, t);
  if (!sv.giorni.includes(settimana)) return null;
  const passate = sv.ore.filter((o) => hm(o) <= x && x - hm(o) < RECUPERO_SVEGLIA_MIN);
  return passate.length ? { chiave: `${giorno} ${passate[passate.length - 1]}`, ora: passate[passate.length - 1] } : null;
}
