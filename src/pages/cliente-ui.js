// O que as páginas do cliente dividem: as frases de erro da casa (o catálogo único, src/lib/errors.json),
// os avisos com o próximo passo, o calendário da janela em semanas, o comprovante com as
// ações (arquivo de calendário, compartilhar, como chegar, minhas reservas) e os rótulos de dia e hora da casa.
// Toda data e hora é a da casa (America/Sao_Paulo), seja qual for o fuso do celular.
import { lateNote, receiptCard } from "../components/booking-receipt.js";
import { clock, deviceDiffers, directions, isInAppBrowser, nightOfBooking, readyMessage, weeksOf, whatsappUrl } from "../lib/cliente.js";
import { weekdayOf } from "../lib/dates.js";
import { CATALOG, describeError } from "../lib/errors.js";
import { html, nothing } from "../lib/html.js";
import { getLocale, t } from "../lib/strings.js";
import * as api from "../services/api/index.js";

export const IS_MOCK = import.meta.env?.VITE_API_MODE === "mock";

/** Um caminho do site no idioma da página ("/minhas-reservas/" → "/es/minhas-reservas/"). */
export const localPath = (route, locale = getLocale()) => (locale === "pt" ? route : `/${locale}${route}`);

// ---- dias e horas, sempre os da casa ----

const LONG_EN = (date) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric" });
};

/** "sexta, 17/10" (pt, es) ou "Friday, Oct 17" (en). */
export function dayName(date) {
  if (getLocale() === "en") return LONG_EN(date);
  const names = t("cliente.weekdays").split(",");
  const [, m, d] = date.split("-");
  return `${names[weekdayOf(date)]}, ${d}/${m}`;
}

export const weekdayName = (date) => t("cliente.weekdays").split(",")[weekdayOf(date)];
export const hour = (time) => clock(time, getLocale());

/** A nota do fuso, só quando o celular mostra outra hora que a da casa. */
export const zoneNote = (instant = new Date()) => (deviceDiffers(instant) ? t("cliente.zone") : "");

/** "quinta, 16/10, às 00:30 (noite de quarta)": um horário depois da meia-noite diz de que noite é. */
export function whenLabel(date, time) {
  const night = nightOfBooking(date, time);
  const base = t("cliente.when", { day: dayName(date), time: hour(time) });
  return night !== date ? `${base} ${t("cliente.nightOf", { night: weekdayName(night) })}` : base;
}

// ---- o catálogo de mensagens ----

// o catálogo único da casa (história 1.5): as entradas que o cliente pode ler, no idioma da página;
// a cópia antiga em i18n "cliente.err" só responde por uma chave que o catálogo ainda não tem
const forCustomer = (key) => Boolean(CATALOG[key]) && CATALOG[key].audience !== "staff";
const inI18n = (key) => t(`cliente.err.${key}.title`) !== `cliente.err.${key}.title`;
const known = (key) => forCustomer(key) || inI18n(key);

/**
 * Escolhe a entrada do catálogo para um erro. O servidor manda só o tipo; a tela escolhe a
 * variante pelo que estava fazendo (`context`: otp, link, draft, reschedule).
 */
export function catalogKey(error, context = "") {
  if (!(error instanceof api.ApiError)) return "unknown";
  const { type, body = {} } = error;
  const reason = body?.reason;
  // o site sem a API recusa toda chamada com static_mode: nunca "sem internet" (4.1)
  if (type === "static_mode") return "static_mode";
  if (type === "network" || error.status === 0) return navigator.onLine === false ? "offline" : type === "timeout" ? "timeout" : "network";
  if (type === "timeout") return "timeout";
  if (type === "bad_response") return "bad_response";
  if (type === "rate_limited") {
    if (body?.scope === "house") return "rate_limited.otp_house";
    if (body?.scope === "resend") return "otp_resend_wait";
    if (body?.scope === "phone" || body?.scope === "ip" || context === "otp") return "rate_limited.otp";
    return "rate_limited";
  }
  if (type === "validation") {
    if (reason === "honeypot") return "validation.honeypot";
    if (reason === "idempotency") return "validation.idempotency";
    if (error.errors?.some((e) => e.code === "phone_country_unsupported")) return "phone_country_unsupported";
    if (context === "otp" && error.errors?.some((e) => e.field === "code")) return "validation.otp";
    return "validation";
  }
  if (type === "gone") return context === "otp" || reason === "otp" ? "gone.otp" : "gone.link";
  if (type === "not_found") return context === "link" || reason === "link" ? "not_found.link" : "not_found";
  if (type === "slot_full") {
    if (reason === "cutoff") return "slot_full.cutoff";
    if (reason === "day_closed") return "slot_full.day_closed";
    if (reason === "event_mode") return "slot_full.event_mode";
    if (reason === "waitlist_full") return "slot_full.waitlist_full";
    return "slot_full";
  }
  if (type === "invalid_transition") return reason === "late" ? "invalid_transition.late" : reason === "late_off" ? "invalid_transition.late_off" : "invalid_transition";
  if (type === "conflict") return reason === "reschedule" ? "conflict.reschedule" : reason === "link_used" ? "conflict.link_used" : "invalid_transition";
  if ((type === "session_expired" || type === "unauthorized") && context === "draft") return "session_expired_draft";
  if (type === "csrf_failed") return "csrf_failed";
  if (error.status >= 500 || type === "server") return "server";
  return known(type) ? type : "unknown";
}

/** Título, frase e texto do botão de uma entrada do catálogo, com os marcadores preenchidos. */
export function catalog(key, vars = {}) {
  const k = known(key) ? key : "unknown";
  if (forCustomer(k)) {
    const d = describeError(k, { locale: getLocale(), vars });
    return { key: k, title: d.title, text: d.text, action: d.action || (inI18n(k) ? t(`cliente.err.${k}.action`, vars) : "") };
  }
  return { key: k, title: t(`cliente.err.${k}.title`, vars), text: t(`cliente.err.${k}.text`, vars), action: t(`cliente.err.${k}.action`, vars) };
}

/** Os marcadores que um erro traz: minutos de espera, tentativas restantes, o limite, o motivo do dia. */
export function varsOf(error, extra = {}) {
  const body = error?.body || {};
  const minutes = body.minutes ?? (error?.retryAfter ? Math.ceil(error.retryAfter / 60) : null) ?? 60;
  return {
    minutes,
    seconds: body.retry_after_s ?? 30,
    left: body.remaining_attempts ?? "",
    max: body.max ?? "",
    reason: body.reason_label ? `${t("cliente.dayClosedBecause", { reason: body.reason_label })}` : "",
    time: body.existing?.time ? hour(body.existing.time) : "",
    ...extra,
  };
}

/**
 * Um aviso no lugar: título, frase e o próximo passo (um botão, o WhatsApp da casa, um
 * link). role="alert" depois de um toque; role="status" para um estado (sem internet).
 */
export function noticeView(n) {
  if (!n) return nothing;
  const entry = n.key ? catalog(n.key, n.vars) : { title: n.title || "", text: n.text || "" };
  const role = n.status ? "status" : "alert";
  return html`<div class=${`notice aviso ${n.status ? "" : "notice--alert"}`} role=${role} tabindex="-1" data-aviso=${n.key || ""}>
    ${entry.title ? html`<strong class="aviso__titulo">${entry.title}</strong>` : nothing}
    ${entry.text ? html`<span class="aviso__texto">${entry.text}</span>` : nothing}
    ${n.body || nothing}
    ${n.retry || n.wa || n.links?.length
      ? html`<span class="aviso__acoes">
          ${n.retry ? html`<button class="btn btn--sm" type="button" @click=${n.retry}>${n.retryLabel || t("common.retry")}</button>` : nothing}
          ${(n.links || []).map((l) => html`<a class=${`btn btn--sm${l.outline === false ? "" : " btn--outline"}`} href=${l.href} rel="noopener">${l.label}</a>`)}
          ${n.wa ? html`<a class="btn btn--sm btn--outline" href=${n.wa} rel="noopener">${n.waLabel || t("cliente.whatsappCall")}</a>` : nothing}
        </span>`
      : nothing}
  </div>`;
}

/** O WhatsApp da casa com a mensagem pronta (pessoas, dia, hora, nome: o que já foi escolhido). */
export function houseWhatsapp(house, fallback, { name, party, date, time } = {}) {
  const phone = house?.whatsapp || fallback?.replace(/^https:\/\/wa\.me\/(\d+).*$/, "+$1");
  if (!phone) return fallback || "#";
  return whatsappUrl(phone, readyMessage(t, { name, party, day: date ? dayName(date) : null, time: time ? hour(time) : null }));
}

/**
 * O site sem a API (história 4.1, AR-13): nenhuma conta, link ou reserva funciona ali, então a
 * página diz isso com o static_mode do catálogo e o WhatsApp da casa com a mensagem pronta,
 * nunca "sem internet". Null quando este build fala com a API (as telas decidem por capabilities).
 */
export function staticModeView(fallback) {
  if (api.capabilities.account) return null;
  return noticeView({ key: "static_mode", status: true, wa: houseWhatsapp(null, fallback), waLabel: catalog("static_mode").action });
}

// ---- o calendário: a janela em semanas de sete dias, sem carrossel ----

const DEFAULT_REASON_PT = { production: "produção", closed: "fechado", event: "evento fechado", holiday: "feriado", outside_window: "ainda não abriu", past: "já passou" };

/** O motivo público do dia no idioma da página (as palavras da própria casa quando ela escreveu algo). */
export function reasonOf(d) {
  if (d.state === "no_booking") return t("cliente.freeEntry");
  // as palavras do próprio dono (a linha de uma festa fechada também, defeito 8), senão a palavra da casa para isso
  const custom = d.reason_label && d.reason_label.toLowerCase() !== (DEFAULT_REASON_PT[d.reason] || "");
  if (custom) return d.reason_label;
  return t(`day.${d.reason || "closed"}`);
}

export const isClosedDay = (d) => !d.open || d.state === "closed";
export const isBookable = (d) => d.open && !["closed", "no_booking", "full"].includes(d.state);

/**
 * A janela como uma grade de semanas. `days` vêm de GET /availability/days; `dates` são as
 * noites da janela (assim um dia que a API não mandou ainda tem o seu lugar). Dias lotados continuam clicáveis
 * (levam à lista de espera); dias fechados ficam hachurados com o motivo por extenso.
 */
export function calendarView({ dates, days, chosen, today, label, busy = false }) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const heads = t("cliente.weekdaysShort").split(",");
  const order = [1, 2, 3, 4, 5, 6, 0];
  return html`<div class="calendario">
    <div class="calendario__semana" aria-hidden="true">${order.map((i) => html`<span>${heads[i]}</span>`)}</div>
    <div class=${`days calendario__grade${busy ? " is-carregando" : ""}`} role="radiogroup" aria-label=${label} data-group="day">
      ${weeksOf(dates).flat().map((date) => {
        if (!date) return html`<span class="calendario__vazio" aria-hidden="true"></span>`;
        const d = byDate.get(date) || { date, open: false, state: "closed", reason: "outside_window" };
        const closed = isClosedDay(d) || d.state === "no_booking";
        const sub = closed ? reasonOf(d) : t(`slot.${d.state === "few_left" ? "few_left" : d.state === "full" ? "full" : "available"}`);
        const event = d.event?.title && d.event.booking_mode !== "private" ? d.event.title : "";
        const [, mm, dd] = date.split("-");
        return html`<button
          type="button"
          class=${["day", date === today ? "is-today" : "", d.state === "full" ? "is-full" : "", closed ? "is-closed" : "", event ? "has-event" : ""].join(" ")}
          role="radio"
          data-value=${date}
          aria-checked=${String(chosen === date)}
          aria-disabled=${String(closed && d.state !== "no_booking")}
          aria-label=${[dayName(date), event, sub].filter(Boolean).join(", ")}
        ><small>${dd}/${mm}</small><b>${Number(dd)}</b>${event ? html`<em class="day__evento">${event}</em>` : nothing}<span>${d.state === "full" ? t("cliente.dayFullShort") : sub}</span></button>`;
      })}
    </div>
  </div>`;
}

// ---- o comprovante e suas ações ----

export const tokenOf = (r) => new URL(r.receipt_url, location.origin).searchParams.get("t") || r.receipt_url.split("/").filter(Boolean).pop();

async function saveIcs(r, onFail) {
  try {
    const blob = await api.links.calendar(tokenOf(r));
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `territorio-${r.code}.ics`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch {
    onFail("download_failed");
  }
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

async function share(r, onDone) {
  const url = new URL(r.receipt_url, location.origin).href;
  if (navigator.share) {
    try {
      await navigator.share({ title: t("cliente.receipt.shareTitle"), text: t("cliente.receipt.shareText", { day: dayName(r.date), time: hour(r.time) }), url });
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }
  onDone((await copyText(url)) ? "copied" : "copyFailed");
}

/**
 * O cartão do comprovante com o que vem depois e as ações: pôr no calendário, compartilhar o
 * link de leitura, como chegar (Maps e Waze) e minhas reservas. `say(key)` mostra uma resposta curta
 * (copiado, falha no download) na página.
 */
export function receiptBlock(r, { house, name = "", say = () => {}, inApp = isInAppBrowser(), expanded = {}, toggle = () => {} } = {}) {
  const where = house?.address ? directions(house.address) : null;
  const active = ["pending", "confirmed", "waitlisted", "offered"].includes(r.status);
  const note = lateNote(r, house?.booking || {});
  const zone = zoneNote(new Date(`${r.date}T${r.time}:00-03:00`));
  return html`<div class="recibo">
    ${receiptCard(r, name)}
    <p class="recibo__codigo-ajuda">${t("cliente.receipt.codeHelp", { code: r.code })}</p>
    <p class="recibo__quando">${whenLabel(r.date, r.time)}${zone ? html` <span class="zona">${zone}</span>` : nothing}</p>
    ${note ? html`<p class="notice" role="status">${note}</p>` : nothing}
    ${active
      ? html`<div class="reserva__acoes recibo__acoes">
          <button class="btn btn--outline" type="button" @click=${() => (inApp ? toggle("agenda") : saveIcs(r, say))}>${t("cliente.receipt.calendar")}</button>
          <button class="btn btn--outline" type="button" @click=${() => share(r, say)}>${t("cliente.receipt.share")}</button>
          ${where ? html`<button class="btn btn--outline" type="button" aria-expanded=${String(Boolean(expanded.rota))} @click=${() => toggle("rota")}>${t("cliente.receipt.directions")}</button>` : nothing}
          <a class="btn btn--outline" href=${localPath("/minhas-reservas/")}>${t("cliente.receipt.mine")}</a>
        </div>`
      : html`<div class="reserva__acoes"><a class="btn btn--outline" href=${localPath("/minhas-reservas/")}>${t("cliente.receipt.mine")}</a></div>`}
    ${expanded.agenda
      ? html`<div class="notice recibo__inapp" role="status">
          <span>${t("cliente.receipt.inApp")}</span>
          <span class="aviso__acoes">
            <button class="btn btn--sm" type="button" @click=${() => saveIcs(r, say)}>${t("cliente.receipt.calendarTry")}</button>
            <a class="btn btn--sm btn--outline" href=${new URL(r.receipt_url, location.origin).href} target="_blank" rel="noopener">${t("cliente.receipt.openBrowser")}</a>
            <button class="btn btn--sm btn--outline" type="button" @click=${async () => say((await copyText(new URL(r.receipt_url, location.origin).href)) ? "copied" : "copyFailed")}>${t("cliente.receipt.copyLink")}</button>
          </span>
        </div>`
      : nothing}
    ${expanded.rota && where
      ? html`<p class="reserva__acoes recibo__rota">
          <a class="btn btn--sm btn--outline" href=${where.maps} target="_blank" rel="noopener">Google Maps</a>
          <a class="btn btn--sm btn--outline" href=${where.waze} target="_blank" rel="noopener">Waze</a>
        </p>`
      : nothing}
    ${IS_MOCK && r.demo && active
      ? html`<p class="recibo__demo"><b>${t("cliente.demo.title")}</b> ${t("cliente.demo.text")}
          ${r.status === "waitlisted" || r.status === "offered"
            ? html`<a href=${r.demo.waitlist_url}>${t("cliente.demo.waitlist")}</a>`
            : html`<a href=${r.demo.confirm_url}>${t("cliente.demo.confirm")}</a>`}</p>`
      : nothing}
  </div>`;
}

/** Respostas curtas depois de uma ação do comprovante (copiado, falha no download). */
export function sayView(said) {
  if (!said) return nothing;
  if (said === "download_failed") return noticeView({ key: "download_failed" });
  return html`<p class="notice" role="status">${t(`cliente.receipt.${said}`)}</p>`;
}
