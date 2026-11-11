// Il bagaglio di un agente della squadra (deciso; spec interna, «Il bagaglio»):
// chi è e come lavora, costruito nel tempo, in `<stato>/squadra/<slug>/bagaglio.md`. Sei sezioni fisse, una riga per voce.
// Si semina al primo avvio dal mandato del ruolo; se c'è ancora il vecchio `imparato.md`, il suo testo entra tutto in
// «Cosa so del mio dominio» e l'originale resta in `appunti/imparato-archivio.md`. Nel prompt entra in forma compatta, col
// tetto di voci per sezione: oltre il tetto le voci in più restano nel file e l'agente riceve l'invito a compattare.
//
//   SEZIONI · seme(r, { mandatoLungo, capo, chi, comuni }) → testo · daImparato(testo) → voci · conImparato(bagaglio, voci) → testo
//   leggi(testo) → { sezioni: { titolo: [voci] }, fuori: [titoli] } · compatto(testo) → { testo, oltre } · impronta(testo)
//   prepara(sotto, r, opzioni del seme) → { creato, migrato, archivio }: seme e migrazione sul disco, all'avvio
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { percorsoStato, salvaFile, spostaFile } from "./stato.mjs";

export const SEZIONI = ["Carattere e atteggiamento", "Come rispondo e scrivo", "Strategie che funzionano", "Obiettivi", "Cosa evitare", "Cosa so del mio dominio"];
export const DOMINIO = SEZIONI[5];
export const VOCI_MAX = 8;          // per sezione
export const VOCI_DOMINIO_MAX = 15; // i fatti del dominio sono di più
export const CARATTERI_VOCE = 300;  // oltre, la voce si tronca nel prompt

const unaRiga = (x) => String(x || "").replace(/\s+/g, " ").trim();
const taglia = (x, n) => (x.length > n ? `${x.slice(0, n - 1)}…` : x);
// Le prime frasi che stanno in n caratteri (il resto del mandato resta in mandato.md)
const frasi = (x, n) => { let out = ""; for (const f of x.split(/(?<=[.;:])\s+/)) { if ((out ? out.length + 1 : 0) + f.length > n) break; out = out ? `${out} ${f}` : f; } return out || taglia(x, n); };
const tetto = (sez) => (sez === DOMINIO ? VOCI_DOMINIO_MAX : VOCI_MAX);

// Una sezione `## Titolo` del mandato lungo, in una riga sola (vuota se manca)
function sezioneMandato(testo, titolo) {
  const m = String(testo || "").split(/^## /m).find((p) => p.toLowerCase().startsWith(titolo.toLowerCase()));
  return m ? unaRiga(m.slice(titolo.length).replace(/^\s*-\s*/gm, "")) : "";
}

// Il seme: le voci comuni del modulo (un bagaglio.md accanto ai ruoli, stesse sezioni) più quelle del ruolo (capo o esecutore,
// metrica, «Cosa fai» e «Cosa non fai» del mandato lungo). `chi` è il nome della persona.
export function seme(r, { mandatoLungo = "", capo = null, chi = "la persona", comuni = "" } = {}) {
  const fa = sezioneMandato(mandatoLungo, "Cosa fai"), nonFa = sezioneMandato(mandatoLungo, "Cosa non fai");
  const base = leggi(comuni).sezioni;
  const proprie = {
    "Carattere e atteggiamento": [capo ? `Sono un esecutore di @${capo}: lavoro su ciò che mi chiede e gli riporto in poche righe, col numero.` : `Sono un capo: smisto il lavoro con messaggi precisi, metto insieme i risultati e a ${chi} porto la sintesi, non i dettagli.`],
    "Strategie che funzionano": fa ? [`Dal mandato: ${frasi(fa, CARATTERI_VOCE - 14)}`] : [],
    "Obiettivi": [`Metrica del ruolo: ${unaRiga(r.metrica) || "—"}; numeri, obiettivo e strategia in appunti/kpi.md.`],
    "Cosa evitare": nonFa ? [`Dal mandato: ${frasi(nonFa, CARATTERI_VOCE - 14)}`] : [],
  };
  return [
    `# Bagaglio — ${r.nome}`, "",
    `> Chi sei e come lavori, costruito nel tempo. Una riga per voce, con la data e la base (un esito, un feedback di ${chi}). Entra solo ciò che è verificato; ` +
      `una voce nuova sostituisce quella che supera, non si accumula. Tetto: ${VOCI_MAX} voci per sezione, ${VOCI_DOMINIO_MAX} in «${DOMINIO}»; oltre, compatta. Le sezioni restano queste sei.`,
    "",
    ...SEZIONI.flatMap((x) => [`## ${x}`, ...[...base[x], ...(proprie[x] || [])].map((v) => `- ${v.replaceAll("{{persona}}", chi)}`), ""]),
  ].join("\n");
}

// Il testo di un vecchio imparato.md in voci, senza perdere niente: titoli e paragrafi diventano voci, il cappello standard no
export function daImparato(testo) {
  const voci = [];
  let titolo = "";
  for (const riga of String(testo || "").split("\n")) {
    const t = riga.trim();
    if (!t || /^# Cosa ho imparato/.test(t) || /^Fatti stabili del tuo dominio/.test(t)) continue; // il cappello del vecchio seme
    const h = t.match(/^#{1,6}\s+(.*)$/);
    if (h) { titolo = h[1].trim(); continue; }
    const v = t.replace(/^[-*]\s+/, "");
    if (/^\s/.test(riga) && voci.length && !/^[-*]\s/.test(t)) { voci[voci.length - 1] += ` ${v}`; continue; } // riga a capo dentro una voce
    voci.push(titolo ? `${titolo} — ${v}` : v);
  }
  return voci;
}

// Le voci in coda a «Cosa so del mio dominio», saltando quelle che ci sono già (un imparato.md riscritto dopo la migrazione)
export function conImparato(bagaglio, voci) {
  const gia = new Set(leggi(bagaglio).sezioni[DOMINIO]);
  const nuove = voci.map(unaRiga).filter((v) => v && !gia.has(v)).map((v) => `- ${v}`);
  if (!nuove.length) return bagaglio;
  const righe = bagaglio.split("\n"), i = righe.findIndex((x) => x.trim() === `## ${DOMINIO}`);
  if (i < 0) return `${bagaglio.trimEnd()}\n\n## ${DOMINIO}\n${nuove.join("\n")}\n`;
  let fine = i + 1;
  while (fine < righe.length && !/^## /.test(righe[fine])) fine++;
  while (fine > i + 1 && !righe[fine - 1].trim()) fine--;
  righe.splice(fine, 0, ...nuove);
  return righe.join("\n");
}

export function leggi(testo) {
  const sezioni = Object.fromEntries(SEZIONI.map((s) => [s, []])), fuori = [];
  let dove = null;
  for (const riga of String(testo || "").split("\n")) {
    const h = riga.match(/^##\s+(.*)$/);
    if (h) {
      const t = h[1].trim(), nota = SEZIONI.find((s) => s.toLowerCase() === t.toLowerCase());
      dove = nota || null;
      if (!nota) fuori.push(t);
      continue;
    }
    const v = riga.match(/^\s*[-*]\s+(.*)$/);
    if (v && dove && unaRiga(v[1])) sezioni[dove].push(unaRiga(v[1]));
  }
  return { sezioni, fuori };
}

// La forma che entra nel prompt: solo le voci, tagliate al tetto; `oltre` dice cosa compattare
export function compatto(testo) {
  const { sezioni, fuori } = leggi(testo);
  const righe = [], oltre = [];
  let lunghe = 0;
  for (const s of SEZIONI) {
    const voci = sezioni[s];
    if (!voci.length) continue;
    righe.push(`${s}:`, ...voci.slice(0, tetto(s)).map((v) => `- ${taglia(v, CARATTERI_VOCE)}`));
    if (voci.length > tetto(s)) oltre.push(`${s} (${voci.length} voci, tetto ${tetto(s)})`);
    lunghe += voci.filter((v) => v.length > CARATTERI_VOCE).length;
  }
  if (lunghe) oltre.push(`${lunghe} voci oltre ${CARATTERI_VOCE} caratteri, tagliate qui`);
  if (!righe.length) righe.push("(vuoto)");
  if (oltre.length) righe.push(`Oltre il tetto, da compattare nel file: ${oltre.join("; ")}.`);
  if (fuori.length) righe.push(`Sezioni non previste, da riportare nelle sei: ${fuori.join(", ")}.`);
  return { testo: righe.join("\n"), oltre: oltre.length > 0 || fuori.length > 0 };
}

export const impronta = (testo) => createHash("sha1").update(String(testo || "")).digest("hex").slice(0, 12);

// All'avvio, per un ruolo: il bagaglio si semina se manca; un imparato.md (anche riscritto da un processo col prompt vecchio)
// entra in «Cosa so del mio dominio» e l'originale va in appunti/imparato-archivio[-n].md. Niente si cancella.
export function prepara(sotto, r, opzioni = {}) {
  const dir = percorsoStato(sotto), fileB = path.join(dir, "bagaglio.md"), fileI = path.join(dir, "imparato.md");
  const creato = !existsSync(fileB), vecchio = existsSync(fileI) ? readFileSync(fileI, "utf8") : null;
  if (!creato && vecchio === null) return { creato, migrato: 0, archivio: "" };
  let testo = creato ? seme(r, opzioni) : readFileSync(fileB, "utf8");
  const voci = vecchio === null ? [] : daImparato(vecchio);
  testo = conImparato(testo, voci);
  salvaFile(sotto, "bagaglio.md", testo);
  let archivio = "";
  if (vecchio !== null) {
    let nome = "imparato-archivio.md";
    for (let n = 2; existsSync(path.join(dir, "appunti", nome)); n++) nome = `imparato-archivio-${n}.md`;
    archivio = spostaFile(sotto, "imparato.md", `${sotto}/appunti`, nome);
  }
  return { creato, migrato: voci.length, archivio };
}
