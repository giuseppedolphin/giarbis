// Telegram (spec interna) su un'API finta (TELEGRAM_API), mai quella vera: abbinamento col codice, chat
// non autorizzate ignorate, turni [telegram] dalla persona e dalle menzioni nel gruppo, ctl telegram scrivi solo dall'assistente,
// domande della casella coi pulsanti e risposte da Telegram, specchio del ponte nel gruppo, il token mai nelle risposte, spento
// senza token, orario e silenzio nel fuso, vocali trascritti (getFile e trascrizione finti: ELEVENLABS_API e OPENAI_API puntano qui).
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PERSONE = [{ email: "g@esempio.it", slug: "anna", nome: "Anna" }, { email: "a@esempio.it", slug: "marco", nome: "Marco" }];
const TOKEN = "123456:segreto-di-prova";
const PERSONA = { id: 111, first_name: "Ann", is_bot: false }, SOCIO = { id: 222, first_name: "Mar", is_bot: false }, ESTRANEO = { id: 555, first_name: "X", is_bot: false };
const PRIVATA = { id: 111, type: "private" }, GRUPPO = { id: -200, type: "supergroup", title: "Soci" }, ALTRA = { id: 555, type: "private" };

// il ponte finto, come in ponte.mjs: un file JSON
const MODULO_PONTE = `import { existsSync, readFileSync, writeFileSync } from "node:fs";
export default { nome: "ponte-finto", ponte(ctx) {
  const f = ctx.opzioni.file;
  const leggi = () => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : { messaggi: [] });
  return {
    nonLetti: async (p) => leggi().messaggi.filter((m) => m.destinatario === p && !m.letto_il),
    segnaLetti: async () => {},
    scrivi: async (m) => { const d = leggi(); const r = { id: d.messaggi.length + 1, creato: new Date().toISOString(), thread: null, letto_il: null, ...m }; d.messaggi.push(r); writeFileSync(f, JSON.stringify(d)); return r; },
    filo: async () => leggi().messaggi,
  };
} };
`;

// l'API finta, in un processo suo (i ctl di prova sono sincroni e fermerebbero un server di questo processo): getUpdates dalla
// coda (dall'offset), sendMessage ed edit registrati; /_arriva, /_conflitto e /_chiamate la comandano dal controllo
const API_FINTA = `const http = require("node:http");
const TOKEN = ${JSON.stringify(TOKEN)};
const chiamate = [], coda = [];
let prossimo = 1, idMsg = 100, conflitto = false;
const server = http.createServer((req, res) => {
  let corpo = "";
  req.on("data", (d) => { corpo += d; });
  req.on("end", () => {
    // la trascrizione finta (ElevenLabs e OpenAI): il file scaricato è "AUDIO:<file_id>"; un file_id con "rotto" fallisce
    if (req.url === "/v1/speech-to-text" || req.url === "/v1/audio/transcriptions") {
      const id = (/AUDIO:(\\w+)/.exec(corpo) || [])[1] || "";
      chiamate.push({ metodo: "trascrivi", dati: { url: req.url, id, it: /name="language_code"\\s+ita/.test(corpo) || /name="language"\\s+it/.test(corpo) } });
      if (!id || id.includes("rotto")) { res.statusCode = 500; return res.end(JSON.stringify({ detail: { message: "guasto finto" } })); }
      return res.end(JSON.stringify({ text: "trascrizione di " + id }));
    }
    if (req.url.startsWith("/file/bot")) {
      const [, tok, id] = /^\\/file\\/bot([^/]+)\\/voice\\/(\\w+)\\.ogg$/.exec(req.url) || [];
      chiamate.push({ metodo: "scarica", dati: { id } });
      if (tok !== TOKEN) { res.statusCode = 404; return res.end(); }
      return res.end("AUDIO:" + id);
    }
    const dati = corpo ? JSON.parse(corpo) : {};
    const ok = (result) => res.end(JSON.stringify({ ok: true, result }));
    if (req.url === "/_chiamate") return res.end(JSON.stringify(chiamate));
    if (req.url === "/_conflitto") { conflitto = !!dati.v; return ok(true); }
    if (req.url === "/_arriva") {
      const u = dati.u;
      if (u.message) u.message.message_id = ++idMsg;
      coda.push({ update_id: prossimo++, ...u });
      return ok(u.message ? u.message.message_id : null);
    }
    const [, tok, metodo] = /^\\/bot([^/]+)\\/(\\w+)$/.exec(req.url) || [];
    const voce = { metodo, dati };
    chiamate.push(voce);
    if (tok !== TOKEN) return res.end(JSON.stringify({ ok: false, error_code: 401, description: "Unauthorized" }));
    if (metodo === "getMe") return ok({ id: 999, is_bot: true, username: "prova_bot" });
    if (metodo === "getUpdates") {
      if (conflitto) return res.end(JSON.stringify({ ok: false, error_code: 409, description: "Conflict: terminated by other getUpdates request" }));
      return ok(coda.filter((u) => u.update_id >= (dati.offset || 0)));
    }
    if (metodo === "getFile") return ok({ file_id: dati.file_id, file_path: "voice/" + dati.file_id + ".ogg" });
    if (metodo === "sendMessage") { voce.risultato = { message_id: ++idMsg, chat: { id: dati.chat_id }, text: dati.text }; return ok(voce.risultato); }
    return ok(true);
  });
});
server.listen(0, "127.0.0.1", () => console.log(server.address().port));`;

async function apiFinta() {
  const figlio = spawn(process.execPath, ["-e", API_FINTA], { stdio: ["ignore", "pipe", "inherit"] });
  const porta = await new Promise((ok) => figlio.stdout.once("data", (d) => ok(Number(String(d).trim()))));
  const base = `http://127.0.0.1:${porta}`;
  const post = async (p, corpo) => (await fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) })).json();
  const f = {
    base, chiamate: [],
    chiudi: () => figlio.kill(),
    async aggiorna() { f.chiamate = await (await fetch(`${base}/_chiamate`)).json(); },
    arriva: async (u) => (await post("/_arriva", { u })).result,
    messaggio: (chat, from, text, extra = {}) => f.arriva({ message: { chat, from, text, date: 0, ...extra } }),
    inviati: (chat) => f.chiamate.filter((c) => c.metodo === "sendMessage" && (chat === undefined || c.dati.chat_id === chat)),
    conflitto: (v) => post("/_conflitto", { v }),
  };
  return f;
}

export default async function (t) {
  const scrivi = (file, dati) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, typeof dati === "string" ? dati : JSON.stringify(dati)); };
  const finta = await apiFinta();
  const API = finta.base;
  try {
    // ───── orario e silenzio nel fuso (funzioni pure) ─────
    const { inOrario, inSilenzio } = await import(pathToFileURL(path.join(t.plancia, "server/telegram.mjs")).href);
    const regole = { orario: { dalle: "09:30", alle: "19:30", giorni: [1, 2, 3, 4, 5] }, silenzio: { dalle: "23:00", alle: "07:30" } };
    const lun10 = Date.parse("2026-10-19T08:00:00Z"), lun21 = Date.parse("2026-10-19T19:00:00Z"), dom10 = Date.parse("2026-10-18T08:00:00Z"), mar0130 = Date.parse("2026-10-19T23:30:00Z");
    t.ok(inOrario(regole, "Europe/Rome", lun10) && !inOrario(regole, "Europe/Rome", lun21) && !inOrario(regole, "Europe/Rome", dom10), "orario: lunedì 10:00 sì, lunedì 21:00 no, domenica no");
    t.ok(inSilenzio(regole, "Europe/Rome", mar0130) && !inSilenzio(regole, "Europe/Rome", lun10) && inOrario({}, "Europe/Rome", lun21), "silenzio a cavallo della mezzanotte; senza orario si è sempre in orario");

    // ───── un server di prova con Telegram acceso, sempre fuori orario, il ponte finto ─────
    const extra = realpathSync(t.tmp());
    scrivi(path.join(extra, "ponte-finto", "modulo.mjs"), MODULO_PONTE);
    const coda = path.join(extra, "coda.json");
    writeFileSync(coda, JSON.stringify({ messaggi: [] }));
    const cfgFile = path.join(realpathSync(t.tmp()), "plancia.config.json");
    scrivi(cfgFile, {
      assistente: { nome: "Pilota", slug: "pilota" }, persone: [...PERSONE, { email: "v@esempio.it", slug: "sara", nome: "Sara" }], moduli: { "ponte-finto": { file: coda } },
      telegram: { acceso: true, urgentiDopoMinuti: 15, fuoriOrarioDopoMinuti: 0, orario: { dalle: "09:30", alle: "19:30", giorni: [] }, gruppoPersone: ["anna", "marco"], whisper: false },
    });
    const env = { PLANCIA_CONFIG: cfgFile, PLANCIA_MODULI_EXTRA: extra, TELEGRAM_API: API, TELEGRAM_BOT_TOKEN: TOKEN, ELEVENLABS_API: API, OPENAI_API: API, ELEVENLABS_API_KEY: "chiave-finta-eleven", OPENAI_API_KEY: "" };
    const s = await t.avviaServer(env);
    const H = { "x-dashboard": "1" };
    const ctl = (args, e = {}) => t.ctl(args, { COCKPIT_STATO: s.stato, COCKPIT_PORTA: String(s.porta), COCKPIT_SESSIONE: "", ...env, ...e });
    const controlla = async () => { const j = (await t.post(s.base, "/api/telegram/controlla", {}, H)).json(); await finta.aggiorna(); return j; };
    const stato = async () => (await t.get(s.base, "/api/telegram", H)).json().telegram;
    const o = (await t.get(s.base, "/api/sessioni", H)).json().sessioni.find((x) => x.ruolo === "orchestratore");
    const turni = async () => (await t.get(s.base, `/api/sessioni/${o.id}/eventi`, H)).json().eventi.filter((e) => e.type === "cockpit_utente" && e.origine === "telegram");

    const st0 = await stato();
    t.ok(st0.acceso && !st0.persona && !st0.gruppo && st0.codice === null && st0.inOrario === false, `acceso, niente abbinato, fuori orario (${JSON.stringify(st0).slice(0, 160)})`);
    const abb = ctl(["telegram", "abbina"]);
    const codice = (/codice: (\S+)/.exec(abb.out) || [])[1];
    t.ok(abb.codice === 0 && codice && codice.length === 8 && /\/start /.test(abb.out) && /\/abbina /.test(abb.out), `ctl telegram abbina: ${abb.out.split("\n")[0]}`);

    // abbinamento: estraneo col codice sbagliato, persona col codice giusto, gruppo solo dalla persona
    await finta.messaggio(ALTRA, ESTRANEO, "/start sbagliato");
    await finta.messaggio(PRIVATA, PERSONA, `/start ${codice}`);
    await finta.messaggio(ALTRA, ESTRANEO, `/start ${codice}`); // codice giusto, ma la persona c'è già
    await finta.messaggio(GRUPPO, SOCIO, `/abbina ${codice}`);
    await finta.messaggio(GRUPPO, PERSONA, `/abbina@prova_bot ${codice}`);
    const c1 = await controlla();
    const st1 = await stato();
    t.ok(c1.aggiornamenti === 5 && st1.persona?.nome === "Ann" && st1.gruppo?.titolo === "Soci" && st1.codice === null && st1.ignorati === 3,
      `abbinati persona e gruppo; estranei e socio ignorati (${JSON.stringify({ c1, persona: st1.persona, gruppo: st1.gruppo, ignorati: st1.ignorati })})`);
    t.ok(finta.inviati(111).length === 1 && finta.inviati(-200).length === 1 && finta.inviati(555).length === 0, "conferma in privato e nel gruppo, niente agli estranei");
    const c1b = await controlla();
    t.ok(c1b.aggiornamenti === 0, "l'offset avanza: gli stessi aggiornamenti non tornano");

    // turni: la persona in privato, nel gruppo solo menzione o risposta al bot; una chat estranea no
    await finta.messaggio(PRIVATA, PERSONA, "A che punto è la proposta?");
    await finta.messaggio(GRUPPO, SOCIO, "buongiorno a tutti");
    await finta.messaggio(GRUPPO, SOCIO, "@prova_bot ci sei?");
    await finta.messaggio(ALTRA, ESTRANEO, "ciao bot");
    await controlla();
    const tr = await turni();
    t.ok(tr.length === 2 && /^\[telegram\] Anna scrive: A che punto è la proposta\?/.test(tr[0].testo) && /^\[telegram\] Nel gruppo «Soci», Mar scrive: @prova_bot ci sei\?/.test(tr[1].testo),
      `turni: privata e menzione nel gruppo (${tr.map((x) => x.testo.slice(0, 60)).join(" | ")})`);
    t.ok(/telegram scrivi/.test(tr[0].testo) && /non viene letto ad alta voce/.test(tr[0].testo), "il turno porta il prompt di telegram.md");
    const ult = ctl(["telegram", "ultimi", "10"]);
    t.ok(ult.codice === 0 && /gruppo · Mar: buongiorno a tutti/.test(ult.out) && !/ciao bot/.test(ult.out), "ctl telegram ultimi: il registro ha il gruppo, non gli estranei");

    // i vocali: trascritti e passati come [vocale] …; trascrizione guasta o troppo lunga = avviso all'assistente; nel gruppo solo se per il bot
    const vocale = (id, durata = 4) => ({ voice: { file_id: id, duration: durata, mime_type: "audio/ogg", file_size: 1000 } });
    await finta.messaggio(PRIVATA, PERSONA, undefined, vocale("v1"));
    await finta.messaggio(PRIVATA, PERSONA, undefined, vocale("rotto"));
    await finta.messaggio(PRIVATA, PERSONA, undefined, vocale("lungo", 9999));
    await finta.messaggio(GRUPPO, SOCIO, undefined, vocale("chiacchiera"));
    await finta.messaggio(GRUPPO, SOCIO, undefined, { ...vocale("perpilota"), reply_to_message: { message_id: 1, from: { id: 999, is_bot: true } } });
    await finta.messaggio(GRUPPO, PERSONA, undefined, vocale("v2"));
    await controlla();
    const trV = (await turni()).slice(2);
    const priv = trV.find((x) => /Anna scrive: \[vocale\] trascrizione di v1/.test(x.testo)) , grp = trV.find((x) => /Nel gruppo «Soci», Mar scrive: \[vocale\] trascrizione di perpilota/.test(x.testo));
    t.ok(trV.length === 2 && priv && grp, `vocali trascritti come [vocale] … in privato e nel gruppo (${trV.map((x) => x.testo.slice(0, 200)).join(" | ")})`);
    t.ok(/vocale di 4 s che non sono riuscito a trascrivere \(ElevenLabs: HTTP 500: guasto finto; OpenAI: nessuna chiave\)/.test(priv?.testo || "") && /oltre il limite di 300 s/.test(priv?.testo || ""), "trascrizione guasta e vocale troppo lungo: avviso chiaro all'assistente");
    const tr2 = finta.chiamate.filter((c) => c.metodo === "trascrivi"), sc2v = finta.chiamate.filter((c) => c.metodo === "scarica");
    t.ok(tr2.every((c) => c.dati.url === "/v1/speech-to-text" && c.dati.it) && tr2.map((c) => c.dati.id).sort().join() === "perpilota,rotto,v1,v2" && !sc2v.some((c) => ["lungo", "chiacchiera"].includes(c.dati.id)),
      `trascritti solo i vocali dovuti, in italiano su ElevenLabs (${tr2.map((c) => c.dati.id).join()})`);
    const ultV = ctl(["telegram", "ultimi", "20"]);
    t.ok(/Mar: \[vocale non trascritto\]/.test(ultV.out) && /\[vocale\] trascrizione di v2/.test(ultV.out) && !/chiave-finta/.test(ultV.out + JSON.stringify(trV)), "nel registro anche i vocali del gruppo; la chiave non compare");

    // scrivere: l'assistente sì, una sessione che non c'è no; lunghezza
    const sc = ctl(["telegram", "scrivi", "Proposta pronta, te la mostro domattina"], { COCKPIT_SESSIONE: o.id });
    const scg = ctl(["telegram", "scrivi", "Ci sono", "--gruppo"], { COCKPIT_SESSIONE: o.id });
    const scx = ctl(["telegram", "scrivi", "ciao"], { COCKPIT_SESSIONE: "nessuna" });
    const lungo = (await t.post(s.base, "/api/telegram", { testo: "x".repeat(1001) }, H)).json();
    await finta.aggiorna();
    t.ok(sc.codice === 0 && /in privato/.test(sc.out) && scg.codice === 0 && /nel gruppo/.test(scg.out), `ctl telegram scrivi: ${sc.out.trim()} / ${scg.out.trim()}`);
    t.ok(finta.inviati(111).some((c) => c.dati.text === "Proposta pronta, te la mostro domattina") && finta.inviati(-200).some((c) => c.dati.text === "Ci sono"), "i messaggi arrivano alle chat giuste");
    t.ok(scx.codice !== 0 && /sessione sconosciuta/.test(scx.out) && lungo.ok === false && /troppo lungo/.test(lungo.errore || ""), "rifiutati: sessione sconosciuta e messaggio troppo lungo");

    // le domande della casella: fuori orario partono, coi pulsanti; risposta da pulsante e da risposta al messaggio
    const q1 = (await t.post(s.base, "/api/domande", { testo: "Mando la mail a Rossi?", opzioni: "Sì|No", urgente: true }, H)).json().domanda;
    const q2 = (await t.post(s.base, "/api/domande", { testo: "Che giorno per la call?" }, H)).json().domanda;
    const c2 = await controlla();
    const m1 = finta.inviati(111).find((c) => c.dati.text.includes("Mando la mail a Rossi?"));
    const m2 = finta.inviati(111).find((c) => c.dati.text.includes("Che giorno per la call?"));
    t.ok(c2.domande?.mandate === 2 && m1 && m2, `due domande su Telegram (${JSON.stringify(c2.domande)})`);
    const tasti = m1?.dati.reply_markup?.inline_keyboard?.[0] || [];
    t.ok(tasti.map((b) => b.text).join() === "Sì,No" && tasti[0].callback_data === `d|${q1.id}|0` && !m2?.dati.reply_markup && /Rispondi a questo messaggio/.test(m2?.dati.text || ""), "pulsanti per le opzioni; senza opzioni si risponde al messaggio");
    const c2b = await controlla();
    t.ok(c2b.domande?.mandate === 0, "una domanda si manda una volta sola");
    const idM2 = m2?.risultato?.message_id;
    await finta.arriva({ callback_query: { id: "cb-x", from: ESTRANEO, data: `d|${q1.id}|1` } });
    await finta.arriva({ callback_query: { id: "cb-1", from: PERSONA, data: `d|${q1.id}|0` } });
    await finta.messaggio(PRIVATA, PERSONA, "giovedì alle 15", { reply_to_message: { message_id: idM2 } });
    const c3 = await controlla();
    const dom = (await t.get(s.base, "/api/domande?tutte=1", H)).json();
    const r1 = dom.chiuse.find((q) => q.id === q1.id), r2 = dom.chiuse.find((q) => q.id === q2.id);
    t.ok(r1?.risposta === "Sì" && r2?.risposta === "giovedì alle 15" && c3.turni === 0, `risposte da Telegram: «${r1?.risposta}», «${r2?.risposta}»; nessun turno all'assistente`);
    t.ok(finta.chiamate.some((c) => c.metodo === "answerCallbackQuery" && c.dati.callback_query_id === "cb-1") && !finta.chiamate.some((c) => c.dati.callback_query_id === "cb-x"), "il pulsante risponde alla persona, l'estraneo è ignorato");
    const edit = finta.chiamate.filter((c) => c.metodo === "editMessageText");
    t.ok(edit.length === 2 && edit.some((c) => /✓ risposta: Sì/.test(c.dati.text)) && (await stato()).mandate === 0, "chiusa la domanda, il messaggio su Telegram lo dice e perde i pulsanti");

    // una risposta lunga da Telegram arriva intera; oltre il tetto lo si dice lì e la domanda resta aperta; l'eco sul messaggio sta nei 4096 di Telegram
    const lungaT = `${"a".repeat(1500)}\n\n${"b".repeat(1498)}`, testoQ = (x) => `${x} ${"d".repeat(185)}?`;
    const q3 = (await t.post(s.base, "/api/domande", { testo: testoQ("Terza") }, H)).json().domanda;
    const q4 = (await t.post(s.base, "/api/domande", { testo: testoQ("Quarta") }, H)).json().domanda;
    await controlla();
    const idDi = (x) => finta.inviati(111).find((c) => c.dati.text.includes(x))?.risultato?.message_id;
    await finta.messaggio(PRIVATA, PERSONA, lungaT, { reply_to_message: { message_id: idDi("Terza") } });
    await finta.messaggio(PRIVATA, PERSONA, "x".repeat(4050), { reply_to_message: { message_id: idDi("Quarta") } });
    const cLunghe = await controlla();
    const dom2 = (await t.get(s.base, "/api/domande?tutte=1", H)).json();
    t.ok(dom2.chiuse.find((q) => q.id === q3.id)?.risposta === lungaT && cLunghe.turni === 0, "3000 battute da Telegram: intere, con gli a capo");
    t.ok(dom2.aperte.some((q) => q.id === q4.id) && finta.inviati(111).some((c) => /troppo lunga.*4050.*4000/.test(c.dati.text)), "oltre il tetto: Telegram lo dice e la domanda resta aperta");
    await t.post(s.base, `/api/domande/${q4.id}/risposta`, { risposta: "y".repeat(4000), come: "libera" }, H);
    await controlla();
    const edit2 = finta.chiamate.filter((c) => c.metodo === "editMessageText" && c.dati.text.includes("Quarta")).at(-1);
    t.ok(edit2 && edit2.dati.text.length <= 4096 && /✓ risposta: y+…$/.test(edit2.dati.text), `l'eco della risposta sta nel messaggio di Telegram (${edit2?.dati.text.length} caratteri)`);

    // lo specchio del ponte nel gruppo: solo il filo fra due persone del gruppo (gruppoPersone), quello con Sara no
    await t.post(s.base, "/api/ponte", { testo: "Accesso al archivio pronto", a: "sara" }, H);
    await t.post(s.base, "/api/ponte", { testo: "Domani alle 10 call con Acme, ci sei?", a: "marco" }, H);
    let specchio = null;
    for (let i = 0; i < 20 && !specchio; i++) { await finta.aggiorna(); specchio = finta.inviati(-200).find((c) => /^↔ Ponte n\. 2/.test(c.dati.text)); if (!specchio) await new Promise((r) => setTimeout(r, 100)); }
    t.ok(specchio && /Anna → Marco: Domani alle 10/.test(specchio.dati.text), `specchio del ponte nel gruppo: ${specchio?.dati.text}`);
    t.ok(!finta.inviati(-200).some((c) => /Sara|Accesso al archivio/.test(c.dati.text || "")), "il filo con chi non è nel gruppo non va nel gruppo");

    // il token non esce mai
    const tutto = JSON.stringify([await stato(), (await t.get(s.base, "/api/telegram/messaggi?n=200", H)).json()]) + ctl(["telegram"]).out;
    t.ok(!tutto.includes("segreto-di-prova"), "il token non compare in API e ctl");

    // 409: due plance con lo stesso bot
    await finta.conflitto(true);
    const c4 = await controlla();
    await finta.conflitto(false);
    t.ok(c4.esito === "non disponibile" && /409/.test(c4.motivo) && !String(c4.motivo).includes("segreto"), `getUpdates in conflitto: ${c4.motivo}`);
    t.ok((await controlla()).esito !== "non disponibile" && (await stato()).disponibile, "tornato a rispondere");
    const scol = ctl(["telegram", "scollega", "persona"]);
    const st5 = await stato();
    t.ok(scol.codice === 0 && !st5.persona && !st5.gruppo, "scollega persona: via anche il gruppo");

    // senza token: spento, nessun errore
    const s2 = await t.avviaServer({ ...env, TELEGRAM_BOT_TOKEN: "" });
    const st2 = (await t.get(s2.base, "/api/telegram", H)).json().telegram;
    const sc2 = (await t.post(s2.base, "/api/telegram", { testo: "x" }, H)).json();
    const ctl2 = t.ctl(["telegram", "scrivi", "x"], { COCKPIT_STATO: s2.stato, COCKPIT_PORTA: String(s2.porta), COCKPIT_SESSIONE: "", ...env, TELEGRAM_BOT_TOKEN: "" });
    const co2 = (await t.post(s2.base, "/api/telegram/controlla", {}, H)).json();
    t.ok(!st2.acceso && /token/.test(st2.motivo) && sc2.ok && sc2.inviato === false && ctl2.codice === 0 && /non mandato/.test(ctl2.out) && co2.esito === "spento", `senza token: spento (${st2.motivo})`);
    // senza blocco telegram nella config: spento
    const cfgSenza = path.join(realpathSync(t.tmp()), "plancia.config.json");
    scrivi(cfgSenza, { assistente: { nome: "Pilota", slug: "pilota" }, persone: PERSONE });
    const s3 = await t.avviaServer({ ...env, PLANCIA_CONFIG: cfgSenza });
    const st3 = (await t.get(s3.base, "/api/telegram", H)).json().telegram;
    t.ok(!st3.acceso && /acceso/.test(st3.motivo), `senza config: spento (${st3.motivo})`);
  } finally {
    finta.chiudi();
  }
}
