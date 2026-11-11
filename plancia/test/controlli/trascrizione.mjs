// La trascrizione locale dei vocali (server/trascrizione.mjs): whisper.cpp prima di ElevenLabs e OpenAI. Non dipende da whisper
// installato: ffmpeg e whisper-cli sono due script finti in una cartella temporanea, ElevenLabs è un server finto qui. Ogni caso
// gira in un processo node suo, con una config sua (PLANCIA_CONFIG) e uno stato temporaneo senza chiavi. Casi: riuscita dal
// locale, cli guasto o lento o muto → riserva col motivo nei guasti, file mancanti o `whisper: false` → saltato in silenzio,
// nessuna cartella temporanea lasciata.
import { spawn } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

// ffmpeg finto: copia l'ingresso (-i) nell'ultimo argomento
const FFMPEG = `#!/bin/sh
prev=""; in=""; out=""
for a in "$@"; do [ "$prev" = "-i" ] && in="$a"; out="$a"; prev="$a"; done
cp "$in" "$out"
`;
// whisper-cli finto: il contenuto del wav decide cosa fa; annota la cartella del wav per controllare che sparisca
const CLI = `#!/bin/sh
prev=""; f=""; lingua=""
for a in "$@"; do [ "$prev" = "-f" ] && f="$a"; [ "$prev" = "-l" ] && lingua="$a"; prev="$a"; done
dirname "$f" >> "$FINTO_LOG"
[ "$lingua" = "it" ] || { echo "lingua sbagliata" >&2; exit 9; }
case "$(cat "$f")" in
  ok) printf ' [BLANK_AUDIO]\\n Ciao dal whisper finto.\\n Seconda riga.\\n' ;;
  rotto) echo "modello illeggibile" >&2; exit 3 ;;
  muto) printf ' [BLANK_AUDIO]\\n' ;;
  lento) exec sleep 5 ;;
esac
`;

export default async function (t) {
  if (process.platform === "win32") return t.nota("saltato su Windows: i programmi finti sono script sh");
  const dir = t.tmp();
  const cli = path.join(dir, "whisper-cli"), ffmpeg = path.join(dir, "ffmpeg"), modello = path.join(dir, "modello.bin"), log = path.join(dir, "log.txt");
  writeFileSync(cli, CLI); writeFileSync(ffmpeg, FFMPEG); writeFileSync(modello, "finto"); writeFileSync(log, "");
  chmodSync(cli, 0o755); chmodSync(ffmpeg, 0o755);

  const eleven = [];
  const finta = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => { eleven.push(req.url); res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ text: "dalla riserva" })); });
  });
  await new Promise((ok) => finta.listen(0, "127.0.0.1", ok));
  const API = `http://127.0.0.1:${finta.address().port}`;

  const modulo = pathToFileURL(path.join(t.plancia, "server/trascrizione.mjs")).href;
  const script = path.join(dir, "prova.mjs");
  writeFileSync(script, `const { trascrivi } = await import(${JSON.stringify(modulo)});
try { console.log(JSON.stringify(await trascrivi({ audio: Buffer.from(process.argv[2]), nome: "vocale.ogg" }))); }
catch (e) { console.log(JSON.stringify({ errore: e.message })); }\n`);
  let n = 0;
  const prova = (contenuto, whisper, eleven = "") => new Promise((ok) => {
    const cfg = path.join(dir, `config-${++n}.json`);
    writeFileSync(cfg, JSON.stringify({ telegram: { whisper } }));
    const env = { ...process.env, PLANCIA_CONFIG: cfg, COCKPIT_STATO: t.tmp(), FINTO_LOG: log, ELEVENLABS_API: API, OPENAI_API: "http://127.0.0.1:1", ELEVENLABS_API_KEY: eleven, OPENAI_API_KEY: "" };
    const p = spawn(process.execPath, [script, contenuto], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => { out += d; });
    p.on("exit", () => { try { ok(JSON.parse(out.trim().split("\n").pop())); } catch { ok({ errore: `uscita illeggibile: ${out.slice(0, 200)}` }); } });
  });
  const percorsi = { cli, modello, ffmpeg };

  try {
    const r1 = await prova("ok", percorsi);
    t.ok(r1.servizio === "Whisper locale" && r1.testo === "Ciao dal whisper finto. Seconda riga.", `riuscita dal locale, senza [BLANK_AUDIO] e su una riga (${JSON.stringify(r1)})`);

    const r2 = await prova("rotto", percorsi, "chiave-finta-eleven");
    t.ok(r2.servizio === "ElevenLabs" && r2.testo === "dalla riserva" && eleven.length === 1, `cli guasto: si passa a ElevenLabs (${JSON.stringify(r2)})`);
    const r3 = await prova("rotto", percorsi);
    t.ok(/^Whisper locale: whisper: modello illeggibile; ElevenLabs: nessuna chiave; OpenAI: nessuna chiave$/.test(r3.errore || ""), `il motivo del locale nei guasti (${JSON.stringify(r3)})`);

    const inizio = Date.now();
    const r4 = await prova("lento", { ...percorsi, secondi: 1 });
    t.ok(/^Whisper locale: nessuna risposta in 1 s; ElevenLabs/.test(r4.errore || "") && Date.now() - inizio < 4000, `cli lento: fermato al timeout (${JSON.stringify(r4)}, ${Date.now() - inizio} ms)`);
    const r5 = await prova("muto", percorsi);
    t.ok(/^Whisper locale: trascrizione vuota;/.test(r5.errore || ""), `solo [BLANK_AUDIO]: trascrizione vuota (${JSON.stringify(r5)})`);

    const r6 = await prova("ok", { ...percorsi, modello: path.join(dir, "non-c-e.bin") });
    const r7 = await prova("ok", false);
    t.ok(/^ElevenLabs: nessuna chiave; OpenAI: nessuna chiave$/.test(r6.errore || "") && /^ElevenLabs: nessuna chiave/.test(r7.errore || ""), `file mancante o whisper: false: saltato in silenzio (${r6.errore} | ${r7.errore})`);

    const cartelle = readFileSync(log, "utf8").split("\n").filter(Boolean);
    t.ok(cartelle.length === 5 && cartelle.every((c) => !existsSync(c)), `cartelle temporanee cancellate, anche dopo guasto e timeout (${cartelle.length})`);
  } finally {
    await new Promise((ok) => finta.close(ok));
  }
}
