// Lo stream degli eventi verso i browser (SSE): l'unico file che scrive sullo stream. I tipi stanno in un catalogo; un
// evento di un tipo che non c'è viene segnalato e contato (lo controlla il test), ma parte lo stesso.

export const TIPI = new Set([
  "cockpit_sessione", "system", "delta", "delta_tool", "delta_pensa", "assistant", "risultati", "fine",
  "cockpit_utente", "cockpit_errore", "cockpit_rimossa", "cockpit_azzerata", "cockpit_mostra",
  "cockpit_foglio", "cockpit_foglio_chiuso", "cockpit_timer", "cockpit_proposte", "cockpit_setup",
]);

const ascoltatori = new Set();
const fuori = new Map(); // tipo fuori catalogo → quante volte
const KEEPALIVE_MS = 20000;

export function registraTipi(lista) {
  for (const t of lista || []) TIPI.add(String(t));
}

export function ascolta(req, res) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
  res.write(": ok\n\n");
  ascoltatori.add(res);
  const battito = setInterval(() => res.write(": .\n\n"), KEEPALIVE_MS);
  battito.unref();
  req.on("close", () => { clearInterval(battito); ascoltatori.delete(res); });
}

export function trasmetti(evento) {
  if (!evento || typeof evento.type !== "string" || !evento.type) throw new Error("evento senza type");
  if (!TIPI.has(evento.type)) {
    fuori.set(evento.type, (fuori.get(evento.type) || 0) + 1);
    console.error(`evento fuori catalogo: ${evento.type}`);
  }
  const riga = `data: ${JSON.stringify(evento)}\n\n`;
  for (const r of ascoltatori) r.write(riga);
}

export function contaFuoriCatalogo() {
  let n = 0;
  for (const v of fuori.values()) n += v;
  return n;
}
