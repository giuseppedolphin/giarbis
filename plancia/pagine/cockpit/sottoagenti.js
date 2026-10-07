// I sotto-agenti sulla mappa: subagenti e workflow lanciati dentro una sessione (sessione.sotto), con fasi, gruppi e scheda.
import { $, COL, RIDOTTO, TEMA, nomeModello, nomeSessione } from "./comune.js";
import { M, chiudiScheda, posizionaScheda, puntoCurva, raggioDi, schermo } from "./mappa.js";
import { esc, tempoFa } from "/condivisi/formati.js";

// ---- i sotto-agenti: subagenti (Agent) e workflow (Workflow) lanciati dentro una sessione -----------------
// Il server li ricostruisce dallo stream-json (plancia/server/sottoagenti.mjs) e li manda in `sessione.sotto`. Sulla mappa
// sono piccoli nodi figli della sfera, dal lato opposto ai timer: un subagente è una pallina; un workflow è una pallina con
// l'anello di avanzamento, poi le sue fasi in fila, poi sotto ogni fase i suoi agenti, legati a chi li ha preceduti in una
// pipeline (review → verify) o alla fase. Più di 10 figli insieme diventano un nodo-gruppo: un clic li apre, un altro li richiude.
// I nodi finiti restano un paio di minuti e poi sfumano; restano nella scheda della sessione, da dove si riportano sulla mappa.
const SA = { pos: [], anim: new Map(), espansi: new Set(), fissati: new Set(), sel: null, RESTA: 120000, SFUMA: 30000, MAXG: 10, RIGHE: 20 };
// MAXG: oltre, un gruppo; RIGHE: una colonna aperta va a capo
const COL_SA = { lavora: COL.lavora, attesa: COL.ferma, fatto: COL.fatto, errore: COL.errore, fermo: COL.ferma };
const STATO_SA = { lavora: "in corso", attesa: "in coda", fatto: "finito", errore: "errore", fermo: "fermato" };
function durataTesto(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const s = Math.round(ms / 1000); if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60); if (m < 60) return `${m} min${s % 60 ? ` ${s % 60} s` : ""}`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
const durataSA = (x) => durataTesto(x.durata ?? ((x.fine || Date.now()) - (x.inizio || Date.now())));
const statoFase = (membri) => (membri.length && membri.every((x) => x.stato === "fatto") ? "fatto"
  : membri.some((x) => x.stato === "lavora") ? "lavora" : membri.some((x) => x.stato === "errore") ? "errore" : "attesa");
const statoGruppoFase = (membri, fatti) => (membri.some((x) => x.stato === "lavora") ? "lavora"
  : membri.some((x) => x.stato === "errore") ? "errore" : fatti === membri.length ? "fatto" : "attesa");
// il pallino colorato davanti a un sotto-agente nelle liste
const pallino = (stato) => '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:6px;'
  + `background:rgb(${(COL_SA[stato] || COL.ferma).join(",")})"></span>`;
// quanto si vede una radice: in corso piena, finita piena per RESTA, poi sfuma; fissata dalla scheda resta
function visibilitaSA(r, adesso) {
  if (SA.fissati.has(r.id)) return 1;
  if (r.stato === "lavora") return 1;
  const eta = adesso - (r.fine || r.inizio || 0);
  return eta < SA.RESTA ? 1 : Math.max(0, 1 - (eta - SA.RESTA) / SA.SFUMA);
}
// i punti del sotto-albero nel mondo: un sistema di riferimento locale (u = verso l'esterno, v = di traverso) attaccato alla sfera
function layoutSotto(n, adesso) {
  const radici = (n.s.sotto || []).map((r) => ({ r, a: visibilitaSA(r, adesso) })).filter((x) => x.a > 0.01).sort((
    a,
    b
  ) => (a.r.inizio || 0) - (b.r.inizio || 0));
  if (!radici.length) return [];
  // un piccolo diagramma di flusso appeso sotto l'etichetta della sfera: scorre in orizzontale verso il lato del genitore
  // (dall'altro lato ci sono i figli della sessione), le colonne scendono. u = orizzontale, v = verso il basso.
  const padre = n.padre && M.nodi.get(n.padre);
  const sx = padre && n.x < padre.x ? 1 : -1;
  const sotto = raggioDi(n) + 88;
  const P = (du, dv) => ({ x: n.x + sx * du, y: n.y + sotto + dv });
  const out = []; // {k, tipo, x, y, r, stato, alpha, da, dati}
  const D0 = 30; // un passo verso il lato libero: i rami dei figli partono dall'altra parte
  let offV = 0;
  const agentiRadice = radici.filter((x) => x.r.tipo !== "workflow"), workflow = radici.filter((x) => x.r.tipo === "workflow");
  // i subagenti diretti: uno per riga, o un gruppo se sono troppi
  const gruppoRadice = "g:" + n.s.id;
  if (agentiRadice.length > SA.MAXG && !SA.espansi.has(gruppoRadice)) {
    const l = agentiRadice.map((x) => x.r), fatti = l.filter((r) => r.stato !== "lavora").length, errori = l.some((r) => r.stato === "errore");
    out.push({
      k: gruppoRadice,
      tipo: "gruppo",
      ...P(D0, offV),
      r: 9,
      stato: fatti < l.length ? "lavora" : errori ? "errore" : "fatto",
      alpha: Math.max(...agentiRadice.map((x) => x.a)),
      da: "sfera",
      dati: { titolo: "Subagenti", l, fatti }
    });
    offV += 30;
  } else {
    const espanso = agentiRadice.length > SA.MAXG;
    if (espanso) out.push({
      k: gruppoRadice,
      tipo: "gruppo",
      ...P(D0, offV),
      r: 6,
      stato: "fermo",
      alpha: 0.8,
      da: "sfera",
      aperto: true,
      dati: { titolo: "Subagenti", l: agentiRadice.map((x) => x.r), fatti: agentiRadice.filter((x) => x.r.stato !== "lavora").length }
    });
    agentiRadice.forEach((x, i) => {
      const col = espanso ? Math.floor(i / SA.RIGHE) : 0, riga = espanso ? i % SA.RIGHE : i;
      out.push({
        k: "r:" + x.r.id,
        tipo: "agente",
        ...P(D0 + (espanso ? 26 + col * 22 : 0), offV + (espanso ? (riga + 1) * 20 : riga * 26)),
        r: 6.5,
        stato: x.r.stato,
        alpha: x.a,
        da: espanso ? gruppoRadice : "sfera",
        dati: x.r
      });
    });
    offV += espanso ? (Math.min(agentiRadice.length, SA.RIGHE) + 1) * 20 + 14 : agentiRadice.length * 26;
  }
  // i workflow: radice → fasi in fila lungo u → agenti in colonna sotto la propria fase
  for (const { r, a } of workflow) {
    const radice = "r:" + r.id;
    out.push({ k: radice, tipo: "workflow", ...P(D0, offV), r: 8, stato: r.stato, alpha: a, da: "sfera", dati: r });
    const agenti = r.agenti || [];
    const fasi = [...(r.fasi || [])];
    if (agenti.some((x) => x.fase == null || !fasi.some((f) => f.i === x.fase))) fasi.unshift({ i: null, titolo: "" });
    let du = D0, altezza = 24;
    let prec = radice;
    for (const f of fasi) {
      const membri = agenti.filter((x) => (f.i == null ? x.fase == null || !fasi.some((g) => g.i != null && g.i === x.fase) : x.fase === f.i));
      du += 54;
      const kf = `f:${r.id}:${f.i}`;
      if (f.i != null) {
        out.push({
          k: kf,
          tipo: "fase",
          ...P(du, offV),
          r: 3.2,
          stato: statoFase(membri),
          alpha: a,
          da: prec,
          dati: { ...f, membri, wf: r }
        });
        prec = kf;
      }
      const ancora = f.i != null ? kf : radice;
      const kg = `g:${r.id}:${f.i}`;
      if (membri.length > SA.MAXG && !SA.espansi.has(kg)) {
        const fatti = membri.filter((x) => x.stato === "fatto" || x.stato === "errore" || x.stato === "fermo").length;
        out.push({
          k: kg,
          tipo: "gruppo",
          ...P(du, offV + 26),
          r: 8,
          stato: statoGruppoFase(membri, fatti),
          alpha: a,
          da: ancora,
          dati: { titolo: f.titolo || "Agenti", l: membri, fatti, wf: r }
        });
        altezza = Math.max(altezza, 50); du += 10;
        continue;
      }
      const espanso = membri.length > SA.MAXG;
      if (espanso) out.push({
        k: kg,
        tipo: "gruppo",
        ...P(du, offV + 20),
        r: 5,
        stato: "fermo",
        alpha: a * 0.8,
        da: ancora,
        aperto: true,
        dati: { titolo: f.titolo || "Agenti", l: membri, fatti: membri.filter((x) => x.stato !== "lavora" && x.stato !== "attesa").length, wf: r }
      });
      membri.forEach((x, j) => {
        const col = Math.floor(j / SA.RIGHE), riga = j % SA.RIGHE;
        // a monte: l'agente che l'ha preceduto nella pipeline; se no la colonna stessa (la fase, o il compagno sopra)
        const kup = x.da != null && agenti.some((y) => y.i === x.da) ? `a:${r.id}:${x.da}` : riga ? `a:${r.id}:${membri[j - 1].i}` : espanso ? kg : ancora;
        out.push({ k: `a:${r.id}:${x.i}`, tipo: "agente-wf", ...P(
          du + col * 20,
          offV + (espanso ? 20 : 0) + (riga + 1) * 20
        ), r: 5, stato: x.stato, alpha: a * (r.stato === "lavora" && x.stato === "fatto" ? 0.75 : 1), da: kup, dati: { ...x, wf: r } });
      });
      const colonne = Math.max(1, Math.ceil(membri.length / SA.RIGHE));
      du += (colonne - 1) * 20;
      altezza = Math.max(altezza, (Math.min(membri.length, SA.RIGHE) + (espanso ? 2 : 1)) * 20 + 14);
    }
    offV += altezza + 14;
  }
  for (const q of out) q.sx = sx;
  return out;
}
function cerchioSA(cx, p, r, colore, alpha) {
  const g = cx.createRadialGradient(p.x - r * 0.3, p.y - r * 0.35, r * 0.1, p.x, p.y, r);
  g.addColorStop(0, `rgba(${colore.map((x) => Math.min(255, x + 90))},${alpha})`);
  g.addColorStop(0.55, `rgba(${colore},${0.95 * alpha})`);
  g.addColorStop(1, `rgba(${colore.map((x) => x * 0.3 | 0)},${0.95 * alpha})`);
  cx.beginPath(); cx.arc(p.x, p.y, r, 0, Math.PI * 2); cx.fillStyle = g; cx.fill();
}
function disegnaSotto(cx, t) {
  SA.pos = [];
  const adesso = Date.now(), z = Math.min(1.3, M.cam.z), zt = Math.max(0.75, Math.min(1.25, M.cam.z)), vivi = new Set();
  for (const n of M.nodi.values()) {
    if (!n.s || !(n.s.sotto || []).length) continue;
    const punti = layoutSotto(n, adesso); if (!punti.length) continue;
    const per = new Map();
    for (const q of punti) { // si muovono verso il loro posto, e nascono dalla sfera
      const k = n.s.id + "|" + q.k; vivi.add(k);
      const a = SA.anim.get(k) || { x: n.x, y: n.y }; a.x += (q.x - a.x) * 0.14; a.y += (q.y - a.y) * 0.14; SA.anim.set(k, a);
      per.set(q.k, { ...q, p: schermo(a.x, a.y), R: q.r * Math.max(0.8, z) });
    }
    const sfera = schermo(n.x, n.y), rs = raggioDi(n) * M.cam.z;
    // i legami: dalla sfera alle radici un tentacolo sottile e curvo, dentro il workflow linee dritte
    for (const q of per.values()) {
      const colore = COL_SA[q.stato] || COL.ferma;
      cx.save(); cx.lineCap = "round";
      if (q.da === "sfera") {
        const f = puntoCurva(sfera, q.p, q.k.length, t), c = f(0).c;
        const g = cx.createLinearGradient(sfera.x, sfera.y, q.p.x, q.p.y);
        g.addColorStop(0, `rgba(${TEMA.sonar},${0.25 * q.alpha})`);
        g.addColorStop(1, `rgba(${colore},${0.5 * q.alpha})`);
        cx.strokeStyle = g;
        cx.lineWidth = 1.6 * z;
        cx.beginPath();
        cx.moveTo(sfera.x, sfera.y);
        cx.quadraticCurveTo(c.x, c.y, q.p.x, q.p.y);
        cx.stroke();
      } else if (per.has(q.da)) {
        const a = per.get(q.da).p;
        cx.strokeStyle = `rgba(${colore},${(q.tipo === "fase" ? 0.35 : 0.42) * q.alpha})`; cx.lineWidth = 1 * z;
        cx.beginPath(); cx.moveTo(a.x, a.y); cx.lineTo(q.p.x, q.p.y); cx.stroke();
      }
      cx.restore();
    }
    for (const q of per.values()) {
      const colore = COL_SA[q.stato] || COL.ferma, { p, R, alpha } = q;
      SA.pos.push({ x: p.x, y: p.y, r: R, q, sess: n.s });
      cx.save();
      if (q.tipo === "fase") {
        cx.beginPath(); cx.arc(p.x, p.y, R, 0, Math.PI * 2); cx.fillStyle = `rgba(${colore},${0.85 * alpha})`; cx.fill();
        cx.font = `${Math.round(10.5 * zt)}px Instrument Sans, sans-serif`; cx.fillStyle = `rgba(${TEMA.testo2},${alpha})`; cx.textAlign = "center";
        cx.fillText(q.dati.titolo, p.x, p.y - 8 * zt);
        cx.restore(); continue;
      }
      const vivo = q.stato === "lavora";
      if (vivo && !RIDOTTO.matches && !q.aperto) {
        const k = ((t + q.k.length * 170) % 1500) / 1500;
        cx.beginPath();
        cx.arc(p.x, p.y, R * (1 + k * 1.1), 0, Math.PI * 2);
        cx.strokeStyle = `rgba(${colore},${(1 - k) * 0.5 * alpha})`;
        cx.lineWidth = 1.2;
        cx.stroke();
      }
      if (q.aperto) { // un gruppo aperto: solo un cerchietto vuoto da cliccare per richiudere
        cx.beginPath();
        cx.arc(p.x, p.y, R, 0, Math.PI * 2);
        cx.strokeStyle = `rgba(${COL.ferma},${0.8 * alpha})`;
        cx.lineWidth = 1.2;
        cx.setLineDash([2, 2]);
        cx.stroke();
        cx.setLineDash([]);
      } else if (q.stato === "attesa") {
        cx.beginPath(); cx.arc(p.x, p.y, R, 0, Math.PI * 2); cx.strokeStyle = `rgba(${colore},${0.7 * alpha})`; cx.lineWidth = 1.2; cx.stroke();
      } else {
        cx.shadowColor = `rgba(${colore},.6)`; cx.shadowBlur = (SA.sel?.k === q.k && SA.sel?.sess === n.s.id ? 16 : 7) * z * alpha;
        cerchioSA(cx, p, R, colore, alpha * (q.stato === "fermo" ? 0.6 : 1)); cx.shadowBlur = 0;
      }
      // l'anello: per un workflow e per un gruppo la parte di agenti finiti; per un subagente in corso un arco che gira
      const tot = q.tipo === "workflow" ? (q.dati.agenti || []).length : q.tipo === "gruppo" && !q.aperto ? q.dati.l.length : 0;
      const finiti = (l) => l.filter((x) => x.stato !== "lavora" && x.stato !== "attesa").length;
      const fatti = q.tipo === "workflow" ? finiti(q.dati.agenti || []) : q.tipo === "gruppo" ? q.dati.fatti : 0;
      const RA = R + 4 * z, fondo = -Math.PI / 2;
      cx.lineCap = "round";
      if (tot) {
        cx.beginPath(); cx.arc(p.x, p.y, RA, 0, Math.PI * 2); cx.strokeStyle = `rgba(${colore},${0.14 * alpha})`; cx.lineWidth = 1; cx.stroke();
        cx.beginPath();
        cx.arc(p.x, p.y, RA, fondo, fondo + Math.PI * 2 * Math.max(0.02, q.stato === "fatto" ? 1 : fatti / tot));
        cx.strokeStyle = `rgba(${colore},${0.9 * alpha})`;
        cx.lineWidth = 1.5 * z;
        cx.stroke();
      } else if (vivo && (q.tipo === "agente" || q.tipo === "workflow")) {
        const g0 = RIDOTTO.matches ? fondo : t / 900;
        cx.beginPath();
        cx.arc(p.x, p.y, RA, g0, g0 + 1.2);
        cx.strokeStyle = `rgba(${colore},${0.85 * alpha})`;
        cx.lineWidth = 1.4 * z;
        cx.stroke();
      }
      // le etichette: solo sulle radici e sui gruppi; gli agenti dei workflow parlano nel tooltip
      cx.textAlign = q.sx > 0 ? "right" : "left";
      cx.font = `${Math.round(11 * zt)}px Instrument Sans, sans-serif`;
      const lx = (d) => p.x - q.sx * (RA + d);
      // le etichette dal lato libero, opposto al flusso
      if (q.tipo === "workflow" || q.tipo === "agente") {
        cx.fillStyle = `rgba(${TEMA.testo},${0.85 * alpha})`;
        const testo = (q.dati.nomeWorkflow || q.dati.etichetta || (q.tipo === "workflow" ? "workflow" : "subagente"));
        cx.fillText(testo.length > 34 ? testo.slice(0, 33) + "…" : testo, lx(5), p.y + 3.5 * zt);
      } else if (q.tipo === "gruppo" && !q.aperto) {
        cx.fillStyle = `rgba(${TEMA.testo2},${0.9 * alpha})`; cx.fillText(`${q.dati.fatti}/${q.dati.l.length}`, lx(4), p.y + 3.5 * zt);
      }
      if (SA.sel && SA.sel.k === q.k && SA.sel.sess === n.s.id) {
        cx.beginPath();
        cx.arc(p.x, p.y, RA + 3, 0, Math.PI * 2);
        cx.strokeStyle = `rgb(${TEMA.testo})`;
        cx.lineWidth = 1;
        cx.stroke();
      }
      cx.restore();
    }
  }
  for (const k of [...SA.anim.keys()]) if (!vivi.has(k)) SA.anim.delete(k);
}
function sottoA(x, y) {
  for (const v of [...SA.pos].reverse()) if (Math.hypot(v.x - x, v.y - y) <= Math.max(v.r, 4) + 5) return v;
  return null;
}
function infoSotto(v) {
  const q = v.q, d = q.dati;
  if (q.tipo === "gruppo") return `${d.titolo}: ${d.l.length} agenti, ${d.fatti} finiti — clic per ${q.aperto ? "richiudere" : "aprirli"}`;
  if (q.tipo === "fase") return `Fase «${d.titolo}» · ${d.membri.length} agenti · ${STATO_SA[q.stato] || q.stato}`;
  if (q.tipo === "agente-wf") return [d.etichetta, d.faseTitolo && `fase ${d.faseTitolo}`, STATO_SA[d.stato], durataSA(d)].filter(Boolean).join(" · ");
  const cosa = q.tipo === "workflow" ? `Workflow ${d.nomeWorkflow || d.etichetta}` : `Subagente ${d.etichetta}`;
  return [cosa, d.ultimo && d.stato === "lavora" ? d.ultimo : "", STATO_SA[d.stato], durataSA(d)].filter(Boolean).join(" · ");
}
// la scheda di un sotto-agente (stessa scheda delle sfere)
function apriSchedaSotto(v, aggiorna) {
  const q = v.q, d = q.dati, el = $("scheda-nodo");
  M.sel = null; M.selTimer = null; SA.sel = { k: q.k, sess: v.sess.id };
  const colore = (COL_SA[q.stato] || COL.ferma).join(",");
  const chi = nomeSessione(v.sess);
  let titolo, meta, corpo;
  if (q.tipo === "workflow") {
    titolo = `Workflow · ${d.nomeWorkflow || d.etichetta}`; meta = STATO_SA[d.stato];
    const fasi = (d.fasi || []).map((f) => {
      const m = (d.agenti || []).filter((a) => a.fase === f.i);
      const errori = m.some((a) => a.stato === "errore") ? " · con errori" : "";
      return `<dt>${esc(f.titolo)}</dt><dd>${m.filter((a) => a.stato === "fatto").length}/${m.length} finiti${errori}</dd>`;
    }).join("");
    corpo = `<div style="font-size:13.5px">${esc(d.etichetta)}</div><dl class="tm-det"><dt>Lanciato da</dt><dd>${esc(chi)}</dd>`
      + `<dt>Durata</dt><dd>${esc(durataSA(d))}</dd>${fasi}</dl>${d.riassunto ? `<div class="sn-t">${esc(d.riassunto)}</div>` : ""}`;
  } else if (q.tipo === "gruppo" || q.tipo === "fase") {
    const l = q.tipo === "fase" ? d.membri : d.l;
    titolo = q.tipo === "fase" ? `Fase · ${d.titolo}` : d.titolo; meta = `${l.length} agenti`;
    corpo = l.map((a) => `<div class="tm-riga"><span class="tm-d" title="${esc(a.etichetta)}">${pallino(a.stato)}${esc(a.etichetta)}</span>`
      + `<span class="tm-q">${esc([STATO_SA[a.stato], durataSA(a)].filter(Boolean).join(" · "))}</span></div>`).join("");
  } else {
    const wf = d.wf;
    titolo = d.etichetta || "subagente"; meta = STATO_SA[d.stato];
    const dettaglio = wf
      ? `<dt>Workflow</dt><dd>${esc(wf.nomeWorkflow || wf.etichetta)}</dd><dt>Fase</dt><dd>${esc(d.faseTitolo || "—")}</dd>`
      : `<dt>Tipo</dt><dd>${esc(d.sottotipo || "subagente")}</dd>`;
    const modello = d.modello ? `<dt>Modello</dt><dd>${esc(nomeModello(d.modello) || d.modello)}</dd>` : "";
    const tentativo = d.tentativo > 1 ? `<dt>Tentativo</dt><dd>${d.tentativo}</dd>` : "";
    corpo = `<dl class="tm-det">${dettaglio}<dt>Lanciato da</dt><dd>${esc(chi)}</dd><dt>Durata</dt><dd>${esc(durataSA(d))}</dd>${modello}${tentativo}</dl>`
      + `${d.anteprima || d.riassunto ? `<div class="sn-t">${esc(d.anteprima || d.riassunto)}</div>` : ""}`;
  }
  el.innerHTML = `<div class="sn-testa"><span style="width:9px;height:9px;border-radius:50%;background:rgb(${colore})"></span><b>${esc(titolo)}</b>`
    + `<span class="meta">${esc(meta || "")}</span><button class="x" id="sn-x" title="Chiudi">✕</button></div><div class="sn-corpo">${corpo}</div>`;
  el.hidden = false; $("sn-x").onclick = chiudiScheda;
  if (!aggiorna) posizionaScheda();
}
// nella scheda di una sessione: i suoi sotto-agenti, anche quelli già sfumati dalla mappa, con «Sulla mappa» per riportarli
function htmlSottoSessione(s) {
  const l = [...(s.sotto || [])].reverse(); if (!l.length) return "";
  return `<div class="tm-titolo">Subagenti e workflow</div>` + l.map((r) => {
    const n = r.agenti ? ` · ${r.agenti.filter((a) => a.stato === "fatto").length}/${r.agenti.length} agenti` : "";
    const sulla = visibilitaSA(r, Date.now()) > 0.01;
    const fissato = SA.fissati.has(r.id);
    const quando = r.inizio ? tempoFa(new Date(r.inizio).toISOString()) : "";
    const dettaglio = [STATO_SA[r.stato], durataSA(r) + n, quando].filter(Boolean).join(" · ");
    return `<div class="tm-riga"><span class="tm-d" title="${esc(r.riassunto || r.etichetta)}">${pallino(r.stato)}`
      + `${r.tipo === "workflow" ? "⧉ " : ""}${esc(r.nomeWorkflow || r.etichetta || "subagente")}</span><span class="tm-q">${esc(dettaglio)}</span>`
      + `<button data-sa="${esc(r.id)}" title="${fissato ? "Lascia sfumare il nodo dalla mappa" : "Riporta il nodo sulla mappa"}">`
      + `${fissato ? "Lascia" : sulla ? "Tieni" : "Mostra"}</button></div>`;
  }).join("");
}
function rendiSottoScheda() {
  const blocco = $("sn-sotto"); if (!blocco || !M.sel) return;
  const n = M.nodi.get(M.sel), h = n?.s ? htmlSottoSessione(n.s) : "";
  blocco.hidden = !h; if (!h) return; blocco.innerHTML = h;
  blocco.querySelectorAll("button[data-sa]").forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.sa;
      if (SA.fissati.has(id)) SA.fissati.delete(id); else SA.fissati.add(id);
      rendiSottoScheda();
    };
  });
}
export { SA, apriSchedaSotto, disegnaSotto, infoSotto, rendiSottoScheda, sottoA };
