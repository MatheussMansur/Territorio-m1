// Os pontos fixos da casa num layout (história 3.13, FR-86): bar, cozinha, caixa, entrada,
// banheiros, palco ou DJ, pilar, escada, ou outro ponto com nome. Têm lugar e
// tamanho como uma mesa, em quadrados de 0,5 m na grade, mas sem lugares: nunca se juntam, nunca contam na
// capacidade e nunca recebem reserva. O editor, o Salão ao vivo e a folha da noite os desenham
// a partir daqui, com um ícone pequeno e o nome, num tom neutro separado das mesas.
import { html, svg } from "../../../lib/html.js";

/** Tipo, palavra na tela e o tamanho com que um ponto novo começa (quadrados de 0,5 m). */
export const KINDS = [
  { kind: "bar", label: "Bar", size: [20, 4] },
  { kind: "kitchen", label: "Cozinha", size: [16, 10] },
  { kind: "cashier", label: "Caixa", size: [5, 4] },
  { kind: "entrance", label: "Entrada", size: [8, 3] },
  { kind: "toilet", label: "Banheiro", size: [6, 6] },
  { kind: "stage", label: "Palco ou DJ", size: [12, 8] },
  { kind: "pillar", label: "Pilar", size: [2, 2] },
  { kind: "stairs", label: "Escada", size: [6, 8] },
  { kind: "other", label: "Outro", size: [6, 6] },
];
const BY_KIND = Object.fromEntries(KINDS.map((k) => [k.kind, k]));

export const kindLabel = (kind) => BY_KIND[kind]?.label || "Ponto";
export const kindSize = (kind) => BY_KIND[kind]?.size || [6, 6];
/** O nome na planta: o que a casa escreveu, ou a palavra do tipo. */
export const fixtureName = (f) => String(f?.name || "").trim() || kindLabel(f?.kind);

/** Quadrados que uma mesa ocupa na grade, pelo formato (um quadrado = 0,5 m). */
export const TABLE_SIZE = { square: [6, 6], round: [6, 6], stool: [4, 4], long: [16, 5] };
export const tableSize = (t) => TABLE_SIZE[t.shape] || TABLE_SIZE.square;

/**
 * Dados iniciais antigos colocavam as mesas por coluna e linha (0–3); espalhe-as na grade uma vez, do mesmo jeito no
 * editor, no Salão e na folha da noite.
 */
export function placeLegacy(tables) {
  const legacy = tables.length && tables.every((t) => t.x <= 3 && t.y <= 3);
  if (!legacy) return tables;
  const perArea = {};
  return tables.map((t) => {
    const n = (perArea[t.area] = (perArea[t.area] ?? -1) + 1);
    return { ...t, x: 2 + (n % 6) * 10, y: 3 + Math.floor(n / 6) * 9 };
  });
}

/** O retângulo de uma mesa ou de um ponto, em quadrados. */
export const rectOf = (item) => {
  const [w, h] = item.w ? [item.w, item.h] : tableSize(item);
  return { x1: item.x, y1: item.y, x2: item.x + w, y2: item.y + h };
};
export const overlaps = (a, b) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

// ícones de linha 16 × 16, desenhados com a cor do texto para acompanhar o tema
const PATHS = {
  bar: svg`<path d="M3 3h10L8 9zM8 9v4M5 13.5h6" />`,
  kitchen: svg`<path d="M3 7h10v5.5H3zM1.5 7h13M6 3.5v1.5M10 3.5v1.5" />`,
  cashier: svg`<path d="M2 8h12v5.5H2zM4.5 3.5h5V8M10.5 10.5h1.5" />`,
  entrance: svg`<path d="M9 2.5h4.5v11H9M2 8h7M6 5l3 3-3 3" />`,
  toilet: svg`<circle cx="5" cy="3.5" r="1.3" /><circle cx="11" cy="3.5" r="1.3" /><path d="M5 6v7.5M3 7.5h4M11 6l-2 5h4zM10.2 11v2.5M11.8 11v2.5" />`,
  stage: svg`<path d="M6 12V3.5l7-1.5v9" /><circle cx="4.5" cy="12" r="1.5" /><circle cx="11.5" cy="11" r="1.5" />`,
  pillar: svg`<path d="M4 2.5h8M4 13.5h8M5.5 2.5v11M10.5 2.5v11" />`,
  stairs: svg`<path d="M2 13.5h3v-3h3v-3h3v-3h3V2" />`,
  other: svg`<path d="M8 14s4.5-4.2 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 9.8 8 14 8 14z" /><circle cx="8" cy="6.5" r="1.5" />`,
};

/** O ícone de um tipo; só enfeita, o nome sempre vai junto. */
export const fixtureIcon = (kind) =>
  html`<svg class="ponto-icone" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square">${PATHS[kind] || PATHS.other}</svg>`;

// ---- a planta da noite (Salão e a folha da noite) ------------------------------------------

/** Pixels por quadrado na planta do Salão: uma mesa 6 × 6 é o nó de 96 px da planta. */
export const MAP_CELL = 16;

const px = (n) => `${Math.round(n)}px`;

/** Onde uma peça fica num mapa de `cell` pixels por quadrado (mesas compridas mantêm o comprimento). */
export function placeOn(item, cell = MAP_CELL, sized = false) {
  const [w, h] = item.w ? [item.w, item.h] : tableSize(item);
  const size = sized || item.w ? `;width:${px(w * cell)};height:${px(h * cell)}` : item.shape === "long" ? `;width:${px(w * cell)}` : "";
  return `left:${px(item.x * cell)};top:${px(item.y * cell)}${size}`;
}

/** Um ponto fixo num mapa: ícone e nome, neutro, sem ação; lido como "ponto fixo". */
export const fixtureMark = (f, cell = MAP_CELL) => {
  const name = fixtureName(f);
  return html`<div class="ponto-fixo" style=${placeOn(f, cell)} role="img" aria-label=${`${name}, ponto fixo`} data-ponto=${f.id}>
    ${fixtureIcon(f.kind)}<span class="ponto-fixo__nome">${name}</span>
  </div>`;
};

/** Os pontos fixos de uma área como referências numa linha (a lista do celular, uma área no modo lista). */
export const fixtureRefs = (area) =>
  area.fixtures?.length
    ? html`<ul class="pontos-ref" aria-label=${`Pontos fixos de ${area.name}`}>
        ${area.fixtures.map((f) => html`<li>${fixtureIcon(f.kind)}<span>${fixtureName(f)}</span><span class="sr-only">, ponto fixo</span></li>`)}
      </ul>`
    : "";

/**
 * Uma área da noite desenhada onde o layout coloca cada peça: os pontos fixos primeiro, abaixo das
 * mesas, cada mesa desenhada por `tableNode(table, style)`. `extra` é o espaço (px) para o que um nó
 * mostra além dos seus quadrados.
 */
export function floorMap(area, tableNode, { cell = MAP_CELL, extra = 112, label = `Planta de ${area.name}` } = {}) {
  const width = Math.max(area.cols * cell, ...area.tables.map((t) => t.x * cell + extra), ...area.fixtures.map((f) => (f.x + f.w) * cell));
  const height = Math.max(area.rows * cell, ...area.tables.map((t) => t.y * cell + extra), ...area.fixtures.map((f) => (f.y + f.h) * cell));
  return html`<div class="mapa" tabindex="0" role="region" aria-label=${label}>
    <div class="mapa__quadro" style=${`width:${px(width)};height:${px(height)};--celula:${cell}px`}>
      ${area.fixtures.map((f) => fixtureMark(f, cell))}${area.tables.map((t) => tableNode(t, placeOn(t, cell)))}
    </div>
  </div>`;
}
