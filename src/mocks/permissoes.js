// A checagem de permissões da simulação (N2, histórias 1.3 e 1.15), como a do servidor: toda chamada
// da equipe é ligada à sua operação em docs/api/permissoes.yaml (montado em
// src/admin/permissoes.json) e respondida com 403 antes da rota da área quando
//   - a operação não está no arquivo (na dúvida, nega): forbidden;
//   - o perfil da sessão não está nos perfis da operação (ou, para uma ação de reserva,
//     nos perfis daquela ação): forbidden;
//   - o dono tirou a área da operação daquele perfil (1.15): forbidden;
//   - a operação é sensível (FR-74) e não houve checagem de identidade nos últimos minutos
//     do acesso do grupo (POST /staff/auth/reauth): reauth_required.
// Roda depois da guarda da sessão (src/mocks/handlers/staff/auth.js), então "ninguém dentro" ainda é
// o 401 daquela guarda. Operações da própria sessão (area null) passam: as rotas delas decidem.
import { http } from "msw";
import { defaultAreas, isSensitive } from "../admin/nav.js";
import PERMISSIONS from "../admin/permissoes.json" with { type: "json" };
import { session } from "../lib/storage.js";
import { getState } from "./db.js";
import { currentSession, mockNow, problem } from "./scenario.js";

const API = "/api/v1";
const REAUTH_KEY = "territorio:mock-reauth";

const OPERATIONS = Object.entries(PERMISSIONS.operations || {}).map(([key, op]) => {
  const [method, path] = key.split(" ");
  // um trecho literal vale mais que um parâmetro (/staff/devices/staff antes de /staff/devices/{id})
  const params = (path.match(/\{/g) || []).length;
  return { key, method, op, params, pattern: new RegExp(`^${path.replace(/\{[^/}]+\}/g, "[^/]+")}$`) };
}).sort((a, b) => a.params - b.params);

/** A operação desta chamada ("PATCH /staff/users/{id}"), ou null quando o arquivo não a tem. */
export function operationOf(method, path) {
  return OPERATIONS.find((o) => o.method === method && o.pattern.test(path)) || null;
}

/** As áreas que o dono deixou abertas para um perfil (1.15); senão o padrão do arquivo. */
function allowedAreas(state, role) {
  const chosen = state.permissions?.[role];
  return Array.isArray(chosen) ? chosen : defaultAreas(role);
}

function identityFresh(state) {
  const minutes = state.settings?.access?.data?.reauth_valid_min ?? 5;
  return Date.now() - Number(session.get(REAUTH_KEY, 0)) < minutes * 60_000;
}

const forbidden = (detail) => problem(403, "forbidden", "Essa parte é de outro perfil da equipe", { detail });

/** A decisão para uma chamada: null deixa passar para a rota da área. */
export async function decide(request) {
  const url = new URL(request.url);
  const path = url.pathname.slice(API.length);
  const found = operationOf(request.method, path);
  if (!found) return forbidden("Essa ação não está nas permissões da casa.");
  const { op, key } = found;
  if (op.area == null) return null;
  const now = mockNow();
  const current = currentSession(now);
  if (!current?.user) return null; // a guarda (ou a tela de bloqueio) já respondeu
  const role = current.role;
  if (!Array.isArray(op.roles) || !op.roles.includes(role)) return forbidden();
  // as ações da reserva têm cada uma seus próprios perfis (reservation.<action>, história 5.5)
  if (op.actions) {
    const action = (await request.clone().json().catch(() => null))?.action;
    const roles = op.actions[action];
    if (Array.isArray(roles) && !roles.includes(role)) return forbidden("Essa ação é do dono ou do gerente.");
  }
  const state = getState(now);
  if (role !== "owner") {
    const allowed = new Set(allowedAreas(state, role));
    if (![op.area, ...(op.also || [])].some((a) => allowed.has(a))) return forbidden("O dono não liberou essa área para o seu perfil.");
  }
  if (op.sensitive || op.sensitive_fields) {
    let body = null;
    if (op.sensitive_fields) body = await request.clone().json().catch(() => null);
    if (isSensitive(key, body) && !identityFresh(state)) {
      return problem(403, "reauth_required", "Confirme que é você", { detail: "Essa ação pede a senha e o código de novo." });
    }
  }
  return null;
}

/** Vem logo depois da guarda da sessão, antes das rotas de toda área. */
export const permissionsGuard = http.all(`${API}/staff/*`, async ({ request }) => (await decide(request)) || undefined);
