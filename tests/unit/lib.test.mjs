import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays, daysBetween, formatDay, houseParts, openStatus, relativeDay, shortTime, weekdayOf } from "../../src/lib/dates.js";
import { formatPrice } from "../../src/lib/money.js";
import { buildIcs, clock, deviceDiffers, houseClock, inWindow, isInAppBrowser, nightOf, nightOfBooking, notesProblem, pastDeadline, pendingDeadline, readyMessage, visibleLength, weeksOf, whatsappUrl, windowDates } from "../../src/lib/cliente.js";
import { formatPhone, maskPhone, phoneCheck, toE164 } from "../../src/lib/phone.js";
import { t } from "../../src/lib/strings.js";
import { uuid } from "../../src/lib/uuid.js";
import { rules } from "../../src/lib/validate.js";

test("calendar days never drift with the time zone", () => {
  assert.equal(addDays("2026-09-30", 1), "2026-10-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(daysBetween("2026-09-30", "2026-10-03"), 3);
  assert.equal(weekdayOf("2026-09-30"), 3); // quarta
  assert.equal(formatDay("2026-09-30"), "qua 30/09");
  assert.equal(formatDay("2026-10-01", "long"), "quinta, 1 de outubro");
  assert.equal(relativeDay("2026-10-01", "2026-09-30"), "amanhã");
  assert.equal(shortTime("19:00"), "19h");
  assert.equal(shortTime("21:30"), "21h30");
});

test("house clock is São Paulo time", () => {
  // 02:30 UTC de 1º/10 ainda é 23:30 de 30/09 em Foz do Iguaçu
  const p = houseParts("2026-10-01T02:30:00Z");
  assert.equal(p.date, "2026-09-30");
  assert.equal(p.time, "23:30");
});

// Dias resolvidos como o GET /house manda, feitos a partir de uma semana (quarta a sábado, 19h às 23h).
function resolvedDays(from, count, change = {}) {
  return Array.from({ length: count }, (_, i) => {
    const date = addDays(from, i);
    const open = weekdayOf(date) >= 3 && weekdayOf(date) <= 6;
    return { date, open, opens_at: open ? "19:00" : null, closes_at: open ? "23:00" : null, reason_label: null, ...change[date] };
  });
}

test("open status follows the resolved days", () => {
  const days = resolvedDays("2026-09-28", 14);
  assert.deepEqual(openStatus(days, "2026-09-30T23:00:00Z"), { open: true, label: "Aberta agora · até 23h" }); // qua 20:00
  assert.equal(openStatus(days, "2026-09-30T15:00:00Z").label, "Abre hoje às 19h"); // qua 12:00
  assert.equal(openStatus(days, "2026-10-04T15:00:00Z").label, "Abre quarta às 19h"); // dom
  assert.equal(openStatus(days, "2026-10-06T15:00:00Z").label, "Abre amanhã às 19h"); // ter
});

test("open status: holidays and nights that close after midnight", () => {
  const holiday = resolvedDays("2026-09-28", 14, { "2026-10-01": { open: false, opens_at: null, closes_at: null, reason_label: "Feriado" } });
  assert.deepEqual(openStatus(holiday, "2026-10-01T23:00:00Z"), { open: false, label: "Abre amanhã às 19h", reason: "Feriado" }); // qui 20:00

  const late = resolvedDays("2026-09-28", 14, { "2026-10-02": { closes_at: "01:00" }, "2026-10-01": { closes_at: "00:00" } });
  assert.equal(openStatus(late, "2026-10-02T00:00:00Z").label, "Aberta agora · até 0h"); // qui 21:00, fecha à meia-noite
  assert.equal(openStatus(late, "2026-10-03T03:30:00Z").label, "Aberta agora · até 1h"); // sáb 00:30, ainda sexta
  assert.equal(openStatus(late, "2026-10-03T04:30:00Z").label, "Abre hoje às 19h"); // sáb 01:30
});

test("Argentina: the 15 without the area code, and area codes of 3 and 4 digits", () => {
  assert.equal(toE164("15 1234-5678", "AR"), null);
  assert.equal(formatPhone("+5493757421234"), "+54 9 3757 42-1234"); // Puerto Iguazú
  assert.equal(formatPhone("+5493764123456"), "+54 9 376 412-3456"); // Posadas
  assert.equal(maskPhone("+5493757421234"), "+54 9 3757 ••••-1234");
});

test("names typed on an iPhone keep their apostrophe", () => {
  assert.equal(rules.name("D’Ávila"), null);
  assert.equal(rules.name("Joana d'Arc"), null);
});

test("phones from Brazil, Paraguay and Argentina", () => {
  assert.equal(toE164("(45) 99830-4994"), "+5545998304994");
  assert.equal(toE164("045 99830 4994"), "+5545998304994");
  assert.equal(toE164("+55 45 99830-4994"), "+5545998304994");
  assert.equal(toE164("(45) 3523-1234"), null); // fixo: sem WhatsApp
  assert.equal(toE164("(20) 99830-4994"), null); // DDD 20 não existe
  assert.equal(toE164("0981 123 456", "PY"), "+595981123456");
  assert.equal(toE164("+595 981 123 456"), "+595981123456");
  assert.equal(toE164("11 15 1234-5678", "AR"), "+5491112345678");
  assert.equal(toE164("+54 9 11 1234-5678"), "+5491112345678");
  assert.equal(formatPhone("+5545998304994"), "(45) 99830-4994");
  assert.equal(maskPhone("+5545998304994"), "(45) 9••••-4994");
  assert.equal(maskPhone("+595981123456"), "+595 9•• ••• 456");
  assert.equal(maskPhone("+5491112345678"), "+54 9 11 ••••-5678");
});

test("field rules", () => {
  assert.equal(rules.name("Ana"), null);
  assert.equal(rules.name("José D'Ávila"), null);
  assert.equal(rules.name("A"), t("validation.nameShort"));
  assert.equal(rules.name("veja www.promo.com"), t("validation.noLinks"));
  assert.equal(rules.phone("(45) 99830-4994"), null);
  assert.equal(rules.phone("123"), t("validation.phone"));
  assert.equal(rules.notes("x".repeat(281)), t("validation.notesLong", { max: 280 }));
  assert.equal(rules.partySize(9, 8), t("validation.party", { max: 8 }));
  assert.equal(rules.otp("12345"), t("validation.otp"));
});

test("prices", () => {
  assert.equal(formatPrice(5000), "R$ 50");
  assert.equal(formatPrice(1250), "R$ 12,50");
  assert.equal(formatPrice(null), "a confirmar");
});

test("ids also work where crypto.randomUUID is missing (phone on the local network)", () => {
  const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  assert.match(uuid(), V4);
  Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true });
  try {
    const ids = new Set(Array.from({ length: 50 }, uuid));
    assert.equal(ids.size, 50);
    for (const id of ids) assert.match(id, V4);
  } finally {
    delete globalThis.crypto.randomUUID;
  }
  assert.equal(typeof crypto.randomUUID, "function");
});

// ---- as páginas do cliente (Épico 7) ----

test("Confere?: +54 with the 15 or without the 9, +595 with the 0, other countries refused", () => {
  const ar = phoneCheck("3757 15-12-3456", "AR");
  assert.equal(ar.e164, "+5493757123456");
  assert.equal(ar.corrected, true);
  assert.equal(phoneCheck("3757 12-3456", "AR").corrected, true); // sem o 9
  assert.equal(phoneCheck("+54 3757 12-3456").e164, "+5493757123456");
  assert.equal(phoneCheck("+54 9 3757 12-3456").corrected, false); // já como o WhatsApp quer
  const py = phoneCheck("0983 123456", "PY");
  assert.equal(py.e164, "+595983123456");
  assert.equal(py.corrected, true);
  assert.equal(formatPhone(py.e164), "+595 983 123 456");
  assert.equal(phoneCheck("983 123 456", "PY").corrected, false);
  assert.equal(phoneCheck("(45) 99830-4994").corrected, false); // o Brasil nunca pergunta
  assert.equal(phoneCheck("045 99830 4994").e164, "+5545998304994");
  assert.equal(phoneCheck("+1 415 555 0100").unsupported, true);
  assert.equal(phoneCheck("+34 612 345 678").unsupported, true);
  assert.equal(phoneCheck("0034 612 345 678").unsupported, true);
  assert.equal(phoneCheck("+34 612 345 678").e164, null);
});

test("the house's night turns at 05:00 and the window counts nights", () => {
  // 00:30 de quinta 16/10 em Foz ainda é a noite de quarta
  assert.equal(nightOf("2026-10-16T03:30:00Z"), "2026-10-15");
  assert.equal(nightOf("2026-10-16T08:00:00Z"), "2026-10-16"); // 05:00 em ponto: o dia novo
  assert.equal(nightOfBooking("2026-10-16", "00:30"), "2026-10-15");
  assert.equal(nightOfBooking("2026-10-16", "20:00"), "2026-10-16");
  const days = windowDates("2026-10-15", 30);
  assert.equal(days.length, 30);
  assert.equal(days.at(-1), "2026-11-13"); // hoje + 29 noites
  assert.equal(inWindow("2026-11-13", "2026-10-15", 30), true);
  assert.equal(inWindow("2026-11-14", "2026-10-15", 30), false); // o 31º dia
  assert.equal(inWindow("2026-10-14", "2026-10-15", 30), false);
  assert.equal(inWindow("2026-13-40x", "2026-10-15", 30), false);
});

test("the calendar is weeks of seven, Monday first, never a carousel", () => {
  const weeks = weeksOf(windowDates("2026-10-15", 30)); // uma quinta
  assert.ok(weeks.every((w) => w.length === 7));
  assert.deepEqual(weeks[0].slice(0, 4), [null, null, null, "2026-10-15"]);
  assert.equal(weeks.flat().filter(Boolean).length, 30);
});

test("notes count what the eye sees: emoji, composed accents and line breaks are one each", () => {
  assert.equal(visibleLength("👨‍👩‍👧"), 1);
  assert.equal(visibleLength("é"), 1);
  assert.equal(visibleLength("a\r\nb"), 3);
  assert.equal(notesProblem("x".repeat(280)), null);
  assert.deepEqual(notesProblem("x".repeat(281)), { kind: "long", count: 281, max: 280 });
  assert.equal(notesProblem("🎂".repeat(280)), null);
  assert.equal(notesProblem("veja www.exemplo.com").kind, "link");
});

test("hours in the house's clock, one English format, and a note when the phone is elsewhere", () => {
  assert.equal(clock("20:30", "pt"), "20:30");
  assert.equal(clock("20:30", "en"), "8:30 pm");
  assert.equal(clock("00:30", "en"), "12:30 am");
  assert.equal(houseClock("2026-10-16T21:30:00Z"), "18:30");
  assert.equal(deviceDiffers("2026-10-16T21:30:00Z", "America/Sao_Paulo"), false);
  assert.equal(deviceDiffers("2026-10-16T21:30:00Z", "Asia/Tokyo"), true);
  assert.equal(deviceDiffers("2026-10-16T21:30:00Z", "Europe/Madrid"), true);
});

test("the ready WhatsApp message leaves out what was not filled", () => {
  const full = readyMessage(t, { name: "Rafael Souza", party: 12, day: "sexta, 17/10", time: "20:00" });
  assert.equal(full, "Oi! Meu nome é Rafael. Queria uma mesa para 12 pessoas em sexta, 17/10, às 20:00.");
  assert.equal(readyMessage(t, { party: 12 }), "Oi! Queria uma mesa para 12 pessoas.");
  assert.equal(whatsappUrl("+55 45 99830-4994", "Oi"), "https://wa.me/5545998304994?text=Oi");
});

test("pending: 4 h after the request, from the end of the quiet hours, never past 30 min before", () => {
  const starts = "2026-10-16T23:00:00Z"; // 20:00 em Foz
  assert.equal(pendingDeadline("2026-10-16T15:00:00Z", starts), "2026-10-16T19:00:00.000Z"); // 12:00 + 4 h
  assert.equal(pendingDeadline("2026-10-16T21:00:00Z", starts), "2026-10-16T22:30:00.000Z"); // limitado a 19:30
  assert.equal(pendingDeadline("2026-10-16T05:00:00Z", starts), "2026-10-16T16:00:00.000Z"); // 02:00 → 09:00 + 4 h
});

test("in-app browsers and the calendar file in the house's zone", () => {
  assert.equal(isInAppBrowser("Mozilla/5.0 (iPhone) Instagram 300.0"), true);
  assert.equal(isInAppBrowser("Mozilla/5.0 (Windows NT 10.0) Chrome/130"), false);
  const ics = buildIcs({ code: "TR-1", date: "2026-10-16", time: "00:30", title: "Território", now: "2026-10-15T12:00:00Z" });
  assert.match(ics, /DTSTART;TZID=America\/Sao_Paulo:20261016T003000/);
  assert.match(ics, /DTEND;TZID=America\/Sao_Paulo:20261016T023000/);
  assert.match(ics, /\r\nEND:VCALENDAR/);
});

test("the dietary note is a health-data warning in the three languages", () => {
  assert.equal(
    t("book.dietaryNotice"),
    "Restrição alimentar é um dado de saúde. Só quem atende a sua mesa vê, e apagamos 30 dias depois da visita.",
  );
});

test("prazo de cancelar inclusivo: às 18:00:00 ainda está no prazo da reserva das 20:00 (N7)", () => {
  const deadline = "2026-10-14T18:00:00-03:00";
  assert.equal(pastDeadline(new Date("2026-10-14T17:59:59-03:00"), deadline), false);
  assert.equal(pastDeadline(new Date("2026-10-14T18:00:00-03:00"), deadline), false, "o limite entra");
  assert.equal(pastDeadline(new Date("2026-10-14T18:00:00.900-03:00"), deadline), false, "o segundo inteiro das 18:00:00");
  assert.equal(pastDeadline(new Date("2026-10-14T18:00:01-03:00"), deadline), true);
  assert.equal(pastDeadline("2026-10-14T21:00:00Z", "2026-10-14T18:00:00-03:00"), false, "mesmo instante em outro fuso");
});
