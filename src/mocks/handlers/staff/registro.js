// O registro de ações (história 1.13): o dono vê tudo, um gerente só as próprias ações,
// as mais novas primeiro, com filtros por pessoa, tipo de ação, aparelho e período. A exportação pede
// a senha de novo, segue os mesmos filtros e vai para o próprio registro. Nada aqui edita
// ou apaga uma entrada.
import { http, HttpResponse } from "msw";
import { houseParts } from "../../../lib/dates.js";
import { session } from "../../../lib/storage.js";
import { uuid } from "../../../lib/uuid.js";
import { getState, save } from "../../db.js";
import { currentRole, mockNow, problem, respond } from "../../scenario.js";

const API = "/api/v1";
const BOM = "﻿"; // com isso o Excel lê os acentos certo
// a janela de identidade que POST /staff/auth/reauth abre (história 1.7): 5 minutos, depois 403 reauth_required
const reauthOk = () => {
  const at = Number(session.get("territorio:mock-reauth", 0));
  return at > 0 && Date.now() - at < 5 * 60_000;
};

function me(state) {
  const role = currentRole();
  return state.users.find((u) => u.role === role && u.status === "active") || null;
}

/** actor: o id de uma pessoa, ou "system" / "customer"; action: um prefixo ("reservation" ou "reservation.cancel"). */
function filtered(state, { actor, action, device, from, to }) {
  return (state.audit || [])
    .filter((e) => {
      if (actor === "system" || actor === "customer") {
        if (e.actor_type !== actor) return false;
      } else if (actor && e.actor_id !== actor) return false;
      if (action && !(e.action === action || String(e.action).startsWith(`${action}.`))) return false;
      if (device && (e.device_label || "") !== device) return false;
      const day = houseParts(e.occurred_at).date;
      if (from && day < from) return false;
      if (to && day > to) return false;
      return true;
    })
    .sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)));
}

const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const changeText = (changes) =>
  Object.entries(changes || {})
    .map(([k, v]) => (v?.secret ? `${k}: trocado` : `${k}: ${v?.from ?? "—"} → ${v?.to ?? "—"}`))
    .join("; ");

export const handlers = [
  http.get(`${API}/staff/audit`, ({ request }) =>
    respond((scenario) => {
      const role = currentRole();
      if (!["owner", "manager"].includes(role)) return problem(403, "forbidden", "Essa parte é de outro perfil da equipe");
      if (scenario === "vazio") return HttpResponse.json({ items: [], next_cursor: null });
      const state = getState(mockNow());
      const p = new URL(request.url).searchParams;
      const query = Object.fromEntries(["actor", "action", "device", "from", "to"].map((k) => [k, p.get(k) || ""]));
      if (role === "manager") query.actor = me(state)?.id || "-";
      const all = filtered(state, query);
      const limit = Math.min(Math.max(Number(p.get("limit")) || 30, 1), 100);
      const offset = Number(p.get("cursor")) || 0;
      return HttpResponse.json({ items: all.slice(offset, offset + limit), next_cursor: offset + limit < all.length ? String(offset + limit) : null, total: all.length });
    }),
  ),

  http.post(`${API}/staff/audit/export`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    return respond(() => {
      if (currentRole() !== "owner") return problem(403, "forbidden", "Essa parte é de outro perfil da equipe");
      if (!reauthOk()) return problem(403, "reauth_required", "Confirme que é você", { detail: "Exportar pede a senha e o código de novo." });
      const now = mockNow();
      const state = getState(now);
      const rows = filtered(state, body);
      const head = ["quando", "quem", "aparelho", "acao", "resumo", "antes_e_depois"].join(",");
      const lines = rows.map((e) => [e.occurred_at, e.actor_label, e.device_label, e.action, e.summary, changeText(e.changes)].map(csvCell).join(","));
      const user = me(state);
      state.audit.push({
        id: uuid(),
        occurred_at: now.toISOString(),
        actor_type: "user",
        actor_id: user?.id ?? null,
        actor_label: user?.name ?? "Equipe",
        device_label: "Acesso pessoal",
        action: "audit.export",
        entity_type: "audit",
        entity_id: null,
        summary: `Exportou o registro (${rows.length} ações)`,
        changes: { file: { secret: true } },
      });
      save();
      return new HttpResponse(`${BOM}${[head, ...lines].join("\r\n")}\r\n`, {
        status: 200,
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="registro.csv"' },
      });
    });
  }),
];
