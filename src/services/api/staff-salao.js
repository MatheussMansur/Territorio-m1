// Salão: o salão ao vivo, sentar grupos, as sessões de mesa, a folha da noite e a vida da
// própria noite (fechamento, notas do papel mandadas ao dono).
import { get, patch, post } from "./client.js";
import { readFresh } from "./staff-hoje.js";

const session = (id) => `/staff/floor/sessions/${encodeURIComponent(id)}`;

/** O salão da noite: o dia, as áreas, as reservas, as sessões de mesa e as regras. */
export const floor = (options) => get("/staff/floor", options);
/** O mesmo, condicional: { changed, data, etag } (304 quando nada mudou). */
export const floorFresh = (etag, options) => readFresh("/staff/floor", { ...options, etag });
export const walkIn = (body, idempotencyKey) => post("/staff/floor/walk-ins", body, { idempotencyKey });
export const getSession = (id, options) => get(session(id), options);
/** Acerta as pessoas na mesa; a versão que a tela viu vai como If-Match (412 quando mudou). */
export const setPeople = (id, people, version, idempotencyKey) =>
  patch(session(id), { people, occurred_at: new Date().toISOString() }, { idempotencyKey, ifMatch: version });
export const move = (id, table_codes, idempotencyKey, extra = {}) => post(`${session(id)}/move`, { table_codes, occurred_at: new Date().toISOString(), ...extra }, { idempotencyKey });
export const merge = (id, session_id, idempotencyKey) => post(`${session(id)}/merge`, { session_id, occurred_at: new Date().toISOString() }, { idempotencyKey });
export const split = (id, table_codes, people, idempotencyKey) => post(`${session(id)}/split`, { table_codes, people, occurred_at: new Date().toISOString() }, { idempotencyKey });
export const release = (id, idempotencyKey, extra = {}) => post(`${session(id)}/release`, { occurred_at: new Date().toISOString(), ...extra }, { idempotencyKey });
/** Desfaz uma liberação pelo aviso dela. */
export const reopen = (id) => post(`${session(id)}/reopen`, {});
/** O mesmo desfazer, com o motivo de uma correção depois de a noite fechar (6.14). */
export const reopenWith = (id, extra = {}) => post(`${session(id)}/reopen`, { ...extra });
export const extend = (id, idempotencyKey) => post(`${session(id)}/extend`, { occurred_at: new Date().toISOString() }, { idempotencyKey });
/** check_in, undo_check_in, extra_tolerance, release_table, no_show, confirm, cancel… numa reserva. */
export const reservationAction = (id, body, idempotencyKey) => post(`/staff/reservations/${encodeURIComponent(id)}/actions`, body, { idempotencyKey });
/** A folha da noite (também a foto da noite sem conexão); com `since`, as mudanças depois dela. */
export const nightSnapshot = (options = {}) => get("/staff/night/snapshot", { ...options, query: { since: options.since } });
/** A folha foi para o papel ("full") ou só as mudanças dela ("changes"). */
export const sheetPrinted = (kind = "full") => post("/staff/night/sheet", { kind });
/** Adia o fechamento da noite em 1 h, uma vez por noite. */
export const postponeClose = () => post("/staff/night/postpone", {});
/** Fecha à mão uma noite que não fechou. */
export const closeNight = (date) => post("/staff/night/close", { date });
/** Notas do papel que a recepção não conseguiu lançar depois de a noite fechar. */
export const sendCorrections = (items) => post("/staff/night/corrections", { items });
export const applyCorrection = (id) => post(`/staff/night/corrections/${encodeURIComponent(id)}/apply`, {});
export const dismissCorrection = (id) => post(`/staff/night/corrections/${encodeURIComponent(id)}/dismiss`, {});
