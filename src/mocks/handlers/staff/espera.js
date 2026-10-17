// Espera: a lista de espera da noite (GET/POST /staff/waitlist, oferecer uma mesa, avisar um grupo da porta
// que a mesa está pronta) e as ações de reserva que o salão e a lista de espera usam: "Chegou"
// (check_in, que abre a sessão da mesa), desfazer dentro dos minutos configurados, "+10 min"
// de tolerância, soltar a mesa no fim da tolerância, "Não veio", e confirmar ou
// cancelar alguém da lista de espera. Este arquivo vem primeiro na ordem dos nomes, então a rota de ações dele
// responde essas; qualquer outra ação passa para a próxima rota do mesmo endereço (a da
// área Reservas).
import { http, HttpResponse } from "msw";
import { uuid } from "../../../lib/uuid.js";
import { resolveDay } from "../../availability.js";
import { getState, save } from "../../db.js";
import { mockNow, problem, respond } from "../../scenario.js";
import { newSession } from "../../seeds/salao.js";
import { waitlistEntry } from "../../seeds/espera.js";
import { changed, clockTime, closedNightGuard, context, expireOffers, invalid, logAction, occurredAt, once, placeFreed, project, rulesOf, sessionOn, settle, tableTaken, toleranceEnd, waitlistOf, whatsappState, withEtag } from "./salao.js";

const API = "/api/v1";
const MIN = 60_000;

const FLOOR_ACTIONS = new Set(["check_in", "undo_check_in", "extra_tolerance", "no_show", "release_table"]);
const WAITING = new Set(["waitlisted", "offered"]);

async function readBody(request) {
  try {
    return await request.clone().json();
  } catch {
    return {};
  }
}

const slotLimit = (state) => state.settings?.waitlist?.data?.max_per_slot ?? 10;

/** Posições por horário, na ordem em que as pessoas entraram. */
function withPositions(state, date, role) {
  const list = waitlistOf(state, date).sort((a, b) => a.time.localeCompare(b.time) || a.created_at.localeCompare(b.created_at));
  const pos = {};
  return list.map((r) => ({ ...project(state, r, role), waitlist_position: (pos[r.time] = (pos[r.time] || 0) + 1) }));
}

const invalidTransition = (detail = "A reserva mudou de estado. A tela foi atualizada; confira e escolha de novo.", extra = {}) =>
  problem(409, "invalid_transition", "Não dá para fazer isso agora", { detail, ...extra });

const firstOf = (state, r) => (state.customers.find((c) => c.id === r.customer_id)?.name || r.walk_in_name || "Sem nome").split(" ")[0];

function addHistory(r, at, actor, action, summary) {
  r.history ??= [];
  r.history.push({ at: new Date(at).toISOString(), actor_label: actor, action, summary });
}

function checkIn(state, r, body, ctx) {
  const { date, now, actor, role, device } = ctx;
  if (r.status === "completed") {
    const by = r.checked_in_by || "outra pessoa da equipe";
    return invalidTransition(`Chegada já marcada por ${by} às ${clockTime(r.arrived_at || now)}.`, { reason: "already_arrived", name: by, time: clockTime(r.arrived_at || now) });
  }
  if (!["confirmed", "pending", ...WAITING].includes(r.status)) return invalidTransition();
  const people = body.people == null ? r.party_size : Number(body.people);
  if (!Number.isInteger(people) || people < 1) return invalid("people", "Diga quantas pessoas entraram, pelo menos 1.");
  const day = resolveDay(state, r.date);
  const tables = Array.isArray(body.table_codes) && body.table_codes.length ? body.table_codes : r.table_codes;
  const listArea = day.areas.find((a) => a.key === (body.area_key || r.area_key) && a.mode === "list");
  if (!tables.length && !listArea) return invalid("table_codes", "Escolha a mesa.");
  if (tables.length && sessionOn(state, r.date, tables)) return tableTaken();
  const at = occurredAt(body, now, date);
  if (at.error) return at.error;
  const session = newSession(state, r, { tables, area: listArea?.key ?? null, people, seatedAt: at, duration: r.duration_min || 120, actor, device });
  const seats = (day.layout?.tables || []).filter((t) => tables.includes(t.code)).reduce((n, t) => n + t.max_seats, 0);
  if (tables.length && people > seats) session.over_capacity = true;
  const area = tables.length ? day.layout.tables.find((t) => t.code === tables[0])?.area : listArea.key;
  const before = r.status;
  Object.assign(r, {
    status_before_check_in: r.status,
    status: "completed",
    table_codes: [...tables],
    area_key: area,
    arrived_at: at.toISOString(),
    seated_at: at.toISOString(),
    arrived_people: people,
    table_session_id: session.id,
    checked_in_by: actor,
    checked_in_device: device,
    offer_expires_at: null,
  });
  addHistory(r, at, actor, "check_in", `Chegou: ${people} ${people === 1 ? "pessoa" : "pessoas"} na ${tables.join("+") || "balcão"}${body.from_paper ? " (lançado do papel)" : ""}`);
  logAction(state, {
    action: "reservation.check_in",
    id: r.id,
    summary: `Chegou: ${firstOf(state, r)}, ${people} ${people === 1 ? "pessoa" : "pessoas"} na ${tables.join("+") || "balcão"}${body.from_paper ? " (lançado do papel)" : ""}`,
    at,
    role,
    changes: { status: { from: before, to: "completed" }, table_codes: { from: (r.lost_table_codes || []).join("+") || "—", to: tables.join("+") || "balcão" } },
  });
  save();
  return HttpResponse.json(project(state, r, role));
}

function undoCheckIn(state, r, ctx) {
  const { now, actor, role } = ctx;
  const session = state.table_sessions.find((s) => s.id === r.table_session_id);
  if (r.status !== "completed" || !session || session.status !== "open") return invalidTransition();
  const minutes = rulesOf(state).undo_check_in_min;
  if (now - new Date(session.seated_at) > minutes * MIN) {
    return problem(409, "undo_window_closed", "Passou o prazo de desfazer", { detail: `O "Chegou" só se desfaz em até ${minutes} min. Se foi engano, avise o dono ou o gerente.`, minutes });
  }
  session.undone = true;
  session.status = "closed";
  Object.assign(r, { status: r.status_before_check_in || "confirmed", arrived_at: null, seated_at: null, arrived_people: null, table_session_id: null, checked_in_by: null });
  if (WAITING.has(r.status)) Object.assign(r, { status: "waitlisted", table_codes: [] });
  addHistory(r, now, actor, "undo_check_in", "Chegada desfeita");
  logAction(state, { action: "reservation.undo_check_in", id: r.id, summary: `Desfez a chegada de ${firstOf(state, r)} (${r.code})`, at: now, role, changes: { status: { from: "completed", to: r.status } } });
  save();
  return HttpResponse.json(project(state, r, role));
}

function extraTolerance(state, r, ctx) {
  const { now, actor, role } = ctx;
  if (r.status !== "confirmed") return invalidTransition();
  // "+10 min" depois que a contagem acabou só vale de novo enquanto a mesa não foi entregue
  if (r.table_codes.length && sessionOn(state, r.date, r.table_codes)) return tableTaken();
  const extra = rulesOf(state).extra_tolerance_min;
  const before = toleranceEnd(state, r);
  r.extra_tolerance_min = (r.extra_tolerance_min || 0) + extra;
  const limit = toleranceEnd(state, r);
  addHistory(r, now, actor, "extra_tolerance", `Mais ${extra} min de tolerância, até ${clockTime(limit)}`);
  logAction(state, { action: "reservation.extra_tolerance", id: r.id, summary: `Mais ${extra} min de tolerância para ${firstOf(state, r)}, até ${clockTime(limit)}`, at: now, role, changes: { tolerance_until: { from: clockTime(before), to: clockTime(limit) } } });
  save();
  return HttpResponse.json(project(state, r, role));
}

/** "Libera a mesa" no fim da tolerância: a reserva fica, sem a mesa. */
function releaseTable(state, r, ctx) {
  const { now, actor, role } = ctx;
  if (r.status !== "confirmed" || !r.table_codes.length) return invalidTransition();
  if (toleranceEnd(state, r) > now) return changed("A tolerância ainda corre. A mesa continua guardada até o fim dela.");
  const codes = r.table_codes.join("+");
  Object.assign(r, { lost_table_codes: [...r.table_codes], table_codes: [], table_released_at: now.toISOString() });
  addHistory(r, now, actor, "release_table", `Mesa ${codes} liberada no fim da tolerância. A reserva espera o "Não veio".`);
  logAction(state, { action: "reservation.release_table", id: r.id, summary: `Liberou a mesa ${codes} de ${firstOf(state, r)} no fim da tolerância`, at: now, role, changes: { table_codes: { from: codes, to: "—" } } });
  placeFreed(state, { date: r.date, time: r.time, table_codes: codes.split("+"), reason: "tolerance" }, now);
  save();
  return HttpResponse.json(project(state, r, role));
}

function noShow(state, r, ctx) {
  const { now, actor, role } = ctx;
  if (r.status !== "confirmed") return invalidTransition();
  Object.assign(r, { status: "no_show", no_show_counted: true, no_show_at: now.toISOString() });
  const customer = state.customers.find((c) => c.id === r.customer_id);
  if (customer) customer.no_shows = (customer.no_shows || 0) + 1;
  addHistory(r, now, actor, "no_show", "Marcada como não veio");
  logAction(state, { action: "reservation.no_show", id: r.id, summary: `Marcou "Não veio": ${firstOf(state, r)} (${r.code})`, at: now, role, changes: { status: { from: "confirmed", to: "no_show" } } });
  save();
  return HttpResponse.json(project(state, r, role));
}

function confirmFromWaitlist(state, r, body, ctx) {
  const { now, actor, role } = ctx;
  const tables = Array.isArray(body.table_codes) ? body.table_codes : [];
  if (!tables.length) return invalid("table_codes", "Escolha a mesa da reserva.");
  if (sessionOn(state, r.date, tables)) return tableTaken();
  const day = resolveDay(state, r.date);
  Object.assign(r, { status: "confirmed", table_codes: [...tables], area_key: day.layout.tables.find((t) => t.code === tables[0])?.area ?? null, waitlist_position: null, offer_expires_at: null });
  addHistory(r, now, actor, "confirmed", `Virou reserva na mesa ${tables.join("+")}`);
  logAction(state, { action: "waitlist.confirm", entity: "waitlist", id: r.id, summary: `Tirou ${firstOf(state, r)} da espera: reserva na mesa ${tables.join("+")}`, at: now, role, changes: { status: { from: "waitlisted", to: "confirmed" } } });
  save();
  return HttpResponse.json(project(state, r, role));
}

function cancelFromWaitlist(state, r, body, ctx) {
  const { now, actor, role } = ctx;
  const reason = String(body.reason || "").trim();
  if (!reason) return invalid("reason", "Escolha o motivo.");
  const before = r.status;
  Object.assign(r, { status: "canceled", canceled_by: "staff", cancel_reason: reason, canceled_at: now.toISOString(), table_codes: [], offer_expires_at: null });
  addHistory(r, now, actor, "cancel", `Saiu da espera: ${reason}`);
  logAction(state, { action: "waitlist.remove", entity: "waitlist", id: r.id, summary: `Tirou ${firstOf(state, r)} da espera: ${reason}`, at: now, role, changes: { status: { from: before, to: "canceled" } } });
  save();
  return HttpResponse.json(project(state, r, role));
}

export const handlers = [
  http.post(`${API}/staff/reservations/:id/actions`, async ({ request, params }) => {
    const body = await readBody(request);
    const peek = getState(mockNow()).reservations.find((r) => r.id === params.id);
    const ours = FLOOR_ACTIONS.has(body.action) || (peek && WAITING.has(peek.status) && ["confirm", "cancel"].includes(body.action));
    if (!ours) return undefined; // a área Reservas responde o resto
    return respond(() => {
      const ctx = context();
      const { state, date, now, role } = ctx;
      return once(request, state, () => {
        const r = state.reservations.find((x) => x.id === params.id);
        if (!r) return problem(404, "not_found", "Essa reserva não existe mais");
        const closed = closedNightGuard(state, r.date, role, body, r);
        if (closed) return closed;
        if (role === "floor" && r.date !== date) return problem(403, "forbidden", "A recepção cuida só da noite de hoje.");
        if (body.action === "no_show" && toleranceEnd(state, r) > now) return changed("A tolerância ainda corre. Marque \"Não veio\" depois que ela acabar.");
        expireOffers(state, date, now);
        switch (body.action) {
          case "check_in":
            return checkIn(state, r, body, ctx);
          case "undo_check_in":
            return undoCheckIn(state, r, ctx);
          case "extra_tolerance":
            return extraTolerance(state, r, ctx);
          case "release_table":
            return releaseTable(state, r, ctx);
          case "no_show":
            return noShow(state, r, ctx);
          case "confirm":
            return WAITING.has(r.status) ? confirmFromWaitlist(state, r, body, ctx) : changed();
          case "cancel":
            return WAITING.has(r.status) ? cancelFromWaitlist(state, r, body, ctx) : changed();
          default:
            return changed();
        }
      });
    });
  }),

  http.get(`${API}/staff/waitlist`, ({ request }) =>
    respond((scenario) => {
      const { state, date, now, role } = context();
      if (scenario === "vazio") return HttpResponse.json([]);
      settle(state, date, now, role);
      save();
      return withEtag(request, withPositions(state, date, role));
    }),
  ),

  // Um grupo esperando na porta, sem reserva (história 5.13).
  http.post(`${API}/staff/waitlist`, async ({ request }) => {
    const body = await readBody(request);
    return respond(() => {
      const { state, date, now, role } = context();
      return once(request, state, () => {
        const closed = closedNightGuard(state, date, role, body);
        if (closed) return closed;
        const name = String(body.name || "").trim();
        const people = Number(body.party_size);
        const day = resolveDay(state, date);
        if (!name) return invalid("name", "Escreva o nome de quem espera.");
        if (!Number.isInteger(people) || people < 1) return invalid("party_size", "Pelo menos 1 pessoa.");
        if (!day.slots.includes(body.time)) return invalid("time", "Escolha um horário da noite.");
        const limit = slotLimit(state);
        if (waitlistOf(state, date).filter((r) => r.time === body.time).length >= limit) {
          return invalid("time", `As ${body.time} já têm ${limit} grupos na espera. Ponha em outro horário.`);
        }
        const phone = String(body.phone || "").replace(/[^\d+]/g, "");
        const entry = waitlistEntry(state, { date, time: body.time, people, name, source: "walk_in", createdAt: now, phone: phone.length >= 10 ? phone : null });
        state.reservations.push(entry);
        logAction(state, { action: "waitlist.add_door", entity: "waitlist", id: entry.id, summary: `${name} (${people}) na espera da porta para as ${body.time}`, at: now, role });
        save();
        const [shown] = withPositions(state, date, role).filter((r) => r.id === entry.id);
        return HttpResponse.json(shown, { status: 201 });
      });
    });
  }),

  http.post(`${API}/staff/waitlist/:id/offer`, async ({ request, params }) => {
    const body = await readBody(request);
    return respond(() => {
      const { state, date, now, role } = context();
      return once(request, state, () => {
        expireOffers(state, date, now);
        const r = state.reservations.find((x) => x.id === params.id);
        if (!r || r.status === "offered" || r.status !== "waitlisted") return changed("Essa pessoa já tem uma oferta ou saiu da fila. A lista já está atualizada.");
        const customer = state.customers.find((c) => c.id === r.customer_id);
        const hasWhatsapp = r.phone_verified === false ? false : Boolean(customer?.phone_verified_at || r.walk_in_phone);
        if (!hasWhatsapp) {
          return problem(409, "needs_whatsapp", "Esse cliente não tem WhatsApp confirmado", { detail: "A oferta não sai. Chame a pessoa na porta ou o dono ou o gerente liga para ela." });
        }
        const tables = Array.isArray(body.table_codes) ? body.table_codes : [];
        if (tables.length && sessionOn(state, date, tables)) return tableTaken();
        const minutes = rulesOf(state).waitlist_offer_min;
        const day = resolveDay(state, date);
        // o WhatsApp da casa fora do ar: a oferta não é entregue (catálogo §6)
        const delivered = whatsappState(state) !== "down";
        Object.assign(r, {
          status: "offered",
          table_codes: [...tables],
          area_key: day.layout.tables.find((t) => t.code === tables[0])?.area ?? null,
          offered_at: now.toISOString(),
          offer_expires_at: new Date(now.getTime() + minutes * MIN).toISOString(),
          offer_message_status: delivered ? "sent" : "failed",
        });
        r.messages ??= [];
        r.messages.push({ id: uuid(), template: "waitlist_offer", status: delivered ? "sent" : "failed", sent_at: now.toISOString() });
        logAction(state, { action: "waitlist.offer", entity: "waitlist", id: r.id, summary: `Ofereceu a mesa ${tables.join("+") || "livre"} a ${firstOf(state, r)} por ${minutes} min`, at: now, role });
        save();
        const [shown] = withPositions(state, date, role).filter((x) => x.id === r.id);
        return HttpResponse.json(shown);
      });
    });
  }),

  // "Avisar que a mesa está pronta" para um grupo da porta que deixou um
  // telefone (história 6.9). O telefone nunca volta para a tela.
  http.post(`${API}/staff/waitlist/:id/notify`, async ({ request, params }) => {
    const body = await readBody(request);
    return respond(() => {
      const { state, date, now, role } = context();
      const r = state.reservations.find((x) => x.id === params.id && x.date === date && WAITING.has(x.status));
      if (!r) return changed("Essa pessoa já saiu da fila. A lista já está atualizada.");
      if (!r.walk_in_phone && !state.customers.find((c) => c.id === r.customer_id)?.phone_e164) {
        return problem(409, "needs_whatsapp", "Essa pessoa não deixou telefone", { detail: "Chame na porta." });
      }
      if (whatsappState(state) === "down") return problem(503, "whatsapp_down", "O WhatsApp da casa está fora", { detail: "Fale com o cliente na porta." });
      const last = (r.messages || []).filter((m) => m.template === "table_ready").at(-1);
      if (last && !body.repeat && now - new Date(last.sent_at) < 10 * MIN) {
        return problem(409, "conflict", "Essa mensagem já foi", { reason: "recently_sent", sent_at: last.sent_at, detail: `Você já mandou essa às ${clockTime(last.sent_at)}.` });
      }
      r.messages ??= [];
      r.messages.push({ id: uuid(), template: "table_ready", status: "sending", sent_at: now.toISOString() });
      logAction(state, { action: "waitlist.notify", entity: "waitlist", id: r.id, summary: `Avisou ${firstOf(state, r)} que a mesa está pronta`, at: now, role });
      save();
      const [shown] = withPositions(state, date, role).filter((x) => x.id === r.id);
      return HttpResponse.json(shown, { status: 202 });
    });
  }),
];
