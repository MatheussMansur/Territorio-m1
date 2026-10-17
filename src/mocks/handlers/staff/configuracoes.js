// Configurações: o índice das configurações, um documento por grupo (ler, prévia, gravar com
// If-Match), os aparelhos da casa (parear, aprovar, renomear, revogar) e o assistente de
// primeiro uso. Os limites de cada campo moram aqui, como estariam no esquema do servidor: o painel
// lê esses limites de `meta` e nunca guarda uma cópia.
import { http, HttpResponse } from "msw";
import { addDays, houseParts, toMinutes, weekdayOf } from "../../../lib/dates.js";
import { session } from "../../../lib/storage.js";
import { uuid } from "../../../lib/uuid.js";
import { getState, save } from "../../db.js";
import { currentRole, currentScenario, mockNow, problem, respond } from "../../scenario.js";
import { extend as seedSettings } from "../../seeds/configuracoes.js";
import { integrationItems } from "./sistema.js";
import { buildView, requestBuild, settleBuilds } from "./site.js";

const API = "/api/v1";
const REAUTH_KEY = "territorio:mock-reauth";
const CONFLICT_KEY = "territorio:mock-conflito";
const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

// ---- o esquema de cada grupo: limites, opções e o que acontece com as reservas já feitas ----
// scope: future = só reservas novas; all = na hora para toda reserva; recalculates = passa
// pela simulação do plano do dia; none = nenhuma reserva muda.
const num = (min, max, scope = "none", extra = {}) => ({ type: "integer", min, max, scope, ...extra });
const bool = (scope = "none") => ({ type: "boolean", scope });
const pick = (options, scope = "none") => ({ type: "enum", options, scope });
const text = (min, max, extra = {}) => ({ type: "string", min_length: min, max_length: max, scope: "none", ...extra });
const words = (max, extra = {}) => ({ type: "localized", max_length: max, scope: "none", ...extra });
const fixed = (extra = {}) => ({ read_only: true, scope: "none", ...extra });

const SCHEMA = {
  house: {
    name: text(2, 60),
    tagline: words(60),
    address: { type: "address", scope: "none" },
    whatsapp: text(8, 20, { format: "e164" }),
    instagram: text(8, 200, { format: "url" }),
    shop_url: text(8, 200, { format: "url", nullable: true }),
    legal_footer: { type: "object", scope: "none" },
    timezone: fixed(),
    night_cutoff: fixed(),
  },
  hours: {
    week: { type: "week", scope: "recalculates" },
    closed_labels: { type: "labels", max_length: 30, scope: "none" },
    max_shifts_per_day: num(1, 2, "recalculates"),
    confirmed: bool(),
  },
  access: {
    session_hours: num(1, 24),
    remember_days: num(1, 90),
    reception_idle_min: num(5, 60, "none", { step: 5 }),
    pin_rule: fixed(),
    pin_max_attempts: fixed(),
    pin_lock_min: fixed(),
    totp_required_roles: fixed(),
    reauth_valid_min: fixed(),
  },
  alerts: {
    pending_to: { type: "people", scope: "none" },
    late_request_to: { type: "people", scope: "none" },
    privacy_request_to: { type: "people", scope: "none" },
    security_to: { type: "people", scope: "none" },
    system_to: { type: "people", scope: "none" },
    quiet_from: { type: "time", scope: "none" },
    quiet_to: { type: "time", scope: "none" },
  },
  appearance: { palette: fixed(), dark_theme: fixed(), visitor_theme: fixed() },
  booking: {
    online_enabled: bool("future"),
    window_days: num(1, 120, "future"),
    min_lead_min: num(0, 2880, "future", { step: 30 }),
    first_arrival: { type: "time", scope: "recalculates" },
    last_arrival: { type: "time", scope: "recalculates" },
    slot_interval_min: pick([15, 30, 60], "recalculates"),
    party_max_online: num(2, 20, "future"),
    large_group_action: pick(["whatsapp", "request"], "future"),
    duration_min: num(30, 300, "future", { step: 15, nullable: true }),
    // os minutos que um dia ou um tamanho de grupo pode ter; "livre" (null) é permitido por dia
    duration_by_weekday: { type: "weekday_minutes", min: 30, max: 300, nullable: true, options: [60, 90, 105, 120, 135, 150, 180, 210, 240, 300], scope: "future" },
    duration_rules: { type: "rules", min: 30, max: 300, options: [60, 90, 120, 150, 180, 240], party_min: 1, party_max: 20, max_items: 4, scope: "future" },
    tolerance_min: num(0, 60, "all", { step: 5 }),
    extra_tolerance_min: num(0, 30, "all", { step: 5 }),
    after_tolerance: pick(["lose_priority", "release"], "all"),
    late_notice_enabled: bool("all"),
    cancel_until_hours: num(0, 72, "future"),
    customer_can_reschedule: bool("all"),
    customer_can_cancel_late: bool("all"),
    max_active_per_phone: num(1, 10, "future"),
    max_covers_per_slot: num(1, 200, "future", { nullable: true, step: 2 }),
    max_covers_night: num(1, 400, "future", { nullable: true, step: 5 }),
    few_left_pct: num(5, 50, "none", { step: 5 }),
    late_request_alert_hours: num(0, 24),
    google_login: bool(),
    one_active_per_slot: fixed(),
  },
  terms: {
    version: fixed(),
    items: { type: "terms", min_items: 1, max_items: 6, max_length: 240, scope: "none", placeholders: ["tolerancia", "extra", "prazo", "faltas", "tempo"] },
    show_duration_item: bool(),
    accept_label: words(40),
  },
  approval_no_shows: {
    approval_mode: pick(["auto", "manual", "rules"], "all"),
    rule_party_over: num(2, 20, "all"),
    rule_no_shows_enabled: bool("all"),
    rule_no_shows_count: num(1, 5, "all"),
    rule_no_shows_window_months: num(1, 24, "all"),
    pending_message: words(160),
    undo_no_show_hours: num(0, 72),
    pending_expiry_hours: num(1, 24, "all"),
    pending_expiry_before_min: fixed(),
  },
  waitlist: {
    online_enabled: bool("future"),
    offer_min: num(5, 60, "all"),
    offer_only_before_time: bool("all"),
    max_per_slot: num(1, 50, "future"),
    walk_in_enabled: bool(),
    notify_on_capacity_gain: bool(),
  },
  floor: {
    on_tolerance_end: pick(["suggest_no_show", "auto_release"], "all"),
    release_hint_min: num(0, 60, "none", { step: 5 }),
    undo_check_in_min: num(0, 60, "none", { step: 5 }),
    walk_in_areas: { type: "areas", scope: "none" },
    night_close_delay_min: num(0, 240, "none", { step: 15 }),
    print_sheet_mode: pick(["at_open", "at_time", "off"]),
    print_sheet_at: { type: "time", nullable: true, scope: "none" },
    reception_can_finish: bool(),
    reception_reschedule: pick(["same_day", "never"]),
  },
  messages: {
    reminder_enabled: bool("all"),
    reminder_mode: pick(["before_open", "fixed_time"], "all"),
    reminder_offset_min: num(30, 600, "all", { step: 30 }),
    reminder_at: { type: "time", nullable: true, scope: "all" },
    reply_deadline_offset_min: fixed(),
    reminder_buttons: fixed(),
    auto_reply_enabled: bool(),
    auto_reply_text: words(300),
    waitlist_joined_enabled: bool(),
    waitlist_closed_enabled: bool(),
    ready_messages: { type: "ready", max_items: 3, max_length: 160, scope: "none" },
    daily_cap: fixed(),
    message_language: fixed(),
  },
  events: {
    default_booking_mode: pick(["tables", "list", "mixed", "private", "none"]),
    site_agenda: pick(["only_with_event", "always"]),
  },
  site: {
    languages: { type: "locales", options: ["pt", "es", "en"], scope: "none" },
    default_language: pick(["pt", "es", "en"]),
  },
  menu: { unpriced_item: pick(["hide", "ask"]), show_sold_out: bool() },
  privacy: {
    customer_retention_months: num(6, 60),
    dietary_retention_days: num(1, 90),
    audit_retention_months: num(6, 60),
    subject_response_days: fixed(),
    dpo_contact: text(5, 120),
    privacy_version: fixed(),
    privacy_published_at: fixed(),
  },
  cookies: { categories: fixed(), banner_text: words(280), banner_version: fixed(), measurement_enabled: bool() },
  integrations: { items: fixed() },
};

const GROUPS = Object.keys(SCHEMA);
const OWNER_ONLY = new Set(["access", "integrations"]);
const READ_ONLY = new Set(["integrations", "appearance"]);
const SITE_GROUPS = new Set(["house", "hours", "site", "menu", "events", "cookies"]);
const RETENTION = ["customer_retention_months", "dietary_retention_days", "audit_retention_months"];

// ---- funções de apoio -------------------------------------------------------------------

function load() {
  const now = mockNow();
  const state = getState(now);
  // um banco gravado antes de esta área existir ganha suas configurações agora
  if (!state.settings) {
    seedSettings(state, now);
    save();
  }
  if (!state.floor_settings) {
    mirrorAll(state);
    save();
  }
  // as linhas do WhatsApp e do Google são ao vivo, as mesmas que Sistema lê (N16)
  integrationItems(state, now, currentScenario());
  return { state, now };
}

const clone = (value) => structuredClone(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const userOf = (state) => state.users.find((u) => u.role === currentRole() && u.status === "active");
const today = (now) => houseParts(now).date;

function futureReservations(state, now) {
  const day = today(now);
  return state.reservations.filter((r) => r.date >= day && ["confirmed", "pending", "waitlisted"].includes(r.status));
}

function closesMinutes(day) {
  const opens = toMinutes(day.opens_at || "19:00");
  let closes = toMinutes(day.closes_at || "23:30");
  if (closes <= opens) closes += 1440; // depois da meia-noite pertence à noite que abriu
  return closes;
}

function slotsFor(first, last, interval) {
  const out = [];
  for (let m = toMinutes(first); m <= toMinutes(last); m += Number(interval) || 30) {
    out.push(`${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  return out;
}

const hhmm = (minutes) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

function hash(value) {
  let h = 2166136261;
  for (const ch of JSON.stringify(value)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h.toString(36);
}

/** "sem tradução em espanhol" para todo texto traduzível que não tem uma língua. */
function missingLanguages(entries) {
  const out = [];
  for (const [what, value] of entries) {
    if (!value || typeof value !== "object") continue;
    const missing = ["es", "en"].filter((l) => !String(value[l] ?? "").trim());
    if (missing.length === 2) out.push(`${what}: sem tradução em espanhol e inglês`);
    else if (missing.length === 1) out.push(`${what}: sem tradução em ${missing[0] === "es" ? "espanhol" : "inglês"}`);
  }
  return out;
}

function pendingOf(group, data) {
  switch (group) {
    case "house":
      return missingLanguages([["Assinatura", data.tagline]]);
    case "hours":
      return [
        ...(data.confirmed ? [] : ["Horário a confirmar com a casa"]),
        ...missingLanguages([["Motivo dos dias fechados", data.closed_labels.find((c) => !c.label.es || !c.label.en)?.label]]),
      ];
    case "terms":
      return missingLanguages([
        ...data.items.flatMap((item, i) => [[`Item ${i + 1}`, item.text]]),
        ["Botão de aceite", data.accept_label],
      ]);
    case "approval_no_shows":
      return missingLanguages([["Mensagem do pendente", data.pending_message]]);
    case "messages":
      return [
        ...data.ready_messages.filter((m) => m.status === "pending").map((m) => `“${m.text.pt}” aguardando a Meta`),
        ...data.ready_messages.filter((m) => m.status === "rejected").map((m) => `“${m.text.pt}” recusada pela Meta`),
        ...missingLanguages(data.ready_messages.map((m, i) => [`Mensagem pronta ${i + 1}`, m.text])),
      ];
    case "cookies":
      return missingLanguages([["Texto do aviso", data.banner_text]]);
    case "integrations":
      return data.items.filter((i) => i.state === "problem").map((i) => `${INTEGRATION_NAMES[i.key]} com problema`);
    default:
      return [];
  }
}

const INTEGRATION_NAMES = {
  whatsapp: "WhatsApp", google: "Google", turnstile: "Turnstile", email: "E-mail",
  database: "Banco de dados", measurement: "Medição", monitor: "Monitor", errors: "Erros",
};

function summaryOf(group, data) {
  const s = {
    house: () => data.name,
    hours: () => {
      const open = data.week.filter((d) => d.open);
      const first = open[0];
      const two = Number(data.max_shifts_per_day) === 2 && open.some((d) => d.second_shift) ? " · dois turnos" : "";
      return first ? `${open.map((d) => WEEKDAYS[d.weekday].slice(0, 3)).join(", ")} · ${first.opens_at} às ${first.closes_at}${two}` : "fechado";
    },
    access: () => `sessão ${data.session_hours} h`,
    alerts: () => `silêncio ${data.quiet_from}–${data.quiet_to}`,
    appearance: () => "papel e ferro",
    booking: () => `tolerância ${data.tolerance_min} min`,
    terms: () => `${data.items.length} itens`,
    approval_no_shows: () => ({ auto: "automática", manual: "tudo pela casa", rules: "por regra" })[data.approval_mode],
    waitlist: () => (data.online_enabled ? `oferta ${data.offer_min} min` : "desligada"),
    floor: () => (data.on_tolerance_end === "auto_release" ? "solta a mesa sozinho" : "sugere “Não veio”"),
    messages: () => (data.reminder_enabled ? `lembrete ${Math.round(data.reminder_offset_min / 60)} h antes` : "lembrete desligado"),
    events: () => ({ tables: "mesas", list: "lista", mixed: "misto", private: "privado", none: "sem reserva" })[data.default_booking_mode],
    site: () => data.languages.join(", ").toUpperCase(),
    menu: () => (data.unpriced_item === "hide" ? "sem preço some" : "sem preço: consulte"),
    privacy: () => `clientes ${data.customer_retention_months} meses`,
    cookies: () => `versão ${data.banner_version}`,
    integrations: () => `${data.items.filter((i) => i.state === "ok").length} ligadas`,
  };
  return s[group]?.() ?? "";
}

function metaOf(group) {
  return Object.fromEntries(
    Object.entries(SCHEMA[group]).map(([field, rule]) => [field, { ...rule, read_only: Boolean(rule.read_only) || READ_ONLY.has(group) }]),
  );
}

function contextOf(state, now) {
  const future = futureReservations(state, now);
  const day = today(now);
  const versions = (state.terms_versions || []).map((v) => ({
    ...v,
    future_reservations: future.filter((r) => r.terms_version === v.version).length,
  }));
  return {
    future_reservations: future.length,
    reservations_today: future.filter((r) => r.date === day).length,
    reminders_next: future.filter((r) => r.date <= addDays(day, 1) && r.status === "confirmed").length,
    waitlist_today: state.reservations.filter((r) => r.date === day && r.status === "waitlisted").length,
    terms_versions: versions,
    layouts: state.layouts.filter((l) => !l.archived).map((l) => ({ id: l.id, name: l.name })),
    areas: state.areas.map((a) => ({ key: a.key, name: a.name })),
    users: state.users.filter((u) => u.status === "active").map((u) => ({ id: u.id, name: u.name, role: u.role, has_phone: Boolean(u.phone_e164) })),
    booking: {
      tolerance_min: state.settings.booking.data.tolerance_min,
      extra_tolerance_min: state.settings.booking.data.extra_tolerance_min,
      cancel_until_hours: state.settings.booking.data.cancel_until_hours,
      duration_min: state.settings.booking.data.duration_min,
      duration_by_weekday: clone(state.settings.booking.data.duration_by_weekday || []),
      last_arrival: state.settings.booking.data.last_arrival,
      party_max_online: state.settings.booking.data.party_max_online,
      after_tolerance: state.settings.booking.data.after_tolerance,
      no_shows: state.settings.approval_no_shows.data.rule_no_shows_count,
    },
    // a outra metade da regra do fim da tolerância, para a mesa única (história 2.12)
    floor: { on_tolerance_end: state.settings.floor.data.on_tolerance_end },
  };
}

function documentOf(state, now, group, scenario) {
  const stored = state.settings[group];
  const empty = scenario === "vazio";
  return {
    group,
    version: String(stored.version),
    updated_by: empty ? null : stored.updated_by,
    updated_at: empty ? null : stored.updated_at,
    data: clone(stored.data),
    meta: metaOf(group),
    pending: pendingOf(group, stored.data),
    context: contextOf(state, now),
  };
}

const visibleTo = (role, group) => role === "owner" || (role === "manager" && !OWNER_ONLY.has(group));

function guard(state, group) {
  const user = userOf(state);
  if (!user) return problem(401, "unauthorized", "Entre para continuar");
  if (!GROUPS.includes(group)) return problem(404, "not_found", "Esse grupo não existe");
  if (!visibleTo(user.role, group)) return problem(403, "forbidden", "Essa parte é só do dono", { detail: "Essa parte é só do dono." });
  return null;
}

// ---- validação: limites dos campos, depois regras entre campos e entre grupos ------------

function validate(state, group, data) {
  const errors = [];
  // `link` é o atalho para o grupo onde mora a outra metade da regra
  const add = (field, message, link = null) => errors.push(link ? { field, message, link } : { field, message });
  const TO_BOOKING = { href: "/admin/configuracoes/reservas", label: "Abrir Reservas" };
  const TO_HOURS = { href: "/admin/configuracoes/horarios", label: "Abrir Horários" };
  for (const [field, rule] of Object.entries(SCHEMA[group])) {
    const value = data[field];
    if (rule.read_only || value === undefined) continue;
    if (rule.type === "integer") {
      if (value === null) {
        if (!rule.nullable) add(field, "Esse campo precisa de um número.");
      } else if (!Number.isInteger(value)) add(field, "Use um número inteiro.");
      else if (value < rule.min) add(field, `Esse campo começa em ${rule.min}.`);
      else if (value > rule.max) add(field, `Esse campo vai até ${rule.max}.`);
    }
    if (rule.type === "enum" && !rule.options.includes(value)) add(field, "Escolha uma das opções.");
    if (rule.type === "time" && value !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) add(field, "Use a hora no formato 20:30.");
    if (rule.type === "time" && value === null && !rule.nullable) add(field, "Escolha uma hora.");
    if (rule.type === "string") {
      const v = String(value ?? "").trim();
      if (!v && rule.nullable) continue;
      if (v.length < rule.min_length) add(field, `Escreva pelo menos ${rule.min_length} caracteres.`);
      else if (v.length > rule.max_length) add(field, `Esse campo vai até ${rule.max_length} caracteres.`);
      else if (rule.format === "e164" && !/^\+[1-9]\d{9,14}$/.test(v)) add(field, "Use o número com país e DDD, como +55 45 99830-4994.");
      else if (rule.format === "url" && !/^https?:\/\/[^\s.]+\.[^\s]+$/.test(v)) add(field, "Esse endereço não parece um link. Comece com https://");
    }
    if (rule.type === "localized") {
      if (!String(value?.pt ?? "").trim()) add(`${field}.pt`, "O texto em português é obrigatório.");
      for (const l of ["pt", "es", "en"]) {
        if (String(value?.[l] ?? "").length > rule.max_length) add(`${field}.${l}`, `Esse texto vai até ${rule.max_length} caracteres.`);
      }
    }
  }

  if (group === "house") {
    const { lat, lng } = data.address || {};
    if (!(lat >= -90 && lat <= 90)) add("address.lat", "A latitude vai de -90 a 90.");
    if (!(lng >= -180 && lng <= 180)) add("address.lng", "A longitude vai de -180 a 180.");
    if (!String(data.address?.street ?? "").trim()) add("address.street", "Escreva a rua.");
    if (data.legal_footer?.enabled && !/^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/.test(String(data.legal_footer.cnpj ?? "").trim())) {
      add("legal_footer.cnpj", "Use o CNPJ com 14 números.");
    }
  }

  if (group === "hours") {
    const last = state.settings.booking.data.last_arrival;
    data.week.forEach((day, i) => {
      if (!day.open) return;
      if (!/^\d\d:\d\d$/.test(day.opens_at || "") || !/^\d\d:\d\d$/.test(day.closes_at || "")) return add(`week[${i}].closes_at`, `Falta a hora de ${WEEKDAYS[day.weekday]}.`);
      if (toMinutes(last) > closesMinutes(day) - 30) {
        add(`week[${i}].closes_at`, `O último horário de chegada (${last}, em Reservas) fica fora do horário aberto de ${WEEKDAYS[day.weekday]}.`, TO_BOOKING);
      }
      const delay = state.settings.floor.data.night_close_delay_min;
      if (closesMinutes(day) + delay > 1440 + 5 * 60) {
        add(`week[${i}].closes_at`, `Com o fechamento da noite ${delay / 60} h depois, ${WEEKDAYS[day.weekday]} passaria da virada das 05:00.`);
      }
    });
    // o outro turno de um dia (história 2.8): só com dois turnos, dentro da noite, nunca por cima do principal
    data.week.forEach((day, i) => {
      const extra = day.second_shift;
      if (!day.open || !extra || Number(data.max_shifts_per_day) !== 2) return;
      const field = `week[${i}].second_shift`;
      if (!/^\d\d:\d\d$/.test(extra.opens_at || "") || !/^\d\d:\d\d$/.test(extra.closes_at || "")) return add(field, `Falta a hora do outro turno de ${WEEKDAYS[day.weekday]}.`);
      const [a, b] = [toMinutes(extra.opens_at), toMinutes(extra.closes_at)];
      if (b <= a) return add(field, "O outro turno fecha depois de abrir, no mesmo dia.");
      const [open, close] = [toMinutes(day.opens_at), closesMinutes(day)];
      if (a < close && b > open) add(field, `O outro turno de ${WEEKDAYS[day.weekday]} cruza o horário principal (${day.opens_at}–${day.closes_at}).`);
    });
    data.closed_labels.forEach((c, i) => {
      if (!String(c.label?.pt ?? "").trim()) add(`closed_labels[${i}].label.pt`, "O motivo em português é obrigatório.");
    });
  }

  if (group === "booking") {
    if (toMinutes(data.first_arrival) >= toMinutes(data.last_arrival)) add("last_arrival", "O último horário vem depois do primeiro.");
    const week = state.settings.hours.data.week.filter((d) => d.open);
    const short = week.find((d) => toMinutes(data.last_arrival) > closesMinutes(d) - 30);
    if (short) add("last_arrival", `O último horário de chegada fica fora do horário aberto de ${WEEKDAYS[short.weekday]} (fecha ${short.closes_at}).`, TO_HOURS);
    if (data.duration_min !== null && data.duration_min < data.slot_interval_min) add("duration_min", "O tempo de mesa precisa ser maior que o intervalo entre horários.");
    const rule = state.settings.approval_no_shows.data;
    if (rule.approval_mode === "rules" && data.party_max_online > rule.rule_party_over) {
      add("party_max_online", `Passa da regra de grupo grande de Aprovação e faltas (acima de ${rule.rule_party_over}).`);
    }
    for (const [i, d] of (data.duration_by_weekday || []).entries()) {
      if (d.minutes !== null && (d.minutes < 30 || d.minutes > 300)) add(`duration_by_weekday[${i}]`, "O tempo de mesa vai de 30 min a 5 h.");
    }
    const rules = data.duration_rules || [];
    if (rules.length > SCHEMA.booking.duration_rules.max_items) add("duration_rules", `Até ${SCHEMA.booking.duration_rules.max_items} regras.`);
    rules.forEach((r, i) => {
      if (!(Number.isInteger(r.party_max) && r.party_max >= 1 && r.party_max <= 20)) add(`duration_rules[${i}]`, "O tamanho do grupo vai de 1 a 20 pessoas.");
      else if (i > 0 && r.party_max <= rules[i - 1].party_max) add(`duration_rules[${i}]`, "Cada regra vale para grupos maiores que a de cima.");
      if (!(r.minutes >= 30 && r.minutes <= 300)) add(`duration_rules[${i}]`, "O tempo de mesa vai de 30 min a 5 h.");
    });
  }

  if (group === "terms") {
    if (!data.items.length) add("items", "Os combinados precisam de pelo menos um item.");
    if (data.items.length > 6) add("items", "Os combinados vão até 6 itens.");
    data.items.forEach((item, i) => {
      if (!String(item.text?.pt ?? "").trim()) add(`items[${i}].text.pt`, `O item ${i + 1} precisa do texto em português.`);
      for (const l of ["pt", "es", "en"]) {
        const v = String(item.text?.[l] ?? "");
        if (v.length > 240) add(`items[${i}].text.${l}`, `O item ${i + 1} vai até 240 caracteres.`);
        const unknown = [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).find((k) => !SCHEMA.terms.items.placeholders.includes(k));
        if (unknown) add(`items[${i}].text.${l}`, `O marcador {${unknown}} não existe. Use {tolerancia}, {extra}, {prazo}, {faltas} ou {tempo}.`);
      }
    });
  }

  if (group === "approval_no_shows" && data.approval_mode === "rules") {
    const max = state.settings.booking.data.party_max_online;
    if (data.rule_party_over < max) add("rule_party_over", `Fica abaixo do máximo de pessoas no site (${max}, em Reservas). Suba para ${max} ou baixe o máximo lá.`);
  }

  if (group === "floor") {
    if (!data.walk_in_areas?.length) add("walk_in_areas", "Escolha pelo menos uma área para quem chega sem reserva.");
    if (data.on_tolerance_end === "auto_release" && state.settings.booking.data.after_tolerance !== "release") {
      add("on_tolerance_end", "Soltar a mesa sozinho só vale com “libera a mesa” em Reservas › Depois da tolerância.", TO_BOOKING);
    }
    const latest = Math.max(...state.settings.hours.data.week.filter((d) => d.open).map(closesMinutes));
    const room = 1440 + 5 * 60 - latest;
    if (data.night_close_delay_min > room) add("night_close_delay_min", `Com fechamento às ${hhmm(latest)}, o fechamento da noite vai até ${Math.floor(room / 60)} h.`, TO_HOURS);
    if (data.print_sheet_mode === "at_time" && !data.print_sheet_at) add("print_sheet_at", "Escolha a hora de sugerir a folha.");
  }

  if (group === "alerts") {
    const mode = state.settings.approval_no_shows.data.approval_mode;
    // alguém ativo precisa receber os pedidos para aprovar: uma pessoa desativada não conta (2.15)
    const active = (data.pending_to || []).some((id) => state.users.some((u) => u.id === id && u.status === "active"));
    if (mode !== "auto" && !active) add("pending_to", "Alguém precisa receber os pedidos para aprovar.");
  }

  if (group === "site") {
    if (!data.languages.includes("pt")) add("languages", "O português não pode ser desligado.");
    if (!data.languages.includes(data.default_language)) add("default_language", "A língua padrão precisa estar ativa.");
  }

  if (group === "messages") {
    data.ready_messages.forEach((m, i) => {
      if (!String(m.text?.pt ?? "").trim()) add(`ready_messages[${i}].text.pt`, "A mensagem precisa do texto em português.");
      if (/\d+\s?(min|h)\b/.test(m.text?.pt ?? "")) add(`ready_messages[${i}].text.pt`, "Use {hora} ou {tolerancia} no lugar do número escrito.");
    });
    if (data.reminder_mode === "fixed_time" && !data.reminder_at) add("reminder_at", "Escolha a hora do lembrete.");
  }

  return errors;
}

// ---- o que uma mudança faz: a simulação do plano do dia, contagens e notas --------------

function simulate(state, now, booking, week) {
  const byDate = new Map();
  for (const r of futureReservations(state, now)) {
    if (r.status === "waitlisted") continue;
    const day = week.find((d) => d.weekday === weekdayOf(r.date));
    const name = state.customers.find((c) => c.id === r.customer_id)?.name ?? "Cliente";
    const tables = r.table_codes || [];
    // a mesma linha que o "quem perde mesa" da Agenda lê: onde estava e para onde vai
    const entry = { reservation_id: r.id, code: r.code, name, party_size: r.party_size, time: r.time, tables, from: tables, from_list: tables.length ? null : r.area_key || null, to: tables, to_list: tables.length ? null : r.area_key || null };
    const last = day?.open ? Math.min(toMinutes(booking.last_arrival), closesMinutes(day) - 30) : 0;
    const slots = day?.open ? slotsFor(booking.first_arrival, hhmm(last), booking.slot_interval_min) : [];
    if (!byDate.has(r.date)) byDate.set(r.date, { date: r.date, applied: false, kept: [], moved: [], without_table: [], day: { open: Boolean(day?.open), slots } });
    const result = byDate.get(r.date);
    if (!day?.open) {
      result.without_table.push(entry);
      continue;
    }
    if (slots.includes(r.time)) result.kept.push(entry);
    else {
      const nearest = slots.reduce((best, s) => (Math.abs(toMinutes(s) - toMinutes(r.time)) < Math.abs(toMinutes(best) - toMinutes(r.time)) ? s : best), slots[0]);
      result.moved.push({ ...entry, to_time: nearest });
    }
  }
  const results = [...byDate.values()]
    .filter((d) => d.moved.length || d.without_table.length)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({
      ...d,
      seats_before: [...d.kept, ...d.moved, ...d.without_table].reduce((n, x) => n + x.party_size, 0),
      seats_after: [...d.kept, ...d.moved].reduce((n, x) => n + x.party_size, 0),
      blocked: d.without_table.length ? "day_has_reservations" : null,
    }));
  const simulationHash = hash({ booking: [booking.first_arrival, booking.last_arrival, booking.slot_interval_min], week, results });
  return { results: results.map((r) => ({ ...r, simulation_hash: simulationHash })), simulationHash };
}

// ---- privacidade: o que a próxima rotina da noite apagaria com um prazo menor (história 2.18) ----

const monthsAgo = (now, months) => {
  const d = new Date(now);
  d.setMonth(d.getMonth() - months);
  return d;
};
const latestOf = (...isos) => isos.filter(Boolean).sort().at(-1) || null;

/**
 * A última atividade do cliente: a mais recente entre uma visita, uma reserva feita e uma entrada na conta
 * (a regra da casa até o Marcus decidir outra coisa).
 */
function lastActivity(state, customer) {
  const made = state.reservations.filter((r) => r.customer_id === customer.id).map((r) => r.created_at);
  return latestOf(customer.last_visit_at, customer.last_login_at, ...made);
}

/** Clientes que ficam de fora: uma reserva futura, uma entrada ativa na lista de espera ou um pedido de dados aberto. */
function protectedCustomers(state, now) {
  const day = today(now);
  const kept = new Set();
  for (const r of state.reservations) {
    if (r.date >= day && ["pending", "confirmed", "offered", "waitlisted"].includes(r.status)) kept.add(r.customer_id);
  }
  for (const p of state.privacy_requests || []) if (p.customer_id && !["done", "rejected"].includes(p.status)) kept.add(p.customer_id);
  return kept;
}

/** Quantos clientes, notas de restrição alimentar ou linhas do registro um prazo menor alcançaria hoje à noite. */
function retentionCount(state, now, field, value) {
  if (field === "audit_retention_months") {
    const limit = monthsAgo(now, value).toISOString();
    return (state.audit || []).filter((e) => (e.occurred_at || "") < limit).length;
  }
  const kept = protectedCustomers(state, now);
  if (field === "dietary_retention_days") {
    const limit = addDays(today(now), -value);
    return state.reservations.filter((r) => !kept.has(r.customer_id) && (r.flags || []).includes("dietary") && r.date < limit).length;
  }
  const limit = monthsAgo(now, value).toISOString();
  return state.customers.filter((c) => {
    if (c.anonymized_at || kept.has(c.id)) return false;
    const last = lastActivity(state, c);
    return Boolean(last) && last < limit;
  }).length;
}

function recalculates(group, changed) {
  return changed.some((field) => SCHEMA[group][field]?.scope === "recalculates");
}

function preview(state, now, group, patch) {
  const stored = state.settings[group];
  const before = stored.data;
  const after = { ...clone(before), ...clone(patch) };
  const changed = Object.keys(patch).filter((k) => k in SCHEMA[group] && !same(before[k], after[k]));
  const errors = validate(state, group, after);
  const future = futureReservations(state, now);
  const changes = changed.map((field) => ({ field, before: before[field], after: after[field], scope: SCHEMA[group][field].scope }));
  const notes = [];
  let simulation = [];
  let simulationHash = null;

  if (recalculates(group, changed)) {
    const booking = group === "booking" ? after : state.settings.booking.data;
    const week = group === "hours" ? after.week : state.settings.hours.data.week;
    const sim = simulate(state, now, booking, week);
    simulation = sim.results;
    simulationHash = sim.simulationHash;
  }

  const allCount = future.length;
  if (group === "booking") {
    if (changed.some((f) => ["tolerance_min", "extra_tolerance_min"].includes(f))) notes.push("O lembrete de cada reserva já sai com o horário-limite novo. Nenhuma mensagem extra é enviada agora.");
    if (changed.some((f) => ["tolerance_min", "extra_tolerance_min", "cancel_until_hours"].includes(f))) {
      const n = (state.terms_versions?.length ?? 1) + 1;
      notes.push(`Os combinados ganham a versão ${n} com os números novos. Quem reservou antes continua com a versão que aceitou.`);
    }
    if (changed.includes("online_enabled") && !after.online_enabled) notes.push("O site passa a mostrar “reservas pelo WhatsApp”. As reservas já feitas continuam.");
  }
  if (group === "terms") {
    const current = state.terms_versions?.at(-1);
    const n = future.filter((r) => r.terms_version === current?.version).length;
    notes.push(`Nasce a versão ${(current?.number ?? 1) + 1}. ${n} ${n === 1 ? "reserva futura foi feita" : "reservas futuras foram feitas"} na versão ${current?.number ?? 1} e continuam com ela.`);
  }
  if (group === "approval_no_shows" && changed.some((f) => f.startsWith("rule_") || f === "approval_mode")) {
    const pending = future.filter((r) => r.status === "pending").length;
    notes.push(`${pending} ${pending === 1 ? "reserva pendente passa" : "reservas pendentes passam"} pela regra nova na hora. As confirmadas continuam confirmadas.`);
  }
  if (group === "waitlist" && changed.includes("max_per_slot") && after.max_per_slot < before.max_per_slot) notes.push("Quem já está na fila continua nela; só entradas novas param no limite.");
  if (group === "waitlist" && changed.includes("online_enabled") && !after.online_enabled) notes.push("Quem está na fila hoje continua nela. Só não entra ninguém novo pelo site.");
  if (group === "floor" && changed.includes("on_tolerance_end") && after.on_tolerance_end === "auto_release") notes.push("Vale na hora para as reservas de hoje. A casa costuma deixar desligado: a recepção decide olhando o salão.");
  if (group === "messages") {
    const texts = (after.ready_messages || []).filter((m, i) => !same(m.text, before.ready_messages[i]?.text));
    if (texts.length) notes.push("O texto novo vai para a Meta aprovar. Até aprovar, vale o texto anterior.");
    if (changed.includes("reminder_enabled") && !after.reminder_enabled) notes.push(`${contextOf(state, now).reminders_next} reservas de hoje e amanhã deixam de receber o lembrete.`);
  }
  if (group === "cookies" && changed.includes("banner_text")) notes.push("A versão do aviso sobe e todo visitante escolhe de novo na próxima visita.");
  if (group === "privacy") {
    for (const field of RETENTION.filter((f) => changed.includes(f) && after[f] < before[f])) {
      const n = retentionCount(state, now, field, after[field]);
      const outside = "Conta pela última atividade (visita, reserva feita ou entrada na conta); quem tem reserva futura, espera ativa ou pedido de dados aberto fica de fora.";
      notes.push(
        field === "audit_retention_months"
          ? `${n} ${n === 1 ? "registro de ação mais velho" : "registros de ação mais velhos"} que ${after[field]} meses ${n === 1 ? "é apagado" : "são apagados"} na rotina da noite.`
          : field === "dietary_retention_days"
            ? `${n} ${n === 1 ? "anotação" : "anotações"} de restrição alimentar com mais de ${after[field]} dias ${n === 1 ? "é apagada" : "são apagadas"} na rotina da noite. ${outside}`
            : `${n} ${n === 1 ? "cliente é anonimizado" : "clientes são anonimizados"} na rotina da noite, sem atividade há mais de ${after[field]} meses. ${outside}`,
      );
    }
  }
  if (SITE_GROUPS.has(group) && changed.length) notes.push("O site é refeito com a mudança, em alguns minutos.");

  return {
    group,
    valid: errors.length === 0,
    errors,
    changes,
    affected: { future_reservations: changes.some((c) => c.scope === "all") ? allCount : 0, dates: new Set(future.map((r) => r.date)).size },
    simulation,
    simulation_hash: simulationHash,
    notes,
  };
}

// ---- gravar: a versão, os efeitos e o registro -------------------------------------------

/** O que o salvamento faz com as reservas: quem muda vai para o novo horário; cada caso é resolvido como decidido. */
function settleCases(state, simulation, resolutions) {
  const byId = new Map(state.reservations.map((r) => [r.id, r]));
  const moveTo = (r, time) => {
    const starts = new Date(`${r.date}T${time}:00-03:00`);
    Object.assign(r, { time, starts_at: starts.toISOString(), ends_at: new Date(starts.getTime() + (r.duration_min || 120) * 60_000).toISOString() });
  };
  for (const day of simulation) {
    for (const row of day.moved) {
      const r = byId.get(row.reservation_id);
      if (r && row.to_time) moveTo(r, row.to_time);
    }
  }
  for (const res of resolutions) {
    const r = byId.get(res.reservation_id);
    if (!r) continue;
    if (res.action === "cancel") Object.assign(r, { status: "canceled", canceled_by: "staff", cancel_reason: res.note || "Mudança no horário da casa", table_codes: [] });
    else if (res.action === "keep") r.internal_notes = [r.internal_notes, res.note || "Mantida sem mesa: a casa resolve na noite."].filter(Boolean).join(" · ");
    else if (res.action === "reschedule" && res.time) {
      moveTo(r, res.time);
      if (Array.isArray(res.table_codes) && res.table_codes.length) r.table_codes = [...res.table_codes];
    }
  }
}

function newTermsVersion(state, now, by) {
  const day = today(now);
  const taken = (state.terms_versions || []).filter((v) => v.version.startsWith(day)).length;
  const version = taken ? `${day}.${taken + 1}` : day;
  const number = (state.terms_versions?.at(-1)?.number ?? 0) + 1;
  state.terms_versions = [...(state.terms_versions || []), { version, number, published_at: now.toISOString() }];
  const terms = state.settings.terms;
  terms.data.version = version;
  terms.version += 1;
  terms.updated_by = by;
  terms.updated_at = now.toISOString();
  state.terms = { version, items: terms.data.items.map((i) => ({ title: i.title.pt, text: i.text.pt })) };
}


/** Mantém o resto da simulação (site, reserva, disponibilidade) lendo as regras gravadas. */
function mirror(state, group, data) {
  const b = state.booking;
  if (group === "booking") {
    for (const key of ["window_days", "min_lead_min", "party_max_online", "large_group_action", "tolerance_min", "extra_tolerance_min", "after_tolerance", "late_notice_enabled", "cancel_until_hours", "customer_can_cancel_late", "max_active_per_phone", "google_login"]) b[key] = data[key];
    if (data.duration_rules?.length) b.duration_rules = clone(data.duration_rules);
    for (const day of [...state.hours, ...state.settings.hours.data.week]) {
      if (!day.open) continue;
      const last = Math.min(toMinutes(data.last_arrival), closesMinutes(day) - 30);
      day.slots = slotsFor(data.first_arrival, hhmm(last), data.slot_interval_min);
    }
  }
  if (group === "hours") {
    // com um turno por dia, um segundo deixado no rascunho não conta
    if (Number(data.max_shifts_per_day) !== 2) data.week.forEach((d) => delete d.second_shift);
    state.hours = clone(data.week).map((d) => {
      const label = data.closed_labels.find((c) => c.weekday === d.weekday)?.label?.pt;
      return d.open ? d : { ...d, label: label ?? d.label };
    });
    state.hours_confirmed = data.confirmed;
  }
  if (group === "approval_no_shows") {
    b.approval_mode = data.approval_mode;
    b.approval_rules = { ...b.approval_rules, party_over: data.rule_party_over, customer_no_shows_at_least: data.rule_no_shows_enabled ? data.rule_no_shows_count : 0 };
    b.pending_expiry_hours = data.pending_expiry_hours;
  }
  if (group === "waitlist") {
    b.waitlist_enabled = data.online_enabled;
    b.waitlist_offer_min = data.offer_min;
  }
  if (group === "house") {
    Object.assign(state.house, { name: data.name, tagline: data.tagline.pt, address: clone(data.address), whatsapp: data.whatsapp });
    const handle = String(data.instagram).match(/instagram\.com\/([^/?#]+)/)?.[1];
    if (handle) state.house.instagram = handle;
  }
  if (group === "privacy" && state.privacy) state.privacy.retention_months = data.customer_retention_months;
  // as regras que outras partes da simulação leem (o Salão, as reservas, o site)
  if (group === "approval_no_shows") {
    b.undo_no_show_hours = data.undo_no_show_hours;
    b.pending_expiry_before_min = data.pending_expiry_before_min;
  }
  if (group === "alerts") Object.assign(b, { quiet_from: data.quiet_from, quiet_to: data.quiet_to });
  if (group === "floor") {
    state.floor_settings = clone(data);
    b.on_tolerance_end = data.on_tolerance_end;
  }
  if (group === "menu") state.menu_settings = clone(data);
  if (group === "cookies") state.cookies_settings = { banner_version: data.banner_version, measurement_enabled: data.measurement_enabled };
  if (group === "site") state.site_settings = clone(data);
}

/** Todos os espelhos de uma vez, para um banco novo começar com as regras que as outras partes leem. */
export function mirrorAll(state) {
  for (const group of ["approval_no_shows", "alerts", "floor", "menu", "cookies", "site"]) mirror(state, group, state.settings[group].data);
}

// como o registro de ações chama cada grupo, nas palavras da casa
const GROUP_NAMES = {
  house: "Casa", hours: "Horários", access: "Acesso", alerts: "Avisos à equipe", appearance: "Aparência", booking: "Reservas",
  terms: "Combinados", approval_no_shows: "Aprovação e faltas", waitlist: "Lista de espera", floor: "Salão", messages: "Mensagens",
  events: "Eventos", site: "Site", menu: "Cardápio", privacy: "Privacidade", cookies: "Cookies", integrations: "Integrações", devices: "Aparelhos",
};

/** Uma linha do registro de ações, no formato que o Registro lê: quem, quando, o antes e o depois. */
function audit(state, now, user, group, changes, extra = {}) {
  state.audit = state.audit || [];
  state.audit.unshift({
    id: uuid(),
    occurred_at: now.toISOString(),
    actor_type: "user",
    actor_id: user.id ?? null,
    actor_label: user.name,
    device_label: "Acesso pessoal",
    action: extra.action || "settings.update",
    entity_type: "settings",
    entity_id: group,
    version: extra.version ?? null,
    summary: extra.summary || `Mudou ${GROUP_NAMES[group] || group}: ${changes.map((c) => c.field).join(", ")}`,
    // segredos nunca levam valor; a tela mostra "trocado"
    changes: Object.fromEntries(changes.map((c) => [c.field, c.secret ? { secret: true } : { from: c.before ?? null, to: c.after ?? null }])),
  });
}

/** Outra pessoa grava o grupo antes (o ?conflito=1 da demonstração), então o salvamento responde 412. */
function otherPersonSaves(state, now, group) {
  const stored = state.settings[group];
  const manager = state.users.find((u) => u.role === "manager");
  const tweak = {
    booking: { few_left_pct: stored.data.few_left_pct === 25 ? 30 : 25 },
    waitlist: { max_per_slot: stored.data.max_per_slot === 12 ? 14 : 12 },
    floor: { release_hint_min: stored.data.release_hint_min === 20 ? 25 : 20 },
  }[group];
  const field = tweak ? Object.keys(tweak)[0] : Object.keys(SCHEMA[group]).find((k) => typeof stored.data[k] === "boolean" && !SCHEMA[group][k].read_only);
  if (!field) return;
  const change = tweak ?? { [field]: !stored.data[field] };
  stored.data = { ...stored.data, ...change };
  stored.version += 1;
  stored.updated_by = manager?.name ?? "Outra pessoa";
  stored.updated_at = new Date(now.getTime() - 60_000).toISOString();
  save();
}

function reauthOk() {
  const at = session.get(REAUTH_KEY);
  return typeof at === "number" && Date.now() - at < 5 * 60_000;
}

function needsReauth(state, group, after) {
  if (group === "access") return true;
  if (group === "privacy") return RETENTION.some((f) => after[f] < state.settings.privacy.data[f]);
  return false;
}

// ---- aparelhos ----------------------------------------------------------------------------

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from({ length: 8 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
const publicDevice = (d) => {
  const { id, name, kind, location, role, status, approved_by, approved_at, last_seen_at, revoked_at, version, idle_min } = d;
  return { id, name, kind, location, role, status, approved_by, approved_at, last_seen_at, revoked_at, version, idle_min };
};

function deviceGuard(state, id) {
  const user = userOf(state);
  if (!user) return { error: problem(401, "unauthorized", "Entre para continuar") };
  if (user.role !== "owner") return { error: problem(403, "forbidden", "Só o dono cuida dos aparelhos", { detail: "Só o dono cuida dos aparelhos." }) };
  const device = (state.devices || []).find((d) => d.id === id);
  if (!device) return { error: problem(404, "not_found", "Esse aparelho não está mais na lista") };
  return { user, device };
}

// ---- primeiro uso -------------------------------------------------------------------------

function onboardingOf(state, scenario) {
  const s = state.settings;
  const empty = scenario === "vazio";
  const o = state.onboarding;
  const check = {
    house: [s.house.data.address?.street && s.house.data.whatsapp ? null : "endereço e WhatsApp"],
    hours: [s.hours.data.confirmed ? null : "confirmar o horário com a casa"],
    // a planta estimada pelas fotos basta até a visita técnica, quando o dono disser
    layouts: [o.layouts_accepted || state.layouts.some((l) => !l.archived && l.version && l.version !== "v1") ? null : "conferir a planta estimada pelas fotos"],
    booking: [null],
    terms: [pendingOf("terms", s.terms.data).length ? "revisar as traduções" : null],
    team: [state.users.some((u) => u.role === "floor" && u.status === "active") ? null : "cadastrar a recepção"],
    devices: [(state.devices || []).some((d) => d.status === "approved") ? null : "aprovar o aparelho da recepção"],
    messages: [s.integrations.data.items.find((i) => i.key === "whatsapp")?.state === "ok" ? null : "ligar o WhatsApp da casa (aguardando a Meta)"],
  };
  const steps = Object.entries(check).map(([key, missing]) => {
    const left = empty ? ["começar"] : missing.filter(Boolean);
    return { key, done: left.length === 0, skipped: o.skipped.includes(key), missing: left };
  });
  return {
    done: steps.every((st) => st.done || st.skipped) || o.dismissed,
    dismissed: o.dismissed,
    current_step: empty ? "house" : o.current_step,
    steps,
    version: String(o.version),
  };
}

// ---- rotas --------------------------------------------------------------------------------

export const handlers = [
  http.get(`${API}/staff/settings`, () =>
    respond((scenario) => {
      const { state } = load();
      const user = userOf(state);
      if (!user) return problem(401, "unauthorized", "Entre para continuar");
      if (user.role === "floor") return problem(403, "forbidden", "Essa parte é de outro perfil da equipe");
      const empty = scenario === "vazio";
      const groups = GROUPS.filter((g) => visibleTo(user.role, g)).map((group) => {
        const stored = state.settings[group];
        return {
          group,
          version: String(stored.version),
          updated_by: empty ? null : stored.updated_by,
          updated_at: empty ? null : stored.updated_at,
          pending: empty ? [] : pendingOf(group, stored.data),
          editable: user.role === "owner" && !READ_ONLY.has(group),
          requires_recent_auth: group === "access" || group === "privacy",
          summary: summaryOf(group, stored.data),
        };
      });
      const owner = state.users.find((u) => u.role === "owner");
      return HttpResponse.json({ groups, owner_name: owner?.name ?? "dono", modules: ["base", "1"] });
    }),
  ),

  http.get(`${API}/staff/settings/:group`, ({ params }) =>
    respond((scenario) => {
      const { state, now } = load();
      const denied = guard(state, params.group);
      if (denied) return denied;
      return HttpResponse.json(documentOf(state, now, params.group, scenario));
    }),
  ),

  http.post(`${API}/staff/settings/:group/preview`, async ({ params, request }) => {
    const body = await request.json().catch(() => ({}));
    return respond(() => {
      const { state, now } = load();
      const denied = guard(state, params.group);
      if (denied) return denied;
      if (!body?.data || typeof body.data !== "object") return problem(400, "bad_request", "Faltam os dados da mudança");
      return HttpResponse.json(preview(state, now, params.group, body.data));
    });
  }),

  http.patch(`${API}/staff/settings/:group`, async ({ params, request }) => {
    const body = await request.json().catch(() => ({}));
    const ifMatch = request.headers.get("If-Match") ?? new URL(request.url).searchParams.get("if_match");
    // ?conflito=1 faz o próximo salvamento encontrar o salvamento de outra pessoa (história 2.5)
    if (new URLSearchParams(window.location.search).get("conflito") === "1") session.set(CONFLICT_KEY, true);
    return respond(() => {
      const { state, now } = load();
      const group = params.group;
      const denied = guard(state, group);
      if (denied) return denied;
      const user = userOf(state);
      if (user.role !== "owner") return problem(403, "settings_read_only", "Só o dono muda as regras", { detail: "Só o dono muda as regras." });
      if (READ_ONLY.has(group)) return problem(405, "bad_request", "Esse grupo é só de leitura");
      if (!body?.data || typeof body.data !== "object") return problem(400, "bad_request", "Faltam os dados da mudança");
      if (!ifMatch) return problem(428, "precondition_failed", "Falta a versão lida");

      if (session.get(CONFLICT_KEY)) {
        session.remove(CONFLICT_KEY);
        otherPersonSaves(state, now, group);
      }
      const stored = state.settings[group];
      if (String(stored.version) !== String(ifMatch).replace(/"/g, "")) {
        return problem(412, "precondition_failed", `${stored.updated_by} gravou antes de você`, {
          detail: "Veja o que mudou e escolha juntar com as suas mudanças ou descartar as suas.",
          current: documentOf(state, now, group, "normal"),
        });
      }

      const after = { ...clone(stored.data), ...clone(body.data) };
      if (needsReauth(state, group, after) && !reauthOk()) {
        // 403, não 401: um 401 encerraria a sessão do painel (defeito 5)
        return problem(403, "reauth_required", "Confirme que é você", { detail: "Digite a senha e o código para gravar essa mudança." });
      }
      const result = preview(state, now, group, body.data);
      if (!result.valid) return problem(422, "validation", "Confira os campos marcados", { errors: result.errors });
      if (!result.changes.length) return HttpResponse.json(documentOf(state, now, group, "normal"));

      if (result.simulation_hash) {
        if (!body.simulation_hash) return problem(409, "preview_required", "Veja o efeito antes de gravar");
        if (body.simulation_hash !== result.simulation_hash) return problem(409, "plan_changed", "O efeito mudou desde a prévia", { detail: "Veja o efeito de novo antes de gravar." });
        // cada reserva que ficou sem mesa precisa da decisão da equipe antes de o salvamento seguir
        const resolutions = Array.isArray(body.resolutions) ? body.resolutions : [];
        const handled = new Set(resolutions.filter((x) => x?.action).map((x) => x.reservation_id));
        const open = result.simulation.flatMap((d) => d.without_table.filter((x) => !handled.has(x.reservation_id)).map((x) => ({ ...x, closed: !d.day?.open })));
        if (open.length && !body.confirm_conflicts) {
          const closed = open.some((x) => x.closed);
          return problem(409, closed ? "day_has_reservations" : "conflict", `${open.length} ${open.length === 1 ? "reserva ficaria" : "reservas ficariam"} sem mesa`, {
            code: "unassigned",
            detail: closed ? "Esse dia tem reservas ativas. Cancele avisando cada uma antes de fechar." : "Remarque, cancele avisando ou mantenha com observação cada caso.",
            items: result.simulation,
          });
        }
        settleCases(state, result.simulation, resolutions);
      }

      // o que o grupo gravado leva junto
      if (group === "cookies" && result.changes.some((c) => c.field === "banner_text")) after.banner_version = today(now);
      if (group === "messages") {
        after.ready_messages = after.ready_messages.map((m, i) =>
          same(m.text, stored.data.ready_messages[i]?.text) ? m : { ...m, approved: false, status: "pending", reason: null },
        );
      }
      stored.data = after;
      stored.version += 1;
      stored.updated_by = user.name;
      stored.updated_at = now.toISOString();
      mirror(state, group, after);
      // o site é refeito com a mudança; o grupo acompanha em "Situação da publicação"
      if (SITE_GROUPS.has(group)) requestBuild(state, `settings:${group}`, user.name);
      if (group === "terms" || (group === "booking" && result.changes.some((c) => ["tolerance_min", "extra_tolerance_min", "cancel_until_hours"].includes(c.field)))) {
        newTermsVersion(state, now, user.name);
      }
      audit(state, now, user, group, result.changes, { version: stored.version });
      save();
      return HttpResponse.json(documentOf(state, now, group, "normal"));
    });
  }),

  // "Publicar de novo" depois de uma publicação que falhou
  http.post(`${API}/staff/site/builds`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    return respond(() => {
      const { state } = load();
      const user = userOf(state);
      if (!user) return problem(401, "unauthorized", "Entre para continuar");
      if (user.role === "floor") return problem(403, "forbidden", "Essa parte é de outro perfil da equipe");
      settleBuilds(state);
      const running = (state.site_builds || []).find((b) => b.status === "pending" || b.status === "running");
      const build = running || requestBuild(state, String(body?.reason || "site:retry").slice(0, 60), user.name);
      save();
      return HttpResponse.json(buildView(build), { status: running ? 200 : 202 });
    });
  }),

  // ---- os modelos de WhatsApp e suas revisões na Meta (história 2.14) ----
  http.get(`${API}/staff/notifications/templates`, () =>
    respond(() => {
      const { state } = load();
      const denied = guard(state, "messages");
      if (denied) return denied;
      return HttpResponse.json({ items: clone(state.notification_templates || []) });
    }),
  ),

  http.post(`${API}/staff/notifications/templates/:id/revisions`, async ({ params, request }) => {
    const body = await request.json().catch(() => ({}));
    return respond(() => {
      const { state, now } = load();
      const denied = guard(state, "messages");
      if (denied) return denied;
      const user = userOf(state);
      if (user.role !== "owner") return problem(403, "settings_read_only", "Só o dono muda as regras", { detail: "Só o dono muda as regras." });
      const template = (state.notification_templates || []).find((t) => t.id === params.id);
      if (!template) return problem(404, "not_found", "Esse modelo não existe");
      const text = body?.text || {};
      const errors = [];
      if (!String(text.pt ?? "").trim()) errors.push({ field: "text.pt", message: "A mensagem precisa do texto em português." });
      for (const l of ["pt", "es", "en"]) {
        const v = String(text[l] ?? "");
        if (v.length > 160) errors.push({ field: `text.${l}`, message: "A mensagem vai até 160 caracteres." });
        if (/\d+\s?(min|h)\b/.test(v)) errors.push({ field: `text.${l}`, message: "Use {hora} ou {tolerancia} no lugar do número escrito." });
      }
      if (errors.length) return problem(422, "validation", "Confira os campos marcados", { errors });
      // até a Meta aprovar, o texto de antes continua saindo
      if (template.status === "approved") template.previous_text = clone(template.text);
      Object.assign(template, { text: { pt: text.pt, es: text.es || "", en: text.en || "" }, status: "pending", reason: null, submitted_at: now.toISOString(), approved_at: null });
      const ready = state.settings.messages.data.ready_messages.find((m) => m.template === template.id);
      if (ready) Object.assign(ready, { text: clone(template.text), approved: false, status: "pending", reason: null });
      audit(state, now, user, "messages", [{ field: `template:${template.id}`, before: template.previous_text?.pt ?? null, after: template.text.pt }], {
        action: "notification_template.revise",
        summary: `Mandou à Meta o texto novo de “${template.name}”`,
      });
      save();
      return HttpResponse.json(clone(template), { status: 201 });
    });
  }),

  // ---- "Testar agora" numa integração (história 2.20) ----
  http.post(`${API}/staff/system/checks/:integration`, ({ params }) =>
    respond(() => {
      const { state, now } = load();
      const user = userOf(state);
      if (!user) return problem(401, "unauthorized", "Entre para continuar");
      if (user.role !== "owner") return problem(403, "forbidden", "Essa parte é só do dono", { detail: "Essa parte é só do dono." });
      const item = state.settings.integrations.data.items.find((i) => i.key === params.integration);
      if (!item) return problem(404, "not_found", "Essa integração não existe");
      // a resposta diz só como foi: nunca a resposta do próprio serviço, nunca uma chave
      const fails = item.state === "problem" || item.state === "unused";
      item.checked_at = now.toISOString();
      if (!fails) {
        item.last_ok_at = now.toISOString();
        item.state = "ok";
      }
      save();
      return HttpResponse.json({ key: item.key, state: item.state, ok: !fails, checked_at: item.checked_at, last_ok_at: item.last_ok_at });
    }),
  ),

  // POST /staff/auth/reauth (senha e código) mora com a entrada: src/mocks/handlers/staff/auth.js

  // ---- aparelhos (a própria lista, GET /staff/devices, é de Sistema) ----
  http.post(`${API}/staff/devices/pairing`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    return respond(() => {
      const { state, now } = load();
      if (!body?.public_key) return problem(422, "validation", "Falta a chave do aparelho", { errors: [{ field: "public_key", message: "Falta a chave do aparelho." }] });
      const id = uuid();
      const code = newCode();
      const expires = new Date(now.getTime() + 10 * 60_000).toISOString();
      state.devices = state.devices || [];
      state.devices.push({
        id, name: String(body.label || "Aparelho novo").slice(0, 60), kind: "tablet", location: "", role: "floor", status: "pending",
        approved_by: null, approved_at: null, last_seen_at: null, revoked_at: null, version: "1",
      });
      state.device_pairings = { ...(state.device_pairings || {}), [id]: { code, expires_at: expires } };
      save();
      return HttpResponse.json({ id, code, status: "pending", expires_at: expires, poll_after_s: 3 }, { status: 201 });
    });
  }),

  http.get(`${API}/staff/devices/pairing/:id`, ({ params }) =>
    respond(() => {
      const { state, now } = load();
      const device = (state.devices || []).find((d) => d.id === params.id);
      const pairing = state.device_pairings?.[params.id];
      if (!device || !pairing) return problem(404, "not_found", "Pedido não encontrado");
      const expired = device.status === "pending" && new Date(pairing.expires_at) < now;
      return HttpResponse.json({ id: device.id, status: expired ? "expired" : device.status, expires_at: pairing.expires_at, poll_after_s: 3 });
    }),
  ),

  http.post(`${API}/staff/devices/:id/approve`, async ({ params, request }) => {
    const body = await request.json().catch(() => ({}));
    return respond(() => {
      const { state, now } = load();
      const { error, user, device } = deviceGuard(state, params.id);
      if (error) return error;
      const pairing = state.device_pairings?.[device.id];
      if (device.status !== "pending" || !pairing || new Date(pairing.expires_at) < now) {
        return problem(409, "conflict", "Esse pedido venceu ou já foi decidido", { detail: "Peça o pareamento de novo no aparelho." });
      }
      const code = String(body?.code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (code !== pairing.code) return problem(422, "validation", "Código não confere", { errors: [{ field: "code", message: "O código não confere com o da tela do aparelho." }] });
      const errors = [];
      if (!String(body.location ?? "").trim()) errors.push({ field: "location", message: "Diga onde o aparelho fica." });
      if (!["desktop", "tablet", "phone"].includes(body.kind)) errors.push({ field: "kind", message: "Escolha o tipo do aparelho." });
      if (errors.length) return problem(422, "validation", "Confira os campos marcados", { errors });
      Object.assign(device, {
        name: String(body.name || device.name).slice(0, 60), kind: body.kind, location: String(body.location).slice(0, 60), role: body.role || "floor",
        status: "approved", approved_by: user.name, approved_at: now.toISOString(), version: String(Number(device.version) + 1),
        idle_min: body.idle_min >= 5 && body.idle_min <= 60 ? Number(body.idle_min) : state.settings.access.data.reception_idle_min,
      });
      delete state.device_pairings[device.id];
      audit(state, now, user, "devices", [{ field: device.name, before: "pending", after: "approved" }]);
      save();
      return HttpResponse.json(publicDevice(device));
    });
  }),

  http.patch(`${API}/staff/devices/:id`, async ({ params, request }) => {
    const body = await request.json().catch(() => ({}));
    const ifMatch = request.headers.get("If-Match") ?? new URL(request.url).searchParams.get("if_match");
    return respond(() => {
      const { state } = load();
      const { error, device } = deviceGuard(state, params.id);
      if (error) return error;
      if (ifMatch && String(ifMatch) !== String(device.version)) return problem(412, "precondition_failed", "Outra pessoa mudou esse aparelho antes de você");
      const errors = [];
      if (body.name !== undefined && !String(body.name).trim()) errors.push({ field: "name", message: "Dê um nome ao aparelho." });
      if (body.idle_min !== undefined && !(body.idle_min >= 5 && body.idle_min <= 60)) errors.push({ field: "idle_min", message: "A inatividade vai de 5 a 60 min." });
      if (errors.length) return problem(422, "validation", "Confira os campos marcados", { errors });
      for (const key of ["name", "kind", "location", "role", "idle_min"]) if (body[key] !== undefined) device[key] = body[key];
      device.version = String(Number(device.version) + 1);
      save();
      return HttpResponse.json(publicDevice(device));
    });
  }),

  http.post(`${API}/staff/devices/:id/revoke`, async ({ params, request }) => {
    const body = await request.json().catch(() => ({}));
    return respond(() => {
      const { state, now } = load();
      const { error, user, device } = deviceGuard(state, params.id);
      if (error) return error;
      if (!reauthOk()) return problem(403, "reauth_required", "Confirme que é você");
      const wasPending = device.status === "pending";
      Object.assign(device, { status: wasPending ? "rejected" : "revoked", revoked_at: now.toISOString(), version: String(Number(device.version) + 1) });
      if (state.device_pairings) delete state.device_pairings[device.id];
      audit(state, now, user, "devices", [{ field: device.name, before: wasPending ? "pending" : "approved", after: device.status, reason: body?.reason ?? null }]);
      save();
      return HttpResponse.json(publicDevice(device));
    });
  }),

  http.post(`${API}/staff/devices/session/challenge`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    return respond(() => {
      const { state, now } = load();
      const device = (state.devices || []).find((d) => d.id === body?.device_id);
      if (!device || device.status !== "approved") return problem(403, "device_not_approved", "Esse aparelho não está aprovado");
      return HttpResponse.json({ challenge_id: uuid(), challenge: uuid().replace(/-/g, ""), expires_at: new Date(now.getTime() + 60_000).toISOString() });
    });
  }),

  http.post(`${API}/staff/devices/session`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    return respond(() => {
      const { state, now } = load();
      const device = (state.devices || []).find((d) => d.id === body?.device_id);
      if (!device || device.status !== "approved") return problem(403, "device_not_approved", "Esse aparelho não está aprovado");
      if (!body.signature) return problem(401, "device_signature_invalid", "Assinatura não confere");
      device.last_seen_at = now.toISOString();
      save();
      return HttpResponse.json({ kind: "device", device_id: device.id, csrf_token: uuid(), user: null }, { status: 201 });
    });
  }),

  http.get(`${API}/staff/devices/staff`, () =>
    respond(() => {
      const { state } = load();
      return HttpResponse.json(state.users.filter((u) => u.status === "active" && u.role !== "owner").map((u) => ({ user_id: u.id, name: u.name })));
    }),
  ),

  // ---- o assistente de primeiro uso ----
  http.get(`${API}/staff/onboarding`, () =>
    respond((scenario) => {
      const { state } = load();
      if (!userOf(state)) return problem(401, "unauthorized", "Entre para continuar");
      return HttpResponse.json(onboardingOf(state, scenario));
    }),
  ),

  http.put(`${API}/staff/onboarding`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    return respond((scenario) => {
      const { state } = load();
      const user = userOf(state);
      if (!user) return problem(401, "unauthorized", "Entre para continuar");
      if (user.role !== "owner") return problem(403, "forbidden", "Só o dono mexe no primeiro acesso");
      const o = state.onboarding;
      // outra sessão do dono gravou o progresso antes: o assistente recarrega
      const ifMatch = request.headers.get("If-Match") ?? new URL(request.url).searchParams.get("if_match");
      if (ifMatch && String(ifMatch).replace(/"/g, "") !== String(o.version)) {
        return problem(412, "precondition_failed", "O progresso mudou em outra sessão", { detail: "Recarregamos o progresso. O que já foi gravado nos grupos continua.", current: onboardingOf(state, scenario) });
      }
      const KEYS = ["house", "hours", "layouts", "booking", "terms", "team", "devices", "messages"];
      if (body.current_step !== undefined) {
        if (!KEYS.includes(body.current_step)) return problem(422, "validation", "Passo desconhecido", { errors: [{ field: "current_step", message: "Escolha um dos passos." }] });
        o.current_step = body.current_step;
      }
      if (Array.isArray(body.skipped)) o.skipped = body.skipped.filter((k) => KEYS.includes(k));
      if (typeof body.dismissed === "boolean") o.dismissed = body.dismissed;
      if (typeof body.layouts_accepted === "boolean") o.layouts_accepted = body.layouts_accepted;
      o.version += 1;
      save();
      return HttpResponse.json(onboardingOf(state, scenario));
    });
  }),
];
