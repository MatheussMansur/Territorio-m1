// Pontos fixos da casa numa planta (história 3.13): já vêm em toda planta, ficam na grade,
// e nunca entram nas mesas, nas junções, na capacidade nem na disponibilidade.
import assert from "node:assert/strict";
import { test } from "node:test";
import { dayAvailability, resolveDay, tableOptions } from "../../src/mocks/availability.js";
import { buildSeeds } from "../../src/mocks/seeds.js";
import { extend } from "../../src/mocks/seeds/plantas.js";
import { overlaps, placeLegacy, rectOf } from "../../src/admin/areas/plantas/pontos.js";

const NOW = new Date("2026-09-30T15:00:00Z"); // quarta, 12:00 em Foz
const WED = "2026-09-30";

function seeded() {
  const state = buildSeeds(NOW);
  extend(state, NOW);
  return state;
}

test("toda planta ganha os pontos da casa, cada um numa área dela", () => {
  const state = seeded();
  for (const layout of state.layouts) {
    const areas = new Set(layout.areas.map((a) => a.key));
    assert.ok(layout.fixtures.length > 0, layout.name);
    for (const f of layout.fixtures) {
      assert.ok(areas.has(f.area), `${layout.name}: ${f.name}`);
      assert.ok(f.id && f.kind && f.name && f.w >= 1 && f.h >= 1);
    }
  }
  const standard = state.layouts.find((l) => l.name === "Padrão");
  assert.deepEqual(standard.fixtures.map((f) => f.kind).sort(), ["bar", "cashier", "entrance", "kitchen", "other", "toilet"]);
});

test("os pontos não ficam em cima das mesas na planta Padrão", () => {
  const standard = seeded().layouts.find((l) => l.name === "Padrão");
  for (const f of standard.fixtures) {
    for (const t of standard.tables.filter((x) => x.area === f.area)) assert.equal(overlaps(rectOf(f), rectOf(t)), false, `${f.name} × ${t.code}`);
  }
});

test("os pontos não mudam a capacidade nem as opções de mesa", () => {
  const withPoints = seeded();
  const without = seeded();
  for (const l of without.layouts) l.fixtures = [];
  const a = dayAvailability(withPoints, WED);
  const b = dayAvailability(without, WED);
  assert.deepEqual(a, b);
  const day = resolveDay(withPoints, WED);
  const ids = new Set(day.layout.fixtures.map((f) => f.id));
  const options = tableOptions(day, 4);
  assert.ok(options.length > 0);
  for (const o of options) assert.ok(o.codes.every((c) => !ids.has(c)));
});

test("mesas da semente antiga (coluna e linha 0 a 3) se espalham pela grade", () => {
  const spread = placeLegacy([
    { code: "A", area: "x", x: 0, y: 0 },
    { code: "B", area: "x", x: 1, y: 0 },
  ]);
  assert.deepEqual(spread.map((t) => [t.x, t.y]), [[2, 3], [12, 3]]);
  const placed = [{ code: "A", area: "x", x: 20, y: 5 }];
  assert.equal(placeLegacy(placed), placed);
});
