// La bolla dell'assistente: una bolla piccola che galleggia sulla dashboard, si sposta trascinandola e si può staccare dal
// browser (Picture-in-Picture, sempre sopra le altre finestre). Si dice la frase di chiamata (prefisso e nome dell'assistente)
// e ascolta finché non hai finito di parlare, poi manda la frase all'assistente e ti risponde a voce.
//
// Si carica con <script type="module" src="/widget.js"> dalle pagine servite dal server (una pagina aperta da file imposta prima
// window.PLANCIA_BASE). La voce passa dal motore comune (condivisi/voce-motore.js): coda unica con il cockpit, parla una scheda sola.
import { BASE, api } from "/condivisi/api.js";
import { chi } from "/condivisi/chi.js";
import { fraseChiamata, riconosciChiamata } from "/condivisi/chiamata.js";
import { connetti, su } from "/condivisi/eventi.js";
import { esc } from "/condivisi/formati.js";
import { memo } from "/condivisi/memo.js";
import { apriLivello, bip, colpetto, livello, possiedo, prendi, suPossesso } from "/condivisi/microfono.js";
import { montaPulsanteVoce } from "/condivisi/pulsante-voce.js";
import { caricaPalette, iniettaStile } from "/condivisi/stile.js";
import { caricaImpostazioni, ferma, guardiaTurno, pulisciPerVoce, sospendi, stato, suStato } from "/condivisi/voce-motore.js";

const CSS = `
.jw{position:fixed;z-index:2147483000;width:236px;font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--pl-text);
  background:linear-gradient(160deg,var(--pl-fondo1),var(--pl-fondo2));border:1px solid var(--pl-line2);border-radius:20px;
  box-shadow:0 16px 40px rgb(var(--pl-ombra-rgb) / calc(.45 * var(--pl-ombra-k)));padding:12px 12px 10px;user-select:none;touch-action:none;cursor:grab}
.jw.trascina{cursor:grabbing}
.jw.pip{position:static;width:100%;height:100vh;border-radius:0;border:0;box-shadow:none;cursor:default;display:flex;flex-direction:column;justify-content:center}
.jw-top{display:flex;align-items:center;gap:10px}
.jw-orb{flex:none;width:46px;height:46px;border-radius:50%;cursor:pointer;position:relative;border:0;padding:0;
  background:radial-gradient(circle at 38% 34%,#c9fff5 0,var(--pl-sonar) 42%,#1b6d66 100%);box-shadow:0 0 18px rgb(var(--pl-sonar-rgb) / .55)}
.jw-orb::before,.jw-orb::after{content:"";position:absolute;inset:-6px;border-radius:50%;border:1.5px solid currentColor;color:var(--pl-sonar);opacity:0}
.jw[data-modo=sveglio] .jw-orb::before{animation:jw-ping 2.8s ease-out infinite}
.jw[data-modo=ascolta] .jw-orb{background:radial-gradient(circle at 38% 34%,#ffe0e4 0,var(--pl-coral) 45%,#7a1f2b 100%);
  box-shadow:0 0 calc(18px + var(--liv,0)*26px) rgb(var(--pl-coral-rgb) / .65);transform:scale(calc(1 + var(--liv,0)*.28))}
.jw[data-modo=ascolta]{border-color:rgb(var(--pl-coral-rgb) / .55)}
.jw-testo[data-esito=ok]{color:var(--pl-sonar)}
.jw-testo[data-esito=err]{color:var(--pl-coral-testo)}
.jw[data-modo=ascolta] .jw-orb::before,.jw[data-modo=ascolta] .jw-orb::after{color:var(--pl-coral);animation:jw-ping .9s ease-out infinite}
.jw[data-modo=ascolta] .jw-orb::after{animation-delay:.45s}
.jw[data-modo=pensa] .jw-orb::before{opacity:1;inset:-5px;border-color:transparent;border-top-color:var(--pl-sonar);animation:jw-giro .9s linear infinite}
.jw[data-modo=parla] .jw-orb{background:radial-gradient(circle at 38% 34%,#ece8ff 0,var(--pl-violet) 45%,#3b2f86 100%);box-shadow:0 0 22px rgb(var(--pl-violet-rgb) / .6)}
.jw[data-modo=dorme] .jw-orb{filter:saturate(.35) brightness(.8)}
@keyframes jw-ping{from{transform:scale(.85);opacity:.9}to{transform:scale(1.6);opacity:0}}
@keyframes jw-giro{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.jw-orb::before,.jw-orb::after{animation:none!important}.jw[data-modo=ascolta] .jw-orb{transform:none}}
.jw-nome{font-weight:650;font-size:14px;letter-spacing:.2px}
.jw-stato{color:var(--pl-text2);font-size:12px}
.jw-testo{margin-top:9px;color:var(--pl-text);font-size:12.5px;max-height:3.9em;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;min-height:1.3em}
.jw-testo.vuoto{color:var(--pl-muted)}
.jw-pv{display:flex;justify-content:flex-end}
.jw-pv .pl-pv{margin-top:8px}
.jw-barra{display:flex;gap:6px;margin-top:10px}
.jw-barra button{flex:1;font:inherit;font-size:11.5px;border:1px solid var(--pl-line2);background:transparent;color:var(--pl-text2);border-radius:999px;padding:4px 6px;cursor:pointer;white-space:nowrap}
.jw-barra button[aria-pressed=true]{border-color:var(--pl-sonar-dim);color:var(--pl-sonar);background:rgb(var(--pl-sonar-rgb) / .08)}
.jw-barra button:hover{color:var(--pl-text)}
.jw button:focus-visible{outline:2px solid var(--pl-sonar);outline-offset:2px}
.jw.mini .jw-testo,.jw.mini .jw-barra{display:none}
.jw.mini{width:auto;padding:8px}
.jw.mini .jw-top>div{display:none}`;

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const ridotto = matchMedia("(prefers-reduced-motion: reduce)");

if (!(location.protocol === "file:" && !BASE) && !window.__widgetPlancia) {
  window.__widgetPlancia = true;
  await caricaPalette();
  const c = await chi();
  const A = c.assistente, FRASE = fraseChiamata(A);
  iniettaStile("pl-widget", CSS);

  const el = document.createElement("div");
  el.className = "jw"; el.dataset.modo = "dorme"; el.setAttribute("role", "region"); el.setAttribute("aria-label", A.nome);
  el.innerHTML = `<div class="jw-top"><button class="jw-orb" title="Clicca e parla (o di' «${esc(FRASE)}»)" aria-label="Parla con ${esc(A.nome)}"></button>
    <div><div class="jw-nome">${esc(A.nome)}</div><div class="jw-stato">…</div></div></div>
    <div class="jw-testo vuoto">Di' «${esc(FRASE)}» e parla, o clicca il pallino.</div>
    <div class="jw-pv"></div>
    <div class="jw-barra">
      <button data-a="sveglia" title="Ascolta sempre la frase «${esc(FRASE)}»">«${esc(FRASE)}»</button>
      <button data-a="fuori" title="Staccalo dal browser: resta sopra le altre finestre">Fuori</button>
      <button data-a="cockpit" title="Apri il cockpit">Cockpit</button>
      <button data-a="mini" title="Riduci">–</button>
    </div>`;
  document.body.append(el);
  const $ = (s) => el.querySelector(s);
  montaPulsanteVoce($(".jw-pv"));

  // ---- posizione e trascinamento ------------------------------------------------------
  const posizione = () => memo.json("widget.pos", null);
  function piazza(x, y) {
    const w = el.offsetWidth, h = el.offsetHeight;
    x = Math.min(Math.max(8, x), innerWidth - w - 8);
    y = Math.min(Math.max(8, y), innerHeight - h - 8);
    el.style.left = `${x}px`; el.style.top = `${y}px`;
  }
  const piazzaIniziale = () => {
    const p = posizione();
    if (p) piazza(p.x, p.y); else piazza(innerWidth - el.offsetWidth - 20, innerHeight - el.offsetHeight - 20);
  };
  requestAnimationFrame(piazzaIniziale);
  let trascina = null;
  el.addEventListener("pointerdown", (e) => {
    if (el.classList.contains("pip") || e.target.closest("button")) return;
    const r = el.getBoundingClientRect();
    trascina = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    el.classList.add("trascina"); el.setPointerCapture(e.pointerId);
  });
  el.addEventListener("pointermove", (e) => { if (trascina) piazza(e.clientX - trascina.dx, e.clientY - trascina.dy); });
  el.addEventListener("pointerup", () => {
    if (!trascina) return;
    trascina = null; el.classList.remove("trascina");
    const r = el.getBoundingClientRect();
    memo.setJson("widget.pos", { x: r.left, y: r.top });
  });
  addEventListener("resize", () => { if (!el.classList.contains("pip")) { const r = el.getBoundingClientRect(); piazza(r.left, r.top); } });

  // ---- stato --------------------------------------------------------------------------
  const W = { id: null, sveglia: memo.get("widget.sveglia", "0") === "1", modo: "dorme", risposta: "", pensa: false, turno: null, conta: 0 };
  const STATI = { dorme: "a riposo", sveglio: `ascolta «${FRASE}»`, ascolta: "ti ascolto…", pensa: "ci penso…", parla: "parla" };
  const modo = (m) => { W.modo = m; el.dataset.modo = m; $(".jw-stato").textContent = STATI[m]; };
  function riposo() {
    modo(W.pensa ? "pensa" : stato().parlando ? "parla" : W.sveglia && possiedo() ? "sveglio" : "dorme");
    if (!possiedo()) $(".jw-stato").textContent = "voce in un'altra scheda";
  }
  function mostra(t, vuoto, esito) {
    const x = $(".jw-testo");
    x.textContent = t;
    x.classList.toggle("vuoto", !!vuoto);
    if (esito) x.dataset.esito = esito; else delete x.dataset.esito;
  }
  $('[data-a="sveglia"]').setAttribute("aria-pressed", W.sveglia);
  let rec = null, attivo = false, comando = null, timer = null; // il riconoscimento vocale e il comando in corso

  // Livello del microfono (0..1) mentre il comando è aperto: in --liv sulla bolla, un fotogramma dopo l'altro.
  let raf = 0;
  function tickLivello() {
    el.style.setProperty("--liv", ridotto.matches ? 0 : livello().toFixed(3));
    raf = requestAnimationFrame(tickLivello);
  }
  let micEra = false;
  // Microfono aperto = comando in corso: la voce aspetta, il livello si misura.
  function sincronizza() {
    const ora = !!comando;
    if (ora === micEra) return;
    micEra = ora;
    sospendi(ora);
    apriLivello(ora);
    if (ora && !raf) raf = requestAnimationFrame(tickLivello);
    if (!ora) { cancelAnimationFrame(raf); raf = 0; el.style.removeProperty("--liv"); }
  }

  // ---- voce in uscita: la coda è del motore comune --------------------------------------
  // un flusso per turno (guardia nel motore): stop e «avanti» silenziano anche i tratti di testo che seguono nello stesso turno
  const G = guardiaTurno();
  function apriTurno(origine) {
    W.turno = { origine };
    G.apri(`${W.id}:${++W.conta}`, W.turno);
  }
  function flussoCorrente() {
    if (!W.turno) apriTurno(undefined); // pagina aperta a turno già iniziato: si legge
    return G.segmento();
  }

  // ---- eventi dal server -------------------------------------------------------------------
  async function trovaAssistente() {
    try { W.id = (await api("GET", "/api/sessioni")).sessioni.find((s) => s.ruolo === "orchestratore")?.id || null; } catch {}
  }
  su("_aperto", async () => { await caricaImpostazioni().catch(() => {}); await trovaAssistente(); riposo(); });
  su("_errore", () => { $(".jw-stato").textContent = "server fermo"; });
  su("cockpit_sessione", (ev) => {
    if (ev.id !== W.id) return;
    W.pensa = ev.sessione.stato === "lavora" || ev.sessione.stato === "avvio";
    if (W.modo !== "ascolta" && !stato().parlando) riposo();
  });
  su("cockpit_utente", (ev) => {
    if (ev.id !== W.id) return;
    apriTurno(ev.origine);
    W.risposta = "";
  });
  su("delta", (ev) => {
    if (ev.id !== W.id) return;
    W.risposta += ev.testo;
    mostra(pulisciPerVoce(W.risposta).slice(-220));
    flussoCorrente()?.nutri(ev.testo);
  });
  const finePezzo = (ev) => {
    if (ev.id !== W.id) return;
    G.chiudiSegmento();
    if (ev.type === "delta_tool") W.risposta = "";
  };
  su("delta_tool", finePezzo);
  su("assistant", finePezzo);
  su("fine", (ev) => {
    if (ev.id !== W.id) return;
    G.chiudi();
    W.turno = null;
    if (!stato().parlando) { riposo(); riprendiAscolto(); }
  });
  connetti();

  async function invia(testo) {
    testo = testo.trim();
    if (!testo || !W.id) { riposo(); return; }
    ferma();
    modo("pensa"); mostra(`«${testo}»`); $(".jw-stato").textContent = "invio…";
    try {
      await api("POST", `/api/sessioni/${W.id}/messaggio`, { testo, origine: "widget" });
      if (W.modo === "pensa") { $(".jw-stato").textContent = "inviato ✓"; $(".jw-testo").dataset.esito = "ok"; }
      setTimeout(() => {
        if (W.modo === "pensa") $(".jw-stato").textContent = STATI.pensa;
        const x = $(".jw-testo");
        if (x.dataset.esito === "ok") delete x.dataset.esito;
      }, 1800);
    } catch (e) { mostra(`Non l'ho mandato: ${e.message}`, false, "err"); riposo(); }
  }

  // ---- voce in entrata: la frase di chiamata, poi ascolto fino al silenzio -------------------
  const vuoleAscoltare = () => possiedo() && (W.sveglia || comando) && !stato().parlando;
  function avviaAscolto() {
    if (!SR || attivo || !vuoleAscoltare()) return;
    rec = new SR(); rec.lang = "it-IT"; rec.continuous = true; rec.interimResults = true;
    rec.onresult = (e) => {
      // dopo un clic sul pallino si prende tutto ciò che arriva, senza aspettare la frase
      if (comando && comando.base === null) comando.base = e.resultIndex;
      if (!comando) {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (riconosciChiamata(e.results[i][0].transcript, A).trovata) {
            comando = { base: i, parola: true };
            sincronizza(); bip(); modo("ascolta"); mostra("Ti ascolto…", true); rimanda(6000);
            break;
          }
        }
      }
      if (!comando) return;
      const parti = [];
      for (let i = comando.base; i < e.results.length; i++) {
        let t = e.results[i][0].transcript;
        if (i === comando.base && comando.parola) t = riconosciChiamata(t, A).resto;
        parti.push(t);
      }
      comando.testo = parti.join(" ").replace(/\s+/g, " ").trim();
      if (comando.testo) { colpetto(); mostra(comando.testo); rimanda(1700); }
    };
    rec.onerror = (e) => {
      if (e.error !== "not-allowed") return;
      W.sveglia = false; memo.set("widget.sveglia", "0");
      $('[data-a="sveglia"]').setAttribute("aria-pressed", "false");
      mostra("Il browser non ha il permesso del microfono.");
    };
    rec.onend = () => { attivo = false; if (vuoleAscoltare()) setTimeout(avviaAscolto, 250); };
    try { rec.start(); attivo = true; } catch { attivo = false; }
  }
  function rimanda(ms) { clearTimeout(timer); timer = setTimeout(chiudiComando, ms); }
  function chiudiComando() {
    const t = comando?.testo || "";
    comando = null; clearTimeout(timer);
    if (rec) { try { rec.abort(); } catch {} } // si riparte da zero: i risultati vecchi non servono più
    if (t) invia(t); else { mostra("Non ho sentito niente.", false, "err"); riposo(); }
    sincronizza();
  }
  function fermaAscolto() { if (rec && attivo && !comando) { try { rec.abort(); } catch {} } }
  function riprendiAscolto() { if (!attivo) avviaAscolto(); }
  function ascoltaSubito() {
    if (!SR) { mostra("Questo browser non ha la dettatura: usa Chrome."); return; }
    comando = { base: null, parola: false };
    sincronizza(); bip(); modo("ascolta"); mostra("Ti ascolto…", true);
    avviaAscolto(); rimanda(7000);
  }

  // il motore della voce chiama subito una volta: si registra dopo che l'ascolto è definito
  suStato((s) => {
    if (s.parlando) fermaAscolto(); // non deve sentirsi da solo: dice spesso il proprio nome
    if (W.modo !== "ascolta") riposo();
    if (!s.parlando) riprendiAscolto();
  });

  // ---- pulsanti ------------------------------------------------------------------------
  $(".jw-orb").onclick = () => {
    if (!possiedo()) prendi();
    if (W.modo === "ascolta") chiudiComando();
    else if (stato().parlando) { ferma(); riposo(); }
    else ascoltaSubito();
  };
  $(".jw-barra").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const a = b.dataset.a;
    if (a === "sveglia") {
      W.sveglia = !W.sveglia; memo.set("widget.sveglia", W.sveglia ? "1" : "0"); b.setAttribute("aria-pressed", W.sveglia);
      if (W.sveglia) { avviaAscolto(); mostra(`Di' «${FRASE}» quando vuoi.`, true); } else if (rec) { try { rec.abort(); } catch {} }
      riposo();
    } else if (a === "cockpit") window.open(`${BASE}/cockpit`, "plancia-cockpit");
    else if (a === "mini") { el.classList.toggle("mini"); b.textContent = el.classList.contains("mini") ? "+" : "–"; }
    else if (a === "fuori") staccaFuori();
  };

  // La finestra Picture-in-Picture resta sopra a tutte le app, anche fuori da Chrome.
  async function staccaFuori() {
    if (!("documentPictureInPicture" in window)) { mostra("Serve Chrome 116 o più recente per staccarlo dal browser."); return; }
    if (el.classList.contains("pip")) { window.documentPictureInPicture.window?.close(); return; }
    const w = await window.documentPictureInPicture.requestWindow({ width: 280, height: 210 });
    for (const n of document.querySelectorAll("[data-plancia]")) w.document.head.append(n.cloneNode(true)); // palette e stili condivisi
    const s = w.document.createElement("style");
    s.textContent = "html,body{margin:0;background:var(--pl-fondo2)}";
    w.document.head.append(s);
    w.document.documentElement.dataset.tema = document.documentElement.dataset.tema || "scuro"; // la finestrella prende il tema della pagina
    w.document.title = A.nome;
    el.classList.add("pip"); w.document.body.append(el);
    w.addEventListener("focus", () => { if (!possiedo()) prendi(); }); // la finestrella staccata conta come primo piano
    $('[data-a="fuori"]').textContent = "Rientra";
    w.addEventListener("pagehide", () => {
      el.classList.remove("pip"); document.body.append(el);
      $('[data-a="fuori"]').textContent = "Fuori";
      piazzaIniziale();
    });
  }
  if (!("documentPictureInPicture" in window)) $('[data-a="fuori"]').style.display = "none";

  // ---- una scheda sola ha microfono e voce (il protocollo sta in condivisi/microfono.js) -----------------
  suPossesso((possiede) => {
    if (!possiede) {
      comando = null; clearTimeout(timer);
      if (rec) { try { rec.abort(); } catch {} }
      sincronizza();
      mostra("Microfono e voce sono in un'altra scheda: clicca il pallino per usarli qui.", true);
    } else {
      mostra(W.sveglia ? `Di' «${FRASE}» quando vuoi.` : `Di' «${FRASE}» e parla, o clicca il pallino.`, true);
      if (W.sveglia) setTimeout(avviaAscolto, 300);
    }
    riposo();
  });

  addEventListener("focus", () => { caricaImpostazioni().catch(() => {}); });
  if (W.sveglia) avviaAscolto();
  riposo();
}
