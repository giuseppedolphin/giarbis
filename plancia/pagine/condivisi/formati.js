// Formati comuni: numeri, ore, date, testo su una riga, soglie dei colori. Tutto in italiano.

export const SOGLIE = { attenzione: 70, critico: 90 };

// Il livello di una percentuale: "" (tutto bene), "attenz" (≥70) o "critico" (≥90).
export const livello = (u) => (u >= SOGLIE.critico ? "critico" : u >= SOGLIE.attenzione ? "attenz" : "");

export const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Token: 1 234 → "1 k", 2 400 000 → "2,4 M".
export function tok(n) {
  if (n >= 1e6) return `${(n / 1e6).toLocaleString("it-IT", { maximumFractionDigits: 1 })} M`;
  if (n >= 1e3) return `${Math.round(n / 1e3).toLocaleString("it-IT")} k`;
  return String(n);
}

export const ora = (t) => new Date(t).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });

// Data per esteso (02/09/2026); con l'ora se il valore ne ha una.
export function data(t) {
  const d = new Date(t);
  if (isNaN(d)) return "";
  const giorno = d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });
  return String(t).length <= 10 ? giorno : `${giorno} ${ora(d)}`;
}

// «oggi alle 14:30» oppure «mercoledì 7 ottobre alle 14:30».
export function giornoOra(t) {
  const d = new Date(t);
  const giorno = d.toDateString() === new Date().toDateString() ? "oggi" : d.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
  return `${giorno} alle ${ora(d)}`;
}

export function tempoFa(iso) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "ora";
  if (s < 3600) return `${Math.round(s / 60)} min fa`;
  if (s < 86400) return `${Math.round(s / 3600)} h fa`;
  return `${Math.round(s / 86400)} g fa`;
}

export function durata(ms) {
  const s = Math.max(1, Math.round((ms || 0) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60 ? `${s % 60} s` : ""}`.trim();
}

// La prima riga che dice qualcosa, senza markdown né righe di tabella: per anteprime e fumetti.
export function unaRiga(testo) {
  const righe = String(testo || "").split("\n").map((r) => r.trim()).filter((r) => r && !/^\|?[\s:|-]+\|?$/.test(r));
  const prima = righe.find((r) => !r.startsWith("|")) || (righe.length ? "una tabella" : "");
  return prima.replace(/[*_#>`]/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim();
}
