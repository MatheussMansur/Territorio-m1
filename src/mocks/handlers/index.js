import { permissionsGuard } from "../permissoes.js";
import { customerHandlers } from "./customer.js";
import { publicHandlers } from "./public.js";
import { staffHandlers } from "./staff.js";

// Cada área do painel guarda suas rotas no próprio arquivo, src/mocks/handlers/staff/<area>.js,
// exportando `handlers`; elas se juntam aqui sem ninguém editar esta lista. A checagem de permissões
// (src/mocks/permissoes.js, a partir de docs/api/permissoes.yaml) roda depois da guarda da sessão e
// antes de toda área, como o middleware do servidor.
const areaHandlers = Object.values(import.meta.glob("./staff/*.js", { eager: true })).flatMap((m) => m.handlers || []);

// logo depois da guarda da sessão (a primeira rota pega-tudo da equipe), para as rotas de
// entrada que moram com ela (revogar sessões, os aparelhos) também serem checadas
const guardAt = staffHandlers.findIndex((h) => String(h.info?.path || "").endsWith("/staff/*")) + 1;
const staff = [...staffHandlers.slice(0, guardAt), permissionsGuard, ...staffHandlers.slice(guardAt)];

export const handlers = [...publicHandlers, ...customerHandlers, ...staff, ...areaHandlers];
