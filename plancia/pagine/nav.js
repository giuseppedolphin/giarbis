// La barra comune: marchio, pagine, Artifax, Consumo, Voce e interruttore del tema. Una sola fonte, servita dal server su
// /nav.js e caricata in testa a ogni pagina con <script type="module" src="/nav.js">. Il nucleo mostra solo il cockpit;
// le altre pagine arrivano dai moduli (registraVoceBarra in condivisi/barra.js, chiamata dalla loro pagina.js, che la barra
// carica da /api/chi). Una pagina aperta da file imposta prima window.PLANCIA_BASE (vedi condivisi/api.js).
import { BASE, api } from "/condivisi/api.js";
import { montaArtifax } from "/condivisi/artifax.js";
import { CSS_BARRA } from "/condivisi/barra-css.js";
import { marchioBarra, registraVoceBarra, suBarra, vociBarra } from "/condivisi/barra.js";
import { chi } from "/condivisi/chi.js";
import { montaConsumo } from "/condivisi/consumo.js";
import { esc } from "/condivisi/formati.js";
import { memo } from "/condivisi/memo.js";
import { caricaPalette, iniettaStile } from "/condivisi/stile.js";
import { montaPannelloVoce } from "/condivisi/voce-pannello.js";

const ALTEZZA = 44;
const CHIAVE_TEMA_VECCHIA = "plancia-tema"; // la riga in testa alle pagine la legge prima del primo disegno
const ICONE = {
  chiaro: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  scuro: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
};

const qui = location.pathname.replace(/\/+$/, "") || "/";
// Aperta da file e senza base: niente server, quindi niente Artifax, Consumo, Voce e tema salvato.
const senzaServer = location.protocol === "file:" && !BASE;

// ---- tema ------------------------------------------------------------------------------------------
// Scuro (base) o chiaro, per tutte le pagine: data-tema su <html> lo mette già la riga in testa a ogni pagina; qui l'interruttore
// salva in localStorage e fra le impostazioni del server (campo tema, così vale anche in un browser nuovo); le altre schede
// aperte si allineano dal vivo (evento storage).
function temaSalvato() {
  const t = memo.get("tema", "");
  return t === "chiaro" || t === "scuro" ? t : "";
}

function montaTema(nav) {
  const bottone = document.createElement("button");
  bottone.className = "tema"; bottone.type = "button"; bottone.id = "rdnav-tema"; bottone.setAttribute("aria-label", "Tema chiaro");
  let toccato = false;

  function applica(t, { salva = false, server = false } = {}) {
    t = t === "chiaro" ? "chiaro" : "scuro";
    document.documentElement.dataset.tema = t;
    bottone.innerHTML = ICONE[t];
    bottone.title = t === "chiaro" ? "Passa al tema scuro" : "Passa al tema chiaro";
    bottone.setAttribute("aria-pressed", String(t === "chiaro"));
    if (salva) {
      memo.set("tema", t);
      try { localStorage.setItem(CHIAVE_TEMA_VECCHIA, t); } catch {}
    }
    if (server && !senzaServer) api("POST", "/api/impostazioni", { tema: t }).catch(() => {});
  }

  applica(document.documentElement.dataset.tema || temaSalvato());
  bottone.onclick = () => {
    toccato = true;
    applica(document.documentElement.dataset.tema === "chiaro" ? "scuro" : "chiaro", { salva: true, server: true });
  };
  nav.append(bottone);
  addEventListener("storage", (e) => { if (e.key === "plancia.tema" && e.newValue) applica(e.newValue); });
  // il server ha l'ultima parola; se non ha ancora un tema (o è un server di prima del Riavvia) prende quello di questo browser
  if (!senzaServer) {
    api("GET", "/api/impostazioni").then((j) => {
      if (toccato) return;
      if (j.tema === "chiaro" || j.tema === "scuro") { if (j.tema !== document.documentElement.dataset.tema) applica(j.tema, { salva: true }); }
      else if (temaSalvato()) applica(temaSalvato(), { server: true });
    }).catch(() => {});
  }
}

// ---- la barra ----------------------------------------------------------------------------------------
function disegnaVoci(nav) {
  nav.querySelector(".marchio span").textContent = marchioBarra();
  nav.querySelector(".voci").innerHTML = vociBarra().map((v) => {
    const corrente = v.href === qui ? ' aria-current="page"' : "";
    return `<a class="voce" href="${esc(BASE + v.href)}"${corrente}>${esc(v.nome)}${v.chi ? `<small>${esc(v.chi)}</small>` : ""}</a>`;
  }).join("");
}

// Le pagine che i moduli offrono (pagina.js) si caricano qui: registrano le loro voci della barra e, nel cockpit, altro.
function caricaPagineModuli(moduli) {
  for (const m of moduli) {
    if (!m.pagina) continue;
    import(BASE + m.pagina)
      .then((mod) => mod.default?.({ registraVoceBarra }))
      .catch((e) => console.error(`pagina del modulo ${m.nome}:`, e));
  }
}

function montaVoce(nav, assistente) {
  if (senzaServer || qui === "/cockpit" || document.getElementById("pop-voce")) return;
  const d = document.createElement("details");
  d.id = "rdnav-voce";
  d.innerHTML = `<summary>Voce di ${esc(assistente.nome)}</summary><div class="pop"></div>`;
  nav.append(d);
  montaPannelloVoce(d.querySelector(".pop"));
  document.addEventListener("click", (e) => { if (!e.target.closest("#rdnav-voce")) d.open = false; });
}

async function avvia() {
  if (window.__navPlancia) return;
  window.__navPlancia = true;
  // il guscio subito, con la sua altezza, così la pagina sotto non salta quando arrivano nome e colori
  document.documentElement.style.setProperty("--nav-h", `${ALTEZZA}px`);
  const nav = document.createElement("nav");
  nav.className = "rdnav"; nav.setAttribute("aria-label", "Pagine"); nav.style.height = `${ALTEZZA}px`;
  document.body.prepend(nav);

  const [c] = await Promise.all([chi(), caricaPalette()]);
  iniettaStile("pl-barra", CSS_BARRA);
  registraVoceBarra({ href: "/cockpit", nome: c.assistente.nome, chi: "agenti", ordine: 100 });
  nav.innerHTML = '<div class="marchio"><i></i><span></span></div><span class="voci" style="display:contents"></span><span class="sp"></span>';
  disegnaVoci(nav);
  suBarra(() => disegnaVoci(nav));

  if (!senzaServer) {
    const artifax = montaArtifax(nav.querySelector(".sp"), { inCockpit: qui === "/cockpit" });
    montaConsumo(artifax);
  }
  montaVoce(nav, c.assistente);
  montaTema(nav);
  caricaPagineModuli(c.moduli);
}

avvia();
