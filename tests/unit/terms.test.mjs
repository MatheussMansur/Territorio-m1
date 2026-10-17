// Os termos levam os números das configurações: mudar uma configuração muda o texto.
import assert from "node:assert/strict";
import { test } from "node:test";
import content from "../../src/content/content.json" with { type: "json" };
import house from "../../src/content/house.json" with { type: "json" };
import { addClock, fillTerms } from "../../src/lib/terms.js";

test("os combinados trocam os marcadores pelos números da configuração", () => {
  const rules = { tolerance_min: 15, extra_tolerance_min: 5, cancel_until_hours: 3, no_shows_for_confirmation: 2 };
  assert.equal(fillTerms("{tolerancia} min, +{extra}, {prazo} h, {faltas} faltas", rules), "15 min, +5, 3 h, 2 faltas");
  assert.equal(fillTerms("{desconhecido}", rules), "{desconhecido}");
});

test("todo combinado, nas três línguas, fica sem marcador com as regras da casa", () => {
  for (const term of content.terms) {
    for (const l of ["pt", "es", "en"]) {
      for (const part of [term.title[l], term.text[l]]) assert.doesNotMatch(fillTerms(part, house.booking_rules), /\{\w+\}/, part);
    }
  }
});

test("horário mais minutos, passando da meia-noite", () => {
  assert.equal(addClock("20:00", 30), "20:30");
  assert.equal(addClock("23:50", 20), "00:10");
});
