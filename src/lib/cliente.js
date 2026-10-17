// Funções puras das páginas do cliente (reserva, comprovante, conta, links): as noites da casa,
// a janela de reservas em semanas, caracteres visíveis, a mensagem pronta do WhatsApp, o arquivo
// de calendário e a checagem do navegador dentro de app. Sem DOM e sem rede, para os testes de unidade rodarem no Node.
import { addDays, houseParts, toMinutes, weekdayOf } from "./dates.js";

export const HOUSE_TZ = "America/Sao_Paulo";
export const NIGHT_CUTOFF = "05:00";

/** A noite da casa num instante: até 05:00 ainda é a noite anterior (FR-16). */
export function nightOf(instant = new Date(), cutoff = NIGHT_CUTOFF) {
  const at = new Date(new Date(instant).getTime() - toMinutes(cutoff) * 60_000);
  return houseParts(at).date;
}

/** A noite a que pertence uma reserva numa data e hora do calendário (00:30 do dia 16 → noite do dia 15). */
export function nightOfBooking(date, time, cutoff = NIGHT_CUTOFF) {
  return toMinutes(time) < toMinutes(cutoff) ? addDays(date, -1) : date;
}

/** As noites da janela: hoje e as próximas window_days − 1 (30 por padrão, de 1 a 120). */
export function windowDates(today, windowDays = 30) {
  const n = Math.min(120, Math.max(1, Math.round(Number(windowDays) || 30)));
  return Array.from({ length: n }, (_, i) => addDays(today, i));
}

/** Se uma data está dentro da janela que começa hoje à noite. */
export function inWindow(date, today, windowDays = 30) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return false;
  const last = addDays(today, Math.max(1, Number(windowDays) || 30) - 1);
  return date >= today && date <= last;
}

/**
 * As datas arrumadas em semanas de calendário, segunda primeiro, com null onde a semana começa antes
 * da janela ou termina depois dela. Sem carrossel e sem rolagem para o lado: sete colunas, linhas de semanas.
 */
export function weeksOf(dates) {
  if (!dates.length) return [];
  const lead = (weekdayOf(dates[0]) + 6) % 7; // segunda = 0
  const cells = [...Array(lead).fill(null), ...dates];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
}

const segmenter = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

/** Caracteres como a pessoa vê: um emoji ou um acento digitado em duas partes conta como um, e uma quebra de linha também. */
export function visibleLength(text) {
  const value = String(text ?? "").replace(/\r\n/g, "\n");
  if (!segmenter) return [...value].length;
  let n = 0;
  for (const _ of segmenter.segment(value)) n++; // eslint-disable-line no-unused-vars
  return n;
}

const LINK = /(https?:\/\/|www\.|\.com\b|\.br\b)/i;

/** O problema da observação, ou null: passou do limite ("281/280") ou tem link. Nada é cortado. */
export function notesProblem(text, max = 280) {
  const count = visibleLength(String(text ?? "").trim());
  if (count > max) return { kind: "long", count, max };
  if (LINK.test(String(text ?? ""))) return { kind: "link", count, max };
  return null;
}

/** "20:00" no idioma da página: 24 h em pt e es, um formato em inglês ("8:30 pm"). */
export function clock(time, locale = "pt") {
  if (!time) return "";
  const [h, m] = time.split(":").map(Number);
  if (locale !== "en") return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** Hora no relógio da casa de um instante ISO ("2026-10-16T21:30:00Z" → "18:30"). */
export const houseClock = (iso, locale = "pt") => clock(houseParts(iso).time, locale);

/**
 * Se o aparelho mostra outra hora que a da casa num instante (outro fuso, ou dados de fuso
 * antigos como America/Asuncion em UTC−4). As páginas então acrescentam "horário de Foz do Iguaçu".
 */
export function deviceDiffers(instant = new Date(), deviceZone) {
  const zone = deviceZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (zone === HOUSE_TZ) return false;
  const at = new Date(instant);
  const local = new Intl.DateTimeFormat("en-CA", { timeZone: zone, hour: "2-digit", minute: "2-digit", day: "2-digit", hourCycle: "h23" }).format(at);
  const house = new Intl.DateTimeFormat("en-CA", { timeZone: HOUSE_TZ, hour: "2-digit", minute: "2-digit", day: "2-digit", hourCycle: "h23" }).format(at);
  return local !== house;
}

const IN_APP = /Instagram|FBAN|FBAV|FB_IAB|FBIOS|Line\/|BytedanceWebview|musical_ly|Snapchat|LinkedInApp|Twitter for/i;

/** O navegador dentro do Instagram (ou de outro app), onde o Google se recusa a entrar e o .ics muitas vezes não baixa. */
export const isInAppBrowser = (ua = globalThis.navigator?.userAgent || "") => IN_APP.test(ua);

/**
 * A mensagem pronta para o WhatsApp da casa no idioma da página. `t` é o tradutor
 * da página; `day` é o dia já escrito ("sexta, 17/10"). Partes que faltam ficam de fora.
 */
export function readyMessage(t, { name, party, day, time }) {
  const parts = [t("cliente.wa.hello")];
  if (name) parts.push(t("cliente.wa.iAm", { name: String(name).trim().split(/\s+/)[0] }));
  let want = party ? t("cliente.wa.tableFor", { n: party }) : t("cliente.wa.table");
  if (day) want += t("cliente.wa.onDay", { day });
  if (day && time) want += t("cliente.wa.atTime", { time });
  parts.push(`${want}.`);
  return parts.join(" ");
}

export function whatsappUrl(phone, message = "") {
  const number = String(phone || "").replace(/\D/g, "");
  return message ? `https://wa.me/${number}?text=${encodeURIComponent(message)}` : `https://wa.me/${number}`;
}

/** Quando vence a resposta da casa a um pedido pendente: 4 h depois do pedido (ou depois do fim
 *  do horário de silêncio, quando chegou nele), nunca depois de 30 min antes da mesa. */
export function pendingDeadline(now, startsAt, { hours = 4, quietFrom = "01:00", quietTo = "09:00" } = {}) {
  const at = new Date(now);
  const clockNow = houseParts(at);
  const from = toMinutes(quietFrom);
  const to = toMinutes(quietTo);
  const inQuiet = from <= to ? clockNow.minutes >= from && clockNow.minutes < to : clockNow.minutes >= from || clockNow.minutes < to;
  let start = at.getTime();
  if (inQuiet) {
    const date = clockNow.minutes >= to ? addDays(clockNow.date, 1) : clockNow.date;
    start = new Date(`${date}T${quietTo}:00-03:00`).getTime();
  }
  const limit = new Date(startsAt).getTime() - 30 * 60_000;
  return new Date(Math.max(at.getTime(), Math.min(start + hours * 3_600_000, limit))).toISOString();
}

/**
 * Se o prazo para cancelar sem custo já passou. O próprio prazo ainda está no horário: numa
 * reserva às 20:00 com 2 h, o segundo 18:00:00 inteiro cancela sem contar como atraso (história 7.11).
 */
export const pastDeadline = (now, deadline) => Math.floor(new Date(now).getTime() / 1000) > Math.floor(new Date(deadline).getTime() / 1000);

/** Minutos inteiros que faltam até um instante (nunca abaixo de 0). */
export const minutesLeft = (until, now = new Date()) => Math.max(0, Math.ceil((new Date(until) - new Date(now)) / 60_000));

const icsText = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsStamp = (date, time) => `${date.replace(/-/g, "")}T${time.replace(":", "")}00`;

/**
 * O arquivo de calendário (.ics) de uma reserva: DTSTART na data do calendário e no fuso da casa
 * (TZID=America/Sao_Paulo), para uma reserva às 00:30 ficar no dia certo em qualquer celular.
 */
export function buildIcs({ code, date, time, durationMin = 120, title, location, description, url, now = new Date() }) {
  const end = new Date(Date.UTC(...date.split("-").map((n, i) => Number(n) - (i === 1 ? 1 : 0)), ...time.split(":").map(Number)) + durationMin * 60_000);
  const endDate = end.toISOString().slice(0, 10);
  const endTime = end.toISOString().slice(11, 16);
  const stamp = new Date(now).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Territorio//Reservas//PT",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VTIMEZONE",
    "TZID:America/Sao_Paulo",
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:-0300",
    "TZOFFSETTO:-0300",
    "TZNAME:-03",
    "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    `UID:${code}@territorio`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=America/Sao_Paulo:${icsStamp(date, time)}`,
    `DTEND;TZID=America/Sao_Paulo:${icsStamp(endDate, endTime)}`,
    `SUMMARY:${icsText(title)}`,
    location ? `LOCATION:${icsText(location)}` : null,
    description ? `DESCRIPTION:${icsText(description)}` : null,
    url ? `URL:${url}` : null,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ]
    .filter((line) => line !== null)
    .join("\r\n");
}

/** Maps e Waze para o ponto da casa no mapa. */
export function directions({ lat, lng, street, number, city }) {
  const where = lat != null && lng != null ? `${lat},${lng}` : encodeURIComponent(`${street}, ${number}, ${city}`);
  return {
    maps: `https://www.google.com/maps/dir/?api=1&destination=${where}`,
    waze: lat != null && lng != null ? `https://waze.com/ul?ll=${lat},${lng}&navigate=yes` : `https://waze.com/ul?q=${where}&navigate=yes`,
  };
}
