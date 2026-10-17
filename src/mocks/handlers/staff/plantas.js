// Plantas e áreas. Uma planta em uso é mudada pela simulação das noites que a
// usam; arquivar é recusado enquanto um dia da semana ou uma data futura ainda a usa. A casa
// cria suas próprias áreas (uma tenda de evento, um terraço); uma área só sai da casa quando nenhuma planta
// a usa. Cada área de uma planta tem seu próprio tamanho em metros (um quadrado da grade = 0,5 m).
import { http, HttpResponse } from "msw";
import { uuid } from "../../../lib/uuid.js";
import { getState, save } from "../../db.js";
import { mockNow, problem, respond } from "../../scenario.js";
import {
  applyChange,
  audit,
  conflictFor,
  datesUsingLayout,
  ifMatchOf,
  networkDown,
  invalid,
  mustStop,
  nightOf,
  otherPerson,
  otherSavesFirst,
  preconditionFailed,
  readJson,
  simulateChange,
  staffName,
  withReservations,
} from "./agenda.js";

const API = "/api/v1";
const MODES = ["tables", "list", "closed"];
const SHAPES = ["square", "round", "stool", "long"];
const clone = (value) => JSON.parse(JSON.stringify(value));
const SIZE_MIN = 2;
const SIZE_MAX = 100;
const DEFAULT_SIZE = { width_m: 32, depth_m: 13 };
const sizeOk = (n) => typeof n === "number" && n >= SIZE_MIN && n <= SIZE_MAX && Number.isInteger(n * 2);
// os pontos fixos da casa (história 3.13): sem lugares, nunca reservados, nunca juntados
const FIXTURE_WORD = { bar: "Bar", kitchen: "Cozinha", cashier: "Caixa", entrance: "Entrada", toilet: "Banheiro", stage: "Palco ou DJ", pillar: "Pilar", stairs: "Escada", other: "" };
const FIXTURE_MAX = 200;

/** "Tenda do evento" -> "tenda-do-evento", único entre as áreas da casa. */
function keyFor(state, name) {
  const base =
    String(name)
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "area";
  let key = base;
  for (let n = 2; state.areas.some((a) => a.key === key); n++) key = `${base}-${n}`;
  return key;
}

/** As plantas (arquivadas também) que têm uma área. */
const layoutsUsing = (state, key) => state.layouts.filter((l) => l.areas.some((a) => a.key === key)).map((l) => ({ id: l.id, name: l.name, archived: Boolean(l.archived) }));

const areaOut = (state, area) => ({ default_mode: "tables", default_list_capacity: null, ...area, used_by: layoutsUsing(state, area.key) });

/** A área como uma planta começa com ela: como a casa disse que ela funciona por padrão, no tamanho padrão. */
const layoutAreaFrom = (area) => ({
  key: area.key,
  mode: area.default_mode || "tables",
  list_capacity: area.default_mode === "list" ? area.default_list_capacity || null : null,
  bookable_online: area.default_mode !== "closed",
  ...DEFAULT_SIZE,
});

/** Onde uma planta é usada: dias da semana padrão e datas futuras com plano ou evento próprio. */
function usedBy(state, layout, now) {
  const today = nightOf(now);
  const weekdays = state.hours.filter((h) => h.open && h.layout_id === layout.id).map((h) => h.weekday);
  const fromPlans = Object.entries(state.day_plans || {}).filter(([d, p]) => d >= today && p.layout_id === layout.id).map(([d]) => d);
  const fromEvents = state.events.filter((e) => e.published && e.date >= today && e.layout_id === layout.id).map((e) => e.date);
  return { weekdays, dates: [...new Set([...fromPlans, ...fromEvents])].sort() };
}

function layoutOut(state, layout, now = mockNow()) {
  const seats = layout.tables.reduce((n, t) => n + (layout.areas.find((a) => a.key === t.area)?.mode === "tables" ? t.max_seats : 0), 0);
  const lists = layout.areas.reduce((n, a) => n + (a.mode === "list" ? a.list_capacity || 0 : 0), 0);
  const names = new Map(state.areas.map((a) => [a.key, a.name]));
  // o nome da área é só leitura aqui (é da casa); o tamanho volta para o padrão
  const areas = layout.areas.map((a) => ({ ...DEFAULT_SIZE, ...clone(a), name: names.get(a.key) || a.key }));
  return { ...clone(layout), areas, fixtures: clone(layout.fixtures || []), seats_total: seats + lists, used_by: usedBy(state, layout, now), version: layout.version || "v1" };
}

/** Confere uma planta como o servidor conferiria; os nomes dos campos apontam a linha da lista de mesas. */
function check(state, body) {
  const errors = [];
  if (!String(body.name || "").trim()) errors.push({ field: "name", message: "Dê um nome à planta." });
  const known = new Set(state.areas.map((a) => a.key));
  const inLayout = new Set();
  (body.areas || []).forEach((a, i) => {
    if (!known.has(a.key)) errors.push({ field: `areas.${i}`, message: "Essa área não existe mais na casa." });
    else if (inLayout.has(a.key)) errors.push({ field: `areas.${i}`, message: "Essa área já está nesta planta." });
    inLayout.add(a.key);
    if (!sizeOk(a.width_m)) errors.push({ field: `areas.${i}.width_m`, message: `A largura vai de ${SIZE_MIN} a ${SIZE_MAX} m.` });
    if (!sizeOk(a.depth_m)) errors.push({ field: `areas.${i}.depth_m`, message: `O fundo vai de ${SIZE_MIN} a ${SIZE_MAX} m.` });
  });
  if (!inLayout.size) errors.push({ field: "areas", message: "A planta precisa de pelo menos uma área." });
  const tables = Array.isArray(body.tables) ? body.tables : [];
  const seen = new Map();
  tables.forEach((t, i) => {
    const code = String(t.code || "").trim().toUpperCase();
    if (!code) errors.push({ field: `tables.${i}.code`, message: "Dê um código à mesa." });
    else if (seen.has(code)) errors.push({ field: `tables.${i}.code`, message: `Já existe uma mesa ${code} nesta planta.` });
    seen.set(code, i);
    if (!inLayout.has(t.area)) errors.push({ field: `tables.${i}.area`, message: "Escolha a área." });
    if (!(Number.isInteger(t.min_seats) && t.min_seats >= 1)) errors.push({ field: `tables.${i}.min_seats`, message: "Pelo menos 1 lugar." });
    if (!(Number.isInteger(t.max_seats) && t.max_seats >= 1)) errors.push({ field: `tables.${i}.max_seats`, message: "Pelo menos 1 lugar." });
    else if (t.min_seats > t.max_seats) errors.push({ field: `tables.${i}.min_seats`, message: "O mínimo passa do máximo." });
    if (t.shape && !SHAPES.includes(t.shape)) errors.push({ field: `tables.${i}.shape`, message: "Forma desconhecida." });
  });
  (body.fixtures || []).forEach((f, i) => {
    if (!Object.hasOwn(FIXTURE_WORD, f.kind)) errors.push({ field: `fixtures.${i}.kind`, message: "Escolha o tipo do ponto." });
    if (!f.name) errors.push({ field: `fixtures.${i}.name`, message: "Dê um nome ao ponto." });
    else if (f.name.length > 40) errors.push({ field: `fixtures.${i}.name`, message: "Até 40 letras." });
    if (!inLayout.has(f.area)) errors.push({ field: `fixtures.${i}.area`, message: "Escolha a área." });
    if (!(Number.isInteger(f.w) && f.w >= 1 && f.w <= FIXTURE_MAX)) errors.push({ field: `fixtures.${i}.w`, message: "A largura vai de 0,5 a 100 m." });
    if (!(Number.isInteger(f.h) && f.h >= 1 && f.h <= FIXTURE_MAX)) errors.push({ field: `fixtures.${i}.h`, message: "O fundo vai de 0,5 a 100 m." });
  });
  (body.areas || []).forEach((a, i) => {
    if (!MODES.includes(a.mode)) errors.push({ field: `areas.${i}.mode`, message: "Escolha como a área funciona." });
    if (a.mode === "list" && !(Number.isInteger(a.list_capacity) && a.list_capacity > 0)) errors.push({ field: `areas.${i}.list_capacity`, message: "Em lista, diga quantas pessoas cabem." });
  });
  (body.combos || []).forEach((c, i) => {
    if (!Array.isArray(c.codes) || c.codes.length < 2 || c.codes.some((code) => !seen.has(String(code).toUpperCase()))) {
      errors.push({ field: `combos.${i}`, message: "A junção precisa de 2 mesas desta planta." });
    }
    const min = c.min_seats ?? null;
    const max = c.max_seats ?? null;
    if (min != null && !(Number.isInteger(min) && min >= 1)) errors.push({ field: `combos.${i}.min_seats`, message: "Pelo menos 1 lugar." });
    if (max != null && !(Number.isInteger(max) && max >= 1)) errors.push({ field: `combos.${i}.max_seats`, message: "Pelo menos 1 lugar." });
    else if (min != null && max != null && min > max) errors.push({ field: `combos.${i}.min_seats`, message: "O mínimo da junção passa do máximo." });
  });
  return errors;
}

function normalized(body, base = {}) {
  const areas = (body.areas || base.areas || []).map((a) => ({
    key: a.key,
    mode: a.mode,
    list_capacity: a.mode === "list" ? a.list_capacity : null,
    bookable_online: a.bookable_online !== false,
    width_m: a.width_m == null ? DEFAULT_SIZE.width_m : Number(a.width_m),
    depth_m: a.depth_m == null ? DEFAULT_SIZE.depth_m : Number(a.depth_m),
  }));
  return {
    ...base,
    name: String(body.name ?? base.name ?? "").trim(),
    description: String(body.description ?? base.description ?? ""),
    archived: body.archived ?? base.archived ?? false,
    areas,
    tables: (body.tables ?? base.tables ?? []).map((t) => ({
      code: String(t.code).trim().toUpperCase(),
      area: t.area,
      min_seats: t.min_seats,
      max_seats: t.max_seats,
      shape: t.shape || "square",
      x: Number(t.x) || 0,
      y: Number(t.y) || 0,
      bookable_online: t.bookable_online !== false,
      priority: Number.isInteger(t.priority) ? t.priority : 1,
    })),
    combos: (body.combos ?? base.combos ?? []).map((c) => ({ codes: c.codes.map((x) => String(x).toUpperCase()), min_seats: c.min_seats ?? null, max_seats: c.max_seats ?? null, label: c.label || null })),
    fixtures: (body.fixtures ?? base.fixtures ?? []).map((f) => ({
      id: f.id ? String(f.id) : uuid(),
      kind: f.kind,
      name: String(f.name ?? "").trim() || FIXTURE_WORD[f.kind] || "",
      area: f.area,
      x: Math.max(0, Math.round(Number(f.x) || 0)),
      y: Math.max(0, Math.round(Number(f.y) || 0)),
      w: Number(f.w),
      h: Number(f.h),
    })),
  };
}

const notFound = () => problem(404, "not_found", "Essa planta não existe mais");

const MODE_WORD = { tables: "mesas", list: "lista", closed: "fechada" };
/** Uma planta em palavras, para o antes e depois do registro de ações. */
const forLog = (l) =>
  l && {
    name: l.name,
    description: l.description || "",
    mesas: l.tables.map((t) => `${t.code} (${t.min_seats}–${t.max_seats}${t.bookable_online ? "" : ", fora do site"})`).join(", "),
    juncoes: (l.combos || []).map((c) => `${c.codes.join("+")}${c.min_seats || c.max_seats ? ` (${c.min_seats ?? 1}–${c.max_seats ?? "soma"})` : ""}`).join(", "),
    areas: l.areas.map((a) => `${a.key}: ${MODE_WORD[a.mode] || a.mode}${a.mode === "list" ? ` ${a.list_capacity}` : ""}, ${a.width_m ?? DEFAULT_SIZE.width_m} × ${a.depth_m ?? DEFAULT_SIZE.depth_m} m`).join(", "),
    pontos: (l.fixtures || []).map((f) => f.name).join(", "),
    archived: Boolean(l.archived),
  };

/** "Nesses dias não há mesa para reserva online": uma planta de dia da semana sem nada para reservar no site. */
function warnings(state, layout) {
  const used = state.hours.some((h) => h.open && h.layout_id === layout.id);
  const bookable = layout.tables.some((t) => t.bookable_online && layout.areas.find((a) => a.key === t.area && a.mode === "tables" && a.bookable_online));
  const list = layout.areas.some((a) => a.mode === "list" && a.bookable_online);
  return used && !bookable && !list ? ["Nesses dias não há mesa para reserva online."] : [];
}

/** Confere uma área nova ou uma mudança numa área; `id` é a área sendo mudada. */
function checkArea(state, body, id = null) {
  const errors = [];
  if (body.name !== undefined) {
    const name = String(body.name || "").trim();
    if (!name) errors.push({ field: "name", message: "Dê um nome à área." });
    else if (state.areas.some((a) => a.id !== id && a.name.toLowerCase() === name.toLowerCase())) errors.push({ field: "name", message: "Já existe uma área com esse nome." });
  }
  if (body.default_mode !== undefined && !MODES.includes(body.default_mode)) errors.push({ field: "default_mode", message: "Escolha como a área funciona." });
  if (body.default_mode === "list" && !(Number.isInteger(body.default_list_capacity) && body.default_list_capacity > 0)) {
    errors.push({ field: "default_list_capacity", message: "Em lista, diga quantas pessoas cabem." });
  }
  return errors;
}

export const handlers = [
  http.get(`${API}/staff/areas`, () =>
    networkDown() ? HttpResponse.error() : respond(() => {
      const state = getState(mockNow());
      return HttpResponse.json([...state.areas].sort((a, b) => a.sort - b.sort).map((a) => areaOut(state, a)));
    }),
  ),

  // a casa cria suas próprias áreas
  http.post(`${API}/staff/areas`, async ({ request }) => {
    const body = await readJson(request);
    return respond(() => {
      const state = getState(mockNow());
      const errors = checkArea(state, { default_mode: "tables", ...body, name: body.name ?? "" });
      if (errors.length) return invalid(errors);
      const mode = body.default_mode || "tables";
      const area = {
        id: uuid(),
        key: keyFor(state, body.name),
        name: String(body.name).trim(),
        sort: Math.max(0, ...state.areas.map((a) => a.sort || 0)) + 1,
        default_mode: mode,
        default_list_capacity: mode === "list" ? body.default_list_capacity : null,
      };
      state.areas.push(area);
      audit(state, "area.create", area.name, null, { name: area.name, modo: MODE_WORD[mode] });
      save();
      return HttpResponse.json(areaOut(state, area), { status: 201 });
    });
  }),

  // recusado enquanto uma planta (arquivada também) ainda tem a área
  http.delete(`${API}/staff/areas/:id`, ({ params }) =>
    respond(() => {
      const state = getState(mockNow());
      const area = state.areas.find((a) => a.id === params.id);
      if (!area) return problem(404, "not_found", "Essa área não existe");
      const used = layoutsUsing(state, area.key);
      if (used.length) {
        return problem(409, "conflict", "Essa área está em uso", { code: "area_in_use", detail: "Tire a área dessas plantas antes de apagar.", used_by: used });
      }
      state.areas = state.areas.filter((a) => a.id !== area.id);
      audit(state, "area.delete", area.name, { name: area.name }, null);
      save();
      return new HttpResponse(null, { status: 204 });
    }),
  ),

  http.patch(`${API}/staff/areas/:id`, async ({ request, params }) => {
    const body = await readJson(request);
    return respond(() => {
      const state = getState(mockNow());
      const area = state.areas.find((a) => a.id === params.id);
      if (!area) return problem(404, "not_found", "Essa área não existe");
      const errors = checkArea(state, body, area.id);
      if (errors.length) return invalid(errors);
      const before = { ...area };
      if (body.name !== undefined) area.name = String(body.name).trim();
      if (Number.isInteger(body.sort)) area.sort = body.sort;
      if (body.default_mode !== undefined) {
        area.default_mode = body.default_mode;
        area.default_list_capacity = body.default_mode === "list" ? body.default_list_capacity : null;
      }
      audit(state, "area.update", area.key, before, { ...area });
      save();
      return HttpResponse.json(areaOut(state, area));
    });
  }),

  http.get(`${API}/staff/layouts`, () =>
    networkDown() ? HttpResponse.error() : respond((scenario) => {
      const now = mockNow();
      const state = getState(now);
      return HttpResponse.json(scenario === "vazio" ? [] : state.layouts.map((l) => layoutOut(state, l, now)));
    }),
  ),

  http.post(`${API}/staff/layouts`, async ({ request }) => {
    const body = await readJson(request);
    return respond(() => {
      const state = getState(mockNow());
      // as áreas escolhidas começam como a casa disse que funcionam; sem nenhuma, todas as áreas da casa
      const chosen = body.areas?.length ? body.areas : state.areas;
      const areas = chosen.map((a) => {
        const house = state.areas.find((x) => x.key === a.key);
        return house ? { ...layoutAreaFrom(house), ...(a === house ? {} : a) } : a;
      });
      const layout = { id: uuid(), ...normalized({ tables: [], combos: [], fixtures: [], ...body, areas }), archived: false, version: "v1" };
      const errors = check(state, layout);
      if (errors.length) return invalid(errors);
      state.layouts.push(layout);
      audit(state, "layout.create", layout.name, null, forLog(layout));
      save();
      return HttpResponse.json(layoutOut(state, layout), { status: 201 });
    });
  }),

  http.get(`${API}/staff/layouts/:id`, ({ params }) =>
    networkDown() ? HttpResponse.error() : respond(() => {
      const state = getState(mockNow());
      const layout = state.layouts.find((l) => l.id === params.id);
      return layout ? HttpResponse.json(layoutOut(state, layout)) : notFound();
    }),
  ),

  http.patch(`${API}/staff/layouts/:id`, async ({ request, params }) => {
    const body = await readJson(request);
    return respond(() => {
      const now = mockNow();
      const state = getState(now);
      const current = state.layouts.find((l) => l.id === params.id);
      if (!current) return notFound();
      const next = normalized(body, current);
      const errors = check(state, next);
      if (errors.length) return invalid(errors);
      const dry = new URL(request.url).searchParams.get("dry_run") === "true";
      const ifMatch = ifMatchOf(request);
      if (!dry && ifMatch != null) {
        // a outra pessoa da demonstração renomeia a descrição um minuto antes
        if (otherSavesFirst()) {
          current.description = `${current.description || ""} (revisada)`.trim();
          current.version = `v${(Date.now() - 1).toString(36)}`;
          current.updated_by = otherPerson(state);
          save();
        }
        if ((current.version || "v1") !== ifMatch) return preconditionFailed(current.updated_by || otherPerson(state), layoutOut(state, current, now));
      }
      const version = `v${Date.now().toString(36)}`;
      const change = (s) => {
        const i = s.layouts.findIndex((l) => l.id === current.id);
        s.layouts[i] = { ...clone(next), id: current.id, version, updated_by: staffName(s) };
      };
      const dates = withReservations(state, datesUsingLayout(state, current.id, now));
      const resolutions = Array.isArray(body.resolutions) ? body.resolutions : [];
      const sim = simulateChange(state, dates, change, resolutions);
      const affected = sim.results.filter((r) => r.moved.length || r.without_table.length);
      const result = (applied, byDate, layout) => ({ applied, layout: layoutOut(state, layout), by_date: byDate, simulation_hash: `sim-${dates.length}`, warnings: warnings(state, layout) });
      if (dry) return HttpResponse.json(result(false, sim.results.filter((r) => r.moved.length || r.without_table.length || r.seated?.length), { ...next, id: current.id }));
      if (sim.seated.length) return conflictFor(sim, true);
      if (mustStop(sim, body.confirm_conflicts)) {
        return problem(409, "conflict", `${sim.open.length} reservas ficariam sem mesa`, { code: "unassigned", ...result(false, affected, { ...next, id: current.id }) });
      }
      const before = clone(current);
      const applied = applyChange(state, dates, change, resolutions, now).filter((r) => r.moved.length || r.without_table.length);
      const saved = state.layouts.find((l) => l.id === current.id);
      audit(state, "layout.update", saved.name, forLog(before), forLog(saved), resolutions);
      save();
      return HttpResponse.json(result(true, applied, saved));
    });
  }),

  http.delete(`${API}/staff/layouts/:id`, ({ params }) =>
    respond(() => {
      const now = mockNow();
      const state = getState(now);
      const layout = state.layouts.find((l) => l.id === params.id);
      if (!layout) return notFound();
      const used = usedBy(state, layout, now);
      if (used.weekdays.length || used.dates.length) {
        return problem(409, "conflict", "Essa planta está em uso", { code: "layout_in_use", detail: "Ela é a planta de algum dia que vem aí. Troque a planta desses dias antes de arquivar.", used_by: used });
      }
      layout.archived = true;
      audit(state, "layout.archive", layout.name, { archived: false }, { archived: true });
      save();
      return new HttpResponse(null, { status: 204 });
    }),
  ),

  http.post(`${API}/staff/layouts/:id/duplicate`, async ({ request, params }) => {
    const body = await readJson(request);
    return respond(() => {
      const state = getState(mockNow());
      const source = state.layouts.find((l) => l.id === params.id);
      if (!source) return notFound();
      const copy = { ...clone(source), id: uuid(), name: String(body.name || "").trim() || `${source.name} (cópia)`, archived: false, version: "v1" };
      state.layouts.push(copy);
      audit(state, "layout.duplicate", copy.name, null, { from: source.name });
      save();
      return HttpResponse.json(layoutOut(state, copy), { status: 201 });
    });
  }),
];
