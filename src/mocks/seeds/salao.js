// A noite de exemplo do salão: quem já sentou, quem sentou sem reserva, quem está atrasado e
// quem não veio. Tudo é posto em relação ao relógio da noite (veja nightClock abaixo), para
// a demonstração sempre mostrar um serviço em andamento, seja qual for a hora em que é aberta.
import { addDays, houseParts, toMinutes } from "../../lib/dates.js";
import { uuid } from "../../lib/uuid.js";
import { resolveDay } from "../availability.js";

const DEMO_TIME = "20:40"; // onde uma demonstração aberta fora do horário de serviço começa a noite
const MIN = 60_000;

/** A noite que o salão mostra: hoje quando a casa abre, senão o próximo dia aberto. */
export function tonightOf(state, now) {
  const today = houseParts(now).date;
  for (let i = 0; i < 8; i++) {
    const date = addDays(today, i);
    if (resolveDay(state, date).open) return date;
  }
  return today;
}

const at = (date, time) => new Date(`${date}T${time}:00-03:00`);

/**
 * O relógio da casa para o salão. Dentro do horário de serviço (com uma hora de cada lado) é o
 * real, ou ?agora=. Fora dele, a demonstração faz a noite das 20:40 em diante, andando com
 * o relógio real para as contagens correrem, e recomeçando quando chega ao horário de fechamento.
 */
const fixedClock = () => {
  try {
    return Boolean(new URLSearchParams(window.location.search).get("agora") || sessionStorage.getItem("territorio:mock-now"));
  } catch {
    return false;
  }
};

export function nightClock(state, now) {
  const date = tonightOf(state, now);
  const day = resolveDay(state, date);
  const here = houseParts(now);
  const opens = toMinutes(day.opens_at || "19:00");
  const closes = toMinutes(day.closes_at || "23:30");
  if (here.date === date && here.minutes >= opens - 60 && here.minutes <= closes + 60) return { date, now: new Date(now), demo: false };
  // ?agora= fixa o relógio da casa de propósito (testes, uma demonstração de uma hora certa): aí nenhuma noite é simulada
  if (fixedClock()) return { date, now: new Date(now), demo: false };
  const anchor = state.night_clock?.real ?? now.getTime();
  let clock = new Date(at(date, DEMO_TIME).getTime() + (now.getTime() - anchor));
  if (clock > at(date, day.closes_at || "23:30") || now.getTime() < anchor) {
    state.night_clock = { real: now.getTime() };
    clock = at(date, DEMO_TIME);
  }
  return { date, now: clock, demo: true };
}

/** Um evento da sessão, do jeito que a linha do tempo guarda. */
export function sessionEvent(kind, when, extra = {}) {
  return { at: new Date(when).toISOString(), occurred_at: new Date(when).toISOString(), kind, actor_label: "Salão", device_id: null, device_label: "Computador da recepção", table_codes: [], people: null, ...extra };
}

export function newSession(state, reservation, { tables, area = null, people, seatedAt, duration = 120, actor = "Salão", device = "Computador da recepção" }) {
  const seated = new Date(seatedAt);
  const session = {
    id: uuid(),
    venue_id: state.house.id,
    reservation_id: reservation.id,
    status: "open",
    table_codes: [...tables],
    area_code: tables.length ? null : area,
    people,
    seated_at: seated.toISOString(),
    ends_at: new Date(seated.getTime() + duration * MIN).toISOString(),
    extended_min: 0,
    release_hint: false,
    released_at: null,
    merged_into: null,
    version: "1",
    events: [sessionEvent("opened", seated, { actor_label: actor, device_label: device, table_codes: [...tables], people })],
  };
  state.table_sessions.push(session);
  return session;
}

/** Uma reserva para um grupo que sentou sem reserva (a reserva própria de quem chegou sem marcar). */
export function walkInReservation(state, { name, people, date, seatedAt, tables, area }) {
  const seated = new Date(seatedAt);
  const time = houseParts(seated).time;
  return {
    id: uuid(),
    code: `TR-${5000 + state.reservations.length * 7}`,
    customer_id: null,
    walk_in_name: name || "",
    party_size: people,
    date,
    time,
    starts_at: seated.toISOString(),
    ends_at: new Date(seated.getTime() + 120 * MIN).toISOString(),
    duration_min: 120,
    area_preference: null,
    area_key: area,
    table_codes: [...tables],
    status: "completed",
    source: "walk_in",
    customer_confirmation: "not_sent",
    tolerance_min: 0,
    extra_tolerance_min: 0,
    arrived_at: seated.toISOString(),
    seated_at: seated.toISOString(),
    left_at: null,
    notes: "",
    internal_notes: "",
    flags: [],
    event_id: null,
    waitlist_position: null,
    offer_expires_at: null,
    pending_until: null,
    canceled_by: null,
    cancel_reason: null,
    decline_reason: null,
    terms_version: null,
    created_by: null,
    created_at: seated.toISOString(),
    table_session_id: null,
  };
}

// Minutos depois (ou antes, negativo) do horário reservado em que cada grupo sentou.
const ARRIVAL = { Carla: -8, Lucas: 6, Juliana: 3, Diego: 11, "Renata Souza": 3, Bruno: 9 };

export function extend(state, now) {
  state.table_sessions = [];
  const { date, now: clock } = nightClock(state, now);
  state.night_clock = { real: now.getTime() };
  const night = state.reservations.filter((r) => r.date === date);
  const byName = (name) => night.find((r) => state.customers.find((c) => c.id === r.customer_id)?.name === name);

  for (const reservation of night) {
    if (reservation.status !== "confirmed") continue;
    const name = state.customers.find((c) => c.id === reservation.customer_id)?.name;
    if (!(name in ARRIVAL)) continue;
    const seatedAt = new Date(new Date(reservation.starts_at).getTime() + ARRIVAL[name] * MIN);
    if (new Date(seatedAt.getTime() + 20 * MIN) > clock) continue; // ainda não chegou a esta hora
    const session = newSession(state, reservation, { tables: reservation.table_codes, people: reservation.party_size, seatedAt });
    Object.assign(reservation, { status: "completed", arrived_at: seatedAt.toISOString(), seated_at: seatedAt.toISOString(), table_session_id: session.id, arrived_people: reservation.party_size });
  }

  // Rafael nunca veio: marcado no fim da tolerância
  const rafael = byName("Rafael");
  if (rafael?.status === "confirmed") {
    const limit = new Date(new Date(rafael.starts_at).getTime() + (rafael.tolerance_min + 2) * MIN);
    if (limit < clock) Object.assign(rafael, { status: "no_show", no_show_counted: true });
  }
  // Mariana avisou a casa que ia atrasar: a contagem já tem os minutos extras
  const mariana = byName("Mariana");
  if (mariana?.status === "confirmed") Object.assign(mariana, { extra_tolerance_min: state.booking.extra_tolerance_min || 10, customer_late: true });

  // dois grupos sem reserva: no balcão e na S2
  const walkIns = [
    { name: "", people: 2, tables: ["B1", "B2"], area: "balcao", ago: 35 },
    { name: "Rogério", people: 3, tables: ["S2"], area: "salao", ago: 50 },
  ];
  for (const w of walkIns) {
    const seatedAt = new Date(clock.getTime() - w.ago * MIN);
    if (houseParts(seatedAt).minutes < toMinutes("19:00") || houseParts(seatedAt).date !== date) continue;
    const reservation = walkInReservation(state, { ...w, date, seatedAt });
    state.reservations.push(reservation);
    const session = newSession(state, reservation, { tables: w.tables, people: w.people, seatedAt });
    reservation.table_session_id = session.id;
  }

  // Thiago respondeu "Estou chegando" há alguns minutos (história 6.9)
  const thiago = byName("Thiago");
  if (thiago?.status === "confirmed" && Math.abs(new Date(thiago.starts_at) - clock) <= 60 * MIN) {
    thiago.customer_arriving_at = new Date(clock.getTime() - 4 * MIN).toISOString();
    thiago.history ??= [];
    thiago.history.push({ at: thiago.customer_arriving_at, actor_label: "Cliente", action: "customer_arriving", summary: "Respondeu \"Estou chegando\"" });
  }

  previousNightSeed(state, now);
}

/**
 * A última noite aberta antes de hoje já fechada pela rotina, com dois "Não veio"
 * automáticos para o dono conferir (no_show_review) e um grupo que veio.
 */
function previousNightSeed(state, now) {
  const today = houseParts(now).date;
  let date = null;
  for (let i = 1; i <= 4 && !date; i++) if (resolveDay(state, addDays(today, -i)).open) date = addDays(today, -i);
  if (!date) return;
  const day = resolveDay(state, date);
  const closes = toMinutes(day.closes_at || "23:30") + 60;
  const closedAt = new Date(new Date(`${date}T00:00:00-03:00`).getTime() + closes * MIN);
  const people = [
    { name: "Vinícius Prates", time: "20:00", size: 2, table: "S5", came: false },
    { name: "Aline Kobayashi", time: "21:00", size: 4, table: "Q2", came: false },
    { name: "Roberto Siqueira", time: "19:30", size: 3, table: "S6", came: true },
  ];
  const ids = [];
  people.forEach((p, i) => {
    const customer = {
      id: uuid(), name: p.name, phone_e164: `+55459977${String(1200 + i * 37).padStart(4, "0")}`, phone_verified_at: now.toISOString(),
      visits: i + 1, no_shows: p.came ? 0 : 1, last_visit_at: null, tags: [], internal_notes: "", blocked: false,
      marketing_opt_in: false, privacy_version: "2026-10-01", anonymized_at: null,
    };
    state.customers.push(customer);
    const starts = new Date(`${date}T${p.time}:00-03:00`);
    const r = walkInReservation(state, { name: "", people: p.size, date, seatedAt: starts, tables: [p.table], area: p.table.startsWith("Q") ? "quintal" : "salao" });
    Object.assign(r, {
      customer_id: customer.id,
      walk_in_name: "",
      time: p.time,
      source: "site",
      code: `TR-${3900 + i * 41}`,
      status: p.came ? "completed" : "no_show",
      arrived_at: p.came ? new Date(starts.getTime() + 5 * MIN).toISOString() : null,
      seated_at: p.came ? new Date(starts.getTime() + 5 * MIN).toISOString() : null,
      left_at: p.came ? new Date(starts.getTime() + 110 * MIN).toISOString() : null,
      arrived_people: p.came ? p.size : null,
      no_show_at: p.came ? null : closedAt.toISOString(),
      no_show_counted: !p.came,
      no_show_auto: !p.came,
      tolerance_min: 20,
      created_at: new Date(starts.getTime() - 2 * 24 * 60 * MIN).toISOString(),
      history: [],
      messages: [],
      version: 1,
    });
    state.reservations.push(r);
    if (!p.came) ids.push(r.id);
  });
  state.nights ??= {};
  state.nights[date] = { closed_at: closedAt.toISOString(), closed_by: "system", no_shows: ids, review: [] };
}
