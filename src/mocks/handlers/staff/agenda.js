// Agenda: o mês, o plano de uma data e várias datas de uma vez. Toda mudança que mexe numa
// noite com reservas passa pela mesma simulação (quem fica com a mesa, quem muda,
// quem fica sem) antes de ser gravada. As funções de apoio no fim são usadas também pelas
// plantas (plantas.js) e pelos eventos (eventos.js), que mudam noites do mesmo jeito.
import { http, HttpResponse } from "msw";
import { addDays, daysBetween, houseParts, toMinutes, weekdayOf } from "../../../lib/dates.js";
import { applyDayPlan, freeOptions, planDayChange, resolveDay } from "../../availability.js";
import { session } from "../../../lib/storage.js";
import { uuid } from "../../../lib/uuid.js";
import { getState, save } from "../../db.js";
import { currentRole, mockNow, problem, respond } from "../../scenario.js";
import { placeFreed } from "./salao.js";

const API = "/api/v1";
export const ACTIVE = new Set(["pending", "confirmed", "offered"]);
const clone = (value) => JSON.parse(JSON.stringify(value));
const sum = (list, pick) => list.reduce((total, x) => total + pick(x), 0);

export const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || "") && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
export const readJson = (request) => request.json().catch(() => ({}));
export const invalid = (errors, title = "Confira os campos") => problem(422, "validation", title, { errors });

/** A noite da casa: antes das 05:00 ainda é a de ontem. */
export const nightOf = (now) => houseParts(new Date(now.getTime() - 5 * 3_600_000)).date;

export function staffName(state) {
  const role = currentRole() || "owner";
  return state.users.find((u) => u.role === role)?.name || "Equipe";
}

const SUMMARY = {
  "day_plan.set": "Mudou o plano do dia",
  "day_plan.reset": "Voltou o dia à semana padrão",
  "area.update": "Mudou a área",
  "layout.create": "Criou a planta",
  "layout.update": "Mudou a planta",
  "layout.archive": "Arquivou a planta",
  "layout.duplicate": "Duplicou a planta",
  "event.create": "Criou o evento",
  "event.update": "Mudou o evento",
  "event.publish": "Publicou o evento",
  "event.unpublish": "Despublicou o evento",
  "event.delete": "Removeu o evento",
  "event.duplicate": "Duplicou o evento",
  "event.guest_add": "Pôs um nome na lista do evento",
  "event.guest_remove": "Tirou um nome da lista do evento",
  "event.door_entry": "Marcou uma entrada na porta do evento",
  "reservation.check_in": "Marcou a chegada",
  "reservation.undo_check_in": "Desfez a chegada",
};
const IGNORED = new Set(["version", "updated_at", "updated_by", "replaced_plan"]);
const shown = (value) => (value == null || typeof value !== "object" ? (value ?? null) : JSON.stringify(value));

/** O antes e o depois de cada campo que mudou, do jeito que o registro de ações mostra. */
function changesOf(before, after) {
  if ((before && typeof before !== "object") || (after && typeof after !== "object")) return {};
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const out = {};
  for (const key of keys) {
    if (IGNORED.has(key)) continue;
    const from = before?.[key];
    const to = after?.[key];
    if (JSON.stringify(from) !== JSON.stringify(to)) out[key] = { from: shown(from), to: shown(to) };
  }
  return out;
}

/** Uma entrada do registro de ações (o formato que o Registro lê): quem, quando, o quê e o antes e depois. */
export function audit(state, action, target, before, after, resolutions = []) {
  const role = currentRole() || "owner";
  const user = state.users.find((u) => u.role === role);
  const changes = changesOf(before, after);
  for (const r of resolutions) {
    const reservation = state.reservations.find((x) => x.id === r.reservation_id);
    const what = { cancel: "cancelada avisando", keep: "mantida com observação", reschedule: `remarcada${r.time ? ` para ${r.time}` : ""}${r.table_codes?.length ? ` na mesa ${r.table_codes.join(" + ")}` : ""}` }[r.action];
    if (what) changes[`caso ${reservation?.code || r.reservation_id}`] = { from: "sem mesa", to: what };
  }
  state.audit = [
    ...(state.audit || []),
    {
      id: uuid(),
      occurred_at: mockNow().toISOString(),
      actor_type: "user",
      actor_id: user?.id ?? null,
      actor_label: user?.name || "Equipe",
      device_label: "Acesso pessoal",
      action,
      entity_type: action.split(".")[0],
      entity_id: typeof target === "string" ? target : null,
      summary: `${SUMMARY[action] || action}: ${target}`,
      changes,
    },
  ].slice(-500);
}

// ---- a versão lida (If-Match) e o "alguém gravou antes" da demonstração (?conflito=1) ---------

const CONFLICT_KEY = "territorio:mock-conflito-agenda";

/** A versão que a tela leu: o cabeçalho If-Match ou ?if_match= (client.js manda o cabeçalho; o parâmetro ainda é aceito). */
export function ifMatchOf(request) {
  const raw = request.headers.get("If-Match") ?? new URL(request.url).searchParams.get("if_match");
  return raw == null ? null : String(raw).replace(/"/g, "");
}

/** ?conflito=1 na página faz o próximo salvamento encontrar antes o salvamento de outra pessoa (uma vez por aba). */
export function otherSavesFirst() {
  if (new URLSearchParams(window.location.search).get("conflito") === "1" && !session.get(`${CONFLICT_KEY}:usado`)) {
    session.set(CONFLICT_KEY, true);
    session.set(`${CONFLICT_KEY}:usado`, true);
  }
  if (!session.get(CONFLICT_KEY)) return false;
  session.remove(CONFLICT_KEY);
  return true;
}

const NETWORK_KEY = "territorio:mock-rede";

/**
 * A conexão perdida da demonstração (?rede=caiu, ?rede=ok desfaz): as leituras da Agenda, das
 * plantas e dos eventos falham como numa rede caída, para a cópia só de leitura aparecer.
 */
export function networkDown() {
  const asked = new URLSearchParams(window.location.search).get("rede");
  if (asked) session.set(NETWORK_KEY, asked === "caiu");
  return session.get(NETWORK_KEY) === true;
}

/** O nome de outra pessoa, para "{name} gravou antes de você". */
export const otherPerson = (state) => state.users.find((u) => u.role === (currentRole() === "manager" ? "owner" : "manager"))?.name || "Outra pessoa";

/** 412 precondition_failed com o que está gravado agora, para a tela oferecer juntar ou descartar. */
export const preconditionFailed = (by, current) =>
  problem(412, "precondition_failed", `${by} gravou antes de você`, { detail: "Veja o que mudou e escolha juntar com as suas mudanças ou descartar as suas.", current });

/** Lugares de uma noite resolvida: mesas nas áreas que sentam por mesa, mais a lista. */
export function seatsOf(day) {
  if (!day.open) return 0;
  const mode = new Map(day.areas.map((a) => [a.key, a.mode]));
  return sum(day.layout.tables.filter((t) => mode.get(t.area) === "tables"), (t) => t.max_seats) + (day.list_capacity || 0);
}

const customerName = (state, r) => state.customers.find((c) => c.id === r.customer_id)?.name || "";

/** Uma reserva no formato da equipe (ReservationStaff), com o telefone mascarado. */
export function staffReservation(state, r) {
  const c = state.customers.find((x) => x.id === r.customer_id);
  const phone = c?.phone_e164 || "";
  // o que só o cliente ou a simulação guardam não sai para a equipe (vale o contrato ReservationStaff)
  return {
    ...r,
    version: r.version == null ? r.version : String(r.version),
    history: undefined,
    idempotency_key: undefined,
    messages: undefined,
    terms_accepted_at: undefined,
    public_token: undefined,
    customer: c ? { id: c.id, name: c.name, phone_masked: phone ? `(${phone.slice(3, 5)}) •••••-${phone.slice(-4)}` : "", visits: c.visits, no_shows: c.no_shows } : null,
  };
}

// ---- simulação usada por planos, plantas e eventos -------------------------------------------

/** Cancela primeiro (libera mesas antes de a noite ser sentada de novo). */
function cancelCases(state, resolutions = []) {
  for (const res of resolutions.filter((x) => x.action === "cancel")) {
    const r = state.reservations.find((x) => x.id === res.reservation_id);
    if (!r || !ACTIVE.has(r.status)) continue;
    Object.assign(r, { status: "canceled", canceled_by: "staff", cancel_reason: res.note || "Mudança no plano do dia", table_codes: [] });
  }
}

/** Depois que a noite é sentada de novo: outro horário com mesa livre, ou mantida com uma nota. */
function settleCases(state, resolutions = []) {
  for (const res of resolutions) {
    const r = state.reservations.find((x) => x.id === res.reservation_id);
    if (!r || !ACTIVE.has(r.status)) continue;
    if (res.action === "keep") {
      r.internal_notes = [r.internal_notes, res.note || "Mantida sem mesa: a casa resolve na noite."].filter(Boolean).join(" · ");
    } else if (res.action === "reschedule" && (res.time || res.table_codes?.length)) {
      // outro horário, outra mesa, ou os dois: a escolha da equipe vale mais que a sugestão
      const day = resolveDay(state, r.date);
      const time = res.time || r.time;
      r.time = time;
      const starts = new Date(`${r.date}T${time}:00-03:00`);
      r.starts_at = starts.toISOString();
      r.ends_at = new Date(starts.getTime() + (r.duration_min || 120) * 60_000).toISOString();
      const chosen = res.table_codes?.length && res.table_codes.every((c) => day.layout.tables.some((t) => t.code === c)) ? { codes: [...res.table_codes] } : null;
      const option = chosen || freeOptions(state, day, time, r.party_size, { ignoreId: r.id, online: false, duration: r.duration_min || 120 })[0];
      r.table_codes = option ? option.codes : [];
      if (option) r.area_key = day.layout.tables.find((t) => t.code === option.codes[0])?.area || r.area_key;
    }
  }
}

const unresolved = (result, resolutions = []) => {
  const handled = new Set(resolutions.map((x) => x.reservation_id));
  return result.without_table.filter((x) => !handled.has(x.reservation_id));
};

/**
 * O que uma mudança faz com as noites de `dates`. `change(work)` edita uma cópia do estado do
 * jeito que o pedido faria. Responde { results, blocked, open } sem gravar nada.
 */
export function simulateChange(state, dates, change, resolutions = []) {
  const work = clone(state);
  change(work);
  cancelCases(work, resolutions);
  // a lista da própria casa num evento fechado não é deslocada pelo próprio evento
  const houseList = new Set(work.reservations.filter((r) => r.event_id && work.events.some((e) => e.id === r.event_id && e.booking_mode === "private")).map((r) => r.id));
  const outside = (rows) => rows.filter((x) => !houseList.has(x.reservation_id));
  const results = dates.map((date) => {
    const before = resolveDay(state, date);
    const raw = planDayChange(work, date, work.day_plans?.[date] ?? null, state);
    const result = { ...raw, kept: outside(raw.kept), moved: outside(raw.moved), without_table: outside(raw.without_table) };
    const active = work.reservations.filter((r) => r.date === date && ACTIVE.has(r.status) && !houseList.has(r.id)).length;
    const blocked = !result.day.open && active ? "day_has_reservations" : null;
    return { ...result, seats_before: seatsOf(before), applied: false, blocked, waitlist_offers: 0, simulation_hash: `sim-${date}-${active}` };
  });
  const open = results.flatMap((r) => unresolved(r, resolutions));
  // um grupo sentado numa mesa que sai do plano não pode ser decidido aqui
  const seated = results.flatMap((r) => r.seated || []);
  return { results, blocked: results.filter((r) => r.blocked), open, seated };
}

/** Se o salvamento deve parar: dia fechado com reservas, mesas ocupadas ou casos sem decisão. */
export const mustStop = (sim, confirm) => Boolean(sim.blocked.length || sim.seated.length || (sim.open.length && !confirm));

/** Aplica uma mudança de verdade quando nada fica sem decisão. */
export function applyChange(state, dates, change, resolutions = [], now = mockNow()) {
  const previous = clone(state);
  change(state);
  cancelCases(state, resolutions);
  const waiting = new Set(state.reservations.filter((r) => r.status === "waitlisted").map((r) => r.id));
  const results = dates.map((date) => {
    const before = seatsOf(resolveDay(previous, date));
    const result = applyDayPlan(state, date, state.day_plans?.[date] ?? null, { confirmConflicts: true, now, previous });
    return { ...result, seats_before: before };
  });
  settleCases(state, resolutions);
  // o lugar que abriu vai para a lista de espera como num cancelamento do cliente (7.16): a oferta sai por
  // WhatsApp com seu histórico, e o que ainda está livre depois das decisões também é oferecido
  for (const r of state.reservations) {
    if (!waiting.has(r.id) || r.status !== "offered") continue;
    r.messages ??= [];
    r.messages.push({ id: uuid(), template: "waitlist_offer", status: "queued", sent_at: now.toISOString() });
    r.history ??= [];
    r.history.push({ at: now.toISOString(), actor_label: "Sistema", action: "offered", summary: "Mesa oferecida pela lista de espera (mudança no plano do dia)" });
  }
  for (const [i, date] of dates.entries()) {
    const extra = placeFreed(state, { date, reason: "day_plan" }, now);
    results[i].waitlist_offers = (results[i].waitlist_offers || 0) + extra.length;
  }
  return results;
}

/** As respostas 409 do catálogo: um dia fechado com reservas, ou reservas sem mesa. */
export function conflictFor(sim, single = true) {
  if (sim.seated?.length) {
    const body = single ? sim.results.find((r) => r.seated?.length) : { items: sim.results };
    const n = sim.seated.length;
    return problem(409, "conflict", `${n} ${n === 1 ? "mesa sentada sai" : "mesas sentadas saem"} da planta`, {
      code: "unassigned",
      detail: "Espere a mesa liberar ou troque o grupo de mesa no Salão antes de gravar.",
      ...body,
    });
  }
  if (sim.blocked.length) {
    const first = sim.blocked[0];
    const count = first.without_table.length + first.kept.length + first.moved.length;
    const body = single ? first : sim.results;
    return problem(409, "day_has_reservations", `Esse dia tem ${count} reservas ativas`, single ? body : { items: body });
  }
  if (sim.open.length) {
    const body = single ? sim.results[0] : { items: sim.results };
    return problem(409, "conflict", `${sim.open.length} reservas ficariam sem mesa`, { code: "unassigned", ...body });
  }
  return null;
}

/** Datas futuras (da noite de hoje em diante) cuja noite usa esta planta, dentro de dois meses. */
export function datesUsingLayout(state, layoutId, now = mockNow()) {
  const today = nightOf(now);
  const dates = [];
  for (let i = 0; i <= 60; i++) {
    const d = addDays(today, i);
    if (resolveDay(state, d).layout?.id === layoutId) dates.push(d);
  }
  return dates;
}

/** Datas com reservas ativas, onde uma mudança pode mexer em alguém. */
export const withReservations = (state, dates) =>
  dates.filter(
    (d) =>
      state.reservations.some((r) => r.date === d && ACTIVE.has(r.status)) ||
      (state.table_sessions || []).some((s) => s.status === "open" && !s.undone && s.seated_at && nightOf(new Date(s.seated_at)) === d),
  );

// ---- o mês -------------------------------------------------------------------------------

function calendarDay(state, date, today, scenario) {
  const day = resolveDay(state, date);
  const list = scenario === "vazio" ? [] : state.reservations.filter((r) => r.date === date);
  const active = list.filter((r) => ACTIVE.has(r.status) || r.status === "completed");
  const people = sum(active, (r) => r.party_size);
  const seats = seatsOf(day);
  const bySlot = {};
  for (const r of active) bySlot[r.time] = (bySlot[r.time] || 0) + r.party_size;
  const events = scenario === "vazio" ? [] : state.events.filter((e) => e.date === date).map((e) => ({ id: e.id, title: e.title, starts_at: e.starts_at, published: e.published, booking_mode: e.booking_mode }));
  return {
    date,
    open: day.open,
    reason_label: day.reason_label || (day.open ? null : "fechado"),
    layout_name: day.layout?.name || "",
    has_day_plan: Boolean(state.day_plans?.[date]) && scenario !== "vazio",
    reservations: active.length,
    people,
    occupancy_pct: seats ? Math.min(100, Math.round((people / seats) * 100)) : 0,
    waitlist: list.filter((r) => r.status === "waitlisted").length,
    events,
    // além do CalendarDay do contrato: o que a visão da semana mostra
    is_today: date === today,
    is_past: date < today,
    opens_at: day.open ? day.opens_at : null,
    closes_at: day.open ? day.closes_at : null,
    slots: day.open ? day.slots : [],
    people_by_slot: bySlot,
    held_tables: day.held_tables,
    source: day.source,
  };
}

function planOut(state, date) {
  const plan = state.day_plans?.[date];
  return plan ? { date, ...plan } : null;
}

const PLAN_FIELDS = ["open", "closed_reason", "public_label", "opens_at", "closes_at", "slots", "layout_id", "duration_min", "max_covers_per_slot", "max_covers_night", "held_tables", "closed_areas", "party_max_online", "event_id", "internal_note"];

/** O plano como vai ser guardado, conferido como o servidor conferiria. */
function cleanPlan(state, body, date) {
  const errors = [];
  const plan = {};
  for (const key of PLAN_FIELDS) if (body[key] !== undefined) plan[key] = body[key];
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (plan.opens_at && !time.test(plan.opens_at)) errors.push({ field: "opens_at", message: "Use o formato 19:00." });
  if (plan.closes_at && !time.test(plan.closes_at)) errors.push({ field: "closes_at", message: "Use o formato 23:30." });
  if (plan.slots && (!Array.isArray(plan.slots) || plan.slots.some((s) => !time.test(s)))) errors.push({ field: "slots", message: "Escreva os horários assim: 19:00, 19:30." });
  if (plan.public_label != null && typeof plan.public_label !== "object") plan.public_label = { pt: String(plan.public_label), es: "", en: "" };
  if (plan.open === false && !String(plan.public_label?.pt ?? "").trim()) errors.push({ field: "public_label", message: "Diga ao cliente por que a casa fecha (por exemplo, Feriado). O português é obrigatório." });
  if (plan.layout_id && !state.layouts.some((l) => l.id === plan.layout_id && !l.archived)) errors.push({ field: "layout_id", message: "Escolha uma planta da lista." });
  for (const key of ["duration_min", "max_covers_per_slot", "max_covers_night", "party_max_online"]) {
    if (plan[key] != null && !(Number.isInteger(plan[key]) && plan[key] > 0)) errors.push({ field: key, message: "Use um número inteiro maior que zero." });
  }
  if (date && date < nightOf(mockNow())) errors.push({ field: "date", message: "Uma data passada não pode ser editada." });
  plan.updated_by = staffName(state);
  plan.updated_at = new Date().toISOString();
  plan.version = `v${Date.now().toString(36)}`;
  return { plan, errors };
}

/** A versão de uma data como a tela leu: a do plano dela, ou "semana" quando segue a semana. */
const planVersion = (state, date) => state.day_plans?.[date]?.version ?? "semana";

/** A outra pessoa da demonstração: uma nota no plano daquela data, gravada um minuto atrás. */
function otherPersonSavesPlan(state, date) {
  const by = otherPerson(state);
  const current = state.day_plans?.[date];
  state.day_plans = state.day_plans || {};
  state.day_plans[date] = {
    ...(current || {}),
    internal_note: [current?.internal_note, "Conferir o balcão com a cozinha."].filter(Boolean).join(" · "),
    updated_by: by,
    updated_at: new Date(mockNow().getTime() - 60_000).toISOString(),
    version: `v${(Date.now() - 1).toString(36)}`,
  };
  save();
  return by;
}

/** 412 quando a data mudou desde que a tela leu (só uma data; a mudança em lote não tem versão). */
function staleDate(state, date, request) {
  const ifMatch = ifMatchOf(request);
  if (ifMatch == null) return null;
  let by = state.day_plans?.[date]?.updated_by;
  if (otherSavesFirst()) by = otherPersonSavesPlan(state, date);
  if (planVersion(state, date) === ifMatch) return null;
  return preconditionFailed(by || otherPerson(state), { date, version: planVersion(state, date), plan: planOut(state, date) });
}

/** Rotas do plano do dia: uma data ou várias. */
function putPlan(state, dates, body, url, request) {
  const dryRun = url.searchParams.get("dry_run") === "true";
  const resolutions = Array.isArray(body.resolutions) ? body.resolutions : [];
  const single = dates.length === 1 && !Array.isArray(body.dates);
  const { plan, errors } = cleanPlan(state, single ? body : body.plan || {}, dates.find((d) => d < nightOf(mockNow())));
  if (errors.length) return invalid(errors);
  const change = (s) => {
    s.day_plans = s.day_plans || {};
    for (const d of dates) s.day_plans[d] = { ...plan, event_id: s.day_plans[d]?.event_id ?? plan.event_id ?? null };
  };
  if (!dryRun && single && request) {
    const stale = staleDate(state, dates[0], request);
    if (stale) return stale;
  }
  const sim = simulateChange(state, dates, change, resolutions);
  if (dryRun) return HttpResponse.json(single ? sim.results[0] : sim.results);
  if (mustStop(sim, body.confirm_conflicts)) return conflictFor(sim, single);
  const before = dates.map((d) => planOut(state, d));
  const results = applyChange(state, dates, change, resolutions);
  audit(state, "day_plan.set", dates.join(", "), single ? before[0] : { datas: dates.length }, single ? planOut(state, dates[0]) : { datas: dates.length }, resolutions);
  save();
  return HttpResponse.json(single ? results[0] : results);
}

export const handlers = [
  http.get(`${API}/staff/calendar`, ({ request }) =>
    networkDown() ? HttpResponse.error() : respond((scenario) => {
      const month = new URL(request.url).searchParams.get("month");
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || "")) return invalid([{ field: "month", message: "Informe o mês (2026-10)." }]);
      const now = mockNow();
      const state = getState(now);
      const today = nightOf(now);
      const days = [];
      for (let d = `${month}-01`; d.startsWith(month); d = addDays(d, 1)) days.push(calendarDay(state, d, today, scenario));
      return HttpResponse.json(days);
    }),
  ),

  http.get(`${API}/staff/day-plans`, ({ request }) =>
    respond((scenario) => {
      const url = new URL(request.url);
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      if (!isDate(from) || !isDate(to)) return invalid([{ field: "from", message: "Informe o período." }]);
      const state = getState(mockNow());
      if (scenario === "vazio") return HttpResponse.json([]);
      const plans = Object.keys(state.day_plans || {})
        .filter((d) => d >= from && d <= to)
        .sort()
        .map((d) => planOut(state, d));
      return HttpResponse.json(plans);
    }),
  ),

  http.put(`${API}/staff/day-plans`, async ({ request }) => {
    const body = await readJson(request);
    return respond(() => {
      const state = getState(mockNow());
      const dates = [...new Set(Array.isArray(body.dates) ? body.dates : [])].filter(isDate).sort();
      if (!dates.length) return invalid([{ field: "dates", message: "Escolha pelo menos uma data." }]);
      return putPlan(state, dates, body, new URL(request.url));
    });
  }),

  http.get(`${API}/staff/day-plans/:date`, ({ params }) =>
    networkDown() ? HttpResponse.error() : respond(() => {
      const now = mockNow();
      const state = getState(now);
      const date = String(params.date);
      if (!isDate(date)) return problem(404, "not_found", "Essa data não existe");
      const day = resolveDay(state, date);
      const week = state.hours.find((h) => h.weekday === weekdayOf(date));
      const reservations = state.reservations
        .filter((r) => r.date === date && (ACTIVE.has(r.status) || r.status === "completed" || r.status === "waitlisted"))
        .sort((a, b) => toMinutes(a.time) - toMinutes(b.time))
        .map((r) => ({ id: r.id, code: r.code, name: customerName(state, r), time: r.time, party_size: r.party_size, status: r.status, table_codes: r.table_codes, area_key: r.area_key }));
      // além do ResolvedDay do contrato: o plano guardado, a semana padrão e a lista da noite,
      // que a tela do plano mostra ao lado do formulário
      return HttpResponse.json({
        ...day,
        seats: seatsOf(day),
        plan: planOut(state, date),
        week: week ? { ...week } : null,
        reservations,
        is_past: date < nightOf(now),
        days_ahead: daysBetween(nightOf(now), date),
      });
    }),
  ),

  http.put(`${API}/staff/day-plans/:date`, async ({ request, params }) => {
    const body = await readJson(request);
    return respond(() => {
      const state = getState(mockNow());
      const date = String(params.date);
      if (!isDate(date)) return problem(404, "not_found", "Essa data não existe");
      return putPlan(state, [date], body, new URL(request.url), request);
    });
  }),

  // o corpo leva o que a equipe decidiu para cada reserva que ficou sem mesa
  http.delete(`${API}/staff/day-plans/:date`, async ({ request, params }) => {
    const body = await readJson(request);
    return respond(() => {
      const url = new URL(request.url);
      const state = getState(mockNow());
      const date = String(params.date);
      if (!state.day_plans?.[date]) return problem(404, "not_found", "Esse dia já segue a semana padrão");
      if (date < nightOf(mockNow())) return invalid([{ field: "date", message: "Uma data passada não pode ser editada." }]);
      const dryRun = url.searchParams.get("dry_run") === "true";
      if (!dryRun) {
        const stale = staleDate(state, date, request);
        if (stale) return stale;
      }
      const resolutions = Array.isArray(body?.resolutions) ? body.resolutions : [];
      const change = (s) => delete s.day_plans[date];
      const sim = simulateChange(state, [date], change, resolutions);
      if (dryRun) return HttpResponse.json(sim.results[0]);
      if (mustStop(sim, url.searchParams.get("confirm_conflicts") === "true" || body?.confirm_conflicts === true)) return conflictFor(sim);
      const before = planOut(state, date);
      const [result] = applyChange(state, [date], change, resolutions);
      audit(state, "day_plan.reset", date, before, null, resolutions);
      save();
      return HttpResponse.json(result);
    });
  }),
];
