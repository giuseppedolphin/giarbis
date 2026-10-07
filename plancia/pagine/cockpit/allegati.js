// Gli allegati dei due compositori (clip, trascina, incolla). La lavagna sta in condivisi/lavagna.js.
import { aggiornaInvia } from "./chat.js";
import { $, mostraBanner } from "./comune.js";
import { BASE } from "/condivisi/api.js";
import { esc } from "/condivisi/formati.js";

const coda = { j: [], s: [] };
function rendiCoda(k) {
  const el = $(`coda-${k}`);
  el.classList.toggle("on", coda[k].length > 0);
  el.innerHTML = coda[k]
    .map((f, i) => `<span class="chip-file">${esc(f.nome)}${f.caricando ? " · carico…" : ""}<button data-i="${i}" title="Togli">✕</button></span>`)
    .join("");
  el.querySelectorAll("button").forEach((b) => {
    b.onclick = () => { coda[k].splice(Number(b.dataset.i), 1); rendiCoda(k); aggiornaInvia(); };
  });
}
async function allega(k, files) {
  for (const file of files) {
    const voce = { nome: file.name, caricando: true, percorso: "" };
    coda[k].push(voce);
    rendiCoda(k);
    try {
      const r = await fetch(`${BASE}/api/allegati?nome=${encodeURIComponent(file.name)}`, {
        method: "POST", headers: { "x-dashboard": "1", "content-type": "application/octet-stream" }, body: file,
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.errore || `errore ${r.status}`);
      voce.percorso = j.percorso;
      voce.caricando = false;
    } catch (e) {
      coda[k].splice(coda[k].indexOf(voce), 1);
      mostraBanner(`${file.name}: ${e.message}`, 6000);
    }
    rendiCoda(k);
    aggiornaInvia();
  }
}
let destinoFile = "j";
function prendiAllegati(k) {
  if (coda[k].some((f) => f.caricando)) { mostraBanner("Aspetta che finisca il caricamento degli allegati.", 4000); return null; }
  const l = coda[k].map((f) => f.percorso);
  coda[k] = [];
  rendiCoda(k);
  return l;
}

function initAllegati() {
  for (const k of ["j", "s"]) {
    $(`clip-${k}`).onclick = () => { destinoFile = k; $("file").click(); };
    const box = $(`box-${k}`);
    box.addEventListener("dragover", (e) => { e.preventDefault(); box.classList.add("drop"); });
    box.addEventListener("dragleave", () => box.classList.remove("drop"));
    box.addEventListener("drop", (e) => {
      e.preventDefault();
      box.classList.remove("drop");
      if (e.dataTransfer.files.length) allega(k, [...e.dataTransfer.files]);
    });
    $(`in-${k}`).addEventListener("paste", (e) => {
      const f = [...(e.clipboardData?.files || [])];
      if (f.length) { e.preventDefault(); allega(k, f); }
    });
  }
  $("file").onchange = () => { allega(destinoFile, [...$("file").files]); $("file").value = ""; };
}
export { coda, initAllegati, prendiAllegati };
