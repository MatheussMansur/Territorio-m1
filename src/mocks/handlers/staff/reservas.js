// Reservas: a lista com filtros, a gaveta com a linha do tempo, a reserva feita pela própria equipe, toda
// ação do domínio (aprovar, recusar, remarcar, mudar mesas, cancelar, não veio…), as mensagens
// prontas da recepção, a exportação e as mesas livres de um horário. A recepção só
// vê esta noite, com o primeiro nome, o telefone mascarado e nenhum detalhe alimentar (AR-24).
// As funções de exibição no fim são usadas também pelo painel do dia (hoje.js).
import { http, HttpResponse } from "msw";
import { addDays, houseParts, toMinutes } from "../../../lib/dates.js";
import { maskPhone, toE164 } from "../../../lib/phone.js";
import { uuid } from "../../../lib/uuid.js";
import { durationFor, freeOptions, resolveDay } from "../../availability.js";
import PERMISSIONS from "../../../admin/permissoes.json" with { type: "json" };
import { getState, save } from "../../db.js";
import { currentRole, mockNow, problem, respond } from "../../scenario.js";
import { clockTime, closedNightGuard, context, correctionPending, isNightClosed, reauthRequired, lastNotified, logAction, markToldLate, placeFreed, rulesOf, toldLate, toleranceEnd, whatsappState } from "./salao.js";

const API = "/api/v1";
const MIN = 60_000;
const MANAGEMENT = new Set(["owner", "manager"]);
export const HOLDS_PLACE = new Set(["pending", "confirmed", "offered"]);
const STATUSES = ["pending", "confirmed", "waitlisted", "offered", "declined", "expired", "canceled", "completed", "no_show"];
const SOURCES = ["site", "staff", "whatsapp", "phone", "walk_in"];
const TEMPLATES = ["table_waiting", "table_ready", "running_late"];

const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || "") && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
const isTime = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value || "");
// uma rota antes desta (espera.js) pode já ter lido o corpo: lê uma cópia
const readJson = (request) => request.clone().json().catch(() => ({}));
const invalid = (errors, title = "Confira os campos") => problem(422, "validation", title, { errors });
const forbidden = (detail) => problem(403, "forbidden", "Sem permissão", detail ? { detail } : {});
const notFound = () => problem(404, "not_found", "Isso não está mais aqui");
const fold = (s) => String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const startOf = (date, time) => new Date(`${date}T${time}:00-03:00`);

export const roleNow = () => currentRole() || "owner";
export const todayOf = (now = mockNow()) => houseParts(now).date;

export function actorLabel(state) {
  const role = roleNow();
  return state.users.find((u) => u.role === role && u.status === "active")?.name || "Equipe";
}

/** Uma linha do registro de ações, no formato do Registro (veja logAction em salao.js). */
export function addAudit(state, action, r, summary, changes = {}) {
  logAction(state, { action, entity: "reservation", id: r?.id ?? null, summary, changes, role: roleNow() });
}

function addHistory(state, r, action, summary, actor = actorLabel(state)) {
  r.history ??= [];
  r.history.push({ at: mockNow().toISOString(), actor_label: actor, action, summary });
}

function queueMessage(r, template, status = "sent") {
  r.messages ??= [];
  const message = { id: uuid(), template, status, sent_at: mockNow().toISOString() };
  r.messages.push(message);
  return message;
}

// ---- a visão da equipe ---------------------------------------------------------------------------

const customerOf = (state, r) => state.customers.find((c) => c.id === r.customer_id) || null;
// o primeiro nome; um grupo que sentou sem reserva e sem nome fica "Sem nome"
const firstName = (name) => {
  const full = String(name || "").trim();
  return /^sem( nome\b.*)?$/i.test(full) ? "Sem nome" : full.split(/\s+/)[0] || "";
};

export function nameOf(state, r) {
  return customerOf(state, r)?.name || r.walk_in_name || (r.source === "walk_in" ? "Sem nome (balcão)" : "Cliente");
}

function phoneOf(state, r) {
  return customerOf(state, r)?.phone_e164 || r.walk_in_phone || null;
}

function phoneVerified(state, r) {
  if (typeof r.phone_verified === "boolean") return r.phone_verified;
  const c = customerOf(state, r);
  return Boolean(c?.phone_e164 && c.phone_verified_at);
}

/** Uma reserva como o ReservationStaff do contrato, recortada para a recepção. */
export function staffView(state, r, role = roleNow()) {
  const c = customerOf(state, r);
  const phone = phoneOf(state, r);
  const floor = role === "floor";
  const name = nameOf(state, r);
  const dietary = (r.flags || []).includes("dietary");
  return {
    id: r.id,
    code: r.code,
    date: r.date,
    time: r.time,
    party_size: r.party_size,
    status: r.status,
    source: r.source,
    customer: {
      id: c?.id ?? null,
      name: floor ? firstName(name) : name,
      phone_masked: phone ? maskPhone(phone) : "",
      visits: c?.visits ?? 0,
      no_shows: c?.no_shows ?? 0,
    },
    table_codes: [...(r.table_codes || [])],
    area_key: r.area_key ?? null,
    event_id: r.event_id ?? null,
    area_preference: r.area_preference ?? null,
    customer_confirmation: r.customer_confirmation || "not_sent",
    // a recepção vê que há uma restrição, nunca qual é
    notes: floor && dietary ? "" : r.notes || "",
    internal_notes: floor ? "" : r.internal_notes || "",
    flags: [...(r.flags || [])],
    // a tolerância é a da casa, lida ao vivo das configurações (+ os minutos extras que ela ganhou)
    tolerance_min: rulesOf(state).tolerance_min,
    extra_tolerance_min: r.extra_tolerance_min ?? 0,
    tolerance_until: r.starts_at ? toleranceEnd(state, r).toISOString() : null,
    customer_late: toldLate(r),
    customer_arriving_at: r.customer_arriving_at ?? null,
    no_whatsapp: (r.flags || []).includes("no_whatsapp"),
    call_answer: r.call_answer ?? null,
    lost_table_codes: r.lost_table_codes ?? [],
    last_notified: lastNotified(r),
    no_show_auto: Boolean(r.no_show_auto),
    no_show_at: r.no_show_at ?? null,
    checked_in_by: floor ? null : (r.checked_in_by ?? null),
    arrived_at: r.arrived_at ?? null,
    seated_at: r.seated_at ?? null,
    left_at: r.left_at ?? null,
    waitlist_position: r.waitlist_position ?? null,
    offer_expires_at: r.offer_expires_at ?? null,
    pending_until: r.pending_until ?? null,
    starts_at: r.starts_at,
    ends_at: r.ends_at,
    duration_min: r.duration_min ?? 120,
    arrived_people: r.arrived_people ?? null,
    canceled_by: r.canceled_by ?? null,
    cancel_reason: r.cancel_reason ?? null,
    decline_reason: r.decline_reason ?? null,
    terms_version: r.terms_version ?? null,
    phone_verified: phoneVerified(state, r),
    locale: r.locale || "pt",
    table_session_id: r.table_session_id ?? null,
    no_show_counted: r.no_show_counted !== false,
    version: String(r.version ?? 1),
    created_by: r.created_by ?? null,
    created_at: r.created_at,
  };
}

const SOURCE_LABEL = { site: "pelo site", staff: "pela equipe", whatsapp: "pelo WhatsApp", phone: "por telefone", walk_in: "no balcão" };

/** A linha do tempo: o que a equipe fez (guardado) mais o que os próprios campos da reserva contam. */
function timeline(state, r) {
  const kept = [...(r.history || [])];
  const has = (action) => kept.some((h) => h.action === action);
  const items = [...kept];
  if (!has("created")) {
    items.push({ at: r.created_at, actor_label: r.source === "site" ? "Cliente" : "Equipe", action: "created", summary: `Reserva feita ${SOURCE_LABEL[r.source] || ""}`.trim() });
  }
  if (r.customer_confirmation === "yes" && !has("customer_yes")) {
    items.push({ at: r.confirmed_by_customer_at || r.created_at, actor_label: "Cliente", action: "customer_yes", summary: "Respondeu SIM ao lembrete" });
  }
  if (r.arrived_at && !has("check_in")) items.push({ at: r.arrived_at, actor_label: "Salão", action: "check_in", summary: "Chegou" });
  if (r.left_at && !has("left")) items.push({ at: r.left_at, actor_label: "Salão", action: "left", summary: "Mesa liberada" });
  if (r.status === "no_show" && !has("no_show")) {
    items.push({ at: r.no_show_at || r.ends_at, actor_label: "Sistema", action: "no_show", summary: "Marcada como não veio" });
  }
  if (r.status === "canceled" && !has("cancel")) {
    const who = { customer: "Cliente", staff: "Equipe", system: "Sistema" }[r.canceled_by] || "Equipe";
    items.push({ at: r.canceled_at || r.updated_at || r.created_at, actor_label: who, action: "cancel", summary: `Cancelada${r.cancel_reason ? `: ${r.cancel_reason}` : ""}` });
  }
  return items.filter((h) => h.at).sort((a, b) => b.at.localeCompare(a.at));
}

export function detailView(state, r, role = roleNow()) {
  return {
    ...staffView(state, r, role),
    history: timeline(state, r),
    messages: (r.messages || []).map(({ template, status, sent_at }) => ({ template, status, sent_at })),
    undo_no_show_until: r.status === "no_show" ? new Date(new Date(r.no_show_at || r.ends_at).getTime() + rulesOf(state).undo_no_show_hours * 3_600_000).toISOString() : null,
    whatsapp: whatsappState(state),
    undo_check_in_until: r.status === "completed" && r.arrived_at && r.source !== "walk_in" ? new Date(new Date(r.arrived_at).getTime() + rulesOf(state).undo_check_in_min * MIN).toISOString() : null,
    night_closed: isNightClosed(state, r.date),
    undo_no_show_hours: rulesOf(state).undo_no_show_hours,
  };
}

// ---- mesas -----------------------------------------------------------------------------------------

function busyAt(state, date, time, duration, ignoreId) {
  const start = toMinutes(time);
  const end = start + duration;
  const busy = new Set();
  for (const r of state.reservations) {
    if (r.id === ignoreId || r.date !== date || !(HOLDS_PLACE.has(r.status) || (r.status === "completed" && !r.left_at)) || !r.table_codes?.length) continue;
    const rs = toMinutes(r.time);
    if (rs < end && start < rs + (r.duration_min || 120)) r.table_codes.forEach((code) => busy.add(code));
  }
  return busy;
}

function staffOptions(state, date, time, partySize, ignoreId = null) {
  const day = resolveDay(state, date);
  if (!day.open) return [];
  const areaOf = new Map(day.layout.tables.map((t) => [t.code, t.area]));
  return freeOptions(state, day, time, partySize, { ignoreId, online: false }).map((o) => ({
    table_codes: o.codes,
    area_key: areaOf.get(o.codes[0]) || null,
    seats: o.seats,
    held: o.codes.some((code) => day.held_tables.includes(code)),
  }));
}

/** Se estas mesas existem naquela noite, acomodam o grupo e estão livres naquele horário. */
function checkTables(state, r, date, time, codes) {
  const day = resolveDay(state, date);
  const tables = new Map(day.layout.tables.map((t) => [t.code, t]));
  if (!codes.length || !codes.every((code) => tables.has(code))) return "unknown";
  const seats = codes.reduce((n, code) => n + tables.get(code).max_seats, 0);
  if (seats < r.party_size) return "small";
  const busy = busyAt(state, date, time, r.duration_min || 120, r.id);
  return codes.some((code) => busy.has(code)) ? "taken" : null;
}

const tableTaken = () => problem(409, "conflict", "Essa mesa acabou de ser ocupada", { detail: "Outra reserva usa essa mesa nesse horário. Escolha outra.", reason: "table_taken" });
const slotFull = (detail = "Esse horário está cheio. Escolha outro horário.") => problem(409, "slot_full", "Esse horário está cheio", { detail });

// ---- a lista ---------------------------------------------------------------------------------------

function matches(state, r, q) {
  if (!q) return true;
  const needle = fold(q).trim();
  if (!needle) return true;
  const digits = needle.replace(/\D/g, "");
  if (fold(nameOf(state, r)).includes(needle)) return true;
  if (fold(r.code).includes(needle) || fold(r.code).replace("tr-", "") === needle) return true;
  const phone = phoneOf(state, r);
  return digits.length >= 3 && digits.length === needle.replace(/\s/g, "").length && Boolean(phone?.endsWith(digits));
}

function listFor(state, url, role, scenario) {
  if (scenario === "vazio") return [];
  const today = todayOf();
  let from = url.searchParams.get("from");
  let to = url.searchParams.get("to");
  if (role === "floor") from = to = today; // a recepção vê só esta noite
  const statuses = (url.searchParams.get("status") || "").split(",").filter((s) => STATUSES.includes(s));
  const source = url.searchParams.get("source");
  const q = url.searchParams.get("q");
  const withoutTable = url.searchParams.get("without_table") === "true";
  return state.reservations
    .filter((r) => (!from || r.date >= from) && (!to || r.date <= to))
    .filter((r) => !statuses.length || statuses.includes(r.status))
    .filter((r) => !SOURCES.includes(source) || r.source === source)
    .filter((r) => !withoutTable || (HOLDS_PLACE.has(r.status) && !r.table_codes?.length))
    .filter((r) => matches(state, r, q))
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.code.localeCompare(b.code));
}

function find(state, id) {
  return state.reservations.find((r) => r.id === id) || null;
}

/** A recepção abre só as reservas desta noite. */
function outOfReach(r, role) {
  return role === "floor" && r.date !== todayOf();
}

// ---- ações -----------------------------------------------------------------------------------------
// "Chegou", desfazer, "+10 min" e "Não veio" são respondidos primeiro pela rota do salão
// (espera.js), que abre e fecha a sessão da mesa; toda outra ação cai aqui.

// quem pode fazer cada ação vem do arquivo de permissões (reservation.<action>, história 5.5);
// a guarda de permissões já recusou os outros, esta é a mesma regra perto da ação
const ACTION_ROLES = PERMISSIONS.operations["POST /staff/reservations/{id}/actions"]?.actions || {};
const actionRoles = (action) => new Set(ACTION_ROLES[action] || []);
const RULES = {
  approve: { from: ["pending"], roles: actionRoles("approve") },
  decline: { from: ["pending"], roles: actionRoles("decline") },
  confirm: { from: ["waitlisted", "offered"], roles: actionRoles("confirm") },
  reschedule: { from: ["pending", "confirmed", "waitlisted", "offered"], roles: actionRoles("reschedule") },
  move_tables: { from: ["pending", "confirmed", "offered"], roles: actionRoles("move_tables") },
  cancel: { from: ["pending", "confirmed", "waitlisted", "offered"], roles: actionRoles("cancel") },
  release: { from: ["confirmed"], roles: actionRoles("release") },
  undo_no_show: { from: ["no_show"], roles: actionRoles("undo_no_show") },
  forgive_no_show: { from: ["no_show"], roles: actionRoles("forgive_no_show") },
  resend_confirmation: { from: ["pending", "confirmed"], roles: actionRoles("resend_confirmation") },
  note: { from: STATUSES, roles: actionRoles("note") },
  // a ligação da história 5.19: "Confirmou", "Vai atrasar" ou "Não vai mais", por telefone
  call_answer: { from: ["confirmed"], roles: actionRoles("call_answer") },
};

const STATUS_WORD = {
  pending: "pendente", confirmed: "confirmada", waitlisted: "na espera", offered: "com mesa oferecida", declined: "recusada",
  expired: "vencida", canceled: "cancelada", completed: "concluída", no_show: "marcada como não veio",
};

function invalidTransition(state, r) {
  let detail = `A reserva está ${STATUS_WORD[r.status] || r.status}. A tela foi atualizada; confira e escolha de novo.`;
  if (r.status === "canceled" && r.canceled_by === "customer") {
    const at = r.canceled_at ? houseParts(r.canceled_at).time : null;
    detail = `O cliente cancelou${at ? ` às ${at}` : ""}. A tela foi atualizada.`;
    return problem(409, "invalid_transition", "Não dá para fazer isso agora", { detail, reason: "customer_canceled", time: at });
  }
  return problem(409, "invalid_transition", "Não dá para fazer isso agora", { detail });
}

function moveTo(r, date, time) {
  const starts = startOf(date, time);
  r.date = date;
  r.time = time;
  r.starts_at = starts.toISOString();
  r.ends_at = new Date(starts.getTime() + (r.duration_min || 120) * MIN).toISOString();
}

function touch(r) {
  r.version = (Number(r.version) || 1) + 1;
  r.updated_at = mockNow().toISOString();
}

/** Faz uma ação; devolve uma resposta de problema, ou null quando a reserva mudou. */
function runAction(state, r, body, role) {
  const now = mockNow();
  const rule = RULES[body.action];
  if (!rule) return invalid([{ field: "action", message: "Ação desconhecida." }]);
  if (!rule.roles.has(role)) return forbidden("Essa ação é do dono ou do gerente.");
  if (!rule.from.includes(r.status)) return invalidTransition(state, r);
  const reason = String(body.reason || "").trim();
  const name = firstName(nameOf(state, r));
  // uma noite que já fechou só é corrigida por dono ou gerente, com um motivo (6.14);
  // as ações que já pedem um motivo usam ele
  if (CORRECTIONS.has(body.action)) {
    const closed = closedNightGuard(state, r.date, role, { correction_reason: body.correction_reason || (WITH_REASON.has(body.action) ? reason : "") }, r);
    if (closed) return closed;
  }
  const failure = applyAction(state, r, body, role, { now, reason, name });
  if (!failure && correctionPending()) addAudit(state, `reservation.${body.action}`, r, `Corrigiu a reserva ${r.code} de ${name} depois do fechamento`);
  return failure;
}

const CORRECTIONS = new Set(["approve", "decline", "confirm", "reschedule", "move_tables", "cancel", "release", "undo_no_show", "forgive_no_show", "call_answer"]);
const WITH_REASON = new Set(["decline", "cancel", "undo_no_show", "forgive_no_show"]);

function applyAction(state, r, body, role, { now, reason, name }) {
  switch (body.action) {
    case "approve": {
      const codes = body.table_codes?.length ? body.table_codes : r.table_codes?.length ? r.table_codes : staffOptions(state, r.date, r.time, r.party_size, r.id)[0]?.table_codes || [];
      if (codes.length) {
        const problemCode = checkTables(state, r, r.date, r.time, codes);
        if (problemCode === "taken") return tableTaken();
        if (problemCode) return invalid([{ field: "table_codes", message: "Essa mesa não serve para o grupo." }]);
      }
      Object.assign(r, { status: "confirmed", table_codes: codes, area_key: areaOfCode(state, r.date, codes[0]) ?? r.area_key, pending_until: null });
      addHistory(state, r, "approved", `Aprovada${codes.length ? ` com a mesa ${codes.join(" + ")}` : ""}`);
      if (phoneVerified(state, r)) queueMessage(r, "approved");
      addAudit(state, "reservation.approve", r, `Aprovou a reserva ${r.code} de ${name}`);
      break;
    }
    case "decline": {
      if (!reason) return invalid([{ field: "reason", message: "Escolha o motivo." }]);
      Object.assign(r, { status: "declined", decline_reason: reason, pending_until: null, table_codes: [] });
      addHistory(state, r, "declined", `Recusada: ${reason}`);
      if (phoneVerified(state, r)) queueMessage(r, "declined");
      addAudit(state, "reservation.decline", r, `Recusou a reserva ${r.code} de ${name}: ${reason}`);
      break;
    }
    case "confirm": {
      const codes = body.table_codes?.length ? body.table_codes : r.table_codes?.length ? r.table_codes : staffOptions(state, r.date, r.time, r.party_size, r.id)[0]?.table_codes;
      if (!codes?.length) return slotFull("Não há mesa livre para esse grupo nesse horário.");
      if (checkTables(state, r, r.date, r.time, codes) === "taken") return tableTaken();
      Object.assign(r, { status: "confirmed", table_codes: codes, area_key: areaOfCode(state, r.date, codes[0]), waitlist_position: null, offer_expires_at: null });
      addHistory(state, r, "confirmed", `Virou reserva na mesa ${codes.join(" + ")}`);
      if (phoneVerified(state, r)) queueMessage(r, "booking_receipt");
      break;
    }
    case "reschedule": {
      const date = body.date || r.date;
      const time = body.time;
      if (!isDate(date) || !isTime(time)) return invalid([{ field: "time", message: "Escolha o dia e o horário." }]);
      if (role === "floor" && r.date < todayOf(now)) return problem(409, "night_closed", "A noite já fechou");
      if (role === "floor" && date !== r.date) return forbidden("A recepção remarca só no mesmo dia.");
      if (date < todayOf(now)) return invalid([{ field: "date", message: "Esse dia já passou." }]);
      const day = resolveDay(state, date);
      if (!day.open) return slotFull(`A casa não abre nesse dia (${day.reason_label || "fechado"}).`);
      let codes = r.table_codes?.length && !checkTables(state, r, date, time, r.table_codes) ? r.table_codes : null;
      if (!codes && HOLDS_PLACE.has(r.status)) codes = staffOptions(state, date, time, r.party_size, r.id)[0]?.table_codes || null;
      if (!codes && HOLDS_PLACE.has(r.status)) return slotFull();
      const before = `${r.date} ${r.time}`;
      moveTo(r, date, time);
      if (codes) Object.assign(r, { table_codes: codes, area_key: areaOfCode(state, date, codes[0]) });
      addHistory(state, r, "rescheduled", `Remarcada de ${formatShort(before)} para ${formatShort(`${date} ${time}`)}${codes ? ` · mesa ${codes.join(" + ")}` : ""}`);
      if (body.notify_customer && phoneVerified(state, r)) queueMessage(r, "rescheduled");
      addAudit(state, "reservation.reschedule", r, `Remarcou ${r.code} de ${name}`);
      break;
    }
    case "move_tables": {
      const codes = Array.isArray(body.table_codes) ? body.table_codes : [];
      const check = checkTables(state, r, r.date, r.time, codes);
      if (check === "taken") return tableTaken();
      if (check) return invalid([{ field: "table_codes", message: check === "small" ? "Essa mesa não cabe o grupo." : "Escolha uma mesa da planta do dia." }]);
      const before = (r.table_codes || []).join(" + ") || "sem mesa";
      Object.assign(r, { table_codes: codes, area_key: areaOfCode(state, r.date, codes[0]) });
      addHistory(state, r, "move_tables", `Mesa trocada: ${before} → ${codes.join(" + ")}`);
      addAudit(state, "reservation.move_tables", r, `Trocou a mesa de ${r.code}: ${before} → ${codes.join(" + ")}`);
      break;
    }
    case "cancel": {
      if (!reason) return invalid([{ field: "reason", message: "Escolha o motivo." }]);
      if (role === "floor" && (r.date < todayOf(now) || isNightClosed(state, r.date))) return problem(409, "night_closed", "A noite já fechou");
      const before = r.status;
      const freed = [...(r.table_codes || [])];
      Object.assign(r, { status: "canceled", canceled_by: "staff", cancel_reason: reason, canceled_at: now.toISOString(), table_codes: [], waitlist_position: null });
      addHistory(state, r, "cancel", `Cancelada pela casa: ${reason}${body.notify_customer ? " · cliente avisado" : ""}`);
      if (body.notify_customer && phoneVerified(state, r) && !(r.flags || []).includes("no_whatsapp")) queueMessage(r, "canceled");
      // o lugar vai para a lista de espera daquele horário, uma vez (a oferta automática vem na 7.16)
      freeSlot(state, r, freed, "cancel");
      addAudit(state, "reservation.cancel", r, `Cancelou ${r.code} de ${name}: ${reason}`, { status: { from: before, to: "canceled" } });
      break;
    }
    case "release": {
      Object.assign(r, { status: "canceled", canceled_by: "staff", cancel_reason: "Mesa liberada antes de sentar", canceled_at: now.toISOString(), table_codes: [], no_show_counted: false });
      addHistory(state, r, "release", "Mesa liberada antes de sentar (sem contar falta)");
      break;
    }
    case "undo_no_show":
    case "forgive_no_show": {
      if (!reason) return invalid([{ field: "reason", message: "Escreva o motivo." }]);
      const at = new Date(r.no_show_at || r.ends_at).getTime();
      const hours = rulesOf(state).undo_no_show_hours;
      if (body.action === "undo_no_show" && now.getTime() - at > hours * 3_600_000) {
        return problem(409, "undo_window_closed", "Passou o prazo de desfazer", { detail: `O "Não veio" só se desfaz em até ${hours} h. Para tirar a falta da conta, perdoe a falta na ficha do cliente.`, minutes: hours * 60, hours, reason: "no_show" });
      }
      const c = customerOf(state, r);
      if (c && r.no_show_counted !== false) c.no_shows = Math.max(0, (c.no_shows || 0) - 1);
      if (body.action === "undo_no_show") Object.assign(r, { status: "confirmed", no_show_at: null, no_show_counted: true });
      else r.no_show_counted = false;
      addHistory(state, r, body.action, `${body.action === "undo_no_show" ? "\"Não veio\" desfeito" : "Falta perdoada"}: ${reason}`);
      addAudit(state, `reservation.${body.action}`, r, `${body.action === "undo_no_show" ? "Desfez o \"Não veio\"" : "Perdoou a falta"} de ${r.code}: ${reason}`);
      break;
    }
    case "resend_confirmation": {
      if (!phoneVerified(state, r) || (r.flags || []).includes("no_whatsapp")) return problem(409, "needs_whatsapp", "Esse cliente não tem WhatsApp confirmado", { detail: "A mensagem não sai. Para avisar, o dono ou o gerente liga para ele." });
      for (const m of r.messages || []) if (m.status === "failed") m.status = "expired";
      queueMessage(r, r.status === "pending" ? "booking_receipt" : "reminder");
      if (r.customer_confirmation === "no_reply" || r.customer_confirmation === "not_sent") r.customer_confirmation = "sent";
      addHistory(state, r, "resend_confirmation", "Confirmação reenviada pelo WhatsApp");
      addAudit(state, "reservation.resend_confirmation", r, `Reenviou a confirmação de ${r.code} a ${name}`);
      break;
    }
    case "call_answer": {
      const answer = body.answer;
      if (!["yes", "late", "no"].includes(answer)) return invalid([{ field: "answer", message: "Diga o que o cliente respondeu." }]);
      const by = "por ligação";
      if (answer === "yes") {
        Object.assign(r, { customer_confirmation: "yes", confirmed_by_customer_at: now.toISOString(), call_answer: "yes" });
        addHistory(state, r, "customer_yes", `Confirmou ${by}`);
      } else if (answer === "late") {
        // uma regra só com o botão do lembrete: o extra é somado uma vez, seja quem avisou primeiro
        const added = markToldLate(state, r, now);
        r.call_answer = "late";
        addHistory(state, r, "customer_late", added
          ? `Vai atrasar, avisou ${by}: a mesa espera até ${clockTime(toleranceEnd(state, r))}`
          : `Vai atrasar, disse de novo ${by}: já tinha avisado, a mesa segue esperando até ${clockTime(toleranceEnd(state, r))}`);
      } else {
        const freed = [...(r.table_codes || [])];
        Object.assign(r, { status: "canceled", canceled_by: "customer", cancel_reason: `Não vai mais (${by})`, canceled_at: now.toISOString(), table_codes: [], call_answer: "no" });
        addHistory(state, r, "cancel", `Não vai mais, avisou ${by}`);
        freeSlot(state, r, freed, "cancel");
      }
      const said = { yes: "confirmou", late: "vai atrasar", no: "não vai mais" }[answer];
      addAudit(state, "reservation.call_answer", r, `Ligou para ${name} (${r.code}): ${said} ${by}`, { customer_confirmation: { from: null, to: said } });
      break;
    }
    case "note": {
      r.internal_notes = String(body.internal_notes ?? "").slice(0, 500);
      addHistory(state, r, "note", "Nota interna atualizada");
      break;
    }
  }
  touch(r);
  return null;
}

/** O lugar que um cancelamento liberou vai para a lista de espera daquele horário, uma vez por reserva. */
function freeSlot(state, r, codes, reason) {
  placeFreed(state, { date: r.date, time: r.time, reservation_id: r.id, table_codes: codes, party_size: r.party_size, reason });
}

function areaOfCode(state, date, code) {
  if (!code) return null;
  return resolveDay(state, date).layout.tables.find((t) => t.code === code)?.area ?? null;
}

function formatShort(stamp) {
  const [date, time] = stamp.split(" ");
  return `${date.slice(8, 10)}/${date.slice(5, 7)} ${time}`;
}

// ---- a reserva feita pela própria equipe -----------------------------------------------------------

function findOrAddCustomer(state, name, phone) {
  if (phone) {
    const known = state.customers.find((c) => c.phone_e164 === phone && !c.anonymized_at);
    if (known) return known;
  }
  // a API guarda quem reserva por telefone como cliente; o número fica sem verificar até um código
  const c = {
    id: uuid(), name, phone_e164: phone, phone_verified_at: null, visits: 0, no_shows: 0, last_visit_at: null, tags: [],
    internal_notes: "", blocked: false, marketing_opt_in: false, privacy_version: state.privacy?.privacy_version || null, anonymized_at: null,
  };
  state.customers.push(c);
  return c;
}

let seq = 7300;

function createReservation(state, body, role) {
  const now = mockNow();
  const errors = [];
  const party = Number(body.party_size);
  const name = String(body.name || "").trim().replace(/\s+/g, " ");
  if (!Number.isInteger(party) || party < 1 || party > 40) errors.push({ field: "party_size", message: "Informe de 1 a 40 pessoas." });
  if (!isDate(body.date)) errors.push({ field: "date", message: "Escolha o dia." });
  else if (body.date < todayOf(now)) errors.push({ field: "date", message: "Esse dia já passou." });
  if (!isTime(body.time)) errors.push({ field: "time", message: "Escolha o horário." });
  if (name.length < 2) errors.push({ field: "name", message: "Escreva o nome de quem reserva." });
  if (!["staff", "phone", "whatsapp", "walk_in"].includes(body.source)) errors.push({ field: "source", message: "Escolha por onde chegou o pedido." });
  const phone = body.phone ? toE164(body.phone) : null;
  if (body.phone && !phone) errors.push({ field: "phone", message: "Confira o número: tem que ser um celular com WhatsApp." });
  if (errors.length) return { error: invalid(errors) };

  const day = resolveDay(state, body.date);
  if (!day.open) return { error: slotFull(`A casa não abre nesse dia (${day.reason_label || "fechado"}).`) };
  const override = String(body.override_reason || "").trim();
  if (override && !MANAGEMENT.has(role)) return { error: forbidden("Só o dono ou o gerente passam do limite.") };

  // a mesma pessoa duas vezes naquele horário, ou mais reservas ativas do que a casa permite
  if (phone && !body.waitlist) {
    const known = state.customers.find((c) => c.phone_e164 === phone && !c.anonymized_at);
    const active = known ? state.reservations.filter((x) => x.customer_id === known.id && ["pending", "confirmed", "waitlisted", "offered"].includes(x.status) && x.date >= todayOf(now)) : [];
    const brief = (x) => ({ id: x.id, code: x.code, date: x.date, time: x.time, party_size: x.party_size, status: x.status });
    const same = active.find((x) => x.date === body.date && x.time === body.time);
    if (same) {
      return { error: problem(409, "duplicate_reservation", "Já tem reserva nesse horário", { detail: `${firstName(known.name)} já tem a ${same.code} nesse dia e horário.`, existing: [brief(same)] }) };
    }
    const limit = state.settings?.booking?.data?.max_active_per_phone ?? state.booking?.max_active_per_phone ?? 2;
    if (limit && active.length >= limit) {
      return { error: problem(409, "active_limit", "Essa pessoa já tem reservas demais", { detail: `${firstName(known.name)} já tem ${active.length} reservas ativas. Remarque ou cancele uma delas.`, existing: active.map(brief) }) };
    }
  }
  const noWhatsapp = body.no_whatsapp === true;

  let status = "confirmed";
  let codes = Array.isArray(body.table_codes) ? body.table_codes : [];
  const draft = { id: null, party_size: party, duration_min: durationFor(state, day, party) };
  if (body.waitlist) {
    status = "waitlisted";
    codes = [];
  } else if (codes.length) {
    const check = checkTables(state, draft, body.date, body.time, codes);
    if (check === "taken" && !override) return { error: tableTaken() };
    if (check && check !== "taken") return { error: invalid([{ field: "table_codes", message: "Essa mesa não serve para o grupo." }]) };
  } else {
    codes = staffOptions(state, body.date, body.time, party)[0]?.table_codes || [];
    if (!codes.length && !override) return { error: slotFull() };
  }

  const customer = findOrAddCustomer(state, name, phone);
  const starts = startOf(body.date, body.time);
  seq += 13;
  const r = {
    id: uuid(),
    code: `TR-${seq}`,
    customer_id: customer.id,
    party_size: party,
    date: body.date,
    time: body.time,
    starts_at: starts.toISOString(),
    ends_at: new Date(starts.getTime() + draft.duration_min * MIN).toISOString(),
    duration_min: draft.duration_min,
    area_preference: body.area_key || null,
    area_key: codes.length ? areaOfCode(state, body.date, codes[0]) : body.area_key || null,
    table_codes: codes,
    status,
    source: body.source,
    customer_confirmation: "not_sent",
    tolerance_min: rulesOf(state).tolerance_min,
    extra_tolerance_min: 0,
    arrived_at: null,
    seated_at: null,
    left_at: null,
    notes: String(body.notes || "").slice(0, 280),
    internal_notes: String(body.internal_notes || "").slice(0, 500),
    flags: [...(Array.isArray(body.flags) ? body.flags.filter((f) => ["birthday", "high_chair", "accessibility", "dietary"].includes(f)) : []), ...(noWhatsapp ? ["no_whatsapp"] : [])],
    event_id: body.event_id || null,
    waitlist_position: status === "waitlisted" ? state.reservations.filter((x) => x.date === body.date && x.time === body.time && x.status === "waitlisted").length + 1 : null,
    offer_expires_at: null,
    pending_until: null,
    canceled_by: null,
    cancel_reason: null,
    decline_reason: null,
    // como a reserva de um cliente: o prazo de cancelamento e os combinados do momento em que foi feita (AR-29)
    cancel_until_hours: state.booking.cancel_until_hours ?? 2,
    terms_version: state.terms?.version ?? null,
    locale: ["pt", "es", "en"].includes(body.locale) ? body.locale : "pt",
    phone_verified: noWhatsapp ? false : Boolean(customer.phone_verified_at),
    created_by: state.users.find((u) => u.role === role)?.id ?? null,
    created_at: now.toISOString(),
    history: [],
    messages: [],
    version: 1,
  };
  addHistory(state, r, "created", `Reserva lançada ${SOURCE_LABEL[body.source]}${status === "waitlisted" ? " · na lista de espera" : ""}${noWhatsapp ? " · sem WhatsApp, confirmar por ligação" : ""}`);
  if (override) {
    addHistory(state, r, "override", `Passou do limite: ${override}`);
    addAudit(state, "reservation.override", r, `Passou do limite em ${r.code}: ${override}`);
  }
  // o comprovante sai por WhatsApp (um número digitado pela equipe ainda não é verificado); um
  // cliente sem WhatsApp não recebe mensagem nenhuma, a casa liga (história 5.19)
  if (phone && !noWhatsapp) queueMessage(r, "booking_receipt", "sent");
  state.reservations.push(r);
  addAudit(state, "reservation.create", r, `Lançou a reserva ${r.code} de ${firstName(name)} ${SOURCE_LABEL[body.source]}`);
  return { reservation: r, warnings: noWhatsapp || !phone ? ["needs_whatsapp"] : [] };
}

// ---- exportação ------------------------------------------------------------------------------------

const csvCell = (value) => {
  const s = String(value ?? "");
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function exportCsv(state, items) {
  const head = ["codigo", "dia", "hora", "nome", "pessoas", "mesa", "canal", "status", "telefone"];
  const rows = items.map((r) => [r.code, r.date, r.time, nameOf(state, r), r.party_size, (r.table_codes || []).join("+"), r.source, r.status, maskPhone(phoneOf(state, r) || "")]);
  // nenhum dado de saúde no arquivo: notas e marcações ficam de fora
  return "﻿" + [head, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n");
}

// ---- rotas -----------------------------------------------------------------------------------------

export const handlers = [
  http.get(`${API}/staff/reservations`, ({ request }) =>
    respond((scenario) => {
      const state = getState(mockNow());
      const role = roleNow();
      const url = new URL(request.url);
      const all = listFor(state, url, role, scenario);
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
      const offset = Math.max(0, Number(url.searchParams.get("cursor")) || 0);
      const items = all.slice(offset, offset + limit).map((r) => staffView(state, r, role));
      // as regras e o relógio do salão: a lista mantém "Desfazer" enquanto dura a janela de desfazer
      return HttpResponse.json({ items, next_cursor: offset + limit < all.length ? String(offset + limit) : null, rules: rulesOf(state), night_time: context().now.toISOString() });
    }),
  ),

  http.post(`${API}/staff/reservations/export`, async ({ request }) => {
    const body = await readJson(request);
    return respond((scenario) => {
      const state = getState(mockNow());
      const role = roleNow();
      if (role !== "owner") return forbidden("Só o dono exporta as reservas.");
      const reauth = reauthRequired();
      if (reauth) return reauth;
      const url = new URL(request.url);
      if (body.from) url.searchParams.set("from", body.from);
      if (body.to) url.searchParams.set("to", body.to);
      // os mesmos filtros da lista na tela (5.11): situação, canal e busca
      const status = Array.isArray(body.status) ? body.status.join(",") : body.status;
      if (status) url.searchParams.set("status", status);
      if (body.source) url.searchParams.set("source", body.source);
      if (body.q) url.searchParams.set("q", body.q);
      const items = listFor(state, url, role, scenario);
      const filtered = [status && "status", body.source && "canal", body.q && "busca"].filter(Boolean);
      addAudit(state, "reservations.export", null, `Exportou ${items.length} reservas (${body.from || "início"} a ${body.to || "hoje"}${filtered.length ? `, filtro por ${filtered.join(", ")}` : ""})`);
      save();
      return new HttpResponse(exportCsv(state, items), {
        status: 200,
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="reservas-${body.from || "todas"}.csv"` },
      });
    });
  }),

  http.post(`${API}/staff/reservations`, async ({ request }) => {
    const body = await readJson(request);
    const key = request.headers.get("Idempotency-Key");
    return respond(() => {
      const state = getState(mockNow());
      const role = roleNow();
      state.idempotency ??= {};
      const seen = key && state.idempotency[`staff-create:${key}`];
      if (seen) {
        const r = find(state, seen);
        if (r) return HttpResponse.json(staffView(state, r, role), { status: 201 });
      }
      const { error, reservation, warnings } = createReservation(state, body, role);
      if (error) return error;
      if (key) state.idempotency[`staff-create:${key}`] = reservation.id;
      save();
      return HttpResponse.json({ ...staffView(state, reservation, role), warnings }, { status: 201 });
    });
  }),

  http.get(`${API}/staff/reservations/:id`, ({ params }) =>
    respond(() => {
      const state = getState(mockNow());
      const role = roleNow();
      const r = find(state, params.id);
      if (!r) return notFound();
      if (outOfReach(r, role)) return forbidden("A recepção vê só as reservas de hoje.");
      // o relógio do salão (a demonstração faz a noite fora do horário de serviço), para as janelas da gaveta
      return HttpResponse.json({ ...detailView(state, r, role), night_time: context().now.toISOString() });
    }),
  ),

  http.post(`${API}/staff/reservations/:id/actions`, async ({ params, request }) => {
    const body = await readJson(request);
    const key = request.headers.get("Idempotency-Key");
    return respond(() => {
      const state = getState(mockNow());
      const role = roleNow();
      const r = find(state, params.id);
      if (!r) return notFound();
      if (outOfReach(r, role)) return forbidden("A recepção vê só as reservas de hoje.");
      state.idempotency ??= {};
      const memo = key ? `staff-action:${key}` : null;
      if (memo && state.idempotency[memo]) {
        if (state.idempotency[memo] !== JSON.stringify(body)) {
          return problem(422, "validation", "Esse pedido já tinha sido enviado", { detail: "Recarregue a página e confira como ficou antes de mandar de novo.", reason: "idempotency" });
        }
        return HttpResponse.json(staffView(state, r, role));
      }
      const failure = runAction(state, r, body || {}, role);
      if (failure) return failure;
      if (memo) state.idempotency[memo] = JSON.stringify(body);
      save();
      return HttpResponse.json(staffView(state, r, role));
    });
  }),

  http.post(`${API}/staff/reservations/:id/notify`, async ({ params, request }) => {
    const body = await readJson(request);
    return respond(() => {
      const state = getState(mockNow());
      const role = roleNow();
      const r = find(state, params.id);
      if (!r) return notFound();
      if (outOfReach(r, role)) return forbidden("A recepção vê só as reservas de hoje.");
      if (!TEMPLATES.includes(body.template)) return invalid([{ field: "template", message: "Escolha uma mensagem pronta." }]);
      if (!phoneVerified(state, r) || (r.flags || []).includes("no_whatsapp")) return problem(409, "needs_whatsapp", "Esse cliente não tem WhatsApp confirmado", { detail: "A mensagem não sai. Chame o dono ou o gerente para ligar para ele." });
      if (whatsappState(state) === "down") return problem(503, "whatsapp_down", "O WhatsApp da casa está fora", { detail: "Fale com o cliente na porta." });
      const now = mockNow();
      const last = (r.messages || []).filter((m) => m.template === body.template).at(-1);
      if (last && !body.repeat && now - new Date(last.sent_at) < 10 * MIN) {
        return problem(409, "conflict", "Essa mensagem já foi", { reason: "recently_sent", sent_at: last.sent_at, detail: `Você já mandou essa às ${clockTime(last.sent_at)}.` });
      }
      const message = queueMessage(r, body.template, "sending");
      const words = { table_waiting: "Sua mesa está te esperando", table_ready: "Sua mesa está pronta", running_late: "Estamos com atraso de alguns minutos" };
      addHistory(state, r, "notify", `Mensagem pronta: "${words[body.template]}"`);
      addAudit(state, "reservation.notify", r, `Mandou "${words[body.template]}" para ${firstName(nameOf(state, r))} (${r.code})`);
      save();
      return HttpResponse.json({ message_id: message.id, template: body.template, status: "sending", sent_at: message.sent_at }, { status: 202 });
    });
  }),

  http.get(`${API}/staff/availability`, ({ request }) =>
    respond((scenario) => {
      const url = new URL(request.url);
      const date = url.searchParams.get("date");
      const time = url.searchParams.get("time");
      const party = Number(url.searchParams.get("party_size"));
      const errors = [];
      if (!isDate(date)) errors.push({ field: "date", message: "Informe o dia." });
      if (!isTime(time)) errors.push({ field: "time", message: "Informe o horário." });
      if (!Number.isInteger(party) || party < 1 || party > 40) errors.push({ field: "party_size", message: "Informe as pessoas." });
      if (errors.length) return invalid(errors);
      if (scenario === "vazio") return HttpResponse.json([]);
      const state = getState(mockNow());
      return HttpResponse.json(staffOptions(state, date, time, party, url.searchParams.get("ignore_reservation")));
    }),
  ),
];

/** Dias em volta de uma data, para a faixa da semana do painel do dia. */
export const nextDays = (date, n) => Array.from({ length: n }, (_, i) => addDays(date, i));
