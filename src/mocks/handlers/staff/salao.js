// Salão: o salão ao vivo da noite (GET /staff/floor), sentar grupos sem reserva, as
// sessões de mesa (mudar, juntar, separar, liberar, +10 min, pessoas), a folha da noite
// (GET /staff/night/snapshot) e a vida da própria noite: o que as configurações gravadas de Salão e Reservas
// dizem sobre a tolerância, o fechamento da noite, a folha impressa e as notas
// do papel mandadas ao dono. As funções de apoio no começo são usadas também por espera.js, que também
// responde as ações de reserva que o salão usa ("Chegou", "+10 min", "Não veio"), e pelas
// rotas do Hoje e de Reservas.
import { http, HttpResponse } from "msw";
import { addDays, houseParts, toMinutes } from "../../../lib/dates.js";
import { uuid } from "../../../lib/uuid.js";
import { resolveDay } from "../../availability.js";
import { getState, save } from "../../db.js";
import { session } from "../../../lib/storage.js";
import { currentRole, mockNow, mockNowIsFake, problem, respond } from "../../scenario.js";
import { newSession, nightClock, sessionEvent, walkInReservation } from "../../seeds/salao.js";
import { offerFreedPlace } from "../customer.js";

const API = "/api/v1";
const MIN = 60_000;
const HOUR = 60 * MIN;
const time = (instant) => houseParts(instant).time;
const MANAGEMENT = new Set(["owner", "manager"]);

// ---- as configurações gravadas -----------------------------------------------------------

/**
 * O que o salão segue, lido das configurações gravadas a cada vez (Configurações › Salão,
 * Reservas e Aprovação e faltas), com os padrões da casa quando um grupo nunca foi gravado.
 */
export function rulesOf(state) {
  // os grupos gravados (Configurações), com a cópia que as configurações guardam para o resto da simulação
  const floor = { ...(state.floor_settings || {}), ...(state.settings?.floor?.data || {}) };
  const booking = { ...(state.booking || {}), ...(state.settings?.booking?.data || {}) };
  const approval = { undo_no_show_hours: state.booking?.undo_no_show_hours, ...(state.settings?.approval_no_shows?.data || {}) };
  const after = booking.after_tolerance ?? "lose_priority";
  const end = floor.on_tolerance_end ?? state.booking?.on_tolerance_end ?? "suggest_no_show";
  return {
    tolerance_min: booking.tolerance_min ?? state.booking?.tolerance_min ?? 20,
    extra_tolerance_min: booking.extra_tolerance_min ?? state.booking?.extra_tolerance_min ?? 10,
    after_tolerance: after,
    // "soltar sozinho" só vale com "libera a mesa": as configurações recusam a outra combinação
    on_tolerance_end: end === "auto_release" && after !== "release" ? "suggest_no_show" : end,
    undo_check_in_min: floor.undo_check_in_min ?? 15,
    release_hint_min: floor.release_hint_min ?? 15,
    // "sugerir imprimir a folha": na abertura, numa hora escolhida, ou desligado
    print_sheet_mode: floor.print_sheet_mode ?? (floor.print_sheet_at === null ? "off" : floor.print_sheet_at ? "at_time" : "at_open"),
    print_sheet_at: floor.print_sheet_at ?? null,
    night_close_delay_min: floor.night_close_delay_min ?? 60,
    reception_reschedule: floor.reception_reschedule ?? "same_day",
    undo_no_show_hours: approval.undo_no_show_hours ?? 24,
    waitlist_offer_min: state.settings?.waitlist?.data?.offer_min ?? state.booking?.waitlist_offer_min ?? 10,
  };
}

/** A tolerância de uma reserva, lida ao vivo das configurações (+ os minutos extras que ela ganhou). */
export function toleranceEnd(state, r) {
  const rules = rulesOf(state);
  return new Date(new Date(r.starts_at).getTime() + (rules.tolerance_min + (r.extra_tolerance_min || 0)) * MIN);
}

/** Se o cliente já avisou que vai atrasar, pelo botão do lembrete ou por telefone. */
export const toldLate = (r) => Boolean(r.late_notice_at || r.customer_late);

/**
 * A regra única do "vai atrasar" (2.12): o extra para quem avisou é somado uma vez, seja o
 * cliente tocando em "Vou atrasar um pouco" ou atendendo o telefone. Devolve os minutos somados (0
 * quando já tinha avisado). O "+10 min" do salão é um ato separado e explícito.
 */
export function markToldLate(state, r, now) {
  if (toldLate(r)) {
    r.customer_late = true;
    return 0;
  }
  const extra = rulesOf(state).extra_tolerance_min || 0;
  Object.assign(r, { customer_late: true, late_notice_at: now.toISOString(), extra_tolerance_min: (r.extra_tolerance_min || 0) + extra });
  return extra;
}

// ---- quem e onde -------------------------------------------------------------------------

/** O aparelho da sessão: o computador da casa para a recepção, o acesso pessoal nos outros casos. */
export function deviceLabel(state, role = currentRole()) {
  if (role !== "floor") return "Acesso pessoal";
  const devices = (state.devices || []).filter((d) => d.status === "approved");
  return (devices.find((d) => d.kind === "desktop") || devices[0])?.name || "Computador da recepção";
}

export function userOf(state, role = currentRole()) {
  return state.users.find((u) => u.role === (role || "owner") && u.status === "active") || null;
}

/** O estado, o relógio da noite e quem está agindo. */
export function context() {
  const real = mockNow();
  const state = getState(real);
  state.table_sessions ??= [];
  const { date, now, demo } = nightClock(state, real);
  playingNight = demo;
  const role = currentRole();
  const actor = userOf(state, role)?.name || "Salão";
  return { state, date, now, role, actor, device: deviceLabel(state, role) };
}

/**
 * Uma linha do registro de ações, no formato que o Registro lê (história 1.13): o momento real,
 * a pessoa e o aparelho, a ação como "reservation.check_in", a entidade e o antes
 * e depois do que mudou.
 */
export function logAction(state, { action, entity = "reservation", id = null, summary, at = mockNow(), changes = {}, system = false, role = currentRole() }) {
  state.audit ??= [];
  if (correction && !system) {
    summary = `${summary} · correção depois do fechamento: ${correction}`;
    changes = { ...changes, correction_reason: { from: null, to: correction } };
    correction = null;
  }
  const user = system ? null : userOf(state, role);
  state.audit.push({
    id: uuid(),
    occurred_at: new Date(at).toISOString(),
    actor_type: system ? "system" : "user",
    actor_id: user?.id ?? null,
    actor_label: system ? "Sistema" : user?.name || "Equipe",
    device_label: system ? null : deviceLabel(state, role),
    action: action.includes(".") ? action : `${entity}.${action}`,
    entity_type: entity,
    entity_id: id,
    summary,
    changes,
  });
  if (state.audit.length > 2000) state.audit.splice(0, state.audit.length - 2000);
}

/** Mantida para quem chama pelo salão: a mesma linha do registro, com o relógio da noite. */
export function audit(state, { action, entity = "reservation", id, summary, now, changes = {} }) {
  logAction(state, { action, entity, id, summary, at: now, changes });
}

export function maskPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 8) return "";
  return `(${digits.slice(2, 4)}) •••••-${digits.slice(-4)}`;
}

const HIDDEN = ["customer_id", "walk_in_name", "walk_in_phone", "public_token", "idempotency_key", "terms_accepted_at", "status_before_check_in", "history", "messages"];

/** A última mensagem pronta mandada para uma reserva ou um grupo da porta, para "avisado às". */
export function lastNotified(r) {
  const sent = (r.messages || []).filter((m) => ["table_waiting", "table_ready", "running_late"].includes(m.template));
  const last = sent.at(-1);
  return last ? { template: last.template, at: last.sent_at, status: last.status } : null;
}

/** Uma reserva como a API da equipe devolve, recortada para o perfil (o salão vê primeiros nomes). */
export function project(state, r, role) {
  const c = state.customers.find((x) => x.id === r.customer_id);
  const full = c?.name || r.walk_in_name || "";
  const out = { ...r };
  for (const key of HIDDEN) delete out[key];
  out.customer = {
    id: c?.id ?? null,
    name: role === "floor" ? full.split(" ")[0] : full,
    phone_masked: maskPhone(c?.phone_e164 || r.walk_in_phone),
    visits: c?.visits ?? 0,
    no_shows: c?.no_shows ?? 0,
  };
  out.has_phone = Boolean(c?.phone_e164 || r.walk_in_phone);
  out.phone_verified = r.phone_verified ?? Boolean(c?.phone_verified_at || r.walk_in_phone);
  // a tolerância é a da casa, lida ao vivo das configurações
  out.tolerance_min = rulesOf(state).tolerance_min;
  out.tolerance_until = r.starts_at ? toleranceEnd(state, r).toISOString() : null;
  // "avisou": pelo botão do lembrete ou por telefone, uma regra só (2.12)
  out.customer_late = toldLate(r);
  out.last_notified = lastNotified(r);
  out.offer_message_status = r.status === "offered" ? (r.offer_message_status ?? "delivered") : null;
  if (role === "floor" && (r.flags || []).includes("dietary")) out.notes = "";
  if (role === "floor") out.internal_notes = "";
  out.version = String(r.version ?? 1);
  return out;
}

export function projectSession(s) {
  const rest = { ...s };
  delete rest.events;
  delete rest.undone;
  // pronto para o giro e o tempo de mesa (FR-69): quanto tempo a mesa ficou aberta
  if (s.released_at) rest.duration_min = Math.round((new Date(s.released_at) - new Date(s.seated_at)) / MIN);
  return rest;
}

export const nightSessions = (state, date) => {
  const ids = new Set(state.reservations.filter((r) => r.date === date).map((r) => r.id));
  return state.table_sessions.filter((s) => ids.has(s.reservation_id) && !s.undone);
};

/** A sessão aberta que ocupa alguma destas mesas. */
export function sessionOn(state, date, codes, exceptId = null) {
  return nightSessions(state, date).find((s) => s.status === "open" && s.id !== exceptId && s.table_codes.some((c) => codes.includes(c)));
}

/** Ofertas da lista de espera passadas do tempo voltam para o fim da fila do mesmo horário. */
export function expireOffers(state, date, now) {
  for (const r of state.reservations) {
    if (r.date !== date || r.status !== "offered" || !r.offer_expires_at) continue;
    if (new Date(r.offer_expires_at) > now) continue;
    Object.assign(r, { status: "waitlisted", table_codes: [], area_key: null, last_offer_expired_at: r.offer_expires_at, offer_expires_at: null, created_at: r.offer_expires_at });
  }
}

/**
 * Um lugar aberto pela equipe (cancelamento, mesa liberada, plano do dia, dados apagados): é
 * escrito uma vez em state.capacity_freed e oferecido na hora à lista de espera daquela noite, a mesma
 * oferta que o cancelamento do próprio cliente faz (7.16): mensagem, minutos para aceitar, histórico.
 * Devolve as reservas que receberam a oferta.
 */
export function placeFreed(state, entry, now = mockNow()) {
  state.capacity_freed ??= [];
  if (entry.reservation_id && state.capacity_freed.some((x) => x.reservation_id === entry.reservation_id)) return [];
  const offered = [];
  for (let r = offerFreedPlace(state, entry.date, now); r && offered.length < 50; r = offerFreedPlace(state, entry.date, now)) offered.push(r);
  state.capacity_freed.push({ at: now.toISOString(), ...entry, offered_to: offered.map((r) => r.id) });
  return offered;
}

export const waitlistOf = (state, date) => state.reservations.filter((r) => r.date === date && (r.status === "waitlisted" || r.status === "offered"));

/** A próxima reserva (que ainda não chegou) em alguma destas mesas, depois de um momento. */
export function nextBooking(state, date, codes, after) {
  return state.reservations
    .filter((r) => r.date === date && ["confirmed", "pending"].includes(r.status) && r.table_codes.some((c) => codes.includes(c)) && new Date(r.starts_at) >= after)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
}

function markReleaseHints(state, date, now) {
  const hint = rulesOf(state).release_hint_min;
  const waiting = waitlistOf(state, date).length > 0;
  for (const s of nightSessions(state, date)) {
    if (s.status !== "open" || !s.ends_at || !hint) {
      s.release_hint = false;
      continue;
    }
    const left = new Date(s.ends_at) - now;
    s.release_hint = left <= hint * MIN && (waiting || Boolean(nextBooking(state, date, s.table_codes, now)));
  }
}

/**
 * O fim da tolerância, como as configurações dizem (a tabela da história 6.4): com "libera a mesa"
 * e "soltar sozinho", a reserva solta a mesa sozinha; em todo caso ela fica
 * para a recepção marcar "Não veio".
 */
export function applyTolerance(state, date, now) {
  const rules = rulesOf(state);
  for (const r of state.reservations) {
    if (r.date !== date || r.status !== "confirmed" || !r.table_codes?.length || r.arrived_at) continue;
    const end = toleranceEnd(state, r);
    if (end > now) continue;
    if (rules.after_tolerance === "release" && rules.on_tolerance_end === "auto_release") {
      const codes = r.table_codes.join("+");
      Object.assign(r, { lost_table_codes: [...r.table_codes], table_codes: [], table_released_at: end.toISOString() });
      r.history ??= [];
      r.history.push({ at: end.toISOString(), actor_label: "Sistema", action: "release_table", summary: `Mesa ${codes} solta no fim da tolerância. A reserva espera o "Não veio" da recepção.` });
      logAction(state, { action: "reservation.release_table", id: r.id, summary: `Soltou a mesa ${codes} de ${r.code} no fim da tolerância`, at: end, system: true, changes: { table_codes: { from: codes, to: "—" } } });
    }
  }
}

// ---- o fechamento da noite ---------------------------------------------------------------

export const nightsOf = (state) => (state.nights ??= {});

/** Quando a noite desta data fecha sozinha: o fechamento da casa + o atraso configurado (+1 h se adiado). */
export function nightCloseAt(state, date) {
  const day = resolveDay(state, date);
  if (!day.open) return null;
  const opens = toMinutes(day.opens_at || "19:00");
  let closes = toMinutes(day.closes_at || "23:30");
  if (closes <= opens) closes += 24 * 60; // fechamento depois da meia-noite
  const meta = nightsOf(state)[date] || {};
  const minutes = closes + rulesOf(state).night_close_delay_min + (meta.postponed ? 60 : 0);
  return new Date(new Date(`${date}T00:00:00-03:00`).getTime() + minutes * MIN);
}

export const isNightClosed = (state, date) => Boolean(nightsOf(state)[date]?.closed_at);

const FINAL = new Set(["completed", "no_show", "canceled", "declined", "expired"]);

/**
 * A rotina da noite (história 6.14): "Não veio" nos confirmados que não chegaram, as mesas
 * abertas fechadas pelo sistema no horário de fechamento, a lista de espera e suas ofertas vencidas. Uma noite
 * com um longo silêncio do aparelho da casa não marca "Não veio": o dono confere antes.
 */
export function closeNight(state, date, at, { by = "system" } = {}) {
  const meta = (nightsOf(state)[date] ??= {});
  if (meta.closed_at) return meta;
  const outage = Boolean(meta.outage);
  const marked = [];
  const review = [];
  for (const r of state.reservations) {
    if (r.date !== date || FINAL.has(r.status)) continue;
    if (r.status === "confirmed") {
      if (outage) {
        review.push(r.id);
        continue;
      }
      Object.assign(r, { status: "no_show", no_show_at: at.toISOString(), no_show_counted: true, no_show_auto: true });
      const c = state.customers.find((x) => x.id === r.customer_id);
      if (c) c.no_shows = (c.no_shows || 0) + 1;
      marked.push(r.id);
    } else if (["waitlisted", "offered", "pending"].includes(r.status)) {
      Object.assign(r, { status: "expired", offer_expires_at: null, table_codes: r.status === "pending" ? [] : r.table_codes });
    }
  }
  for (const s of nightSessions(state, date)) {
    if (s.status !== "open") continue;
    Object.assign(s, { status: "closed", released_at: at.toISOString(), closed_by_system: true, release_hint: false });
    s.events.push(sessionEvent("closed_by_system", at, { actor_label: "Sistema", table_codes: [...s.table_codes], people: s.people }));
    const r = state.reservations.find((x) => x.id === s.reservation_id);
    if (r && !r.left_at) r.left_at = at.toISOString();
  }
  Object.assign(meta, { closed_at: at.toISOString(), closed_by: by, no_shows: marked, review });
  logAction(state, {
    action: "night.close",
    entity: "night",
    id: date,
    summary: `Fechou a noite de ${date.slice(8, 10)}/${date.slice(5, 7)}: ${marked.length} "Não veio"${outage ? ", queda do aparelho: chegadas para conferir" : ""}`,
    at,
    system: by === "system",
  });
  return meta;
}

/** Fecha, quando chegou a hora, a noite que o salão está olhando (a rotina do servidor, rodada na leitura). */
export function runNightClose(state, date, now) {
  const at = nightCloseAt(state, date);
  if (at && now >= at && !isNightClosed(state, date)) {
    closeNight(state, date, at);
    return true;
  }
  return false;
}

/** O aviso 15 min antes do fechamento automático, enquanto há mesas abertas com ação recente. */
export function closingSoon(state, date, now) {
  const at = nightCloseAt(state, date);
  if (!at || isNightClosed(state, date)) return null;
  const left = at - now;
  if (left > 15 * MIN || left < 0) return null;
  const open = nightSessions(state, date).filter((s) => s.status === "open");
  const recent = open.filter((s) => (s.events || []).some((e) => now - new Date(e.at) <= 30 * MIN));
  if (!recent.length) return null;
  return { at: at.toISOString(), time: time(at), open_tables: open.length, can_postpone: !nightsOf(state)[date]?.postponed };
}

/** O aparelho da casa que ficou quieto mais de 15 min em serviço deixa a noite "com queda". */
export function noteContact(state, date, now, role) {
  if (role !== "floor") return;
  const meta = (nightsOf(state)[date] ??= {});
  const day = resolveDay(state, date);
  const minutes = houseParts(now).minutes;
  const inService = houseParts(now).date === date && day.open && minutes >= toMinutes(day.opens_at || "19:00") && minutes <= toMinutes(day.closes_at || "23:30");
  if (inService && meta.last_contact && now - new Date(meta.last_contact) > 15 * MIN) meta.outage = true;
  meta.last_contact = now.toISOString();
}

/** A última noite aberta antes de uma data, dentro de poucos dias. */
export function previousNight(state, date) {
  for (let i = 1; i <= 4; i++) {
    const d = addDays(date, -i);
    if (resolveDay(state, d).open) return d;
  }
  return null;
}

// ---- a folha -----------------------------------------------------------------------------

/** A hora em que o Hoje pede para imprimir a folha de uma noite ("HH:MM"), ou null quando está desligado. */
export function printSheetAt(state, date) {
  const rules = rulesOf(state);
  if (rules.print_sheet_mode === "off") return null;
  if (rules.print_sheet_mode === "at_time") return rules.print_sheet_at;
  const day = resolveDay(state, date);
  return day.open ? day.opens_at || "19:00" : null;
}

/** O que entrou, saiu ou mudou na noite depois que a folha foi impressa. */
export function changesSince(state, date, since) {
  if (!since) return [];
  const after = (iso) => iso && iso > since;
  const out = [];
  for (const r of state.reservations) {
    if (r.date !== date || r.source === "walk_in") continue;
    const name = (state.customers.find((c) => c.id === r.customer_id)?.name || r.walk_in_name || "").split(" ")[0];
    const line = { id: r.id, time: r.time, name, party_size: r.party_size, table_codes: [...(r.table_codes || [])] };
    if (["canceled", "declined", "expired"].includes(r.status) && after(r.canceled_at || r.updated_at) && r.created_at <= since) {
      out.push({ ...line, kind: "left", text: "saiu" });
    } else if (after(r.created_at) && ["confirmed", "pending", "completed"].includes(r.status)) {
      out.push({ ...line, kind: "new", text: "entrou" });
    } else if ((r.history || []).some((h) => ["move_tables", "rescheduled"].includes(h.action) && after(h.at))) {
      out.push({ ...line, kind: "changed", text: "mudou" });
    }
  }
  return out.sort((a, b) => a.time.localeCompare(b.time));
}

// ---- respostas pequenas ------------------------------------------------------------------

/**
 * Ações sensíveis (exportar, telefone completo, anonimizar) precisam da identidade confirmada nos últimos 5
 * minutos (POST /staff/auth/reauth abre a janela); senão 403 reauth_required.
 */
export function reauthRequired() {
  const at = Number(session.get("territorio:mock-reauth", 0));
  if (at && Date.now() - at < 5 * MIN) return null;
  return problem(403, "reauth_required", "Confirme que é você", { detail: "Essa ação pede a senha e o código de novo." });
}

export const tableTaken = () =>
  problem(409, "conflict", "Essa mesa acabou de ser ocupada", {
    code: "table_taken",
    reason: "table_taken",
    detail: "Outra pessoa da equipe usou a mesa. A planta já está atualizada; escolha outra.",
  });

export const changed = (detail = "Outra pessoa mexeu aqui. A tela já mostra o que vale agora; confira e faça de novo se ainda precisar.") =>
  problem(409, "conflict", "Isso mudou agora há pouco", { detail });

export const invalid = (field, message) => problem(422, "validation", "Confira os dados", { errors: [{ field, message }] });

export const nightClosed = () =>
  problem(409, "night_closed", "A noite já fechou", { detail: "Depois do fechamento, a recepção não muda mais nada. O dono ou o gerente corrige com motivo, se precisar." });

// o motivo de uma correção depois de a noite fechar, escrito nas linhas do registro deste pedido
let correction = null;

/**
 * Uma mudança numa noite que já fechou (6.14): a recepção é recusada (night_closed);
 * dono e gerente só corrigem com um motivo (correction_reason), que vai para o registro.
 * As chegadas de uma noite com queda (deixadas para revisão, não marcadas "Não veio") são conferência
 * do dono, não uma correção: não precisam de motivo.
 * Devolve a recusa, ou null quando a mudança pode seguir.
 */
export function closedNightGuard(state, date, role, body = {}, r = null) {
  correction = null;
  if (!isNightClosed(state, date)) return null;
  if (role === "floor") return nightClosed();
  if (r && (nightsOf(state)[date]?.review || []).includes(r.id)) return null;
  const reason = String(body.correction_reason ?? "").trim();
  if (!reason) {
    return problem(422, "validation", "Falta o motivo da correção", {
      reason: "correction_reason_required",
      errors: [{ field: "correction_reason", message: "A noite já fechou. Escreva o motivo da correção." }],
    });
  }
  correction = reason.slice(0, 280);
  return null;
}

/** Se um motivo de correção ainda está esperando sua linha no registro neste pedido. */
export const correctionPending = () => Boolean(correction);

/**
 * O momento real de uma ação. Notas lançadas do papel (from_paper) precisam ser da mesma
 * noite, no máximo 6 h para trás e nunca mais de 2 min à frente do relógio da casa; qualquer
 * outra coisa vale o momento em que o servidor recebeu.
 */
let playingNight = false; // a demonstração faz a noite fora do horário de serviço: o relógio do aparelho não é o da noite

export function occurredAt(body, now, date = null) {
  const at = body?.occurred_at ? new Date(body.occurred_at) : null;
  if (body?.from_paper) {
    const bad = !at || Number.isNaN(at.getTime()) || at > new Date(now.getTime() + 2 * MIN) || now - at > 6 * HOUR || (date && houseParts(at).date !== date && houseParts(new Date(at.getTime() - 6 * HOUR)).date !== date);
    if (bad) return { error: invalid("occurred_at", "Confira a hora anotada: tem que ser desta noite e não pode estar no futuro.") };
    return at;
  }
  if (playingNight || mockNowIsFake() || !at || Number.isNaN(at.getTime()) || at > new Date(now.getTime() + 2 * MIN) || now - at > 6 * HOUR) return new Date(now);
  return at;
}

/** Responde uma vez por Idempotency-Key: um segundo toque recebe a primeira resposta, nunca uma segunda sessão. */
export async function once(request, state, produce) {
  const key = request.headers.get("Idempotency-Key");
  state.idempotency ??= {};
  const seen = key && state.idempotency[`floor:${key}`];
  if (seen) return HttpResponse.json(seen.body, { status: seen.status });
  const response = await produce();
  if (key && response.status < 300) {
    state.idempotency[`floor:${key}`] = { status: response.status, body: await response.clone().json() };
    save();
  }
  return response;
}

async function readBody(request) {
  try {
    return await request.clone().json();
  } catch {
    return {};
  }
}

/** Um ETag curto de um corpo: a tela pede de novo com If-None-Match e recebe 304 quando nada mudou. */
export function etagOf(body) {
  const text = JSON.stringify(body, (key, value) => (key === "server_time" || key === "night_time" ? undefined : value));
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  return `"${(h >>> 0).toString(36)}-${text.length.toString(36)}"`;
}

/** 304 quando a tela já tem esta versão, senão o corpo com seu ETag. */
export function withEtag(request, body) {
  const tag = etagOf(body);
  if (request.headers.get("If-None-Match") === tag) return new HttpResponse(null, { status: 304, headers: { ETag: tag } });
  return HttpResponse.json(body, { headers: { ETag: tag, "Cache-Control": "no-cache" } });
}

/** Se o WhatsApp da casa está funcionando (?whatsapp=fora no endereço finge que caiu). */
export function whatsappState(state) {
  let forced;
  try {
    const asked = new URLSearchParams(window.location.search).get("whatsapp");
    if (asked) sessionStorage.setItem("territorio:mock-whatsapp", asked);
    forced = sessionStorage.getItem("territorio:mock-whatsapp");
  } catch {
    forced = null;
  }
  if (forced === "fora") return "down";
  return state.system?.whatsapp?.state === "problem" ? "down" : "ok";
}

const tablesOf = (day) => day.layout?.tables || [];
const seatsOf = (day, codes) => tablesOf(day).filter((t) => codes.includes(t.code)).reduce((n, t) => n + t.max_seats, 0);

function openSessionFor(state, id) {
  const session = state.table_sessions.find((s) => s.id === id && !s.undone);
  if (!session) return { error: problem(404, "not_found", "Essa mesa não está mais aberta") };
  if (session.status !== "open") return { error: changed("Essa mesa já foi liberada. A planta já mostra como está agora.") };
  return { session };
}

const bump = (s) => (s.version = String(Number(s.version || 1) + 1));

/**
 * As mesas seguradas por um pedido pendente ou por uma oferta da lista de espera ainda no prazo (6.1): reservadas no
 * salão, com o motivo, nunca livres.
 */
function heldTables(state, date, now) {
  return state.reservations
    .filter((r) => r.date === date && r.table_codes?.length && (r.status === "pending" || (r.status === "offered" && (!r.offer_expires_at || new Date(r.offer_expires_at) > now))))
    .map((r) => ({ table_codes: [...r.table_codes], reason: r.status, reservation_id: r.id, time: r.time, until: (r.status === "offered" ? r.offer_expires_at : r.pending_until) || null }));
}

/** Uma oferta da lista de espera aceita nesta mesa hoje à noite: o grupo está a caminho (6.1). */
const acceptedOfferOn = (state, date, tables) =>
  state.reservations.some(
    (r) => r.date === date && r.status === "confirmed" && !r.arrived_at && (r.table_codes || []).some((c) => tables.includes(c)) && (r.history || []).some((h) => h.action === "offer_accepted"),
  );

/** O salão da noite com as regras que a tela mostra. */
export function floorBody(state, date, now, role, scenario) {
  if (scenario === "vazio") {
    return { server_time: now.toISOString(), date, day: { date, open: false, reason_label: "Sem plano para a noite", layout: null, areas: [], slots: [] }, areas: [], reservations: [], sessions: [], holds: [], rules: rulesOf(state) };
  }
  const day = resolveDay(state, date);
  return {
    server_time: now.toISOString(),
    date,
    day,
    areas: [...state.areas].sort((a, b) => a.sort - b.sort),
    reservations: state.reservations.filter((r) => r.date === date).map((r) => project(state, r, role)),
    sessions: nightSessions(state, date).map(projectSession),
    holds: heldTables(state, date, now),
    rules: rulesOf(state),
    whatsapp: whatsappState(state),
    night: { closed: isNightClosed(state, date), close_at: nightCloseAt(state, date)?.toISOString() ?? null, closing: closingSoon(state, date, now) },
  };
}

/** Tudo o que muda com o relógio antes de o salão ser lido. */
export function settle(state, date, now, role) {
  expireOffers(state, date, now);
  applyTolerance(state, date, now);
  markReleaseHints(state, date, now);
  runNightClose(state, date, now);
  noteContact(state, date, now, role);
}

// ---- rotas ---------------------------------------------------------------------------------

export const handlers = [
  http.get(`${API}/staff/floor`, ({ request }) =>
    respond((scenario) => {
      const { state, date, now, role } = context();
      if (scenario !== "vazio") {
        settle(state, date, now, role);
        save();
      }
      return withEtag(request, floorBody(state, date, now, role, scenario));
    }),
  ),

  // Sentar um grupo sem reserva: a reserva de quem chegou sem marcar e a sessão da mesa de uma vez.
  http.post(`${API}/staff/floor/walk-ins`, async ({ request }) => {
    const body = await readBody(request);
    return respond(() => {
      const { state, date, now, role, actor, device } = context();
      return once(request, state, () => {
        const closed = closedNightGuard(state, date, role, body);
        if (closed) return closed;
        const people = Number(body.party_size);
        if (!Number.isInteger(people) || people < 1) return invalid("party_size", "Diga quantas pessoas são, pelo menos 1.");
        const day = resolveDay(state, date);
        const tables = Array.isArray(body.table_codes) ? body.table_codes.filter((c) => tablesOf(day).some((t) => t.code === c)) : [];
        const listArea = day.areas.find((a) => a.key === body.area_key && a.mode === "list");
        if (!tables.length && !listArea) return invalid("table_codes", "Escolha a mesa.");
        if (tables.length && sessionOn(state, date, tables)) return tableTaken();
        // a oferta foi aceita enquanto a recepção sentava alguém ali: a mesa está ocupada
        if (tables.length && acceptedOfferOn(state, date, tables)) return tableTaken();
        if (listArea) {
          const inside = nightSessions(state, date).filter((s) => s.status === "open" && s.area_code === listArea.key).reduce((n, s) => n + s.people, 0);
          if (inside + people > (listArea.list_capacity || 0)) return invalid("party_size", `O ${listArea.key === "balcao" ? "balcão" : "espaço"} cabe mais ${Math.max(0, listArea.list_capacity - inside)} pessoas.`);
        }
        const seatedAt = occurredAt(body, now, date);
        if (seatedAt.error) return seatedAt.error;
        const area = tables.length ? tablesOf(day).find((t) => t.code === tables[0]).area : listArea.key;
        const reservation = walkInReservation(state, { name: String(body.name || "").trim().slice(0, 60), people, date, seatedAt, tables, area });
        state.reservations.push(reservation);
        const session = newSession(state, reservation, { tables, area, people, seatedAt, duration: day.duration_min || 120, actor, device });
        if (tables.length && people > seatsOf(day, tables)) session.over_capacity = true;
        reservation.table_session_id = session.id;
        // um grupo da lista de espera da porta sai da fila quando senta (história 6.3)
        const door = body.waitlist_id && state.reservations.find((r) => r.id === body.waitlist_id && ["waitlisted", "offered"].includes(r.status));
        if (door) Object.assign(door, { status: "completed", arrived_at: seatedAt.toISOString(), table_session_id: session.id, seated_from_door: true });
        logAction(state, {
          action: "reservation.walk_in",
          id: reservation.id,
          summary: `Sentou ${people} sem reserva em ${tables.join("+") || (listArea.key === "balcao" ? "balcão" : listArea.key)}${body.from_paper ? " (lançado do papel)" : ""}`,
          at: seatedAt,
          changes: { table_codes: { from: "—", to: tables.join("+") || listArea.key }, people: { from: null, to: people } },
        });
        save();
        return HttpResponse.json(project(state, reservation, role), { status: 201 });
      });
    });
  }),

  http.get(`${API}/staff/floor/sessions/:id`, ({ params }) =>
    respond(() => {
      const { state, role } = context();
      const session = state.table_sessions.find((s) => s.id === params.id && !s.undone);
      if (!session) return problem(404, "not_found", "Essa mesa não está mais aberta");
      const reservation = state.reservations.find((r) => r.id === session.reservation_id);
      return HttpResponse.json({ ...projectSession(session), reservation: reservation ? project(state, reservation, role) : null, events: session.events || [] });
    }),
  ),

  // Acertar quantas pessoas estão na mesa (If-Match: a versão que a tela viu).
  http.patch(`${API}/staff/floor/sessions/:id`, async ({ request, params }) => {
    const body = await readBody(request);
    return respond(() => {
      const { state, now, actor, device } = context();
      const { session, error } = openSessionFor(state, params.id);
      if (error) return error;
      const match = request.headers.get("If-Match") ?? (body.version == null ? null : String(body.version));
      if (match && match.replaceAll('"', "") !== session.version) {
        return problem(412, "precondition_failed", "Alguém mudou isso antes", { detail: `Agora a mesa está com ${session.people} pessoas. Confira e corrija de novo se precisar.`, current: projectSession(session) });
      }
      const people = Number(body.people);
      if (!Number.isInteger(people) || people < 1) return invalid("people", "Pelo menos 1 pessoa.");
      const before = session.people;
      session.people = people;
      session.events.push(sessionEvent("people_changed", now, { actor_label: actor, device_label: device, people, table_codes: [...session.table_codes] }));
      bump(session);
      logAction(state, { action: "table_session.people", entity: "table_session", id: session.id, summary: `Corrigiu as pessoas da mesa ${session.table_codes.join("+") || "balcão"}`, at: now, changes: { people: { from: before, to: people } } });
      save();
      return HttpResponse.json(projectSession(session));
    });
  }),

  http.post(`${API}/staff/floor/sessions/:id/move`, async ({ request, params }) => {
    const body = await readBody(request);
    return respond(() => {
      const { state, date, now, actor, device } = context();
      return once(request, state, () => {
        const { session, error } = openSessionFor(state, params.id);
        if (error) return error;
        const codes = Array.isArray(body.table_codes) ? body.table_codes : [];
        if (!codes.length) return invalid("table_codes", "Escolha a mesa nova.");
        if (sessionOn(state, date, codes, session.id)) return tableTaken();
        const at = occurredAt(body, now, date);
        if (at.error) return at.error;
        const before = session.table_codes.join("+");
        session.table_codes = [...codes];
        session.area_code = null;
        session.events.push(sessionEvent("moved", at, { actor_label: actor, device_label: device, table_codes: [...codes], people: session.people }));
        bump(session);
        const reservation = state.reservations.find((r) => r.id === session.reservation_id);
        logAction(state, { action: "table_session.move", entity: "table_session", id: session.id, summary: `Trocou ${reservation?.code || "a mesa"}: ${before} → ${codes.join("+")}`, at, changes: { table_codes: { from: before, to: codes.join("+") } } });
        save();
        return HttpResponse.json(projectSession(session));
      });
    });
  }),

  http.post(`${API}/staff/floor/sessions/:id/merge`, async ({ request, params }) => {
    const body = await readBody(request);
    return respond(() => {
      const { state, now, actor, device } = context();
      return once(request, state, () => {
        const { session, error } = openSessionFor(state, params.id);
        if (error) return error;
        const other = state.table_sessions.find((s) => s.id === body.session_id && s.status === "open" && !s.undone);
        if (!other || other.id === session.id) return changed();
        const before = session.table_codes.join("+");
        session.table_codes = [...session.table_codes, ...other.table_codes];
        session.people += other.people;
        Object.assign(other, { status: "closed", merged_into: session.id, released_at: now.toISOString() });
        other.events.push(sessionEvent("merged", now, { actor_label: actor, device_label: device, table_codes: [...session.table_codes], people: session.people }));
        session.events.push(sessionEvent("merged", now, { actor_label: actor, device_label: device, table_codes: [...session.table_codes], people: session.people }));
        bump(session);
        bump(other);
        logAction(state, { action: "table_session.merge", entity: "table_session", id: session.id, summary: `Juntou as mesas ${session.table_codes.join("+")}`, at: now, changes: { table_codes: { from: before, to: session.table_codes.join("+") } } });
        save();
        return HttpResponse.json(projectSession(session));
      });
    });
  }),

  http.post(`${API}/staff/floor/sessions/:id/split`, async ({ request, params }) => {
    const body = await readBody(request);
    return respond(() => {
      const { state, now, actor, device } = context();
      return once(request, state, () => {
        const { session, error } = openSessionFor(state, params.id);
        if (error) return error;
        const codes = (Array.isArray(body.table_codes) ? body.table_codes : []).filter((c) => session.table_codes.includes(c));
        if (!codes.length || codes.length >= session.table_codes.length) return invalid("table_codes", "Escolha a mesa que sai, deixando pelo menos uma.");
        const people = Number(body.people);
        if (!Number.isInteger(people) || people < 1 || people >= session.people) return invalid("people", `Entre 1 e ${session.people - 1} pessoas vão junto.`);
        const reservation = state.reservations.find((r) => r.id === session.reservation_id);
        const before = session.table_codes.join("+");
        session.table_codes = session.table_codes.filter((c) => !codes.includes(c));
        session.people -= people;
        const fresh = newSession(state, reservation, { tables: codes, people, seatedAt: now, actor, device });
        fresh.ends_at = session.ends_at;
        fresh.events = [sessionEvent("split", now, { actor_label: actor, device_label: device, table_codes: [...codes], people })];
        session.events.push(sessionEvent("split", now, { actor_label: actor, device_label: device, table_codes: [...session.table_codes], people: session.people }));
        bump(session);
        logAction(state, { action: "table_session.split", entity: "table_session", id: session.id, summary: `Separou ${codes.join("+")} de ${before}`, at: now, changes: { table_codes: { from: before, to: `${session.table_codes.join("+")} e ${codes.join("+")}` } } });
        save();
        return HttpResponse.json({ session: projectSession(session), new_session: projectSession(fresh) });
      });
    });
  }),

  http.post(`${API}/staff/floor/sessions/:id/release`, async ({ request, params }) => {
    const body = await readBody(request);
    return respond(() => {
      const { state, date, now, role, actor, device } = context();
      return once(request, state, () => {
        const closed = closedNightGuard(state, date, role, body);
        if (closed) return closed;
        const { session, error } = openSessionFor(state, params.id);
        if (error) return error;
        const at = occurredAt(body, now, date);
        if (at.error) return at.error;
        Object.assign(session, { status: "closed", released_at: at.toISOString(), release_hint: false });
        session.events.push(sessionEvent("released", at, { actor_label: actor, device_label: device, table_codes: [...session.table_codes], people: session.people }));
        bump(session);
        const reservation = state.reservations.find((r) => r.id === session.reservation_id);
        if (reservation) reservation.left_at = at.toISOString();
        // a mesa liberada vai na hora para a lista de espera (7.16)
        placeFreed(state, { date, table_codes: [...session.table_codes], reason: "release" }, now);
        logAction(state, {
          action: "table_session.release",
          entity: "table_session",
          id: session.id,
          summary: `Mesa ${session.table_codes.join("+") || "balcão"} liberada${body.from_paper ? " (lançado do papel)" : ""}`,
          at,
          changes: { status: { from: "open", to: "closed" } },
        });
        save();
        return HttpResponse.json(projectSession(session));
      });
    });
  }),

  // Desfazer uma liberação pelo aviso de 7 s (história 6.5).
  http.post(`${API}/staff/floor/sessions/:id/reopen`, async ({ request, params }) => {
    const body = await readBody(request);
    return respond(() => {
      const { state, date, now, role, actor, device } = context();
      const closed = closedNightGuard(state, date, role, body);
      if (closed) return closed;
      const session = state.table_sessions.find((s) => s.id === params.id && !s.undone);
      if (!session || session.status !== "closed" || session.merged_into) return changed();
      if (sessionOn(state, date, session.table_codes, session.id)) return tableTaken();
      Object.assign(session, { status: "open", released_at: null });
      session.events.push(sessionEvent("undone", now, { actor_label: actor, device_label: device, table_codes: [...session.table_codes], people: session.people }));
      bump(session);
      const reservation = state.reservations.find((r) => r.id === session.reservation_id);
      if (reservation) reservation.left_at = null;
      logAction(state, { action: "table_session.reopen", entity: "table_session", id: session.id, summary: `Desfez a liberação da mesa ${session.table_codes.join("+")}`, at: now, changes: { status: { from: "closed", to: "open" } } });
      save();
      return HttpResponse.json(projectSession(session));
    });
  }),

  http.post(`${API}/staff/floor/sessions/:id/extend`, async ({ request, params }) => {
    const body = await readBody(request);
    return respond(() => {
      const { state, date, now, actor, device } = context();
      return once(request, state, () => {
        const { session, error } = openSessionFor(state, params.id);
        if (error) return error;
        const newEnd = new Date(new Date(session.ends_at || now).getTime() + 10 * MIN);
        const next = nextBooking(state, date, session.table_codes, now);
        if (next && new Date(next.starts_at) < newEnd) return changed(`Tem reserva às ${next.time} nessa mesa. Não dá para somar mais 10 minutos.`);
        const before = session.ends_at;
        session.ends_at = newEnd.toISOString();
        session.extended_min = (session.extended_min || 0) + 10;
        session.release_hint = false;
        session.events.push(sessionEvent("extended", occurredAt(body, now), { actor_label: actor, device_label: device, table_codes: [...session.table_codes], people: session.people }));
        bump(session);
        logAction(state, { action: "table_session.extend", entity: "table_session", id: session.id, summary: `+10 min de mesa na ${session.table_codes.join("+")}, até ${time(newEnd)}`, at: now, changes: { ends_at: { from: before ? time(before) : "—", to: time(newEnd) } } });
        save();
        return HttpResponse.json(projectSession(session));
      });
    });
  }),

  // A folha da noite e a foto sem conexão: telefones mascarados, nenhum texto de saúde. Com ?since= ela
  // também diz o que mudou depois de uma folha impressa naquela hora (a folha curta de mudanças).
  http.get(`${API}/staff/night/snapshot`, ({ request }) =>
    respond((scenario) => {
      const { state, date, now, role } = context();
      const day = resolveDay(state, date);
      const sheet = (r) => ({ ...project(state, r, role), notes: "", internal_notes: "" });
      const empty = scenario === "vazio";
      const since = new URL(request.url).searchParams.get("since") || nightsOf(state)[date]?.sheet_printed_at || null;
      const reservations = empty ? [] : state.reservations.filter((r) => r.date === date && ["confirmed", "pending", "completed", "no_show"].includes(r.status) && r.source !== "walk_in");
      return HttpResponse.json({
        server_time: now.toISOString(),
        date,
        day: { ...day, layout: day.layout ? { ...day.layout } : null },
        // os nomes das áreas da casa, para a planta na folha (história 3.13)
        areas: [...state.areas].sort((x, y) => x.sort - y.sort).map((x) => ({ key: x.key, name: x.name })),
        reservations: reservations.sort((a, b) => a.time.localeCompare(b.time)).map(sheet),
        waitlist: empty ? [] : waitlistOf(state, date).map(sheet),
        sessions: empty ? [] : nightSessions(state, date).map(projectSession),
        sheet_printed_at: nightsOf(state)[date]?.sheet_printed_at ?? null,
        changes: empty ? [] : changesSince(state, date, since),
        purge_before: date,
      });
    }),
  ),

  // A folha foi para o papel (história 6.10); isso encerra o alerta de "imprimir"
  // e começa a contar as mudanças a partir dela.
  http.post(`${API}/staff/night/sheet`, async ({ request }) => {
    const body = await readBody(request);
    return respond(() => {
      const { state, date, now } = context();
      const meta = (nightsOf(state)[date] ??= {});
      if (body.kind !== "changes") meta.sheet_printed_at = now.toISOString();
      else meta.changes_printed_at = now.toISOString();
      logAction(state, { action: "night.sheet_printed", entity: "night", id: date, summary: body.kind === "changes" ? "Imprimiu só as mudanças desde a folha" : "Imprimiu a folha da noite", at: now });
      save();
      return HttpResponse.json({ date, sheet_printed_at: meta.sheet_printed_at ?? null, changes_printed_at: meta.changes_printed_at ?? null });
    });
  }),

  // Adiar o fechamento da noite em 1 h, uma vez por noite (dono e gerente).
  http.post(`${API}/staff/night/postpone`, () =>
    respond(() => {
      const { state, date, now, role } = context();
      if (!MANAGEMENT.has(role)) return problem(403, "forbidden", "Só o dono ou o gerente adiam o fechamento");
      const meta = (nightsOf(state)[date] ??= {});
      if (meta.postponed) return problem(409, "conflict", "O fechamento já foi adiado nesta noite", { detail: "Dá para adiar uma vez por noite." });
      if (meta.closed_at) return nightClosed();
      meta.postponed = true;
      logAction(state, { action: "night.postpone", entity: "night", id: date, summary: `Adiou o fechamento da noite para ${time(nightCloseAt(state, date))}`, at: now });
      save();
      return HttpResponse.json({ date, close_at: nightCloseAt(state, date).toISOString() });
    }),
  ),

  // Fechar uma noite que não fechou (o alerta "night_not_closed").
  http.post(`${API}/staff/night/close`, async ({ request }) => {
    const body = await readBody(request);
    return respond(() => {
      const { state, now, role } = context();
      if (!MANAGEMENT.has(role)) return problem(403, "forbidden", "Só o dono ou o gerente fecham a noite");
      const date = String(body.date || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return invalid("date", "Diga qual noite.");
      const at = nightCloseAt(state, date) || now;
      const meta = closeNight(state, date, at < now ? at : now, { by: "user" });
      logAction(state, { action: "night.close_by_hand", entity: "night", id: date, summary: `Fechou à mão a noite de ${date.slice(8, 10)}/${date.slice(5, 7)}`, at: now });
      save();
      return HttpResponse.json(meta);
    });
  }),

  // Notas do papel que a recepção não conseguiu lançar depois de a noite
  // fechar vão para o dono e o gerente como correções (história 6.13).
  http.post(`${API}/staff/night/corrections`, async ({ request }) => {
    const body = await readBody(request);
    return respond(() => {
      const { state, date, now, actor } = context();
      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length) return invalid("items", "Nada para mandar.");
      state.corrections ??= [];
      const made = items.map((item) => ({
        id: uuid(),
        date: item.date || date,
        kind: item.kind,
        reservation_id: item.reservation_id ?? null,
        table_codes: item.table_codes ?? [],
        people: item.people ?? null,
        occurred_at: item.occurred_at,
        label: String(item.label || "").slice(0, 120),
        sent_by: actor,
        sent_at: now.toISOString(),
        status: "open",
      }));
      state.corrections.push(...made);
      logAction(state, { action: "night.correction_request", entity: "night", id: date, summary: `Mandou ${made.length} ${made.length === 1 ? "anotação do papel" : "anotações do papel"} para o dono ou o gerente corrigir`, at: now });
      save();
      return HttpResponse.json(made, { status: 201 });
    });
  }),

  http.post(`${API}/staff/night/corrections/:id/:verb`, ({ params }) =>
    respond(() => {
      const { state, now, role } = context();
      if (!MANAGEMENT.has(role)) return problem(403, "forbidden", "Só o dono ou o gerente corrigem a noite");
      const item = (state.corrections || []).find((c) => c.id === params.id);
      if (!item) return problem(404, "not_found", "Essa correção não está mais aqui");
      if (item.status !== "open") return changed("Essa correção já foi tratada.");
      if (params.verb === "dismiss") {
        item.status = "dismissed";
      } else if (params.verb === "apply") {
        const r = item.reservation_id && state.reservations.find((x) => x.id === item.reservation_id);
        if (item.kind === "check_in" && r) {
          // um "Não veio" automático sai sem contar, mesmo depois da janela de desfazer
          if (r.status === "no_show") {
            const c = state.customers.find((x) => x.id === r.customer_id);
            if (c && r.no_show_counted !== false) c.no_shows = Math.max(0, (c.no_shows || 0) - 1);
            logAction(state, { action: "reservation.undo_no_show", id: r.id, summary: `Desfez o "Não veio" de ${r.code}: lançado do papel`, at: now, changes: { status: { from: "no_show", to: "completed" } } });
          }
          Object.assign(r, { status: "completed", no_show_counted: false, no_show_at: null, arrived_at: item.occurred_at, arrived_people: item.people ?? r.party_size, checked_in_by: item.sent_by });
          r.history ??= [];
          r.history.push({ at: now.toISOString(), actor_label: userOf(state, role)?.name || "Equipe", action: "check_in", summary: `Chegou às ${time(item.occurred_at)} (lançado do papel)` });
        }
        item.status = "applied";
      } else return problem(404, "not_found", "Não achamos isso");
      item.resolved_at = now.toISOString();
      logAction(state, { action: `night.correction_${item.status}`, entity: "night", id: item.date, summary: `${item.status === "applied" ? "Aplicou" : "Dispensou"} a correção do papel: ${item.label}`, at: now });
      save();
      return HttpResponse.json(item);
    }),
  ),

  // Além do contrato: a exportação da porta do evento (história 6.8), só o dono; a lista da porta
  // sem telefones, em CSV.
  http.post(`${API}/staff/events/:id/guests/export`, async ({ params }) => {
    return respond(() => {
      const { state, now, role } = context();
      if (role !== "owner") return problem(403, "forbidden", "Só o dono exporta a lista do evento");
      const reauth = reauthRequired();
      if (reauth) return reauth;
      const event = (state.events || []).find((e) => e.id === params.id);
      if (!event) return problem(404, "not_found", "Esse evento não existe mais");
      const guests = state.reservations.filter((r) => r.date === event.date && (r.event_id === event.id || event.published) && ["pending", "confirmed", "offered", "completed"].includes(r.status));
      const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const rows = guests.map((r) => [state.customers.find((c) => c.id === r.customer_id)?.name?.split(" ")[0] || r.walk_in_name || "", r.party_size, r.time, r.arrived_at ? time(r.arrived_at) : ""].map(cell).join(";"));
      logAction(state, { action: "event.guests_export", entity: "event", id: event.id, summary: `Exportou a lista da porta de ${event.title} (${guests.length} nomes)`, at: now, changes: { file: { secret: true } } });
      save();
      return new HttpResponse(`\uFEFF${["nome;pessoas;horario;chegada", ...rows].join("\r\n")}\r\n`, {
        status: 200,
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="lista-${event.date}.csv"` },
      });
    });
  }),
];

export { time as clockTime };
