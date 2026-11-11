// Chi chiama l'API, nelle rotte dove conta chi scrive: un messaggio a una sessione, chi crea un agente o lo toglie, l'anello
// di avanzamento, una domanda, la bacheca e i diretti, il ponte, Telegram, un timer, la lavagna, un foglio, l'Artifax.
//
// Ogni sessione ha un token casuale, tenuto solo in memoria (mai su disco, mai nell'elenco né negli eventi): il server lo dà
// al processo dell'agente nell'ambiente, COCKPIT_TOKEN accanto a COCKPIT_SESSIONE, e il ctl lo rimanda su ogni richiesta
// nell'header X-Cockpit-Token. Le regole (chiChiama, corpoDi):
//   token di una sessione viva            → chi scrive è quella sessione; un nome dichiarato diverso è un 403
//   token che non è di nessuna sessione   → 403 (il server è ripartito, o il token è inventato)
//   senza token, il nome di una sessione  → 403: senza token nessuno scrive come un agente
//   senza token e senza nome              → la persona, dalla pagina (Origin della plancia) o da un terminale (senza Origin);
//                                           un nome che non è di nessuna sessione resta un'etichetta, come prima
//   Origin che non è la plancia, o Sec-Fetch-Site che non è same-origin → 403 (lo stesso controllo del terminale)
// Il limite: gli agenti girano come lo stesso utente del sistema. Uno che toglie COCKPIT_TOKEN e COCKPIT_SESSIONE dal proprio
// ambiente passa per un terminale della persona, e un processo locale può mandare qualunque Origin. Il token impedisce di
// farsi passare per un altro agente; contro chi vuole fingersi la persona resta una guardia contro gli errori.
//
// Con COCKPIT_PROVA=1 e COCKPIT_PROVA_SEME il token è ricavato dal seme e dal nome o dall'id della sessione (tokenProva): i
// controlli lo calcolano da soli, senza chiederlo al server. In prova non parte nessun processo.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { ErroreHttp } from "./rotte.mjs";

const token = new Map(); // id della sessione → token
const seme = () => (process.env.COCKPIT_PROVA === "1" ? String(process.env.COCKPIT_PROVA_SEME || "") : "");
export const tokenProva = (s, chiave) => createHash("sha256").update(`${s}:${chiave}`).digest("hex").slice(0, 48);

// Il token di una sessione, per l'ambiente del suo processo (nasce alla prima richiesta e vale finché il server è acceso).
export function tokenDi(s) {
  if (seme()) return tokenProva(seme(), s.nome);
  if (!token.has(s.id)) token.set(s.id, randomBytes(24).toString("hex"));
  return token.get(s.id);
}

const uguali = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
const validi = (s) => (seme() ? [tokenProva(seme(), s.nome), tokenProva(seme(), s.id)] : [tokenDi(s)]);

// L'origine di una richiesta del browser: se c'è l'header Origin deve essere la plancia stessa, e se c'è Sec-Fetch-Site deve
// essere «same-origin» (un foglio o la lavagna, in iframe sandbox, mandano Origin «null» e restano fuori).
export function origineAmmessa(req, porta, obbligatoria) {
  const o = req.headers.origin;
  const ammesse = [`http://127.0.0.1:${porta}`, `http://localhost:${porta}`];
  if (o === undefined) { if (obbligatoria) return false; } else if (!ammesse.includes(String(o).toLowerCase())) return false;
  const sito = req.headers["sec-fetch-site"];
  return sito === undefined || sito === "same-origin";
}

// → la sessione che chiama (token valido) oppure null (la persona, dalla pagina o da un terminale); 403 altrimenti
export function chiChiama(c, { cockpit, porta }) {
  if (!origineAmmessa(c.req, porta, false)) throw new ErroreHttp(403, "origine non ammessa");
  const t = c.req.headers["x-cockpit-token"];
  if (!t) return null;
  const s = [...cockpit.sessioni.values()].find((x) => validi(x).some((v) => uguali(t, v)));
  if (!s) throw new ErroreHttp(403, "token di sessione non valido (COCKPIT_TOKEN): sessione sconosciuta, o server ripartito dopo che il token è stato dato");
  return s;
}

// Il corpo della richiesta con `campo` (mittente, sessione, genitore, da) messo da chi chiama: il nome della sessione del token,
// oppure quello che c'era per la persona. Un nome dichiarato che non torna col token è un 403.
export async function corpoDi(c, nucleo, campo) {
  const b = await c.corpo(), chi = chiChiama(c, nucleo);
  const dich = String(b[campo] ?? "").trim(), dichiarata = dich ? nucleo.cockpit.trova(dich) : null;
  if (chi) {
    if (dich && dichiarata?.id !== chi.id) throw new ErroreHttp(403, `il token è della sessione ${chi.nome}, non di "${dich}": chi scrive lo dice il token, non il nome`);
    return { ...b, [campo]: chi.nome };
  }
  if (dichiarata) throw new ErroreHttp(403, `senza il token della sessione (COCKPIT_TOKEN) nessuno scrive come ${dichiarata.nome}`);
  return b;
}

// Una rotta che riguarda una sessione (l'anello di avanzamento): un agente la tocca solo se è la sua.
export function soloSeStessa(c, nucleo, s) {
  const chi = chiChiama(c, nucleo);
  if (chi && chi.id !== s.id) throw new ErroreHttp(403, `${chi.nome} non tocca la sessione ${s.nome}`);
}
