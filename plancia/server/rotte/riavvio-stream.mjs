// Lo stream degli eventi e il Riavvia.
//   GET /api/stream (SSE)  · POST /api/riavvia
// Lo stream è "locale": EventSource non può mandare l'header X-Dashboard, e comunque l'Host è già controllato.
// Il Riavvia lancia un server nuovo, staccato da questo, con lo stesso file e la stessa porta, poi questo si chiude (le
// sessioni ripartono con --resume). Il nuovo parte con COCKPIT_ATTESA: se la porta è ancora occupata riprova per qualche secondo.
import { spawn } from "node:child_process";
import { ascolta } from "../eventi.mjs";

export function rotte({ cfg, porta, cockpit, chiudiServer }) {
  return [
    { metodo: "GET", percorso: "/api/stream", guardia: "locale", gestore: (c) => { ascolta(c.req, c.res); } },
    {
      metodo: "POST", percorso: "/api/riavvia",
      gestore(c) {
        c.json(200, { ok: true });
        setTimeout(() => {
          cockpit.chiudiTutto();
          chiudiServer();
          spawn(process.execPath, [process.argv[1], String(porta)], {
            cwd: cfg.cartella, detached: true, stdio: "ignore", env: { ...process.env, NO_OPEN: "1", COCKPIT_ATTESA: "1" },
          }).unref();
          process.exit(0);
        }, 300);
      },
    },
  ];
}
