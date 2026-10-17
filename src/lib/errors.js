// O catálogo de erros da casa (UX: erros-e-mensagens.md, cópia para máquina em errors.json) e a única
// função que toda tela usa para transformar uma falha no que a pessoa lê: título, texto e o
// próximo passo, no idioma da página para o cliente e em português no painel. Nunca o
// texto cru do servidor e nunca um código técnico; o número do pedido fica no resultado para o
// dono achar no log (ele não aparece).
//
// O servidor manda só o `type`; a tela escolhe a variante pela rota que chamou
// ("gone" + "invite" → gone.invite). A chave mais precisa ganha, depois a de base.
import CATALOG from "./errors.json" with { type: "json" };
import { getLocale } from "./strings.js";

export { CATALOG };

const STATUS_TYPE = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  410: "gone",
  412: "precondition_failed",
  422: "validation",
  423: "pin_locked",
  429: "rate_limited",
};

// o que um espaço reservado diz quando o problema não trouxe o valor dele
const FALLBACK = {
  pt: { minutes: "alguns", hours: "algumas", name: "Alguém", left: "poucas", max: "o limite de", count: "Algumas", direction: "fora da hora da casa", time: "agora há pouco" },
  es: { minutes: "unos", hours: "unas", name: "Alguien", left: "pocos", max: "el límite de", count: "Algunas", direction: "fuera de hora", time: "hace un rato" },
  en: { minutes: "a few", hours: "a few", name: "Someone", left: "a few", max: "the limit of", count: "Some", direction: "off", time: "a moment ago" },
};

const typeOfStatus = (status) => STATUS_TYPE[status] || (status >= 500 ? "server" : "unknown");

/** O ProblemType de uma falha: uma string de código, um ApiError ou qualquer coisa lançada. */
function typeOf(error) {
  let type;
  if (typeof error === "string") type = error;
  else if (!error) type = "unknown";
  else if (error.type && error.type !== "unknown") type = error.type;
  else if (error.status) type = typeOfStatus(error.status);
  else type = "unknown";
  // o relógio é a única causa de assinatura recusada com frase própria (história 1.11)
  if (type === "device_signature_invalid" && error?.body?.reason === "clock") type = "device_clock_skew";
  return type;
}

/** A chave do catálogo de um erro: uma string de código, um ApiError ou qualquer coisa lançada. */
export function errorCode(error, variant) {
  const type = typeOf(error);
  if (variant && CATALOG[`${type}.${variant}`]) return `${type}.${variant}`;
  if (CATALOG[type]) return type;
  if (error?.status && CATALOG[typeOfStatus(error.status)]) return typeOfStatus(error.status);
  return "unknown";
}

// o que o painel diz pelo status quando o tipo não tem frase feita para a equipe
const STAFF_STATUS = { 401: "unauthorized.staff", 403: "forbidden", 404: "not_found.staff", 409: "conflict", 410: "gone.staff", 412: "precondition_failed", 422: "validation.staff", 429: "rate_limited" };
const forStaff = (code) => CATALOG[code] && CATALOG[code].audience !== "customer";

/**
 * A chave do catálogo no painel: a variante da tela, depois o motivo do próprio problema
 * ("conflict" + motivo "table_taken" → conflict.table_taken), depois a variante da equipe para o
 * tipo (slot_full.staff), depois a de base quando não é frase só do cliente, depois o
 * status. Uma frase escrita para o cliente nunca chega à equipe.
 */
export function staffErrorCode(error, variant) {
  const type = typeOf(error);
  const reason = typeof error === "object" ? error?.body?.reason || error?.body?.code : null;
  const tries = [variant && `${type}.${variant}`, reason && `${type}.${reason}`, reason && CATALOG[reason] && reason, `${type}.staff`, type];
  for (const code of tries) if (code && forStaff(code)) return code;
  const status = typeof error === "object" ? error?.status : null;
  if (status >= 500) return "server.staff";
  if (STAFF_STATUS[status]) return STAFF_STATUS[status];
  return "unknown.staff";
}

/** Valores que o próprio problema traz: Retry-After, tentativas restantes, o relógio do aparelho. */
function derived(error, locale) {
  const out = {};
  if (!error || typeof error !== "object") return out;
  const body = error.body || {};
  if (error.retryAfter) out.minutes = Math.max(1, Math.ceil(error.retryAfter / 60));
  if (body.remaining_attempts != null) out.left = body.remaining_attempts;
  if (body.skew_s != null) {
    out.minutes = Math.max(1, Math.round(Math.abs(body.skew_s) / 60));
    const ahead = body.skew_s > 0;
    out.direction = { pt: ahead ? "adiantado" : "atrasado", es: ahead ? "adelantado" : "atrasado", en: ahead ? "fast" : "slow" }[locale];
  }
  if (body.count != null) out.count = body.count;
  // os fatos que uma recusa traz para a equipe: quem, quando, quanto tempo ("por Tainá às 21:12")
  if (body.minutes != null && !error.retryAfter) out.minutes = body.minutes;
  if (body.hours != null) out.hours = body.hours;
  if (body.name) out.name = body.name;
  if (body.time) out.time = body.time;
  return out;
}

function fill(text, values, locale) {
  return String(text || "")
    .replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? FALLBACK[locale]?.[key] ?? ""))
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * O que a pessoa lê para esta falha.
 * @param {any} error  um ApiError, um código do catálogo ("gone.invite") ou qualquer coisa lançada
 * @param {{variant?: string, locale?: "pt"|"es"|"en", vars?: object, staff?: boolean}} [options]
 *   `staff` escolhe a frase do painel (staffErrorCode): nunca uma escrita para o cliente.
 * @returns {{code: string, title: string, text: string, action: string, next: string, display: string, log: boolean, requestId: string|null}}
 */
export function describeError(error, { variant, locale, vars = {}, staff = false } = {}) {
  const code = staff ? staffErrorCode(error, variant) : errorCode(error, variant);
  const entry = CATALOG[code] || CATALOG.unknown;
  // as mensagens do painel só existem em português
  const lang = staff || entry.audience === "staff" ? "pt" : locale || getLocale();
  const texts = entry[lang] || entry.pt;
  const values = { ...derived(error, lang), ...vars };
  return {
    code,
    title: fill(texts.title, values, lang),
    text: fill(texts.text, values, lang),
    action: texts.action || "",
    next: entry.action,
    display: entry.display,
    log: Boolean(entry.log),
    requestId: (typeof error === "object" && (error?.requestId || error?.body?.request_id)) || null,
  };
}

/** Título e texto numa frase só, para um toast ou uma linha embaixo de um campo. */
export function errorMessage(error, options) {
  const { title, text } = describeError(error, options);
  return /[.!?]$/.test(title) ? `${title} ${text}` : `${title}. ${text}`;
}

/** A frase única do painel para uma falha (título e texto), do mesmo catálogo. */
export const staffErrorMessage = (error, options = {}) => errorMessage(error, { ...options, staff: true });

/** Título e texto do painel separados, para um toast ({ title, message }) ou um aviso. */
export function staffProblem(error, options = {}) {
  const d = describeError(error, { ...options, staff: true });
  return { title: d.title, message: d.text, code: d.code, requestId: d.requestId };
}
