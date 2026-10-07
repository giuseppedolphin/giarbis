// I sotto-agenti di una sessione del cockpit: i subagenti (strumento Agent) e i workflow (strumento Workflow) che il
// processo `claude -p` lancia dentro di sé. Non sono sessioni del cockpit; li ricostruiamo dagli eventi dello stream-json:
//   system/task_started       → parte un task (task_type local_agent | local_workflow), con tool_use_id, descrizione, tipo
//   system/task_progress      → avanzamento; per i workflow porta `workflow_progress`, lo stato intero di fasi e agenti
//   system/task_updated       → patch di stato (completed, end_time)
//   system/task_notification  → fine, con status (completed | failed | killed …) e summary
//   assistant tool_use Agent  → il lancio (serve per i subagenti in primo piano), chiuso dal tool_result se non è in background
// Lo stato vive in `sessione.sotto` (salvato in sessioni.json): la mappa li disegna come nodi figli della sfera.
// Prova a mano: `node plancia/server/sottoagenti.mjs <eventi-grezzi.jsonl>` rigioca uno stream registrato e stampa l'albero.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const MAX_RADICI = 12, MAX_AGENTI = 300;
const corto = (t, n = 160) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const TIPI = new Set(["local_agent", "local_workflow", "remote_agent"]);
const STRUMENTI_AGENTE = new Set(["Agent", "Task"]);

const statoFine = (st) => /^(completed|success|done)$/i.test(st || "") ? "fatto" : /^(failed|error|failure)$/i.test(st || "") ? "errore" : "fermo";
function statoAgenteWf(a) {
  const st = String(a.state || "").toLowerCase();
  if (/^(done|completed|success|succeeded)$/.test(st)) return "fatto";
  if (/(error|fail)/.test(st)) return "errore";
  if (/(cancel|kill|abort|stop|skip)/.test(st)) return "fermo";
  if (!a.startedAt) return "attesa";
  return "lavora";
}

// Dagli snapshot `workflow_progress`: fasi e agenti. I collegamenti fra agenti non sono nello stream: in una pipeline
// l'agente della fase dopo entra in coda nello stesso istante in cui finisce il suo a monte (pochi ms). Se più agenti
// partono insieme alla fine dello stesso agente è una barriera (fase dopo fase), non una pipeline: allora si legano alla fase.
function daSnapshot(wp) {
  const fasi = wp.filter((x) => x.type === "workflow_phase").map((x) => ({ i: x.index, titolo: corto(x.title, 60) }));
  const agenti = wp.filter((x) => x.type === "workflow_agent").slice(0, MAX_AGENTI).map((a) => {
    const fine = a.lastProgressAt && /^(done|completed|success|succeeded)$|error|fail/i.test(a.state || "") ? a.lastProgressAt : a.startedAt && a.durationMs ? a.startedAt + a.durationMs : null;
    return { i: a.index, etichetta: corto(a.label || a.promptPreview, 80), fase: a.phaseIndex ?? null, faseTitolo: corto(a.phaseTitle, 60), modello: a.model || "",
      stato: statoAgenteWf(a), coda: a.queuedAt || null, inizio: a.startedAt || null, fine: fine && statoAgenteWf(a) !== "lavora" ? fine : null,
      durata: a.durationMs ?? null, tentativo: a.attempt || 1, anteprima: corto(a.resultPreview, 200), da: null };
  });
  const scelte = new Map();
  for (const a of agenti) {
    if (a.fase == null || !a.coda) continue;
    let migliore = null, diff = Infinity;
    for (const b of agenti) {
      if (b.fase == null || b.fase >= a.fase || !b.fine) continue;
      const d = a.coda - b.fine;
      if (d >= -5 && d <= 250 && d < diff) { diff = d; migliore = b; }
    }
    if (migliore) { if (!scelte.has(migliore.i)) scelte.set(migliore.i, []); scelte.get(migliore.i).push(a); }
  }
  for (const [i, l] of scelte) if (l.length === 1) l[0].da = i;
  return { fasi, agenti };
}

function trova(sotto, ev) {
  return sotto.find((x) => (ev.tool_use_id && x.id === ev.tool_use_id) || (ev.task_id && x.task === ev.task_id)) || null;
}
function nuovo(sotto, base) {
  const r = { id: base.id, task: base.task || null, tipo: base.tipo, etichetta: base.etichetta || "", sottotipo: base.sottotipo || "", stato: "lavora",
    inizio: base.t, fine: null, sfondo: !!base.sfondo, padre: base.padre || null, ultimo: "", riassunto: "", token: 0, strumenti: 0 };
  if (r.tipo === "workflow") { r.fasi = []; r.agenti = []; }
  sotto.push(r);
  // si tengono le radici più recenti: quelle in corso non si buttano mai
  while (sotto.length > MAX_RADICI) { const k = sotto.findIndex((x) => x.stato !== "lavora"); if (k < 0) break; sotto.splice(k, 1); }
  return r;
}

// Aggiorna `sotto` (array, modificato sul posto) con un evento grezzo dello stream-json. Ritorna true se qualcosa è cambiato.
export function aggiorna(sotto, ev, t = Date.now()) {
  if (!ev || !Array.isArray(sotto)) return false;
  if (ev.type === "assistant" && Array.isArray(ev.message?.content)) {
    let cambiato = false;
    for (const b of ev.message.content) {
      if (b.type !== "tool_use" || !(STRUMENTI_AGENTE.has(b.name) || b.name === "Workflow")) continue;
      if (sotto.some((x) => x.id === b.id)) continue;
      const wf = b.name === "Workflow";
      nuovo(sotto, { id: b.id, tipo: wf ? "workflow" : "agente", t, sfondo: wf || !!b.input?.run_in_background, padre: ev.parent_tool_use_id || null,
        etichetta: corto(wf ? (b.input?.name || "workflow") : b.input?.description, 80), sottotipo: wf ? "" : corto(b.input?.subagent_type, 40) });
      cambiato = true;
    }
    return cambiato;
  }
  if (ev.type === "user" && Array.isArray(ev.message?.content)) {
    let cambiato = false;
    for (const b of ev.message.content) {
      if (b.type !== "tool_result") continue;
      const r = sotto.find((x) => x.id === b.tool_use_id); if (!r || r.stato !== "lavora") continue;
      const testo = Array.isArray(b.content) ? b.content.map((c) => c.text || "").join(" ") : String(b.content ?? "");
      if (b.is_error) { Object.assign(r, { stato: "errore", fine: t, riassunto: corto(testo, 200) }); cambiato = true; } // rifiutato o fallito subito (anche i workflow senza permesso)
      else if (!r.sfondo && !/launched (successfully|in background)/i.test(testo)) { Object.assign(r, { stato: "fatto", fine: t, riassunto: r.riassunto || corto(testo, 200) }); cambiato = true; }
    }
    return cambiato;
  }
  if (ev.type !== "system") return false;
  if (ev.subtype === "task_started") {
    if (!TIPI.has(ev.task_type)) return false; // i comandi Bash in background non sono agenti
    const wf = ev.task_type === "local_workflow";
    let r = trova(sotto, ev);
    if (!r) r = nuovo(sotto, { id: ev.tool_use_id || ev.task_id, tipo: wf ? "workflow" : "agente", t, padre: null });
    Object.assign(r, { task: ev.task_id, sfondo: wf || ev.is_backgrounded !== false, etichetta: corto(ev.description, 80) || r.etichetta,
      sottotipo: corto(ev.subagent_type || "", 40) || r.sottotipo, ...(wf ? { nomeWorkflow: corto(ev.workflow_name, 60) } : {}) });
    if (ev.spawn_depth > 1) r.profondita = ev.spawn_depth;
    return true;
  }
  const r = trova(sotto, ev);
  if (!r) return false;
  if (ev.subtype === "task_progress") {
    if (ev.usage) { r.token = ev.usage.total_tokens || r.token; r.strumenti = ev.usage.tool_uses || r.strumenti; }
    r.ultimo = corto(ev.description, 100);
    if (Array.isArray(ev.workflow_progress)) Object.assign(r, daSnapshot(ev.workflow_progress));
    return true;
  }
  if (ev.subtype === "task_updated") {
    const st = ev.patch?.status;
    if (st && st !== "running" && st !== "pending") { r.stato = statoFine(st); r.fine = ev.patch.end_time || t; return true; }
    return false;
  }
  if (ev.subtype === "task_notification") {
    r.stato = statoFine(ev.status); r.fine = r.fine || t;
    r.riassunto = corto(ev.summary, 200);
    if (ev.usage) { r.token = ev.usage.total_tokens || r.token; r.strumenti = ev.usage.tool_uses ?? r.strumenti; r.durata = ev.usage.duration_ms ?? r.durata; }
    if (r.agenti) for (const a of r.agenti) if (a.stato === "lavora" || a.stato === "attesa") a.stato = r.stato === "fatto" ? "fatto" : "fermo";
    return true;
  }
  return false;
}

// Al riavvio del server i processi sono morti: quello che risultava in corso non lo è più.
export function interrompi(sotto, t = Date.now()) {
  let n = 0;
  for (const r of sotto || []) {
    if (r.stato === "lavora") { r.stato = "fermo"; r.fine = r.fine || t; r.riassunto = r.riassunto || "interrotto: il processo della sessione è ripartito"; n++; }
    for (const a of r.agenti || []) if (a.stato === "lavora" || a.stato === "attesa") a.stato = "fermo";
  }
  return n;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const f = process.argv[2];
  if (!f) { console.error("uso: node plancia/server/sottoagenti.mjs <eventi-grezzi.jsonl>"); process.exit(1); }
  const sotto = [];
  for (const riga of readFileSync(f, "utf8").split("\n").filter(Boolean)) { let ev; try { ev = JSON.parse(riga); } catch { continue; } aggiorna(sotto, ev, Date.parse(ev.timestamp || "") || Date.now()); }
  for (const r of sotto) {
    console.log(`${r.tipo} «${r.etichetta}» ${r.stato}${r.riassunto ? ` — ${corto(r.riassunto, 70)}` : ""}`);
    for (const fz of r.fasi || []) console.log(`  fase ${fz.i} ${fz.titolo}`);
    for (const a of r.agenti || []) console.log(`    agente ${a.i} ${a.etichetta} [fase ${a.fase}] ${a.stato} ${a.durata ?? "?"}ms${a.da ? ` ← agente ${a.da}` : ""}`);
  }
}
