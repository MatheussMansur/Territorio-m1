// Clientes para a área Clientes do painel: as pessoas dos dados iniciais de reservas ganham um passado
// (visitas, faltas, notas, etiquetas), e clientes frequentes sem reserva nesta semana se juntam a elas,
// para a lista ter uns quarenta nomes. As noites passadas delas entram em state.reservations como
// reservas concluídas, faltas ou canceladas, para o histórico da ficha e os contadores baterem.
// Também os pedidos de privacidade (LGPD) com o prazo de 15 dias. Os telefones são inventados.
import { addDays, houseParts, weekdayOf } from "../../lib/dates.js";
import { maskPhone } from "../../lib/phone.js";
import { uuid } from "../../lib/uuid.js";

const DAY = 86_400_000;

// O que a casa sabe das pessoas que já estão nos dados iniciais de reservas (pelo nome).
const KNOWN = {
  Carla: { visits: 5, tags: ["regular"], notes: "Comemora aniversário aqui todo ano. Gosta da mesa S1, perto da janela.", area: "salao", optIn: true },
  Rafael: { visits: 2 },
  Lucas: { visits: 1 },
  Juliana: { visits: 4, notes: "Sempre vem com uma amiga vegetariana. Avisar a cozinha do guioza de legumes.", area: "quintal" },
  Diego: { visits: 1, noShows: 1, tags: ["attention"], notes: "Faltou em setembro sem avisar. Confirmar por WhatsApp no dia." },
  "Renata Souza": { visits: 7, tags: ["regular"], notes: "Vem com as crianças: separar cadeirinha. Prefere o salão, longe da caixa de som.", area: "salao", optIn: true },
  Mariana: { visits: 3, area: "quintal" },
  Bruno: { visits: 2 },
  Thiago: { visits: 6, tags: ["regular"], notes: "Pede o saquê da casa logo que senta.", area: "quintal" },
  Paula: { visits: 0 },
  Beatriz: { visits: 2, optIn: true },
  Gustavo: { visits: 3, notes: "Aniversário de 30 anos com a turma do trabalho. Grupo grande: combinar mesa comprida." },
  Camila: { visits: 1 },
  Fernanda: { visits: 2 },
  Pedro: { visits: 1 },
  Henrique: { visits: 4, area: "quintal" },
  Larissa: { visits: 1, noShows: 1 },
  Marcos: { visits: 3 },
  Aline: { visits: 5, tags: ["regular"], optIn: true },
  Rodrigo: { visits: 2 },
  "Patrícia": { visits: 1 },
  "Vinícius": { visits: 2 },
  Sofia: { visits: 0 },
  Eduardo: { visits: 3 },
  "Natália": { visits: 1 },
  Gabriel: { visits: 2 },
};

// Clientes frequentes e de uma vez só sem reserva nesta semana. Telefones: Brasil (Foz),
// Paraguai (Ciudad del Este) e Argentina (Puerto Iguazú), os três lados da fronteira.
const OTHERS = [
  { name: "João Pedro Almeida", phone: "+5545999112233", visits: 9, tags: ["regular"], area: "balcao", optIn: true, notes: "Gosta do balcão. Pede sempre o ramen shoyu e conversa com o Marcus." },
  { name: "Conceição Ferreira", phone: "+5545998765410", visits: 12, tags: ["regular"], area: "salao", optIn: true, notes: "Vem com o marido às quintas, dia de peixe. Não come camarão." },
  { name: "André Takahashi", phone: "+5545991234567", visits: 6, area: "balcao" },
  { name: "Luana Martins", phone: "+5545988776655", visits: 2, noShows: 2, tags: ["attention"], notes: "Duas faltas sem aviso. Ligar para confirmar antes de segurar mesa." },
  { name: "Matías González", phone: "+5493757412233", visits: 3, area: "quintal", locale: "es" },
  { name: "Sofía Benítez", phone: "+595983456789", visits: 4, area: "quintal", locale: "es", optIn: true },
  { name: "Ricardo Nogueira", phone: "+5545999001122", visits: 1, noShows: 3, tags: ["attention"], blocked: "Três faltas sem avisar entre agosto e setembro. Reserva só falando com a casa." },
  { name: "Helena Castro", phone: "+5545999872210", visits: 1, optIn: true },
  { name: "Felipe Yamamoto", phone: "+5545998123344", visits: 7, tags: ["regular"], area: "salao", notes: "Alergia a amendoim. Avisar a cozinha." },
  { name: "Daniela Rocha", phone: "+5545991102030", visits: 1 },
  { name: "Otávio Prates", phone: "+5545998001234", visits: 5, optIn: false },
  { name: "Valentina Duarte", phone: "+5545999334455", visits: 2, area: "quintal" },
  { name: "Caio Brandão", phone: "+5545988123456", visits: 0, noShows: 1, tags: ["attention"] },
  { name: "Lívia Sato", phone: "+5545999556677", visits: 8, tags: ["regular"], area: "quintal", optIn: true, notes: "Traz a cachorrinha. Mesa no quintal, perto da porta." },
];

const TIMES = ["19:00", "19:30", "20:00", "20:30", "21:00"];
const TABLES = { salao: ["S1", "S2", "S5", "S6"], quintal: ["Q1", "Q2", "Q4", "Q5"], balcao: ["B2", "B3"] };

/** A noite aberta (quarta a sábado) em `date` ou antes. */
function openBefore(date) {
  let d = date;
  while (![3, 4, 5, 6].includes(weekdayOf(d))) d = addDays(d, -1);
  return d;
}

let seq = 3100;

function pastReservation(customer, { date, time, size, status, area }, now) {
  const starts = new Date(`${date}T${time}:00-03:00`);
  const tables = TABLES[area] || TABLES.salao;
  const table = tables[(seq / 7) % tables.length | 0];
  seq += 13;
  const done = status === "completed";
  return {
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
    area_preference: area || null,
    area_key: area || "salao",
    table_codes: status === "canceled" ? [] : [table],
    status,
    source: seq % 3 === 0 ? "whatsapp" : "site",
    customer_confirmation: done ? "yes" : status === "no_show" ? "no_reply" : "sent",
    tolerance_min: 20,
    extra_tolerance_min: 0,
    arrived_at: done ? new Date(starts.getTime() + 6 * 60_000).toISOString() : null,
    seated_at: done ? new Date(starts.getTime() + 8 * 60_000).toISOString() : null,
    left_at: done ? new Date(starts.getTime() + 105 * 60_000).toISOString() : null,
    notes: "",
    internal_notes: "",
    flags: [],
    event_id: null,
    waitlist_position: null,
    offer_expires_at: null,
    pending_until: null,
    canceled_by: status === "canceled" ? "customer" : null,
    cancel_reason: status === "canceled" ? "Mudou de planos" : null,
    decline_reason: null,
    no_show_counted: status === "no_show" ? true : undefined,
    terms_version: "2026-10-14",
    terms_accepted_at: new Date(starts.getTime() - 3 * DAY).toISOString(),
    idempotency_key: uuid(),
    created_by: null,
    created_at: new Date(Math.min(starts.getTime() - 3 * DAY, now.getTime())).toISOString(),
  };
}

/** Monta o passado de um cliente: visitas e faltas espalhadas pelos últimos meses. */
function history(state, customer, info, today, now, index) {
  const nights = [];
  const total = (info.visits || 0) + (info.noShows || 0);
  // as faltas são as mais recentes, que é o que coloca alguém em "atenção"
  const statuses = [...Array(info.noShows || 0).fill("no_show"), ...Array(info.visits || 0).fill("completed")];
  let date = addDays(today, -(3 + ((index * 13) % 47)));
  for (let i = 0; i < total; i++) {
    date = openBefore(date);
    nights.push(pastReservation(customer, {
      date,
      time: TIMES[(index + i) % TIMES.length],
      size: [2, 2, 4, 3, 6, 2, 4][(index + i) % 7],
      status: statuses[i],
      area: info.area || ["salao", "quintal"][(index + i) % 2],
    }, now));
    date = addDays(date, -(8 + ((index * 5 + i * 11) % 23)));
  }
  // de vez em quando um cancelamento feito no prazo, que nunca conta contra ninguém
  if (index % 4 === 1) nights.push(pastReservation(customer, { date: openBefore(addDays(today, -(20 + index))), time: "20:00", size: 2, status: "canceled", area: info.area }, now));
  state.reservations.push(...nights);

  const visits = nights.filter((r) => r.status === "completed");
  customer.visits = visits.length;
  customer.no_shows = nights.filter((r) => r.status === "no_show").length;
  customer.last_visit_at = visits.map((r) => r.starts_at).sort().at(-1) || null;
  const first = nights.map((r) => r.created_at).sort()[0];
  customer.created_at = first || new Date(now.getTime() - 10 * DAY).toISOString();
}

function decorate(customer, info) {
  customer.tags = [...(info.tags || [])];
  customer.internal_notes = info.notes || "";
  customer.preferences = { area: info.area || null };
  customer.marketing_opt_in = Boolean(info.optIn);
  // "Lembrar de mim": a caixa da reserva ou o aviso de cookies, no próprio aparelho do cliente
  customer.remember_me = info.remember ?? Boolean(info.optIn);
  customer.blocked = Boolean(info.blocked);
  customer.blocked_reason = info.blocked || "";
  customer.locale = info.locale || "pt";
  customer.version = "1";
}

export function extend(state, now) {
  const today = houseParts(now).date;
  state.customers ??= [];
  state.reservations ??= [];

  state.customers.forEach((customer, index) => {
    const info = KNOWN[customer.name] || { visits: index % 4 };
    decorate(customer, info);
    history(state, customer, info, today, now, index);
  });

  const offset = state.customers.length;
  const byName = {};
  OTHERS.forEach((info, i) => {
    const customer = {
      id: uuid(),
      name: info.name,
      phone_e164: info.phone,
      phone_verified_at: new Date(now.getTime() - (30 + i) * DAY).toISOString(),
      visits: 0,
      no_shows: 0,
      last_visit_at: null,
      tags: [],
      internal_notes: "",
      blocked: false,
      marketing_opt_in: false,
      privacy_version: "2026-10-01",
      anonymized_at: null,
    };
    decorate(customer, info);
    state.customers.push(customer);
    history(state, customer, info, today, now, offset + i);
    byName[info.name] = customer;
  });

  // alguém que pediu para ser esquecido no mês passado: o histórico fica, sem nome nem telefone
  const gone = {
    id: uuid(),
    name: "Cliente anonimizado",
    phone_e164: null,
    phone_verified_at: null,
    visits: 0,
    no_shows: 0,
    last_visit_at: null,
    tags: [],
    internal_notes: "",
    blocked: false,
    marketing_opt_in: false,
    privacy_version: "2026-10-01",
    anonymized_at: new Date(now.getTime() - 26 * DAY).toISOString(),
    preferences: { area: null },
    blocked_reason: "",
    locale: "pt",
    version: "1",
  };
  state.customers.push(gone);
  history(state, gone, { visits: 2 }, addDays(today, -30), now, 3);

  // pedidos LGPD: dois perto do prazo de 15 dias, um novo e três já respondidos
  const label = (c) => (c ? `${c.name.split(" ")[0]} · ${maskPhone(c.phone_e164)}` : "cliente anonimizado");
  const request = (customer, kind, channel, openedDaysAgo, extra = {}) => {
    const opened = new Date(now.getTime() - openedDaysAgo * DAY - 3 * 3_600_000);
    return {
      id: uuid(),
      customer_id: customer?.id ?? null,
      customer_label: label(customer),
      kind,
      channel,
      status: "open",
      opened_at: opened.toISOString(),
      due_at: new Date(opened.getTime() + 15 * DAY).toISOString(),
      resolved_at: null,
      resolved_by: null,
      note: "",
      ...extra,
    };
  };
  const owner = state.users?.find((u) => u.role === "owner")?.name || "Marcus Norberto";
  const resolved = (days) => ({ resolved_at: new Date(now.getTime() - days * DAY).toISOString(), resolved_by: owner });
  state.privacy_requests = [
    request(byName["Daniela Rocha"], "deletion", "whatsapp", 13, { note: "Pediu pelo WhatsApp para apagar os dados depois que mudou de cidade." }),
    request(byName["Helena Castro"], "access", "account", 11, { note: "Pedido feito pela conta no site: quer saber o que a casa guarda." }),
    request(byName["Otávio Prates"], "opt_out", "email", 3, { note: "Não quer mais receber novidades." }),
    request(byName["Matías González"], "portability", "email", 24, { status: "done", ...resolved(18), note: "Mandamos o arquivo por e-mail." }),
    { ...request(null, "deletion", "account", 31, { status: "done", ...resolved(26) }), customer_label: "cliente anonimizado" },
    request(byName["Caio Brandão"], "correction", "in_person", 40, { status: "rejected", ...resolved(33), note: "Pediu para tirar uma falta; a reserva e a falta conferem com o registro da noite." }),
  ];
}

