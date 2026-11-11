// Il comando `setup` di ctl.mjs (stessa forma dei comandi dei moduli): la checklist di primo avvio (server/checklist.mjs) e il
// «setup fatto» del primo avvio senza config. Le voci le verifica il codice; la spunta (una lettura) la mette la persona, la
// verifica di un connettore dell'account claude la registra l'assistente.
const SEGNO = { verde: "✓", giallo: "~", rosso: "✗" };

function stampa(c) {
  if (!c.voci) return console.log("la checklist non è ancora stata controllata: ctl.mjs setup controlla");
  console.log([
    c.operatore ? `checklist completa: ${c.persona || "la persona"} è operatore` : `checklist: mancano ${c.mancano} voci obbligatorie`,
    ...c.voci.map((v) => `  ${SEGNO[v.colore] || "?"} ${v.id.padEnd(14)} ${v.titolo}${v.facoltativa ? " (facoltativa)" : ""}${v.tipo !== "codice" ? ` [${v.tipo}]` : ""}\n`
      + `    ${v.dettaglio}${v.esito !== "ok" && v.come ? `\n    come: ${v.come}` : ""}`),
  ].join("\n"));
}

async function setup({ args, api, uso }) {
  const [sub = "controlla", id, ...resto] = args;
  if (sub === "controlla") return stampa((await api("POST", "/api/checklist/controlla")).checklist);
  if (sub === "stato") return stampa((await api("GET", "/api/checklist")).checklist);
  if (sub === "spunta") {
    if (!id) uso("ctl.mjs setup spunta <id> [no]");
    return stampa((await api("POST", "/api/checklist/spunta", { id, fatto: resto[0] !== "no" })).checklist);
  }
  if (sub === "verificato") {
    if (!id || !["ok", "no"].includes(resto[0])) uso('ctl.mjs setup verificato <id> ok|no ["cosa hai provato"]');
    return stampa((await api("POST", "/api/checklist/verificato", { id, esito: resto[0], nota: resto.slice(1).join(" ") })).checklist);
  }
  if (sub === "apri") { await api("POST", "/api/checklist/nascondi", { nascosta: false }); return console.log("checklist aperta nella pagina del cockpit"); }
  if (sub === "fatto") {
    await api("POST", "/api/setup/fatto");
    return console.log("setup segnalato: la pagina mostra il pulsante per avviare");
  }
  return uso('ctl.mjs setup [controlla] | stato | spunta <id> [no] | verificato <id> ok|no ["nota"] | apri | fatto');
}

export const comandi = { setup };
export const aiuto = [
  'setup [controlla] | stato | spunta <id> [no] | verificato <id> ok|no ["nota"] | apri   la checklist di primo avvio: ricontrolla, spunta una lettura, registra la verifica di un connettore, riapre il pannello',
  "setup fatto                                    primo avvio senza config: la config è scritta, la pagina mostra Avvia",
];
