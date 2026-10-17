// Eventos: a ficha, a publicação, duplicar e a lista de convidados na porta. A versão lida
// vai no cabeçalho If-Match (412 quando alguém gravou o evento antes).
import { del, get, patch, post } from "./client.js";

export const events = (range = {}, options) => get("/staff/events", { ...options, query: range });
export const event = (id, options) => get(`/staff/events/${id}`, options);

/** Cria um evento; um publicado passa pela simulação (dryRun). */
export const createEvent = (body, { dryRun = false, ...options } = {}) => post("/staff/events", body, { ...options, query: { dry_run: dryRun || undefined } });

/** Edita, publica ou despublica; com dryRun responde o efeito na noite. */
export const updateEvent = (id, body, { dryRun = false, version, ...options } = {}) =>
  patch(`/staff/events/${id}`, body, { ...options, ifMatch: dryRun ? undefined : version, query: { dry_run: dryRun || undefined } });

export const removeEvent = (id, { dryRun = false, confirm = false, ...options } = {}) =>
  del(`/staff/events/${id}`, { ...options, query: { dry_run: dryRun || undefined, confirm_conflicts: confirm || undefined } });

export const duplicateEvent = (id, date, options) => post(`/staff/events/${id}/duplicate`, { date }, options);

export const guests = (id, options) => get(`/staff/events/${id}/guests`, options);
export const addGuest = (id, body, options) => post(`/staff/events/${id}/guests`, body, options);
export const removeGuest = (id, reservationId, options) => del(`/staff/events/${id}/guests/${reservationId}`, options);
export const checkIn = (id, reservationId, body = {}, options) => post(`/staff/events/${id}/guests/${reservationId}/check-in`, body, options);
export const undoCheckIn = (id, reservationId, options) => del(`/staff/events/${id}/guests/${reservationId}/check-in`, options);

/** As fotos da Galeria, para escolher a foto do evento (só as prontas vão para o site). */
export const photos = (options) => get("/staff/images", options);

/** O padrão da casa para eventos novos (Configurações › Eventos). */
export const eventSettings = (options) => get("/staff/settings/events", options);
