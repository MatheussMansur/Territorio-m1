// Dois turnos por dia no site (história 2.8): o horário da semana, o "Aberto agora" entre os
// turnos, o "Hoje na casa", o JSON-LD e o llms.txt; e o mapa fixo de "Onde fica" (história 4.5).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { jsonLd, llmsTxt } from "../../scripts/seo/seo.js";
import { hoursSummary, shiftsOf, shiftsText } from "../../src/site/hours.js";
import { openLine, todayLine, weekDays } from "../../src/site/live/house-day.js";
import { home, mapFits } from "../../src/site/pages/home.js";
import { translator } from "../../src/site/render.js";

const read = (file) => JSON.parse(readFileSync(new URL(`../../src/content/${file}`, import.meta.url), "utf8"));
const house = read("house.json");
const seo = read("seo.json");
const map = read("map.json");
const pt = translator("pt");
const es = translator("es");
const en = translator("en");
const SITE = "https://territoriofoz.com.br";

// o sábado com almoço (12:00–15:00) além da noite
const LUNCH = { opens_at: "12:00", closes_at: "15:00" };
const twoShifts = { ...house, hours: house.hours.map((d) => (d.weekday === 6 ? { ...d, second_shift: LUNCH } : d)) };

test("os turnos do dia vêm em ordem, e só de dia aberto", () => {
  assert.deepEqual(shiftsOf({ open: true, opens_at: "19:00", closes_at: "23:30", second_shift: LUNCH }), [LUNCH, { opens_at: "19:00", closes_at: "23:30" }]);
  assert.deepEqual(shiftsOf({ open: true, opens_at: "19:00", closes_at: "23:30", second_shift: null }), [{ opens_at: "19:00", closes_at: "23:30" }]);
  assert.deepEqual(shiftsOf({ open: false, second_shift: LUNCH }), []);
  assert.deepEqual(shiftsOf(undefined), []);
  assert.equal(shiftsText(shiftsOf({ open: true, opens_at: "19:00", closes_at: "23:30", second_shift: LUNCH }), pt), "12h–15h e 19h–23h30");
  assert.equal(shiftsText(shiftsOf({ open: true, opens_at: "19:00", closes_at: "23:30", second_shift: LUNCH }), es), "12 h–15 h y 19 h–23:30 h");
  assert.equal(shiftsText(shiftsOf({ open: true, opens_at: "19:00", closes_at: "23:30", second_shift: LUNCH }), en), "12:00 pm–3:00 pm and 7:00 pm–11:30 pm");
});

test("a semana numa linha: um turno igual ao de antes, e os dias com dois turnos à parte", () => {
  assert.equal(hoursSummary(house.hours, pt), "quarta – sábado · 19h–23h30");
  assert.equal(hoursSummary(twoShifts.hours, pt), "quarta – sexta · 19h–23h30; sábado · 12h–15h e 19h–23h30");
  assert.equal(hoursSummary(twoShifts.hours, en), "Wednesday – Friday · 7:00 pm–11:30 pm; Saturday · 12:00 pm–3:00 pm and 7:00 pm–11:30 pm");
});

test("aberto agora com dois turnos: no almoço, no intervalo, antes e na noite", () => {
  const days = weekDays(twoShifts.hours, "2026-10-17");
  const at = (time, t = pt) => openLine(days, new Date(`2026-10-17T${time}:00-03:00`), t);
  assert.deepEqual(at("10:00"), { open: false, text: "Abre hoje às 12h" });
  assert.deepEqual(at("13:00"), { open: true, text: "Aberto agora · até 15h" });
  assert.deepEqual(at("16:00"), { open: false, text: "Fechado agora · abre de novo às 19h" });
  assert.deepEqual(at("16:00", es), { open: false, text: "Cerrado ahora · abre de nuevo a las 19 h" });
  assert.deepEqual(at("16:00", en), { open: false, text: "Closed now · opens again at 7:00 pm" });
  assert.deepEqual(at("21:00"), { open: true, text: "Aberto agora · até 23h30" });
  assert.equal(at("23:45").text, "Abre quarta às 19h");
});

test("o segundo turno depois de uma noite que passa da meia-noite: a madrugada conta da véspera", () => {
  const days = [
    { date: "2026-10-16", open: true, opens_at: "19:00", closes_at: "01:00" },
    { date: "2026-10-17", open: true, opens_at: "19:00", closes_at: "23:30", second_shift: LUNCH },
  ];
  assert.deepEqual(openLine(days, new Date("2026-10-17T00:30:00-03:00"), pt), { open: true, text: "Aberto agora · até 1h" });
  // a madrugada acabou, o almoço ainda não começou: não é "abre de novo"
  assert.equal(openLine(days, new Date("2026-10-17T09:00:00-03:00"), pt).text, "Abre hoje às 12h");
});

test("próxima abertura e hoje na casa usam o primeiro turno do dia", () => {
  const days = weekDays(twoShifts.hours, "2026-10-16");
  assert.equal(openLine(days, new Date("2026-10-16T23:50:00-03:00"), pt).text, "Abre amanhã às 12h");
  const line = todayLine({ days: weekDays(twoShifts.hours, "2026-10-17"), instant: new Date("2026-10-17T09:00:00-03:00"), t: pt, locale: "pt" });
  assert.deepEqual(line, { kind: "open", text: "Hoje tem casa aberta em dois turnos: 12h–15h e 19h–23h30." });
  const one = todayLine({ days: weekDays(house.hours, "2026-10-17"), instant: new Date("2026-10-17T09:00:00-03:00"), t: en, locale: "en" });
  assert.deepEqual(one, { kind: "open", text: "We're open tonight from 7:00 pm." });
});

test("JSON-LD e llms.txt: um horário por turno", () => {
  const r = jsonLd({ house: twoShifts, seo, page: seo.pages[0], locale: "pt", site: SITE })["@graph"][1];
  const saturday = r.openingHoursSpecification.filter((h) => h.dayOfWeek === "https://schema.org/Saturday");
  assert.deepEqual(saturday.map((h) => [h.opens, h.closes]), [["12:00", "15:00"], ["19:00", "23:30"]]);
  assert.equal(r.openingHoursSpecification.length, 5);
  assert.match(llmsTxt({ house: twoShifts, seo, site: SITE }), /sexta 19:00–23:30; sábado 12:00–15:00 e 19:00–23:30/);
});

test("a página impressa no build (também no modo sem API) mostra os dois turnos", () => {
  const content = read("content.json");
  const menu = read("menu.json");
  const events = read("events.json");
  const page = home({ house: twoShifts, content, menu, events, locale: "pt", t: pt });
  const body = String(page.body);
  assert.match(body, /<li><b>Sáb<\/b>12h–15h e 19h–23h30<\/li>/);
  assert.match(body, /quarta – sexta · 19h–23h30; sábado · 12h–15h e 19h–23h30/);
  // o "Hoje na casa" decide de novo no navegador com os dois turnos
  const data = JSON.parse(body.match(/<script type="application\/json" id="hoje-dados">(.*?)<\/script>/s)[1]);
  assert.deepEqual(data.hours.find((d) => d.weekday === 6).second_shift, LUNCH);
});

test("o mapa fixo: arquivos no site, feito para o ponto da casa, fora do ar se a casa mudar", () => {
  for (const w of map.widths) {
    for (const ext of ["avif", "webp", "png"]) assert.ok(existsSync(new URL(`../../public/img/mapa/mapa-${w}.${ext}`, import.meta.url)), `mapa-${w}.${ext}`);
  }
  assert.ok(mapFits(house.address));
  assert.equal(mapFits({ ...house.address, coords_confirmed: false }), false);
  assert.equal(mapFits({ ...house.address, lat: -25.5 }), false);
  const body = String(home({ house, content: read("content.json"), menu: read("menu.json"), events: read("events.json"), locale: "es", t: es }).body);
  assert.match(body, /<img class="mapa" src="\/img\/mapa\/mapa-768\.png"[^>]*width="768" height="480" alt="Mapa de las calles alrededor de la casa, con el pin en Rua Sérgio Roncato, 703/);
  assert.match(body, /<a href="https:\/\/www\.openstreetmap\.org\/copyright" rel="noopener">© colaboradores de OpenStreetMap<\/a>/);
  assert.doesNotMatch(body, /tile\.openstreetmap\.org/);
});
