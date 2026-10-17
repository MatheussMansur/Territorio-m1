import { del, get, patch, post, setCsrfToken } from "./client.js";

const BASE = import.meta.env?.VITE_API_BASE || "/api/v1";

// Acesso do cliente: um código de 6 dígitos por WhatsApp abre a sessão (FR-20, FR-26). O código
// só vai depois da checagem anti-robô (turnstile_token) e para +55, +595 ou +54.
export const sendOtp = (phone, { turnstileToken, website = "" } = {}) => post("/auth/otp", { phone, website, turnstile_token: turnstileToken });

export async function verifyOtp({ phone, code, name, rememberDevice, locale }) {
  const session = await post("/auth/verify", { phone, code, name, remember_device: rememberDevice, locale });
  setCsrfToken(session?.csrf_token);
  return session;
}

export const logout = () => post("/auth/logout");
/** O cliente e o token CSRF da sessão; uma página que muda dados chama isto primeiro. */
export async function me(options) {
  const data = await get("/me", options);
  setCsrfToken(data?.csrf_token);
  return data;
}
/** Nome, e-mail, língua das mensagens e novidades (um consentimento à parte). */
export const updateMe = (fields) => patch("/me", fields);
export const myData = () => get("/me/data");
/** Pede à casa para apagar os dados: reservas futuras são canceladas, o pedido tem 15 dias. */
export const forgetMe = () => del("/me");
/** O número novo passa a valer depois do código dele (mandado antes com sendOtp). */
export const changePhone = ({ phone, code }) => post("/me/phone", { phone, code });

/**
 * "Entrar com o Google" é uma navegação de página, não um fetch: o servidor responde 302 para o Google
 * e volta para return_to (nenhum script do Google no site, AD-30).
 */
export const googleStartUrl = (returnTo) => `${BASE}/auth/google/start?return_to=${encodeURIComponent(returnTo)}`;

/** Só na demonstração: o retorno de exemplo do Google na simulação ({location} em vez de um 302). */
export const googleSampleReturn = ({ choice, returnTo }) => get("/auth/google/callback", { query: { code: choice, state: "demo", return_to: returnTo } });
