import { ApiError, errorOf, get, post, send } from "./client.js";
import { t } from "../../lib/strings.js";

/**
 * Reservas com filtros (ReservationPage). A recepção recebe só esta noite, seja o que for pedido.
 * @param {{from?: string, to?: string, status?: string[], source?: string, q?: string, cursor?: string, limit?: number}} filters
 */
export const list = (filters = {}, options) => get("/staff/reservations", { ...options, query: filters });

/** Uma reserva com a linha do tempo e as mensagens (ReservationDetail). */
export const detail = (id, options) => get(`/staff/reservations/${encodeURIComponent(id)}`, options);

/** Uma reserva feita por telefone, WhatsApp ou no balcão (ReservationStaffCreate). */
export const create = (body, idempotencyKey, options) => post("/staff/reservations", body, { ...options, idempotencyKey });

/** Um comando do domínio na reserva: approve, decline, reschedule, move_tables, cancel, no_show… */
export const action = (id, body, idempotencyKey, options) =>
  post(`/staff/reservations/${encodeURIComponent(id)}/actions`, body, { ...options, idempotencyKey });

/** Uma das mensagens prontas de WhatsApp da recepção; `repeat` manda de novo uma mandada nos últimos 10 min. */
export const notify = (id, template, idempotencyKey, { repeat = false, ...options } = {}) =>
  post(`/staff/reservations/${encodeURIComponent(id)}/notify`, { template, repeat }, { ...options, idempotencyKey });

/** A língua guardada do cliente com este telefone (E.164): { locale } ou { locale: null } (5.6). */
export const customerLanguage = (phone, options) => get("/staff/customers/language", { ...options, query: { phone } });

/** Mesas livres para a equipe numa data e horário (StaffTableOption[]). */
export const availability = ({ date, time, partySize, ignore }, options) =>
  get("/staff/availability", { ...options, query: { date, time, party_size: partySize, ignore_reservation: ignore } });

/**
 * Um CSV que a API responde como arquivo, não JSON, lido aqui como texto (a checagem de identidade vai no
 * corpo: senha e código).
 * @returns {Promise<{text: string, filename: string}>}
 */
export async function downloadCsv(path, body, fallback = "arquivo.csv") {
  // o arquivo não é JSON: send() mantém o token CSRF e a assinatura do aparelho de request()
  const response = await send("POST", path, { body, headers: { Accept: "text/csv, application/problem+json" } });
  if (!response.ok) throw await errorOf(response);
  const disposition = response.headers.get("Content-Disposition") || "";
  const filename = /filename="?([^";]+)"?/.exec(disposition)?.[1] || fallback;
  try {
    return { text: await response.text(), filename };
  } catch {
    throw new ApiError({ type: "network", title: t("errors.network") });
  }
}

/** O CSV de um período (só o dono, depois da checagem de identidade). */
export const exportCsv = ({ from, to }) => downloadCsv("/staff/reservations/export", { from, to }, "reservas.csv");

/** O CSV do que a lista mostra: o período mais os filtros de situação, canal e busca (5.11). */
export const exportFiltered = ({ from, to, status, source, q }) =>
  downloadCsv("/staff/reservations/export", { from, to, ...(status?.length ? { status } : {}), ...(source ? { source } : {}), ...(q ? { q } : {}) }, "reservas.csv");

/** A lista da porta de um evento em CSV, sem telefones (só o dono, depois da checagem de identidade). */
export const exportGuests = (eventId) => downloadCsv(`/staff/events/${encodeURIComponent(eventId)}/guests/export`, {}, "lista.csv");

// ---- o que as visões de Reservas leem além da lista (Dia, Mesas, Semana, Mês) ----

/** O salão desta noite: o dia resolvido com a planta, as reservas e as sessões de mesa. */
export const floor = (date, options) => get("/staff/floor", { ...options, query: { date } });

/** Uma data como vai funcionar (semana padrão, plano do dia e evento), com a planta. Dono e gerente. */
export const day = (date, options) => get(`/staff/day-plans/${encodeURIComponent(date)}`, options);

/** Os dias de um mês ("2026-10"): aberto ou fechado, pessoas, ocupação e eventos. Dono e gerente. */
export const calendar = (month, options) => get("/staff/calendar", { ...options, query: { month } });
