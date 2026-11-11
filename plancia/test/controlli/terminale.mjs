// Il terminale del cockpit (server/terminale.mjs, server/rotte/terminale.mjs): le guardie (X-Dashboard, Origin, Sec-Fetch-Site,
// token su ogni richiesta, stream compreso), una shell vera che risponde nella cartella di lavoro, il ridimensionamento, la chiusura
// (a comando, a pagina chiusa e all'uscita del server) con la shell che muore davvero, l'isolamento dei file della lavagna.
import http from "node:http";

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const vivo = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// Uno stream SSE del terminale: raccoglie l'output in `testo`; `aspetta(re)` finché compare.
function stream(base, percorso, header = {}) {
  return new Promise((ok, no) => {
    const u = new URL(base);
    const s = { testo: "", eventi: [], codice: 0, chiuso: false, req: null };
    s.req = http.get({ host: u.hostname, port: u.port, path: percorso, headers: { host: u.host, ...header } }, (res) => {
      s.codice = res.statusCode;
      let resto = "";
      res.setEncoding("utf8");
      res.on("data", (d) => {
        resto += d;
        const pezzi = resto.split("\n\n"); resto = pezzi.pop();
        for (const p of pezzi) {
          const m = p.match(/^data: (.*)$/m);
          if (!m) continue;
          const ev = JSON.parse(m[1]);
          s.eventi.push(ev);
          s.testo += ev.o || ev.storia || "";
        }
      });
      res.on("end", () => { s.chiuso = true; });
      ok(s);
    });
    s.req.on("error", (e) => (s.codice ? (s.chiuso = true) : no(e)));
  });
}
async function aspetta(cond, ms = 8000) {
  for (let i = 0; i < ms / 50; i++) { if (cond()) return true; await pausa(50); }
  return false;
}

export default async function (t) {
  if (process.platform !== "darwin" && process.platform !== "linux") { t.nota(`terminale non provato su ${process.platform}`); return; }
  const s = await t.avviaServer({});
  const origine = `http://127.0.0.1:${s.porta}`;
  const D = { "x-dashboard": "1", origin: origine };
  const crea = (header = D) => t.post(s.base, "/api/terminali", { righe: 24, colonne: 80 }, header);

  // ───── guardie della creazione ─────
  t.ok((await crea({ origin: origine })).codice === 403, "senza X-Dashboard: 403");
  t.ok((await crea({ "x-dashboard": "1" })).codice === 403, "senza Origin: 403");
  t.ok((await crea({ "x-dashboard": "1", origin: "null" })).codice === 403, "Origin null (foglio o lavagna in iframe sandbox): 403");
  t.ok((await crea({ "x-dashboard": "1", origin: "http://evil.example" })).codice === 403, "Origin esterna: 403");
  t.ok((await crea({ ...D, "sec-fetch-site": "cross-site" })).codice === 403, "Sec-Fetch-Site cross-site: 403");
  t.ok((await t.post(s.base, "/api/terminali", {}, { ...D, host: "evil.example:80" })).codice === 403, "Host estraneo: 403");

  const r = await crea({ ...D, "sec-fetch-site": "same-origin" });
  const j = r.json();
  t.ok(r.codice === 200 && /^t-[0-9a-f]{8}$/.test(j.id) && /^[0-9a-f]{48}$/.test(j.token), `crea: ${r.testo.slice(0, 120)}`);
  if (!j.ok) return;
  const T = { ...D, "x-terminale": j.token };
  const p = (azione, corpo, header = T) => t.post(s.base, `/api/terminali/${j.id}/${azione}`, corpo, header);

  // ───── token su ogni richiesta ─────
  t.ok((await p("input", { dati: "echo no\r" }, D)).codice === 404, "input senza token: 404");
  t.ok((await p("input", { dati: "echo no\r" }, { ...D, "x-terminale": "0".repeat(48) })).codice === 404, "input con token sbagliato: 404");
  const senza = await stream(s.base, `/api/terminali/${j.id}/stream`);
  t.ok(senza.codice === 404, "stream senza token: 404");
  const fuori = await stream(s.base, `/api/terminali/${j.id}/stream?token=${j.token}`, { origin: "null" });
  t.ok(fuori.codice === 403, "stream con Origin null: 403");

  // ───── la shell risponde, nella cartella di lavoro ─────
  const st = await stream(s.base, `/api/terminali/${j.id}/stream?token=${j.token}`, { "sec-fetch-site": "same-origin" });
  t.ok(st.codice === 200 && st.eventi[0]?.righe === 24, "stream collegato, la prima riga dice la dimensione");
  t.ok((await p("input", { dati: "echo PID=$$ CART=$(pwd -P) SOMMA=$((40+2)); stty size\r" })).codice === 200, "input accettato");
  t.ok(await aspetta(() => /SOMMA=42/.test(st.testo) && /\b24 80\b/.test(st.testo)), `la shell risponde con 24 righe e 80 colonne: ${JSON.stringify(st.testo.slice(-200))}`);
  const pid = Number((st.testo.match(/PID=(\d+)/) || [])[1]);
  t.ok(st.testo.includes(`CART=${t.cartella}`), "la shell parte nella cartella di lavoro");

  // ───── ridimensionamento ─────
  const d = await p("dimensioni", { righe: 40, colonne: 120 });
  t.ok(d.codice === 200 && d.json().righe === 40, `dimensioni: ${d.testo.slice(0, 120)}`);
  await p("input", { dati: "stty size\r" });
  t.ok(await aspetta(() => /\b40 120\b/.test(st.testo)), "dopo il ridimensionamento stty dice 40 120");

  // ───── chiusura a comando: la shell muore ─────
  t.ok((await p("chiudi", {})).codice === 200, "chiudi");
  t.ok(await aspetta(() => st.chiuso), "lo stream si chiude");
  t.ok(st.eventi.some((e) => e.fine), "l'ultimo evento dice fine");
  t.ok(pid > 0 && (await aspetta(() => !vivo(pid), 5000)), `la shell (pid ${pid}) è morta`);
  t.ok((await p("input", { dati: "x" })).codice === 404, "un terminale chiuso non c'è più");

  // ───── sendBeacon della pagina che si chiude: token nella query, Origin obbligatoria ─────
  const j3 = (await crea()).json();
  const fine = (q, header) => t.post(s.base, `/api/terminali/${j3.id}/fine${q}`, "", header);
  t.ok((await fine(`?token=${j3.token}`, {})).codice === 403, "fine senza Origin: 403");
  t.ok((await fine("?token=sbagliato", { origin: origine })).codice === 404, "fine con token sbagliato: 404");
  t.ok((await fine(`?token=${j3.token}`, { origin: origine, "sec-fetch-site": "same-origin" })).codice === 200, "fine col token chiude");
  t.ok((await t.post(s.base, `/api/terminali/${j3.id}/input`, { dati: "x" }, { ...D, "x-terminale": j3.token })).codice === 404, "dopo fine il terminale non c'è più");

  // ───── all'uscita del server le shell muoiono ─────
  const j2 = (await crea()).json();
  const st2 = await stream(s.base, `/api/terminali/${j2.id}/stream?token=${j2.token}`);
  await t.post(s.base, `/api/terminali/${j2.id}/input`, { dati: "echo PID=$$\r" }, { ...D, "x-terminale": j2.token });
  await aspetta(() => /PID=\d+/.test(st2.testo));
  const pid2 = Number((st2.testo.match(/PID=(\d+)/) || [])[1]);
  await s.chiudi();
  t.ok(pid2 > 0 && (await aspetta(() => !vivo(pid2), 5000)), `all'uscita del server la shell (pid ${pid2}) muore`);

  // ───── file della lavagna isolati anche aperti da soli ─────
  const s2 = await t.avviaServer({});
  const up = await t.post(s2.base, "/api/lavagna/carica?nome=prova-terminale.html", "<p>ciao</p>", { "x-dashboard": "1", "content-type": "application/octet-stream" });
  const g = await t.get(s2.base, up.json().percorso || "/lavagna/prova-terminale.html");
  t.ok(/sandbox/.test(g.header["content-security-policy"] || ""), "un html della lavagna arriva con CSP sandbox (origine opaca)");
}
