// Tutte le migrazioni dello stato, in un posto solo. Passi numerati, ognuno una volta sola: migra() gira all'avvio del
// server e annota in <stato>/versione.json fin dove è arrivata. Ogni passo è idempotente (se il lavoro non c'è, non fa
// niente) e non cancella mai dati: rinomina o copia. Un passo nuovo si aggiunge in fondo con il numero dopo.
import { cpSync, existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "./config.mjs";
import { dirStato, negozio, percorsoStato } from "./stato.mjs";
import { MODELLO_DEFAULT, risolviModello } from "./modelli.mjs";

const èOggetto = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const oggiIt = () => new Date().toISOString().slice(0, 10).split("-").reverse().join("/");

// File di stato che contengono un oggetto (non un elenco): è lì che il campo `versione` ha senso.
const FILE_OGGETTO = ["impostazioni", "battito", "proposte", "consumo-limiti", "consumo-riassunto", "timer"];

const PASSI = [
  {
    n: 1, nome: "locale/cockpit → .plancia",
    fa() {
      if (process.env.COCKPIT_STATO) return false;
      const cartella = config().cartella;
      const nuovo = path.join(cartella, ".plancia"), vecchio = path.join(cartella, "locale/cockpit");
      if (existsSync(path.join(nuovo, "sessioni.json")) || !existsSync(path.join(vecchio, "sessioni.json"))) return false;
      mkdirSync(nuovo, { recursive: true });
      cpSync(vecchio, nuovo, { recursive: true });
      writeFileSync(path.join(vecchio, "MIGRATO.txt"), `${oggiIt()}: lo stato è stato copiato in .plancia/. Questa cartella non si usa più, da cancellare a mano.\n`);
      return true;
    },
  },
  {
    n: 2, nome: "carte.json → fogli.json",
    fa() {
      const da = percorsoStato("carte.json"), a = percorsoStato("fogli.json");
      if (!existsSync(da) || existsSync(a)) return false;
      renameSync(da, a);
      return true;
    },
  },
  {
    n: 3, nome: "generati.json → artifax.json",
    fa() {
      const da = percorsoStato("generati.json"), a = percorsoStato("artifax.json");
      if (!existsSync(da) || existsSync(a)) return false;
      renameSync(da, a);
      return true;
    },
  },
  {
    n: 4, nome: "sessioni: alias di modello → id",
    fa() {
      const sess = negozio("sessioni", { base: [] });
      if (!existsSync(sess.file)) return false;
      const elenco = sess.leggi();
      if (!Array.isArray(elenco)) return false;
      let cambiato = false;
      for (const s of elenco) {
        for (const campo of ["modello", "modelloPendente"]) {
          if (s[campo] === undefined) continue;
          let id; try { id = risolviModello(s[campo]); } catch { id = MODELLO_DEFAULT; }
          if (id !== s[campo]) { s[campo] = id; cambiato = true; }
        }
      }
      if (cambiato) sess.scrivi(elenco);
      return cambiato;
    },
  },
  {
    n: 5, nome: "sessione orchestratore: dal nome di prima allo slug dell'assistente",
    fa() {
      const sess = negozio("sessioni", { base: [] });
      if (!existsSync(sess.file)) return false;
      const elenco = sess.leggi();
      // i nomi di prima sono gli alias dell'assistente in config: senza alias non c'è niente da rinominare
      const { slug: nuovo, alias } = config().assistente;
      const vecchi = alias.filter((a) => a !== nuovo);
      if (!Array.isArray(elenco) || !vecchi.length) return false;
      let cambiato = false;
      for (const s of elenco) {
        if (s.ruolo === "orchestratore" && vecchi.includes(s.nome)) { s.nome = nuovo; cambiato = true; }
        if (vecchi.includes(s.genitore)) { s.genitore = nuovo; cambiato = true; }
      }
      if (cambiato) sess.scrivi(elenco);
      return cambiato;
    },
  },
  {
    n: 6, nome: "campo versione nei file a oggetto",
    fa() {
      let cambiato = false;
      for (const nome of FILE_OGGETTO) {
        const n = negozio(nome, { base: {} });
        if (!existsSync(n.file)) continue;
        const dati = n.leggi(); // aggiunge `versione` se manca
        if (èOggetto(dati)) { n.scrivi(dati); cambiato = true; }
      }
      return cambiato;
    },
  },
  {
    // il nome con cui l'orchestratore firmava fogli e artifax prima (alias di config) diventa lo slug dell'assistente
    n: 7, nome: "fogli e artifax: campo da, dal nome di prima allo slug dell'assistente",
    fa() {
      const { slug: nuovo, alias } = config().assistente;
      const vecchi = alias.filter((a) => a !== nuovo);
      if (!vecchi.length) return false;
      let cambiato = false;
      for (const nome of ["fogli", "artifax"]) {
        const neg = negozio(nome, { base: [] });
        if (!existsSync(neg.file)) continue;
        const elenco = neg.leggi();
        if (!Array.isArray(elenco)) continue;
        let tocco = false;
        for (const voce of elenco) {
          if (èOggetto(voce) && vecchi.includes(voce.da)) { voce.da = nuovo; tocco = true; }
        }
        if (tocco) { neg.scrivi(elenco); cambiato = true; }
      }
      return cambiato;
    },
  },
  {
    // Le proposte del battito diventano domande di tipo «proposta» (domande.mjs) e il foglio delle proposte non c'è più:
    // proposte.json resta dov'è (non si cancella niente), domande.json nasce con le proposte e i loro contatori
    n: 8, nome: "proposte.json → domande.json; via il foglio delle proposte",
    fa() {
      let cambiato = false;
      const prop = negozio("proposte", { base: [] }), dom = negozio("domande", { base: {} });
      if (existsSync(prop.file) && !existsSync(dom.file)) {
        const elenco = prop.leggi();
        const lista = Array.isArray(elenco) ? elenco : [];
        const STATO = { attesa: "aperta", dopo: "rimandata", si: "risposta", no: "risposta", ignorata: "ignorata" };
        const conta = (st) => lista.filter((x) => x.stato === st).length;
        const domande = lista.filter((x) => èOggetto(x) && x.testo).map((x) => ({
          id: `d-${String(x.id || Math.random().toString(36).slice(2, 8))}`, tipo: "proposta", da: { sessione: "", nome: config().assistente.slug, ruolo: "orchestratore" },
          testo: String(x.testo), opzioni: ["Sì", "No", "Più tardi"], urgente: !!x.urgente, foglio: "", contesto: "", perche: String(x.perche || ""),
          battito: x.battito || "", creata: x.creata || new Date().toISOString(), stato: STATO[x.stato] || "ignorata",
          risposta: x.stato === "si" ? "Sì" : x.stato === "no" ? "No" : "", come: x.stato === "si" || x.stato === "no" ? "opzione" : "",
          chiusa: x.stato === "attesa" || x.stato === "dopo" ? "" : x.risposta || "",
        }));
        dom.scrivi({
          domande,
          contatori: {
            fatte: lista.length, risposte: conta("si") + conta("no"), ritirate: 0, ignorate: conta("ignorata"), dalTesto: 0, inChat: 0,
            proposte: { fatte: lista.length, accettate: conta("si"), rifiutate: conta("no"), ignorate: conta("ignorata") },
          },
          impostazioni: { chiudeConChat: false },
        });
        cambiato = true;
      }
      const fogli = negozio("fogli", { base: [] });
      if (existsSync(fogli.file)) {
        const elenco = fogli.leggi();
        if (Array.isArray(elenco) && elenco.some((f) => èOggetto(f) && f.tipo === "proposte")) {
          fogli.scrivi(elenco.filter((f) => !(èOggetto(f) && f.tipo === "proposte")));
          cambiato = true;
        }
      }
      return cambiato;
    },
  },
];

// → elenco dei passi applicati in questa chiamata (nome di ogni passo che ha davvero cambiato qualcosa)
export function migra() {
  mkdirSync(dirStato(), { recursive: true });
  const ver = negozio("versione", { base: { versione: 0, passi: [] } });
  const stato = ver.leggi();
  const fatti = [];
  for (const p of PASSI) {
    if (p.n <= stato.versione) continue;
    const applicato = p.fa();
    stato.versione = p.n;
    stato.passi.push({ n: p.n, nome: p.nome, applicato: !!applicato, data: new Date().toISOString() });
    ver.scrivi(stato); // dopo ogni passo: se il successivo cade, questo non si rifà
    if (applicato) { fatti.push(p.nome); console.log(`migrazione ${p.n}: ${p.nome}`); }
  }
  return fatti;
}
