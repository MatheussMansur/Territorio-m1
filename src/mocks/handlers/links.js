// Links que as mensagens levam, sem entrar na conta (FR-32): o comprovante (só leitura), o link de
// ação do lembrete (/confirmar) e o link da lista de espera (/espera). Abrir um link nunca
// muda nada; toda resposta é um POST. Um link só de leitura que tenta agir recebe 403.
import { http, HttpResponse } from "msw";
import { buildIcs } from "../../lib/cliente.js";
import { addDays } from "../../lib/dates.js";
import { getState, save } from "../db.js";
import { mockNow, problem, respond } from "../scenario.js";
import {
  ACTIVE,
  cancelByCustomer,
  cancelReservation,
  forced,
  history,
  lateNotice,
  offerFreedPlace,
  reservationPublic,
  startsAt,
  sweepWaitlist,
  tokensOf,
} from "./customer.js";

const API = "/api/v1";
const LINK_DAYS = 30;

/** A reserva e o que o token pode fazer: "receipt" só mostra; "confirm" e "waitlist_offer" agem. */
function findLink(state, token) {
  for (const r of state.reservations) {
    if (!r.public_token) continue;
    const t = tokensOf(r);
    if (token === t.view) return { r, kind: "receipt", canAct: false };
    if (token === t.action) return { r, kind: "confirm", canAct: true };
    if (token === t.waitlist) return { r, kind: "waitlist_offer", canAct: true };
  }
  return null;
}

/** O link, ou o problema: cortado ou desconhecido (404), passado dos 30 dias (410). */
function open(state, token) {
  const link = findLink(state, token);
  if (!link) return { error: problem(404, "not_found", "Esse link não abriu.", { reason: "link" }) };
  if (forced("link_vencido") || mockNow() > new Date(`${addDays(link.r.date, LINK_DAYS)}T23:59:59-03:00`)) {
    return { error: problem(410, "gone", "Esse link venceu.", { reason: "link" }) };
  }
  return link;
}

function view(state, link) {
  const r = link.r;
  return {
    kind: link.kind,
    can_act: link.canAct,
    reservation: reservationPublic(state, r),
    answered: link.kind === "confirm" ? (r.link_answer ?? null) : null,
    server_time: mockNow().toISOString(),
  };
}

const readOnly = () => problem(403, "read_only_link", "Este link é só para ver.");
const used = () => problem(409, "conflict", "Isso já foi feito.", { reason: "link_used" });

export const linkHandlers = [
  http.get(`${API}/links/:token`, ({ params }) =>
    respond(() => {
      const state = getState(mockNow());
      sweepWaitlist(state);
      const link = open(state, params.token);
      return link.error || HttpResponse.json(view(state, link));
    }),
  ),

  // o arquivo de calendário: funciona com qualquer link, só lê
  http.get(`${API}/links/:token/calendar`, ({ params }) =>
    respond(() => {
      const state = getState(mockNow());
      const link = open(state, params.token);
      if (link.error) return link.error;
      if (forced("ics")) return problem(500, "server", "Erro simulado ao gerar a agenda.");
      const r = link.r;
      const a = state.house.address;
      const ics = buildIcs({
        code: r.code,
        date: r.date,
        time: r.time,
        durationMin: r.duration_min || 120,
        title: `${state.house.name} · ${r.code}`,
        location: `${a.street}, ${a.number} - ${a.district}, ${a.city} - ${a.state}`,
        description: `Reserva ${r.code} · ${r.party_size} pessoas`,
        url: `${window.location.origin}${reservationPublic(state, r).receipt_url}`,
        now: mockNow(),
      });
      return new HttpResponse(ics, {
        headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="territorio-${r.code}.ics"` },
      });
    }),
  ),

  // Confirmo / Vou atrasar um pouco / Não vou mais: pode mudar até o horário
  http.post(`${API}/links/:token/confirm`, async ({ params, request }) =>
    respond(async () => {
      const now = mockNow();
      const state = getState(now);
      const link = open(state, params.token);
      if (link.error) return link.error;
      if (!link.canAct || link.kind !== "confirm") return readOnly();
      const r = link.r;
      const { answer } = await request.json().catch(() => ({}));
      if (!["yes", "no", "late"].includes(answer)) return problem(422, "validation", "Resposta inválida.", { errors: [{ field: "answer", message: "Resposta inválida." }] });
      const arrived = r.status === "completed" || r.arrived_at || r.table_session_id;
      if (arrived || !["pending", "confirmed"].includes(r.status)) {
        // nada muda, a mesa não é oferecida à lista de espera; o painel vê o toque
        history(r, "link_tap", `Tocou “${{ yes: "Confirmo", no: "Não vou mais", late: "Vou atrasar um pouco" }[answer]}” pelo link, mas a reserva já tinha mudado`);
        save();
        return problem(409, "invalid_transition", "Essa reserva já mudou.");
      }
      if (r.link_answer === answer && answer !== "yes") return used();
      if (r.link_answer === "yes" && answer === "yes") return used();
      if (answer === "late") {
        const refused = lateNotice(state, r, now);
        if (refused) return refused;
      } else if (now >= startsAt(r)) {
        return problem(409, "invalid_transition", "Essa reserva já mudou.");
      }
      if (answer === "no") {
        const refused = cancelByCustomer(state, r, now);
        if (refused) return refused;
      }
      if (answer === "yes") {
        r.customer_confirmation = "confirmed";
        history(r, "customer_confirmed", "Confirmou pelo link da mensagem");
      }
      r.link_answer = answer;
      r.link_answered_at = now.toISOString();
      save();
      return HttpResponse.json(view(state, link));
    }),
  ),

  http.post(`${API}/links/:token/cancel`, ({ params }) =>
    respond(() => {
      const now = mockNow();
      const state = getState(now);
      const link = open(state, params.token);
      if (link.error) return link.error;
      if (!link.canAct) return readOnly();
      const refused = cancelByCustomer(state, link.r, now);
      if (refused) return refused;
      link.r.link_answer = "no";
      save();
      return HttpResponse.json(view(state, link));
    }),
  ),

  // "Quero a mesa": confirma a mesa oferecida; com outra reserva naquela noite (ou o limite),
  // a página pede para trocar, e swap_code move aquela reserva (mesmo código TR) para esta mesa
  http.post(`${API}/links/:token/accept-offer`, async ({ params, request }) =>
    respond(async () => {
      const now = mockNow();
      const state = getState(now);
      sweepWaitlist(state, now);
      const link = open(state, params.token);
      if (link.error) return link.error;
      if (!link.canAct) return readOnly();
      const r = link.r;
      const body = await request.json().catch(() => ({}));
      if (r.status === "confirmed" || r.status === "pending" || (r.status === "canceled" && r.swapped_into)) return used();
      if (r.status === "expired") return problem(409, "offer_expired", "A espera desse horário acabou.", { reason: "night_closed" });
      if (r.status === "waitlisted" && r.offer_expired_at) {
        return problem(409, "offer_expired", "O tempo para aceitar passou.", { minutes: state.settings?.waitlist?.data?.offer_min ?? state.booking.waitlist_offer_min ?? 10 });
      }
      if (r.status !== "offered") return problem(409, "invalid_transition", "Essa reserva já mudou.");
      const mine = state.reservations.filter(
        (x) => x.id !== r.id && x.customer_id === r.customer_id && ["pending", "confirmed"].includes(x.status) && startsAt(x) >= now,
      );
      const sameNight = mine.find((x) => x.date === r.date);
      const atLimit = mine.length >= (state.booking.max_active_per_phone ?? 2);
      const other = sameNight || (atLimit ? mine[0] : null);
      if (other && body.swap_code !== other.code) {
        return problem(409, "conflict", "Você já tem uma reserva.", {
          reason: sameNight ? (sameNight.time === r.time ? "duplicate_reservation" : "same_night") : "active_limit",
          existing: reservationPublic(state, other),
        });
      }
      if (other) {
        // a reserva que a pessoa tem mantém o código TR e vai para a mesa oferecida; a mesa antiga vai para a lista de espera
        const old = { date: other.date, time: other.time };
        Object.assign(other, { date: r.date, time: r.time, party_size: r.party_size, table_codes: [...(r.table_codes || [])], area_key: r.area_key, starts_at: r.starts_at, late_notice_at: null });
        history(other, "rescheduled", `Trocou pela mesa oferecida às ${r.time}`);
        Object.assign(r, { status: "canceled", canceled_by: "customer", cancel_reason: "Trocou a reserva pela mesa oferecida", table_codes: [], offer_expires_at: null, swapped_into: other.code });
        offerFreedPlace(state, old.date, now);
        save();
        return HttpResponse.json({ ...view(state, { r: other, kind: "receipt", canAct: false }), swapped: true });
      }
      Object.assign(r, { status: "confirmed", offer_expires_at: null, waitlist_position: null });
      r.messages ??= [];
      r.messages.push({ template: "booking_confirmed", status: "queued", sent_at: now.toISOString() });
      history(r, "offer_accepted", "Aceitou a mesa oferecida");
      save();
      return HttpResponse.json(view(state, link));
    }),
  ),

  // "Pode passar a vez": sai da fila deste horário, e a oferta vai na hora para o próximo
  http.post(`${API}/links/:token/decline-offer`, ({ params }) =>
    respond(() => {
      const now = mockNow();
      const state = getState(now);
      sweepWaitlist(state, now);
      const link = open(state, params.token);
      if (link.error) return link.error;
      if (!link.canAct) return readOnly();
      const r = link.r;
      if (!ACTIVE.has(r.status) || !["offered", "waitlisted"].includes(r.status)) return used();
      const wasOffered = r.status === "offered";
      cancelReservation(state, r, { reason: "Passou a vez" });
      if (!wasOffered) r.messages?.pop(); // sair da fila não manda mensagem de cancelamento
      save();
      return HttpResponse.json(view(state, link));
    }),
  ),
];
