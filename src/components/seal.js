// O círculo de 24 sementes das capas de destaque da casa: grãos em forma de milho em volta de um
// pequeno miolo de 12 lados, numa cor só. Medido das capas, não redesenhado.
import { html, render, svg } from "../lib/html.js";
import { CORE, GRAIN, ROTATIONS } from "../lib/seal-geometry.js";

/** O selo como template do lit; ele pega a cor do texto. */
export const sealTemplate = () =>
  html`<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
    <g transform="translate(50 50)">
      ${ROTATIONS.map((r) => svg`<path d=${GRAIN} fill="currentColor" transform=${`rotate(${r})`}></path>`)}
      <polygon points=${CORE} fill="currentColor"></polygon>
    </g>
  </svg>`;

/** SVG puro, para arquivos (máscara, favicon) gerados no build. */
export function sealSVG(fill = "currentColor") {
  const paths = ROTATIONS.map((r) => `<path d="${GRAIN}" fill="${fill}" transform="rotate(${r})"/>`).join("");
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><g transform="translate(50 50)">${paths}<polygon points="${CORE}" fill="${fill}"/></g></svg>`;
}

/** Preenche todo elemento `.seal` vazio dentro de `root` com o desenho. */
export function mountSeals(root = document) {
  for (const el of root.querySelectorAll(".seal:empty")) render(sealTemplate(), el);
}
