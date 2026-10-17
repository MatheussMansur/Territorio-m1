// ROTAS_REAIS (história 4.1, AR-12): enquanto o servidor está sendo feito, desenvolvimento e homologação
// rodam com a simulação ligada, e as operações listadas aqui vão para o servidor real em vez disso (o
// cliente marca essas operações para a simulação deixar passar; o servidor de desenvolvimento repassa /api para o servidor).
// Começa vazia. Cada história dos Épicos 8 a 11 acrescenta suas operações como "METHOD /path" com o
// caminho do próprio contrato ("GET /house", "POST /staff/reservations/{id}/actions"); a história 11.11
// confere que ela cobre toda operação do contrato e a remove antes de as reservas de verdade abrirem.
// O build de produção recusa uma lista que não esteja vazia (vite.config.js, e um teste unitário).

/** @type {string[]} */
export const ROTAS_REAIS = [];

const templates = new Map();

function matcher(operation) {
  if (!templates.has(operation)) {
    const [method, path = ""] = String(operation).trim().split(/\s+/);
    const pattern = new RegExp(`^${path.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[^/}]+\}/g, "[^/]+")}$`);
    templates.set(operation, { method: method.toUpperCase(), pattern });
  }
  return templates.get(operation);
}

/** Se esta chamada vai para o servidor real (caminho sem /api/v1 e sem a query). */
export function isRealRoute(method, path, list = ROTAS_REAIS) {
  const clean = String(path).split("?")[0];
  return list.some((operation) => {
    const { method: m, pattern } = matcher(operation);
    return m === String(method).toUpperCase() && pattern.test(clean);
  });
}

/** O build de produção não tem simulação, então uma lista de rotas reais ali é um erro esquecido. */
export function refuseInProduction(mode, list = ROTAS_REAIS) {
  if (mode === "production" && list.length) {
    throw new Error(`Build de produção com ROTAS_REAIS (${list.length}). A lista só vale com a simulação ligada; tire-a antes de publicar.`);
  }
}
