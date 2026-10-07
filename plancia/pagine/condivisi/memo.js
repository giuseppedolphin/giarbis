// La memoria del browser (localStorage), tutta sotto il prefisso «plancia.»: memo.get("voce", "1") legge "plancia.voce".
// Alla prima apertura una migrazione una tantum porta le chiavi dei nomi vecchi sotto il prefisso nuovo:
//   cockpit.<x> → plancia.<x> · jw.<x> → plancia.widget.<x> · plancia-tema → plancia.tema
// La chiave «plancia-tema» resta (copiata, non tolta) perché la riga in testa alle pagine la legge ancora prima del primo disegno.

const PREFISSO = "plancia.";
const FATTO = `${PREFISSO}migrato`;

function migra() {
  try {
    if (localStorage.getItem(FATTO)) return;
    const vecchie = [];
    for (let i = 0; i < localStorage.length; i++) vecchie.push(localStorage.key(i));
    for (const k of vecchie) {
      let nuova = "";
      if (k === "plancia-tema") nuova = `${PREFISSO}tema`;
      else if (k.startsWith("cockpit.")) nuova = PREFISSO + k.slice("cockpit.".length);
      else if (k.startsWith("jw.")) nuova = `${PREFISSO}widget.${k.slice(3)}`;
      if (!nuova) continue;
      if (localStorage.getItem(nuova) === null) localStorage.setItem(nuova, localStorage.getItem(k));
      if (k !== "plancia-tema") localStorage.removeItem(k);
    }
    localStorage.setItem(FATTO, "1");
  } catch {}
}
migra();

export const memo = {
  get(k, d) { try { return localStorage.getItem(PREFISSO + k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(PREFISSO + k, v); } catch {} },
  togli(k) { try { localStorage.removeItem(PREFISSO + k); } catch {} },
  json(k, d) { try { const t = localStorage.getItem(PREFISSO + k); return t === null ? d : JSON.parse(t); } catch { return d; } },
  setJson(k, v) { try { localStorage.setItem(PREFISSO + k, JSON.stringify(v)); } catch {} },
};
