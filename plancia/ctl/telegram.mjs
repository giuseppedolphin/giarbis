// Il comando `telegram` di ctl.mjs (stessa forma dei comandi dei moduli: `comandi`, `aiuto`, `opzioni`): la chat della persona
// col suo assistente e il gruppo. Scrive solo l'assistente (COCKPIT_SESSIONE); da terminale scrive la persona. Il token non passa mai di qui.
const ora = (t) => new Date(t).toLocaleString("it-IT", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const spento = (s) => `Telegram spento: ${s.motivo}`;

async function telegram({ args, opz, api, uso, io }) {
  const [sub = "stato", ...resto] = args;
  if (sub === "stato") {
    const { telegram: s } = await api("GET", "/api/telegram");
    if (!s.acceso) return console.log(spento(s));
    return console.log([
      `Telegram${s.bot ? ` (@${s.bot.username})` : ""}: ${s.disponibile ? "risponde" : `non risponde, ${s.motivo}`}`,
      `persona: ${s.persona ? `abbinata (${s.persona.nome})` : "non abbinata"} · gruppo: ${s.gruppo ? `abbinato («${s.gruppo.titolo}»)` : "non abbinato"} · ${s.inOrario ? "in orario" : "fuori orario"}`,
      `domande su Telegram: urgenti dopo ${s.regole.urgentiDopoMinuti} min, fuori orario dopo ${s.regole.fuoriOrarioDopoMinuti} min · in corso ${s.mandate} · specchio del ponte ${s.regole.specchioPonte ? `acceso${s.regole.gruppoPersone ? ` (fili fra ${s.regole.gruppoPersone.join(", ")})` : ""}` : "spento"}`,
      s.codice ? `codice di abbinamento: ${s.codice} (in privato al bot «/start ${s.codice}», nel gruppo «/abbina ${s.codice}»)` : "",
    ].filter(Boolean).join("\n"));
  }
  if (sub === "scrivi") {
    const testo = resto.join(" ").trim();
    if (!testo) uso('ctl.mjs telegram scrivi "testo" [--gruppo]');
    const j = await api("POST", "/api/telegram", { testo, gruppo: !!opz.gruppo, sessione: io });
    return console.log(j.inviato ? `su Telegram, ${j.dove === "gruppo" ? "nel gruppo" : "in privato"}` : `${j.incerto ? "forse mandato" : "non mandato"}: ${j.motivo}`);
  }
  if (sub === "ultimi") {
    const j = await api("GET", `/api/telegram/messaggi?n=${Number(resto[0]) || 15}`);
    if (!j.acceso) return console.log(spento(j));
    return console.log(j.messaggi.map((m) => `${ora(m.t)}  ${m.dove === "gruppo" ? "gruppo" : "privata"} · ${m.da}: ${m.testo.replace(/\s*\n\s*/g, " ⏎ ")}`).join("\n") || "nessun messaggio");
  }
  if (sub === "abbina") {
    const j = await api("POST", "/api/telegram/abbina", { nuovo: !!opz.nuovo });
    if (!j.acceso) return console.log(spento(j));
    return console.log(`codice: ${j.codice}\n- in privato al bot${j.bot ? ` @${j.bot}` : ""}: /start ${j.codice}${j.persona ? " (persona già abbinata)" : ""}\n- nel gruppo, dalla persona: /abbina ${j.codice}${j.gruppo ? " (gruppo già abbinato)" : ""}`);
  }
  if (sub === "scollega") {
    if (!["persona", "gruppo"].includes(resto[0])) uso("ctl.mjs telegram scollega persona|gruppo");
    await api("POST", "/api/telegram/scollega", { cosa: resto[0] });
    return console.log(`${resto[0]} scollegat${resto[0] === "persona" ? "a (e il gruppo con lei)" : "o"}`);
  }
  if (sub === "controlla") {
    const j = await api("POST", "/api/telegram/controlla");
    return console.log(j.esito === "spento" ? spento(j) : `controllo: ${j.esito}${j.motivo ? ` (${j.motivo})` : ""}${j.domande ? ` · domande mandate ${j.domande.mandate}, chiuse ${j.domande.chiuse}` : ""}`);
  }
  return uso('ctl.mjs telegram [stato] | scrivi "testo" [--gruppo] | ultimi [n] | abbina [--nuovo] | scollega persona|gruppo | controlla');
}

export const comandi = { telegram };
export const opzioni = { booleane: ["gruppo", "nuovo"] };
export const aiuto = [
  'telegram [stato] | scrivi "testo" [--gruppo] | ultimi [n] | abbina [--nuovo] | scollega persona|gruppo | controlla   la chat Telegram con la persona e il gruppo (scrive solo l\'assistente)',
];
