// O único lugar do front que conhece URLs. As telas chamam os módulos de recurso
// (reservations.create(), house.get() …); este arquivo transforma toda falha num ApiError
// com uma mensagem do catálogo da casa (src/lib/errors.js) que a tela pode mostrar como está.
// Dois ganchos são do painel da equipe: o aparelho da casa assina seus pedidos (signer), e uma
// sessão que termina no meio é recuperada por cima da tela (recovery) antes de a chamada ser repetida.
// As poucas chamadas que leem algo que não é JSON (um arquivo, o fluxo ao vivo, uma leitura
// condicional) usam send(), que mantém o mesmo CSRF, a assinatura do aparelho e o tempo limite.
//
// Adaptadores (história 4.1, AR-12): `http` (a API, ou a simulação interceptando a rede) e
// `static` (VITE_API_MODE=static, o site montado com --mode site: sem API, veja static.js).
// As telas leem `capabilities`, nunca o modo. Com a simulação ligada, as operações de ROTAS_REAIS
// vão para o servidor real (rotas-reais.js).
import { CATALOG, errorMessage } from "../../lib/errors.js";
import { t } from "../../lib/strings.js";
import { isRealRoute } from "./rotas-reais.js";
import { CAPABILITIES, staticReply } from "./static.js";

const BASE = import.meta.env?.VITE_API_BASE || "/api/v1";
const MODE = import.meta.env?.VITE_API_MODE || "http";
const TIMEOUT_MS = 15_000;

/** O que este build do site pode fazer: reserva, conta, dados ao vivo, painel (modo estático: nada). */
export const capabilities = MODE === "static" ? CAPABILITIES.static : CAPABILITIES.api;
// Pedidos feitos antes de haver sessão (login, código por WhatsApp, links, pareamento do aparelho, a
// escolha de cookies e os tempos de página) não levam token CSRF.
const NO_SESSION =
  /^\/(auth\/(otp|verify)|staff\/auth\/(login|mfa|setup|accept-invite|forgot|reset|tokens)|staff\/devices\/(pairing|session)|links\/|consents$|vitals$)/;

// As respostas destas rotas fazem parte da entrada: um 401 ali é a resposta, não uma sessão perdida.
const SIGNING_IN = /^\/(auth\/|staff\/auth\/|staff\/pin\/|staff\/devices\/(pairing|session))/;

let csrfToken = null;
/** @type {null | ((request: {method: string, path: string, body: string}) => Promise<Record<string, string>|null>)} */
let signer = null;
/** @type {null | ((error: ApiError, path: string) => Promise<boolean>)} */
let recovery = null;

/** O aparelho da casa assina todo pedido da sua sessão (AD-26); null para de assinar. */
export const setSigner = (fn) => {
  signer = typeof fn === "function" ? fn : null;
};

/**
 * Chamado quando uma sessão termina no meio (401, ou 403 no_active_person / device_not_approved) numa
 * rota que não faz parte da entrada. Resolver true repete a chamada uma vez, para o que a pessoa
 * digitou ser mandado depois que ela entrar de novo.
 */
export const setRecovery = (fn) => {
  recovery = typeof fn === "function" ? fn : null;
};

/** Definido pelo login, pelo código por WhatsApp ou pela checagem da sessão; mandado em todo pedido que muda dados. */
export const setCsrfToken = (token) => {
  csrfToken = token || null;
};

export class ApiError extends Error {
  constructor({ status = 0, type = "unknown", title, detail, errors, requestId, retryAfter, body } = {}) {
    super(title || type);
    this.name = "ApiError";
    this.status = status;
    this.type = type;
    this.title = title;
    this.detail = detail;
    this.errors = errors || [];
    this.requestId = requestId;
    this.retryAfter = retryAfter;
    this.body = body;
  }

  /** { phone: "Número inválido", … } para os campos do formulário. */
  get fieldErrors() {
    return Object.fromEntries(this.errors.map((e) => [e.field, e.message]));
  }

  /** Uma frase para a pessoa, do catálogo da casa, nunca um stack trace nem o texto cru do servidor. */
  get userMessage() {
    if (this.status === 401 && !CATALOG[this.type]) return errorMessage("session_expired.staff");
    return errorMessage(this);
  }
}

const typeForStatus = (status) =>
  ({ 400: "bad_request", 401: "unauthorized", 403: "forbidden", 404: "not_found", 409: "conflict", 410: "gone", 412: "precondition_failed", 422: "validation", 429: "rate_limited" })[status] ||
  (status >= 500 ? "server" : "unknown");

const abortError = (signal) => signal.reason ?? new DOMException("Aborted", "AbortError");

/**
 * O token mora na memória, e toda página do site começa sem ele. Antes do primeiro
 * pedido que muda dados, pede o token à sessão (cliente ou equipe, pelo caminho).
 */
async function ensureCsrf(path) {
  if (csrfToken || NO_SESSION.test(path)) return;
  try {
    const session = await request("GET", path.startsWith("/staff/") ? "/staff/auth/session" : "/me");
    setCsrfToken(session?.csrf_token);
  } catch {
    // sem sessão: o pedido vai sem o token e a API responde 401
  }
}

/**
 * A URL e os cabeçalhos de uma chamada: query, corpo JSON ou de formulário, token CSRF, Idempotency-Key,
 * If-Match (a versão que a tela leu), cabeçalhos extras e a assinatura do aparelho da casa.
 */
async function prepare(method, path, { query, body, idempotencyKey, ifMatch, headers: extra } = {}) {
  if (method !== "GET") await ensureCsrf(path);
  const url = new URL(BASE + path, window.location.origin);
  for (const [key, value] of Object.entries(query || {})) {
    if (value == null || value === "") continue;
    url.searchParams.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  const headers = { Accept: "application/json", ...(extra || {}) };
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  if (body !== undefined && !isForm) headers["Content-Type"] = "application/json";
  if (method !== "GET" && csrfToken) headers["X-CSRF-Token"] = csrfToken;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  if (ifMatch != null && ifMatch !== "") headers["If-Match"] = String(ifMatch);
  // com a simulação ligada, uma operação já feita no servidor passa por fora da simulação (ROTAS_REAIS)
  if (MODE === "mock" && isRealRoute(method, path)) headers.Accept = `${headers.Accept}, msw/passthrough`;
  const payload = body === undefined ? undefined : isForm ? body : JSON.stringify(body);
  if (signer) {
    try {
      Object.assign(headers, (await signer({ method, path: url.pathname + url.search, body: typeof payload === "string" ? payload : "" })) || {});
    } catch {
      // sem chave para assinar: a API recusa a chamada e o painel diz por quê
    }
  }
  return { url, headers, payload };
}

/** O site estático não tem API: a resposta da cópia dos dados, ou o static_mode do catálogo (WhatsApp). */
function staticAnswer(method, path) {
  const reply = staticReply(method, path);
  if (reply !== undefined) return structuredClone(reply);
  throw new ApiError({ status: 0, type: "static_mode" });
}

/**
 * Uma chamada cuja resposta quem chama lê sozinho (um CSV, o fluxo ao vivo, uma leitura condicional com
 * If-None-Match): o mesmo CSRF, assinatura e cabeçalhos de request(), e a Response crua.
 * Uma falha de rede ou o tempo limite vira um ApiError; a situação fica para quem chama
 * (errorOf() transforma uma resposta com falha no ApiError). `timeout: 0` mantém a chamada aberta (o
 * fluxo), ainda cancelada por `signal`.
 * @param {"GET"|"POST"|"PUT"|"PATCH"|"DELETE"} method
 * @param {string} path
 * @param {{query?: object, body?: any, headers?: Record<string, string>, idempotencyKey?: string, ifMatch?: string|number, signal?: AbortSignal, timeout?: number, cache?: RequestCache}} [options]
 * @returns {Promise<Response>}
 */
export async function send(method, path, options = {}) {
  const { signal, timeout = TIMEOUT_MS, cache } = options;
  if (signal?.aborted) throw abortError(signal);
  if (MODE === "static") throw new ApiError({ status: 0, type: "static_mode" });
  const { url, headers, payload } = await prepare(method, path, options);
  const controller = new AbortController();
  const timer = timeout > 0 ? setTimeout(() => controller.abort("timeout"), timeout) : null;
  const forward = () => controller.abort(signal.reason);
  signal?.addEventListener("abort", forward, { once: true });
  try {
    return await fetch(url, { method, headers, body: payload, credentials: "include", signal: controller.signal, ...(cache ? { cache } : {}) });
  } catch {
    if (signal?.aborted) throw abortError(signal);
    if (controller.signal.reason === "timeout") throw new ApiError({ type: "timeout", title: t("errors.timeout") });
    throw new ApiError({ type: "network", title: t("errors.network") });
  } finally {
    if (timer) clearTimeout(timer);
    // uma chamada mantida aberta (o fluxo) fica presa ao sinal da tela até terminar
    if (timeout > 0) signal?.removeEventListener("abort", forward);
  }
}

/** O ApiError de uma resposta com falha de send(), a partir do corpo problem+json quando houver. */
export async function errorOf(response) {
  const data = await response
    .clone()
    .json()
    .catch(() => undefined);
  if (response.status === 401) window.dispatchEvent(new CustomEvent("api:unauthorized"));
  return new ApiError({
    status: response.status,
    type: data?.type || typeForStatus(response.status),
    title: data?.title,
    detail: data?.detail,
    errors: data?.errors,
    requestId: data?.request_id,
    retryAfter: Number(response.headers.get("Retry-After")) || null,
    body: data,
  });
}

/**
 * @param {"GET"|"POST"|"PUT"|"PATCH"|"DELETE"} method
 * @param {string} path  ex.: "/availability/days"
 * @param {{query?: object, body?: any, idempotencyKey?: string, ifMatch?: string|number, headers?: Record<string, string>, signal?: AbortSignal, timeout?: number}} [options]
 */
export async function request(method, path, options = {}) {
  const { signal, timeout = TIMEOUT_MS, retried = false } = options;
  if (signal?.aborted) throw abortError(signal);
  if (MODE === "static") return staticAnswer(method, path);
  const { url, headers, payload } = await prepare(method, path, options);

  // o tempo limite e o cancelamento da própria tela valem até o corpo ser lido, não só os cabeçalhos
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), timeout);
  const forward = () => controller.abort(signal.reason);
  signal?.addEventListener("abort", forward, { once: true });
  const failure = () => {
    if (signal?.aborted) return abortError(signal); // a tela cancelou de propósito
    if (controller.signal.reason === "timeout") return new ApiError({ type: "timeout", title: t("errors.timeout") });
    return new ApiError({ type: "network", title: t("errors.network") });
  };

  try {
    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: payload,
        credentials: "include",
        signal: controller.signal,
      });
    } catch {
      throw failure();
    }

    const isJson = (response.headers.get("content-type") || "").includes("json");
    // sem conteúdo, ou "accepted" sem corpo (POST /staff/auth/forgot responde 202 para qualquer um)
    if (response.status === 204 || (response.status === 202 && !isJson)) return null;
    let data;
    if (isJson) {
      const aborted = new Promise((_, reject) => controller.signal.addEventListener("abort", () => reject(failure()), { once: true }));
      aborted.catch(() => {});
      try {
        data = await Promise.race([response.json(), aborted]);
      } catch (error) {
        if (controller.signal.aborted) throw error instanceof ApiError || error === signal?.reason ? error : failure();
        data = undefined; // um corpo que afinal não é JSON
      }
    }

    if (!response.ok) {
      const error = new ApiError({
        status: response.status,
        type: data?.type || typeForStatus(response.status),
        title: data?.title,
        detail: data?.detail,
        errors: data?.errors,
        requestId: data?.request_id,
        retryAfter: Number(response.headers.get("Retry-After")) || null,
        body: data,
      });
      const lost = response.status === 401 || (response.status === 403 && ["no_active_person", "device_not_approved"].includes(error.type));
      if (lost && !retried && recovery && !SIGNING_IN.test(path)) {
        let recovered = false;
        try {
          recovered = await recovery(error, path);
        } catch {
          recovered = false;
        }
        if (recovered) return request(method, path, { ...options, retried: true });
      }
      if (response.status === 401) window.dispatchEvent(new CustomEvent("api:unauthorized", { detail: error }));
      throw error;
    }
    // um 2xx que não é JSON (um proxy respondendo com uma página, um corpo cortado) é uma falha, não "null"
    if (data === undefined) throw new ApiError({ status: response.status, type: "bad_response", title: t("errors.server") });
    return data;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forward);
  }
}

export const get = (path, options) => request("GET", path, options);
export const post = (path, body, options) => request("POST", path, { ...options, body });
export const put = (path, body, options) => request("PUT", path, { ...options, body });
export const patch = (path, body, options) => request("PATCH", path, { ...options, body });
export const del = (path, options) => request("DELETE", path, options);
