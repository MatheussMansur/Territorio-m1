// A lista de espera da noite: grupos esperando um horário lotado, uma mesa oferecida por WhatsApp,
// alguém sem WhatsApp confirmado e dois grupos esperando na porta.
import { uuid } from "../../lib/uuid.js";
import { nightClock } from "./salao.js";

const MIN = 60_000;

function customer(state, name, verified = true) {
  const n = state.customers.length + 60;
  const c = {
    id: uuid(), name, phone_e164: `+554591${String(n).padStart(6, "0")}`, phone_verified_at: verified ? new Date().toISOString() : null,
    visits: n % 4, no_shows: 0, last_visit_at: null, tags: [], internal_notes: "", blocked: false, marketing_opt_in: false,
    privacy_version: "2026-10-01", anonymized_at: null,
  };
  state.customers.push(c);
  return c;
}

/** Uma entrada da lista de espera, no formato de qualquer reserva da simulação. */
export function waitlistEntry(state, { date, time, people, customerId = null, name = "", source = "site", createdAt, phone = null }) {
  const starts = new Date(`${date}T${time}:00-03:00`);
  return {
    id: uuid(),
    code: `TR-${6000 + state.reservations.length * 7}`,
    customer_id: customerId,
    walk_in_name: customerId ? "" : name,
    walk_in_phone: phone,
    party_size: people,
    date,
    time,
    starts_at: starts.toISOString(),
    ends_at: new Date(starts.getTime() + 120 * MIN).toISOString(),
    duration_min: 120,
    area_preference: null,
    area_key: null,
    table_codes: [],
    status: "waitlisted",
    source,
    customer_confirmation: "not_sent",
    tolerance_min: 15,
    extra_tolerance_min: 0,
    arrived_at: null,
    seated_at: null,
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
    created_at: new Date(createdAt).toISOString(),
    table_session_id: null,
  };
}

export function extend(state, now) {
  const { date, now: clock } = nightClock(state, now);
  const ago = (minutes) => new Date(clock.getTime() - minutes * MIN);
  // Camila (dos dados iniciais básicos) é a primeira da fila às 20:00
  const camila = state.reservations.find((r) => r.date === date && r.status === "waitlisted");
  if (camila) camila.created_at = ago(95).toISOString();

  const fromSite = [
    { name: "Henrique Alves", time: "20:00", people: 4, ago: 70 },
    { name: "Letícia Prado", time: "20:30", people: 4, ago: 64, offer: "Q2" },
    { name: "Otávio Ribeiro", time: "21:00", people: 6, ago: 41 },
    { name: "Sabrina Lopes", time: "21:00", people: 2, ago: 33, unverified: true },
    { name: "Igor Matsuda", time: "21:30", people: 2, ago: 20 },
  ];
  for (const w of fromSite) {
    const c = customer(state, w.name, !w.unverified);
    const entry = waitlistEntry(state, { date, time: w.time, people: w.people, customerId: c.id, createdAt: ago(w.ago) });
    if (w.unverified) entry.phone_verified = false;
    if (w.offer) {
      // o WhatsApp não entregou esta oferta: a linha diz isso (catálogo §6)
      Object.assign(entry, { status: "offered", table_codes: [w.offer], area_key: "quintal", offer_expires_at: new Date(clock.getTime() + 6 * MIN).toISOString(), offered_at: ago(4).toISOString(), offer_message_status: "failed" });
      entry.messages = [{ id: uuid(), template: "waitlist_offer", status: "failed", sent_at: ago(4).toISOString() }];
    }
    state.reservations.push(entry);
  }

  // esperando na porta, sem reserva
  state.reservations.push(waitlistEntry(state, { date, time: "20:30", people: 5, name: "Família Okada", source: "walk_in", createdAt: ago(12) }));
  state.reservations.push(waitlistEntry(state, { date, time: "21:00", people: 2, name: "Fernando", source: "walk_in", createdAt: ago(6), phone: "+5545999871234" }));
}
