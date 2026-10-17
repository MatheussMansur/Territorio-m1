import { ApiError, get, post } from "./client.js";
import { t } from "../../lib/strings.js";

const BASE = import.meta.env?.VITE_API_BASE || "/api/v1";
const path = (token) => `/links/${encodeURIComponent(token)}`;

// Links mandados ao cliente. Abrir um nunca muda nada; as ações são POSTs.
export const view = (token, options) => get(path(token), options);
/** "yes" (Confirmo), "late" (Vou atrasar um pouco) ou "no" (Não vou mais). */
export const answer = (token, value) => post(`${path(token)}/confirm`, { answer: value });
export const cancel = (token) => post(`${path(token)}/cancel`, {});
/** swapCode: a reserva daquela noite que a pessoa aceitou trocar pela mesa oferecida. */
export const acceptOffer = (token, swapCode) => post(`${path(token)}/accept-offer`, swapCode ? { swap_code: swapCode } : {});
export const declineOffer = (token) => post(`${path(token)}/decline-offer`, {});

/** O arquivo de calendário da reserva (.ics) como Blob; uma falha é um ApiError como qualquer outro. */
export async function calendar(token) {
  let response;
  try {
    response = await fetch(`${BASE}${path(token)}/calendar`, { credentials: "include" });
  } catch {
    throw new ApiError({ type: "network", title: t("errors.network") });
  }
  if (!response.ok) throw new ApiError({ status: response.status, type: response.status >= 500 ? "server" : "unknown" });
  return response.blob();
}
