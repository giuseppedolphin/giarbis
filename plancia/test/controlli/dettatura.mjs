// La dettatura a mano non manda da sola: nel cockpit (pagine/cockpit/ascolto.js) le pause non chiudono
// né inviano, il riconoscimento riparte quando il browser lo chiude, e l'invio (chat.js) chiude prima la dettatura e aspetta le
// ultime parole; nella bolla (pagine/widget.js) dopo un clic sul pallino si manda con un altro clic. La frase di chiamata a mani
// libere resta com'era: manda quando smetti di parlare. Controllo statico: il riconoscimento vero vuole un browser con microfono.
import { readFileSync } from "node:fs";
import path from "node:path";

export default async function (t) {
  const pagine = path.join(t.plancia, "pagine");
  const ascolto = readFileSync(path.join(pagine, "cockpit", "ascolto.js"), "utf8");
  const chat = readFileSync(path.join(pagine, "cockpit", "chat.js"), "utf8");
  const widget = readFileSync(path.join(pagine, "widget.js"), "utf8");
  const tra = (s, da, a) => { const i = s.indexOf(da), j = s.indexOf(a, i + 1); return i < 0 || j < 0 ? "" : s.slice(i, j); };

  // cockpit: la dettatura a mano
  const avvia = tra(ascolto, "function avviaAscolto(", "\n}\n");
  const riconosci = tra(ascolto, "function avviaRiconoscimento(", "\n}\n");
  t.ok(avvia && riconosci, "ascolto.js: avviaAscolto e avviaRiconoscimento ci sono");
  t.ok(!/SILENZIO_FINE_MS|QUIETE_FINALE_MS/.test(ascolto), "ascolto.js: niente più soglie di silenzio che chiudono la dettatura");
  t.ok(!/invi/i.test(riconosci.replace(/\/\/.*$/gm, "")), "ascolto.js: il riconoscimento non chiama nessun invio");
  t.ok(/r\.onend = [\s\S]*?riprova\(/.test(riconosci), "ascolto.js: quando il browser chiude il riconoscimento, riparte");
  t.ok(/d\.base = v \? `\$\{v\} ` : ""/.test(riconosci), "ascolto.js: la ripartenza tiene il testo già nel campo");
  t.ok(/function finisciDettatura\(inp\)/.test(ascolto) && /S\.primaDiInviare = finisciDettatura;/.test(ascolto), "ascolto.js: l'invio passa da finisciDettatura");
  t.ok(/else r\.stop\(\)/.test(ascolto) && /CHIUSURA_MS\)/.test(ascolto), "ascolto.js: chiudendo si aspettano le ultime parole, con un tetto");
  t.ok(/fermaDettatura\("possesso"\)/.test(ascolto), "ascolto.js: perdere il possesso ferma la dettatura senza buttare il testo");
  t.ok(/fermaDettatura\("scritto"\)/.test(ascolto) && /e\.isTrusted/.test(ascolto), "ascolto.js: scrivere nel campo ferma la dettatura");
  t.ok(/e\.key !== "Escape"[\s\S]{0,120}fermaDettatura\("pausa"\)/.test(ascolto), "ascolto.js: Esc mette in pausa la dettatura");
  t.ok(/INATTIVO_MS[\s\S]*fermaDettatura\("inattivo"\)/.test(ascolto), "ascolto.js: dopo un silenzio lunghissimo si ferma da sola, senza inviare");
  // la frase di chiamata a mani libere manda ancora al silenzio (Sara: «Lascia così»)
  t.ok(/svRimanda\(1600\)/.test(ascolto) && /pastigliaEsito\(inviaOrchestratore\)/.test(ascolto), "ascolto.js: la frase di chiamata manda ancora quando smetti di parlare");

  // chat.js: entrambi gli invii chiudono prima la dettatura
  t.ok(/async function inviaOrchestratore\(\) \{\n  await S\.primaDiInviare\("in-j"\);/.test(chat), "chat.js: inviaOrchestratore aspetta la dettatura");
  t.ok(/async function inviaSessione\(\) \{\n  await S\.primaDiInviare\("in-s"\);/.test(chat), "chat.js: inviaSessione aspetta la dettatura");

  // bolla: dopo un clic sul pallino le pause non mandano
  const subito = tra(widget, "function ascoltaSubito(", "\n  }\n");
  t.ok(subito && !/rimanda\(/.test(subito), "widget.js: il clic sul pallino non arma l'invio a tempo");
  t.ok(/if \(comando\.parola\) rimanda\(1700\); else inattivo\(\);/.test(widget), "widget.js: il silenzio manda solo con la frase di chiamata");
  t.ok(/comando\.prima = comando\.testo/.test(widget), "widget.js: la ripartenza del riconoscimento tiene ciò che hai già detto");
  t.ok(/if \(W\.modo === "ascolta"\) chiudiComando\(\);/.test(widget), "widget.js: un altro clic sul pallino manda");
}
