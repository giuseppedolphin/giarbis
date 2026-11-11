// The example squad loads: three roles, one lead and two executors, valid models, a mandate file each.
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export default async function (t) {
  const cartella = path.join(t.plancia, "moduli/squadra-esempio");
  const modulo = (await import(pathToFileURL(path.join(cartella, "modulo.mjs")).href)).default;
  const { caricaRuoli } = await import(pathToFileURL(path.join(t.plancia, "server/squadra.mjs")).href);
  const ruoli = caricaRuoli([{ ...modulo, cartella }], { persona: { slug: "chiunque" } });
  t.ok(ruoli.map((r) => r.slug).join() === "lead,researcher,reviewer", `squadra d'esempio: i tre ruoli (${ruoli.map((r) => r.slug)})`);
  t.ok(ruoli.filter((r) => !r.capo).length === 1 && ruoli.filter((r) => r.capo === "lead").length === 2, "squadra d'esempio: un capo e due esecutori");
  t.ok(ruoli.every((r) => r.mandatoFile && existsSync(r.mandatoFile)), "squadra d'esempio: ogni ruolo ha il suo file di mandato");
}
