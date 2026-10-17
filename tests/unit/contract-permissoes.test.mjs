// O arquivo de permissões (história 1.3, AR-22): toda operação da equipe no contrato está em
// docs/api/permissoes.yaml com a área e os perfis, o menu do painel lê esse arquivo (pelo
// src/admin/permissoes.json gerado), tudo o que está fora dele é negado, e o mock aplica o arquivo
// em toda chamada da equipe (N2): o perfil, as áreas que o dono liberou (1.15) e a confirmação
// de identidade das ações sensíveis (FR-74).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import yaml from "js-yaml";
import { buildPermissions, JSON_PATH, YAML_PATH } from "../../scripts/api/permissoes.mjs";
import { AREAS, canDo, defaultAreas, isSensitive, itemsFor } from "../../src/admin/nav.js";
import { loadContract, startMock } from "./contract-harness.mjs";

const file = yaml.load(readFileSync(YAML_PATH, "utf8"));
const doc = loadContract();
const staffOps = Object.entries(doc.paths).flatMap(([path, item]) =>
  ["get", "post", "put", "patch", "delete"].filter((m) => item[m] && path.startsWith("/staff")).map((m) => `${m.toUpperCase()} ${path}`),
);

test("toda operação de equipe do contrato está no arquivo de permissões, e só elas", () => {
  const listed = Object.keys(file.operations);
  assert.deepEqual(staffOps.filter((op) => !listed.includes(op)), [], "operações do contrato fora de permissoes.yaml");
  assert.deepEqual(listed.filter((op) => !staffOps.includes(op)), [], "operações de permissoes.yaml que o contrato não tem");
});

test("cada operação tem permissão <entidade>.<verbo>, uma área do trilho e papéis conhecidos", () => {
  const areas = AREAS.map((a) => a.key);
  assert.deepEqual(Object.keys(file.areas), areas, "as 15 áreas do trilho, na ordem do menu");
  for (const [key, op] of Object.entries(file.operations)) {
    assert.match(op.permission, /^[a-z_]+(\.[a-z_]+)+$/, key);
    assert.ok(op.area === null || areas.includes(op.area), `${key}: área ${op.area}`);
    for (const a of op.also || []) assert.ok(areas.includes(a), `${key}: área ${a}`);
    assert.ok(Array.isArray(op.roles) && op.roles.length && op.roles.every((r) => file.roles.includes(r)), `${key}: papéis`);
    if (op.sensitive) assert.ok(op.roles.includes("owner") && op.area !== null, `${key}: sensível é do dono, numa área`);
  }
});

test("as ações sensíveis do FR-74 pedem a confirmação de identidade e são do dono", () => {
  const fr74 = [
    "POST /staff/reservations/export",
    "POST /staff/audit/export",
    "POST /staff/customers/{id}/export",
    "POST /staff/events/{id}/guests/export",
    "POST /staff/customers/{id}/anonymize",
    "POST /staff/customers/{id}/reveal-phone",
    "POST /staff/devices/{id}/revoke",
    "PUT /staff/permissions",
  ];
  for (const op of fr74) assert.equal(isSensitive(op), true, op);
  assert.equal(isSensitive("PATCH /staff/users/{id}", { role: "manager" }), true, "mudar o perfil");
  assert.equal(isSensitive("PATCH /staff/users/{id}", { name: "Ana" }), false, "mudar o nome não");
  for (const op of fr74.filter((o) => !o.endsWith("reveal-phone"))) assert.deepEqual(file.operations[op].roles, ["owner"], op);
  // a tela de permissões é do dono, mesmo para quem recebeu a área Equipe (1.15)
  assert.deepEqual(file.operations["GET /staff/permissions"].roles, ["owner"]);
});

test("src/admin/permissoes.json é o arquivo YAML (npm run permissoes)", () => {
  assert.equal(readFileSync(JSON_PATH, "utf8").replace(/\r\n/g, "\n"), buildPermissions(readFileSync(YAML_PATH, "utf8")));
});

test("o menu lê os papéis do arquivo", () => {
  for (const area of AREAS) assert.deepEqual(area.roles, file.areas[area.key].roles, area.key);
  assert.deepEqual(defaultAreas("floor"), Object.entries(file.areas).filter(([, a]) => a.roles.includes("floor")).map(([k]) => k));
});

test("na dúvida, negado: operação fora do arquivo, papel desconhecido ou área tirada", () => {
  assert.equal(canDo("owner", "POST /staff/nao-existe"), false);
  assert.equal(canDo("owner", "GET /staff/dashboard"), true);
  assert.equal(canDo("visitante", "GET /staff/dashboard"), false);
  assert.equal(canDo(undefined, "GET /staff/me"), false);
  assert.equal(canDo("floor", "GET /staff/calendar"), false, "agenda não é da recepção");
  assert.equal(canDo("floor", "GET /staff/waitlist"), true);
  assert.equal(canDo("floor", "GET /staff/waitlist", ["reservas", "cardapio"]), false, "o dono tirou a Espera, o Salão e o Hoje");
  assert.equal(canDo("floor", "GET /staff/waitlist", ["salao"]), true, "o Salão também lê a espera");
  assert.equal(canDo("manager", "POST /staff/reservations/export"), false, "exportar é só do dono");
  assert.deepEqual(itemsFor("garçom"), []);
});

test("cada ação da reserva tem os seus perfis no arquivo, e a gaveta lê de lá (5.5)", async () => {
  const { canAct } = await import("../../src/admin/areas/reservas/labels.js");
  const actions = file.operations["POST /staff/reservations/{id}/actions"].actions;
  const enumValues = doc.components.schemas.ReservationActionType.enum;
  assert.deepEqual(Object.keys(actions).sort(), [...enumValues].sort(), "uma linha por valor de action do contrato");
  for (const [action, roles] of Object.entries(actions)) {
    assert.ok(roles.includes("owner") && roles.every((r) => file.roles.includes(r)), action);
  }
  for (const action of ["approve", "decline", "undo_no_show", "forgive_no_show", "call_answer"]) assert.deepEqual(actions[action], ["owner", "manager"], action);
  assert.equal(canAct({ role: "floor" }, "approve"), false);
  assert.equal(canAct({ role: "manager" }, "approve"), true);
  assert.equal(canAct({ role: "floor" }, "check_in"), true);
  assert.equal(canAct({ role: "owner" }, "acao_que_nao_existe"), false);
});

// ---- o mock aplica o arquivo (N2) --------------------------------------------------------------

let mock;
let api;
before(async () => {
  mock = await startMock({ papel: "dono" });
  const load = (n) => mock.load(`/src/services/api/${n}.js`);
  api = { client: await load("client"), agenda: await load("staff-agenda"), espera: await load("staff-espera"), reservas: await load("staff-reservas"), auth: await load("staff-auth"), equipe: await load("staff-equipe"), registro: await load("staff-registro") };
});
after(async () => {
  await mock?.close();
});

const as = (role) => {
  mock.as(role);
  api.client.setCsrfToken(null);
};
const outcome = (promise) => promise.then(() => "ok", (e) => e.type || e.message);

test("a simulação recusa o que o perfil não pode, com forbidden", async () => {
  as("recepcao");
  assert.equal(await outcome(api.agenda.calendar("2026-10")), "forbidden");
  assert.equal(await outcome(api.espera.list()), "ok");
  as("gerente");
  assert.equal(await outcome(api.registro.exportCsv({})), "forbidden");
  assert.equal(await outcome(api.equipe.permissions()), "forbidden");
});

test("a área que o dono tirou do perfil responde forbidden, e volta quando ele devolve", async () => {
  as("dono");
  await api.auth.reauth({ password: "admin", code: "123456" });
  const floorDefault = defaultAreas("floor");
  await api.equipe.savePermissions({ allowed: { floor: floorDefault.filter((a) => !["espera", "salao", "hoje"].includes(a)) } });
  as("recepcao");
  assert.equal(await outcome(api.espera.list()), "forbidden");
  as("dono");
  await api.equipe.savePermissions({ allowed: { floor: floorDefault } });
  as("recepcao");
  assert.equal(await outcome(api.espera.list()), "ok");
});

test("ação sensível sem a confirmação de identidade recente responde reauth_required", async () => {
  as("dono");
  sessionStorage.removeItem("territorio:mock-reauth");
  const range = { from: "2026-10-01", to: "2026-10-02" };
  assert.equal(await outcome(api.reservas.exportCsv(range)), "reauth_required");
  assert.equal(await outcome(api.auth.reauth({ password: "errada", code: "000000" })), "unauthorized");
  assert.equal(await outcome(api.reservas.exportCsv(range)), "reauth_required", "senha errada não abre a janela");
  await api.auth.reauth({ password: "admin", code: "123456" });
  assert.equal(await outcome(api.reservas.exportCsv(range)), "ok");
});

test("cada ação da reserva vale só para os perfis dela: a recepção não aprova nem recusa (5.5)", async () => {
  as("dono");
  const page = await api.reservas.list({ status: "pending" });
  const pending = (page.items || []).find((r) => r.status === "pending");
  assert.ok(pending, "o seed tem um pedido pendente");
  as("recepcao");
  assert.equal(await outcome(api.reservas.action(pending.id, { action: "approve" }, `k-${Date.now()}-a`)), "forbidden");
  assert.equal(await outcome(api.reservas.action(pending.id, { action: "decline", reason: "teste" }, `k-${Date.now()}-d`)), "forbidden");
  as("gerente");
  assert.equal(await outcome(api.reservas.action(pending.id, { action: "note", note: "Ligar antes" }, `k-${Date.now()}-n`)), "ok");
});
