// Clientes (histórias 5.14 a 5.18): a lista com o telefone mascarado, a ficha com o
// histórico, notas, etiquetas e bloqueio, o telefone completo, exportar e anonimizar (só o dono) e os
// pedidos de privacidade com o prazo de 15 dias (só o dono). Toda mudança vai para o registro.
import { http, HttpResponse } from "msw";
import { maskPhone } from "../../../lib/phone.js";
import { uuid } from "../../../lib/uuid.js";
import { getState, save } from "../../db.js";
import { currentRole, mockNow, problem, respond } from "../../scenario.js";
import { placeFreed, reauthRequired } from "./salao.js";

const API = "/api/v1";
const DAY = 86_400_000;
const MANAGEMENT = ["owner", "manager"];
const ACTIVE = ["pending", "confirmed", "waitlisted", "offered"];

const forbidden = () => problem(403, "forbidden", "Essa parte é de outro perfil da equipe");
const notFound = () => problem(404, "not_found", "Não achamos esse cliente");

/** "joão" e "JOAO" são a mesma busca. */
const fold = (s) => String(s || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

function me(state) {
  const role = currentRole();
  return state.users.find((u) => u.role === role && u.status === "active") || null;
}

function log(state, now, { action, entity_type = "customer", entity_id = null, summary, changes = {} }) {
  const user = me(state);
  state.audit ??= [];
  state.audit.push({
    id: uuid(),
    occurred_at: now.toISOString(),
    actor_type: "user",
    actor_id: user?.id ?? null,
    actor_label: user?.name ?? "Equipe",
    device_label: "Acesso pessoal",
    action,
    entity_type,
    entity_id,
    summary,
    changes,
  });
}

const isAnon = (c) => Boolean(c.anonymized_at);

/** O telefone mascarado; um número fora das formas comuns ainda mostra os últimos 4 dígitos. */
function masked(e164) {
  const m = maskPhone(e164);
  return m === "••••" ? `•••• ${String(e164).replace(/\D/g, "").slice(-4)}` : m;
}

function row(c) {
  return {
    id: c.id,
    name: isAnon(c) ? "cliente anonimizado" : c.name,
    phone_masked: isAnon(c) || !c.phone_e164 ? "" : masked(c.phone_e164),
    visits: c.visits || 0,
    no_shows: c.no_shows || 0,
    last_visit_at: c.last_visit_at || null,
    tags: c.tags || [],
    blocked: Boolean(c.blocked),
    anonymized: isAnon(c),
  };
}

function reservationOf(r, c) {
  return {
    id: r.id,
    code: r.code,
    date: r.date,
    time: r.time,
    party_size: r.party_size,
    status: r.status,
    source: r.source,
    customer: { id: c.id, name: row(c).name, phone_masked: row(c).phone_masked, visits: c.visits || 0, no_shows: c.no_shows || 0 },
    table_codes: r.table_codes || [],
    area_key: r.area_key,
    notes: r.notes || "",
    internal_notes: r.internal_notes || "",
    flags: r.flags || [],
    starts_at: r.starts_at,
    canceled_by: r.canceled_by ?? null,
    cancel_reason: r.cancel_reason ?? null,
    no_show_counted: r.status === "no_show" ? r.no_show_counted !== false : undefined,
  };
}

function detail(state, c) {
  const history = state.reservations
    .filter((r) => r.customer_id === c.id)
    .sort((a, b) => String(b.starts_at).localeCompare(String(a.starts_at)))
    .map((r) => reservationOf(r, c));
  return {
    ...row(c),
    internal_notes: c.internal_notes || "",
    blocked_reason: c.blocked_reason || "",
    preferences: c.preferences || { area: null },
    marketing_opt_in: Boolean(c.marketing_opt_in),
    remember_me: Boolean(c.remember_me),
    privacy_version: c.privacy_version || null,
    created_at: c.created_at || null,
    locale: c.locale || "pt",
    version: c.version || "1",
    history,
  };
}

/**
 * Nome e telefone saem, as noites ficam. Reservas futuras são canceladas COM o aviso ao
 * cliente (posto na fila antes de o telefone ser apagado) e o lugar vai para a lista de espera daquele
 * horário; um lugar na lista de espera também é liberado.
 */
function anonymize(state, c, now) {
  let canceled = 0;
  state.outbox ??= [];
  state.capacity_freed ??= [];
  for (const r of state.reservations) {
    if (r.customer_id !== c.id || !ACTIVE.includes(r.status) || new Date(r.starts_at) <= now) continue;
    const freed = [...(r.table_codes || [])];
    const waiting = r.status === "waitlisted" || r.status === "offered";
    Object.assign(r, { status: "canceled", canceled_by: "staff", cancel_reason: "Dados apagados a pedido do cliente", canceled_at: now.toISOString(), waitlist_position: null, table_codes: [], offer_expires_at: null });
    r.history ??= [];
    r.history.push({ at: now.toISOString(), actor_label: me(state)?.name ?? "Equipe", action: "cancel", summary: waiting ? "Saiu da espera: dados apagados a pedido do cliente · cliente avisado" : "Cancelada: dados apagados a pedido do cliente · cliente avisado" });
    if (c.phone_e164) {
      r.messages ??= [];
      r.messages.push({ id: uuid(), template: "canceled", status: "sent", sent_at: now.toISOString() });
      state.outbox.push({ id: uuid(), to: c.phone_e164, template: "reservation_canceled_privacy", reservation_id: r.id, queued_at: now.toISOString() });
    }
    if (!waiting) placeFreed(state, { date: r.date, time: r.time, reservation_id: r.id, table_codes: freed, party_size: r.party_size, reason: "anonymize" }, now);
    r.version = (Number(r.version) || 1) + 1;
    canceled++;
  }
  Object.assign(c, {
    name: "Cliente anonimizado",
    phone_e164: null,
    internal_notes: "",
    tags: [],
    marketing_opt_in: false,
    blocked: false,
    blocked_reason: "",
    preferences: { area: null },
    anonymized_at: now.toISOString(),
  });
  return canceled;
}

const TAG_LABEL = { regular: "frequente", attention: "atenção" };
const tagText = (tags) => (tags?.length ? tags.map((t) => TAG_LABEL[t] || t).join(", ") : "—");

const findCustomer = (state, id) => state.customers.find((c) => c.id === id);

function requestsOf(state) {
  state.privacy_requests ??= [];
  return state.privacy_requests;
}

export const handlers = [
  http.get(`${API}/staff/customers`, ({ request }) =>
    respond((scenario) => {
      if (!MANAGEMENT.includes(currentRole())) return forbidden();
      const url = new URL(request.url);
      const q = fold(url.searchParams.get("q"));
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 20, 1), 100);
      const offset = Number(url.searchParams.get("cursor")) || 0;
      if (scenario === "vazio") return HttpResponse.json({ items: [], next_cursor: null });
      const state = getState(mockNow());
      const digits = q.replace(/\D/g, "");
      const found = state.customers
        .filter((c) => {
          if (!q) return true;
          if (isAnon(c)) return false;
          if (fold(c.name).includes(q)) return true;
          return digits.length >= 2 && digits === q.replace(/[\s-]/g, "") && String(c.phone_e164 || "").endsWith(digits);
        })
        .sort((a, b) => Number(isAnon(a)) - Number(isAnon(b)) || String(b.last_visit_at || "").localeCompare(String(a.last_visit_at || "")) || a.name.localeCompare(b.name, "pt"));
      const items = found.slice(offset, offset + limit).map(row);
      return HttpResponse.json({ items, next_cursor: offset + limit < found.length ? String(offset + limit) : null, total: found.length });
    }),
  ),

  // só a língua guardada de um telefone, para a reserva nova feita pela equipe (5.6); a recepção também
  // usa, então sem nome e sem ficha
  http.get(`${API}/staff/customers/language`, ({ request }) =>
    respond(() => {
      const phone = new URL(request.url).searchParams.get("phone") || "";
      if (!/^\+\d{8,15}$/.test(phone)) return problem(422, "validation", "Confira os campos", { errors: [{ field: "phone", message: "Telefone no formato +55…" }] });
      const state = getState(mockNow());
      const c = state.customers.find((x) => x.phone_e164 === phone && !isAnon(x));
      return HttpResponse.json({ locale: ["pt", "es", "en"].includes(c?.locale) ? c.locale : null });
    }),
  ),

  http.get(`${API}/staff/customers/:id`, ({ params }) =>
    respond(() => {
      if (!MANAGEMENT.includes(currentRole())) return forbidden();
      const state = getState(mockNow());
      const c = findCustomer(state, params.id);
      return c ? HttpResponse.json(detail(state, c)) : notFound();
    }),
  ),

  http.patch(`${API}/staff/customers/:id`, async ({ params, request }) => {
    const body = await request.json().catch(() => ({}));
    return respond(() => {
      if (!MANAGEMENT.includes(currentRole())) return forbidden();
      const now = mockNow();
      const state = getState(now);
      const c = findCustomer(state, params.id);
      if (!c) return notFound();
      if (isAnon(c)) return problem(409, "conflict", "Esse cliente foi anonimizado");
      // outra pessoa gravou a ficha antes: a tela oferece juntar ou descartar (história 5.15)
      const seen = request.headers.get("If-Match") ?? (body.version == null ? null : String(body.version));
      if (seen && seen.replaceAll('"', "") !== String(c.version || "1")) {
        const last = [...(state.audit || [])].reverse().find((e) => e.entity_id === c.id && e.action?.startsWith("customer."));
        return problem(412, "precondition_failed", "Outra pessoa gravou a ficha antes", {
          detail: `${last?.actor_label || "Alguém da equipe"} mudou a ficha${last ? ` às ${new Date(last.occurred_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}` : ""}.`,
          current: detail(state, c),
        });
      }
      const changes = {};
      if (typeof body.internal_notes === "string" && body.internal_notes !== (c.internal_notes || "")) {
        changes.internal_notes = { from: c.internal_notes || "", to: body.internal_notes.slice(0, 2000) };
        c.internal_notes = body.internal_notes.slice(0, 2000);
      }
      if (Array.isArray(body.tags)) {
        const tags = body.tags.filter((t) => ["regular", "attention"].includes(t));
        if (tags.join() !== (c.tags || []).join()) changes.tags = { from: tagText(c.tags), to: tagText(tags) };
        c.tags = tags;
      }
      if (typeof body.blocked === "boolean" && body.blocked !== Boolean(c.blocked)) {
        if (body.blocked && !String(body.blocked_reason || "").trim()) {
          return problem(422, "validation", "Falta ajeitar alguns campos", { errors: [{ field: "blocked_reason", message: "Conte o motivo, para a equipe saber." }] });
        }
        changes.blocked = { from: Boolean(c.blocked), to: body.blocked };
        changes.blocked_reason = { from: c.blocked_reason || "", to: body.blocked ? body.blocked_reason.trim() : "" };
        c.blocked = body.blocked;
        c.blocked_reason = body.blocked ? body.blocked_reason.trim() : "";
      }
      if (Object.keys(changes).length) {
        c.version = String(Number(c.version || 1) + 1);
        const action = changes.blocked ? (c.blocked ? "customer.block" : "customer.unblock") : "customer.update";
        const verb = changes.blocked ? (c.blocked ? "Bloqueou" : "Desbloqueou") : changes.tags && !changes.internal_notes ? "Mudou os marcadores de" : "Anotou na ficha de";
        log(state, now, { action, entity_id: c.id, summary: `${verb} ${c.name}`, changes });
        save();
      }
      return HttpResponse.json(detail(state, c));
    });
  }),

  http.post(`${API}/staff/customers/:id/reveal-phone`, ({ params }) =>
    respond(() => {
      if (!MANAGEMENT.includes(currentRole())) return forbidden();
      const reauth = reauthRequired();
      if (reauth) return reauth;
      const now = mockNow();
      const state = getState(now);
      const c = findCustomer(state, params.id);
      if (!c) return notFound();
      if (isAnon(c) || !c.phone_e164) return problem(409, "conflict", "Esse cliente não tem telefone guardado");
      log(state, now, { action: "customer.reveal_phone", entity_id: c.id, summary: `Viu o telefone completo de ${c.name}`, changes: { phone: { secret: true } } });
      save();
      return HttpResponse.json({ phone_e164: c.phone_e164 });
    }),
  ),

  http.post(`${API}/staff/customers/:id/export`, ({ params }) =>
    respond(() => {
      if (currentRole() !== "owner") return forbidden();
      const reauth = reauthRequired();
      if (reauth) return reauth;
      const now = mockNow();
      const state = getState(now);
      const c = findCustomer(state, params.id);
      if (!c) return notFound();
      log(state, now, { action: "customer.export", entity_id: c.id, summary: `Exportou os dados de ${row(c).name}`, changes: { file: { secret: true } } });
      save();
      const d = detail(state, c);
      return HttpResponse.json({
        exported_at: now.toISOString(),
        house: state.house?.name || "Território",
        customer: {
          name: isAnon(c) ? null : c.name,
          phone: c.phone_e164,
          locale: d.locale,
          customer_since: d.created_at,
          visits: d.visits,
          no_shows: d.no_shows,
          last_visit_at: d.last_visit_at,
          internal_notes: d.internal_notes,
          tags: d.tags,
          preferences: d.preferences,
          blocked: d.blocked,
        },
        consents: { marketing_opt_in: d.marketing_opt_in, remember_me: d.remember_me, privacy_version: d.privacy_version },
        reservations: d.history.map((r) => ({ code: r.code, date: r.date, time: r.time, party_size: r.party_size, status: r.status, source: r.source, tables: r.table_codes, notes: r.notes })),
      });
    }),
  ),

  http.post(`${API}/staff/customers/:id/anonymize`, ({ params }) =>
    respond(() => {
      if (currentRole() !== "owner") return forbidden();
      const reauth = reauthRequired();
      if (reauth) return reauth;
      const now = mockNow();
      const state = getState(now);
      const c = findCustomer(state, params.id);
      if (!c) return notFound();
      if (isAnon(c)) return new HttpResponse(null, { status: 204 });
      const name = c.name;
      const canceled = anonymize(state, c, now);
      log(state, now, {
        action: "customer.anonymize",
        entity_id: c.id,
        summary: `Anonimizou ${name}${canceled ? ` e cancelou ${canceled} reserva${canceled > 1 ? "s" : ""} futura${canceled > 1 ? "s" : ""}, com aviso ao cliente` : ""}`,
        changes: { name: { secret: true }, phone: { secret: true } },
      });
      save();
      return new HttpResponse(null, { status: 204 });
    }),
  ),

  // ---- pedidos de privacidade (LGPD) ------------------------------------------------------

  http.get(`${API}/staff/privacy/requests`, ({ request }) =>
    respond((scenario) => {
      if (currentRole() !== "owner") return forbidden();
      if (scenario === "vazio") return HttpResponse.json({ items: [], next_cursor: null });
      const status = new URL(request.url).searchParams.get("status");
      const state = getState(mockNow());
      const items = requestsOf(state)
        .filter((r) => !status || r.status === status)
        .sort((a, b) => Number(a.status !== "open") - Number(b.status !== "open") || (a.status === "open" ? a.due_at.localeCompare(b.due_at) : String(b.resolved_at).localeCompare(String(a.resolved_at))));
      return HttpResponse.json({ items, next_cursor: null });
    }),
  ),

  http.post(`${API}/staff/privacy/requests`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    return respond(() => {
      if (currentRole() !== "owner") return forbidden();
      const now = mockNow();
      const state = getState(now);
      const c = findCustomer(state, body.customer_id);
      const errors = [];
      if (!c || isAnon(c)) errors.push({ field: "customer_id", message: "Escolha o cliente que fez o pedido." });
      if (!["access", "correction", "deletion", "portability", "opt_out"].includes(body.kind)) errors.push({ field: "kind", message: "Escolha o tipo de pedido." });
      if (!["account", "whatsapp", "email", "in_person"].includes(body.channel)) errors.push({ field: "channel", message: "Escolha por onde o pedido chegou." });
      if (errors.length) return problem(422, "validation", "Falta ajeitar alguns campos", { errors });
      const item = {
        id: uuid(),
        customer_id: c.id,
        customer_label: `${c.name.split(" ")[0]} · ${masked(c.phone_e164)}`,
        kind: body.kind,
        channel: body.channel,
        status: "open",
        opened_at: now.toISOString(),
        due_at: new Date(now.getTime() + 15 * DAY).toISOString(),
        resolved_at: null,
        resolved_by: null,
        note: String(body.note || "").slice(0, 500),
      };
      requestsOf(state).push(item);
      log(state, now, { action: "privacy.create", entity_type: "privacy_request", entity_id: item.id, summary: `Registrou um pedido de dados de ${c.name}` });
      save();
      return HttpResponse.json(item, { status: 201 });
    });
  }),

  http.post(`${API}/staff/privacy/requests/:id/resolve`, async ({ params, request }) => {
    const body = await request.json().catch(() => ({}));
    return respond(() => {
      if (currentRole() !== "owner") return forbidden();
      const now = mockNow();
      const state = getState(now);
      const item = requestsOf(state).find((r) => r.id === params.id);
      if (!item) return problem(404, "not_found", "Não achamos esse pedido");
      if (item.status !== "open") return problem(409, "conflict", "Esse pedido já foi resolvido");
      if (!["done", "rejected"].includes(body.status)) return problem(422, "validation", "Falta ajeitar alguns campos", { errors: [{ field: "status", message: "Escolha atender ou recusar." }] });
      const note = String(body.note || "").trim().slice(0, 500);
      if (body.status === "rejected" && !note) return problem(422, "validation", "Falta ajeitar alguns campos", { errors: [{ field: "note", message: "Conte o motivo da recusa: ele vai para o cliente." }] });
      const c = item.customer_id ? findCustomer(state, item.customer_id) : null;
      // a confirmação entra na fila de envio antes de o telefone ser anonimizado
      state.outbox ??= [];
      if (c?.phone_e164) state.outbox.push({ id: uuid(), to: c.phone_e164, template: `privacy_${body.status}`, queued_at: now.toISOString() });
      if (body.status === "done" && item.kind === "deletion" && c && !isAnon(c)) anonymize(state, c, now);
      Object.assign(item, { status: body.status, resolved_at: now.toISOString(), resolved_by: me(state)?.name ?? "Equipe", note: note || item.note });
      log(state, now, {
        action: "privacy.resolve",
        entity_type: "privacy_request",
        entity_id: item.id,
        summary: `${body.status === "done" ? "Deu por atendido" : "Recusou"} o pedido de dados de ${item.customer_label.split(" · ")[0]}`,
        changes: { status: { from: "open", to: body.status } },
      });
      save();
      return HttpResponse.json(item);
    });
  }),
];
