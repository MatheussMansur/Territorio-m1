// A casa muda as mesas por dia, por procura e para eventos. Estes testes usam os dados
// da demonstração (feitos para quarta 30/09/2026, meio-dia em Foz) e conferem cada tipo de mudança.
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyDayPlan, dayAvailability, freeOptions, planDayChange, resolveDay, tableOptions } from "../../src/mocks/availability.js";
import { buildSeeds } from "../../src/mocks/seeds.js";

const NOW = new Date("2026-09-30T15:00:00Z"); // quarta, 12:00 em Foz
const WED = "2026-09-30"; // a noite do fluxo aprovado
const THU = "2026-10-01";

function fresh() {
  const state = buildSeeds(NOW);
  const layout = (name) => state.layouts.find((l) => l.name.startsWith(name));
  return { state, standard: layout("Padrão"), rain: layout("Sem quintal"), backyard: layout("Evento no quintal") };
}
const codes = (options) => options.map((o) => o.codes.join("+"));
const slot = (day, time) => day.slots.find((s) => s.time === time);

test("sem plano do dia, vale a semana padrão com a planta Padrão", () => {
  const { state } = fresh();
  const day = resolveDay(state, WED);
  assert.equal(day.source, "week");
  assert.equal(day.layout.name, "Padrão");
  assert.equal(day.open, true);
  assert.equal(resolveDay(state, "2026-10-05").open, false); // segunda: produção
});

test("noite de chuva: a planta sem quintal tira as mesas de fora", () => {
  const { state, rain } = fresh();
  const before = codes(tableOptions(resolveDay(state, THU), 6));
  assert.ok(before.includes("Q3") && before.includes("Q6"));
  state.day_plans[THU] = { date: THU, layout_id: rain.id };
  const after = codes(tableOptions(resolveDay(state, THU), 6));
  assert.deepEqual(after, ["S3+S4"]); // só a junção do salão serve 6
});

test("mesas guardadas para quem chega sem reserva saem do site, mas a equipe usa", () => {
  const { state } = fresh();
  state.day_plans[THU] = { date: THU, held_tables: ["S5", "S6"] };
  const day = resolveDay(state, THU);
  assert.ok(!codes(freeOptions(state, day, "20:00", 2)).some((c) => c === "S5" || c === "S6"));
  assert.ok(codes(freeOptions(state, day, "20:00", 2, { online: false })).includes("S6"));
});

test("limite de pessoas chegando no mesmo horário (ritmo da cozinha)", () => {
  const { state } = fresh();
  state.day_plans[THU] = { date: THU, max_covers_per_slot: 6 }; // Pedro já chega às 20:00 com 4
  assert.equal(slot(dayAvailability(state, THU, 4, NOW), "20:00").state, "full");
  assert.notEqual(slot(dayAvailability(state, THU, 2, NOW), "20:00").state, "full");
});

test("dia fechado pelo plano do dia, com o motivo para o site", () => {
  const { state } = fresh();
  state.day_plans[THU] = { date: THU, open: false, closed_reason: "holiday", public_label: "Feriado" };
  const day = dayAvailability(state, THU, 2, NOW);
  assert.equal(day.open, false);
  assert.equal(day.reason, "holiday");
  assert.equal(day.reason_label, "Feriado");
});

test("evento misto: mesas no salão e lista por pessoa no quintal", () => {
  const { state } = fresh();
  const event = state.events[0];
  event.published = true;
  let day = dayAvailability(state, event.date, 8, NOW);
  assert.equal(day.event.title, "Forró no quintal");
  assert.equal(day.list.capacity, 40);
  assert.equal(day.list.state, "available");
  assert.deepEqual(day.list.entry_times, ["20:00", "21:00"]);
  assert.ok(day.areas.some((a) => a.key === "quintal" && a.mode === "list"));
  assert.ok(day.slots.length > 0); // o salão continua com horário de mesa

  state.reservations.push({ id: "x", date: event.date, time: "20:00", party_size: 35, status: "confirmed", area_key: "quintal", table_codes: [] });
  day = dayAvailability(state, event.date, 8, NOW);
  assert.equal(day.list.remaining, 5);
  assert.equal(day.list.state, "full");
  assert.equal(dayAvailability(state, event.date, 5, NOW).list.state, "few_left");
});

test("evento fechado some do site como 'Evento fechado'", () => {
  const { state } = fresh();
  const event = state.events[0];
  event.published = true;
  event.booking_mode = "private";
  const day = dayAvailability(state, event.date, 2, NOW);
  assert.equal(day.open, false);
  assert.equal(day.reason_label, "Evento fechado");
});

test("trocar a planta de uma noite cheia: simula antes, mostra quem muda e quem fica sem mesa", () => {
  const { state, rain } = fresh();
  const result = planDayChange(state, WED, { date: WED, layout_id: rain.id });
  const quintal = ["Q1", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8"];
  const fromQuintal = [...result.moved, ...result.without_table].filter((r) => r.from.some((c) => quintal.includes(c)));
  assert.equal(fromQuintal.length, 7); // todas as reservas do quintal precisam de outro lugar
  assert.ok(result.kept.some((r) => r.from.includes("S1"))); // Carla continua na S1
  assert.ok(result.without_table.length > 0);
  assert.ok(result.seats_after < result.seats_before);
  assert.equal(state.day_plans[WED], undefined); // simulação não grava nada

  const refused = applyDayPlan(state, WED, { date: WED, layout_id: rain.id }, { now: NOW });
  assert.equal(refused.applied, false);
  const confirmed = applyDayPlan(state, WED, { date: WED, layout_id: rain.id }, { confirmConflicts: true, now: NOW });
  assert.equal(confirmed.applied, true);
  assert.equal(resolveDay(state, WED).layout.name, "Sem quintal (chuva)");
});

test("virar noite de evento com reservas no quintal: elas entram na lista do evento", () => {
  const { state, backyard } = fresh();
  const result = planDayChange(state, WED, { date: WED, layout_id: backyard.id });
  const toList = result.moved.filter((r) => r.to_list === "quintal");
  assert.equal(toList.length, 7); // as 7 reservas do quintal, 26 pessoas, cabem nas 40 da lista
  assert.equal(result.without_table.length, 0);
  assert.ok(result.kept.some((r) => r.from.join("+") === "S3+S4")); // Renata segue na mesa juntada
});

test("plano de um evento ainda em rascunho não muda a noite", () => {
  const { state, backyard } = fresh();
  const event = state.events[0];
  state.day_plans[event.date] = { date: event.date, layout_id: backyard.id, event_id: event.id };
  assert.equal(resolveDay(state, event.date).layout.name, "Padrão");
  event.published = true;
  assert.equal(resolveDay(state, event.date).layout.name, "Evento no quintal (modelo)");
});

test("evento de entrada livre aparece sem reserva", () => {
  const { state } = fresh();
  const event = state.events[0];
  event.published = true;
  event.booking_mode = "none";
  const day = dayAvailability(state, event.date, 2, NOW);
  assert.equal(day.state, "no_booking");
  assert.equal(day.event.title, "Forró no quintal");
});

test("planta com mais lugares avisa a lista de espera na hora", () => {
  const { state, standard } = fresh();
  const camila = state.reservations.find((r) => r.status === "waitlisted"); // 2 pessoas às 20:00
  const bigger = structuredClone(standard);
  bigger.id = "casa-cheia";
  bigger.name = "Casa cheia";
  bigger.tables.push({ code: "Q9", area: "quintal", min_seats: 1, max_seats: 2, shape: "round", x: 0, y: 3, bookable_online: true, priority: 1 });
  state.layouts.push(bigger);

  const result = applyDayPlan(state, WED, { date: WED, layout_id: "casa-cheia" }, { now: NOW });
  assert.equal(result.applied, true);
  assert.equal(result.waitlist_offers, 1);
  assert.equal(camila.status, "offered");
  assert.deepEqual(camila.table_codes, ["Q9"]);
  assert.ok(new Date(camila.offer_expires_at) > NOW);
});

function withExtraTable(state, standard) {
  const bigger = structuredClone(standard);
  bigger.id = "casa-cheia";
  bigger.name = "Casa cheia";
  bigger.tables.push({ code: "Q9", area: "quintal", min_seats: 1, max_seats: 2, shape: "round", x: 0, y: 3, bookable_online: true, priority: 1 });
  state.layouts.push(bigger);
  return bigger.id;
}

test("a realocação usa o tempo de mesa que cada reserva já tinha", () => {
  const { state, rain } = fresh();
  state.reservations.push({ id: "y", code: "TR-Y", date: THU, time: "21:00", party_size: 4, status: "confirmed", table_codes: ["S1"], area_key: "salao", duration_min: 120 });
  const result = planDayChange(state, THU, { date: THU, layout_id: rain.id, duration_min: 60 });
  const pedro = result.moved.find((r) => r.from.includes("Q2")); // 4 pessoas às 20:00, por 2 horas
  assert.deepEqual(pedro.to, ["S2"]); // a S1 tem outra reserva às 21:00
});

test("não fecha um dia que tem reservas, nem oferece mesa nele", () => {
  const { state } = fresh();
  const result = applyDayPlan(state, WED, { date: WED, open: false, closed_reason: "holiday" }, { confirmConflicts: true, now: NOW });
  assert.equal(result.applied, false);
  assert.equal(result.blocked, "day_has_reservations");
  assert.equal(state.day_plans[WED], undefined);
  assert.ok(state.reservations.some((r) => r.status === "waitlisted"));
});

test("a lista de espera só recebe oferta antes do horário e dentro do limite da noite", () => {
  const late = fresh();
  const lateResult = applyDayPlan(late.state, WED, { date: WED, layout_id: withExtraTable(late.state, late.standard) }, { now: new Date("2026-10-01T01:00:00Z") }); // 22:00
  assert.equal(lateResult.waitlist_offers, 0);

  const full = fresh();
  const plan = { date: WED, layout_id: withExtraTable(full.state, full.standard), max_covers_night: 52 }; // a noite já tem 52 pessoas
  assert.equal(applyDayPlan(full.state, WED, plan, { now: NOW }).waitlist_offers, 0);
});

test("o limite de pessoas do dia vale no site", () => {
  const { state } = fresh();
  state.day_plans[THU] = { date: THU, party_max_online: 4 };
  const day = dayAvailability(state, THU, 6, NOW);
  assert.equal(day.party_too_large, true);
  assert.equal(day.party_max_online, 4);
  assert.ok(day.slots.every((s) => s.state === "full" && !s.waitlist_open));
});

test("os combinados do dia saem com o tempo de mesa do plano", () => {
  const { state } = fresh();
  state.day_plans[THU] = { date: THU, duration_min: 90 };
  const day = dayAvailability(state, THU, 2, NOW);
  assert.equal(day.duration_min, 90);
  assert.equal(day.tolerance_min, 20);
  assert.equal(day.cancel_until_hours, 2);
});

test("na lista do evento, o limite por horário também vale", () => {
  const { state } = fresh();
  const event = state.events[0];
  event.published = true;
  state.day_plans[event.date] = { date: event.date, max_covers_per_slot: 10, event_id: event.id };
  state.reservations.push({ id: "l", date: event.date, time: "20:00", party_size: 8, status: "confirmed", area_key: "quintal", table_codes: [] });
  const day = dayAvailability(state, event.date, 8, NOW);
  assert.deepEqual(day.list.entry_times, ["21:00"]);
  assert.equal(slot(day, "20:00").state, "full");
});

test("uma junção só continua se a planta nova também junta essas mesas", () => {
  const { state, standard } = fresh();
  const noJoin = structuredClone(standard);
  noJoin.id = "sem-juncao";
  noJoin.combos = [];
  state.layouts.push(noJoin);
  const result = planDayChange(state, WED, { date: WED, layout_id: "sem-juncao" });
  assert.ok(!result.kept.some((r) => r.from.join("+") === "S3+S4"));
  assert.ok(result.without_table.some((r) => r.from.join("+") === "S3+S4")); // 8 pessoas e nenhuma mesa serve
});

test("junta mesas quando as do tamanho certo estão ocupadas", () => {
  const { state } = fresh();
  state.reservations.push({ id: "q6", date: THU, time: "20:00", party_size: 6, status: "confirmed", area_key: "quintal", table_codes: ["Q6"], duration_min: 120 });
  const day = resolveDay(state, THU);
  assert.deepEqual(codes(freeOptions(state, day, "20:30", 6)), ["S3+S4"]); // Q3 e Q6 ocupadas
  assert.equal(slot(dayAvailability(state, THU, 6, NOW), "20:30").state, "few_left");
});

test("área em lista fora do site não aparece na reserva", () => {
  const { state, backyard } = fresh();
  backyard.areas.find((a) => a.key === "quintal").bookable_online = false;
  const event = state.events[0];
  event.published = true;
  const day = dayAvailability(state, event.date, 2, NOW);
  assert.equal(day.list, null);
  assert.ok(!day.areas.some((a) => a.key === "quintal"));
});

test("o motivo do evento fechado vem da ficha do evento, nas três línguas", () => {
  const { state } = fresh();
  const event = state.events[0];
  Object.assign(event, { published: true, booking_mode: "private", private_label: { pt: "Casamento da Ana", es: "Boda de Ana", en: "" } });
  const day = dayAvailability(state, event.date, 2, NOW);
  assert.equal(day.reason_label, "Casamento da Ana");
  assert.deepEqual(day.reason_labels, { pt: "Casamento da Ana", es: "Boda de Ana", en: "Casamento da Ana" });
  event.private_label = "Festa da firma"; // dado antigo: um texto simples ainda funciona
  assert.equal(resolveDay(state, event.date).reason_labels.es, "Festa da firma");
});

test("o motivo do plano do dia também vale em espanhol e inglês", () => {
  const { state } = fresh();
  state.day_plans[THU] = { date: THU, open: false, closed_reason: "holiday", public_label: { pt: "Feriado municipal", es: "Feriado municipal", en: "Local holiday" } };
  assert.equal(dayAvailability(state, THU, 2, NOW).reason_labels.en, "Local holiday");
});

test("planta sem mesa online: nenhum horário e nenhuma espera, e não é lotado", () => {
  const { state, standard } = fresh();
  standard.tables.forEach((t) => (t.bookable_online = false));
  const day = dayAvailability(state, THU, 2, NOW);
  assert.equal(day.open, true);
  assert.equal(day.state, "no_booking");
  assert.equal(day.reason, "no_online_tables");
  assert.deepEqual(day.slots, []);
  assert.equal(day.waitlist_open, false);
  assert.notEqual(day.state, "full");
});

test("junção com mínimo próprio: pelo site só pega grupo desse tamanho", () => {
  const { state, standard } = fresh();
  const day = resolveDay(state, THU);
  const join = standard.combos.find((c) => c.codes.join("+") === "S3+S4");
  join.min_seats = 7;
  assert.ok(!codes(tableOptions(day, 6)).includes("S3+S4"));
  assert.ok(codes(tableOptions(day, 6, { online: false })).includes("S3+S4") || codes(tableOptions(day, 6, { online: false })).length > 0);
});

test("evento misto: o limite das mesas fecha os horários, a lista segue", () => {
  const { state } = fresh();
  const event = state.events[0];
  Object.assign(event, { published: true, booking_mode: "mixed", tables_limit: 4 });
  state.reservations.push({ id: "m", date: event.date, time: "20:00", party_size: 4, status: "confirmed", area_key: "salao", table_codes: ["S1"], duration_min: 120 });
  const day = dayAvailability(state, event.date, 2, NOW);
  assert.ok(day.slots.every((s) => s.state === "full" || s.state === "past"));
});

test("mesa sentada numa mesa que sai da planta aparece na prévia", () => {
  const { state, rain } = fresh();
  const r = state.reservations.find((x) => x.date === WED && x.table_codes?.some((c) => c.startsWith("Q")));
  state.table_sessions = [{ id: "s1", reservation_id: r.id, status: "open", table_codes: [...r.table_codes], people: r.party_size, seated_at: "2026-09-30T23:00:00Z" }];
  const result = planDayChange(state, WED, { date: WED, layout_id: rain.id });
  assert.equal(result.seated.length, 1);
  assert.deepEqual(result.seated[0].table_codes, r.table_codes);
});

test("cada caso sem mesa traz as mesas livres por horário para remarcar", () => {
  const { state, rain } = fresh();
  const result = planDayChange(state, WED, { date: WED, layout_id: rain.id });
  const row = result.without_table[0];
  assert.ok(row.options && typeof row.options === "object");
  assert.ok(Object.keys(row.options).length > 0);
});

test("fila do horário cheia (10) deixa o horário só lotado; os outros horários seguem com espera (N11)", () => {
  const { state } = fresh();
  state.booking.waitlist_enabled = true;
  const day = resolveDay(state, THU);
  state.day_plans[THU] = { date: THU, held_tables: day.layout.tables.map((t) => t.code) }; // nada sobra para o site
  const before = dayAvailability(state, THU, 2, NOW);
  const time = before.slots.find((s) => s.state === "full").time;
  assert.equal(before.slots.find((s) => s.time === time).waitlist_open, true);
  for (let i = 0; i < 10; i++) {
    state.reservations.push({ id: `fila-${i}`, date: THU, time, party_size: 2, status: "waitlisted", table_codes: [], waitlist_position: i + 1 });
  }
  const after = dayAvailability(state, THU, 2, NOW);
  assert.equal(after.slots.find((s) => s.time === time).waitlist_open, false, "a fila cheia vira só lotado");
  assert.ok(after.slots.some((s) => s.time !== time && s.waitlist_open), "os outros horários ainda têm espera");
  state.settings = { ...(state.settings || {}), waitlist: { data: { max_per_slot: 12 } } };
  assert.equal(dayAvailability(state, THU, 2, NOW).slots.find((s) => s.time === time).waitlist_open, true, "o limite vem da configuração");
});
