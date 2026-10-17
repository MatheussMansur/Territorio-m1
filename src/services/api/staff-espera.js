// Espera: a lista de espera da noite, oferecer uma mesa, o grupo esperando na porta e avisar
// que a mesa está pronta.
import { get, post } from "./client.js";
import { readFresh } from "./staff-hoje.js";

export const list = (options) => get("/staff/waitlist", options);
/** O mesmo, condicional: { changed, data, etag } (304 quando nada mudou). */
export const listFresh = (etag, options) => readFresh("/staff/waitlist", { ...options, etag });
/** Um grupo que chegou sem reserva e espera na porta. */
export const addAtDoor = (body, idempotencyKey) => post("/staff/waitlist", body, { idempotencyKey });
export const offer = (id, table_codes, idempotencyKey) => post(`/staff/waitlist/${encodeURIComponent(id)}/offer`, { table_codes }, { idempotencyKey });
/** "Sua mesa está pronta" para um grupo da porta que deixou telefone. */
export const notifyReady = (id, { repeat = false } = {}) => post(`/staff/waitlist/${encodeURIComponent(id)}/notify`, { template: "table_ready", repeat });
export { floor, floorFresh, reservationAction, walkIn } from "./staff-salao.js";
