// Dados da demonstração das plantas: uma planta de "casa cheia" com junções longas no quintal, e uma
// planta antiga já arquivada, para a lista mostrar toda situação. Toda área diz como funciona
// por padrão e toda área de uma planta tem seu tamanho (32 m × 13 m, a grade padrão). As
// mesas ganham seu lugar na grade (quadrados de 0,5 m), as juntadas lado a lado, e
// cada planta ganha os pontos fixos da casa (história 3.13): o bar com as banquetas, a
// cozinha e o caixa ao lado, a entrada, os banheiros e a figueira do quintal.
import { uuid } from "../../lib/uuid.js";

const PLACES = {
  S1: [2, 3], S2: [12, 3], S3: [22, 3], S4: [28, 3], S5: [40, 3], S6: [50, 3],
  Q1: [2, 3], Q2: [10, 3], Q3: [24, 3], Q6: [30, 3], Q4: [44, 3], Q5: [52, 3], Q7: [2, 14], Q8: [10, 14], QC: [24, 10],
  B1: [4, 3], B2: [10, 3], B3: [16, 3], B4: [22, 3], B5: [28, 3], B6: [34, 3],
};

const FIXTURES = [
  { kind: "bar", name: "Bar", area: "balcao", x: 2, y: 9, w: 38, h: 4 },
  { kind: "cashier", name: "Caixa", area: "balcao", x: 44, y: 9, w: 5, h: 4 },
  { kind: "kitchen", name: "Cozinha", area: "balcao", x: 2, y: 15, w: 24, h: 9 },
  { kind: "entrance", name: "Entrada", area: "salao", x: 26, y: 22, w: 12, h: 3 },
  { kind: "toilet", name: "Banheiros", area: "salao", x: 54, y: 15, w: 8, h: 8 },
  { kind: "other", name: "Figueira", area: "quintal", x: 18, y: 13, w: 6, h: 6 },
];

/** Posiciona as mesas dos dados iniciais (coluna e linha 0–3) e coloca os pontos fixos da casa. */
function furnish(layout) {
  if (layout.tables.every((t) => t.x <= 3 && t.y <= 3)) {
    for (const t of layout.tables) [t.x, t.y] = PLACES[t.code] || [t.x, t.y];
  }
  const areas = new Set(layout.areas.map((a) => a.key));
  layout.fixtures ??= FIXTURES.filter((f) => areas.has(f.area)).map((f) => ({ id: uuid(), ...f }));
}

export function extend(state) {
  const standard = state.layouts[0];
  if (!standard) return;
  const copy = (layout) => JSON.parse(JSON.stringify(layout));
  state.layouts.forEach(furnish);

  const full = copy(standard);
  full.id = uuid();
  full.name = "Casa cheia";
  full.description = "Para sexta e sábado lotados: o quintal ganha junções para grupos grandes e o balcão entra na reserva online.";
  full.tables = full.tables.map((t) => (t.area === "balcao" ? { ...t, bookable_online: true } : t));
  full.combos = [
    { codes: ["S3", "S4"], max_seats: null, label: null },
    { codes: ["Q1", "Q2"], max_seats: null, label: "Mesa da figueira" },
    { codes: ["Q3", "Q6"], max_seats: 12, label: "Mesa comprida" },
    { codes: ["Q4", "Q5"], max_seats: null, label: null },
  ];

  const old = copy(standard);
  old.id = uuid();
  old.name = "Inverno 2026";
  old.description = "Usada em junho e julho, com o quintal coberto.";
  old.archived = true;

  state.layouts.push(full, old);

  for (const area of state.areas) {
    area.default_mode ??= "tables";
    area.default_list_capacity ??= null;
  }
  for (const layout of state.layouts) {
    for (const area of layout.areas) {
      area.width_m ??= 32;
      area.depth_m ??= 13;
    }
  }
}
