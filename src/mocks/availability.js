// Motor de disponibilidade da simulação. Segue docs/04-regras-reserva.md para as telas terem as
// mesmas respostas que a API real vai dar. Um dia se resolve em três camadas: a semana padrão,
// o plano do dia daquela data e depois o evento. As mesas vêm da planta daquele dia.
import { addDays, daysBetween, houseParts, toMinutes, weekdayOf } from "../lib/dates.js";

const HOLDS_PLACE = new Set(["pending", "confirmed", "offered"]);

/** Uma reserva segura o lugar enquanto espera e também depois que o grupo senta, até a mesa ser liberada. */
const holdsPlace = (state, r) =>
  HOLDS_PLACE.has(r.status) || Boolean(r.table_session_id && state.table_sessions?.some((s) => s.id === r.table_session_id && s.status === "open"));
// Por que um dia não aceita reserva, nas três línguas do site.
const REASONS = {
  production: { pt: "produção", es: "producción", en: "production day" },
  closed: { pt: "fechado", es: "cerrado", en: "closed" },
  event: { pt: "Evento fechado", es: "Evento privado", en: "Private event" },
  holiday: { pt: "feriado", es: "feriado", en: "holiday" },
  maintenance: { pt: "fechado para manutenção", es: "cerrado por mantenimiento", en: "closed for maintenance" },
  outside_window: { pt: "ainda não abriu", es: "todavía no abrió", en: "not open yet" },
  past: { pt: "já passou", es: "ya pasó", en: "already past" },
  no_online_tables: { pt: "reservas só pelo WhatsApp", es: "reservas solo por WhatsApp", en: "bookings by WhatsApp only" },
  free_entry: { pt: "Entrada livre, sem reserva", es: "Entrada libre, sin reserva", en: "Free entry, no booking" },
};
const LANGS = ["pt", "es", "en"];

/** A língua da página (a simulação roda na página); português no node e por padrão. */
export function pageLang() {
  try {
    const lang = String(globalThis.document?.documentElement?.lang || "pt").slice(0, 2).toLowerCase();
    return LANGS.includes(lang) ? lang : "pt";
  } catch {
    return "pt";
  }
}

/**
 * Um texto público em pt, es e en, a partir de um texto simples (dados antigos) ou de um objeto parcial.
 * O português do dono preenche a língua que falta; sem ele, o padrão da casa.
 */
export function localized(value, fallback = null) {
  const own = value && typeof value === "object" ? value : { pt: value ?? "" };
  const pt = String(own.pt ?? "").trim();
  if (!pt) return fallback ? { ...fallback } : null;
  return Object.fromEntries(LANGS.map((l) => [l, String(own[l] ?? "").trim() || pt]));
}

const clone = (value) => JSON.parse(JSON.stringify(value));
const sum = (list, pick) => list.reduce((total, x) => total + pick(x), 0);
const modeOf = (day, key) => day.areas.find((a) => a.key === key)?.mode;
const bySize = (a, b) => a.seats - b.seats || a.priority - b.priority;
const sameCodes = (a, b) => a.length === b.length && a.every((code) => b.includes(code));

function eventSummary(event) {
  if (!event) return null;
  const { id, title, starts_at, booking_mode, party_max, requires_approval, list_capacity, tables_limit } = event;
  return {
    id,
    title,
    starts_at,
    booking_mode,
    party_max: party_max ?? null,
    requires_approval: Boolean(requires_approval),
    list_capacity: list_capacity ?? null,
    tables_limit: booking_mode === "mixed" ? (tables_limit ?? null) : null,
  };
}

/** O dia como vai funcionar: semana padrão + plano do dia + evento. */
export function resolveDay(state, date) {
  const week = state.hours.find((h) => h.weekday === weekdayOf(date)) || { open: false, reason: "closed" };
  let plan = state.day_plans?.[date] || null;
  const linked = plan?.event_id ? state.events.find((e) => e.id === plan.event_id) : null;
  if (linked && !linked.published) plan = null; // o plano de um evento só vale depois que o evento é publicado
  const event = linked?.published ? linked : state.events.find((e) => e.published && e.date === date) || null;

  let open = plan?.open ?? (event ? true : week.open);
  let reason = null;
  let labels = null;
  if (event?.booking_mode === "private") {
    // o motivo que o dono escreveu na ficha do evento, nas três línguas
    open = false;
    reason = "event";
    labels = localized(event.private_label, REASONS.event);
  } else if (plan?.open === false) {
    reason = REASONS[plan.closed_reason] ? plan.closed_reason : "closed";
    labels = localized(plan.public_label, REASONS[reason]);
  } else if (!open) {
    reason = week.reason || "closed";
    // o motivo semanal nas três línguas fica em Configurações › Horários
    const fromSettings = state.settings?.hours?.data?.closed_labels?.find((c) => c.weekday === week.weekday)?.label;
    labels = localized(fromSettings || week.label, REASONS[reason] || REASONS.closed);
  }
  const reasonLabel = labels ? labels[pageLang()] : null;

  const layoutId = plan?.layout_id ?? event?.layout_id ?? week.layout_id;
  const layout = state.layouts.find((l) => l.id === layoutId) || state.layouts[0];
  const closedAreas = new Set(plan?.closed_areas || []);
  const areas = layout.areas.map((a) => ({
    key: a.key,
    mode: closedAreas.has(a.key) ? "closed" : a.mode,
    list_capacity: a.mode === "list" ? a.list_capacity || 0 : null,
    bookable_online: a.bookable_online !== false,
  }));
  const listAreas = areas.filter((a) => a.mode === "list");
  const eventTimes = event ? (event.entry_times?.length ? event.entry_times : [event.starts_at]) : null;

  return {
    date,
    open,
    reason,
    reason_label: reasonLabel,
    reason_labels: labels,
    opens_at: plan?.opens_at ?? week.opens_at ?? event?.starts_at ?? null,
    closes_at: plan?.closes_at ?? week.closes_at ?? event?.ends_at ?? null,
    // o outro turno da semana padrão (2.8); um plano do dia com horário próprio fica só com ele
    second_shift: open && week.open && !plan?.opens_at && !plan?.closes_at ? (week.second_shift ?? null) : null,
    slots: plan?.slots ?? week.slots ?? eventTimes ?? [],
    duration_min: plan?.duration_min ?? null,
    layout,
    areas,
    // o evento pode definir quantas pessoas a lista recebe naquela noite; senão vale a planta
    list_capacity: listAreas.length ? (event?.list_capacity ?? sum(listAreas, (a) => a.list_capacity)) : null,
    // um evento misto também limita as pessoas sentadas nas mesas, fora a lista
    tables_limit: event?.booking_mode === "mixed" && Number.isInteger(event.tables_limit) ? event.tables_limit : null,
    held_tables: plan?.held_tables || [],
    max_covers_per_slot: plan?.max_covers_per_slot ?? null,
    max_covers_night: plan?.max_covers_night ?? null,
    party_max_online: event?.party_max ?? plan?.party_max_online ?? state.booking.party_max_online,
    event: eventSummary(event),
    entry_times: eventTimes,
    source: event ? "event" : plan ? "day_plan" : "week",
  };
}

/** Tempo de mesa de uma reserva nova: o do próprio dia, ou a regra da casa para o tamanho do grupo. */
export function durationFor(state, day, partySize) {
  if (day.duration_min) return day.duration_min;
  const rule = state.booking.duration_rules.find((r) => partySize <= r.party_max);
  return rule ? rule.minutes : 120;
}

function usableTables(day, online) {
  return day.layout.tables.filter((t) => {
    const area = day.areas.find((a) => a.key === t.area);
    if (!area || area.mode !== "tables") return false;
    if (!online) return true;
    return area.bookable_online && t.bookable_online !== false && !day.held_tables.includes(t.code);
  });
}

const comboSeats = (combo, byCode) => combo.max_seats ?? sum(combo.codes, (code) => byCode.get(code).max_seats);

// No site uma mesa só recebe o grupo para o qual foi feita; a equipe pode sentar dois numa de quatro.
function singleOptions(usable, partySize, online) {
  return usable
    .filter((t) => partySize <= t.max_seats && (!online || t.min_seats <= partySize))
    .map((t) => ({ codes: [t.code], seats: t.max_seats, priority: t.priority ?? 1 }))
    .sort(bySize);
}

// Uma junção tem seu próprio mínimo: no site ela só recebe um grupo de pelo menos esse tamanho.
function comboOptions(day, usable, partySize, online = true) {
  const byCode = new Map(usable.map((t) => [t.code, t]));
  return (day.layout.combos || [])
    .filter((c) => c.codes.every((code) => byCode.has(code)))
    .filter((c) => !online || partySize >= (c.min_seats ?? 1))
    .map((c) => ({ codes: [...c.codes], seats: comboSeats(c, byCode), priority: sum(c.codes, (code) => byCode.get(code).priority ?? 1) }))
    .filter((o) => partySize <= o.seats)
    .sort(bySize);
}

/** Mesas da planta do dia que acomodam o grupo sozinhas, da menor para a maior; as junções quando nenhuma acomoda. */
export function tableOptions(day, partySize, { online = true } = {}) {
  const usable = usableTables(day, online);
  const singles = singleOptions(usable, partySize, online);
  return singles.length ? singles : comboOptions(day, usable, partySize, online);
}

function busyCodes(state, date, time, duration, ignoreId) {
  const start = toMinutes(time);
  const end = start + duration;
  const busy = new Set();
  for (const r of state.reservations) {
    if (r.id === ignoreId || r.date !== date || !holdsPlace(state, r) || !r.table_codes?.length) continue;
    const rs = toMinutes(r.time);
    const re = rs + (r.duration_min || 120);
    if (rs < end && start < re) r.table_codes.forEach((code) => busy.add(code));
  }
  return busy;
}

/**
 * Opções livres para um grupo numa data e horário: uma mesa que acomoda o grupo sozinha ou, quando
 * nenhuma delas está livre, uma das junções da planta. `duration` é o tempo de mesa a conferir; as
 * reservas que já existem mantêm o tempo com que foram feitas.
 */
export function freeOptions(state, day, time, partySize, { ignoreId = null, online = true, duration = null } = {}) {
  const busy = busyCodes(state, day.date, time, duration ?? durationFor(state, day, partySize), ignoreId);
  const free = (options) => options.filter((o) => o.codes.every((code) => !busy.has(code)));
  const usable = usableTables(day, online);
  const singles = free(singleOptions(usable, partySize, online));
  return singles.length ? singles : free(comboOptions(day, usable, partySize, online));
}

const covers = (state, date, time = null) =>
  sum(
    state.reservations.filter((r) => r.date === date && holdsPlace(state, r) && (time == null || r.time === time)),
    (r) => r.party_size,
  );

/** Pessoas reservadas em mesas naquela noite (um evento misto limita essas pessoas fora da lista). */
const tableCovers = (state, date) =>
  sum(
    state.reservations.filter((r) => r.date === date && holdsPlace(state, r) && r.table_codes?.length),
    (r) => r.party_size,
  );

/** O que impede as regras do próprio dia de sentar um grupo naquele horário; null quando nada impede. */
function blockedBy(state, day, time, partySize) {
  if (!day.open) return "closed";
  if (partySize > day.party_max_online) return "party_too_large";
  if (day.max_covers_night != null && covers(state, day.date) + partySize > day.max_covers_night) return "night_full";
  if (day.max_covers_per_slot != null && covers(state, day.date, time) + partySize > day.max_covers_per_slot) return "slot_full";
  return null;
}

function slotStarted(date, time, now) {
  const clock = houseParts(now);
  return date < clock.date || (date === clock.date && toMinutes(time) <= clock.minutes);
}

/**
 * Se a lista de espera de um horário ainda aceita alguém: lista de espera do site ligada e a fila
 * daquele horário abaixo do limite da casa (Configurações › Lista de espera, 10 por padrão, FR-61.F).
 * Uma fila cheia transforma o horário em "lotado" simples.
 */
export function waitlistRoom(state, date, time) {
  if (!state.booking.waitlist_enabled) return false;
  const max = state.settings?.waitlist?.data?.max_per_slot ?? 10;
  const queue = state.reservations.filter((r) => r.date === date && r.time === time && r.status === "waitlisted").length;
  return queue < max;
}

/** Pessoas nas áreas de lista de um dia (eventos com lista, mesa comunitária, área em pé). */
export function listAvailability(state, day, partySize, { online = true } = {}) {
  const all = day.areas.filter((a) => a.mode === "list");
  const listAreas = online ? all.filter((a) => a.bookable_online) : all;
  if (!listAreas.length) return null;
  const keys = new Set(listAreas.map((a) => a.key));
  const capacity = listAreas.length === all.length ? day.list_capacity || 0 : sum(listAreas, (a) => a.list_capacity || 0);
  const onList = state.reservations.filter(
    (r) => r.date === day.date && HOLDS_PLACE.has(r.status) && keys.has(r.area_key) && !r.table_codes?.length,
  );
  const remaining = Math.max(0, capacity - sum(onList, (r) => r.party_size));
  const listState = remaining < partySize ? "full" : remaining - partySize < capacity * 0.2 ? "few_left" : "available";
  return {
    capacity,
    remaining,
    state: listState,
    entry_times: day.entry_times || day.slots,
    waitlist_open: listState === "full" && (day.entry_times || day.slots).some((t) => waitlistRoom(state, day.date, t)),
  };
}

/** O dia, o motivo quando está fechado e o estado de cada horário para o tamanho do grupo. */
export function dayAvailability(state, date, partySize, now = new Date()) {
  const clock = houseParts(now);
  const rules = state.booking;
  const lang = pageLang();
  const closed = (reason, labels, extra = {}) => {
    const all = labels || REASONS[reason] || REASONS.closed;
    return { date, open: false, reason, reason_label: all[lang], reason_labels: all, state: "closed", slots: [], ...extra };
  };

  if (date < clock.date) return closed("past");
  if (daysBetween(clock.date, date) > rules.window_days) return closed("outside_window");
  const day = resolveDay(state, date);
  if (!day.open) return closed(day.reason, day.reason_labels, { event: day.event });
  const mode = day.event?.booking_mode;
  // aberto, mas nada para reservar no site: sem horários e sem lista de espera (nunca "lotado")
  const noBooking = (reason, labels) => ({ date, open: true, state: "no_booking", reason, reason_label: labels[lang], reason_labels: labels, slots: [], list: null, waitlist_open: false, event: day.event });
  if (mode === "none") return noBooking("event", REASONS.free_entry);

  // os valores que os combinados mostram para este dia e este grupo
  const limits = {
    party_max_online: day.party_max_online,
    party_too_large: partySize > day.party_max_online,
    duration_min: durationFor(state, day, partySize),
    tolerance_min: rules.tolerance_min,
    cancel_until_hours: rules.cancel_until_hours,
  };
  const names = new Map(state.areas.map((a) => [a.key, a.name]));
  const areas = day.areas
    .filter((a) => a.bookable_online && ((a.mode === "tables" && mode !== "list") || (a.mode === "list" && mode !== "tables")))
    .map((a) => ({ key: a.key, name: names.get(a.key) || a.key, mode: a.mode }));
  const tooLate = (time) => date === clock.date && toMinutes(time) < clock.minutes + rules.min_lead_min;

  // uma planta sem nenhuma mesa que o site possa oferecer (e sem lista): o site manda as pessoas
  // para o WhatsApp da casa em vez de mostrar todos os horários como lotados
  const tableAreas = new Set(areas.filter((a) => a.mode === "tables").map((a) => a.key));
  const onlineTables = day.layout.tables.some((t) => tableAreas.has(t.area) && t.bookable_online !== false);
  if (!onlineTables && !areas.some((a) => a.mode === "list")) return noBooking("no_online_tables", REASONS.no_online_tables);
  const tablesCapped = day.tables_limit != null && tableCovers(state, date) + partySize > day.tables_limit;

  const slots = areas.some((a) => a.mode === "tables")
    ? day.slots.map((time) => {
        if (tooLate(time)) return { time, state: "past", waitlist_open: false };
        if (limits.party_too_large) return { time, state: "full", waitlist_open: false };
        const free = blockedBy(state, day, time, partySize) || tablesCapped ? 0 : freeOptions(state, day, time, partySize).length;
        const slotState = free >= 2 ? "available" : free === 1 ? "few_left" : "full";
        return { time, state: slotState, waitlist_open: slotState === "full" && waitlistRoom(state, date, time) };
      })
    : [];

  let list = areas.some((a) => a.mode === "list") && !limits.party_too_large ? listAvailability(state, day, partySize) : null;
  if (list) {
    const upcoming = list.entry_times.filter((t) => !tooLate(t));
    const open = upcoming.filter((t) => !blockedBy(state, day, t, partySize));
    if (!upcoming.length) list = null;
    else if (!open.length) list = { ...list, entry_times: upcoming, state: "full", waitlist_open: upcoming.some((t) => waitlistRoom(state, date, t)) };
    else list = { ...list, entry_times: open };
  }
  if (!list && !slots.some((s) => s.state !== "past")) return closed(date === clock.date ? "past" : "closed");

  const bookable = slots.filter((s) => s.state === "available" || s.state === "few_left");
  let tablesState = null;
  if (slots.length) {
    if (!bookable.length) tablesState = "full";
    else if (bookable.length === 1 || bookable.every((s) => s.state === "few_left")) tablesState = "few_left";
    else tablesState = "available";
  }
  const parts = [tablesState, list?.state].filter(Boolean);
  const dayState = parts.includes("available") ? "available" : parts.includes("few_left") ? "few_left" : "full";
  return { date, open: true, state: dayState, slots, areas, list, event: day.event, ...limits };
}

export function daysAvailability(state, from, to, partySize, now = new Date()) {
  const days = [];
  for (let d = from; d <= to && days.length < 62; d = addDays(d, 1)) days.push(dayAvailability(state, d, partySize, now));
  return days;
}

function simulate(state, date, nextPlan, previous = null) {
  // como a noite estava antes da mudança (uma planta ou um evento pode já ter mudado em `state`)
  const before = resolveDay(previous || state, date);
  const work = clone(state);
  if (nextPlan) work.day_plans = { ...work.day_plans, [date]: nextPlan };
  else if (work.day_plans) delete work.day_plans[date];
  const after = resolveDay(work, date);

  const areaBefore = new Map(before.layout.tables.map((t) => [t.code, t.area]));
  const areaAfter = new Map(after.layout.tables.map((t) => [t.code, t.area]));
  const tablesAfter = new Map(after.layout.tables.filter((t) => modeOf(after, t.area) === "tables").map((t) => [t.code, t]));
  const names = new Map(state.customers.map((c) => [c.id, c.name]));
  let listRoom = after.open ? (after.list_capacity ?? 0) : 0;

  // lugares que as mesmas mesas dão na planta nova: uma junção só continua se a planta nova também
  // junta essas mesas (ou se foi uma junção que a equipe fez à mão, não uma desenhada na planta antiga)
  const seatsAfter = (codes) => {
    if (!codes.every((c) => tablesAfter.has(c))) return 0;
    if (codes.length === 1) return tablesAfter.get(codes[0]).max_seats;
    const combo = (after.layout.combos || []).find((c) => sameCodes(c.codes, codes));
    if (combo) return comboSeats(combo, tablesAfter);
    const wasDrawn = (before.layout.combos || []).some((c) => sameCodes(c.codes, codes));
    return wasDrawn ? 0 : sum(codes, (c) => tablesAfter.get(c).max_seats);
  };

  const onList = (r) => !r.table_codes?.length && modeOf(before, r.area_key) === "list";
  const placed = work.reservations
    .filter((r) => r.date === date && HOLDS_PLACE.has(r.status) && (r.table_codes?.length || onList(r)))
    .sort((a, b) => a.time.localeCompare(b.time) || b.party_size - a.party_size);
  const origin = new Map(
    placed.map((r) => {
      const codes = [...(r.table_codes || [])];
      return [r.id, { codes, list: codes.length ? null : r.area_key, area: codes.length ? areaBefore.get(codes[0]) : r.area_key }];
    }),
  );
  placed.forEach((r) => (r.table_codes = [])); // libera tudo e depois senta de novo

  const row = (r, toList = null) => {
    const o = origin.get(r.id);
    return { reservation_id: r.id, code: r.code, name: names.get(r.customer_id) || "", time: r.time, party_size: r.party_size, from: o.codes, from_list: o.list, to: [...r.table_codes], to_list: toList };
  };
  const kept = [];
  const moved = [];
  const withoutTable = [];

  // 1. quem pode ficar onde está: as mesmas mesas (ainda na planta e acomodando o
  //    grupo) ou a mesma lista
  const rest = [];
  for (const r of placed) {
    const o = origin.get(r.id);
    if (!after.open) {
      rest.push(r);
    } else if (o.list) {
      if (modeOf(after, o.list) === "list" && listRoom >= r.party_size) {
        listRoom -= r.party_size;
        kept.push(row(r, o.list));
      } else rest.push(r);
    } else {
      const busy = busyCodes(work, date, r.time, r.duration_min || 120, r.id);
      if (seatsAfter(o.codes) >= r.party_size && o.codes.every((c) => !busy.has(c))) {
        r.table_codes = o.codes;
        kept.push(row(r));
      } else rest.push(r);
    }
  }

  // 2. a área dele virou lista (noite de evento): vai para ela enquanto houver lugar
  // 3. senão, a menor mesa livre no horário reservado; se não houver, a equipe decide
  for (const r of rest) {
    const o = origin.get(r.id);
    if (after.open && !o.list && modeOf(after, o.area) === "list" && listRoom >= r.party_size) {
      listRoom -= r.party_size;
      r.area_key = o.area;
      moved.push(row(r, o.area));
      continue;
    }
    const option = after.open
      ? freeOptions(work, after, r.time, r.party_size, { ignoreId: r.id, online: false, duration: r.duration_min || 120 })[0]
      : null;
    if (option) {
      r.table_codes = option.codes;
      r.area_key = areaAfter.get(option.codes[0]);
      moved.push(row(r));
    } else {
      withoutTable.push(row(r));
    }
  }

  // para cada caso sem mesa, as mesas ainda livres em cada horário da noite: "Remarcar"
  // pode manter o horário com outra mesa (a equipe pode sentar um grupo numa maior) ou mudar o horário
  const usable = after.open ? usableTables(after, false) : [];
  for (const row of withoutTable) {
    const r = work.reservations.find((x) => x.id === row.reservation_id);
    row.options = Object.fromEntries(
      (after.open ? after.slots : []).map((time) => {
        const busy = busyCodes(work, date, time, r.duration_min || 120, r.id);
        const singles = usable.filter((t) => !busy.has(t.code)).map((t) => ({ codes: [t.code], seats: t.max_seats }));
        const joins = comboOptions(after, usable, r.party_size, false).filter((o) => o.codes.every((c) => !busy.has(c))).map((o) => ({ codes: o.codes, seats: o.seats }));
        return [time, [...singles, ...joins]];
      }),
    );
  }

  // grupos já sentados hoje numa mesa que sai do plano: ninguém os move daqui;
  // a equipe espera a mesa liberar ou move o grupo no Salão
  const nightOf = (iso) => houseParts(new Date(Date.parse(iso) - 5 * 3_600_000)).date;
  const seated = (work.table_sessions || [])
    .filter((s) => s.status === "open" && !s.undone && s.seated_at && nightOf(s.seated_at) === date && s.table_codes?.length)
    .filter((s) => !after.open || !s.table_codes.every((c) => tablesAfter.has(c)))
    .map((s) => {
      const r = work.reservations.find((x) => x.id === s.reservation_id);
      return { session_id: s.id, table_codes: [...s.table_codes], people: s.people, name: (r && (names.get(r.customer_id) || r.walk_in_name)) || "Mesa sentada" };
    });

  const seats = (day) =>
    day.open ? sum(day.layout.tables.filter((t) => modeOf(day, t.area) === "tables"), (t) => t.max_seats) + (day.list_capacity || 0) : 0;
  const result = { date, day: after, kept, moved, without_table: withoutTable, seated, seats_before: seats(before), seats_after: seats(after) };
  return { result, work };
}

/**
 * O que mudar o plano de uma data faz com as reservas já feitas: quem fica com a
 * mesa, quem muda (para a lista ou para a menor mesa livre) e quem fica sem nenhuma.
 * Nada é gravado.
 */
export function planDayChange(state, date, nextPlan, previous = null) {
  return simulate(state, date, nextPlan, previous).result;
}

/**
 * Grava o plano de uma data. Um dia com reservas ativas nunca é fechado: a equipe
 * remarca ou cancela antes. Fora isso, é recusado enquanto alguém ficar sem
 * mesa, a não ser que a equipe assuma esses casos. O lugar que abre vai para a lista de espera
 * daquela noite, nos horários que ainda não começaram.
 */
export function applyDayPlan(state, date, nextPlan, { confirmConflicts = false, now = new Date(), previous = null } = {}) {
  const { result, work } = simulate(state, date, nextPlan, previous);
  const active = state.reservations.filter((r) => r.date === date && HOLDS_PLACE.has(r.status));
  if (!result.day.open && active.length) return { ...result, applied: false, blocked: "day_has_reservations", waitlist_offers: 0 };
  if (result.without_table.length && !confirmConflicts) return { ...result, applied: false, waitlist_offers: 0 };

  const next = new Map(work.reservations.filter((r) => r.date === date).map((r) => [r.id, r]));
  for (const r of state.reservations) {
    const updated = next.get(r.id);
    if (!updated) continue;
    r.table_codes = updated.table_codes;
    r.area_key = updated.area_key;
  }
  if (nextPlan) state.day_plans = { ...state.day_plans, [date]: nextPlan };
  else if (state.day_plans) delete state.day_plans[date];

  const day = resolveDay(state, date);
  const waiting = state.reservations
    .filter((r) => r.date === date && r.status === "waitlisted")
    .sort((a, b) => (a.waitlist_position ?? 99) - (b.waitlist_position ?? 99));
  if (!day.open) {
    // a lista de espera de um dia fechado acabou
    for (const r of waiting) Object.assign(r, { status: "canceled", canceled_by: "system", cancel_reason: day.reason_label });
    return { ...result, applied: true, waitlist_offers: 0 };
  }

  const expires = new Date(now.getTime() + state.booking.waitlist_offer_min * 60_000).toISOString();
  let offers = 0;
  for (const r of waiting) {
    if (slotStarted(date, r.time, now) || blockedBy(state, day, r.time, r.party_size)) continue;
    const wantsList = modeOf(day, r.area_key) === "list";
    const option = wantsList ? null : freeOptions(state, day, r.time, r.party_size, { duration: r.duration_min || null })[0];
    if (wantsList ? listAvailability(state, day, r.party_size).state === "full" : !option) continue;
    r.status = "offered";
    r.table_codes = option ? option.codes : [];
    r.offer_expires_at = expires;
    offers++;
  }
  return { ...result, applied: true, waitlist_offers: offers };
}
