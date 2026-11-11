// I connettori claude.ai di un processo `claude -p`: se il processo nasce mentre la rete non risponde, restano giù finché il
// processo vive, e l'agente lavora senza quegli strumenti senza che nessuno lo veda. All'init di stream-json i connettori
// sono ancora «pending» (verificato con claude 2.1.319: anche alla fine del primo turno), quindi l'init non basta:
// qualche minuto dopo l'avvio il server chiede lo stato con una control_request `mcp_status` (la stessa dell'SDK), una
// volta sola per processo, e se un connettore claude.ai non è collegato lo scrive come errore della sessione. Nessun riavvio
// automatico: lo rifà la persona («Ricarica» o spegni della squadra, chiusura.mjs).
export const RICHIESTA_MCP = "cockpit-mcp";
export const CONTROLLO_MCP_MS = 180000;
const BUONI = ["connected", "needs-auth", "disabled"]; // needs-auth: un connettore mai autorizzato (Microsoft 365), non un buco

export const richiestaStatoMcp = () => JSON.stringify({ type: "control_request", request_id: RICHIESTA_MCP, request: { subtype: "mcp_status" } }) + "\n";

// i connettori claude.ai non collegati a tempo scaduto, dalla risposta: «failed» e anche «pending» dopo minuti
export function connettoriCaduti(servers) {
  return (Array.isArray(servers) ? servers : []).filter((x) => x?.source === "claudeai" && !BUONI.includes(x.status))
    .map((x) => `${String(x.name || "").replace(/^claude\.ai /, "")} (${x.status})`);
}

// la control_response alla nostra richiesta → il testo dell'errore, o "" se i connettori ci sono (o la risposta non è nostra)
export function avvisoConnettori(ev) {
  if (ev?.type !== "control_response" || ev.response?.request_id !== RICHIESTA_MCP) return "";
  const giu = connettoriCaduti(ev.response.response?.mcpServers);
  return giu.length ? `connettori non collegati in questo processo: ${giu.join(", ")}. I loro strumenti mancano finché il processo vive: «Ricarica» a sessione ferma (o spegni e riaccendi un agente della squadra) ne fa partire uno nuovo.` : "";
}
