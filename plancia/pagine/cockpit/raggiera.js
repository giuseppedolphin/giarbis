// La disposizione delle sfere sulla mappa (mappa.js, layout): dove sta ogni sessione, in punti della mappa.
// Raggiera: l'assistente al centro; tu (a sinistra) e i capi della squadra tutt'intorno, gli
// agenti normali negli spazi fra loro, tutti ad angoli equidistanti, su un'ellisse più larga che alta (le etichette sono larghe).
// I figli di ognuno del primo giro (gli esecutori di un capo, i figli di un agente) gli stanno stretti attorno dalla parte di
// fuori, come un'isola: ognuno prende il posto libero più vicino al padre, senza stare sulla linea di un fratello. Il primo giro
// si allarga finché nessuna isola ne tocca un'altra, con più aria fra le isole che dentro. I livelli sotto (il figlio di un
// figlio) prendono il posto libero più vicino al padre, più fuori di lui. Le posizioni dipendono solo da chi c'è, in ordine di
// nascita: non saltano a ogni aggiornamento.
export const LARGO = 235, ALTO = 140; // l'ingombro di una sfera con nome e due righe di attività, in punti della mappa
const LARGO_E = 190, ALTO_E = 120; // quello di un esecutore della squadra: sfera più piccola, righe più strette (mappa.js)
// l'ingombro di una voce dell'albero: larghezza e altezza del riquadro sfera+etichetta, raggio della sfera (come raggioDi in mappa.js)
export const ingombro = (v) => v?.s?.squadra?.tipo === "esecutore" ? { w: LARGO_E, h: ALTO_E, r: 25 }
  : { w: LARGO, h: ALTO, r: v?.ruolo === "orchestratore" ? 46 : v?.ruolo === "tu" ? 22 : 30 };
const GIRO = 2 * Math.PI, ELLISSE = 1.9; // larghezza / altezza del primo giro
const DENTRO = 16, FRA = 60, ARIA = 40; // l'aria fra due riquadri: dentro un'isola, fra due isole, attorno ai livelli più sotto
const VENTAGLIO = 85 * Math.PI / 180; // quanto un figlio dell'isola si scosta dalla direzione verso fuori del padre
const verso = (a) => ((a % GIRO) + GIRO) % GIRO;
const tocca = (a, b, aria) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 + aria && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + aria;
// la linea a→b passa sopra la sfera di o (o non è uno dei due capi)
const sullaSfera = (a, b, o) => {
  const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((o.x - a.x) * dx + (o.y - a.y) * dy) / l));
  return Math.hypot(a.x + t * dx - o.x, a.y + t * dy - o.y) < o.r + 14;
};
// la linea a→b passa sopra la sfera di o o sul suo nome: il segmento taglia quel rettangolo
const sopra = (a, b, o) => {
  const m = Math.max(o.r + 12, o.w / 2 - 45), dx = b.x - a.x, dy = b.y - a.y;
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, a.x - o.x + m], [dx, o.x + m - a.x], [-dy, a.y - o.y + o.r + 12], [dy, o.y + o.r + 40 - a.y]]) {
    if (!p) { if (q < 0) return false; continue; }
    if (p < 0) t0 = Math.max(t0, q / p); else t1 = Math.min(t1, q / p);
    if (t0 > t1) return false;
  }
  return true;
};
// l'isola di un padre: lui in (0, 0) e i figli attorno, verso l'angolo dir; ognuno nel posto libero più vicino (la linea dal padre
// può passare sul nome di un fratello, non sulla sua sfera), poi i figli in ordine di nascita da una parte all'altra (se hanno
// tutti lo stesso ingombro)
function isola(padre, figli, dir) {
  const posti = [{ x: 0, y: 0, ...ingombro(padre) }], angoli = [0];
  for (let i = 1; i * 2.5 <= 85; i++) angoli.push(i * 2.5 * Math.PI / 180, -i * 2.5 * Math.PI / 180);
  for (const v of figli) {
    const m = ingombro(v); let preso = null;
    for (let rho = 60; !preso && rho < 6000; rho += 8) for (const t of angoli) {
      if (Math.abs(t) > VENTAGLIO) continue;
      const q = { x: Math.cos(dir + t) * rho, y: Math.sin(dir + t) * rho, ...m };
      if (posti.every((o) => !tocca(o, q, DENTRO)) && posti.slice(1).every((o) => !sullaSfera(posti[0], q, o) && !sullaSfera(posti[0], o, q))) { preso = q; break; }
    }
    posti.push(preso);
  }
  const presi = posti.slice(1);
  if (figli.every((v) => ingombro(v).w === ingombro(figli[0]).w)) presi.sort((x, y) => verso(Math.atan2(x.y, x.x) - dir + Math.PI) - verso(Math.atan2(y.y, y.x) - dir + Math.PI));
  return figli.map((v, i) => ({ v, q: presi[i] }));
}
// sessioni: quelle di S.sessioni; torna le voci dell'albero ({ k, s, nome, ruolo, padre }) e la posizione di ognuna
export function posizioni(sessioni, nomePersona) {
  const sess = [...sessioni].sort((a, b) => String(a.creata || "").localeCompare(String(b.creata || "")) || a.nome.localeCompare(b.nome));
  const figli = new Map(); const radice = "tu";
  const nodoDi = (s) => s.ruolo === "orchestratore" ? "j:" + s.id : "a:" + s.id;
  const perNome = new Map(sess.map((s) => [s.nome, s]));
  const voci = [{ k: radice, nome: nomePersona || "Tu", ruolo: "tu", padre: null }];
  for (const s of sess) {
    const p = s.ruolo === "orchestratore" ? radice : s.genitore && perNome.has(s.genitore) ? nodoDi(perNome.get(s.genitore)) : radice;
    voci.push({ k: nodoDi(s), s, nome: s.nome, ruolo: s.ruolo, padre: p });
  }
  for (const v of voci) if (v.padre) { if (!figli.has(v.padre)) figli.set(v.padre, []); figli.get(v.padre).push(v); }
  const figliDi = (k) => (figli.get(k) || []).filter((v) => v.ruolo !== "orchestratore");
  const j = voci.find((v) => v.ruolo === "orchestratore");
  const centro = j ? j.k : radice;
  // il primo giro: con l'assistente, tu e i capi sono le ancore e gli altri vanno negli spazi fra loro, a partire da destra
  const attorno = figliDi(centro);
  const ancore = j ? [voci[0], ...attorno.filter((v) => v.s?.squadra?.tipo === "capo")] : [];
  const altri = attorno.filter((v) => !ancore.includes(v));
  let fila = altri;
  if (ancore.length) {
    const A = ancore.length, lontano = (g) => Math.abs(Math.atan2(Math.sin(Math.PI + (g + 0.5) * GIRO / A), Math.cos(Math.PI + (g + 0.5) * GIRO / A)));
    const spazi = [...Array(A).keys()].sort((x, y) => lontano(x) - lontano(y) || x - y);
    const per = ancore.map(() => []);
    altri.forEach((v, i) => per[spazi[i % A]].push(v));
    fila = ancore.flatMap((v, i) => [v, ...per[i]]);
  }
  const giro = fila.map((v, i) => ({ v, a: verso((ancore.length ? Math.PI : -Math.PI / 2) + i * GIRO / fila.length) }));
  giro.sort((x, y) => x.a - y.a);
  // le isole si fanno una volta: la loro forma dipende solo dalla direzione del padre, non da quanto è largo il giro
  for (const g of giro) g.isola = isola(g.v, figliDi(g.v.k), Math.atan2(Math.sin(g.a), Math.cos(g.a) * ELLISSE));
  const punto = (g, s1) => ({ x: Math.cos(g.a) * s1 * ELLISSE, y: Math.sin(g.a) * s1 });
  const gruppo = (g, s1) => {
    const p = punto(g, s1);
    return [{ ...p, ...ingombro(g.v) }, ...g.isola.map(({ v, q }) => ({ x: p.x + q.x, y: p.y + q.y, ...ingombro(v) }))];
  };
  // ognuno del primo giro, dall'isola più grande alla più piccola, si allontana dal centro finché la sua isola non tocca quelle già
  // messe e non sta sulla direzione di un altro del giro (la sua linea dal centro resta libera): le isole piccole restano vicine
  const fermi = [[{ x: 0, y: 0, ...ingombro(j || voci[0]) }]], c0 = fermi[0][0];
  const scontro = (i, a) => fermi.some((b) => a.some((o) => b.some((u) => tocca(o, u, FRA))))
    || giro.some((g, k) => k !== i && a.some((o) => sopra(c0, punto(g, 1e4), o))) || a.slice(1).some((o) => sopra(c0, a[0], o));
  const ordine = [...giro.keys()].sort((x, y) => giro[y].isola.length - giro[x].isola.length || x - y);
  for (const i of ordine) {
    let s1 = 100;
    for (let n = 0; n < 100 && scontro(i, gruppo(giro[i], s1)); n++) s1 *= 1.04;
    giro[i].s1 = s1; fermi.push(gruppo(giro[i], s1));
  }
  const pos = new Map([[centro, { x: 0, y: 0 }]]), fetta = new Map(); // fetta: [da, a] in angolo, metà strada verso i vicini del giro
  const meta = (x, y) => verso(y - x) / 2 || Math.PI;
  giro.forEach((g, i) => {
    const p = punto(g, g.s1);
    pos.set(g.v.k, p);
    const f0 = g.a - meta(giro[(i - 1 + giro.length) % giro.length].a, g.a), f1 = g.a + meta(g.a, giro[(i + 1) % giro.length].a);
    fetta.set(g.v.k, [f0, f1]);
    const passo = (f1 - f0) / (g.isola.length || 1);
    g.isola.forEach(({ v, q }, k) => { pos.set(v.k, { x: p.x + q.x, y: p.y + q.y }); fetta.set(v.k, [f0 + k * passo, f0 + (k + 1) * passo]); });
  });
  // i livelli più sotto, un livello alla volta e un figlio per padre a giro: ognuno prende il posto libero più vicino al padre, più
  // fuori di lui, in un ventaglio largo una volta e mezza la sua fetta; poi i figli di uno stesso padre si mettono in ordine d'angolo
  const voce = new Map(voci.map((v) => [v.k, v]));
  const occupati = [...pos].map(([k, p]) => ({ ...p, ...ingombro(voce.get(k)) }));
  const libero = (q) => occupati.every((o) => !tocca(o, q, ARIA));
  const scoperta = (a, b) => occupati.every((o) => (o.x === a.x && o.y === a.y) || !sopra(a, b, o)); // la linea padre-figlio non passa sopra un'altra sfera
  const angolo = (q) => Math.atan2(q.y, q.x / ELLISSE);
  for (let livello = giro.flatMap((g) => g.isola.map(({ v }) => v.k)); livello.length;) {
    const famiglie = livello.map((k) => ({ k, f: figliDi(k), presi: [] })).filter((x) => x.f.length);
    for (let turno = 0; famiglie.some((x) => x.presi.length < x.f.length); turno++) for (const fam of famiglie) {
      if (turno >= fam.f.length) continue;
      const m = ingombro(fam.f[turno]);
      const pp = pos.get(fam.k), dp = Math.hypot(pp.x, pp.y), ap = angolo(pp), [f0, f1] = fetta.get(fam.k), largo = (f1 - f0) * 0.75;
      let meglio = null, dm = Infinity;
      for (let r = Math.hypot(pp.x / ELLISSE, pp.y) + 20; r < 6000 && !(meglio && r - dp > dm * 1.5); r += 15) for (let t = -1; t <= 1; t += 1 / 24) {
        const b = ap + t * largo, q = { x: Math.cos(b) * r * ELLISSE, y: Math.sin(b) * r, ...m }, d = Math.hypot(q.x - pp.x, q.y - pp.y);
        if (d < dm && Math.hypot(q.x, q.y) > dp + m.h / 2 && q.x * pp.x + q.y * pp.y > 0 && libero(q) && scoperta(pp, q)) { meglio = q; dm = d; }
      }
      fam.presi.push(meglio); occupati.push(meglio);
    }
    for (const fam of famiglie) {
      const pp = pos.get(fam.k), ap = Math.atan2(pp.y, pp.x); // l'ordine d'angolo attorno al padre, da una parte all'altra della direzione verso fuori
      const a = (q) => verso(Math.atan2(q.y - pp.y, q.x - pp.x) - ap + Math.PI);
      if (fam.f.every((v) => ingombro(v).w === ingombro(fam.f[0]).w)) fam.presi.sort((x, y) => a(x) - a(y));
      const [f0, f1] = fetta.get(fam.k), passo = (f1 - f0) / fam.f.length;
      fam.f.forEach((v, i) => { pos.set(v.k, { x: fam.presi[i].x, y: fam.presi[i].y }); fetta.set(v.k, [f0 + i * passo, f0 + (i + 1) * passo]); });
    }
    livello = famiglie.flatMap((x) => x.f.map((v) => v.k));
  }
  return { voci, pos };
}
// Le sfere spostate a mano (salvate sul server, rotte/posti.mjs): la chiave stabile di una voce, la stessa che
// il server pota quando la sessione sparisce. Persona, assistente e ruoli della squadra per nome, gli altri per id di sessione.
export const chiavePosto = (v) => v.ruolo === "tu" ? "tu" : v.ruolo === "orchestratore" ? "assistente"
  : v.ruolo === "squadra" ? `squadra:${v.s?.nome || v.nome}` : `s:${v.s?.id}`;
// la posizione di una sfera spostata a mano vince su quella automatica; le altre restano dove le mette la raggiera.
// posti: Map chiave → { x, y }; torna le posizioni finali e le chiavi dei nodi (k) messi a mano
export function conPosti(voci, pos, posti) {
  const fuori = new Map(pos), mano = new Set();
  for (const v of voci) {
    const p = posti?.get(chiavePosto(v));
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) { fuori.set(v.k, { x: p.x, y: p.y }); mano.add(v.k); }
  }
  return { pos: fuori, mano };
}
