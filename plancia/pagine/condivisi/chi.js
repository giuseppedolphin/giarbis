// Chi usa la pagina e come si chiama l'assistente: GET /api/chi, una volta sola (poi cache).
// Il nome dell'assistente nell'interfaccia viene sempre da qui, mai scritto nel codice.
import { api } from "./api.js";

// Cosa vale con un server che non risponde (o che non conosce ancora /api/chi).
const NEUTRO = {
  ok: false, slug: "", nome: "", email: "", pagina: "/", moduli: [],
  assistente: { nome: "Assistente", slug: "assistente", chiamata: ["hey assistente"], varianti: { prefissi: ["hey"], nomi: ["assistente"] }, alias: [] },
};

let cache = null;

export function chi() {
  if (cache) return cache;
  cache = api("GET", "/api/chi")
    .then((j) => ({ ...NEUTRO, ...j, assistente: { ...NEUTRO.assistente, ...(j.assistente || {}) }, moduli: j.moduli || [] }))
    .catch(() => { cache = null; return NEUTRO; });
  return cache;
}

// «Ciao <persona>, sono <assistente>.»
export function saluto(c) {
  const nome = c.assistente?.nome || NEUTRO.assistente.nome;
  return c.nome ? `Ciao ${c.nome}, sono ${nome}.` : `Ciao, sono ${nome}.`;
}
