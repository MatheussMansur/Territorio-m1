// As partes ao vivo do site público (Épico 4): "Hoje na casa" e "Aberto agora" contados no
// fuso da casa, o aviso que acaba depois do build, o formato de hora de cada idioma,
// o lint de conteúdo, o JSON-LD da página de evento e os ícones.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { eventPage, jsonLd } from "../../scripts/seo/seo.js";
import { iconProblems } from "../../scripts/site/icons.js";
import { missingSiteKeys } from "../../scripts/site/vite-plugin-pages.js";
import { lintContent, lintText } from "../../src/site/lint.js";
import { openLine, todayLine, weekDays } from "../../src/site/live/house-day.js";
import { translator } from "../../src/site/render.js";
import { formatTime } from "../../src/site/time.js";

const house = JSON.parse(readFileSync(new URL("../../src/content/house.json", import.meta.url), "utf8"));
const events = JSON.parse(readFileSync(new URL("../../src/content/events.json", import.meta.url), "utf8"));
const pt = translator("pt");
const es = translator("es");
const en = translator("en");

test("um formato de hora por língua, guardado no catálogo", () => {
  assert.equal(formatTime("19:00", pt), "19h");
  assert.equal(formatTime("23:30", pt), "23h30");
  assert.equal(formatTime("19:00", es), "19 h");
  assert.equal(formatTime("20:30", en), "8:30 pm");
  assert.equal(formatTime("19:00", en), "7:00 pm");
});

test("aberto agora: a madrugada pertence ao dia que abriu, e a próxima abertura de verdade", () => {
  const days = [
    { date: "2026-10-13", open: false },
    { date: "2026-10-14", open: true, opens_at: "19:00", closes_at: "01:00" },
    { date: "2026-10-15", open: false, reason: "holiday" },
    { date: "2026-10-16", open: true, opens_at: "19:00", closes_at: "23:30" },
  ];
  assert.deepEqual(openLine(days, new Date("2026-10-15T00:30:00-03:00"), pt), { open: true, text: "Aberto agora · até 1h" });
  assert.equal(openLine(days, new Date("2026-10-15T12:00:00-03:00"), en).text, "Opens tomorrow at 7:00 pm");
  assert.equal(openLine(days, new Date("2026-10-14T12:00:00-03:00"), es).text, "Abre hoy a las 19 h");
});

test("aviso que venceu depois do build não aparece: a validade é comparada com a hora de Foz", () => {
  const notice = { text: { pt: "Feriado: abrimos às 18h." }, starts_at: "2026-10-10T00:00:00-03:00", ends_at: "2026-10-12T00:00:00-03:00" };
  const days = weekDays(house.hours, "2026-10-11");
  const inside = todayLine({ notices: [notice], days, instant: new Date("2026-10-11T22:00:00-03:00"), t: pt, locale: "pt" });
  assert.deepEqual(inside, { kind: "notice", text: "Feriado: abrimos às 18h." });
  // 23:30 em Foz no dia 11 já é dia 12 em UTC: ainda dentro, contado em Foz
  assert.equal(todayLine({ notices: [notice], days, instant: new Date("2026-10-12T02:30:00Z"), t: pt, locale: "pt" }).kind, "notice");
  const after = todayLine({ notices: [notice], rules: { 3: { pt: "Quarta é dia de ramen." } }, days: weekDays(house.hours, "2026-10-14"), instant: new Date("2026-10-14T15:00:00-03:00"), t: pt, locale: "pt" });
  assert.deepEqual(after, { kind: "rule", text: "Quarta é dia de ramen." });
});

test("dia fechado: o motivo na língua da página e a próxima abertura", () => {
  const days = weekDays(house.hours, "2026-10-19");
  const line = todayLine({ days, instant: new Date("2026-10-19T12:00:00-03:00"), t: es, locale: "es" });
  assert.equal(line.kind, "closed");
  assert.match(line.text, /^Hoy la casa no abre: producción\. Abre el miércoles a las 19 h\.$/);
});

test("lint de conteúdo: palavras da casa e emoji, inteiras e sem acento", () => {
  assert.match(lintText("Peixe na brasa"), /brasa/);
  assert.match(lintText("Uma EXPERIÊNCIA"), /experiência/);
  assert.match(lintText("Hora a confirmar"), /a confirmar/);
  assert.equal(lintText("Frango abrasado"), null);
  assert.match(lintText("Bom demais 🍣"), /emoji/);
  // o conteúdo do build passa (as falas do dono ficam como ele disse)
  const read = (f) => JSON.parse(readFileSync(new URL(`../../src/content/${f}`, import.meta.url), "utf8"));
  assert.deepEqual(lintContent({ content: read("content.json"), menu: read("menu.json"), events: read("events.json") }), []);
});

test("página de evento: JSON-LD Event com data no fuso da casa, festa fechada fora da busca", () => {
  const seo = { locales: ["pt", "es", "en"], default_locale: "pt", pages: [], private_prefixes: ["/admin/"], noindex_prefixes: [] };
  const page = eventPage(events, "/eventos/noite-do-peixe/");
  assert.equal(page.kind, "event");
  const graph = jsonLd({ house, seo, page, locale: "en", site: "https://exemplo.com.br" })["@graph"];
  const node = graph.find((n) => n["@type"] === "Event");
  assert.equal(node.name, "Fish night");
  assert.equal(node.startDate, "2026-10-22T19:30:00-03:00");
  assert.equal(node.location["@id"], "https://exemplo.com.br/#restaurante");
  const party = eventPage(events, "/eventos/festa-fechada-31-10/");
  assert.equal(party.index, false);
  assert.equal(jsonLd({ house, seo, page: party, locale: "pt", site: "https://exemplo.com.br" })["@graph"].find((n) => n["@type"] === "Event").endDate, "2026-11-01T01:00:00-03:00");
  assert.equal(eventPage(events, "/eventos/nao-existe/"), null);
});

test("ícones e textos do site completos para o build", () => {
  const root = new URL("../..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
  assert.deepEqual(iconProblems(root), []);
  assert.deepEqual(missingSiteKeys(root), []);
});
