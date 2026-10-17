// A entrada da equipe (Épico 1, histórias 1.6 a 1.12) na simulação: e-mail e senha com o
// token do Turnstile, o código do autenticador ou um código de recuperação, "manter conectado", os links
// de uso único (primeiro acesso do dono, convite, nova senha), a checagem de identidade (senha E
// código, 5 minutos), minhas sessões e "Sair"; no aparelho da casa, o pareamento com uma chave
// WebCrypto, a sessão aberta com um desafio assinado, todo pedido assinado (hora, nonce, corpo),
// e a pessoa que entra tocando no próprio nome e no PIN.
//
// `guard` roda antes de toda outra rota da equipe, como o middleware do servidor: sem sessão →
// 401; a assinatura e o relógio do aparelho; ninguém no aparelho → no_active_person; o token
// CSRF em toda escrita. Não responde nada quando está tudo bem, para a próxima rota responder.
//
// Exportado como `authHandlers` (src/mocks/handlers/staff.js coloca essas rotas primeiro), não como `handlers`.
// Tudo isso está no contrato (docs/api/openapi.yaml 0.6.0): POST /staff/auth/reauth,
// recovery_code em /staff/auth/mfa, recovery_codes em POST /staff/me/mfa, server_time nas
// respostas do aparelho, `place` em Session, `replaces` em PairingRequest e
// session_kind/device/mfa_required/areas em GET /staff/me.
import { http, HttpResponse } from "msw";
import { AREAS, defaultAreas } from "../../../admin/nav.js";
import { local, session } from "../../../lib/storage.js";
import { uuid } from "../../../lib/uuid.js";
import { getState, save } from "../../db.js";
import {
  authOf,
  clearDemoRole,
  currentSession,
  DEVICE_COOKIE,
  mockNow,
  PERSONAL_COOKIE,
  personalCookie,
  problem,
  respond,
  saveDeviceRecord,
} from "../../scenario.js";
import { DEMO_LOGIN, DEMO_CODE, DEMO_PASSWORD, DEMO_TOTP_SECRET, inviteToken, passwordHash } from "../../seeds/auth.js";

const API = "/api/v1";
const MIN = 60_000;
const HOUR = 60 * MIN;
// a mesma janela de 5 minutos que toda rota sensível lê (Configurações, Google, Clientes)
const REAUTH_KEY = "territorio:mock-reauth";
const TOTP_ROLES = ["owner", "manager"];
const RANK = { floor: 0, manager: 1, owner: 2 };
// senhas que apareceram em vazamentos (a API real consulta o Have I Been Pwned por k-anonimato)
const LEAKED = new Set(["123456789012", "senha1234567", "senhasenha123", "territorio123", "territorio2026", "izakaya12345", "password1234", "qwertyuiop12", "abcdefghijkl", "aaaaaaaaaaaa", "111111111111", "iguacu123456"]);

// rotas que abrem uma sessão: não precisam de nenhuma
const OPEN = /^\/staff\/(auth\/(login|mfa|setup|accept-invite|forgot|reset|tokens\/[^/]+)|devices\/(pairing(\/[^/]+)?|session(\/challenge)?))$/;
// o que o aparelho da casa faz na tela de bloqueio, com ninguém dentro
const LOCK_SCREEN = /^\/staff\/(auth\/(session|logout)|devices\/staff|pin\/(login|logout))$/;

// ---- pequenas funções de apoio -------------------------------------------------------------

const json = (data, status = 200, headers) => HttpResponse.json(data, { status, headers });
const noContent = () => new HttpResponse(null, { status: 204 });
const enc = new TextEncoder();

function access(state) {
  const data = state.settings?.access?.data || {};
  return {
    sessionHours: data.session_hours ?? 12,
    rememberDays: data.remember_days ?? 30,
    pinAttempts: data.pin_max_attempts ?? 5,
    pinLockMin: data.pin_lock_min ?? 15,
    reauthMin: data.reauth_valid_min ?? 5,
  };
}

const randomText = (bytes = 18) => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlToBytes = (text) => Uint8Array.from(atob(String(text).replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(text).length / 4) * 4, "=")), (c) => c.charCodeAt(0));

async function sha256hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Decode(text) {
  const clean = String(text).toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const c of clean) bits += BASE32.indexOf(c).toString(2).padStart(5, "0");
  const out = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return out;
}
const newSecret = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => BASE32[b % 32]).join("");

/** RFC 6238: o código de 6 dígitos deste segredo, passos de 30 segundos, um passo de folga para cada lado. */
async function totpMatches(secret, code) {
  if (!secret || !/^\d{6}$/.test(String(code))) return false;
  const key = await crypto.subtle.importKey("raw", base32Decode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const step = Math.floor(Date.now() / 30_000);
  for (const counter of [step - 1, step, step + 1]) {
    const buffer = new ArrayBuffer(8);
    new DataView(buffer).setUint32(4, counter);
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, buffer));
    const offset = mac[19] & 0xf;
    const value = (((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3]) % 1_000_000;
    if (String(value).padStart(6, "0") === String(code)) return true;
  }
  return false;
}

/** O código fixo da demonstração vale para todos; o código de um autenticador real também vale. */
const codeOk = async (secret, code) => String(code) === DEMO_CODE || (await totpMatches(secret, code));

function deviceLabel() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Navegador";
  const system = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "computador";
  return `${browser} no ${system}`;
}

/** Os dados de entrada da pessoa; qualquer um da equipe com e-mail ganha os da demonstração no primeiro uso. */
function credentialsOf(state, user) {
  const auth = authOf(state);
  if (!auth.credentials[user.id] && user.email) {
    auth.credentials[user.id] = { pw: passwordHash(DEMO_PASSWORD), totp: user.mfa_enabled ? DEMO_TOTP_SECRET : null, pending_totp: null, recovery: [] };
  }
  return auth.credentials[user.id] || null;
}

function passwordProblem(password) {
  const value = String(password || "");
  if (value.length < 12) return "Use 12 caracteres ou mais. Uma frase curta é fácil de lembrar.";
  if (LEAKED.has(value.toLowerCase())) return "Essa senha aparece em vazamentos de outros sites. Escolha outra.";
  return null;
}

const invalid = (errors) => problem(422, "validation", "Falta ajeitar alguns campos", { errors });

function userView(user) {
  const { id, name, email, role, status, pin_only, pin_locked_until, mfa_enabled, last_login_at, invite_expires_at } = user;
  return { id, name, email: email || null, role, status, pin_only: Boolean(pin_only), pin_locked_until: pin_locked_until || null, mfa_enabled: Boolean(mfa_enabled), last_login_at: last_login_at || null, invite_expires_at: invite_expires_at || null };
}

function deviceView(device) {
  if (!device) return null;
  const { id, name, kind, location, role, status, idle_min, approved_at, last_seen_at } = device;
  return { id, name, kind, location, role, status, idle_min: idle_min ?? 15, approved_at, last_seen_at };
}

/** As áreas que um perfil abre: o dono sempre tem todas; os outros seguem o que o dono escolheu (1.15). */
function areasOf(state, role) {
  if (role === "owner") return AREAS.map((a) => a.key);
  const chosen = state.permissions?.[role];
  return Array.isArray(chosen) ? chosen : defaultAreas(role);
}

function audit(state, now, { actor, device, action, summary, entity_id = null, changes = {} }) {
  state.audit ??= [];
  state.audit.unshift({
    id: uuid(),
    occurred_at: now.toISOString(),
    actor_type: actor ? "user" : "system",
    actor_id: actor?.id ?? null,
    actor_label: actor?.name || actor?.email || "Sistema",
    device_label: device ? device.name : "Acesso pessoal",
    action,
    entity_type: "access",
    entity_id,
    summary,
    changes,
  });
}

// ---- sessões pessoais ----------------------------------------------------------------------

function openPersonal(state, now, user, remember) {
  const auth = authOf(state);
  const rules = access(state);
  const record = {
    id: uuid(),
    user_id: user.id,
    remember: Boolean(remember),
    created_at: now.toISOString(),
    last_seen_at: now.toISOString(),
    expires_at: new Date(now.getTime() + (remember ? rules.rememberDays * 24 * HOUR : rules.sessionHours * HOUR)).toISOString(),
    ended_at: null,
    csrf: uuid(),
    device: deviceLabel(),
    place: "Foz do Iguaçu, PR (aproximado)",
  };
  auth.sessions.push(record);
  // o cookie: até o navegador fechar, ou 30 dias com "manter conectado"
  if (remember) {
    local.set(PERSONAL_COOKIE, { id: record.id, max_age_days: rules.rememberDays });
    session.remove(PERSONAL_COOKIE);
  } else {
    session.set(PERSONAL_COOKIE, { id: record.id });
    local.remove(PERSONAL_COOKIE);
  }
  // entrar de verdade substitui o atalho ?papel=
  clearDemoRole();
  user.last_login_at = now.toISOString();
  return record;
}

function endSessionsOf(state, now, userId, { except } = {}) {
  let count = 0;
  for (const s of authOf(state).sessions) {
    if (s.user_id === userId && !s.ended_at && s.id !== except) {
      s.ended_at = now.toISOString();
      count++;
    }
  }
  return count;
}

const sessionAnswer = (state, kind, user, record, device = null) => ({
  kind,
  user: user ? userView(user) : null,
  device: deviceView(device),
  idle_expires_at: null,
  csrf_token: record?.csrf || "mock-csrf-equipe",
  house_ready: true,
  server_time: new Date().toISOString(),
});

// ---- links de uso único ----------------------------------------------------------------------

/** { kind, user, record, valid } para um link de primeiro acesso, convite ou nova senha. */
function readToken(state, now, value) {
  const auth = authOf(state);
  const record = auth.tokens.find((t) => t.token === value);
  if (record) {
    const user = state.users.find((u) => u.id === record.user_id);
    const valid = !record.used_at && !record.superseded_at && new Date(record.expires_at) > now && Boolean(user);
    return { kind: record.kind, user, record, valid };
  }
  // convites: o link acompanha o usuário e o vencimento dele, então reenviar deixa o antigo sem valor
  if (/^c[0-9a-f]{8}/.test(value)) {
    const user = state.users.find((u) => u.id.replace(/-/g, "").startsWith(value.slice(1, 9)));
    if (!user) return null;
    const valid = user.status === "invited" && inviteToken(user) === value && new Date(user.invite_expires_at) > now;
    return { kind: "invite", user, record: null, valid };
  }
  return null;
}

const goneProblem = (kind) =>
  problem(410, "gone", { owner_setup: "Esse link de primeiro acesso já foi usado", invite: "O convite venceu", reset: "O link de nova senha venceu" }[kind] || "Esse link venceu");

// ---- o aparelho da casa ----------------------------------------------------------------------

const nonces = new Map();
const publicKeys = new Map();

async function publicKeyOf(device) {
  if (!device.public_key) return null;
  const cached = publicKeys.get(device.id);
  if (cached?.jwk === device.public_key.x) return cached.key;
  const key = await crypto.subtle.importKey("jwk", device.public_key, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  publicKeys.set(device.id, { jwk: device.public_key.x, key });
  return key;
}

async function verify(device, signature, message) {
  try {
    const key = await publicKeyOf(device);
    return Boolean(key) && (await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, b64urlToBytes(signature), enc.encode(message)));
  } catch {
    return false;
  }
}

/** O relógio do aparelho contra o do servidor: mais de 5 minutos é recusado com a hora do servidor. */
function clockProblem(deviceTime) {
  const skew = Date.parse(deviceTime) - Date.now();
  if (Number.isFinite(skew) && Math.abs(skew) <= 5 * MIN) return null;
  return problem(401, "device_signature_invalid", "O relógio deste aparelho está errado", {
    reason: "clock",
    server_time: new Date().toISOString(),
    skew_s: Number.isFinite(skew) ? Math.round(skew / 1000) : null,
  });
}

/** Identidade, hora, nonce e assinatura de um pedido da sessão do aparelho (AD-26). */
async function checkSignature(request, url, device) {
  const header = (name) => request.headers.get(name);
  const [id, time, nonce, signature] = [header("X-Device-Id"), header("X-Device-Time"), header("X-Device-Nonce"), header("X-Device-Signature")];
  const refuse = (reason) => problem(401, "device_signature_invalid", "Este aparelho precisa se apresentar de novo", { reason, server_time: new Date().toISOString() });
  if (!id || !time || !nonce || !signature || id !== device.id) return refuse("missing");
  const clock = clockProblem(time);
  if (clock) return clock;
  const seen = Date.now();
  for (const [n, at] of nonces) if (seen - at > 10 * MIN) nonces.delete(n);
  if (nonces.has(nonce)) return refuse("nonce");
  nonces.set(nonce, seen);
  const multipart = (header("Content-Type") || "").includes("multipart");
  const body = ["GET", "HEAD"].includes(request.method) || multipart ? "" : await request.clone().text();
  const message = `${request.method}\n${url.pathname}${url.search}\n${time}\n${await sha256hex(body)}\n${nonce}`;
  return (await verify(device, signature, message)) ? null : refuse("signature");
}

/** Segundos de inatividade antes de o aparelho pedir o PIN de novo (a demonstração pode encurtar). */
function idleMs(device) {
  const demo = Number(session.get("territorio:demo-inatividade"));
  return demo > 0 ? demo * 1000 : (device.idle_min ?? 15) * MIN;
}

/** As pessoas que podem entrar neste aparelho: ativas, com telefone, do perfil dele ou acima (não o dono). */
function eligible(state, device) {
  return state.users.filter((u) => u.status === "active" && u.phone_e164 && u.role !== "owner" && RANK[u.role] >= RANK[device.role || "floor"]);
}

// ---- as rotas --------------------------------------------------------------------------------

/** O middleware do servidor para toda rota da equipe. */
const guard = http.all(`${API}/staff/*`, async ({ request }) => {
  const url = new URL(request.url);
  const path = url.pathname.slice(API.length);
  if (OPEN.test(path)) return undefined;
  const now = mockNow();
  const current = currentSession(now);
  if (!current) {
    return personalCookie() ? problem(401, "session_expired", "Você saiu do painel", { detail: "Entre de novo para continuar." }) : problem(401, "unauthorized", "Entre para continuar");
  }
  if (current.kind === "device") {
    const { device, record } = current;
    if (device.status !== "approved") return problem(403, "device_not_approved", "Este aparelho não está liberado");
    const refused = await checkSignature(request, url, device);
    if (refused) return refused;
    device.last_seen_at = now.toISOString();
    if (current.user && Date.now() - Date.parse(record.last_active_at || 0) > idleMs(device)) {
      record.person_id = null; // a pessoa saiu por inatividade; o aparelho fica
      current.user = null;
    }
    if (!current.user && !LOCK_SCREEN.test(path)) {
      save();
      saveDeviceRecord(record);
      return problem(403, "no_active_person", "Quem está usando?", { detail: "Toque no seu nome e digite o PIN para continuar." });
    }
    if (current.user) record.last_active_at = new Date().toISOString();
    saveDeviceRecord(record);
    save();
  } else if (current.kind === "personal" && now - Date.parse(current.record.last_seen_at) > MIN) {
    current.record.last_seen_at = now.toISOString();
    save();
  }
  if (!["GET", "HEAD"].includes(request.method)) {
    const expected = current.record?.csrf || "mock-csrf-equipe";
    if (request.headers.get("X-CSRF-Token") !== expected) return problem(403, "csrf_failed", "Precisamos recarregar a página");
  }
  return undefined;
});

export const authHandlers = [
  guard,

  // ---- a pessoa ----
  http.get(`${API}/staff/me`, () =>
    respond(() => {
      const current = currentSession();
      if (!current?.user) return problem(401, "unauthorized", "Entre para continuar");
      const state = getState(mockNow());
      const { user, role, kind, device } = current;
      return json({
        ...user,
        role,
        areas: areasOf(state, role),
        session_kind: kind,
        device: deviceView(device),
        // dono e gerente sempre passam pelas duas etapas; uma sessão pessoal sem elas configura primeiro
        mfa_required: kind === "personal" && TOTP_ROLES.includes(role) && !user.mfa_enabled,
        // depois do primeiro acesso do dono, o painel abre o
        // assistente até ele ser terminado ou deixado de lado (história 3.12)
        onboarding_pending: role === "owner" && Boolean(state.onboarding?.after_setup && !state.onboarding.dismissed),
      });
    }),
  ),

  http.get(`${API}/staff/auth/session`, () =>
    respond(() => {
      const current = currentSession();
      if (!current) return problem(401, "unauthorized", "Entre para continuar");
      const state = getState(mockNow());
      return json(sessionAnswer(state, current.kind, current.user, current.record, current.device));
    }),
  ),

  // ---- e-mail, senha e a segunda etapa ----
  http.post(`${API}/staff/auth/login`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    return respond(() => {
      if (!body.turnstile_token) return problem(400, "turnstile_failed", "Precisamos conferir de novo");
      const now = mockNow();
      const state = getState(now);
      const auth = authOf(state);
      // a entrada curta da demonstração: "admin" é o dono, com a senha da demonstração, direto, sem
      // o código (N4). Existe só nesta simulação e precisa sair antes da produção, junto com
      // a dica na tela de entrada; o servidor real nunca tem isso
      const demoLogin = String(body.email || "").trim().toLowerCase() === DEMO_LOGIN;
      const owner = demoLogin ? state.users.find((u) => u.role === "owner" && u.status === "active") : null;
      const email = owner ? owner.email.toLowerCase() : String(body.email || "").trim().toLowerCase();
      const recent = (auth.failures[email] || []).filter((at) => now - Date.parse(at) < 15 * MIN);
      if (recent.length >= 5) {
        const wait = Math.ceil((Date.parse(recent[0]) + 15 * MIN - now) / 1000);
        return problem(429, "rate_limited", "Entrada pausada por segurança", {}, { "Retry-After": String(Math.max(wait, 60)) });
      }
      const user = state.users.find((u) => (u.email || "").toLowerCase() === email && u.status !== "invited");
      const cred = user && credentialsOf(state, user);
      // sempre a mesma frase, seja qual for o dos dois que está errado (FR-70)
      if (!user || !cred || cred.pw !== passwordHash(body.password)) {
        auth.failures[email] = [...recent, now.toISOString()];
        if (auth.failures[email].length === 5 && user) audit(state, now, { actor: user, action: "auth.login_paused", summary: `Entrada de ${user.name || user.email} pausada depois de 5 senhas erradas` });
        save();
        return problem(401, "unauthorized", "E-mail ou senha não conferem");
      }
      delete auth.failures[email];
      if (user.status === "disabled") {
        audit(state, now, { actor: user, action: "auth.login_disabled", summary: `${user.name} tentou entrar com a conta desativada` });
        save();
        return problem(403, "account_disabled", "Essa conta está desativada");
      }
      if (user.role === "floor") return problem(403, "forbidden", "A recepção entra pelo aparelho da casa", { detail: "Toque no seu nome no aparelho da recepção ou do salão e digite o PIN." });
      if (user.mfa_enabled && cred.totp && !demoLogin) {
        const id = uuid();
        auth.challenges[id] = { user_id: user.id, remember: Boolean(body.remember), expires_at: new Date(now.getTime() + 5 * MIN).toISOString(), tries: 0 };
        save();
        return json({ mfa_required: true, challenge_id: id }, 202);
      }
      const record = openPersonal(state, now, user, body.remember);
      audit(state, now, { actor: user, action: "auth.login", summary: `${user.name} entrou (falta ligar a verificação em duas etapas)` });
      save();
      return json(sessionAnswer(state, "personal", user, record));
    });
  }),

  http.post(`${API}/staff/auth/mfa`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    return respond(async () => {
      const now = mockNow();
      const state = getState(now);
      const auth = authOf(state);
      const challenge = auth.challenges[body.challenge_id];
      if (!challenge || new Date(challenge.expires_at) < now || challenge.tries >= 5) {
        return problem(401, "session_expired", "Entre de novo", { detail: "O tempo para digitar o código passou. Digite e-mail e senha de novo." });
      }
      const user = state.users.find((u) => u.id === challenge.user_id);
      const cred = user && credentialsOf(state, user);
      let ok = false;
      let usedRecovery = false;
      if (body.recovery_code) {
        const hash = passwordHash(String(body.recovery_code).toUpperCase().replace(/[^A-Z0-9]/g, ""));
        const code = cred?.recovery.find((r) => r.h === hash && !r.used_at);
        if (code) {
          code.used_at = now.toISOString(); // vale uma vez
          ok = usedRecovery = true;
        }
      } else {
        ok = Boolean(cred) && (await codeOk(cred.totp, body.code));
      }
      if (!ok) {
        challenge.tries++;
        save();
        return problem(401, "unauthorized", "Código não confere");
      }
      delete auth.challenges[body.challenge_id];
      const record = openPersonal(state, now, user, challenge.remember);
      audit(state, now, {
        actor: user,
        action: "auth.login",
        summary: usedRecovery ? `${user.name} entrou com um código de recuperação (sobram ${cred.recovery.filter((r) => !r.used_at).length})` : `${user.name} entrou`,
      });
      save();
      return json(sessionAnswer(state, "personal", user, record));
    });
  }),

  http.post(`${API}/staff/auth/logout`, () =>
    respond(() => {
      const now = mockNow();
      const current = currentSession(now);
      if (current?.kind === "personal") current.record.ended_at = now.toISOString();
      if (current?.kind === "device") saveDeviceRecord({ ...current.record, person_id: null });
      clearDemoRole();
      session.remove(PERSONAL_COOKIE);
      local.remove(PERSONAL_COOKIE);
      session.remove(REAUTH_KEY);
      save();
      return noContent();
    }),
  ),

  // a checagem de identidade antes de uma ação sensível: senha E código (história 1.7)
  http.post(`${API}/staff/auth/reauth`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    return respond(async () => {
      const now = mockNow();
      const current = currentSession(now);
      if (!current?.user) return problem(401, "unauthorized", "Entre para continuar");
      const state = getState(now);
      const cred = credentialsOf(state, current.user);
      const passwordOk = Boolean(cred) && cred.pw === passwordHash(body.password);
      const codeIsOk = Boolean(cred) && (await codeOk(cred.totp || DEMO_TOTP_SECRET, body.code));
      if (!passwordOk || !codeIsOk) {
        return problem(401, "unauthorized", "Senha ou código não conferem", {
          errors: [!passwordOk && { field: "password", message: "A senha não confere." }, !codeIsOk && { field: "code", message: "O código não confere. Use o que está agora no aplicativo." }].filter(Boolean),
        });
      }
      session.set(REAUTH_KEY, Date.now());
      return noContent();
    });
  }),

  // ---- links ----
  http.get(`${API}/staff/auth/tokens/:token`, ({ params }) =>
    respond(() => {
      const now = mockNow();
      const state = getState(now);
      const found = readToken(state, now, String(params.token));
      if (!found) return problem(404, "not_found", "Esse link não abriu");
      if (!found.valid && found.kind === "owner_setup") {
        // abrir um link de primeiro acesso usado ou vencido vai para o registro (FR-70)
        audit(state, now, { actor: null, action: "auth.setup_link_reused", summary: "Alguém abriu um link de primeiro acesso já usado ou vencido" });
        save();
      }
      const invitedBy = state.users.find((u) => u.role === "owner" && u.status === "active");
      return json({
        kind: found.kind,
        email: found.user?.email || null,
        role: found.user?.role || null,
        name: found.user?.name || "",
        invited_by: found.kind === "invite" ? invitedBy?.name || null : null,
        expires_at: found.record?.expires_at || found.user?.invite_expires_at || null,
        recovery: Boolean(found.record?.recovery),
        valid: found.valid,
      });
    }),
  ),

  http.post(`${API}/staff/auth/setup`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    return respond(() => {
      const now = mockNow();
      const state = getState(now);
      const found = readToken(state, now, String(body.token || ""));
      if (!found || found.kind !== "owner_setup") return problem(404, "not_found", "Esse link não abriu");
      if (!found.valid) return goneProblem("owner_setup");
      const errors = [];
      const name = String(body.name || found.user.name || "").trim();
      if (name.length < 2) errors.push({ field: "name", message: "Escreva o seu nome." });
      const weak = passwordProblem(body.password);
      if (weak) errors.push({ field: "password", message: weak });
      if (errors.length) return invalid(errors);
      const user = found.user;
      const auth = authOf(state);
      user.name = name.slice(0, 60);
      // a senha e um autenticador novo: o antigo e seus códigos de recuperação param de funcionar
      auth.credentials[user.id] = { pw: passwordHash(body.password), totp: null, pending_totp: null, recovery: [] };
      user.mfa_enabled = false;
      found.record.used_at = now.toISOString();
      const ended = found.record.recovery ? endSessionsOf(state, now, user.id) : 0;
      // o primeiro acesso (não a recuperação) leva ao assistente nas próximas entradas (3.12)
      if (!found.record.recovery && state.onboarding) state.onboarding.after_setup = true;
      const record = openPersonal(state, now, user, false);
      audit(state, now, {
        actor: user,
        action: found.record.recovery ? "auth.setup_recovery" : "auth.setup",
        summary: found.record.recovery
          ? `${user.name} refez a senha e a verificação em duas etapas pelo link de recuperação; ${ended} ${ended === 1 ? "sessão encerrada" : "sessões encerradas"}`
          : `${user.name} fez o primeiro acesso`,
        changes: { password: { secret: true }, totp_secret: { secret: true } },
      });
      save();
      return json(sessionAnswer(state, "personal", user, record), 201);
    });
  }),

  http.post(`${API}/staff/auth/accept-invite`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    return respond(() => {
      const now = mockNow();
      const state = getState(now);
      const found = readToken(state, now, String(body.token || ""));
      if (!found || found.kind !== "invite") return problem(404, "not_found", "Esse link não abriu");
      if (!found.valid) return goneProblem("invite");
      const errors = [];
      const name = String(body.name || "").trim();
      if (name.length < 2 || name.length > 60) errors.push({ field: "name", message: "Escreva o seu nome, de 2 a 60 letras." });
      const weak = passwordProblem(body.password);
      if (weak) errors.push({ field: "password", message: weak });
      if (errors.length) return invalid(errors);
      const user = found.user;
      Object.assign(user, { name, status: "active", invite_expires_at: null, mfa_enabled: false });
      authOf(state).credentials[user.id] = { pw: passwordHash(body.password), totp: null, pending_totp: null, recovery: [] };
      const record = openPersonal(state, now, user, false);
      audit(state, now, { actor: user, action: "user.invite_accept", entity_id: user.id, summary: `${name} aceitou o convite`, changes: { password: { secret: true } } });
      save();
      return json(sessionAnswer(state, "personal", user, record), 201);
    });
  }),

  http.post(`${API}/staff/auth/forgot`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    return respond(() => {
      const now = mockNow();
      const state = getState(now);
      const auth = authOf(state);
      const email = String(body.email || "").trim().toLowerCase();
      const user = state.users.find((u) => (u.email || "").toLowerCase() === email && u.status === "active");
      if (user) {
        // um link mais novo faz os anteriores pararem de funcionar
        for (const t of auth.tokens) if (t.kind === "reset" && t.user_id === user.id && !t.used_at) t.superseded_at = now.toISOString();
        const token = `n${randomText(24)}`;
        auth.tokens.push({ token, kind: "reset", user_id: user.id, created_at: now.toISOString(), expires_at: new Date(now.getTime() + 30 * MIN).toISOString(), used_at: null });
        auth.outbox.unshift({ to: user.email, kind: "reset", path: `/admin/entrar/nova-senha/${token}`, at: now.toISOString() });
        auth.outbox = auth.outbox.slice(0, 10);
        save();
      }
      // a mesma resposta seja o e-mail da equipe ou não
      return new HttpResponse(null, { status: 202 });
    });
  }),

  http.post(`${API}/staff/auth/reset`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    return respond(() => {
      const now = mockNow();
      const state = getState(now);
      const found = readToken(state, now, String(body.token || ""));
      if (!found || found.kind !== "reset") return problem(404, "not_found", "Esse link não abriu");
      if (!found.valid) return goneProblem("reset");
      const weak = passwordProblem(body.password);
      if (weak) return invalid([{ field: "password", message: weak }]);
      const user = found.user;
      credentialsOf(state, user);
      authOf(state).credentials[user.id].pw = passwordHash(body.password);
      found.record.used_at = now.toISOString();
      const ended = endSessionsOf(state, now, user.id);
      audit(state, now, { actor: user, action: "auth.password_reset", summary: `${user.name} trocou a senha pelo link; ${ended} ${ended === 1 ? "sessão encerrada" : "sessões encerradas"}`, changes: { password: { secret: true } } });
      save();
      return noContent();
    });
  }),

  // ---- o autenticador ----
  http.post(`${API}/staff/me/mfa`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    return respond(async () => {
      const now = mockNow();
      const current = currentSession(now);
      if (current?.kind !== "personal" && current?.kind !== "demo") return problem(403, "forbidden", "Essa parte é de outro perfil da equipe");
      const state = getState(now);
      const user = current.user;
      const cred = credentialsOf(state, user);
      if (!body.code) {
        cred.pending_totp = newSecret();
        save();
        const label = encodeURIComponent(`Territorio:${user.email || user.name}`);
        return json({ otpauth_url: `otpauth://totp/${label}?secret=${cred.pending_totp}&issuer=Territorio&digits=6&period=30`, secret: cred.pending_totp, enabled: false });
      }
      if (!cred.pending_totp || !(await codeOk(cred.pending_totp, body.code))) {
        return invalid([{ field: "code", message: "Código não confere. Use o código que está agora no aplicativo." }]);
      }
      const codes = Array.from({ length: 10 }, () => {
        const raw = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");
        return `${raw.slice(0, 4)}-${raw.slice(4)}`;
      });
      cred.totp = cred.pending_totp;
      cred.pending_totp = null;
      cred.recovery = codes.map((c) => ({ h: passwordHash(c.replace(/-/g, "")), used_at: null }));
      user.mfa_enabled = true;
      audit(state, now, { actor: user, action: "auth.mfa_enabled", summary: `${user.name} ligou a verificação em duas etapas`, changes: { totp_secret: { secret: true }, recovery_codes: { secret: true } } });
      save();
      return json({ enabled: true, recovery_codes: codes });
    });
  }),

  // ---- minhas sessões ----
  http.get(`${API}/staff/me/sessions`, () =>
    respond((scenario) => {
      const now = mockNow();
      const current = currentSession(now);
      if (!current?.user || current.kind === "device") return problem(403, "forbidden", "Essa parte é do acesso pessoal");
      const state = getState(now);
      const list = authOf(state)
        .sessions.filter((s) => s.user_id === current.user.id && !s.ended_at && new Date(s.expires_at) > now)
        .filter((s) => scenario !== "vazio" || s.id === current.record?.id)
        .map((s) => ({ id: s.id, device: s.device, place: s.place, created_at: s.created_at, last_seen_at: s.last_seen_at, current: s.id === current.record?.id, remember: s.remember }));
      // o atalho ?papel= também é uma sessão
      if (current.kind === "demo") list.unshift({ id: "demonstracao", device: deviceLabel(), place: "Foz do Iguaçu, PR (aproximado)", created_at: now.toISOString(), last_seen_at: now.toISOString(), current: true, remember: false });
      return json(list.sort((a, b) => Number(b.current) - Number(a.current) || b.last_seen_at.localeCompare(a.last_seen_at)));
    }),
  ),

  http.delete(`${API}/staff/me/sessions/:id`, ({ params }) =>
    respond(() => {
      const now = mockNow();
      const current = currentSession(now);
      const state = getState(now);
      if (params.id === "demonstracao" && current?.kind === "demo") {
        clearDemoRole();
        return noContent();
      }
      const record = authOf(state).sessions.find((s) => s.id === params.id && s.user_id === current?.user?.id);
      if (!record) return problem(404, "not_found", "Essa sessão já foi encerrada");
      record.ended_at = now.toISOString();
      audit(state, now, { actor: current.user, action: "auth.session_end", summary: `${current.user.name} encerrou a sessão de ${record.device}` });
      save();
      return noContent();
    }),
  ),

  // o assistente deixado de lado ou terminado (história 3.12): o painel para de abri-lo na entrada. A
  // rota de Configurações responde o resto de PUT /staff/onboarding.
  http.put(`${API}/staff/onboarding`, async ({ request }) => {
    const body = await request.clone().json().catch(() => ({}));
    const now = mockNow();
    const current = currentSession(now);
    if (current?.role !== "owner" || typeof body.after_setup !== "boolean") return undefined;
    const state = getState(now);
    if (state.onboarding) state.onboarding.after_setup = body.after_setup;
    save();
    return undefined;
  }),

  // o dono encerra as sessões de alguém da equipe (a rota de Equipe responde e registra)
  http.post(`${API}/staff/users/:id/revoke-sessions`, ({ params }) => {
    const now = mockNow();
    const current = currentSession(now);
    if (current?.role !== "owner" || !current.user) return undefined;
    const state = getState(now);
    endSessionsOf(state, now, String(params.id));
    const device = local.get(DEVICE_COOKIE);
    if (device?.person_id === params.id) saveDeviceRecord({ ...device, person_id: null });
    save();
    return undefined;
  }),

  // ---- o aparelho da casa: pareamento ----
  http.post(`${API}/staff/devices/pairing`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    return respond(() => {
      const now = mockNow();
      const state = getState(now);
      const key = body?.public_key;
      if (!key || key.kty !== "EC" || key.crv !== "P-256" || !key.x || !key.y) {
        return invalid([{ field: "public_key", message: "Falta a chave do aparelho." }]);
      }
      const CODE = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      const code = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => CODE[b % 32]).join("");
      const id = uuid();
      const expires = new Date(now.getTime() + 10 * MIN).toISOString();
      state.devices ??= [];
      state.devices.push({
        id,
        name: String(body.label || "Aparelho novo").slice(0, 60),
        kind: /Android|iPad|Tablet/i.test(body.user_agent || "") ? "tablet" : /iPhone/.test(body.user_agent || "") ? "phone" : "desktop",
        location: "",
        role: "floor",
        status: "pending",
        approved_by: null,
        approved_at: null,
        last_seen_at: null,
        revoked_at: null,
        version: "1",
        public_key: { kty: key.kty, crv: key.crv, x: key.x, y: key.y },
        replaces: null,
      });
      state.device_pairings = { ...(state.device_pairings || {}), [id]: { code, expires_at: expires } };
      // um aparelho que perdeu a chave pede de novo: o dono é avisado, e o antigo é oferecido para revogar
      const old = body.replaces && state.devices.find((d) => d.id === body.replaces && d.status === "approved");
      if (old) {
        // o Hoje avisa o dono (um alerta enquanto o antigo ainda está aprovado)
        old.key_lost = true;
        old.key_lost_at = now.toISOString();
        state.devices.at(-1).replaces = old.id;
        state.devices.at(-1).name = old.name;
        audit(state, now, { actor: null, device: old, action: "device.key_lost", entity_id: old.id, summary: `${old.name} perdeu a chave da casa e pediu o pareamento de novo` });
      }
      save();
      return json({ id, code, status: "pending", expires_at: expires, poll_after_s: 3, server_time: new Date().toISOString() }, 201);
    });
  }),

  http.get(`${API}/staff/devices/pairing/:id`, ({ params }) =>
    respond(() => {
      const now = mockNow();
      const state = getState(now);
      const device = (state.devices || []).find((d) => d.id === params.id);
      if (!device) return problem(404, "not_found", "Pedido não encontrado");
      const pairing = state.device_pairings?.[device.id];
      const expired = device.status === "pending" && (!pairing || new Date(pairing.expires_at) < now);
      return json({ id: device.id, status: expired ? "expired" : device.status, expires_at: pairing?.expires_at ?? null, poll_after_s: 3, server_time: new Date().toISOString() });
    }),
  ),

  // ---- o aparelho da casa: a própria sessão ----
  http.post(`${API}/staff/devices/session/challenge`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    return respond(() => {
      const now = mockNow();
      const state = getState(now);
      const device = (state.devices || []).find((d) => d.id === body?.device_id);
      if (!device || device.status !== "approved") return problem(403, "device_not_approved", "Este aparelho não está liberado");
      const id = uuid();
      const challenge = randomText(24);
      authOf(state).challenges[id] = { device_id: device.id, challenge, expires_at: new Date(Date.now() + MIN).toISOString() };
      save();
      return json({ challenge_id: id, challenge, expires_at: new Date(Date.now() + MIN).toISOString(), server_time: new Date().toISOString() });
    });
  }),

  http.post(`${API}/staff/devices/session`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    return respond(async () => {
      const now = mockNow();
      const state = getState(now);
      const auth = authOf(state);
      const device = (state.devices || []).find((d) => d.id === body?.device_id);
      if (!device || device.status !== "approved") return problem(403, "device_not_approved", "Este aparelho não está liberado");
      const challenge = auth.challenges[body.challenge_id];
      delete auth.challenges[body.challenge_id]; // vale uma vez
      if (body.device_time) {
        const clock = clockProblem(body.device_time);
        if (clock) return clock;
      }
      if (!challenge || challenge.device_id !== device.id || Date.parse(challenge.expires_at) < Date.now() || !(await verify(device, body.signature, challenge.challenge))) {
        save();
        return problem(401, "device_signature_invalid", "Este aparelho precisa se apresentar de novo", { reason: "signature", server_time: new Date().toISOString() });
      }
      // o cookie da sessão do aparelho (12 meses) leva o registro dele
      const record = { id: uuid(), device_id: device.id, person_id: null, person_role: null, last_active_at: null, opened_at: now.toISOString(), csrf: uuid(), ended_at: null, max_age_days: 365 };
      saveDeviceRecord(record);
      device.last_seen_at = now.toISOString();
      save();
      return json(sessionAnswer(state, "device", null, record, device), 201);
    });
  }),

  http.get(`${API}/staff/devices/staff`, () =>
    respond((scenario) => {
      const now = mockNow();
      const current = currentSession(now);
      if (current?.kind !== "device") return problem(403, "device_not_approved", "Este aparelho não está liberado");
      const state = getState(now);
      const people = scenario === "vazio" ? [] : eligible(state, current.device);
      return json(
        people
          .map((u) => ({ user_id: u.id, name: u.name, role: u.role, locked_until: u.pin_locked_until && new Date(u.pin_locked_until) > now ? u.pin_locked_until : null }))
          .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
      );
    }),
  ),

  // ---- o aparelho da casa: o PIN ----
  http.post(`${API}/staff/pin/login`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    return respond(() => {
      const now = mockNow();
      const current = currentSession(now);
      if (current?.kind !== "device") return problem(403, "device_not_approved", "Este aparelho não está liberado");
      const state = getState(now);
      const rules = access(state);
      const { device, record } = current;
      const person = eligible(state, device).find((u) => u.id === body.user_id);
      if (!person) return problem(404, "not_found", "Essa pessoa não entra neste aparelho");
      if (person.pin_locked_until && new Date(person.pin_locked_until) > now) {
        const wait = Math.ceil((Date.parse(person.pin_locked_until) - now) / 1000);
        return problem(423, "pin_locked", `${person.name} está travado`, { locked_until: person.pin_locked_until }, { "Retry-After": String(wait) });
      }
      if (String(body.pin || "") !== String(person.phone_e164).replace(/\D/g, "").slice(-4)) {
        person.pin_failures = (person.pin_failures || 0) + 1;
        if (person.pin_failures >= rules.pinAttempts) {
          person.pin_failures = 0;
          person.pin_locked_until = new Date(now.getTime() + rules.pinLockMin * MIN).toISOString();
          // o Hoje avisa o dono com a pessoa, o aparelho e a hora
          state.pin_locks ??= [];
          state.pin_locks.push({ id: uuid(), user_id: person.id, user_name: person.name, device_name: device.name, locked_at: now.toISOString(), until: person.pin_locked_until, attempts: rules.pinAttempts });
          audit(state, now, { actor: person, device, action: "auth.pin_locked", entity_id: person.id, summary: `${person.name} ficou travado por ${rules.pinLockMin} min depois de ${rules.pinAttempts} PINs errados` });
          save();
          return problem(423, "pin_locked", `${person.name} está travado`, { locked_until: person.pin_locked_until }, { "Retry-After": String(rules.pinLockMin * 60) });
        }
        save();
        return problem(401, "pin_invalid", "PIN não confere", { remaining_attempts: rules.pinAttempts - person.pin_failures });
      }
      person.pin_failures = 0;
      person.pin_locked_until = null;
      person.last_login_at = now.toISOString();
      Object.assign(record, { person_id: person.id, person_role: person.role, last_active_at: new Date().toISOString() });
      saveDeviceRecord(record);
      audit(state, now, { actor: person, device, action: "auth.pin_login", entity_id: person.id, summary: `${person.name} entrou pelo PIN no ${device.name}` });
      save();
      const answer = sessionAnswer(state, "device", person, record, device);
      answer.idle_expires_at = new Date(Date.now() + idleMs(device)).toISOString();
      return json(answer);
    });
  }),

  http.post(`${API}/staff/pin/logout`, () =>
    respond(() => {
      const now = mockNow();
      const current = currentSession(now);
      if (current?.kind === "device") {
        saveDeviceRecord({ ...current.record, person_id: null });
      }
      return noContent();
    }),
  ),
];
