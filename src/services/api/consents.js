import { post } from "./client.js";

/** A escolha de cookies: a versão do aviso e sim/não para medição, nunca quem escolheu. */
export const send = (body) => post("/consents", body);
