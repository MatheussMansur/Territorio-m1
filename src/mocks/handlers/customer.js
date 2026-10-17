// Rotas do cliente: o código por WhatsApp, a sessão, o Google (um retorno de exemplo), o perfil,
// a reserva, a lista de espera e "minhas reservas". Na simulação o código nunca sai do navegador: qualquer
// 6 dígitos servem, menos 000000 (o estado de código errado). Uma reserva ocupa uma mesa de verdade nos
// dados da simulação, então a próxima já a vê ocupada.
//
// Forçar um caso difícil (testes e demonstração): ?forcar=lotou,cutoff … no endereço, ou uma lista no
// sessionStorage "territorio:mock-forcar"; cada caso forçado acontece uma vez. Casos: turnstile,
// otp_casa, rede, perde_resposta, sessao, termos, lotou, cutoff, dia_fechado, link_vencido, ics, download.
import { http, HttpResponse } from "msw";
import { addDays, fromMinutes, houseParts, toMinutes } from "../../lib/dates.js";
import { inWindow, nightOf, nightOfBooking, notesProblem, pastDeadline, pendingDeadline } from "../../lib/cliente.js";
import { maskPhone } from "../../lib/phone.js";
import { session } from "../../lib/storage.js";
import { uuid } from "../../lib/uuid.js";
import { dayAvailability, durationFor, freeOptions, listAvailability, resolveDay } from "../availability.js";
import { getState, save } from "../db.js";
import { mockNow, problem, respond } from "../scenario.js";
import { linkHandlers } from "./links.js";
import { archiveTerms, termsPublic } from "./public.js";

const API = "/api/v1";
export const ACTIVE = new Set(["pending", "confirmed", "waitlisted", "offered"]);
const HOLDS = new Set(["pending", "confirmed", "offered"]);
const E164 = /^\+(55|595|54)\d{8,12}$/;
const OTHER_COUNTRY = /^\+\d{6,15}$/;
const TURNSTILE_TEST_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const OTP_MIN = 10;
const OTP_TRIES = 5;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "";

const invalid = (errors, extra = {}) => problem(422, "validation", "Confira os campos", { errors, ...extra });

// ---- forçar um caso uma vez ---------------------------------------------------------------------

const FORCE_KEY = "territorio:mock-forcar";
const usedThisPage = new Set();

/** Verdadeiro uma vez quando um teste ou a demonstração pediu este caso (lista no sessionStorage, ou ?forcar= no endereço). */
export function forced(name) {
  const list = session.get(FORCE_KEY, []);
  if (Array.isArray(list) && list.includes(name)) {
    session.set(FORCE_KEY, list.filter((n) => n !== name));
    return true;
  }
  const asked = (new URLSearchParams(window.location.search).get("forcar") || "").split(",");
  if (asked.includes(name) && !usedThisPage.has(name)) {
    usedThisPage.add(name);
    return true;
  }
  return false;
}

// ---- sessão ------------------------------------------------------------------------------------

const TAB_KEY = "territorio:mock-cliente-aba"; // uma sessão sem "lembrar este aparelho" termina quando o navegador fecha

export function sessionCustomer(state) {
  const s = state.mock_session;
  if (!s?.customer_id) return null;
  if (s.remember === false && session.get(TAB_KEY) !== s.id) return null;
  if (s.expires_at && new Date(s.expires_at) <= mockNow()) return null;
  return state.customers.find((c) => c.id === s.customer_id && !c.anonymized_at && !c.deletion_requested_at) || null;
}

function openSession(state, customer, remember = true) {
  const id = uuid();
  state.mock_session = { id, customer_id: customer.id, remember, expires_at: remember ? new Date(mockNow().getTime() + 90 * DAY).toISOString() : null };
  if (!remember) session.set(TAB_KEY, id);
}

const verified = (c) => Boolean(c?.phone_e164 && c.phone_verified_at);

export function customerMe(customer) {
  return {
    name: customer.name || "",
    phone_masked: customer.phone_e164 ? maskPhone(customer.phone_e164) : null,
    phone_verified: verified(customer),
    email: customer.email ?? null,
    locale: customer.locale || "pt",
    marketing_opt_in: Boolean(customer.marketing_opt_in),
    google_linked: Boolean(customer.google_sub),
    csrf_token: "mock-csrf",
  };
}

const needSession = (state) => {
  const customer = sessionCustomer(state);
  return customer ? { customer } : { error: problem(401, state.mock_session ? "session_expired" : "unauthorized", "Entre com o código do WhatsApp.") };
};

// ---- regras lidas na hora (AR-29): a tolerância vale ao vivo, o prazo de cancelamento foi copiado --

const settingsOf = (state, group) => state.settings?.[group]?.data || {};
export const startsAt = (r) => new Date(`${r.date}T${r.time}:00-03:00`);
const cancelHours = (state, r) => r.cancel_until_hours ?? state.booking.cancel_until_hours ?? 2;
export const cancelDeadline = (state, r) => new Date(startsAt(r).getTime() - cancelHours(state, r) * HOUR);

/** Minutos depois da meia-noite até quando a mesa espera: o horário + a tolerância de hoje (+ o extra uma vez, se avisado). */
export function toleranceEnd(state, r) {
  const tolerance = toMinutes(r.time) + (state.booking.tolerance_min ?? 0);
  return r.late_notice_at ? tolerance + (r.extra_tolerance_min ?? state.booking.extra_tolerance_min ?? 0) : tolerance;
}

const toleranceEndAt = (state, r) => new Date(startsAt(r).getTime() + (toleranceEnd(state, r) - toMinutes(r.time)) * 60_000);

export const tokensOf = (r) => ({
  view: r.public_token,
  action: r.action_token || `a${r.public_token}`,
  waitlist: r.waitlist_token || `e${r.public_token}`,
});

function queueOf(state, r) {
  return state.reservations
    .filter((x) => x.date === r.date && x.time === r.time && x.status === "waitlisted")
    .sort((a, b) => (a.waitlist_position ?? 99) - (b.waitlist_position ?? 99) || String(a.created_at).localeCompare(String(b.created_at)));
}

function listAreaOf(state, r) {
  if (r.table_codes?.length || !r.area_key) return false;
  const day = resolveDay(state, r.date);
  return day.areas.some((a) => a.key === r.area_key && a.mode === "list");
}

/** A reserva como o cliente vê (ReservationPublic). */
export function reservationPublic(state, r) {
  const rules = state.booking;
  const told = r.late_notice_at ? (r.extra_tolerance_min ?? rules.extra_tolerance_min ?? 0) : (rules.extra_tolerance_min ?? 0);
  const extra = rules.late_notice_enabled && told > 0 ? toMinutes(r.time) + (rules.tolerance_min ?? 0) + told : null;
  const deadline = cancelDeadline(state, r);
  const event = r.event_id ? state.events.find((e) => e.id === r.event_id) : resolveDay(state, r.date).event;
  const tokens = tokensOf(r);
  const prefix = r.locale && r.locale !== "pt" ? `/${r.locale}` : "";
  return {
    code: r.code,
    date: r.date,
    time: r.time,
    party_size: r.party_size,
    status: r.status,
    first_name: firstName(state.customers.find((c) => c.id === r.customer_id)?.name),
    area_preference: r.area_preference ?? null,
    area_key: r.area_key ?? null,
    place: listAreaOf(state, r) ? "list" : "table",
    event_title: event?.title ?? null,
    tolerance_until: fromMinutes(toleranceEnd(state, r)),
    tolerance_extra_until: extra == null ? null : fromMinutes(extra),
    late_notice_at: r.late_notice_at ?? null,
    waitlist_position: r.status === "waitlisted" ? queueOf(state, r).indexOf(r) + 1 || null : null,
    pending_until: r.status === "pending" ? (r.pending_until ?? null) : null,
    offer_expires_at: r.status === "offered" ? (r.offer_expires_at ?? null) : null,
    offer_expired_at: r.offer_expired_at ?? null,
    can_cancel_until: deadline.toISOString(),
    canceled_late: Boolean(r.canceled_late),
    can_reschedule: ["pending", "confirmed"].includes(r.status) && !pastDeadline(mockNow(), deadline) && settingsOf(state, "booking").customer_can_reschedule !== false,
    locale: r.locale || "pt",
    receipt_url: `${prefix}/r/?t=${tokens.view}`,
    // só na demonstração: os links que as mensagens de WhatsApp levam, para a demonstração poder abri-los
    demo: { confirm_url: `${prefix}/confirmar/?t=${tokens.action}`, waitlist_url: `${prefix}/espera/?t=${tokens.waitlist}` },
  };
}

function message(r, template) {
  r.messages ??= [];
  r.messages.push({ id: uuid(), template, status: "queued", sent_at: mockNow().toISOString() });
}

export function history(r, action, summary, actor = "Cliente") {
  r.history ??= [];
  r.history.push({ at: mockNow().toISOString(), actor_label: actor, action, summary });
}

// ---- a lista de espera: ofertas quando uma mesa abre, a fila quando uma oferta vence ----------

/**
 * Abriu um lugar numa data (cancelamento, recusa, remarcação): o primeiro da fila daquela noite
 * que agora cabe recebe a oferta, com os minutos da casa para aceitar (ou até o horário, se ele
 * vier antes). Um lugar que abre depois do horário não gera oferta.
 */
export function offerFreedPlace(state, date, now = mockNow(), skip = new Set()) {
  const day = resolveDay(state, date);
  if (!day.open) return null;
  const minutes = settingsOf(state, "waitlist").offer_min ?? state.booking.waitlist_offer_min ?? 10;
  const queue = state.reservations
    .filter((r) => r.date === date && r.status === "waitlisted" && !skip.has(r.id) && startsAt(r) > now)
    .sort((a, b) => a.time.localeCompare(b.time) || (a.waitlist_position ?? 99) - (b.waitlist_position ?? 99));
  for (const r of queue) {
    const onList = r.area_key && day.areas.some((a) => a.key === r.area_key && a.mode === "list");
    const option = onList ? null : freeOptions(state, day, r.time, r.party_size, { ignoreId: r.id })[0];
    if (onList ? listAvailability(state, day, r.party_size).remaining < r.party_size : !option) continue;
    r.status = "offered";
    r.table_codes = option ? [...option.codes] : [];
    r.offer_expires_at = new Date(Math.min(now.getTime() + minutes * 60_000, startsAt(r).getTime())).toISOString();
    r.offer_expired_at = null;
    message(r, "waitlist_offer");
    history(r, "offered", "Mesa oferecida pela lista de espera", "Sistema");
    return r;
  }
  return null;
}

/** Ofertas vencidas voltam para o fim da mesma fila (e o próximo recebe); uma noite que fechou encerra sua fila. */
export function sweepWaitlist(state, now = mockNow()) {
  let changed = false;
  const tonight = nightOf(now);
  for (const r of state.reservations) {
    if ((r.status === "waitlisted" || r.status === "offered") && nightOfBooking(r.date, r.time) < tonight) {
      Object.assign(r, { status: "expired", offer_expires_at: null, table_codes: [] });
      changed = true;
    }
  }
  for (const r of state.reservations.filter((x) => x.status === "offered" && x.offer_expires_at && new Date(x.offer_expires_at) <= now)) {
    const last = Math.max(0, ...queueOf(state, r).map((x) => x.waitlist_position ?? 0));
    Object.assign(r, { status: "waitlisted", table_codes: [], offer_expires_at: null, offer_expired_at: now.toISOString(), waitlist_position: last + 1 });
    history(r, "offer_expired", "O tempo para aceitar passou: voltou ao fim da fila", "Sistema");
    offerFreedPlace(state, r.date, now, new Set([r.id]));
    changed = true;
  }
  if (changed) save();
}

/** Cancela (ou tira da fila) e passa o lugar para a lista de espera uma vez. */
export function cancelReservation(state, r, { reason = null, late = false, by = "customer" } = {}) {
  const held = HOLDS.has(r.status) && startsAt(r) > mockNow();
  Object.assign(r, { status: "canceled", canceled_by: by, cancel_reason: reason, canceled_late: late, offer_expires_at: null });
  r.table_codes = [];
  message(r, "booking_canceled");
  history(r, "canceled", late ? "Cancelou em cima da hora" : "Cancelou", by === "customer" ? "Cliente" : "Sistema");
  if (held) offerFreedPlace(state, r.date);
}

// ---- conferências da reserva --------------------------------------------------------------------

function alternatives(state, date, party, now, ignoreId = null) {
  const out = [];
  const night = nightOf(now);
  const windowDays = state.booking.window_days ?? 30;
  for (let i = 0; i < windowDays && out.length < 6; i++) {
    const d = i === 0 ? date : addDays(date, i);
    if (!inWindow(d, night, windowDays)) continue;
    const day = dayAvailability(state, d, party, now);
    const free = (day.slots || []).filter((s) => s.state === "available" || s.state === "few_left");
    if (ignoreId == null) out.push(...free.slice(0, d === date ? 6 : 1).map((s) => ({ date: d, time: s.time, state: s.state })));
    else out.push(...free.slice(0, 1).map((s) => ({ date: d, time: s.time, state: s.state })));
  }
  return out.slice(0, 6);
}

const fingerprint = (body) =>
  JSON.stringify(["party_size", "date", "time", "name", "notes", "flags", "waitlist", "area_key"].map((k) => body[k] ?? null));

function notesErrors(notes) {
  const p = notesProblem(notes);
  if (!p) return [];
  return [p.kind === "long"
    ? { field: "notes", code: "too_long", count: p.count, max: p.max, message: `${p.count}/${p.max}` }
    : { field: "notes", code: "no_links", message: "Sem links na observação." }];
}

/**
 * Há lugar nesta data e horário para o grupo, pelas regras do dia (fechado, modo de um
 * evento, antecedência mínima, mesas ou lista)? Devolve o problema, ou o lugar.
 */
function placeFor(state, body, party, now, { ignoreId = null } = {}) {
  const day = resolveDay(state, body.date);
  const night = nightOf(now);
  const days = state.booking.window_days ?? 30;
  if (!inWindow(nightOfBooking(body.date, body.time), night, days)) {
    return { error: invalid([{ field: "date", code: "outside_window", message: "Esse dia está fora da janela de reserva." }]) };
  }
  const full = (reason, extra = {}) => ({
    error: problem(409, "slot_full", "Esse horário não está mais disponível.", { reason, alternatives: alternatives(state, body.date, Math.min(party, day.party_max_online), now, ignoreId), ...extra }),
  });
  if (forced("dia_fechado") || !day.open) return full("day_closed", { reason_label: day.reason_label || "fechado" });
  const mode = day.event?.booking_mode;
  if (mode === "none") return full("event_mode", { event_mode: "none" });
  const listArea = day.areas.find((a) => a.mode === "list" && a.bookable_online && a.key === body.area_key);
  if (mode === "list" && !listArea) return full("event_mode", { event_mode: "list" });
  if (mode === "tables" && body.area_key && !listArea && day.areas.every((a) => a.key !== body.area_key || a.mode !== "tables")) return full("event_mode", { event_mode: "tables" });
  const clock = houseParts(now);
  const times = listArea ? day.entry_times || day.slots : day.slots;
  if (!times.includes(body.time)) return full(null);
  if (body.date < clock.date || (body.date === clock.date && toMinutes(body.time) < clock.minutes + (state.booking.min_lead_min ?? 0)) || forced("cutoff")) {
    return full("cutoff");
  }
  if (forced("lotou")) return full(null);
  if (party > day.party_max_online) return { bigGroup: true, day, listArea };
  if (listArea) {
    const list = listAvailability(state, day, party);
    return list && list.remaining >= party ? { day, listArea, codes: [] } : { day, listArea, full: true };
  }
  const option = freeOptions(state, day, body.time, party, { ignoreId })[0];
  return option ? { day, codes: [...option.codes] } : { day, full: true };
}

function activeLimit(state, customer, now, ignoreId = null) {
  const max = state.booking.max_active_per_phone ?? 2;
  const counting = state.reservations.filter(
    (r) => r.id !== ignoreId && r.customer_id === customer.id && ["pending", "confirmed"].includes(r.status) && startsAt(r) >= now,
  );
  return counting.length >= max ? problem(409, "active_limit", "Você já tem reservas marcadas.", { max }) : null;
}

let seq = 5100;

function newCode(state) {
  let code;
  do code = `TR-${(seq += 41)}`;
  while (state.reservations.some((r) => r.code === code));
  return code;
}

function storeIdempotent(state, key, body, status, payload) {
  if (!key) return;
  state.idempotency ??= {};
  state.idempotency[key] = { fingerprint: fingerprint(body), status, body: payload, at: mockNow().toISOString() };
}

function replay(state, key, body) {
  const saved = key && state.idempotency?.[key];
  if (!saved) return null;
  if (saved.fingerprint !== fingerprint(body)) {
    return problem(422, "validation", "Esse pedido já tinha sido enviado.", { reason: "idempotency", errors: [] });
  }
  return HttpResponse.json(saved.body, { status: saved.status });
}

/** Confere um código de 6 dígitos para um número: códigos errados gastam tentativas, um código velho não vale mais. */
function checkCode(state, phone, code) {
  if (!/^\d{6}$/.test(code || "")) return invalid([{ field: "code", message: "O código tem 6 números." }]);
  state.mock_otps ??= {};
  const otp = state.mock_otps[phone];
  if (!otp) return problem(410, "gone", "O código venceu. Peça outro.", { reason: "otp" });
  if (mockNow() - new Date(otp.at) > OTP_MIN * 60_000) {
    delete state.mock_otps[phone];
    save();
    return problem(410, "gone", "O código venceu. Peça outro.", { reason: "otp" });
  }
  if (code === "000000") {
    otp.left = (otp.left ?? OTP_TRIES) - 1;
    if (otp.left <= 0) {
      delete state.mock_otps[phone];
      save();
      return problem(410, "gone", "As tentativas acabaram. Peça outro código.", { reason: "otp" });
    }
    save();
    return invalid([{ field: "code", message: "Código errado." }], { remaining_attempts: otp.left });
  }
  delete state.mock_otps[phone];
  return null;
}

function phoneProblem(phone) {
  if (E164.test(phone || "")) return null;
  if (OTHER_COUNTRY.test(phone || "")) return invalid([{ field: "phone", code: "phone_country_unsupported", message: "Por aqui, só números do Brasil, Paraguai e Argentina." }]);
  return invalid([{ field: "phone", message: "Confira o número: tem que ser um celular com WhatsApp." }]);
}

function deletionRequest(state, customer, now) {
  state.privacy_requests ??= [];
  const request = {
    id: uuid(),
    customer_id: customer.id,
    customer_label: `${firstName(customer.name) || "Cliente"} · ${customer.phone_e164 ? maskPhone(customer.phone_e164) : "sem telefone"}`,
    kind: "deletion",
    channel: "account",
    status: "open",
    opened_at: now.toISOString(),
    due_at: new Date(now.getTime() + 15 * DAY).toISOString(),
    resolved_at: null,
    resolved_by: null,
    note: "Pedido feito pela conta no site. As reservas futuras foram canceladas com aviso ao cliente.",
  };
  state.privacy_requests.push(request);
  return request;
}

export const customerHandlers = [
  ...linkHandlers,

  // ---- o código por WhatsApp ----
  http.post(`${API}/auth/otp`, async ({ request }) =>
    respond(async () => {
      const body = await request.json().catch(() => ({}));
      if (body.website) return problem(422, "validation", "Recusado", { reason: "honeypot" }); // o campo invisível que um robô preenche
      if (!body.turnstile_token || body.turnstile_token !== TURNSTILE_TEST_TOKEN || forced("turnstile")) {
        return problem(400, "turnstile_failed", "A checagem contra robôs não passou.");
      }
      const wrong = phoneProblem(body.phone);
      if (wrong) return wrong;
      const now = mockNow();
      const state = getState(now);
      const hourAgo = now.getTime() - HOUR;
      state.mock_otp_log = (state.mock_otp_log || []).filter((x) => new Date(x.at).getTime() > now.getTime() - DAY);
      const lastHour = state.mock_otp_log.filter((x) => new Date(x.at).getTime() > hourAgo);
      const mine = lastHour.filter((x) => x.phone === body.phone);
      const waitFor = (list) => Math.max(1, Math.ceil((new Date(list[0].at).getTime() + HOUR - now.getTime()) / 60_000));
      if (forced("otp_casa") || state.mock_otp_log.length >= 300) return problem(429, "rate_limited", "Hoje a casa não manda mais códigos.", { scope: "house" });
      const last = mine.at(-1);
      // a espera de 30 s é para pedir de novo enquanto o último código ainda está aberto, não depois de usado
      if (last && state.mock_otps?.[body.phone] && now.getTime() - new Date(last.at).getTime() < 30_000) {
        return problem(429, "rate_limited", "Espere para pedir outro código.", { scope: "resend", retry_after_s: Math.ceil((new Date(last.at).getTime() + 30_000 - now.getTime()) / 1000) });
      }
      if (mine.length >= 3) return problem(429, "rate_limited", "Já mandamos códigos demais.", { scope: "phone", minutes: waitFor(mine) });
      if (lastHour.length >= 10) return problem(429, "rate_limited", "Já mandamos códigos demais.", { scope: "ip", minutes: waitFor(lastHour) });
      state.mock_otp_log.push({ phone: body.phone, at: now.toISOString() });
      state.mock_otps = { ...(state.mock_otps || {}), [body.phone]: { at: now.toISOString(), left: OTP_TRIES } };
      save();
      return HttpResponse.json({ expires_in_s: OTP_MIN * 60, resend_after_s: 30 }, { status: 202 });
    }),
  ),

  http.post(`${API}/auth/verify`, async ({ request }) =>
    respond(async () => {
      const body = await request.json().catch(() => ({}));
      const state = getState(mockNow());
      const wrong = checkCode(state, body.phone, body.code);
      if (wrong) return wrong;
      let customer = state.customers.find((c) => c.phone_e164 === body.phone && !c.anonymized_at && !c.deletion_requested_at);
      if (!customer) {
        customer = {
          id: uuid(), name: String(body.name || "").trim(), phone_e164: body.phone, phone_verified_at: mockNow().toISOString(),
          visits: 0, no_shows: 0, last_visit_at: null, tags: [], internal_notes: "", blocked: false, marketing_opt_in: false,
          privacy_version: state.privacy?.privacy_version || "2026-10-14", anonymized_at: null, locale: body.locale || "pt", email: null,
        };
        state.customers.push(customer);
      } else {
        customer.phone_verified_at ||= mockNow().toISOString(); // um cliente que a equipe criou: agora verificado
        if (body.name && !customer.name) customer.name = String(body.name).trim();
      }
      openSession(state, customer, body.remember_device !== false);
      save();
      return HttpResponse.json({ customer: customerMe(customer), csrf_token: "mock-csrf" });
    }),
  ),

  http.post(`${API}/auth/logout`, () =>
    respond(() => {
      const state = getState(mockNow());
      delete state.mock_session;
      session.remove(TAB_KEY);
      save();
      return new HttpResponse(null, { status: 204 });
    }),
  ),

  // Google: o servidor real responde 302 para o Google e de volta. A simulação responde o retorno como
  // JSON ({location}) para o retorno de exemplo da demonstração: uma conta com WhatsApp, uma conta nova
  // (needs_phone) ou uma recusa (auth_error).
  http.get(`${API}/auth/google/callback`, ({ request }) =>
    respond(() => {
      const url = new URL(request.url);
      const back = (url.searchParams.get("return_to") || "/minhas-reservas/").replace(/^(?!\/)/, "/").replace(/^\/\/+/, "/");
      const join = (extra) => `${back}${back.includes("?") ? "&" : "?"}${extra}`;
      const choice = url.searchParams.get("code");
      if (choice !== "conta" && choice !== "nova") return HttpResponse.json({ location: join("auth_error=access_denied") });
      const state = getState(mockNow());
      const sub = choice === "conta" ? "google-demo-com-whatsapp" : `google-demo-nova-${uuid().slice(0, 8)}`;
      let customer = state.customers.find((c) => c.google_sub === sub && !c.anonymized_at && !c.deletion_requested_at);
      if (!customer) {
        customer = {
          id: uuid(), name: choice === "conta" ? "Luiza Prado" : "Conta Google nova", google_sub: sub, email: choice === "conta" ? "luiza.prado@exemplo.com" : "nova@exemplo.com",
          phone_e164: choice === "conta" ? "+5545999120034" : null, phone_verified_at: choice === "conta" ? mockNow().toISOString() : null,
          visits: 0, no_shows: 0, last_visit_at: null, tags: [], internal_notes: "", blocked: false, marketing_opt_in: false,
          privacy_version: state.privacy?.privacy_version || "2026-10-14", anonymized_at: null, locale: "pt",
        };
        state.customers.push(customer);
      }
      openSession(state, customer, true);
      save();
      return HttpResponse.json({ location: verified(customer) ? back : join("needs_phone=1") });
    }),
  ),

  // ---- a conta ----
  http.get(`${API}/me`, () =>
    respond(() => {
      const { customer, error } = needSession(getState(mockNow()));
      return error || HttpResponse.json(customerMe(customer));
    }),
  ),

  http.patch(`${API}/me`, async ({ request }) =>
    respond(async () => {
      const state = getState(mockNow());
      const { customer, error } = needSession(state);
      if (error) return error;
      const body = await request.json().catch(() => ({}));
      const errors = [];
      if ("name" in body) {
        const name = String(body.name || "").trim();
        if (name.length < 2 || name.length > 60) errors.push({ field: "name", message: "Escreva o nome com 2 a 60 letras." });
      }
      if ("email" in body && body.email != null && body.email !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(body.email)) {
        errors.push({ field: "email", message: "Confira o e-mail." });
      }
      if ("locale" in body && !["pt", "es", "en"].includes(body.locale)) errors.push({ field: "locale", message: "Escolha a língua." });
      if (errors.length) return invalid(errors);
      if ("name" in body) customer.name = String(body.name).trim();
      if ("email" in body) customer.email = body.email ? String(body.email).trim() : null;
      if ("locale" in body) customer.locale = body.locale;
      if ("marketing_opt_in" in body) {
        customer.marketing_opt_in = Boolean(body.marketing_opt_in);
        customer.marketing_opt_in_at = customer.marketing_opt_in ? mockNow().toISOString() : null;
      }
      save();
      return HttpResponse.json(customerMe(customer));
    }),
  ),

  http.delete(`${API}/me`, () =>
    respond(() => {
      const now = mockNow();
      const state = getState(now);
      const { customer, error } = needSession(state);
      if (error) return error;
      let canceled = 0;
      for (const r of state.reservations.filter((x) => x.customer_id === customer.id && ACTIVE.has(x.status) && startsAt(x) > now)) {
        cancelReservation(state, r, { reason: "Pedido para apagar os dados", by: "customer" });
        canceled++;
      }
      const request = deletionRequest(state, customer, now);
      customer.deletion_requested_at = now.toISOString();
      delete state.mock_session;
      session.remove(TAB_KEY);
      save();
      return HttpResponse.json({ due_at: request.due_at, canceled }, { status: 202 });
    }),
  ),

  http.get(`${API}/me/data`, () =>
    respond(() => {
      const state = getState(mockNow());
      const { customer, error } = needSession(state);
      if (error) return error;
      if (forced("download")) return HttpResponse.error();
      const mine = state.reservations.filter((r) => r.customer_id === customer.id);
      return HttpResponse.json({
        exported_at: mockNow().toISOString(),
        house: state.house.name,
        profile: {
          name: customer.name, phone: customer.phone_e164, phone_verified: verified(customer), email: customer.email ?? null,
          locale: customer.locale || "pt", marketing_opt_in: Boolean(customer.marketing_opt_in), google_linked: Boolean(customer.google_sub),
        },
        reservations: mine.map((r) => ({
          code: r.code, date: r.date, time: r.time, party_size: r.party_size, status: r.status, notes: r.notes || "",
          flags: r.flags || [], created_at: r.created_at, terms_version: r.terms_version ?? null, terms_locale: r.terms_locale ?? null,
        })),
        consents: [
          ...[...new Set(mine.map((r) => r.terms_version).filter(Boolean))].map((v) => ({ kind: "terms", version: v })),
          { kind: "privacy", version: customer.privacy_version || null },
          { kind: "marketing", value: Boolean(customer.marketing_opt_in), at: customer.marketing_opt_in_at ?? null },
        ],
      });
    }),
  ),

  http.post(`${API}/me/phone`, async ({ request }) =>
    respond(async () => {
      const state = getState(mockNow());
      const { customer, error } = needSession(state);
      if (error) return error;
      const body = await request.json().catch(() => ({}));
      const wrongPhone = phoneProblem(body.phone);
      if (wrongPhone) return wrongPhone;
      const other = state.customers.find((c) => c.id !== customer.id && c.phone_e164 === body.phone && !c.anonymized_at && !c.deletion_requested_at);
      if (other && verified(other)) return problem(409, "phone_in_use", "Esse número já está em outra conta.");
      const wrong = checkCode(state, body.phone, body.code);
      if (wrong) return wrong;
      if (other) {
        // um cliente que a equipe criou com este número, nunca verificado: as reservas se juntam
        for (const r of state.reservations.filter((x) => x.customer_id === other.id)) r.customer_id = customer.id;
        other.merged_into = customer.id;
        other.anonymized_at = mockNow().toISOString();
      }
      customer.phone_e164 = body.phone;
      customer.phone_verified_at = mockNow().toISOString();
      save();
      return HttpResponse.json(customerMe(customer));
    }),
  ),

  // ---- reserva ----
  http.post(`${API}/reservations`, async ({ request }) =>
    respond(async () => {
      const now = mockNow();
      const state = getState(now);
      sweepWaitlist(state, now);
      const key = request.headers.get("Idempotency-Key");
      const body = await request.json().catch(() => ({}));
      const again = replay(state, key, body);
      if (again) return again;
      if (forced("rede")) return HttpResponse.error();
      if (forced("sessao")) {
        delete state.mock_session;
        save();
        return problem(401, "session_expired", "Sua entrada venceu.");
      }
      const customer = sessionCustomer(state);
      if (!customer) return problem(401, state.mock_session ? "session_expired" : "unauthorized", "Entre com o código do WhatsApp.");
      if (!body.turnstile_token || body.turnstile_token !== TURNSTILE_TEST_TOKEN || forced("turnstile")) {
        return problem(400, "turnstile_failed", "A checagem contra robôs não passou.");
      }
      if (!verified(customer)) return problem(409, "needs_whatsapp", "Falta confirmar o WhatsApp.");
      if (customer.blocked) return problem(403, "customer_blocked", "Vamos combinar pelo WhatsApp.");
      const party = Number(body.party_size);
      const errors = [];
      if (!Number.isInteger(party) || party < 1) errors.push({ field: "party_size", message: "Escolha quantas pessoas." });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date || "") || !/^\d{2}:\d{2}$/.test(body.time || "")) errors.push({ field: "time", message: "Escolha o dia e o horário." });
      const name = String(body.name || "").trim();
      if (name.length < 2 || name.length > 60) errors.push({ field: "name", message: "Escreva o nome com 2 a 60 letras." });
      errors.push(...notesErrors(body.notes));
      if (errors.length) return invalid(errors);
      if (forced("termos") || body.terms_version !== state.terms.version) {
        return problem(409, "terms_outdated", "Os combinados da casa mudaram.", { terms: termsPublic(state) });
      }
      const place = placeFor(state, body, party, now);
      if (place.error) return place.error;
      const day = place.day;
      if (place.bigGroup && state.booking.large_group_action !== "request") {
        return problem(422, "party_too_large", "Esse grupo é montado com a casa, pelo WhatsApp.", { max: day.party_max_online });
      }

      const mine = state.reservations.filter((r) => r.customer_id === customer.id && ACTIVE.has(r.status));
      const same = mine.find((r) => r.date === body.date && r.time === body.time);
      if (same) return problem(409, "duplicate_reservation", "Você já tem uma reserva nesse horário.", { existing: reservationPublic(state, same) });
      const waitlist = Boolean(body.waitlist);
      if (!waitlist) {
        const limit = activeLimit(state, customer, now);
        if (limit) return limit;
      }
      if (place.full && !waitlist && !place.bigGroup) {
        return problem(409, "slot_full", "Esse horário lotou enquanto você preenchia.", { reason: null, alternatives: alternatives(state, body.date, party, now) });
      }

      const terms = state.terms.version;
      archiveTerms(state); // o que esta versão dizia, em cada língua, fica guardado com a casa
      const base = {
        id: uuid(), code: newCode(state), public_token: uuid().replace(/-/g, "") + uuid().replace(/-/g, ""),
        customer_id: customer.id, party_size: party, date: body.date, time: body.time,
        starts_at: startsAt(body).toISOString(),
        duration_min: durationFor(state, day, Math.min(party, day.party_max_online)), area_preference: body.area_preference ?? null,
        area_key: place.listArea ? place.listArea.key : null,
        table_codes: [], source: "site", customer_confirmation: "not_sent",
        // o prazo e os combinados são os que a pessoa aceitou; a tolerância é lida ao vivo (AR-29)
        cancel_until_hours: state.booking.cancel_until_hours ?? 2,
        extra_tolerance_min: 0, notes: String(body.notes || "").trim(), flags: Array.isArray(body.flags) ? body.flags : [],
        event_id: day.event?.id ?? null, waitlist_position: null, offer_expires_at: null, pending_until: null, internal_notes: "",
        terms_version: terms, terms_locale: ["pt", "es", "en"].includes(body.locale) ? body.locale : "pt", terms_accepted_at: now.toISOString(), locale: body.locale || "pt",
        created_by: null, created_at: now.toISOString(), canceled_by: null, cancel_reason: null, decline_reason: null,
        idempotency_key: key || null, history: [], messages: [],
      };
      base.action_token = `a${base.public_token}`;
      base.waitlist_token = `e${base.public_token}`;

      let r;
      if (waitlist) {
        const max = settingsOf(state, "waitlist").max_per_slot ?? 10;
        const queue = queueOf(state, base);
        if (!state.booking.waitlist_enabled || queue.length >= max) {
          return problem(409, "slot_full", "A lista de espera desse horário está cheia.", { reason: "waitlist_full", alternatives: alternatives(state, body.date, party, now) });
        }
        r = { ...base, status: "waitlisted", waitlist_position: Math.max(0, ...queue.map((x) => x.waitlist_position ?? 0)) + 1 };
        message(r, "waitlist_joined");
        history(r, "created", "Entrou na lista de espera pelo site");
      } else {
        const rules = state.booking.approval_rules || {};
        const needsHouse =
          place.bigGroup ||
          state.booking.approval_mode === "manual" ||
          (rules.customer_no_shows_at_least && customer.no_shows >= rules.customer_no_shows_at_least) ||
          Boolean(day.event?.requires_approval);
        const quiet = settingsOf(state, "alerts");
        r = {
          ...base,
          table_codes: place.codes ? [...place.codes] : [],
          status: needsHouse ? "pending" : "confirmed",
          pending_until: needsHouse
            ? pendingDeadline(now, startsAt(base), { hours: state.booking.pending_expiry_hours ?? 4, quietFrom: quiet.quiet_from || "01:00", quietTo: quiet.quiet_to || "09:00" })
            : null,
        };
        message(r, needsHouse ? "booking_pending" : "booking_confirmed");
        history(r, "created", place.bigGroup ? `Pedido de grupo grande (${party} pessoas) pelo site` : "Reserva feita pelo site");
      }
      state.reservations.push(r);
      const payload = reservationPublic(state, r);
      storeIdempotent(state, key, body, 201, payload);
      save();
      // a resposta se perdeu na volta: a reserva existe, e a mesma chave a devolve
      if (forced("perde_resposta")) return HttpResponse.error();
      return HttpResponse.json(payload, { status: 201 });
    }),
  ),

  http.get(`${API}/reservations/mine`, () =>
    respond(() => {
      const now = mockNow();
      const state = getState(now);
      sweepWaitlist(state, now);
      const { customer, error } = needSession(state);
      if (error) return error;
      const items = state.reservations
        .filter((r) => r.customer_id === customer.id)
        .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))
        .map((r) => reservationPublic(state, r));
      const isNext = (r) => ACTIVE.has(r.status) && new Date(`${r.date}T${r.time}:00-03:00`).getTime() + 3 * HOUR > now.getTime();
      return HttpResponse.json({
        server_time: now.toISOString(),
        items,
        upcoming: items.filter(isNext),
        past: items.filter((r) => !isNext(r)).reverse(),
        window_until: addDays(nightOf(now), (state.booking.window_days ?? 30) - 1),
      });
    }),
  ),

  http.get(`${API}/reservations/mine/:code`, ({ params }) =>
    respond(() => {
      const state = getState(mockNow());
      const { customer, error } = needSession(state);
      if (error) return error;
      const r = state.reservations.find((x) => x.code === params.code && x.customer_id === customer.id);
      return r ? HttpResponse.json(reservationPublic(state, r)) : problem(404, "not_found", "Reserva não encontrada.");
    }),
  ),

  http.post(`${API}/reservations/mine/:code/reschedule`, async ({ params, request }) =>
    respond(async () => {
      const now = mockNow();
      const state = getState(now);
      const { customer, error } = needSession(state);
      if (error) return error;
      const key = request.headers.get("Idempotency-Key");
      const body = await request.json().catch(() => ({}));
      const again = replay(state, key, { ...body, code: params.code });
      if (again) return again;
      const r = state.reservations.find((x) => x.code === params.code && x.customer_id === customer.id);
      if (!r) return problem(404, "not_found", "Reserva não encontrada.");
      if (customer.blocked) return problem(403, "customer_blocked", "Vamos combinar pelo WhatsApp.");
      if (!["pending", "confirmed"].includes(r.status)) return problem(409, "invalid_transition", "Essa reserva já mudou.");
      if (pastDeadline(now, cancelDeadline(state, r)) || settingsOf(state, "booking").customer_can_reschedule === false) {
        return problem(409, "conflict", "Essa reserva não dá para mudar por aqui.", { reason: "reschedule" });
      }
      const next = { date: body.date || r.date, time: body.time || r.time, party_size: Number(body.party_size || r.party_size) };
      if (!Number.isInteger(next.party_size) || next.party_size < 1) return invalid([{ field: "party_size", message: "Escolha quantas pessoas." }]);
      const place = placeFor(state, next, next.party_size, now, { ignoreId: r.id });
      if (place.error) return place.error;
      if (place.bigGroup) return problem(422, "party_too_large", "Esse grupo é montado com a casa, pelo WhatsApp.", { max: place.day.party_max_online });
      if (place.full) return problem(409, "slot_full", "Esse horário lotou.", { reason: null, alternatives: alternatives(state, next.date, next.party_size, now, r.id) });
      const same = state.reservations.find((x) => x.id !== r.id && x.customer_id === customer.id && ACTIVE.has(x.status) && x.date === next.date && x.time === next.time);
      if (same) return problem(409, "duplicate_reservation", "Você já tem uma reserva nesse horário.", { existing: reservationPublic(state, same) });
      const before = { date: r.date, time: r.time, party: r.party_size };
      Object.assign(r, {
        date: next.date, time: next.time, party_size: next.party_size, table_codes: place.codes || [],
        area_key: place.listArea ? place.listArea.key : r.table_codes?.length ? r.area_key : null,
        starts_at: startsAt(next).toISOString(), duration_min: durationFor(state, place.day, next.party_size), late_notice_at: null,
      });
      message(r, "booking_changed");
      history(r, "rescheduled", `Mudou de ${before.date} ${before.time} (${before.party}) para ${r.date} ${r.time} (${r.party_size})`);
      if (before.date !== r.date || before.time !== r.time || before.party > r.party_size) offerFreedPlace(state, before.date, now);
      const payload = reservationPublic(state, r);
      storeIdempotent(state, key, { ...body, code: params.code }, 200, payload);
      save();
      return HttpResponse.json(payload);
    }),
  ),

  // "Vou atrasar um pouco": os minutos extras valem uma vez, e a recepção é avisada
  http.post(`${API}/reservations/mine/:code/late`, ({ params }) =>
    respond(() => {
      const now = mockNow();
      const state = getState(now);
      const { customer, error } = needSession(state);
      if (error) return error;
      const r = state.reservations.find((x) => x.code === params.code && x.customer_id === customer.id);
      if (!r) return problem(404, "not_found", "Reserva não encontrada.");
      return lateNotice(state, r, now) || HttpResponse.json(reservationPublic(state, r));
    }),
  ),

  http.post(`${API}/reservations/mine/:code/cancel`, ({ params }) =>
    respond(() => {
      const now = mockNow();
      const state = getState(now);
      const { customer, error } = needSession(state);
      if (error) return error;
      const r = state.reservations.find((x) => x.code === params.code && x.customer_id === customer.id);
      if (!r) return problem(404, "not_found", "Reserva não encontrada.");
      return cancelByCustomer(state, r, now) || HttpResponse.json(reservationPublic(state, r));
    }),
  ),
];

/** O aviso de atraso, usado pela conta e pelo link: null quando deu certo. */
export function lateNotice(state, r, now) {
  if (!state.booking.late_notice_enabled || !(state.booking.extra_tolerance_min > 0)) {
    return problem(409, "invalid_transition", "Esse aviso não vale para essa reserva.", { reason: "late_off" });
  }
  if (!["confirmed", "pending"].includes(r.status) || r.arrived_at || r.table_session_id) {
    return problem(409, "invalid_transition", "Essa reserva já mudou.");
  }
  if (r.late_notice_at) return null; // já avisado: avisar de novo não acrescenta nada
  if (now >= toleranceEndAt(state, r)) return problem(409, "invalid_transition", "A mesa já não está guardada.", { reason: "late" });
  r.late_notice_at = now.toISOString();
  r.extra_tolerance_min = state.booking.extra_tolerance_min;
  history(r, "late_notice", `Avisou que vai atrasar: a mesa espera até ${fromMinutes(toleranceEnd(state, r))}`);
  save();
  return null;
}

/** Cancelamento pelo cliente (conta ou link), pelo prazo copiado na reserva. */
export function cancelByCustomer(state, r, now) {
  if (!ACTIVE.has(r.status) || r.arrived_at || r.table_session_id) {
    history(r, "link_tap", "Tocou em cancelar, mas a reserva já tinha mudado");
    save();
    return problem(409, "invalid_transition", "Essa reserva já mudou.");
  }
  const waiting = r.status === "waitlisted";
  // o próprio prazo ainda está no tempo: 18:00:00 está dentro de "até 18:00" (história 7.11)
  const late = !waiting && pastDeadline(now, cancelDeadline(state, r));
  if (late && !state.booking.customer_can_cancel_late) return problem(409, "outside_cancel_window", "Passou o prazo para cancelar por aqui.");
  cancelReservation(state, r, { late, reason: waiting ? "Saiu da lista de espera" : null });
  save();
  return null;
}
