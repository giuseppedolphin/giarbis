// Le sfere spostate a mano sulla mappa: la chiave stabile e la precedenza sul layout automatico
// (raggiera.js, chiavePosto e conPosti: modulo puro), la rotta /api/posti (salva, valida, riordina una o tutte, pota le sessioni
// rimosse) su un server di prova con COCKPIT_PROVA, e i fili nella pagina (posti.js, mappa.js, «Riordina» in index.html).
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const D = { "x-dashboard": "1" };

export default async function (t) {
  const cartella = path.join(t.plancia, "pagine", "cockpit");
  const { posizioni, chiavePosto, conPosti } = await import(pathToFileURL(path.join(cartella, "raggiera.js")).href);

  // ───── logica: chiave stabile e precedenza ─────
  const s = (id, nome, ruolo, genitore = "", squadra) => ({ id, nome, ruolo, genitore, creata: `2026-10-30T10:0${id.length}:00Z`, ...(squadra ? { squadra: { tipo: squadra } } : {}) });
  const sessioni = [s("g1", "pilota", "orchestratore"), s("c1", "capo", "squadra", "pilota", "capo"), s("e1", "social", "squadra", "capo", "esecutore"), s("a1", "ricerca", "agente", "pilota")];
  const { voci, pos } = posizioni(sessioni, "Tester");
  const k = (nome) => voci.find((v) => v.nome === nome);
  t.ok(chiavePosto(k("Tester")) === "tu" && chiavePosto(k("pilota")) === "assistente", "chiave: la persona «tu», l'assistente «assistente»");
  t.ok(chiavePosto(k("capo")) === "squadra:capo" && chiavePosto(k("social")) === "squadra:social", "chiave: un ruolo della squadra per nome");
  t.ok(chiavePosto(k("ricerca")) === "s:a1", "chiave: un agente per id di sessione");
  const posti = new Map([["s:a1", { x: 900, y: -700 }], ["squadra:capo", { x: -50, y: 600 }], ["s:sparita", { x: 1, y: 1 }]]);
  const fuori = conPosti(voci, pos, posti);
  t.ok(fuori.pos.get(k("ricerca").k).x === 900 && fuori.pos.get(k("ricerca").k).y === -700, "una sfera spostata sta dove l'ha messa la persona");
  t.ok(fuori.pos.get(k("capo").k).y === 600, "anche un capo della squadra");
  const ferme = voci.filter((v) => !["ricerca", "capo"].includes(v.nome));
  t.ok(ferme.every((v) => fuori.pos.get(v.k).x === pos.get(v.k).x && fuori.pos.get(v.k).y === pos.get(v.k).y), "le altre restano dove le mette la raggiera (anche gli esecutori del capo spostato)");
  t.ok(fuori.mano.size === 2 && fuori.mano.has(k("ricerca").k) && fuori.pos.size === pos.size, "a mano solo le due spostate; una posizione di una sessione che non c'è non aggiunge sfere");
  const vuoto = conPosti(voci, pos, new Map());
  t.ok(!vuoto.mano.size && voci.every((v) => vuoto.pos.get(v.k).x === pos.get(v.k).x), "senza posizioni salvate il layout è quello di sempre");
  t.ok(!conPosti(voci, pos, new Map([["s:a1", { x: NaN, y: 3 }]])).mano.size, "una posizione rotta si ignora");

  // ───── la rotta ─────
  const srv = await t.avviaServer({});
  const get = async () => (await t.get(srv.base, "/api/posti", D)).json();
  const post = (p, corpo) => t.post(srv.base, p, corpo, D);
  t.ok(Object.keys((await get()).posti).length === 0, "GET /api/posti: vuoto all'inizio");
  const ctl = (args) => t.ctl(args, { COCKPIT_STATO: srv.stato });
  t.ok(ctl(["crea", "uno", "primo compito"]).codice === 0 && ctl(["crea", "due", "secondo compito"]).codice === 0, "crea gli agenti uno e due");
  const elenco = (await (await t.get(srv.base, "/api/sessioni", D)).json()).sessioni;
  const id = (nome) => elenco.find((x) => x.nome === nome).id;
  for (const [chiave, x, y] of [["tu", -400.4, 10], ["assistente", 5, 5], [`s:${id("uno")}`, 300, 200], [`s:${id("due")}`, -300, 250]]) {
    t.ok((await post("/api/posti", { chiave, x, y })).codice === 200, `POST /api/posti ${chiave}`);
  }
  let p = (await get()).posti;
  t.ok(p.tu.x === -400 && p[`s:${id("uno")}`].y === 200 && Object.keys(p).length === 4, "le posizioni si rileggono, arrotondate");
  t.ok((await post("/api/posti", { chiave: "../x", x: 1, y: 1 })).codice === 400, "chiave non valida: 400");
  t.ok((await post("/api/posti", { chiave: "tu", x: "a", y: 1 })).codice === 400, "x non numerico: 400");
  t.ok((await post("/api/posti", { chiave: "tu", x: 1e9, y: 1 })).codice === 400, "x oltre il limite: 400");
  t.ok((await post("/api/posti/riordina", { chiave: "assistente" })).codice === 200 && !(await get()).posti.assistente, "riordina una sola sfera");
  t.ok((await post(`/api/sessioni/${id("due")}/rimuovi`, {})).codice === 200, "due rimosso dalla mappa");
  p = (await get()).posti;
  t.ok(!p[`s:${id("due")}`] && p[`s:${id("uno")}`], "una sessione rimossa perde la sua posizione, le altre restano");
  t.ok((await post("/api/posti", { chiave: "s:mai-esistita", x: 1, y: 1 })).codice === 200 && !(await get()).posti["s:mai-esistita"], "una chiave di una sessione che non c'è non si conserva");
  t.ok((await post("/api/posti/riordina", {})).codice === 200 && !Object.keys((await get()).posti).length, "riordina tutte: torna il layout automatico");

  // ───── i fili nella pagina ─────
  const mappa = readFileSync(path.join(cartella, "mappa.js"), "utf8"), modulo = readFileSync(path.join(cartella, "posti.js"), "utf8");
  const html = readFileSync(path.join(cartella, "index.html"), "utf8");
  t.ok(/conPosti\(voci, auto\.pos, PO\.POSTI\)/.test(mappa) && /M\.trascina === v\.k/.test(mappa), "mappa.js: layout con le posizioni salvate e la sfera trascinata lasciata stare");
  t.ok(/PO\.prendi\(/.test(mappa) && /PO\.muovi\(/.test(mappa) && /PO\.lascia\(/.test(mappa) && /pointercancel/.test(mappa), "mappa.js: presa, spostamento, rilascio e gesto annullato");
  t.ok(/Math\.hypot\(dx, dy\) > 4/.test(mappa) && /if \(pan && !pan\.mosso\)/.test(mappa), "mappa.js: sotto la soglia resta un clic");
  t.ok(/id="m-riordina" hidden/.test(html) && /id="sn-posto"/.test(mappa), "«Riordina» accanto a «Centra» e «Al suo posto» nella scheda");
  t.ok(!/confirm\(/.test(modulo) && /\/api\/posti\/riordina/.test(modulo), "posti.js: niente confirm(), riordina sul server");
}
