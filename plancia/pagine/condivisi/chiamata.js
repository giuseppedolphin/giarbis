// La frase di chiamata a voce: un prefisso più il nome, mai il nome da solo, così una parola qualsiasi trascritta
// come il nome non accende l'ascolto. Prefissi e nomi non sono scritti qui: vengono da chi().assistente
// (chiamata[], varianti.prefissi, varianti.nomi, alias, nome, slug). Il nome si riconosce anche staccato («gi ar bis»).
// È l'unico file che riconosce la chiamata: lo usano il cockpit e la bolla.

const cache = new Map();
const letterale = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const unici = (lista) => [...new Set(lista.map((x) => String(x || "").trim().toLowerCase()).filter(Boolean))];

// Il motivo (RegExp) che riconosce la chiamata dell'assistente descritto da `assistente`.
export function costruisciChiamata(assistente) {
  const a = assistente || {};
  const chiave = JSON.stringify([a.chiamata, a.varianti, a.alias, a.nome, a.slug]);
  if (cache.has(chiave)) return cache.get(chiave);
  const prefissi = [...(a.varianti?.prefissi || [])];
  const nomi = [...(a.varianti?.nomi || []), ...(a.alias || []), a.nome, a.slug];
  for (const frase of a.chiamata || []) {
    const parole = String(frase).trim().split(/\s+/);
    nomi.push(parole.pop());
    if (parole.length) prefissi.push(parole.join(" "));
  }
  const P = unici(prefissi).sort((x, y) => y.length - x.length).map(letterale);
  const N = unici(nomi).map((n) => n.replace(/\s+/g, "").split("").map(letterale).join("\\s?"));
  // Lettere accentate fuori da \b: il confine a sinistra si scrive a mano.
  const motivo = P.length && N.length
    ? new RegExp(String.raw`(?:^|[^\p{L}])(?:${P.join("|")})[\s,.:!'’-]*(?:${N.join("|")})(?![\p{L}])[\s,.:!]*`, "iu")
    : /(?!)/;
  cache.set(chiave, motivo);
  return motivo;
}

// → { trovata, resto }: resto è il testo dopo la frase di chiamata (tutto il testo se non c'è).
export function riconosciChiamata(testo, assistente) {
  const t = String(testo || "");
  const m = t.match(costruisciChiamata(assistente));
  return m ? { trovata: true, resto: t.slice(m.index + m[0].length) } : { trovata: false, resto: t };
}

// La chiamata come si scrive a schermo («Hey Nome»), dalla prima voce di chiamata[].
export function fraseChiamata(assistente) {
  const prima = assistente?.chiamata?.[0] || `hey ${assistente?.nome || "assistente"}`;
  return prima.replace(/(^|\s)(\p{L})/gu, (_, sp, c) => sp + c.toUpperCase());
}
