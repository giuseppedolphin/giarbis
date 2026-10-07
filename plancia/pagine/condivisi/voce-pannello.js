// Il pannello Voce, uno per tutte le pagine (tendina della barra, cockpit): motore, modello (ElevenLabs), voce, velocità,
// tono, «Salva e prova». Le impostazioni stanno sul server e valgono per cockpit e bolla; il browser è la riserva.
import { chi, saluto } from "./chi.js";
import { esc } from "./formati.js";
import { prendi } from "./microfono.js";
import { caricaPalette, iniettaStile } from "./stile.js";
import { accendiVoce, caricaImpostazioni, dì, impostazioni, salvaImpostazioni, sbloccaVoce, voceAccesa } from "./voce-motore.js";

const NOMI_MOTORE = { realtime: "Realtime mini (più naturale)", tts: "TTS classico (più economico)", elevenlabs: "ElevenLabs" };
const CSS = `
.pl-vp{display:grid;gap:10px;line-height:1.4;font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--pl-text2)}
.pl-vp label{display:grid;gap:5px}
.pl-vp label[hidden],.pl-vp .esito[hidden]{display:none}
.pl-vp label.riga{display:flex;align-items:center;gap:8px}
.pl-vp b{color:var(--pl-text)}
.pl-vp select,.pl-vp textarea{font:inherit;background:var(--pl-campo);border:1px solid var(--pl-line2);border-radius:8px;padding:6px 8px;color:var(--pl-text)}
.pl-vp textarea{resize:vertical;font-size:12.5px}
.pl-vp textarea:disabled{opacity:.5}
.pl-vp input[type=range]{accent-color:var(--pl-sonar)}
.pl-vp input[type=checkbox]{accent-color:var(--pl-sonar)}
.pl-vp button{font:inherit;border:0;background:var(--pl-sonar);color:var(--pl-su-sonar);font-weight:600;border-radius:999px;padding:6px 14px;cursor:pointer;justify-self:start}
.pl-vp .esito{color:var(--pl-muted);font-size:12px}
.pl-vp .azioni{display:flex;gap:10px;align-items:center}
.pl-vp :focus-visible{outline:2px solid var(--pl-sonar);outline-offset:2px}`;

const HTML = `
  <label class="riga"><input type="checkbox" data-c="acceso"><span>Leggi le risposte a voce</span></label>
  <label>Motore<select data-c="motore"></select></label>
  <label data-c="modello-l" hidden>Modello<select data-c="modello"></select></label>
  <label>Voce<select data-c="voce"></select></label>
  <div class="esito" data-c="avviso" hidden></div>
  <label>Velocità <b data-c="vel-n"></b><input data-c="vel" type="range" min="0.7" max="1.8" step="0.05"></label>
  <label>Tono, cioè come chiediamo a OpenAI di farlo parlare<textarea data-c="tono" rows="4"></textarea></label>
  <div class="azioni"><button data-c="prova" type="button">Salva e prova</button><span class="esito" data-c="esito"></span></div>`;

// Monta il pannello dentro `contenitore`. Restituisce { ricarica() }.
export function montaPannelloVoce(contenitore, opzioni = {}) {
  iniettaStile("pl-voce-pannello", CSS);
  caricaPalette();
  const radice = document.createElement("div");
  radice.className = "pl-vp";
  radice.innerHTML = HTML;
  contenitore.append(radice);
  const c = (nome) => radice.querySelector(`[data-c="${nome}"]`);

  function riempi(j) {
    const eleven = j.motore === "elevenlabs";
    if (j.motori) c("motore").innerHTML = j.motori.map((m) => `<option value="${esc(m)}">${esc(NOMI_MOTORE[m] || m)}</option>`).join("");
    c("motore").value = j.motore || "realtime";
    c("voce").innerHTML = (j.voci || []).map((v) => `<option value="${esc(v)}">${esc(j.nomiVoci?.[v] || v[0].toUpperCase() + v.slice(1))}</option>`).join("");
    c("voce").value = j.voce;
    c("modello-l").hidden = !eleven;
    c("tono").disabled = eleven; // il tono è un'istruzione per i motori OpenAI
    if (eleven) {
      c("modello").innerHTML = (j.modelliEleven || []).map((m) => `<option value="${esc(m.id)}">${esc(m.nome)}</option>`).join("");
      c("modello").value = j.modelloEleven;
    }
    c("avviso").hidden = !j.avviso;
    c("avviso").textContent = j.avviso || "";
    c("vel").value = j.velocita || 1.1;
    c("vel-n").textContent = `${Number(c("vel").value).toFixed(2).replace(".", ",")}×`;
    if (document.activeElement !== c("tono")) c("tono").value = j.tono || j.tonoPredefinito || "";
    c("acceso").checked = voceAccesa();
  }

  async function ricarica() {
    try { riempi(await caricaImpostazioni()); } catch (e) { c("esito").textContent = e.message; }
  }

  c("acceso").onchange = () => accendiVoce(c("acceso").checked);
  c("vel").oninput = () => { c("vel-n").textContent = `${Number(c("vel").value).toFixed(2).replace(".", ",")}×`; };
  // cambiando motore cambiano le voci disponibili: si salva subito e si ricarica la lista
  c("motore").onchange = async () => {
    try { riempi(await salvaImpostazioni({ motore: c("motore").value })); } catch (e) { c("esito").textContent = e.message; }
  };
  c("prova").onclick = async () => {
    c("esito").textContent = "salvo…";
    const predefinito = impostazioni().tonoPredefinito;
    try {
      riempi(await salvaImpostazioni({
        motore: c("motore").value,
        voce: c("voce").value,
        ...(c("modello-l").hidden ? {} : { modelloEleven: c("modello").value }),
        velocita: Number(c("vel").value),
        tono: c("tono").value.trim() === predefinito ? "" : c("tono").value,
      }));
      c("esito").textContent = "salvata";
      accendiVoce(true);
      c("acceso").checked = true;
      sbloccaVoce();
      prendi();
      dì(saluto(await chi()), { subito: true });
      opzioni.dopoSalva?.();
    } catch (e) { c("esito").textContent = e.message; }
  };
  addEventListener("focus", ricarica); // una modifica fatta in un'altra pagina vale subito
  ricarica();
  return { ricarica };
}
