// Il modulo locale: aggiunge in coda ai prompt dell'assistente, degli agenti e degli agenti di foglio le istruzioni che il
// setup ha scritto per questa repo, in <cartella di lavoro>/.plancia/prompt/<nome>.md. Ogni file è opzionale: se non c'è,
// il prompt resta quello del nucleo. Si modificano a mano quando si vuole; valgono al prossimo avvio di un agente.
import path from "node:path";
import { config } from "../../plancia/server/config.mjs";

const dir = path.join(config().cartella, ".plancia", "prompt");
const file = (nome) => ({ file: path.join(dir, `${nome}.md`), opzionale: true });

export default {
  nome: "locale",
  prompt: { assistente: file("assistente"), agente: file("agente"), foglio: file("foglio") },
};
