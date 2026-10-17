// Dados da demonstração da Agenda: algumas datas que saem da semana padrão (uma noite de chuva sem o
// quintal, uma noite com mesas seguradas para quem chega sem reserva, uma terça aberta antes de um feriado, uma noite
// fechada para manutenção) e reservas mais leves nas próximas semanas, para o mês ter movimento.
import { addDays, houseParts, weekdayOf } from "../../lib/dates.js";
import { uuid } from "../../lib/uuid.js";

const SLOTS = ["19:00", "19:30", "20:00", "20:30", "21:00", "21:30"];

/** As noites abertas de hoje em diante (pela semana padrão), e as datas que a demonstração usa. */
export function demoDates(state, now) {
  const today = houseParts(now).date;
  const open = [];
  for (let i = 0; open.length < 24 && i < 120; i++) {
    const d = addDays(today, i);
    if (state.hours.find((h) => h.weekday === weekdayOf(d))?.open) open.push(d);
  }
  let tuesday = addDays(today, 10);
  while (weekdayOf(tuesday) !== 2) tuesday = addDays(tuesday, 1);
  const thursday = open.slice(5).find((d) => weekdayOf(d) === 4) || open[6];
  let pastFriday = addDays(today, -10);
  while (weekdayOf(pastFriday) !== 5) pastFriday = addDays(pastFriday, -1);
  return {
    open,
    rain: open[3],
    held: open[4],
    fish: thursday,
    private: open.slice(8).find((d) => weekdayOf(d) === 6 && d !== thursday) || open[10],
    maintenance: open[13],
    tuesday,
    pastEvent: pastFriday,
  };
}

let seq = 6100;
/** Uma reserva (e o cliente dela) no formato dos dados iniciais básicos. */
export function addReservation(state, now, { name, size, date, time, tables = [], area = null, status = "confirmed", eventId = null, notes = "", source = "site" }) {
  const customer = {
    id: uuid(),
    name,
    phone_e164: `+554599${String(1000 + state.customers.length).padStart(6, "0")}`,
    phone_verified_at: now.toISOString(),
    visits: name.length % 4,
    no_shows: 0,
    last_visit_at: null,
    tags: [],
    internal_notes: "",
    blocked: false,
    marketing_opt_in: false,
    privacy_version: "2026-10-01",
    anonymized_at: null,
  };
  state.customers.push(customer);
  const layout = state.layouts[0];
  const starts = new Date(`${date}T${time}:00-03:00`);
  seq += 23;
  const reservation = {
    id: uuid(),
    code: `TR-${seq}`,
    public_token: uuid().replace(/-/g, "") + uuid().replace(/-/g, ""),
    customer_id: customer.id,
    party_size: size,
    date,
    time,
    starts_at: starts.toISOString(),
    ends_at: new Date(starts.getTime() + 120 * 60_000).toISOString(),
    duration_min: 120,
    area_preference: area,
    area_key: tables.length ? layout.tables.find((t) => t.code === tables[0])?.area || area : area,
    table_codes: [...tables],
    status,
    source,
    customer_confirmation: "not_sent",
    tolerance_min: 15,
    extra_tolerance_min: 0,
    arrived_at: status === "completed" ? starts.toISOString() : null,
    arrived_people: status === "completed" ? size : null,
    seated_at: null,
    left_at: null,
    notes,
    internal_notes: "",
    flags: [],
    event_id: eventId,
    waitlist_position: null,
    offer_expires_at: null,
    pending_until: null,
    canceled_by: null,
    cancel_reason: null,
    decline_reason: null,
    terms_version: state.terms?.version ?? null,
    terms_accepted_at: now.toISOString(),
    idempotency_key: uuid(),
    created_by: null,
    created_at: new Date(now.getTime() - 86_400_000 * 2).toISOString(),
  };
  state.reservations.push(reservation);
  return reservation;
}

// Reservas espalhadas pelas próximas noites: a noite de chuva só no salão, uma noite quase
// cheia no quintal (boa para testar "Trocar a planta do dia"), e algumas mais calmas.
const LATER = {
  rain: [
    { name: "Simone Alves", size: 4, time: "19:30", tables: ["S1"] },
    { name: "Otávio Lins", size: 2, time: "20:00", tables: ["S5"] },
    { name: "Débora Kato", size: 4, time: "20:30", tables: ["S2"] },
  ],
  held: [
    { name: "Ricardo Matsuda", size: 4, time: "19:00", tables: ["Q1"] },
    { name: "Elaine Prado", size: 6, time: "19:30", tables: ["Q3"] },
    { name: "Felipe Nakamura", size: 4, time: "20:00", tables: ["Q2"] },
    { name: "Mônica Ribas", size: 2, time: "20:00", tables: ["Q7"] },
    { name: "André Tavares", size: 6, time: "20:30", tables: ["Q6"] },
    { name: "Cíntia Barros", size: 4, time: "21:00", tables: ["S1"] },
    { name: "Jorge Hayashi", size: 2, time: "21:00", tables: ["Q8"] },
  ],
  quiet: [
    [
      { name: "Luana Teixeira", size: 2, time: "20:00", tables: ["S5"] },
      { name: "Márcio Duarte", size: 4, time: "20:30", tables: ["Q4"] },
    ],
    [
      { name: "Priscila Moura", size: 4, time: "19:30", tables: ["S2"] },
      { name: "Caio Fontana", size: 6, time: "20:00", tables: ["Q3"] },
      { name: "Yasmin Okada", size: 2, time: "21:00", tables: ["Q7"] },
    ],
    [{ name: "Leandro Pires", size: 4, time: "20:00", tables: ["Q1"] }],
  ],
};

export function extend(state, now) {
  const dates = demoDates(state, now);
  const layoutNamed = (name) => state.layouts.find((l) => l.name.startsWith(name))?.id ?? null;
  const by = state.users.find((u) => u.role === "owner")?.name || "Marcus Norberto";
  const stamp = { updated_by: by, updated_at: new Date(now.getTime() - 3 * 86_400_000).toISOString(), version: "v1" };
  const base = { open: null, closed_reason: null, public_label: null, opens_at: null, closes_at: null, slots: null, layout_id: null, duration_min: null, max_covers_per_slot: null, max_covers_night: null, held_tables: [], closed_areas: [], party_max_online: null, event_id: null, internal_note: "" };
  state.day_plans = state.day_plans || {};

  state.day_plans[dates.rain] = { ...base, ...stamp, layout_id: layoutNamed("Sem quintal"), internal_note: "Previsão de chuva forte o dia todo: só salão e balcão." };
  state.day_plans[dates.held] = { ...base, ...stamp, held_tables: ["S5", "S6"], max_covers_per_slot: 24, internal_note: "Jogo do Brasil às 21h: guardar S5 e S6 para quem chega sem reserva." };
  state.day_plans[dates.tuesday] = {
    ...base,
    ...stamp,
    open: true,
    opens_at: "19:00",
    closes_at: "23:00",
    slots: SLOTS.slice(0, 5),
    internal_note: "Véspera de feriado: abrir a casa com o salão e o quintal.",
  };
  state.day_plans[dates.maintenance] = { ...base, ...stamp, open: false, closed_reason: "maintenance", public_label: { pt: "Fechado para manutenção da cozinha", es: "Cerrado por mantenimiento de la cocina", en: "" }, internal_note: "Troca da coifa. Confirmar data com o técnico." };

  for (const night of LATER.rain) addReservation(state, now, { ...night, date: dates.rain });
  for (const night of LATER.held) addReservation(state, now, { ...night, date: dates.held });
  const quietNights = dates.open.slice(5).filter((d) => ![dates.fish, dates.private, dates.maintenance].includes(d));
  LATER.quiet.forEach((nights, i) => {
    for (const night of nights) addReservation(state, now, { ...night, date: quietNights[i] });
  });
}
