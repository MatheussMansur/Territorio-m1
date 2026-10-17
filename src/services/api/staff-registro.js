// O registro de ações (história 1.13).
import { errorOf, get, send } from "./client.js";

/** Uma página do registro, as mais novas primeiro; filtros: actor, action, device, from, to. */
export const list = (query = {}, options) => get("/staff/audit", { ...options, query });

/**
 * O CSV do registro com os mesmos filtros (dono, depois da checagem de identidade). O arquivo não é
 * JSON, então é lido aqui por send(), com o token CSRF e a assinatura do aparelho.
 */
export async function exportCsv(body) {
  const response = await send("POST", "/staff/audit/export", { body, headers: { Accept: "text/csv, application/problem+json" } });
  if (!response.ok) throw await errorOf(response);
  return response.blob();
}
