// As áreas do painel: a lista única por trás do menu, a barra do celular e o canOpen.
// Quem abre cada área por padrão vem do arquivo de permissões (docs/api/permissoes.yaml,
// história 1.3, montado em ./permissoes.json por `npm run permissoes`); a 1.15 soma o que o dono
// escolheu por perfil, e é por isso que itemsFor e canOpen recebem as áreas permitidas e não só o
// perfil. O dono sempre tem todas as áreas. Tudo o que o arquivo não diz é negado.
import PERMISSIONS from "./permissoes.json" with { type: "json" };

export const HOME = "/admin/";

export const GROUPS = [
  { key: "casa", label: "A casa" },
  { key: "site", label: "Site" },
  { key: "gestao", label: "Gestão" },
];

/** Os perfis da equipe, do arquivo de permissões. */
export const ROLES = Array.isArray(PERMISSIONS?.roles) ? PERMISSIONS.roles : [];

/** Os perfis que abrem uma área por padrão; uma área que falta no arquivo não abre para ninguém. */
const rolesOf = (key) => {
  const roles = PERMISSIONS?.areas?.[key]?.roles;
  return Array.isArray(roles) ? roles.filter((r) => ROLES.includes(r)) : [];
};

/** Os perfis que podem rodar uma operação ("PUT /staff/onboarding") por padrão. */
const operationRoles = (operation) => {
  const roles = PERMISSIONS?.operations?.[operation]?.roles;
  return Array.isArray(roles) ? roles : [];
};

/** @type {{key: string, path: string, label: string, group: string, roles: string[], bar: boolean}[]} */
export const AREAS = [
  { key: "hoje", path: "/admin/", label: "Hoje", group: "casa", roles: rolesOf("hoje"), bar: true },
  { key: "reservas", path: "/admin/reservas", label: "Reservas", group: "casa", roles: rolesOf("reservas"), bar: true },
  { key: "salao", path: "/admin/salao", label: "Salão", group: "casa", roles: rolesOf("salao"), bar: true },
  { key: "espera", path: "/admin/espera", label: "Espera", group: "casa", roles: rolesOf("espera"), bar: false },
  { key: "agenda", path: "/admin/agenda", label: "Agenda", group: "casa", roles: rolesOf("agenda"), bar: false },
  { key: "plantas", path: "/admin/plantas", label: "Plantas", group: "casa", roles: rolesOf("plantas"), bar: false },
  { key: "eventos", path: "/admin/eventos", label: "Eventos", group: "casa", roles: rolesOf("eventos"), bar: false },
  { key: "clientes", path: "/admin/clientes", label: "Clientes", group: "casa", roles: rolesOf("clientes"), bar: false },
  { key: "site", path: "/admin/site", label: "Site", group: "site", roles: rolesOf("site"), bar: false },
  // a recepção só marca um prato como acabado na noite (história 4.13)
  { key: "cardapio", path: "/admin/cardapio", label: "Cardápio", group: "site", roles: rolesOf("cardapio"), bar: false },
  { key: "galeria", path: "/admin/galeria", label: "Galeria", group: "site", roles: rolesOf("galeria"), bar: false },
  { key: "equipe", path: "/admin/equipe", label: "Equipe", group: "gestao", roles: rolesOf("equipe"), bar: false },
  { key: "configuracoes", path: "/admin/configuracoes", label: "Configurações", group: "gestao", roles: rolesOf("configuracoes"), bar: false },
  { key: "registro", path: "/admin/registro", label: "Registro", group: "gestao", roles: rolesOf("registro"), bar: false },
  { key: "sistema", path: "/admin/sistema", label: "Sistema", group: "gestao", roles: rolesOf("sistema"), bar: false },
];

/** "/admin", "/admin/salao/" → "/admin/", "/admin/salao". */
export function normalizePath(path) {
  const clean = String(path || "").split(/[?#]/)[0].replace(/\/+$/, "");
  return clean === "/admin" || clean === "" ? HOME : clean;
}

/** Páginas do dono que funcionam como área mas ficam fora do menu: o passo a passo do primeiro uso (3.12). */
export const OFF_MENU = [{ key: "primeiro-acesso", path: "/admin/primeiro-acesso", label: "Primeiro acesso", group: "gestao", roles: operationRoles("PUT /staff/onboarding"), bar: false }];

/** A área deste endereço (a própria página ou uma abaixo dela), ou null quando não é do painel. */
export function areaFor(path) {
  const clean = normalizePath(path);
  const at = (a) => a.path === clean || (a.path !== HOME && clean.startsWith(`${a.path}/`));
  return AREAS.find(at) || OFF_MENU.find(at) || null;
}

/** O que vem depois do endereço da própria área: "/admin/configuracoes/horarios" → "horarios". */
export function subpathOf(path) {
  const clean = normalizePath(path);
  const area = areaFor(clean);
  return area && clean !== area.path ? clean.slice(area.path.length + 1) : "";
}

/** As áreas que um perfil abre por padrão (o arquivo de permissões; a 1.15 deixa o dono mudar). */
export function defaultAreas(role) {
  return AREAS.filter((a) => a.roles.includes(role)).map((a) => a.key);
}

/** O menu de uma sessão, na ordem do painel. Perfis desconhecidos não veem nada (na dúvida, nega). */
export function itemsFor(role, allowed = defaultAreas(role)) {
  if (role === "owner") return [...AREAS];
  if (!ROLES.includes(role)) return [];
  const keys = new Set(allowed);
  return AREAS.filter((a) => keys.has(a.key));
}

/**
 * Se este perfil pode rodar uma operação do contrato ("POST /staff/reservations/export"):
 * o perfil dele está no arquivo e uma das áreas da operação é permitida a ele (o dono passa em
 * todas as áreas). Uma operação que falta no arquivo, ou qualquer dúvida, é negada (história 1.3).
 */
export function canDo(role, operation, allowed = defaultAreas(role)) {
  try {
    const op = PERMISSIONS?.operations?.[operation];
    if (!op || !Array.isArray(op.roles) || !op.roles.includes(role) || !ROLES.includes(role)) return false;
    if (op.area == null || role === "owner") return true;
    const keys = new Set(allowed || []);
    return [op.area, ...(op.also || [])].some((a) => keys.has(a));
  } catch {
    return false;
  }
}

/** Os perfis listados para uma parte de uma operação (`actions` ou `options` do arquivo). */
const partRoles = (operation, kind, part) => {
  const roles = PERMISSIONS?.operations?.[operation]?.[kind]?.[part];
  return Array.isArray(roles) ? roles : [];
};

/**
 * Se este perfil pode rodar um valor da ação de uma operação ("approve" de
 * "POST /staff/reservations/{id}/actions"): canDo, mais os perfis da própria ação. Uma ação que o
 * arquivo não tem é negada.
 */
export function canDoAction(role, operation, action, allowed = defaultAreas(role)) {
  return canDo(role, operation, allowed) && partRoles(operation, "actions", action).includes(role);
}

/**
 * Se este perfil tem uma parte de uma operação que só alguns perfis têm ("any_day",
 * "override", "closed_night"…): canDo, mais os perfis da opção. Uma opção que o arquivo não
 * tem é negada.
 */
export function canDoOption(role, operation, option, allowed = defaultAreas(role)) {
  return canDo(role, operation, allowed) && partRoles(operation, "options", option).includes(role);
}

/**
 * Se a operação pede a checagem de identidade dos últimos 5 minutos (FR-74). Algumas são
 * sensíveis só para alguns campos do corpo (trocar o perfil de uma pessoa).
 */
export function isSensitive(operation, body = null) {
  const op = PERMISSIONS?.operations?.[operation];
  if (!op) return true; // desconhecida: pedir, nunca pular a checagem
  if (op.sensitive === true) return true;
  return Array.isArray(op.sensitive_fields) && Boolean(body) && op.sensitive_fields.some((f) => Object.hasOwn(body, f));
}

/** Se esta sessão pode abrir este endereço. Endereços desconhecidos nunca abrem. */
export function canOpen(role, path, allowed = defaultAreas(role)) {
  const area = areaFor(path);
  if (area && OFF_MENU.includes(area)) return area.roles.includes(role);
  return Boolean(area) && itemsFor(role, allowed).some((a) => a.key === area.key);
}

// ---- páginas fora das 15 áreas -------------------------------------------------------------

/** A entrada: e-mail e senha, os links de uso único e o pareamento do aparelho da casa. */
export const ENTRY = "/admin/entrar";
export const PAIRING = "/admin/aparelho";

/** As páginas da própria pessoa, no menu do nome dela (rodapé do trilho; "Mais" no celular). */
export const PERSONAL = [
  { key: "sessoes", path: "/admin/conta/sessoes", label: "Minhas sessões" },
  // quais avisos importantes e informativos a pessoa segue na central de avisos (FR-87)
  { key: "avisos", path: "/admin/conta/avisos", label: "Meus avisos" },
];

/**
 * A tela de entrada neste endereço: { screen, token } para /admin/entrar, os links dela e o
 * pareamento do aparelho; null para qualquer outro endereço.
 */
export function entryFor(path) {
  const clean = normalizePath(path);
  if (clean === PAIRING) return { screen: "pairing", token: null };
  if (clean === ENTRY) return { screen: "login", token: null };
  if (!clean.startsWith(`${ENTRY}/`)) return null;
  const [kind, token = null] = clean.slice(ENTRY.length + 1).split("/");
  const screen = { esqueci: "forgot", "nova-senha": "reset", "primeiro-acesso": "setup", convite: "invite" }[kind];
  if (!screen) return { screen: "login", token: null };
  return { screen, token: screen === "forgot" ? null : token ? decodeURIComponent(token) : "" };
}

/** A página da própria pessoa neste endereço, ou null. */
export const personalFor = (path) => PERSONAL.find((p) => p.path === normalizePath(path)) || null;
