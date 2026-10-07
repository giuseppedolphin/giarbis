// Le voci in più della barra comune. Il nucleo mostra solo cockpit, Artifax, Consumo, Voce e tema; i moduli aggiungono
// le loro pagine chiamando registraVoceBarra() dalla propria pagina.js (la barra le carica da /api/chi), e possono
// dare un nome al marchio con impostaMarchio().

const voci = [];
const eventi = new EventTarget();
let marchio = "Plancia";

// { href, nome, chi?, ordine? }: chi è l'etichetta piccola accanto al nome; le voci si ordinano per `ordine` (predefinito 50,
// il cockpit sta a 100). Registrare due volte lo stesso href sostituisce la voce.
export function registraVoceBarra(voce) {
  const i = voci.findIndex((v) => v.href === voce.href);
  if (i >= 0) voci.splice(i, 1);
  voci.push({ ordine: 50, chi: "", ...voce });
  eventi.dispatchEvent(new Event("cambia"));
}

export function impostaMarchio(testo) {
  marchio = String(testo || marchio);
  eventi.dispatchEvent(new Event("cambia"));
}

export const vociBarra = () => [...voci].sort((a, b) => a.ordine - b.ordine);
export const marchioBarra = () => marchio;
export const suBarra = (fn) => eventi.addEventListener("cambia", fn);
