// Il minimo: ogni file .mjs/.js di plancia/ ha sintassi valida, e il server (quello che c'è) risponde e si difende.
import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

function file(dir, out = []) {
  for (const v of readdirSync(dir, { withFileTypes: true })) {
    if (v.name === "node_modules" || v.name.startsWith(".")) continue;
    const p = path.join(dir, v.name);
    if (v.isDirectory()) file(p, out); else if (/\.(mjs|js)$/.test(v.name)) out.push(p);
  }
  return out;
}

export default async function (t) {
  const elenco = file(t.plancia);
  for (const f of elenco) {
    const r = spawnSync(process.execPath, ["--check", f], { encoding: "utf8" });
    t.ok(r.status === 0, `node --check ${path.relative(t.cartella, f)}: ${String(r.stderr).split("\n").slice(0, 3).join(" ")}`);
  }
  t.ok(elenco.length > 0, "nessun file .mjs/.js trovato in plancia/");

  // lo stato si scrive solo da server/stato.mjs (e dalle migrazioni); fuori dallo stato scrivono solo le to-do del modulo rd-repo
  // dei moduli
  const SCRITTURA = /\b(writeFileSync|appendFileSync|renameSync|copyFileSync|cpSync|mkdirSync|rmSync|unlinkSync|rmdirSync|createWriteStream)\b|\bfs\.(writeFile|appendFile|mkdir|rm|rename|copyFile)\(|\bwriteFile\(/;
  const AMMESSI = new Set(["server/stato.mjs", "server/migrazioni.mjs", "moduli/rd-dashboard/pannelli.mjs"]);
  for (const f of elenco) {
    const rel = path.relative(t.plancia, f).split(path.sep).join("/");
    if (AMMESSI.has(rel) || rel.startsWith("moduli/rd-repo/") || rel.startsWith("test/") || !/^(server|moduli)\/|^ctl\.mjs$/.test(rel)) continue;
    readFileSync(f, "utf8").split("\n").forEach((riga, i) => {
      t.ok(!SCRITTURA.test(riga), `${rel}:${i + 1}: scrive sul disco fuori da stato.mjs: ${riga.trim().slice(0, 90)}`);
    });
  }

  const s = await t.avviaServer({});
  const cockpit = await t.get(s.base, "/cockpit");
  t.ok(cockpit.codice === 200, `GET /cockpit: ${cockpit.codice}`);
  const hostSbagliato = await t.get(s.base, "/cockpit", { host: "esempio.test" });
  t.ok(hostSbagliato.codice === 403, `Host sbagliato: ${hostSbagliato.codice} (atteso 403)`);
  const senza = await t.post(s.base, "/api/sessioni", { nome: "x" });
  t.ok(senza.codice === 403, `POST senza X-Dashboard: ${senza.codice} (atteso 403)`);
}
