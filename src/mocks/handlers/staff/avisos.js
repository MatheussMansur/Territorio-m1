// A central de avisos da equipe (FR-87): a lista de cada pessoa, marcar como lido, dispensar só
// para si (informativo), marcar como resolvido para todos (o que não some sozinho) e as escolhas
// de "Meus avisos". Os avisos vêm do mesmo lugar que os alertas do Hoje (hoje.js), então o que
// sai de um sai do outro. Mudanças chegam às telas pelo tópico "alerts" do fluxo ao vivo.
import { http, HttpResponse } from "msw";
import { canMute, codeOf, codesFor, inQuiet, LEVELS, levelOf, noticeOf } from "../../../admin/avisos/catalogo.js";
import { countsOf, dismissFor, markRead, mutedOf, quietOf, resolveForAll, setMuted } from "../../avisos.js";
import { getState, save } from "../../db.js";
import { houseParts } from "../../../lib/dates.js";
import { mockNow, problem, respond } from "../../scenario.js";
import { centralFor, personNow } from "./hoje.js";
import { roleNow } from "./reservas.js";
import { logAction } from "./salao.js";

const API = "/api/v1";
const readJson = (request) => request.clone().json().catch(() => ({}));

function context(scenario) {
  const now = mockNow();
  const state = getState(now);
  const role = roleNow();
  const user = personNow(state, role, now);
  const list = centralFor(state, user, role, now, scenario);
  return { now, state, role, user, list };
}

function answer({ now, state, list }) {
  const quiet = quietOf(state);
  return {
    server_time: now.toISOString(),
    quiet: { from: quiet.quiet_from, to: quiet.quiet_to, active: inQuiet(houseParts(now).minutes, quiet) },
    ...countsOf(list),
    items: list,
  };
}

const notFound = () => problem(404, "not_found", "Esse aviso não está mais aqui");

export const handlers = [
  http.get(`${API}/staff/alerts`, () =>
    respond((scenario) => {
      // a leitura só grava quando um aviso nasceu ou foi resolvido (centralFor faz isso)
      return HttpResponse.json(answer(context(scenario)));
    }),
  ),

  // marcar como lido: os ids mostrados, ou todos os ativos quando a lista vem vazia
  http.post(`${API}/staff/alerts/read`, ({ request }) =>
    respond(async (scenario) => {
      const ctx = context(scenario);
      const body = await readJson(request);
      const mine = new Set(ctx.list.map((n) => n.id));
      const ids = Array.isArray(body.ids) && body.ids.length ? body.ids.filter((id) => mine.has(id)) : ctx.list.filter((n) => !n.resolved_at).map((n) => n.id);
      markRead(ctx.state, ctx.user.id, ids, ctx.now);
      save();
      return HttpResponse.json(answer({ ...ctx, list: centralFor(ctx.state, ctx.user, ctx.role, ctx.now, scenario) }));
    }),
  ),

  http.post(`${API}/staff/alerts/:id/dismiss`, ({ params }) =>
    respond((scenario) => {
      const ctx = context(scenario);
      const id = decodeURIComponent(params.id);
      const n = ctx.list.find((x) => x.id === id);
      if (!n) return notFound();
      if (!n.can_dismiss) return problem(409, "invalid_transition", "Esse aviso não se dispensa", { detail: "Só os informativos se dispensam só para você. Os outros somem quando o problema é resolvido." });
      dismissFor(ctx.state, ctx.user.id, id, ctx.now);
      save();
      return new HttpResponse(null, { status: 204 });
    }),
  ),

  http.post(`${API}/staff/alerts/:id/resolve`, ({ params }) =>
    respond((scenario) => {
      const ctx = context(scenario);
      const id = decodeURIComponent(params.id);
      const n = ctx.list.find((x) => x.id === id);
      if (!n) return notFound();
      if (!n.can_resolve) return problem(409, "invalid_transition", "Esse aviso some sozinho", { detail: levelOf(n.kind) === "critical" ? "Aviso crítico só sai quando o problema acaba." : "Ele sai quando o que pediu atenção for resolvido." });
      resolveForAll(ctx.state, id, ctx.user.name || "Equipe", ctx.now);
      logAction(ctx.state, { action: "alert.resolve", entity: "alert", id, summary: `Marcou como resolvido o aviso "${noticeOf(n.kind)?.title || n.kind}"`, at: ctx.now });
      save();
      return new HttpResponse(null, { status: 204 });
    }),
  ),

  // "Meus avisos": os códigos que a pessoa recebe e os que ela não segue
  http.get(`${API}/staff/me/alert-preferences`, () =>
    respond(() => {
      const now = mockNow();
      const state = getState(now);
      const role = roleNow();
      const user = personNow(state, role, now);
      return HttpResponse.json(preferences(state, user, role));
    }),
  ),

  http.put(`${API}/staff/me/alert-preferences`, ({ request }) =>
    respond(async () => {
      const now = mockNow();
      const state = getState(now);
      const role = roleNow();
      const user = personNow(state, role, now);
      const body = await readJson(request);
      const muted = Array.isArray(body.muted) ? body.muted.map(String).map(codeOf) : null;
      if (!muted) return problem(422, "validation", "Confira os campos", { errors: [{ field: "muted", message: "Mande a lista dos avisos que você não quer seguir." }] });
      const critical = muted.filter((c) => noticeOf(c) && !canMute(c));
      if (critical.length) return problem(422, "validation", "Aviso crítico não desliga", { errors: [{ field: "muted", message: "Os avisos críticos chegam para todos que recebem, sempre." }] });
      const mine = new Set(codesFor(role));
      setMuted(state, user.id, muted.filter((c) => mine.has(c)));
      save();
      return HttpResponse.json(preferences(state, user, role));
    }),
  ),
];

function preferences(state, user, role) {
  const muted = new Set(mutedOf(state, user.id));
  return {
    muted: [...muted],
    items: codesFor(role)
      .map((code) => ({ code, level: levelOf(code), title: noticeOf(code).title, clears: noticeOf(code).clears, can_mute: canMute(code), following: !muted.has(code) }))
      .sort((a, b) => LEVELS[a.level].order - LEVELS[b.level].order),
  };
}
