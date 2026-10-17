// "Aberto agora" e "Hoje na casa" no idioma da página (histórias 4.3 e 4.4). Funções puras:
// as mesmas regras rodam na resposta da API (os dias já resolvidos pelo servidor, com
// feriados, eventos e o plano do dia) e, quando a API está fora do ar, no horário semanal impresso
// no build. O "agora" é sempre contado no fuso da casa (America/Sao_Paulo), e uma
// noite que fecha depois da meia-noite pertence ao dia em que abriu (NFR-27).
import { addDays, houseParts, weekdayOf } from "../../lib/dates.js";
import { shiftsOf, shiftsText, spansOf } from "../hours.js";
import { formatTime } from "../time.js";

/** Um LocalizedText ({pt, es, en}) ou uma string simples, no idioma (português quando faltar). */
export const inLang = (value, locale) => (value == null ? "" : typeof value === "string" ? value : value[locale] || value.pt || "");

/** O horário semanal do build como dias resolvidos, de ontem até `count` dias à frente. */
export function weekDays(hours, today, count = 16) {
  return Array.from({ length: count }, (_, i) => {
    const date = addDays(today, i - 1);
    const week = hours.find((h) => h.weekday === weekdayOf(date)) || { open: false, reason: "closed" };
    return {
      date,
      open: Boolean(week.open),
      opens_at: week.open ? week.opens_at : null,
      closes_at: week.open ? week.closes_at : null,
      // o outro turno do dia, quando o dono liga os dois turnos (história 2.8)
      second_shift: week.open ? week.second_shift || null : null,
      reason: week.open ? null : week.reason || "closed",
      reason_labels: null,
    };
  });
}

/** Se este aparelho mostra um relógio diferente do de Foz do Iguaçu naquele instante. */
export function deviceElsewhere(instant) {
  try {
    const local = new Intl.DateTimeFormat("en-CA", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(instant));
    return local !== houseParts(instant).time;
  } catch {
    return false;
  }
}

const weekday = (date, t) => t("site.weekdaysLong").split(",")[weekdayOf(date)] || "";

/** "Abre amanhã às 19h", "Abre quarta às 19h" — a próxima abertura de verdade depois de `date`, ou null. */
function nextOpening(days, date, t) {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  for (const day of sorted) {
    const first = shiftsOf(day)[0];
    if (day.date <= date || !first) continue;
    const open = formatTime(first.opens_at, t);
    return day.date === addDays(date, 1) ? t("site.opensTomorrow", { open }) : t("site.opensOn", { day: weekday(day.date, t), open });
  }
  return null;
}

/**
 * A linha de abertura ao vivo: { open, text }. `days` são dias resolvidos (HousePublic.days ou
 * weekDays()); `instant` vem do relógio do servidor, nunca do aparelho.
 */
export function openLine(days, instant, t) {
  const now = houseParts(instant);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const until = (shift) => ({ open: true, text: t("site.openNow", { close: formatTime(shift.closes_at, t) }) });

  // a madrugada de ontem: um turno que fechou depois da meia-noite ainda está aberto
  const lateNight = spansOf(byDate.get(addDays(now.date, -1))).find((s) => now.minutes + 1440 < s.closes);
  if (lateNight) return until(lateNight);

  const spans = spansOf(byDate.get(now.date));
  const current = spans.find((s) => now.minutes >= s.opens && now.minutes < s.closes);
  if (current) return until(current);
  const next = spans.find((s) => now.minutes < s.opens);
  if (next) {
    // entre os dois turnos: fechado agora, abre de novo mais tarde
    const between = spans.some((s) => s.closes <= now.minutes);
    return { open: false, text: t(between ? "site.opensAgain" : "site.opensToday", { open: formatTime(next.opens_at, t) }) };
  }
  return { open: false, text: nextOpening(days, now.date, t) || t("site.closedNow") };
}

/** Por que um dia fechado está fechado, no idioma: as palavras do dono, senão a palavra da casa para isso. */
function closedReason(day, t, locale) {
  return inLang(day.reason_labels, locale) || t(`day.${day.reason || "closed"}`);
}

/**
 * "Hoje na casa": um aviso dentro da validade; senão, num dia fechado, o motivo e a próxima
 * abertura; senão o evento desta noite, o prato do dia, a frase do dia da semana ou quando abre.
 * Devolve { kind, text }.
 */
export function todayLine({ notices = [], rules = {}, fallback = null, days = [], dish = null, eventTitle = null, instant, t, locale }) {
  const now = new Date(instant);
  const { date, weekday: wd } = houseParts(now);
  const notice = notices.find((n) => new Date(n.starts_at) <= now && now < new Date(n.ends_at));
  if (notice && inLang(notice.text, locale)) return { kind: "notice", text: inLang(notice.text, locale) };

  const today = days.find((d) => d.date === date);
  if (today && !today.open) {
    const next = nextOpening(days, date, t);
    return { kind: "closed", text: [t("site.todayClosed", { reason: closedReason(today, t, locale) }), next ? `${next}.` : ""].filter(Boolean).join(" ") };
  }
  const shifts = shiftsOf(today);
  if (today?.event_title) return { kind: "event", text: t("site.todayEvent", { title: eventTitle || today.event_title, open: formatTime(shifts[0]?.opens_at || today.opens_at, t) }) };
  if (dish) return { kind: "dish", text: t("site.todayDish", { dish }) };
  const rule = inLang(rules?.[wd], locale);
  if (rule) return { kind: "rule", text: rule };
  if (shifts.length > 1) return { kind: "open", text: t("site.todayShifts", { shifts: shiftsText(shifts, t) }) };
  if (shifts.length) return { kind: "open", text: t("site.todayOpen", { open: formatTime(shifts[0].opens_at, t) }) };
  const next = nextOpening(days, date, t);
  if (next) return { kind: "next", text: `${next}.` };
  return { kind: "rule", text: inLang(fallback, locale) };
}
