import { get, post } from "./client.js";

const own = (code) => `/reservations/mine/${encodeURIComponent(code)}`;

/** Cria uma reserva, um pedido para a casa ou uma entrada na lista de espera. */
export const create = (body, idempotencyKey) => post("/reservations", body, { idempotencyKey });
export const mine = (options) => get("/reservations/mine", options);
export const getMine = (code, options) => get(own(code), options);
export const cancel = (code, reason) => post(`${own(code)}/cancel`, reason ? { reason } : {});
/** "Vou atrasar um pouco": a mesa espera os minutos extras uma vez e a recepção é avisada. */
export const late = (code) => post(`${own(code)}/late`);
export const reschedule = (code, { date, time, party_size }, idempotencyKey) =>
  post(`${own(code)}/reschedule`, { date, time, party_size }, { idempotencyKey });
