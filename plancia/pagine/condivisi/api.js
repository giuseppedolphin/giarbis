// Il client delle API della plancia, uno solo per tutte le pagine (cockpit, barra, bolla, pagine dei moduli).
// BASE è vuota quando la pagina è servita dal server stesso (percorsi relativi); una pagina aperta altrove
// (per esempio da file) imposta prima window.PLANCIA_BASE = "http://127.0.0.1:<porta>" e carica gli script da lì.

export const BASE = String((typeof window !== "undefined" && window.PLANCIA_BASE) || "").replace(/\/+$/, "");

// Chiama /api/...: JSON in e in uscita, header X-Dashboard sempre; lancia un Error se il server dice ok:false o risponde male.
export async function api(metodo, percorso, corpo) {
  const r = await fetch(BASE + percorso, {
    method: metodo,
    headers: { "content-type": "application/json", "x-dashboard": "1" },
    body: corpo === undefined || corpo === null ? undefined : JSON.stringify(corpo),
  });
  const j = await r.json().catch(() => ({ ok: false, errore: `risposta non valida (${r.status})` }));
  if (!r.ok || j.ok === false) throw new Error(j.errore || `errore ${r.status}`);
  return j;
}
