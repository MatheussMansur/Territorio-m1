// O círculo de 24 sementes das capas de destaque da casa, medido das capas: um
// grão em forma de milho repetido a cada 15 graus em volta de um pequeno miolo de 12 lados. Usado pelo
// selo do lit (telas) e pelas páginas impressas.
export const GRAIN =
  "M-1.45,-31 Q0,-30.2 1.45,-31 C3.3,-33 3.85,-37 3.85,-39.4 C3.85,-41.4 2.9,-42.3 0,-42.3 " +
  "C-2.9,-42.3 -3.85,-41.4 -3.85,-39.4 C-3.85,-37 -3.3,-33 -1.45,-31 Z";
export const ROTATIONS = Array.from({ length: 24 }, (_, i) => i * 15);
export const CORE = Array.from({ length: 12 }, (_, i) => {
  const a = ((i * 30 + 15) * Math.PI) / 180;
  const r = 6 * (1 + (i % 3 === 1 ? 0.04 : i % 4 === 2 ? -0.035 : 0));
  return `${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`;
}).join(" ");
