// Il ponte con le plance delle altre persone nella pagina (server/ponte.mjs): una scheda per persona nel pannello «Bacheca», col
// suo nome (dalla config, GET /api/ponte: `altri`; un server di prima ha solo `altro`), il filo dei messaggi con lei, e la persona
// che scrive direttamente dal compositore. Il numero dei messaggi non ancora visti (memo «ponte.letto.<slug>», di ripiego il
// vecchio «ponte.letto») si somma a quello della bacheca sul pulsante. Un messaggio urgente appena arrivato si dice a voce dalla
// coda unica (diUrgente). Senza ponte le schede non ci sono; col ponte «non disponibile» la scheda dice il motivo e il compositore
// sparisce. Col gruppo Telegram abbinato (GET /api/telegram) le persone del gruppo (`gruppoPersone`) si parlano lì: nel loro filo
// il compositore sparisce e resta il filo degli assistenti; con chi nel gruppo non c'è si scrive ancora da qui. Lo usa bacheca.js.
import { api } from "/condivisi/api.js";
import { su } from "/condivisi/eventi.js";
import { esc } from "/condivisi/formati.js";
import { memo } from "/condivisi/memo.js";
import { citaMe, nuova } from "/condivisi/menzioni.js";
import { diUrgente } from "/condivisi/voce-motore.js";

// fili: slug → messaggi; nuovi: slug → non visti; gruppo: il titolo del gruppo Telegram abbinato, gruppoPersone: chi ci sta
export const P = { stato: null, fili: {}, nuovi: {}, gruppo: "", gruppoPersone: null };
const ora = (t) => new Date(t).toLocaleString("it-IT", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export const altriPonte = () => (Array.isArray(P.stato?.altri) ? P.stato.altri : [P.stato?.altro].filter(Boolean));
export const nomeDi = (slug) => altriPonte().find((x) => x.slug === slug)?.nome || (slug === P.stato?.io?.slug ? P.stato.io.nome : slug);
export const pontePresente = () => altriPonte().length > 0;
export const ponteDisponibile = () => !!P.stato?.disponibile;
export const nuoviPonte = () => Object.values(P.nuovi).reduce((a, b) => a + b, 0);
const nelGruppo = (slug) => !!P.gruppo && (!P.gruppoPersone || (P.gruppoPersone.includes(slug) && P.gruppoPersone.includes(P.stato?.io?.slug)));
export const ponteScrivibile = (slug) => ponteDisponibile() && !nelGruppo(slug);
const letto = (slug) => Number(memo.get(`ponte.letto.${slug}`, memo.get("ponte.letto", "0"))) || 0;

// un messaggio dell'altra parte rivolto alla persona (la tagga, o l'ha scritto l'altra persona in persona): in evidenza
const perMe = (m) => m.mittente !== P.stato?.io?.slug && (m.via === "persona" || citaMe(m.testo));
function messaggio(m) {
  const tag = [m.tipo === "domanda" && "domanda", m.urgente && "urgente", m.via === "persona" && "in persona"].filter(Boolean);
  const evid = perMe(m) ? ` bc-per-te${nuova("ponte", m.id) ? " bc-nuova" : ""}` : "";
  return `<div class="bc-msg${m.urgente ? " pt-urgente" : ""}${evid}"><div class="bc-da"><b>${esc(nomeDi(m.mittente))}</b>${tag.map((x) => `<i class="pt-tag">${esc(x)}</i>`).join("")}`
    + `<span>n. ${esc(String(m.id))} · ${esc(ora(m.creato))}</span></div>`
    + `${m.risposta_a ? `<div class="pt-risp">risponde al n. ${esc(String(m.risposta_a))}</div>` : ""}<div class="bc-t">${esc(m.testo).replace(/\n/g, "<br>")}</div></div>`;
}

export function htmlPonte(slug) {
  if (!P.stato) return '<p class="bc-vuoto">Carico il ponte…</p>';
  const nome = nomeDi(slug);
  if (!P.stato.disponibile) return `<p class="bc-vuoto">Il ponte con ${esc(nome || "l'altra plancia")} non è disponibile: ${esc(P.stato.motivo || "")}.</p>`;
  const gruppo = nelGruppo(slug) ? `<p class="bc-vuoto">Con ${esc(nome)} parli nel gruppo Telegram «${esc(P.gruppo)}»; qui il filo dei due assistenti.</p>` : "";
  return gruppo + ((P.fili[slug] || []).map(messaggio).join("")
    || `<p class="bc-vuoto">Ancora nessun messaggio con ${esc(nome)}. Qui si scrivono i due assistenti${nelGruppo(slug) ? "" : "; puoi scrivere anche tu"}.</p>`);
}

export async function caricaPonte(slug) {
  const j = await api("GET", `/api/ponte/messaggi?n=80&a=${encodeURIComponent(slug)}`);
  P.stato = j.ponte; P.fili[slug] = j.messaggi || [];
}

export async function scriviPonte(slug, testo, { domanda = false, urgente = false } = {}) {
  const j = await api("POST", "/api/ponte", { testo, a: slug, domanda, urgente });
  if (!j.disponibile) throw new Error(`Ponte non disponibile: ${j.motivo}`);
  return j.messaggio;
}

export function ponteLetto(slug) { memo.set(`ponte.letto.${slug}`, String(Date.now())); P.nuovi[slug] = 0; }

// aggiorna(): ridisegna se una scheda del ponte è in vista, e il numero sul pulsante; inVista(): lo slug del filo aperto adesso, o ""
export async function initPonte({ aggiorna, inVista }) {
  try { P.stato = (await api("GET", "/api/ponte")).ponte; } catch { return false; } // server vecchio: niente ponte fino al Riavvia
  if (!pontePresente()) return false;
  const daTelegram = (t) => { P.gruppo = t?.gruppo?.titolo || ""; P.gruppoPersone = Array.isArray(t?.regole?.gruppoPersone) ? t.regole.gruppoPersone : null; };
  try { daTelegram((await api("GET", "/api/telegram")).telegram); } catch { /* server senza Telegram */ }
  su("cockpit_telegram", (ev) => { if (ev.stato) { daTelegram(ev.stato); aggiorna(); } });
  su("cockpit_ponte", async (ev) => {
    if (ev.stato) P.stato = ev.stato;
    const aperto = inVista();
    let tocca = ev.azione === "consegnati";
    if (ev.azione === "arrivati") {
      for (const m of ev.messaggi || []) {
        if (m.urgente) diUrgente(`${nomeDi(m.mittente)}, urgente: ${m.testo}`, `ponte:${m.id}`);
        if (m.mittente === aperto) tocca = true;
        else if (Date.parse(m.creato) > letto(m.mittente)) P.nuovi[m.mittente] = (P.nuovi[m.mittente] || 0) + 1; // già visto: non si conta di nuovo
      }
    }
    if (ev.azione === "scritto" && ev.messaggio?.destinatario === aperto) tocca = true;
    if (aperto && tocca) {
      try { await caricaPonte(aperto); } catch { /* resta il filo di prima */ }
      ponteLetto(aperto);
    }
    aggiorna();
  });
  // i messaggi arrivati mentre la pagina era chiusa, per il numero sul pulsante
  try {
    const j = await api("GET", "/api/ponte/messaggi?n=100");
    if (j.disponibile) {
      for (const p of altriPonte()) {
        if (p.slug !== inVista()) P.nuovi[p.slug] = j.messaggi.filter((m) => m.mittente === p.slug && Date.parse(m.creato) > letto(p.slug)).length;
      }
    }
  } catch { /* il numero resta zero */ }
  aggiorna();
  return true;
}
