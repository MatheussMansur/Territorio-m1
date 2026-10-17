// Equipe e permissões (histórias 1.9 e 1.15), só o dono: convidar por e-mail (link de 72 h),
// cadastrar pessoas que só entram com o PIN (os últimos 4 dígitos do telefone), mudar o
// perfil (pede a senha de novo), desativar e reativar (nunca apaga, e a casa nunca
// fica sem um dono ativo), reenviar o convite, encerrar sessões, zerar a verificação em duas
// etapas, e as permissões por área do gerente e da recepção.
import { http, HttpResponse } from "msw";
import { AREAS, defaultAreas } from "../../../admin/nav.js";
import { maskPhone, toE164 } from "../../../lib/phone.js";
import { local, session } from "../../../lib/storage.js";
import { uuid } from "../../../lib/uuid.js";
import { getState, save } from "../../db.js";
import { authOf, currentRole, DEVICE_COOKIE, mockNow, problem, respond, saveDeviceRecord } from "../../scenario.js";

const API = "/api/v1";
const HOUR = 3_600_000;
const ROLES = ["owner", "manager", "floor"];
const ROLE_LABEL = { owner: "dono", manager: "gerente", floor: "recepção" };
const PROFILES = ["manager", "floor"];

const forbidden = () => problem(403, "forbidden", "Essa parte é de outro perfil da equipe");
// a janela de identidade que POST /staff/auth/reauth abre (história 1.7): 5 minutos, depois 403 reauth_required
const REAUTH_KEY = "territorio:mock-reauth";
const reauthOk = () => {
  const at = Number(session.get(REAUTH_KEY, 0));
  return at > 0 && Date.now() - at < 5 * 60_000;
};
const reauthRequired = () => problem(403, "reauth_required", "Confirme que é você", { detail: "Essa ação pede a senha e o código de novo." });
// as listas de alerta de Configurações › Avisos (história 2.15)
const ALERT_LISTS = { pending_to: "reservas pendentes", late_request_to: "pedidos em cima da hora", privacy_request_to: "pedidos de dados", security_to: "segurança", system_to: "alertas do sistema" };
const notFound = () => problem(404, "not_found", "Não achamos essa pessoa");
const invalid = (errors) => problem(422, "validation", "Falta ajeitar alguns campos", { errors });

function me(state) {
  const role = currentRole();
  return state.users.find((u) => u.role === role && u.status === "active") || null;
}

function log(state, now, { action, entity_type = "user", entity_id = null, summary, changes = {} }) {
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

/** As listas de alerta em que esta pessoa é a única ativa que recebe (história 2.15). */
function soleAlerts(state, u) {
  const data = state.settings?.alerts?.data;
  if (!data) return [];
  const active = (id) => state.users.some((x) => x.id === id && x.status === "active");
  return Object.keys(ALERT_LISTS).filter((key) => {
    const list = (data[key] || []).filter(active);
    return list.length === 1 && list[0] === u.id;
  });
}

/**
 * A pessoa sai de todas as listas de alerta; uma lista que fica sem ninguém passa para os donos ativos
 * (história 2.15). Devolve os nomes das listas repassadas.
 */
function handAlertsToOwner(state, now, u) {
  const doc = state.settings?.alerts;
  if (!doc?.data) return [];
  const owners = activeOwners(state).filter((o) => o.id !== u.id).map((o) => o.id);
  const handed = [];
  for (const key of Object.keys(ALERT_LISTS)) {
    const list = doc.data[key];
    if (!Array.isArray(list) || !list.includes(u.id)) continue;
    const rest = list.filter((id) => id !== u.id && state.users.some((x) => x.id === id && x.status === "active"));
    doc.data[key] = rest.length ? list.filter((id) => id !== u.id) : owners;
    if (!rest.length) handed.push(ALERT_LISTS[key]);
  }
  if (handed.length) {
    doc.version = (Number(doc.version) || 0) + 1;
    doc.updated_at = now.toISOString();
  }
  return handed;
}

/** O aparelho da casa onde a pessoa entrou por último com o PIN (lido do registro), se houver. */
function lastDeviceOf(state, u) {
  const entry = (state.audit || [])
    .filter((e) => e.action === "auth.pin_login" && (e.entity_id === u.id || e.actor_id === u.id))
    .sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)))[0];
  return entry?.device_label && entry.device_label !== "Acesso pessoal" ? entry.device_label : null;
}

/** Encerra as sessões da pessoa: as pessoais, e o aparelho da casa onde ela é quem está dentro. */
function endSessions(state, now, u) {
  let count = 0;
  for (const s of authOf(state).sessions) {
    if (s.user_id === u.id && !s.ended_at) {
      s.ended_at = now.toISOString();
      count++;
    }
  }
  const device = local.get(DEVICE_COOKIE);
  if (device?.person_id === u.id) {
    saveDeviceRecord({ ...device, person_id: null });
    count++;
  }
  return count;
}

function view(u, state) {
  return {
    id: u.id,
    name: u.name || "",
    email: u.email || null,
    role: u.role,
    status: u.status,
    phone_masked: u.phone_e164 ? maskPhone(u.phone_e164) : null,
    pin_only: Boolean(u.pin_only),
    pin_locked_until: u.pin_locked_until || null,
    mfa_enabled: Boolean(u.mfa_enabled),
    last_login_at: u.last_login_at || null,
    invite_expires_at: u.invite_expires_at || null,
    // as listas de alerta que só esta pessoa recebe (história 2.15)
    sole_alerts: state && u.status === "active" ? soleAlerts(state, u).map((k) => ALERT_LISTS[k]) : [],
  };
}

const label = (u) => u.name || u.email || "pessoa";
const activeOwners = (state) => state.users.filter((u) => u.role === "owner" && u.status === "active");
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function permissions(state) {
  const saved = state.permissions || {};
  const keys = AREAS.map((a) => a.key);
  const allowed = Object.fromEntries(PROFILES.map((p) => [p, Array.isArray(saved[p]) ? saved[p].filter((k) => keys.includes(k)) : defaultAreas(p)]));
  return {
    areas: keys,
    defaults: Object.fromEntries(PROFILES.map((p) => [p, defaultAreas(p)])),
    allowed,
    owner: keys,
    updated_at: saved.updated_at || null,
    updated_by: saved.updated_by || null,
  };
}

const areaNames = (keys) => (keys.length ? AREAS.filter((a) => keys.includes(a.key)).map((a) => a.label).join(", ") : "nenhuma");

export const handlers = [
  http.get(`${API}/staff/users`, () =>
    respond((scenario) => {
      if (currentRole() !== "owner") return forbidden();
      const state = getState(mockNow());
      const list = scenario === "vazio" ? state.users.filter((u) => u.role === "owner" && u.status === "active").slice(0, 1) : state.users;
      return HttpResponse.json(list.map((u) => view(u, state)));
    }),
  ),

  http.post(`${API}/staff/users`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    return respond(() => {
      if (currentRole() !== "owner") return forbidden();
      const now = mockNow();
      const state = getState(now);
      const name = String(body.name || "").trim();
      const phone = toE164(String(body.phone || ""));
      const errors = [];
      if (name.length < 2 || name.length > 60) errors.push({ field: "name", message: "Escreva o nome da pessoa, de 2 a 60 letras." });
      if (!ROLES.includes(body.role) || body.role === "owner") errors.push({ field: "role", message: "Escolha gerente ou recepção." });
      if (!phone) errors.push({ field: "phone", message: "Confira o celular: o PIN é o final dele." });
      else if (state.users.some((u) => u.phone_e164 === phone && u.status !== "disabled")) errors.push({ field: "phone", message: "Esse celular já é de outra pessoa da equipe." });
      if (errors.length) return invalid(errors);
      const user = {
        id: uuid(),
        name,
        email: null,
        role: body.role,
        status: "active",
        phone_e164: phone,
        pin_only: true,
        pin_locked_until: null,
        mfa_enabled: false,
        last_login_at: null,
        invite_expires_at: null,
        created_at: now.toISOString(),
      };
      state.users.push(user);
      log(state, now, { action: "user.create_pin", entity_id: user.id, summary: `Cadastrou ${name} (${ROLE_LABEL[user.role]}, só PIN)`, changes: { pin: { secret: true } } });
      save();
      return HttpResponse.json(view(user, state), { status: 201 });
    });
  }),

  http.post(`${API}/staff/users/invite`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    return respond(() => {
      if (currentRole() !== "owner") return forbidden();
      const now = mockNow();
      const state = getState(now);
      const email = String(body.email || "").trim().toLowerCase();
      const errors = [];
      if (!EMAIL.test(email)) errors.push({ field: "email", message: "Confira o e-mail: falta o @ ou o final." });
      else if (state.users.some((u) => (u.email || "").toLowerCase() === email)) errors.push({ field: "email", message: "Esse e-mail já é da equipe." });
      if (!ROLES.includes(body.role)) errors.push({ field: "role", message: "Escolha o perfil." });
      if (errors.length) return invalid(errors);
      const user = {
        id: uuid(),
        name: "",
        email,
        role: body.role,
        status: "invited",
        phone_e164: null,
        pin_only: false,
        pin_locked_until: null,
        mfa_enabled: false,
        last_login_at: null,
        invite_expires_at: new Date(now.getTime() + 72 * HOUR).toISOString(),
        created_at: now.toISOString(),
      };
      state.users.push(user);
      log(state, now, { action: "user.invite", entity_id: user.id, summary: `Convidou ${email} como ${ROLE_LABEL[user.role]}`, changes: { role: { from: null, to: user.role } } });
      save();
      return HttpResponse.json(view(user, state), { status: 201 });
    });
  }),

  http.patch(`${API}/staff/users/:id`, async ({ params, request }) => {
    const body = await request.json().catch(() => ({}));
    return respond(() => {
      if (currentRole() !== "owner") return forbidden();
      const now = mockNow();
      const state = getState(now);
      const user = state.users.find((u) => u.id === params.id);
      if (!user) return notFound();
      const changes = {};
      const next = { role: user.role, status: user.status };

      if (body.role !== undefined && body.role !== user.role) {
        if (!ROLES.includes(body.role)) return invalid([{ field: "role", message: "Escolha o perfil." }]);
        if (!reauthOk()) return reauthRequired();
        next.role = body.role;
        changes.role = { from: user.role, to: body.role };
      }
      if (body.status !== undefined && body.status !== user.status) {
        if (!["active", "disabled"].includes(body.status)) return invalid([{ field: "status", message: "Situação inválida." }]);
        if (user.status === "invited" && body.status === "active") return problem(409, "conflict", "A pessoa ainda não aceitou o convite");
        next.status = body.status;
        changes.status = { from: user.status, to: body.status };
      }
      const wasOwner = user.role === "owner" && user.status === "active";
      const staysOwner = next.role === "owner" && next.status === "active";
      if (wasOwner && !staysOwner && activeOwners(state).length <= 1) {
        return problem(409, "conflict", "A casa precisa de pelo menos um dono ativo", { detail: "Passe o perfil de dono para outra pessoa antes de mudar este." });
      }
      if (body.phone !== undefined) {
        const phone = toE164(String(body.phone || ""));
        if (!phone) return invalid([{ field: "phone", message: "Confira o celular: o PIN é o final dele." }]);
        if (state.users.some((u) => u.id !== user.id && u.phone_e164 === phone && u.status !== "disabled")) return invalid([{ field: "phone", message: "Esse celular já é de outra pessoa da equipe." }]);
        if (phone !== user.phone_e164) {
          changes.phone = { secret: true };
          changes.pin = { secret: true };
          user.phone_e164 = phone;
          user.pin_locked_until = null;
        }
      }
      if (typeof body.name === "string" && body.name.trim() && body.name.trim() !== user.name) {
        changes.name = { from: user.name, to: body.name.trim().slice(0, 60) };
        user.name = body.name.trim().slice(0, 60);
      }
      Object.assign(user, next);
      let handed = [];
      let where = null;
      if (changes.status && next.status === "disabled") {
        // fora na hora em todo aparelho; o registro guarda o aparelho onde a pessoa estava (1.9)
        where = lastDeviceOf(state, user);
        endSessions(state, now, user);
        if (where) changes.device = { from: where, to: null };
        handed = handAlertsToOwner(state, now, user);
        if (handed.length) changes.alerts = { from: label(user), to: "dono" };
      }
      if (Object.keys(changes).length) {
        const what = changes.status
          ? `${next.status === "disabled" ? "Desativou" : "Reativou"} ${label(user)}${where ? ` (estava no ${where})` : ""}${handed.length ? `; os avisos de ${handed.join(", ")} passaram ao dono` : ""}`
          : changes.role
            ? `Mudou o perfil de ${label(user)} para ${ROLE_LABEL[next.role]}`
            : changes.phone
              ? `Trocou o celular (e o PIN) de ${label(user)}`
              : `Mudou o nome de ${label(user)}`;
        log(state, now, { action: changes.role ? "user.role_change" : "user.update", entity_id: user.id, summary: what, changes });
        save();
      }
      return HttpResponse.json({ ...view(user, state), alerts_handed_to_owner: handed });
    });
  }),

  http.post(`${API}/staff/users/:id/invite/resend`, ({ params }) =>
    respond(() => {
      if (currentRole() !== "owner") return forbidden();
      const now = mockNow();
      const state = getState(now);
      const user = state.users.find((u) => u.id === params.id);
      if (!user) return notFound();
      if (user.status !== "invited") return problem(409, "conflict", "A pessoa já aceitou o convite");
      user.invite_expires_at = new Date(now.getTime() + 72 * HOUR).toISOString();
      log(state, now, { action: "user.invite_resend", entity_id: user.id, summary: `Reenviou o convite de ${label(user)}`, changes: { invite_link: { secret: true } } });
      save();
      return HttpResponse.json(view(user, state));
    }),
  ),

  http.post(`${API}/staff/users/:id/revoke-sessions`, ({ params }) =>
    respond(() => {
      if (currentRole() !== "owner") return forbidden();
      const now = mockNow();
      const state = getState(now);
      const user = state.users.find((u) => u.id === params.id);
      if (!user) return notFound();
      log(state, now, { action: "user.revoke_sessions", entity_id: user.id, summary: `Encerrou as sessões de ${label(user)}` });
      save();
      return new HttpResponse(null, { status: 204 });
    }),
  ),

  // "Zerar verificação em duas etapas" (história 1.9)
  http.post(`${API}/staff/users/:id/mfa/reset`, ({ params }) =>
    respond(() => {
      if (currentRole() !== "owner") return forbidden();
      if (!reauthOk()) return reauthRequired();
      const now = mockNow();
      const state = getState(now);
      const user = state.users.find((u) => u.id === params.id);
      if (!user) return notFound();
      user.mfa_enabled = false;
      // o autenticador antigo para de funcionar e a pessoa sai de todo lugar (N1)
      const cred = authOf(state).credentials[user.id];
      if (cred) Object.assign(cred, { totp: null, pending_totp: null, recovery: [] });
      const ended = endSessions(state, now, user);
      log(state, now, {
        action: "user.mfa_reset",
        entity_id: user.id,
        summary: `Zerou a verificação em duas etapas de ${label(user)}; ${ended} ${ended === 1 ? "sessão encerrada" : "sessões encerradas"}`,
        changes: { totp_secret: { secret: true } },
      });
      save();
      return HttpResponse.json(view(user, state));
    }),
  ),

  // GET e PUT /staff/permissions (história 1.15), no contrato (docs/api/openapi.yaml 0.6.0)
  http.get(`${API}/staff/permissions`, () =>
    respond(() => {
      if (currentRole() !== "owner") return forbidden();
      return HttpResponse.json(permissions(getState(mockNow())));
    }),
  ),

  http.put(`${API}/staff/permissions`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    return respond(() => {
      if (currentRole() !== "owner") return forbidden();
      if (!reauthOk()) return reauthRequired();
      const now = mockNow();
      const state = getState(now);
      const before = permissions(state);
      const keys = AREAS.map((a) => a.key);
      const changes = {};
      const saved = { ...(state.permissions || {}) };
      for (const profile of PROFILES) {
        const wanted = body.allowed?.[profile];
        if (!Array.isArray(wanted)) continue;
        const clean = keys.filter((k) => wanted.includes(k));
        const isDefault = clean.join() === defaultAreas(profile).join();
        saved[profile] = isDefault ? null : clean;
        if (clean.join() !== before.allowed[profile].join()) changes[ROLE_LABEL[profile]] = { from: areaNames(before.allowed[profile]), to: areaNames(clean) };
      }
      const me_ = me(state);
      state.permissions = { ...saved, updated_at: now.toISOString(), updated_by: me_?.name ?? "Equipe" };
      log(state, now, {
        action: "permissions.update",
        entity_type: "permissions",
        summary: body.reset ? "Voltou as permissões por área ao padrão" : Object.keys(changes).length ? "Mudou as permissões por área" : "Revisou as permissões por área (sem mudanças)",
        changes,
      });
      save();
      return HttpResponse.json(permissions(state));
    });
  }),
];
