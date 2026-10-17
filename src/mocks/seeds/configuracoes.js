// Dados de exemplo para Configurações: um documento por grupo de configurações (versão, quem gravou
// por último, quando, e os dados no formato Settings* do contrato), os aparelhos da casa e o
// assistente de primeiro uso. Feito a partir dos dados iniciais básicos para o painel e o site lerem as mesmas regras.
import { addDays, houseParts } from "../../lib/dates.js";
import { uuid } from "../../lib/uuid.js";
import CONTENT from "../../content/content.json" with { type: "json" };

const local = (pt, es = "", en = "") => ({ pt, es, en });

// o aparelho pendente dos dados iniciais mostra este código na tela dele (a demonstração conta ao dono)
export const DEMO_PAIRING_CODE = "Q7M2K9XD";

function at(now, daysAgo, time) {
  const date = addDays(houseParts(now).date, -daysAgo);
  return new Date(`${date}T${time}:00-03:00`).toISOString();
}

export function extend(state, now) {
  const owner = state.users.find((u) => u.role === "owner");
  const manager = state.users.find((u) => u.role === "manager");
  const b = state.booking;
  const support = "Matheus (suporte)";
  const doc = (version, updatedBy, updatedAt, data) => ({ version, updated_by: updatedBy, updated_at: updatedAt, data });

  const week = state.hours.map((h) => ({ ...h, slots: [...(h.slots || [])] }));
  const firstOpen = week.find((h) => h.open);

  state.settings = {
    house: doc(3, owner.name, at(now, 6, "15:40"), {
      name: state.house.name,
      tagline: local("Cozinha com chão, afeto e festa", "Cocina con raíz, cariño y fiesta", ""),
      address: { ...state.house.address },
      whatsapp: state.house.whatsapp,
      instagram: "https://instagram.com/_territorio_",
      shop_url: "https://instagram.com/lojinhadoterritorio",
      legal_footer: { enabled: false, legal_name: "", cnpj: "" },
      timezone: "America/Sao_Paulo",
      night_cutoff: "05:00",
    }),
    hours: doc(2, support, at(now, 2, "11:05"), {
      week,
      closed_labels: [
        { weekday: 0, label: local("fechado", "cerrado", "closed") },
        { weekday: 1, label: local("produção", "producción", "") },
        { weekday: 2, label: local("produção", "producción", "") },
      ],
      max_shifts_per_day: 1,
      confirmed: state.hours_confirmed,
    }),
    access: doc(1, support, at(now, 9, "10:00"), {
      session_hours: 12,
      remember_days: 30,
      reception_idle_min: 15,
      pin_rule: "phone_last4",
      pin_max_attempts: 5,
      pin_lock_min: 15,
      totp_required_roles: ["owner", "manager"],
      reauth_valid_min: 5,
    }),
    alerts: doc(2, owner.name, at(now, 4, "17:12"), {
      // os padrões da central de avisos (FR-87): pedidos pendentes para o dono e o gerente (PRD)
      pending_to: [owner.id, manager.id],
      late_request_to: [owner.id, manager.id],
      system_to: [owner.id],
      privacy_request_to: [owner.id],
      security_to: [owner.id],
      quiet_from: "01:00",
      quiet_to: "09:00",
    }),
    appearance: doc(1, support, at(now, 9, "10:00"), { palette: "territorio", dark_theme: true, visitor_theme: "system" }),
    booking: doc(7, support, at(now, 1, "16:20"), {
      online_enabled: true,
      window_days: b.window_days,
      min_lead_min: b.min_lead_min,
      first_arrival: firstOpen?.slots?.[0] ?? "19:00",
      last_arrival: firstOpen?.slots?.at(-1) ?? "21:30",
      slot_interval_min: 30,
      party_max_online: b.party_max_online,
      large_group_action: b.large_group_action,
      duration_min: 120,
      duration_by_weekday: [3, 4, 5, 6].map((weekday) => ({ weekday, minutes: 120 })),
      duration_rules: b.duration_rules.map((r) => ({ ...r })),
      tolerance_min: b.tolerance_min,
      extra_tolerance_min: b.extra_tolerance_min,
      after_tolerance: b.after_tolerance,
      late_notice_enabled: b.late_notice_enabled,
      cancel_until_hours: b.cancel_until_hours,
      customer_can_reschedule: true,
      customer_can_cancel_late: b.customer_can_cancel_late,
      max_active_per_phone: b.max_active_per_phone,
      max_covers_per_slot: null,
      max_covers_night: null,
      few_left_pct: 20,
      late_request_alert_hours: 3,
      google_login: b.google_login,
    }),
    terms: doc(2, owner.name, at(now, 1, "16:22"), {
      version: state.terms.version,
      items: CONTENT.terms.map((term) => ({ title: { ...term.title }, text: { ...term.text } })),
      show_duration_item: false,
      accept_label: local("Li e tá combinado", "Leí y está combinado", ""),
    }),
    approval_no_shows: doc(3, owner.name, at(now, 3, "14:48"), {
      approval_mode: b.approval_mode,
      rule_party_over: b.approval_rules.party_over,
      rule_no_shows_enabled: true,
      rule_no_shows_count: b.approval_rules.customer_no_shows_at_least,
      rule_no_shows_window_months: 12,
      pending_message: local(
        "Recebemos seu pedido. A casa confirma até {hora}.",
        "Recibimos tu pedido. La casa confirma hasta las {hora}.",
        "We got your request. The house confirms by {hora}.",
      ),
      undo_no_show_hours: 24,
      pending_expiry_hours: b.pending_expiry_hours,
      pending_expiry_before_min: 30,
    }),
    waitlist: doc(1, support, at(now, 9, "10:00"), {
      online_enabled: b.waitlist_enabled,
      offer_min: b.waitlist_offer_min,
      offer_only_before_time: true,
      max_per_slot: 10,
      walk_in_enabled: true,
      notify_on_capacity_gain: true,
    }),
    floor: doc(2, manager.name, at(now, 5, "19:02"), {
      on_tolerance_end: "suggest_no_show",
      release_hint_min: 15,
      undo_check_in_min: 15,
      walk_in_areas: ["balcao"],
      night_close_delay_min: 60,
      print_sheet_mode: "at_open",
      print_sheet_at: null,
      reception_can_finish: true,
      reception_reschedule: "same_day",
    }),
    messages: doc(4, owner.name, at(now, 1, "18:30"), {
      reminder_enabled: true,
      reminder_mode: "before_open",
      reminder_offset_min: 180,
      reminder_at: null,
      reply_deadline_offset_min: 30,
      reminder_buttons: [
        local("Confirmo", "Confirmo", "I'll be there"),
        local("Não vou mais", "Ya no voy", "Can't make it"),
        local("Vou atrasar um pouco", "Voy a llegar un poco tarde", "Running a bit late"),
      ],
      auto_reply_enabled: false,
      auto_reply_text: local("Oi! Aqui é o Território. Para reservar ou mudar sua reserva, use o link do site. Já já alguém da casa te responde.", "", ""),
      waitlist_joined_enabled: false,
      waitlist_closed_enabled: true,
      ready_messages: [
        { template: "table_waiting", text: local("Sua mesa está te esperando até {hora}.", "Tu mesa te espera hasta las {hora}.", "Your table is waiting for you until {hora}."), approved: true, status: "approved", reason: null },
        { template: "table_ready", text: local("Sua mesa está pronta! Pode vir.", "¡Tu mesa está lista! Podés venir.", "Your table is ready! Come on in."), approved: true, status: "approved", reason: null },
        { template: "running_late", text: local("Estamos com atraso de alguns minutos. Já já sua mesa fica pronta.", "", ""), approved: false, status: "pending", reason: null },
      ],
      daily_cap: 300,
    }),
    events: doc(1, support, at(now, 9, "10:00"), { default_booking_mode: "tables", site_agenda: "only_with_event" }),
    site: doc(2, owner.name, at(now, 7, "13:15"), { languages: ["pt", "es", "en"], default_language: "pt" }),
    menu: doc(1, support, at(now, 9, "10:00"), { unpriced_item: "hide", show_sold_out: true }),
    privacy: doc(1, support, at(now, 9, "10:00"), {
      customer_retention_months: 24,
      dietary_retention_days: 30,
      audit_retention_months: 12,
      subject_response_days: 15,
      dpo_contact: "privacidade@territorio.test",
      privacy_version: state.privacy?.privacy_version ?? "2026-10-01",
      privacy_published_at: at(now, 14, "09:00"),
    }),
    cookies: doc(1, support, at(now, 14, "09:00"), {
      categories: ["necessary", "remember", "measurement"],
      banner_text: local(
        "Usamos o necessário para o site funcionar. Se você deixar, lembramos seus dados neste aparelho e medimos as visitas, sem anúncio.",
        "Usamos lo necesario para que el sitio funcione. Si nos dejás, recordamos tus datos en este dispositivo y medimos las visitas, sin anuncios.",
        "",
      ),
      banner_version: "2026-10-01",
      measurement_enabled: true,
    }),
    integrations: doc(1, support, at(now, 0, "08:00"), {
      items: [
        // as linhas do WhatsApp e do Google são postas por cima ao vivo pela simulação (a mesma fonte de Sistema)
        { key: "whatsapp", status: "on", state: "ok", environment: "produção", checked_at: at(now, 0, "08:00"), last_ok_at: at(now, 0, "08:00"), key_rotated_at: new Date(now.getTime() - 27 * 3_600_000).toISOString(), note: null },
        { key: "google", status: "off", state: "unused", environment: "produção", checked_at: null, last_ok_at: null, key_rotated_at: null },
        { key: "turnstile", status: "on", state: "ok", environment: "produção", checked_at: at(now, 0, "08:00"), last_ok_at: at(now, 0, "08:00"), key_rotated_at: at(now, 30, "10:00") },
        { key: "email", status: "on", state: "ok", environment: "produção", checked_at: at(now, 0, "08:00"), last_ok_at: at(now, 0, "08:00"), key_rotated_at: at(now, 30, "10:00") },
        { key: "database", status: "on", state: "ok", environment: "produção", checked_at: at(now, 0, "08:00"), last_ok_at: at(now, 0, "08:00"), key_rotated_at: at(now, 30, "10:00") },
        { key: "measurement", status: "on", state: "ok", environment: "produção", checked_at: at(now, 0, "08:00"), last_ok_at: at(now, 0, "08:00"), key_rotated_at: null },
        { key: "monitor", status: "problem", state: "problem", environment: "produção", checked_at: at(now, 0, "08:00"), last_ok_at: at(now, 1, "23:40"), key_rotated_at: null, note: "O monitor externo não responde desde ontem à noite" },
        { key: "errors", status: "on", state: "ok", environment: "produção", checked_at: at(now, 0, "08:00"), last_ok_at: at(now, 0, "08:00"), key_rotated_at: null },
      ],
    }),
  };

  // as regras que outras partes da simulação leem sem passar por Configurações (as mesmas que o
  // salvamento espelha): horário de silêncio e prazo de pendência para as reservas, as regras do salão
  // para o Salão, as regras de cardápio e de cookies para o site
  const s = state.settings;
  Object.assign(b, {
    quiet_from: s.alerts.data.quiet_from,
    quiet_to: s.alerts.data.quiet_to,
    undo_no_show_hours: s.approval_no_shows.data.undo_no_show_hours,
    pending_expiry_before_min: s.approval_no_shows.data.pending_expiry_before_min,
    on_tolerance_end: s.floor.data.on_tolerance_end,
  });
  state.floor_settings = structuredClone(s.floor.data);
  state.menu_settings = structuredClone(s.menu.data);
  state.cookies_settings = { banner_version: s.cookies.data.banner_version, measurement_enabled: s.cookies.data.measurement_enabled };
  state.site_settings = structuredClone(s.site.data);

  // as versões dos combinados, para a tela poder dizer quantas reservas cada uma tem
  state.terms_versions = [
    { version: "2026-09-30", number: 1, published_at: at(now, 15, "10:00") },
    { version: state.terms.version, number: 2, published_at: at(now, 1, "16:22") },
  ];
  // algumas reservas mais antigas ainda têm a versão 1
  state.reservations.slice(-4).forEach((r) => (r.terms_version = "2026-09-30"));

  // os aparelhos da casa: dois aprovados, um pedindo pareamento (só quando nenhuma outra área os criou)
  state.devices ??= [
    {
      id: uuid(), name: "Computador da recepção", kind: "desktop", location: "Recepção", role: "floor", status: "approved",
      approved_by: owner.name, approved_at: at(now, 8, "18:10"), last_seen_at: at(now, 0, "18:55"), revoked_at: null, version: "1", idle_min: 15,
    },
    {
      id: uuid(), name: "Tablet do salão", kind: "tablet", location: "Salão", role: "floor", status: "approved",
      approved_by: owner.name, approved_at: at(now, 8, "18:25"), last_seen_at: at(now, 1, "23:40"), revoked_at: null, version: "1", idle_min: 15,
    },
    {
      id: uuid(), name: "Tablet novo do quintal", kind: "tablet", location: "Quintal", role: "floor", status: "pending",
      approved_by: null, approved_at: null, last_seen_at: null, revoked_at: null, version: "1",
    },
  ];
  state.device_pairings ??= {};
  const pending = state.devices.find((d) => d.status === "pending");
  if (pending) state.device_pairings[pending.id] = { code: DEMO_PAIRING_CODE, expires_at: new Date(now.getTime() + 7 * 86_400_000).toISOString() };

  state.onboarding = { current_step: "hours", skipped: [], dismissed: false, layouts_accepted: false, version: 1 };

  // os modelos de WhatsApp que a casa usa, com a situação deles na Meta (história 2.14)
  const ready = state.settings.messages.data.ready_messages;
  const template = (id, name, kind, text, status, extra = {}) => ({ id, name, kind, text, status, reason: null, submitted_at: null, approved_at: at(now, 12, "10:00"), ...extra });
  state.notification_templates = [
    template("reminder", "Lembrete do dia", "system", local("Oi, {nome}! Hoje às {hora} tem mesa pra {pessoas} no Território. Tudo certo?", "¡Hola, {nome}! Hoy a las {hora} hay mesa para {pessoas} en Território. ¿Todo bien?", "Hi {nome}! Tonight at {hora} there's a table for {pessoas} at Território. All good?"), "approved"),
    template("confirmation", "Reserva confirmada", "system", local("Reserva confirmada: {data} às {hora}, {pessoas} pessoas. A mesa te espera até {limite}.", "Reserva confirmada: {data} a las {hora}, {pessoas} personas.", ""), "approved"),
    template("pending", "Pedido recebido", "system", state.settings.approval_no_shows.data.pending_message, "approved"),
    template("waitlist_offer", "Vaga na lista de espera", "system", local("Abriu uma mesa para {pessoas} às {hora}. Quer? Responda em {prazo}.", "", ""), "rejected", { reason: "A Meta pediu o nome da casa no começo da mensagem.", approved_at: null, submitted_at: at(now, 3, "11:00") }),
    ...ready.map((m) => template(m.template, { table_waiting: "Mesa esperando", table_ready: "Mesa pronta", running_late: "Atraso da casa" }[m.template], "ready", { ...m.text }, m.status, m.status === "pending" ? { approved_at: null, submitted_at: at(now, 1, "18:30"), previous_text: local("Estamos um pouquinho atrasados. Já já sua mesa fica pronta.", "", "") } : {})),
  ];

  // o histórico de alguns grupos (história 2.21): cada salvamento com sua versão, autor e o antes
  // e depois de cada campo, coerente com os valores gravados agora
  const history = [
    ["booking", 7, support, at(now, 1, "16:20"), { few_left_pct: [25, 20], late_request_alert_hours: [2, 3] }],
    ["booking", 6, owner.name, at(now, 3, "15:02"), { tolerance_min: [15, b.tolerance_min], extra_tolerance_min: [5, b.extra_tolerance_min] }],
    ["booking", 5, owner.name, at(now, 8, "11:40"), { cancel_until_hours: [3, b.cancel_until_hours] }],
    ["messages", 4, owner.name, at(now, 1, "18:30"), { reminder_offset_min: [120, 180] }],
    ["alerts", 2, owner.name, at(now, 4, "17:12"), { quiet_from: ["00:00", "01:00"] }],
    ["floor", 2, manager.name, at(now, 5, "19:02"), { release_hint_min: [10, 15] }],
    ["house", 3, owner.name, at(now, 6, "15:40"), { tagline: [local("Cozinha com chão, afeto e festa", "", ""), state.settings.house.data.tagline] }],
    ["terms", 2, owner.name, at(now, 1, "16:22"), { accept_label: [local("Li e concordo", "Leí y acepto", ""), state.settings.terms.data.accept_label] }],
  ];
  state.audit ??= [];
  const names = { booking: "Reservas", messages: "Mensagens", alerts: "Avisos à equipe", floor: "Salão", house: "Casa", terms: "Combinados" };
  for (const [group, version, by, when, fields] of history) {
    const who = state.users.find((u) => u.name === by);
    state.audit.push({
      id: uuid(), occurred_at: when, actor_type: "user", actor_id: who?.id ?? null, actor_label: by, device_label: "Acesso pessoal",
      action: "settings.update", entity_type: "settings", entity_id: group, version,
      summary: `Mudou ${names[group]}: ${Object.keys(fields).join(", ")}`,
      changes: Object.fromEntries(Object.entries(fields).map(([k, [from, to]]) => [k, { from, to }])),
    });
  }
}
