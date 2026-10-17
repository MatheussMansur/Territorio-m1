// A conta Google da casa (história 2.22): Agenda para as reservas, Drive para a folha da noite
// e as exportações.
import { del, get, put } from "./client.js";

/** { connected, account_email, calendar, folder, calendar_sync, drive_sync, sync, sent, never_sent, preview, files }. */
export const status = (options) => get("/staff/integrations/google", options);

/**
 * Conecta (depois da autorização do Google: { account_email, account_name, scopes }) ou muda
 * a agenda, a pasta e o que sincroniza: { calendar: {id} | {create, name}, folder, calendar_sync,
 * drive_sync, delete_events }. Desligar uma parte pede a checagem de identidade antes (senão 403 reauth_required).
 */
export const update = (body, options) => put("/staff/integrations/google", body, options);

/** Desconecta a conta inteira; deleteEvents também tira os eventos já criados. */
export const disconnect = (deleteEvents, options) => del("/staff/integrations/google", { ...options, query: { delete_events: String(Boolean(deleteEvents)) } });

/** As agendas que a conta já tem. */
export const calendars = (options) => get("/staff/integrations/google/calendars", options);

/** As pastas do Drive que a conta já tem. */
export const folders = (options) => get("/staff/integrations/google/folders", options);

/** Os eventos que a agenda da casa tem agora (os próximos 30 dias). */
export const events = (options) => get("/staff/integrations/google/events", options);
