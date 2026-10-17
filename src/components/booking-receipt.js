// O comprovante da reserva como o cliente vê: o selo, a placa, uma linha no jeito da casa,
// o código, o dia e a hora, e o que vem depois (até quando a mesa espera, até quando a
// casa responde, o lugar na fila). A palavra "tolerância" fica no painel e nos
// combinados; o comprovante diz isso de forma simples (FR-23, UX-DR-39).
import { clock, houseClock } from "../lib/cliente.js";
import { html, nothing } from "../lib/html.js";
import { getLocale, t } from "../lib/strings.js";

const INTL = { pt: "pt-BR", es: "es", en: "en" };

export function dayLabel(date, options = { weekday: "short", day: "2-digit", month: "2-digit" }) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(INTL[getLocale()], { timeZone: "UTC", ...options });
}

export const people = (n) => t(n === 1 ? "book.person" : "book.people", { n });

/** "ok", "pending", "waitlist" ou "closed" (cancelada, recusada, passada): o que o comprovante diz. */
export function receiptKind(r) {
  if (r.status === "waitlisted" || r.status === "offered") return "waitlist";
  if (r.status === "pending") return "pending";
  if (r.status === "confirmed" || r.status === "completed") return "ok";
  return "closed";
}

/** Até quando a mesa espera, por extenso: "A mesa te espera até 20:20" (ou "às 20:00 em ponto"). */
export function waitsLine(r) {
  const locale = getLocale();
  if (!r.tolerance_until || r.tolerance_until === r.time) return t("book.waitsOnTime", { time: clock(r.time, locale) });
  return t("book.waitsUntil", { time: clock(r.tolerance_until, locale) });
}

export function receiptCard(r, fallbackName = "") {
  const locale = getLocale();
  const first = r.first_name || fallbackName.split(" ")[0];
  const kind = receiptKind(r);
  const hand = {
    ok: t("book.handOk", { name: first }),
    pending: t("book.handPending", { name: first }),
    waitlist: t(r.status === "offered" ? "book.handOffered" : "book.handWaitlist", { name: first }),
    closed: t(`status.${r.status}`),
  }[kind];
  const line = {
    ok: waitsLine(r),
    pending: r.pending_until ? t("book.houseConfirmsUntil", { time: houseClock(r.pending_until, locale) }) : t("book.houseConfirms"),
    waitlist: r.status === "offered" ? t("status.offered") : t("book.waitlistPosition", { n: r.waitlist_position ?? 1 }),
    closed: t(`status.${r.status}`),
  }[kind];
  const variant = { ok: "", pending: " receipt--pending", waitlist: " receipt--waitlist", closed: " receipt--closed" }[kind];
  return html`<div class=${`receipt is-new${variant}`} tabindex="-1">
    <span class="receipt__stamp seal" aria-hidden="true"></span>
    <span class="receipt__logo" role="img" aria-label="Território"></span>
    <span class="mao" lang="pt-BR">${hand}</span>
    <span class="receipt__code">${r.code}</span>
    ${r.event_title ? html`<div class="receipt__line"><span>${r.event_title}</span><span>${t(r.place === "list" ? "book.placeList" : "book.placeTable")}</span></div>` : nothing}
    <div class="receipt__line"><span>${dayLabel(r.date)}</span><b>${clock(r.time, locale)}</b></div>
    <div class="receipt__line"><span>${people(r.party_size)}</span><span>${line}</span></div>
  </div>`;
}

/**
 * O que acontece se a pessoa se atrasar, com os números da casa: até quando a mesa é dela,
 * o que vem depois (deixa de ter prioridade, ou a mesa é liberada) e, quando a casa permite,
 * quanto tempo espera se ela avisar a casa.
 */
export function lateNote(r, rules = {}) {
  if (!["confirmed", "pending"].includes(r.status)) return "";
  const locale = getLocale();
  const until = clock(r.tolerance_until || r.time, locale);
  const after = t(rules.after_tolerance === "release" ? "receipt.lateNoteRelease" : "receipt.lateNote", { ate: until });
  if (r.late_notice_at) return t("receipt.lateDone", { ate: until });
  if (!rules.late_notice_enabled || !r.tolerance_extra_until) return after;
  return `${after} ${t("receipt.lateNoteExtra", { extra: clock(r.tolerance_extra_until, locale) })}`;
}
