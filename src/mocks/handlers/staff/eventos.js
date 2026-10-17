// Eventos: a ficha, a publicação (que muda a noite, então passa pela simulação),
// duplicar, e a lista de convidados com a entrada na porta.
import { http, HttpResponse } from "msw";
import { uuid } from "../../../lib/uuid.js";
import { getState, save } from "../../db.js";
import { mockNow, problem, respond } from "../../scenario.js";
import {
  ACTIVE,
  applyChange,
  audit,
  conflictFor,
  ifMatchOf,
  networkDown,
  invalid,
  isDate,
  mustStop,
  nightOf,
  otherPerson,
  otherSavesFirst,
  preconditionFailed,
  readJson,
  simulateChange,
  staffName,
  staffReservation,
  withReservations,
} from "./agenda.js";

const API = "/api/v1";
const MODES = ["tables", "list", "mixed", "private", "none"];
const WITH_LIST = new Set(["list", "mixed", "private"]);
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const clone = (value) => JSON.parse(JSON.stringify(value));
const sum = (list, pick) => list.reduce((total, x) => total + pick(x), 0);

/** O evento sem o plano que ele guardou à parte, que só a simulação mantém. */
const withoutReplaced = (event) => Object.fromEntries(Object.entries(event).filter(([key]) => key !== "replaced_plan"));

const slugOf = (e) =>
  `${e.title}-${e.date}`
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

/** Quem está no evento: a lista da casa e, numa noite publicada, todos que reservaram naquela data. */
function guestsOf(state, event) {
  return state.reservations.filter(
    (r) => r.date === event.date && (r.event_id === event.id || event.published) && (ACTIVE.has(r.status) || r.status === "completed"),
  );
}

const arrivedPeople = (r) => (r.status === "completed" || r.arrived_at ? (r.arrived_people ?? r.party_size) : 0);

function eventOut(state, event) {
  const rest = withoutReplaced(event);
  const guests = guestsOf(state, event);
  return {
    ...clone(rest),
    slug: slugOf(event),
    counts: { reservations: guests.length, people: sum(guests, (r) => r.party_size), arrived: sum(guests, arrivedPeople) },
    version: event.version || "v1",
  };
}

/** Coloca a noite do evento no lugar (publicar) ou tira (despublicar, apagar), no estado `s`. */
function placeNight(s, event, on) {
  s.day_plans = s.day_plans || {};
  const current = s.day_plans[event.date];
  if (on) {
    if (current?.event_id !== event.id) event.replaced_plan = current ? clone(current) : null;
    const plan = event.day_plan && Object.values(event.day_plan).some((v) => v != null && v !== "") ? event.day_plan : null;
    if (plan) s.day_plans[event.date] = { ...clone(current?.event_id === event.id ? {} : current || {}), ...plan, layout_id: event.layout_id ?? plan.layout_id ?? null, event_id: event.id };
  } else if (current?.event_id === event.id) {
    if (event.replaced_plan) s.day_plans[event.date] = event.replaced_plan;
    else delete s.day_plans[event.date];
    event.replaced_plan = null;
  }
}

function check(e) {
  const errors = [];
  if (!String(e.title || "").trim()) errors.push({ field: "title", message: "Dê um nome ao evento." });
  if (!isDate(e.date)) errors.push({ field: "date", message: "Escolha a data." });
  if (!TIME.test(e.starts_at || "")) errors.push({ field: "starts_at", message: "Use o formato 20:00." });
  if (e.ends_at && !TIME.test(e.ends_at)) errors.push({ field: "ends_at", message: "Use o formato 23:30." });
  if (!MODES.includes(e.booking_mode)) errors.push({ field: "booking_mode", message: "Escolha como o evento recebe reservas." });
  if (WITH_LIST.has(e.booking_mode) && e.booking_mode !== "private" && !(Number.isInteger(e.list_capacity) && e.list_capacity > 0)) {
    errors.push({ field: "list_capacity", message: "Com lista, diga quantas pessoas cabem." });
  }
  if (e.booking_mode === "private" && !String((typeof e.private_label === "object" ? e.private_label?.pt : e.private_label) || "").trim()) {
    errors.push({ field: "private_label", message: "Diga ao cliente por que a casa fecha (por exemplo, Festa fechada). O português é obrigatório." });
  }
  if (e.booking_mode === "mixed" && e.tables_limit != null && !(Number.isInteger(e.tables_limit) && e.tables_limit > 0)) {
    errors.push({ field: "tables_limit", message: "Use um número inteiro maior que zero, ou deixe vazio para usar todas as mesas." });
  }
  if ((e.entry_times || []).some((t) => !TIME.test(t))) errors.push({ field: "entry_times", message: "Escreva os horários assim: 20:00, 21:00." });
  if (e.party_max != null && !(Number.isInteger(e.party_max) && e.party_max > 0)) errors.push({ field: "party_max", message: "Use um número inteiro maior que zero." });
  return errors;
}

const FIELDS = ["title", "date", "starts_at", "ends_at", "description", "published", "booking_mode", "list_capacity", "tables_limit", "entry_times", "party_max", "requires_approval", "layout_id", "day_plan", "image_id", "internal_note", "translations", "private_label"];
const pick = (body) => Object.fromEntries(FIELDS.filter((k) => body[k] !== undefined).map((k) => [k, clone(body[k])]));

/** Uma foto da Galeria que ainda não tem versões ainda não pode ir para o site. */
function photoNotReady(state, imageId) {
  if (!imageId) return null;
  const image = (state.images || []).find((i) => i.id === imageId);
  if (!image) return invalid([{ field: "image_id", message: "Essa foto não está mais na Galeria. Escolha outra." }]);
  if (image.status !== "ready" || !image.variants?.length) {
    return problem(409, "image_not_ready", "A foto ainda está sendo preparada", { detail: "Ela fica marcada “preparando” na Galeria. Escolha outra ou espere alguns minutos.", errors: [{ field: "image_id", message: "A foto ainda está sendo preparada." }] });
  }
  return null;
}

/** A outra pessoa da demonstração muda a nota da equipe um minuto antes. */
function otherPersonSavesEvent(state, event) {
  event.internal_note = [event.internal_note, "Conferir a música com o grupo."].filter(Boolean).join(" ");
  event.version = `v${(Date.now() - 1).toString(36)}`;
  event.updated_by = otherPerson(state);
  save();
}

/** 412 quando o evento mudou desde que a tela leu. */
function staleEvent(state, event, request) {
  const ifMatch = ifMatchOf(request);
  if (ifMatch == null) return null;
  if (otherSavesFirst()) otherPersonSavesEvent(state, event);
  if ((event.version || "v1") === ifMatch) return null;
  return preconditionFailed(event.updated_by || otherPerson(state), eventOut(state, event));
}

/** Os campos do evento no registro de ações (sem cópias internas). */
const forLog = (e) => e && Object.fromEntries(FIELDS.filter((k) => k !== "translations" && e[k] !== undefined).map((k) => [k, e[k]]));

/** A mudança, simulada ou de verdade, nas noites que o evento toca. */
function changeNights(state, before, after, body, dryRun, now) {
  const touched = [...new Set([before?.published ? before.date : null, after?.published ? after.date : null].filter(Boolean))];
  const dates = withReservations(state, touched);
  const change = (s) => {
    const old = before && s.events.find((e) => e.id === before.id);
    if (old?.published) placeNight(s, old, false);
    if (!after) s.events = s.events.filter((e) => e.id !== before.id);
    else {
      const i = s.events.findIndex((e) => e.id === after.id);
      const next = clone(after);
      next.replaced_plan = old?.replaced_plan ?? null;
      if (i >= 0) s.events[i] = next;
      else s.events.push(next);
      if (next.published) placeNight(s, next, true);
    }
  };
  const resolutions = Array.isArray(body.resolutions) ? body.resolutions : [];
  const sim = simulateChange(state, dates, change, resolutions);
  const empty = { date: after?.date || before?.date, applied: false, kept: [], moved: [], without_table: [], seats_before: 0, seats_after: 0, waitlist_offers: 0, blocked: null };
  const summary = (results) => ({ ...(results[0] || empty), items: results });
  if (dryRun) return { response: HttpResponse.json(summary(sim.results)) };
  if (mustStop(sim, body.confirm_conflicts)) {
    const conflict = conflictFor(sim, true);
    return { response: conflict };
  }
  // também em noites sem reservas: o evento e o plano dele mudam no lugar
  applyChange(state, dates, change, resolutions, now);
  return { response: null };
}

const notFound = () => problem(404, "not_found", "Esse evento não existe mais");

export const handlers = [
  http.get(`${API}/staff/events`, ({ request }) =>
    networkDown() ? HttpResponse.error() : respond((scenario) => {
      const url = new URL(request.url);
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      const state = getState(mockNow());
      const items = scenario === "vazio" ? [] : state.events.filter((e) => (!from || e.date >= from) && (!to || e.date <= to)).sort((a, b) => a.date.localeCompare(b.date));
      return HttpResponse.json({ next_cursor: null, items: items.map((e) => eventOut(state, e)) });
    }),
  ),

  http.get(`${API}/staff/events/:id`, ({ params }) =>
    networkDown() ? HttpResponse.error() : respond(() => {
      const state = getState(mockNow());
      const event = state.events.find((e) => e.id === params.id);
      return event ? HttpResponse.json(eventOut(state, event)) : notFound();
    }),
  ),

  http.post(`${API}/staff/events`, async ({ request }) => {
    const body = await readJson(request);
    return respond(() => {
      const now = mockNow();
      const state = getState(now);
      const event = {
        id: uuid(),
        description: "",
        ends_at: null,
        image_id: null,
        published: false,
        booking_mode: "mixed",
        list_capacity: null,
        entry_times: [],
        party_max: state.booking.party_max_online,
        requires_approval: false,
        price_cents: null,
        layout_id: null,
        internal_note: "",
        ...pick(body),
        version: "v1",
      };
      const errors = check(event);
      if (event.date && event.date < nightOf(now)) errors.push({ field: "date", message: "Escolha uma data que ainda vem." });
      if (errors.length) return invalid(errors);
      const photo = photoNotReady(state, event.image_id);
      if (photo) return photo;
      event.updated_by = staffName(state);
      const dryRun = new URL(request.url).searchParams.get("dry_run") === "true";
      if (event.published) {
        const { response } = changeNights(state, null, event, body, dryRun, now);
        if (response) return response;
      } else {
        if (dryRun) return HttpResponse.json({ date: event.date, applied: false, kept: [], moved: [], without_table: [], items: [] });
        state.events.push(event);
      }
      audit(state, "event.create", event.title, null, forLog(event), body.resolutions || []);
      save();
      return HttpResponse.json(eventOut(state, state.events.find((e) => e.id === event.id)), { status: 201 });
    });
  }),

  http.patch(`${API}/staff/events/:id`, async ({ request, params }) => {
    const body = await readJson(request);
    return respond(() => {
      const now = mockNow();
      const state = getState(now);
      const current = state.events.find((e) => e.id === params.id);
      if (!current) return notFound();
      const dryRun = new URL(request.url).searchParams.get("dry_run") === "true";
      if (!dryRun) {
        const stale = staleEvent(state, current, request);
        if (stale) return stale;
      }
      const next = { ...clone(current), ...pick(body), version: `v${Date.now().toString(36)}`, updated_by: staffName(state) };
      const errors = check(next);
      if (next.published && next.date < nightOf(now) && next.date !== current.date) errors.push({ field: "date", message: "Escolha uma data que ainda vem." });
      if (errors.length) return invalid(errors);
      if (body.image_id !== undefined && body.image_id !== current.image_id) {
        const photo = photoNotReady(state, body.image_id);
        if (photo) return photo;
      }
      const before = forLog(clone(current));
      const nightChanges = current.published || next.published;
      if (nightChanges) {
        const { response } = changeNights(state, current, next, body, dryRun, now);
        if (response) return response;
      } else {
        if (dryRun) return HttpResponse.json({ date: next.date, applied: false, kept: [], moved: [], without_table: [], items: [] });
        Object.assign(current, next);
      }
      const action = body.published === true && !before.published ? "event.publish" : body.published === false && before.published ? "event.unpublish" : "event.update";
      audit(state, action, next.title, before, forLog(state.events.find((e) => e.id === current.id)), body.resolutions || []);
      save();
      return HttpResponse.json(eventOut(state, state.events.find((e) => e.id === current.id)));
    });
  }),

  http.delete(`${API}/staff/events/:id`, ({ request, params }) =>
    respond(() => {
      const now = mockNow();
      const state = getState(now);
      const current = state.events.find((e) => e.id === params.id);
      if (!current) return notFound();
      const url = new URL(request.url);
      const body = { confirm_conflicts: url.searchParams.get("confirm_conflicts") === "true" };
      if (current.published) {
        const { response } = changeNights(state, current, null, body, url.searchParams.get("dry_run") === "true", now);
        if (response) return response;
      }
      if (!current.published) state.events = state.events.filter((e) => e.id !== current.id);
      // as reservas ficam; só deixam de apontar para o evento
      for (const r of state.reservations) if (r.event_id === current.id) r.event_id = null;
      audit(state, "event.delete", current.title, forLog(current), null);
      save();
      return new HttpResponse(null, { status: 204 });
    }),
  ),

  http.post(`${API}/staff/events/:id/duplicate`, async ({ request, params }) => {
    const body = await readJson(request);
    return respond(() => {
      const now = mockNow();
      const state = getState(now);
      const source = state.events.find((e) => e.id === params.id);
      if (!source) return notFound();
      if (!isDate(body.date) || body.date < nightOf(now)) return invalid([{ field: "date", message: "Escolha uma data que ainda vem." }]);
      const rest = withoutReplaced(clone(source));
      const copy = { ...rest, id: uuid(), date: body.date, published: false, version: "v1" };
      state.events.push(copy);
      audit(state, "event.duplicate", copy.title, null, { from: source.date, to: copy.date });
      save();
      return HttpResponse.json(eventOut(state, copy), { status: 201 });
    });
  }),

  http.get(`${API}/staff/events/:id/guests`, ({ params }) =>
    respond((scenario) => {
      const state = getState(mockNow());
      const event = state.events.find((e) => e.id === params.id);
      if (!event) return notFound();
      const guests = scenario === "vazio" ? [] : guestsOf(state, event).sort((a, b) => a.time.localeCompare(b.time));
      return HttpResponse.json({
        event: eventOut(state, event),
        capacity: WITH_LIST.has(event.booking_mode) ? (event.list_capacity ?? null) : null,
        expected_people: sum(guests, (r) => r.party_size),
        arrived_people: sum(guests, arrivedPeople),
        guests: guests.map((r) => staffReservation(state, r)),
      });
    }),
  ),

  http.post(`${API}/staff/events/:id/guests`, async ({ request, params }) => {
    const body = await readJson(request);
    return respond(() => {
      const now = mockNow();
      const state = getState(now);
      const event = state.events.find((e) => e.id === params.id);
      if (!event) return notFound();
      const errors = [];
      const name = String(body.name || "").trim();
      if (!name) errors.push({ field: "name", message: "Escreva o nome de quem vem." });
      if (!(Number.isInteger(body.party_size) && body.party_size >= 1 && body.party_size <= 60)) errors.push({ field: "party_size", message: "De 1 a 60 pessoas." });
      if (errors.length) return invalid(errors);
      const listed = sum(guestsOf(state, event), (r) => r.party_size);
      if (event.list_capacity && listed + body.party_size > event.list_capacity) {
        return problem(409, "conflict", "A lista do evento está cheia", { code: "event_list_full", detail: `Chegou ao limite de ${event.list_capacity} pessoas. Aumente a capacidade no evento.` });
      }
      const customer = { id: uuid(), name, phone_e164: "", phone_verified_at: null, visits: 0, no_shows: 0, last_visit_at: null, tags: [], internal_notes: "", blocked: false, marketing_opt_in: false, privacy_version: null, anonymized_at: null };
      state.customers.push(customer);
      const time = event.entry_times?.[0] || event.starts_at;
      const starts = new Date(`${event.date}T${time}:00-03:00`);
      const atDoor = body.at_door === true;
      const reservation = {
        id: uuid(),
        code: `TR-${5000 + state.reservations.length}`,
        customer_id: customer.id,
        party_size: body.party_size,
        date: event.date,
        time,
        starts_at: starts.toISOString(),
        ends_at: new Date(starts.getTime() + 180 * 60_000).toISOString(),
        duration_min: 180,
        area_preference: body.area_key || null,
        area_key: body.area_key || event.day_plan?.list_area || "quintal",
        table_codes: [],
        status: atDoor ? "completed" : "confirmed",
        source: atDoor ? "walk_in" : "staff",
        customer_confirmation: "not_sent",
        tolerance_min: state.booking.tolerance_min,
        extra_tolerance_min: 0,
        arrived_at: atDoor ? now.toISOString() : null,
        arrived_people: atDoor ? body.party_size : null,
        seated_at: null,
        left_at: null,
        notes: "",
        internal_notes: String(body.note || ""),
        flags: [],
        event_id: event.id,
        waitlist_position: null,
        offer_expires_at: null,
        pending_until: null,
        canceled_by: null,
        cancel_reason: null,
        decline_reason: null,
        created_at: now.toISOString(),
      };
      state.reservations.push(reservation);
      audit(state, atDoor ? "event.door_entry" : "event.guest_add", event.title, null, { name, party_size: body.party_size });
      save();
      return HttpResponse.json(staffReservation(state, reservation), { status: 201 });
    });
  }),

  // além do contrato: tirar um nome da lista da casa de um evento fechado
  http.delete(`${API}/staff/events/:id/guests/:rid`, ({ params }) =>
    respond(() => {
      const state = getState(mockNow());
      const r = state.reservations.find((x) => x.id === params.rid && x.event_id === params.id);
      if (!r) return problem(404, "not_found", "Esse nome não está mais na lista");
      Object.assign(r, { status: "canceled", canceled_by: "staff", cancel_reason: "Tirado da lista do evento" });
      audit(state, "event.guest_remove", r.code, null, null);
      save();
      return new HttpResponse(null, { status: 204 });
    }),
  ),

  http.post(`${API}/staff/events/:id/guests/:rid/check-in`, async ({ request, params }) => {
    const body = await readJson(request);
    return respond(() => {
      const now = mockNow();
      const state = getState(now);
      const r = state.reservations.find((x) => x.id === params.rid);
      if (!r) return problem(404, "not_found", "Essa reserva não existe mais");
      if (!ACTIVE.has(r.status)) return problem(409, "invalid_transition", "Essa chegada já foi marcada");
      const people = Number.isInteger(body.people) && body.people > 0 ? Math.min(body.people, r.party_size) : r.party_size;
      Object.assign(r, { status: "completed", arrived_at: body.occurred_at || now.toISOString(), arrived_people: people });
      audit(state, "reservation.check_in", r.code, null, { people });
      save();
      return HttpResponse.json(staffReservation(state, r));
    });
  }),

  http.delete(`${API}/staff/events/:id/guests/:rid/check-in`, ({ params }) =>
    respond(() => {
      const state = getState(mockNow());
      const r = state.reservations.find((x) => x.id === params.rid);
      if (!r) return problem(404, "not_found", "Essa reserva não existe mais");
      if (r.status !== "completed") return problem(409, "invalid_transition", "Essa chegada não estava marcada");
      Object.assign(r, { status: "confirmed", arrived_at: null, arrived_people: null });
      audit(state, "reservation.undo_check_in", r.code, null, null);
      save();
      return HttpResponse.json(staffReservation(state, r));
    }),
  ),
];
