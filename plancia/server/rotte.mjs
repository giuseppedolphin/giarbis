// Il registro delle rotte HTTP. Ogni rotta è { metodo, percorso, guardia, gestore }:
//   percorso  "/api/fogli/:id/chiudi" (i :parametri valgono un segmento) oppure una RegExp sul percorso
//   guardia   "dashboard" (default per /api/…: vuole l'header X-Dashboard: 1) | "locale" (basta l'Host giusto)
//   gestore   async (c) → c = { req, res, url, parametri, corpo(), grezzo(limite), json(codice, oggetto), invia(codice, tipo, dati) }
// Se il gestore restituisce un oggetto e non ha risposto, il router manda 200 { ok: true, ...oggetto }; se lancia,
// 400 { ok: false, errore }. L'Host diverso da 127.0.0.1:<porta> o localhost:<porta> prende 403 prima di tutto
// (il «DNS rebinding»: un sito esterno che punta il suo DNS qui). X-Dashboard non lo può mandare un sito esterno
// senza un preflight CORS, che qui non viene mai concesso.
import { Readable } from "node:stream";

const LIMITE_JSON = 1e6; // 1 MB per i corpi JSON

class ErroreHttp extends Error {
  constructor(codice, messaggio) { super(messaggio); this.codice = codice; }
}

function compila(percorso) {
  if (percorso instanceof RegExp) return (p) => { const m = p.match(percorso); return m ? { ...m.slice(1), ...(m.groups || {}) } : null; };
  const nomi = [];
  const sorgente = String(percorso).split("/").map((seg) => {
    if (!seg.startsWith(":")) return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    nomi.push(seg.slice(1));
    return "([^/]+)";
  }).join("/");
  const re = new RegExp(`^${sorgente}$`);
  return (p) => {
    const m = p.match(re);
    if (!m) return null;
    const out = {};
    nomi.forEach((n, i) => { try { out[n] = decodeURIComponent(m[i + 1]); } catch { out[n] = m[i + 1]; } });
    return out;
  };
}

export function creaRouter({ porta }) {
  const rotte = [];
  const hostAmmessi = new Set([`127.0.0.1:${porta}`, `localhost:${porta}`]);

  function aggiungi(elenco) {
    for (const r of Array.isArray(elenco) ? elenco : [elenco]) {
      if (!r || typeof r.gestore !== "function" || r.percorso === undefined) throw new Error("rotta senza percorso o gestore");
      const guardia = r.guardia || null;
      if (guardia && guardia !== "dashboard" && guardia !== "locale") throw new Error(`guardia sconosciuta: ${guardia}`);
      rotte.push({ metodo: String(r.metodo || "GET").toUpperCase(), guardia, gestore: r.gestore, trova: compila(r.percorso) });
    }
  }

  function contesto(req, res, url, parametri) {
    const json = (codice, oggetto) => {
      res.writeHead(codice, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(oggetto));
    };
    const grezzo = (limite = LIMITE_JSON) => new Promise((ok, no) => {
      const pezzi = []; let tot = 0, finito = false;
      req.on("data", (d) => {
        if (finito) return;
        tot += d.length;
        if (tot > limite) {
          finito = true; pezzi.length = 0;
          // si risponde 413 e si chiude davvero il socket, senza aspettare il resto del corpo
          if (!res.headersSent) {
            res.writeHead(413, { "content-type": "application/json; charset=utf-8", connection: "close" });
            res.end(JSON.stringify({ ok: false, errore: "corpo troppo grande" }));
          }
          res.on("finish", () => req.destroy());
          return no(new ErroreHttp(413, "corpo troppo grande"));
        }
        pezzi.push(d);
      });
      req.on("end", () => { if (!finito) ok(Buffer.concat(pezzi)); });
      req.on("error", no);
    });
    const corpo = async () => {
      const testo = (await grezzo(LIMITE_JSON)).toString("utf8");
      try { const o = JSON.parse(testo || "{}"); return o && typeof o === "object" && !Array.isArray(o) ? o : {}; } catch { return {}; }
    };
    const invia = (codice, tipo, dati, intestazioni = {}) => {
      res.writeHead(codice, { "content-type": tipo, ...intestazioni });
      if (dati instanceof Readable) dati.pipe(res); else res.end(dati);
    };
    return { req, res, url, parametri, corpo, grezzo, json, invia };
  }

  // → true se la richiesta è stata gestita (anche con un errore), false se nessuna rotta la riguarda
  async function gestisci(req, res) {
    if (!hostAmmessi.has(String(req.headers.host || "").toLowerCase())) {
      res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, errore: "Host non ammesso" }));
      return true;
    }
    const url = new URL(req.url, `http://127.0.0.1:${porta}`);
    for (const r of rotte) {
      if (r.metodo !== "*" && r.metodo !== req.method) continue;
      const parametri = r.trova(url.pathname);
      if (!parametri) continue;
      const guardia = r.guardia || (url.pathname.startsWith("/api/") ? "dashboard" : "locale");
      if (guardia === "dashboard" && req.headers["x-dashboard"] !== "1") {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, errore: "header X-Dashboard mancante" }));
        return true;
      }
      const c = contesto(req, res, url, parametri);
      try {
        const risultato = await r.gestore(c);
        if (!res.headersSent && risultato && typeof risultato === "object") c.json(200, { ok: true, ...risultato });
      } catch (e) {
        if (!res.headersSent) c.json(e instanceof ErroreHttp ? e.codice : 400, { ok: false, errore: e.message });
      }
      return true;
    }
    return false;
  }

  return { aggiungi, gestisci };
}
