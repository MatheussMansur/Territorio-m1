// Dados fictícios para desenvolvimento e para a demonstração ao cliente, montados em volta da data de hoje para a
// demonstração sempre ter uma noite em andamento. Nomes e mesas são os do fluxo
// aprovado; os telefones são inventados e nunca recebem nada.
import { addDays, houseParts, toMinutes, weekdayOf } from "../lib/dates.js";
import { uuid } from "../lib/uuid.js";
import CONTENT from "../content/content.json" with { type: "json" };
import MENU_CONTENT from "../content/menu.json" with { type: "json" };

const SLOTS = ["19:00", "19:30", "20:00", "20:30", "21:00", "21:30"];
const id = () => uuid();

function week(layoutId) {
  return [0, 1, 2, 3, 4, 5, 6].map((weekday) =>
    weekday >= 3 && weekday <= 6
      ? { weekday, open: true, opens_at: "19:00", closes_at: "23:30", slots: [...SLOTS], layout_id: layoutId }
      : { weekday, open: false, reason: weekday === 0 ? "closed" : "production", label: weekday === 0 ? "fechado" : "produção", layout_id: layoutId },
  );
}

// Os combinados da própria casa (mandados em 14/10/2026), como modelos: os números ({tolerancia},
// {extra}, {prazo}, {faltas}) vêm das configurações de reserva quando a API responde.
const TERMS = {
  version: "2026-10-14",
  items: CONTENT.terms.map((term) => ({ title: term.title.pt, text: term.text.pt })),
};

// A planta do salão estimada pelas fotos (a real vem da casa), em três
// versões: a noite padrão, uma noite de chuva sem o quintal, e um modelo para eventos
// no quintal com uma lista em vez de mesas.
function areasAndLayouts() {
  const areas = [
    { id: id(), key: "salao", name: "Salão · dentro", sort: 1 },
    { id: id(), key: "quintal", name: "Quintal", sort: 2 },
    { id: id(), key: "balcao", name: "Balcão", sort: 3 },
  ];
  const t = (code, area, seats, shape = "square", extra = {}) => ({
    code,
    area,
    min_seats: seats >= 4 ? 3 : 1,
    max_seats: seats,
    shape,
    x: 0,
    y: 0,
    bookable_online: area !== "balcao",
    priority: 1,
    ...extra,
  });
  const standardTables = [
    t("S1", "salao", 4), t("S2", "salao", 4), t("S3", "salao", 4), t("S4", "salao", 4), t("S5", "salao", 2), t("S6", "salao", 2),
    t("Q1", "quintal", 4, "round"), t("Q2", "quintal", 4, "round"), t("Q3", "quintal", 6), t("Q4", "quintal", 4, "round"),
    t("Q5", "quintal", 4, "round"), t("Q6", "quintal", 6), t("Q7", "quintal", 2, "round"), t("Q8", "quintal", 2, "round"),
    ...["B1", "B2", "B3", "B4", "B5", "B6"].map((c) => t(c, "balcao", 1, "stool")),
  ];
  const place = (tables) => {
    const perArea = {};
    for (const table of tables) {
      const n = (perArea[table.area] = (perArea[table.area] ?? -1) + 1);
      table.x = n % 4;
      table.y = Math.floor(n / 4);
    }
    return tables;
  };
  const standard = {
    id: id(),
    name: "Padrão",
    description: "Salão e quintal com mesas; balcão para quem chega sem reserva.",
    archived: false,
    areas: [
      { key: "salao", mode: "tables", list_capacity: null, bookable_online: true },
      { key: "quintal", mode: "tables", list_capacity: null, bookable_online: true },
      { key: "balcao", mode: "tables", list_capacity: null, bookable_online: false },
    ],
    tables: place(standardTables.map((x) => ({ ...x }))),
    combos: [{ codes: ["S3", "S4"], max_seats: null, label: null }],
  };
  const rain = {
    ...structuredClone(standard),
    id: id(),
    name: "Sem quintal (chuva)",
    description: "Só o salão e o balcão.",
    areas: standard.areas.map((a) => (a.key === "quintal" ? { ...a, mode: "closed" } : { ...a })),
  };
  const backyardEvent = {
    id: id(),
    name: "Evento no quintal (modelo)",
    description: "Salão com mesas; quintal com lista por pessoa e mesa comprida. Capacidade de exemplo: ajustar com a casa.",
    archived: false,
    areas: [
      { key: "salao", mode: "tables", list_capacity: null, bookable_online: true },
      { key: "quintal", mode: "list", list_capacity: 40, bookable_online: true },
      { key: "balcao", mode: "tables", list_capacity: null, bookable_online: false },
    ],
    tables: place([
      ...standardTables.filter((x) => x.area !== "quintal").map((x) => ({ ...x })),
      t("QC", "quintal", 12, "long", { bookable_online: false }),
    ]),
    combos: [{ codes: ["S3", "S4"], max_seats: null, label: null }],
  };
  return { areas, layouts: [standard, rain, backyardEvent] };
}

// A noite do fluxo aprovado: quem vem, quando, onde.
const NIGHT = [
  { name: "Carla", size: 4, time: "19:00", tables: ["S1"], notes: "aniversário", flags: ["birthday"], conf: "yes" },
  { name: "Rafael", size: 2, time: "19:00", tables: ["Q7"], conf: "sent" },
  { name: "Lucas", size: 2, time: "19:00", tables: ["Q8"], conf: "yes" },
  { name: "Juliana", size: 6, time: "19:30", tables: ["Q3"], notes: "1 vegetariano", flags: ["dietary"], conf: "yes" },
  { name: "Diego", size: 2, time: "19:30", tables: ["S5"], conf: "sent" },
  { name: "Renata Souza", size: 8, time: "20:00", tables: ["S3", "S4"], notes: "cadeirinha", flags: ["high_chair"], conf: "yes" },
  { name: "Mariana", size: 2, time: "20:00", tables: ["Q1"], area: "quintal", conf: "sent" },
  { name: "Bruno", size: 6, time: "20:00", tables: ["Q6"], conf: "yes" },
  { name: "Thiago", size: 4, time: "20:30", tables: ["Q4"], conf: "sent" },
  { name: "Paula", size: 2, time: "21:00", tables: ["S6"], conf: "not_sent" },
  { name: "Beatriz", size: 4, time: "21:30", tables: ["Q5"], conf: "not_sent" },
  { name: "Gustavo", size: 10, time: "20:30", tables: [], status: "pending", notes: "aniversário de 30 anos", flags: ["birthday"] },
  { name: "Camila", size: 2, time: "20:00", tables: [], status: "waitlisted" },
];

// Noites mais leves para os próximos dias abertos, para a disponibilidade variar na demonstração.
const LATER = [
  [
    { name: "Fernanda", size: 2, time: "19:30", tables: ["S5"] },
    { name: "Pedro", size: 4, time: "20:00", tables: ["Q2"] },
    { name: "Henrique", size: 6, time: "20:30", tables: ["Q3"] },
    { name: "Larissa", size: 2, time: "21:00", tables: ["Q7"] },
  ],
  [
    { name: "Marcos", size: 4, time: "19:00", tables: ["S1"] },
    { name: "Aline", size: 4, time: "19:00", tables: ["S2"] },
    { name: "Rodrigo", size: 6, time: "19:30", tables: ["Q6"] },
    { name: "Patrícia", size: 4, time: "20:00", tables: ["Q1"] },
    { name: "Vinícius", size: 4, time: "20:00", tables: ["Q2"] },
    { name: "Sofia", size: 2, time: "20:00", tables: ["S6"] },
    { name: "Eduardo", size: 4, time: "20:30", tables: ["Q4"] },
    { name: "Natália", size: 4, time: "20:30", tables: ["Q5"] },
    { name: "Gabriel", size: 6, time: "21:00", tables: ["Q3"] },
  ],
];

// Textos alternativos das fotos do cardápio, do site aprovado.
const PHOTO_ALT = {
  mesa: "Mesa com pratos para compartilhar",
  ramen: "Ramen shoyu",
  oniguiri: "Oniguiri grelhado",
  balcao: "Duas pessoas da equipe abraçadas atrás do balcão",
};


// O cardápio é o mesmo arquivo de onde o site é montado (src/content/menu.json), no formato da API.
function menu() {
  return MENU_CONTENT.categories.map((c, ci) => {
    const categoryId = id();
    return {
      id: categoryId, name: c.name.pt, subtitle: c.subtitle?.pt ?? "", sheet_style: c.style === "handmade" ? "handmade" : "dark",
      footer: c.hand, photo: c.photo, photo_alt: PHOTO_ALT[c.photo] ?? null, image_id: null, sort: ci,
      items: c.items.map((item, i) => ({
        id: id(), category_id: categoryId, name: item.name, description: item.description?.pt ?? "", group: item.group?.pt ?? null,
        price_cents: item.price_cents, price_label: null, badges: item.badges, available: item.available, featured: false, sort: i,
      })),
    };
  });
}

function content() {
  return {
    cover: {
      kicker: "Izakaya com sotaque da fronteira · Foz do Iguaçu",
      tagline: "Pode entrar! A casa é sua!",
      lede: "Comida pra compartilhar, boa bebida e música um pouco mais alta, na casa do chef Marcus Norberto.",
    },
    today_rules: [{ weekday: 4, text: "Toda quinta é dia de peixe fresco!" }],
    today_default: "Casa aberta a partir das 19:00.",
    about: {
      title: "A casa",
      text: "Aqui é tudo feito na hora, sem mistério e sem segredo… é tudo de verdade!",
      signature: "Se aprochegue!",
    },
    experience: { points: ["Comida pra compartilhar", "Música um pouco mais alta", "Casa aberta de quarta a sábado"] },
    links: { instagram: "_territorio_", shop: "lojinhadoterritorio" },
    seo: {
      title: "Território · Izakaya com sotaque da fronteira · Foz do Iguaçu",
      description: "Comida pra compartilhar, boa bebida e música um pouco mais alta. Reserve sua mesa.",
    },
    notices: [],
    testimonials: [],
  };
}

/** Próximo dia aberto em `date` ou depois. */
function nextOpen(hours, date) {
  for (let i = 0; i < 8; i++) {
    const d = addDays(date, i);
    if (hours.find((h) => h.weekday === weekdayOf(d))?.open) return d;
  }
  return date;
}

let seq = 4800;
function reservation(state, night, date, now, extra = {}) {
  const phone = `+554590000${String(state.customers.length + 10).padStart(4, "0")}`;
  const customer = {
    id: id(), name: night.name, phone_e164: phone, phone_verified_at: now.toISOString(),
    visits: (state.customers.length * 7) % 5, no_shows: 0, last_visit_at: null, tags: [], internal_notes: "",
    blocked: false, marketing_opt_in: false, privacy_version: "2026-10-01", anonymized_at: null,
  };
  state.customers.push(customer);
  const areaOf = Object.fromEntries(state.layouts[0].tables.map((t) => [t.code, t.area]));
  const [h, m] = night.time.split(":").map(Number);
  const starts = new Date(`${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00-03:00`);
  const status = night.status || "confirmed";
  seq += 37;
  return {
    id: id(),
    code: `TR-${seq}`,
    public_token: uuid().replace(/-/g, "") + uuid().replace(/-/g, ""),
    customer_id: customer.id,
    party_size: night.size,
    date,
    time: night.time,
    starts_at: starts.toISOString(),
    ends_at: new Date(starts.getTime() + 120 * 60_000).toISOString(),
    duration_min: 120,
    area_preference: night.area || null,
    area_key: night.tables.length ? areaOf[night.tables[0]] : night.area || null,
    table_codes: [...night.tables],
    status,
    source: "site",
    customer_confirmation: night.conf || "not_sent",
    tolerance_min: 15,
    extra_tolerance_min: 0,
    arrived_at: null,
    seated_at: null,
    left_at: null,
    notes: night.notes || "",
    internal_notes: "",
    flags: night.flags || [],
    event_id: null,
    waitlist_position: status === "waitlisted" ? 1 : null,
    offer_expires_at: null,
    // a casa responde em até 4 horas, e nunca depois de 2 horas antes da mesa
    pending_until: status === "pending" ? new Date(Math.min(now.getTime() + 4 * 3_600_000, starts.getTime() - 2 * 3_600_000)).toISOString() : null,
    canceled_by: null,
    cancel_reason: null,
    decline_reason: null,
    terms_version: TERMS.version,
    terms_accepted_at: now.toISOString(),
    idempotency_key: id(),
    created_by: null,
    created_at: new Date(now.getTime() - (toMinutes(night.time) % 97) * 60_000 * 13).toISOString(),
    ...extra,
  };
}

export function buildSeeds(now = new Date()) {
  const today = houseParts(now).date;
  const { areas, layouts } = areasAndLayouts();
  const hours = week(layouts[0].id);
  const state = {
    version: 3, // db.js carimba a própria VERSION depois que os dados iniciais das áreas são acrescentados
    seeded_for: today,
    house: {
      id: id(),
      name: "Território",
      tagline: "Izakaya com sotaque da fronteira",
      address: { street: "Rua Sérgio Roncato", number: "703", district: "Ipê", city: "Foz do Iguaçu", state: "PR", zip: "85869-090", lat: -25.4878224, lng: -54.5669192 },
      whatsapp: "+5545998304994",
      instagram: "_territorio_",
      timezone: "America/Sao_Paulo",
      locale: "pt-BR",
    },
    hours,
    hours_confirmed: false,
    booking: {
      window_days: 30, min_lead_min: 60, party_max_online: 8, large_group_action: "request",
      approval_mode: "rules", approval_rules: { party_over: 8, customer_no_shows_at_least: 1, special_events: true },
      pending_expiry_hours: 4, tolerance_min: 20, extra_tolerance_min: 10, after_tolerance: "lose_priority", late_notice_enabled: true, duration_rules: [{ party_max: 20, minutes: 120 }],
      cancel_until_hours: 2, customer_can_cancel_late: true, max_active_per_phone: 2, waitlist_enabled: true, waitlist_offer_min: 10,
      walk_in_policy: "counter", google_login: false,
    },
    terms: TERMS,
    privacy: { retention_months: 24, privacy_version: "2026-10-01" },
    areas,
    layouts,
    day_plans: {},
    events: [],
    customers: [],
    reservations: [],
    menu: menu(),
    content: content(),
    users: [
      { id: id(), name: "Marcus Norberto", email: "marcus@territorio.test", role: "owner", status: "active", mfa_enabled: false, last_login_at: null },
      { id: id(), name: "Gerente da casa", email: "gerente@territorio.test", role: "manager", status: "active", mfa_enabled: false, last_login_at: null },
      { id: id(), name: "Salão", email: "salao@territorio.test", role: "floor", status: "active", mfa_enabled: false, last_login_at: null },
    ],
    audit: [],
    idempotency: {},
  };

  // Um rascunho de evento para mostrar como os eventos funcionam; não publicado, então o site nunca mostra.
  let friday = today;
  while (weekdayOf(friday) !== 5) friday = addDays(friday, 1);
  state.events.push({
    id: id(),
    title: "Forró no quintal",
    date: addDays(friday, 7),
    starts_at: "20:00",
    ends_at: null,
    description: "Rascunho de exemplo para a demonstração.",
    image_id: null,
    published: false,
    booking_mode: "mixed",
    list_capacity: 40,
    entry_times: ["20:00", "21:00"],
    party_max: 8,
    requires_approval: false,
    price_cents: null,
    layout_id: layouts[2].id,
    internal_note: "Exemplo: ajustar data, capacidade e texto com o Marcus antes de publicar.",
  });

  const tonight = nextOpen(hours, today);
  for (const night of NIGHT) state.reservations.push(reservation(state, night, tonight, now));
  let day = tonight;
  for (const nights of LATER) {
    day = nextOpen(hours, addDays(day, 1));
    for (const night of nights) state.reservations.push(reservation(state, night, day, now));
  }
  return state;
}
