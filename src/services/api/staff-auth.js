// A entrada da equipe (Épico 1): e-mail, senha e o código do aplicativo autenticador, os
// links de uso único (primeiro acesso, convite, nova senha), a checagem de identidade, minhas sessões, e o
// aparelho da casa: pareamento, a sessão assinada dele e o PIN da pessoa que está usando.
import { del, get, post, setCsrfToken } from "./client.js";

/** Toda resposta que abre ou muda uma sessão traz o token CSRF para as próximas escritas. */
async function opening(promise) {
  const session = await promise;
  if (session?.csrf_token) setCsrfToken(session.csrf_token);
  return session;
}

/** 200 StaffSession, ou 202 { mfa_required, challenge_id } quando o código vem em seguida. */
export const login = ({ email, password, remember, turnstileToken }) =>
  opening(post("/staff/auth/login", { email, password, remember: Boolean(remember), turnstile_token: turnstileToken || undefined }));

/** A segunda etapa: o código de 6 dígitos, ou um código de recuperação (vale uma vez). */
export const mfa = ({ challengeId, code, recoveryCode }) =>
  opening(post("/staff/auth/mfa", recoveryCode ? { challenge_id: challengeId, recovery_code: recoveryCode } : { challenge_id: challengeId, code }));

/** O que um link é (owner_setup, invite, reset) e se ainda funciona. */
export const token = (value) => get(`/staff/auth/tokens/${encodeURIComponent(value)}`);

/** A sessão deste navegador: pessoa, aparelho e token CSRF. */
export const session = (options) => opening(get("/staff/auth/session", options));

export async function logout() {
  await post("/staff/auth/logout");
  setCsrfToken(null);
}

/** Primeiro acesso do dono (também o link de recuperação): senha, depois o autenticador. */
export const setup = ({ token: value, name, email, password }) => opening(post("/staff/auth/setup", { token: value, name, email, password }));

export const acceptInvite = ({ token: value, name, password }) => opening(post("/staff/auth/accept-invite", { token: value, name, password }));

/** Sempre a mesma resposta, seja o e-mail da equipe ou não. */
export const forgot = (email) => post("/staff/auth/forgot", { email });

export const reset = ({ token: value, password }) => post("/staff/auth/reset", { token: value, password });

/** A checagem de identidade antes de uma ação sensível: senha e código, vale 5 minutos. */
export const reauth = ({ password, code }) => post("/staff/auth/reauth", { password, code });

/** Ligar o autenticador: primeiro o endereço otpauth, depois o primeiro código. */
export const startMfa = () => post("/staff/me/mfa", {});
export const confirmMfa = (code) => post("/staff/me/mfa", { code });

export const sessions = (options) => get("/staff/me/sessions", options);
export const endSession = (id) => del(`/staff/me/sessions/${encodeURIComponent(id)}`);

// ---- o aparelho da casa ----

export const devices = {
  /** O aparelho pede pareamento com sua chave pública; a resposta tem o código de 8 caracteres. */
  pair: (body) => post("/staff/devices/pairing", body),
  pairing: (id, options) => get(`/staff/devices/pairing/${encodeURIComponent(id)}`, options),
  challenge: (deviceId) => post("/staff/devices/session/challenge", { device_id: deviceId }),
  open: (body) => opening(post("/staff/devices/session", body)),
  /** Os nomes na tela de bloqueio. */
  people: (options) => get("/staff/devices/staff", options),
};

export const pinLogin = ({ userId, pin }) => opening(post("/staff/pin/login", { user_id: userId, pin }));
export const pinLogout = () => post("/staff/pin/logout");
