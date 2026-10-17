// Hoje: a noite num relance. Números, as colunas de horário com quanto cada uma enche, o que
// precisa de atenção (os alertas, lidos dos mesmos avisos da central de avisos, FR-87),
// as ligações a fazer para clientes sem WhatsApp, o que falta da primeira configuração, o
// movimento recente, o evento da noite e a semana à frente. Feito com as mesmas reservas que a lista
// mostra, então as duas sempre concordam. Também faz o fluxo ao vivo (GET /staff/stream): um "invalidate"
// sempre que as reservas, a lista de espera ou as mesas mudam (aqui, em outra aba do
// mesmo navegador, ou por um cliente que a simulação finge), e um "ping" a cada 15 s.
import { http, HttpResponse } from "msw";
import { addDays, formatDay, houseParts, shortTime, toMinutes } from "../../../lib/dates.js";
import { resolveDay } from "../../availability.js";
import { noticeOf, receives } from "../../../admin/avisos/catalogo.js";
import { alertSettings, hiddenFor, listFor, personal, storeOf, sync } from "../../avisos.js";
import { getState, save } from "../../db.js";
import { currentScenario, currentSession, mockNow, problem, respond } from "../../scenario.js";
import { HOLDS_PLACE, nameOf, nextDays, roleNow, staffView } from "./reservas.js";
import {
  changesSince, closingSoon, context, isNightClosed, nightsOf, previousNight, printSheetAt, rulesOf, settle, whatsappState, withEtag,
} from "./salao.js";

const API = "/api/v1";
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const COUNTED = new Set(["pending", "confirmed", "offered", "completed"]);
const sum = (list, pick) => list.reduce((total, x) => total + pick(x), 0);
const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || "");
const firstName = (name) => String(name || "").split(/\s+/)[0];
const hhmm = (iso) => houseParts(iso).time;

function seatsOf(day) {
  if (!day.open) return 0;
  const mode = new Map(day.areas.map((a) => [a.key, a.mode]));
  return sum(day.layout.tables.filter((t) => mode.get(t.area) === "tables"), (t) => t.max_seats) + (day.list_capacity || 0);
}

/** Pessoas nas mesas num certo horário (as que começaram antes e ainda estão lá). */
function occupancyAt(reservations, time) {
  const at = toMinutes(time);
  return sum(
    reservations.filter((r) => {
      const start = toMinutes(r.time);
      return start <= at && at < start + (r.duration_min || 120) && !r.left_at;
    }),
    (r) => r.party_size,
  );
}

const pct = (people, seats) => (seats ? Math.min(100, Math.round((people / seats) * 100)) : 0);

function peakOf(day, reservations) {
  const seats = seatsOf(day);
  return Math.max(0, ...day.slots.map((t) => pct(occupancyAt(reservations, t), seats)));
}

const FEED_KIND = {
  created: "new", approved: "confirmed", confirmed: "confirmed", customer_yes: "customer_yes", customer_no: "customer_no",
  customer_late: "customer_late", customer_arriving: "customer_arriving", cancel: "canceled", declined: "declined", waitlisted: "waitlisted", offered: "offered",
};

function feedOf(state, reservations, role) {
  const items = [];
  for (const r of reservations) {
    const name = role === "floor" ? firstName(nameOf(state, r)) : nameOf(state, r);
    const told = { site: "Reserva feita pelo site", phone: "Reserva lançada por telefone", whatsapp: "Reserva lançada pelo WhatsApp", walk_in: "Chegou sem reserva", staff: "Reserva lançada pela equipe" };
    const history = r.history?.length ? r.history : r.status === "waitlisted" ? [] : [{ at: r.created_at, action: "created", summary: told[r.source] || told.site }];
    for (const h of history) {
      const kind = FEED_KIND[h.action];
      if (!kind || !h.at) continue;
      items.push({ at: h.at, kind, summary: `${name} · ${r.party_size} ${r.party_size === 1 ? "pessoa" : "pessoas"} · ${shortTime(r.time)} — ${h.summary}`, reservation_id: r.id });
    }
    if (r.status === "waitlisted" && !history.some((h) => h.action === "waitlisted")) {
      items.push({ at: r.created_at, kind: "waitlisted", summary: `${name} · ${r.party_size} pessoas · ${shortTime(r.time)} — entrou na lista de espera`, reservation_id: r.id });
    }
  }
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
}

const TEMPLATE_WORD = { reminder: "o lembrete", booking_receipt: "o comprovante", approved: "a confirmação" };

/** O minuto do lembrete do dia (Configurações › Mensagens), para "Ligar para confirmar". */
function reminderAt(state, date, day) {
  const m = state.settings?.messages?.data || {};
  if (m.reminder_mode === "fixed" && m.reminder_at) return new Date(`${date}T${m.reminder_at}:00-03:00`);
  const opens = new Date(`${date}T${day.opens_at || "19:00"}:00-03:00`);
  return new Date(opens.getTime() - (m.reminder_offset_min ?? 180) * MIN);
}

// As 8 etapas do contrato mostradas como as 5 etapas visíveis do assistente de primeiro uso (FR-63).
const STEPS = [
  { key: "casa", label: "A casa", parts: ["house"], path: "/admin/configuracoes/casa" },
  { key: "horarios", label: "Horários", parts: ["hours", "booking"], path: "/admin/configuracoes/horarios" },
  { key: "plantas", label: "Plantas", parts: ["layouts"], path: "/admin/plantas" },
  { key: "combinados", label: "Combinados", parts: ["terms"], path: "/admin/configuracoes/combinados" },
  { key: "equipe", label: "Equipe", parts: ["team", "devices", "messages"], path: "/admin/equipe" },
];
const PART_PATH = { devices: "/admin/configuracoes/aparelhos-e-impressoras", messages: "/admin/configuracoes/mensagens", booking: "/admin/configuracoes/reservas" };

function onboardingOf(state, scenario) {
  const s = state.settings;
  if (!s) return null;
  const o = state.onboarding || { skipped: [], dismissed: false };
  const missing = {
    house: s.house?.data?.address?.street && s.house?.data?.whatsapp ? null : "endereço e WhatsApp da casa",
    hours: (s.hours?.data?.confirmed ?? state.hours_confirmed) ? null : "confirmar os horários da casa",
    booking: null,
    layouts: state.layouts?.length ? null : "desenhar a planta",
    terms: s.terms?.data?.items?.some((i) => !i.text?.es || !i.title?.es) ? "revisar as traduções dos combinados" : null,
    team: state.users.some((u) => u.role === "floor" && u.status === "active") ? null : "cadastrar a recepção",
    devices: (state.devices || []).some((d) => d.status === "approved") ? null : "aprovar o aparelho da recepção",
    messages: s.integrations?.data?.items?.find((i) => i.key === "whatsapp")?.state === "ok" ? null : "ligar o WhatsApp da casa",
  };
  if (scenario === "vazio") for (const k of Object.keys(missing)) missing[k] = "começar";
  return STEPS.map((step) => {
    const left = step.parts.filter((p) => missing[p] && !(o.skipped || []).includes(p));
    return {
      key: step.key,
      label: step.label,
      done: left.length === 0,
      missing: left.map((p) => missing[p]),
      path: left.length === 1 && PART_PATH[left[0]] ? PART_PATH[left[0]] : step.path,
    };
  });
}

/**
 * Tudo o que precisa de atenção numa noite, para todo perfil: quem recebe cada um é assunto do
 * catálogo de avisos (src/admin/avisos/catalogo.js), aplicado depois. O perfil aqui só
 * muda as palavras (a recepção vê primeiros nomes e nenhum detalhe alimentar). Cada alerta tem um
 * id (tipo:entidade), o que aconteceu, a hora e o jeito de resolver.
 */
export function alertsOf(state, date, reservations, role, now, scenario) {
  const alerts = [];
  const floor = role === "floor";
  const mgmt = !floor;
  const label = (r) => `${floor ? firstName(nameOf(state, r)) : nameOf(state, r)} (${shortTime(r.time)}, ${r.party_size} ${r.party_size === 1 ? "pessoa" : "pessoas"})`;
  const active = reservations.filter((r) => HOLDS_PLACE.has(r.status));
  const tonight = reservations.filter((r) => HOLDS_PLACE.has(r.status) || (r.status === "completed" && !r.left_at));
  const add = (alert) => alerts.push({ at: null, reservation_id: null, path: null, ...alert });

  for (const r of active) {
    const failed = (r.messages || []).find((m) => m.status === "failed");
    if (failed) add({ id: `message_failed:${r.id}`, kind: "message_failed", at: failed.sent_at, text: `A mensagem para ${firstName(nameOf(state, r))} não chegou: o WhatsApp não entregou ${TEMPLATE_WORD[failed.template] || "a mensagem"}.`, reservation_id: r.id });
  }
  for (const r of active.filter((x) => x.customer_confirmation === "no_reply")) {
    add({ id: `no_reply:${r.id}`, kind: "no_reply", text: `${label(r)} não respondeu ao lembrete.`, reservation_id: r.id });
  }
  for (const r of active.filter((x) => x.party_size > state.booking.party_max_online)) {
    add({ id: `large_group:${r.id}`, kind: "large_group", text: `Grupo grande: ${label(r)}${r.status === "pending" ? ", aguardando aprovação" : ""}.`, reservation_id: r.id });
  }
  for (const r of tonight.filter((x) => (x.flags || []).includes("birthday"))) {
    add({ id: `birthday:${r.id}`, kind: "birthday", text: `Aniversário: ${label(r)}.`, reservation_id: r.id });
  }
  for (const r of tonight.filter((x) => (x.flags || []).includes("dietary"))) {
    // o detalhe é só para o dono e o gerente (AR-24)
    const detail = !floor && r.notes ? `: ${r.notes}` : "";
    add({ id: `dietary:${r.id}`, kind: "dietary", text: `Restrição alimentar: ${label(r)}${detail}${floor ? ". O detalhe fica com a gerência." : "."}`, reservation_id: r.id });
  }
  for (const r of active.filter((x) => x.status === "confirmed" && !x.table_codes?.length && !x.lost_table_codes?.length)) {
    add({ id: `without_table:${r.id}`, kind: "without_table", text: `${label(r)} está sem mesa.`, reservation_id: r.id });
  }
  const today = houseParts(now).date;

  if (scenario !== "vazio") {
    // a folha da noite, no horário configurado, até alguém imprimir ou dispensar (história 6.10)
    const rules = rulesOf(state);
    const meta = nightsOf(state)[date] || {};
    const printAt = printSheetAt(state, date);
    if (date === today && printAt && !meta.sheet_printed_at && houseParts(now).minutes >= toMinutes(printAt) && resolveDay(state, date).open && !isNightClosed(state, date)) {
      add({ id: `print_sheet:${date}`, kind: "print_sheet", text: "Imprima a folha da noite: se o computador ou a internet falharem, a noite segue no papel.", path: "/admin/salao/folha" });
    }

    // o fechamento da noite chegando com mesas ainda abertas (história 6.14)
    const closing = date === today ? closingSoon(state, date, now) : null;
    if (closing) {
      add({ id: `night_closing:${date}`, kind: "night_closing", text: `A noite fecha às ${closing.time}: ${closing.open_tables} ${closing.open_tables === 1 ? "mesa ainda aberta" : "mesas ainda abertas"}.`, can_postpone: mgmt && closing.can_postpone, path: "/admin/salao" });
    }

    if (date === today) {
      // os "Não veio" automáticos da última noite para conferir, ou a noite que não fechou
      const prev = previousNight(state, today);
      const prevMeta = prev ? nightsOf(state)[prev] : null;
      const when = prev === addDays(today, -1) ? "ontem" : `em ${formatDay(prev || today, "weekday")}`;
      if (prev && prevMeta?.closed_at) {
        const list = state.reservations.filter((r) => r.date === prev && r.status === "no_show" && r.no_show_auto);
        const review = state.reservations.filter((r) => (prevMeta.review || []).includes(r.id) && r.status === "confirmed");
        if (list.length) {
          add({
            id: `no_show_review:${prev}`,
            kind: "no_show_review",
            at: prevMeta.closed_at,
            text: `Não veio ${when}: ${list.length} ${list.length === 1 ? "reserva marcada" : "reservas marcadas"} pelo fechamento da noite. Confira e desfaça o que foi engano.`,
            items: list.map((r) => staffView(state, r, role)),
            undo_until: new Date(new Date(prevMeta.closed_at).getTime() + rules.undo_no_show_hours * 3_600_000).toISOString(),
          });
        }
        if (review.length) {
          add({ id: `outage_review:${prev}`, kind: "outage_review", at: prevMeta.closed_at, text: "A noite teve queda: confira as chegadas antes de fechar.", items: review.map((r) => staffView(state, r, role)) });
        }
      } else if (prev) {
        const open = state.reservations.filter((r) => r.date === prev && ["confirmed", "pending", "waitlisted", "offered"].includes(r.status));
        const tables = (state.table_sessions || []).filter((s) => s.status === "open" && state.reservations.find((r) => r.id === s.reservation_id)?.date === prev);
        if (open.length || tables.length) {
          add({ id: `night_not_closed:${prev}`, kind: "night_not_closed", date: prev, text: `A noite de ${when === "ontem" ? "ontem" : formatDay(prev, "weekday")} não fechou: ${open.length} ${open.length === 1 ? "reserva" : "reservas"} e ${tables.length} ${tables.length === 1 ? "mesa" : "mesas"} sem estado final.` });
        }
      }
      // notas do papel que a recepção mandou depois de a noite fechar (história 6.13)
      for (const c of (state.corrections || []).filter((x) => x.status === "open")) {
        add({ id: `paper_correction:${c.id}`, kind: "paper_correction", at: c.sent_at, text: `Do papel, mandado por ${c.sent_by}: ${c.label} (anotado às ${hhmm(c.occurred_at)}).`, correction_id: c.id, reservation_id: c.reservation_id });
      }
    }

    {
      // pedidos de privacidade perto dos 15 dias (história 5.18)
      for (const p of (state.privacy_requests || []).filter((x) => x.status === "open")) {
        const days = Math.ceil((new Date(p.due_at) - now) / DAY);
        if (days > 5) continue;
        const who = String(p.customer_label || "cliente").split(" · ")[0];
        add({ id: `privacy_request_due:${p.id}`, kind: "privacy_request_due", at: p.opened_at, text: days < 0 ? `O pedido de dados de ${who} passou do prazo de 15 dias.` : `Pedido de dados de ${who}: ${days === 0 ? "vence hoje" : `faltam ${days} ${days === 1 ? "dia" : "dias"}`} do prazo de 15.`, path: "/admin/clientes/pedidos", path_label: "Ver os pedidos" });
      }
      // um PIN travado num aparelho da casa (1.12) e um aparelho que perdeu a chave (1.11)
      for (const lock of (state.pin_locks || []).filter((x) => new Date(x.until) > now)) {
        add({ id: `pin_locked:${lock.id}`, kind: "pin_locked", at: lock.locked_at, text: `PIN de ${lock.user_name} travado no ${lock.device_name} às ${hhmm(lock.locked_at)}, depois de ${lock.attempts} tentativas. Destrava sozinho às ${hhmm(lock.until)}.`, path: "/admin/equipe", path_label: "Ver a equipe" });
      }
      for (const d of (state.devices || []).filter((x) => x.key_lost_at && x.status === "approved")) {
        add({ id: `device_key_lost:${d.id}`, kind: "device_key_lost", at: d.key_lost_at, text: `O ${d.name} perdeu a chave de aparelho da casa às ${hhmm(d.key_lost_at)} e precisa ser aprovado de novo.`, path: "/admin/configuracoes/aparelhos-e-impressoras", path_label: "Ver aparelhos" });
      }
      // lembretes que a fila não conseguiu mandar (catálogo §6)
      for (const f of state.system?.reminder_failures || []) {
        add({ id: `reminder_failed:${f.id}`, kind: "reminder_failed", at: f.at, text: f.text, path: "/admin/sistema", path_label: "Ver o sistema" });
      }
    }
  }
  {
    const steps = onboardingOf(state, scenario);
    for (const s of (steps || []).filter((x) => !x.done)) {
      add({ id: `onboarding:${s.key}`, kind: "onboarding", text: `${s.label}: falta ${s.missing.join(" e ")}.`, path: s.path, path_label: "Resolver" });
    }
  }
  if (date === today && scenario !== "vazio") alerts.push(...houseNotices(state, now, role));
  return alerts;
}

/**
 * Os avisos da casa que não são só das reservas de uma noite: pedidos pendentes,
 * o WhatsApp, o Google, aparelhos, a lista de espera e o sistema (FR-87). Eles moram na
 * central de avisos; os que o catálogo marca para o Hoje também aparecem lá.
 */
function houseNotices(state, now, role) {
  const list = [];
  const add = (alert) => list.push({ at: null, reservation_id: null, path: null, ...alert });
  const floor = role === "floor";
  const label = (r) => `${floor ? firstName(nameOf(state, r)) : nameOf(state, r)} (${formatDay(r.date, "weekday")} ${shortTime(r.time)}, ${r.party_size} ${r.party_size === 1 ? "pessoa" : "pessoas"})`;
  const today = houseParts(now).date;
  const minutesTo = (iso) => (new Date(iso) - now) / MIN;

  for (const r of state.reservations.filter((x) => x.status === "pending" && x.date >= today)) {
    const created = r.history?.find((h) => h.action === "created")?.at || r.created_at || null;
    if (r.pending_until && minutesTo(r.pending_until) <= 30 && minutesTo(r.pending_until) > 0) {
      add({ id: `pending_expiring:${r.id}`, kind: "pending_expiring", at: created, text: `O pedido de ${label(r)} vence às ${hhmm(r.pending_until)}. Sem resposta, o cliente é avisado de que não deu.`, reservation_id: r.id, path_label: "Aprovar" });
    } else {
      add({ id: `pending_request:${r.id}`, kind: "pending_request", at: created, text: `Pedido para aprovar: ${label(r)}${r.pending_until ? `. Vence às ${hhmm(r.pending_until)}` : ""}.`, reservation_id: r.id, path_label: "Aprovar" });
    }
    const starts = new Date(`${r.date}T${r.time}:00-03:00`);
    if (created && starts - new Date(created) < 3 * 60 * MIN && starts > now) {
      add({ id: `late_request:${r.id}`, kind: "late_request", at: created, text: `Pedido em cima da hora: ${label(r)}.`, reservation_id: r.id, path_label: "Ver a reserva" });
    }
  }
  // mensagens seguradas pelo limite diário (catálogo: importante, para a gerência)
  for (const r of state.reservations.filter((x) => x.date === today && HOLDS_PLACE.has(x.status))) {
    const held = (r.messages || []).find((m) => m.status === "held");
    if (held) add({ id: `message_held:${r.id}`, kind: "message_held", at: held.sent_at || null, text: `A mensagem para ${firstName(nameOf(state, r))} ficou segurada: o limite de mensagens do dia chegou.`, reservation_id: r.id });
  }
  if (whatsappState(state) === "down") {
    add({ id: "whatsapp_down:casa", kind: "whatsapp_down", text: "As mensagens esperam na fila e saem quando ele voltar. Chame os clientes na porta e ofereça mesas da espera à mão." });
  }
  const g = state.google;
  if (g?.connected && g.problem) add({ id: "google_failed:casa", kind: "google_failed", text: g.problem });
  for (const d of (state.devices || []).filter((x) => x.status === "pending")) {
    add({ id: `device_pending:${d.id}`, kind: "device_pending", at: d.created_at || d.last_seen_at || null, text: `${d.name} (${d.location || "sem local"}) pede para entrar no painel. Ele só funciona depois que o dono aprovar.` });
  }
  for (const r of state.reservations.filter((x) => x.status === "offered" && x.offer_message_status === "failed")) {
    add({ id: `offer_failed:${r.id}`, kind: "offer_failed", at: r.offered_at || null, text: `A oferta de mesa para ${firstName(nameOf(state, r))} não foi entregue pelo WhatsApp. Ofereça à mão, na porta ou por telefone.`, reservation_id: r.id });
  }
  const sys = state.system || {};
  if (sys.backup?.state === "problem") add({ id: "backup_failed:casa", kind: "backup_failed", at: sys.backup.at || null, text: sys.backup.detail });
  if (sys.restore?.state === "problem") add({ id: "restore_late:casa", kind: "restore_late", at: sys.restore.at || null, text: sys.restore.detail });
  if (sys.queue?.state === "problem") add({ id: "queue_stuck:casa", kind: "queue_stuck", text: sys.queue.detail });
  for (const p of (state.privacy_requests || []).filter((x) => x.status === "open")) {
    if (Math.ceil((new Date(p.due_at) - now) / DAY) <= 5) continue; // privacy_request_due assume
    const who = String(p.customer_label || "cliente").split(" · ")[0];
    add({ id: `privacy_request:${p.id}`, kind: "privacy_request", at: p.opened_at, text: `Chegou um pedido de dados de ${who}. O prazo para atender é de 15 dias.` });
  }
  return list;
}

/**
 * Os avisos de agora para a pessoa que está dentro: o que vale hoje à noite se junta aos avisos gravados (nascidos,
 * resolvidos), e a pessoa recebe os que o catálogo (e as escolhas do dono em
 * Configurações › Avisos) dá a ela, com o que ela leu, dispensou ou deixou de seguir.
 */
export function centralFor(state, user, role, now, scenario) {
  const today = houseParts(now).date;
  const active = scenario === "vazio" ? [] : alertsOf(state, today, state.reservations.filter((r) => r.date === today), role, now, scenario);
  if (sync(state, active, role, now)) save();
  return listFor(state, user, role, now);
}

/** A pessoa que está dentro (o ?papel= da demonstração escolhe a primeira daquele perfil). */
export function personNow(state, role, now) {
  return currentSession(now)?.user || state.users.find((u) => u.role === role && u.status === "active") || { id: "?", role };
}

/** A lista do Hoje: os avisos que o catálogo mostra lá, para esta pessoa, menos o que ela deixou de lado. */
function hojeAlerts(state, date, reservations, role, now, scenario) {
  const user = personNow(state, role, now);
  const today = houseParts(now).date;
  if (date === today) {
    return centralFor(state, user, role, now, scenario).filter((n) => !n.resolved_at && !n.dismissed_at && noticeOf(n.kind)?.hoje);
  }
  // outra noite: calculada na hora, sem os avisos gravados desta noite
  const settings = alertSettings(state);
  const who = { id: user.id, role };
  return alertsOf(state, date, reservations, role, now, scenario)
    .filter((a) => noticeOf(a.kind)?.hoje && receives(a.kind, who, settings) && !hiddenFor(state, user.id, a.id))
    .map((a) => personal(state, { id: a.id, kind: a.kind, first_at: a.at || now.toISOString(), resolved_at: null, views: { [role]: a } }, user, role, now));
}

/** Clientes desta noite sem WhatsApp para ligar, a partir do horário do lembrete (história 5.19). */
function callsOf(state, date, reservations, now, role) {
  const day = resolveDay(state, date);
  if (!day.open || now < reminderAt(state, date, day)) return [];
  return reservations
    .filter((r) => r.status === "confirmed" && (r.flags || []).includes("no_whatsapp") && !r.call_answer && !r.arrived_at)
    .map((r) => staffView(state, r, role));
}

function nextOpening(state, date) {
  for (let i = 1; i <= 14; i++) {
    const d = addDays(date, i);
    const day = resolveDay(state, d);
    if (day.open) return { date: d, opens_at: day.opens_at, label: `${formatDay(d, "weekday")}, ${shortTime(day.opens_at || "19:00")}` };
  }
  return null;
}

function dashboard(state, date, now, role, scenario) {
  const day = resolveDay(state, date);
  const empty = scenario === "vazio";
  const ofDay = empty ? [] : state.reservations.filter((r) => r.date === date);
  const counted = ofDay.filter((r) => COUNTED.has(r.status));
  const seats = seatsOf(day);
  const meta = nightsOf(state)[date] || {};
  const event = day.event
    ? {
        id: day.event.id,
        title: day.event.title,
        booking_mode: day.event.booking_mode,
        capacity: day.list_capacity,
        expected_people: sum(counted, (r) => r.party_size),
        arrived_people: sum(counted.filter((r) => r.arrived_at), (r) => r.arrived_people ?? r.party_size),
      }
    : null;
  return {
    server_time: now.toISOString(),
    date,
    open: day.open,
    // por que a casa está fechada e quando abre de novo
    reason_label: day.open ? null : day.reason_label,
    opens_at: day.open ? day.opens_at : null,
    closes_at: day.open ? day.closes_at : null,
    next_open: day.open ? null : nextOpening(state, date),
    counts: {
      reservations: counted.length,
      people: sum(counted, (r) => r.party_size),
      pending: ofDay.filter((r) => r.status === "pending").length,
      waitlist: ofDay.filter((r) => r.status === "waitlisted" || r.status === "offered").length,
      confirmed_by_customer: ofDay.filter((r) => r.customer_confirmation === "yes" && COUNTED.has(r.status)).length,
    },
    slots: day.open
      ? day.slots.map((time) => ({
          time,
          arriving_people: sum(counted.filter((r) => r.time === time), (r) => r.party_size),
          occupancy_pct: pct(occupancyAt(counted, time), seats),
        }))
      : [],
    pending: empty
      ? []
      : state.reservations
          .filter((r) => r.status === "pending" && r.date >= houseParts(now).date)
          .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
          .map((r) => staffView(state, r, role)),
    feed: feedOf(state, ofDay, role),
    alerts: hojeAlerts(state, date, ofDay, role, now, scenario),
    calls: empty ? [] : callsOf(state, date, ofDay, now, role),
    onboarding: role === "owner" ? onboardingOf(state, scenario) : null,
    event,
    rules: rulesOf(state),
    whatsapp: whatsappState(state),
    night: {
      closed: isNightClosed(state, date),
      sheet_printed_at: meta.sheet_printed_at ?? null,
      changes_since_sheet: meta.sheet_printed_at ? changesSince(state, date, meta.sheet_printed_at).length : 0,
    },
    week: nextDays(date, 7).map((d) => {
      const wd = resolveDay(state, d);
      const list = empty ? [] : state.reservations.filter((r) => r.date === d && COUNTED.has(r.status));
      return { date: d, open: wd.open, reason_label: wd.open ? null : wd.reason_label, reservations: list.length, people: sum(list, (r) => r.party_size), occupancy_pct: wd.open ? peakOf(wd, list) : 0 };
    }),
  };
}

// ---- o fluxo ao vivo -----------------------------------------------------------------------

const PING_MS = 15_000;
const streams = new Set();
let silenced = false; // um teste pode fazer o fluxo parar de mandar ping, como faz uma conexão morta

/** O que as telas acompanham, como uma assinatura curta por tópico. */
function signature(state) {
  const r = state.reservations.map((x) => `${x.id}:${x.status}:${x.version ?? 1}:${(x.table_codes || []).join("+")}:${x.arrived_at || ""}:${x.customer_confirmation || ""}:${(x.messages || []).length}:${x.customer_arriving_at || ""}:${x.extra_tolerance_min || 0}`).join("|");
  const s = (state.table_sessions || []).map((x) => `${x.id}:${x.status}:${x.version}:${x.people}`).join("|");
  return { reservations: r, floor: s, alerts: JSON.stringify([state.privacy_requests?.length, state.pin_locks?.length, (state.corrections || []).filter((c) => c.status === "open").length, Object.entries(state.nights || {}).map(([d, n]) => [d, n.closed_at, n.postponed, n.sheet_printed_at]), noticeSignature(state), state.devices?.map((d) => `${d.id}:${d.status}:${d.key_lost_at || ""}`), state.google?.problem || "", whatsappState(state)]) };
}

/** O que muda a central de avisos, sem as palavras de cada aviso (elas não trazem novidade). */
function noticeSignature(state) {
  const store = storeOf(state);
  return [Object.values(store.records).map((r) => `${r.id}:${r.resolved_at || ""}`), store.people, store.prefs];
}

/** Um cliente da simulação responde o lembrete ou diz "Estou chegando" de vez em quando (só na demonstração). */
function pretendCustomer(state) {
  const { date, now } = context();
  const waiting = state.reservations.filter((r) => r.date === date && r.status === "confirmed" && !r.arrived_at && ["sent", "no_reply"].includes(r.customer_confirmation) && !(r.flags || []).includes("no_whatsapp"));
  const r = waiting[Math.floor(Math.random() * waiting.length)];
  if (!r) return;
  r.history ??= [];
  if (Math.random() < 0.5) {
    Object.assign(r, { customer_confirmation: "yes", confirmed_by_customer_at: now.toISOString() });
    r.history.push({ at: now.toISOString(), actor_label: "Cliente", action: "customer_yes", summary: "Respondeu SIM ao lembrete" });
  } else {
    r.customer_arriving_at = now.toISOString();
    r.history.push({ at: now.toISOString(), actor_label: "Cliente", action: "customer_arriving", summary: "Respondeu \"Estou chegando\"" });
  }
  r.version = (Number(r.version) || 1) + 1;
  save();
}

function openStream() {
  const encoder = new TextEncoder();
  let timers = [];
  let entry = null;
  const stop = () => {
    timers.forEach(clearInterval);
    timers = [];
    streams.delete(entry);
  };
  return new ReadableStream({
    start(controller) {
      const send = (event, data = {}) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          stop();
        }
      };
      let last = signature(getState(mockNow()));
      const check = () => {
        const now = signature(getState(mockNow()));
        const topics = Object.keys(now).filter((k) => now[k] !== last[k]);
        last = now;
        if (topics.length) send("invalidate", { topics, at: mockNow().toISOString() });
      };
      entry = {
        push: (topics) => send("invalidate", { topics, at: mockNow().toISOString() }),
        drop: () => {
          stop();
          try {
            controller.close();
          } catch {
            /* já fechado */
          }
        },
      };
      streams.add(entry);
      send("hello", { ping_ms: PING_MS });
      timers.push(setInterval(() => !silenced && send("ping", { at: mockNow().toISOString() }), PING_MS));
      timers.push(setInterval(check, 1000));
      // a demonstração finge um cliente de vez em quando; os testes conduzem o fluxo sozinhos
      if (!navigator.webdriver) timers.push(setInterval(() => pretendCustomer(getState(mockNow())), 75_000));
    },
    cancel() {
      stop();
    },
  });
}

// Outra aba do mesmo navegador é outro aparelho da casa: as mudanças dela chegam a esta.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== "territorio:mock-db" || !event.newValue) return;
    try {
      const fresh = JSON.parse(event.newValue);
      const state = getState(mockNow());
      if (fresh.seeded_for === state.seeded_for) Object.assign(state, fresh);
    } catch {
      /* uma cópia quebrada é ignorada */
    }
  });
  // o que os testes (e qualquer curioso no console) usam para conduzir o fluxo
  window.__painelStream = {
    drop: () => [...streams].forEach((s) => s.drop()),
    silence: (on = true) => (silenced = on),
    push: (topics = ["reservations"]) => [...streams].forEach((s) => s.push(topics)),
    count: () => streams.size,
  };
}

// ---- rotas ---------------------------------------------------------------------------------

export const handlers = [
  http.get(`${API}/staff/dashboard`, ({ request }) =>
    respond((scenario) => {
      const now = mockNow();
      const state = getState(now);
      const asked = new URL(request.url).searchParams.get("date");
      const date = isDate(asked) ? asked : houseParts(now).date;
      const role = roleNow();
      if (scenario !== "vazio") {
        const night = context();
        settle(state, night.date, night.now, role);
        save();
      }
      // o relógio do salão (a demonstração faz a noite fora do horário de serviço): tolerância e desfazer leem ele
      return withEtag(request, { ...dashboard(state, date, now, role, scenario), night_time: context().now.toISOString() });
    }),
  ),

  // O fluxo ao vivo (AR-31): invalidate + ping, text/event-stream lido por fetch.
  http.get(`${API}/staff/stream`, () => {
    const scenario = currentScenario();
    if (scenario === "erro" || scenario === "fora") return problem(503, "unavailable", "Atualização ao vivo fora");
    return new HttpResponse(openStream(), { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
  }),
];
