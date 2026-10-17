// Nenhuma tela guarda a própria lista de perfis (história 1.3, AR-22): todo "quem pode fazer isto" do
// painel pergunta ao arquivo de permissões (canDo, canDoAction, canDoOption em src/admin/nav.js). Este
// teste lê o código do painel e falha quando volta uma comparação com nome de perfil, ou uma lista de
// perfis. Mostrar o nome de um perfil (um mapa de rótulos) pode.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { YAML_PATH } from "../../scripts/api/permissoes.mjs";
import { canDoAction, canDoOption } from "../../src/admin/nav.js";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const ADMIN = join(root, "src/admin");

// onde os perfis são o próprio assunto, não uma permissão
const SKIP = new Set([
  "src/admin/nav.js", // lê o arquivo; "o dono tem todas as áreas" é regra do próprio arquivo
  "src/admin/avisos/catalogo.js", // o catálogo de avisos: quem recebe cada aviso (FR-87)
]);
// linhas que comparam um perfil por outro motivo que não permissão
const ALLOWED = [
  // a escolha de pessoas de Configurações › Avisos lista o dono e os gerentes, que recebem avisos
  { file: "src/admin/areas/configuracoes/custom.js", text: '(u) => u.role !== "floor"' },
];

const ROLE = String.raw`["'](?:owner|manager|floor)["']`;
const PATTERNS = [
  new RegExp(String.raw`\brole\s*[!=]==?\s*${ROLE}`), // user.role === "owner"
  new RegExp(String.raw`${ROLE}\s*[!=]==?\s*[\w.?]*\brole\b`), // "owner" === user.role
  new RegExp(String.raw`\[\s*${ROLE}\s*,\s*${ROLE}`), // ["owner", "manager"]
];

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return files(path);
    return e.name.endsWith(".js") ? [path] : [];
  });
}

test("nenhuma tela do painel guarda lista de perfis: quem pode vem de permissoes.yaml", () => {
  const found = [];
  for (const path of files(ADMIN)) {
    const file = relative(root, path).replace(/\\/g, "/");
    if (SKIP.has(file)) continue;
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return;
        if (ALLOWED.some((a) => a.file === file && line.includes(a.text))) return;
        if (PATTERNS.some((p) => p.test(line))) found.push(`${file}:${i + 1}: ${line.trim()}`);
      });
  }
  assert.deepEqual(found, [], "use canDo / canDoAction / canDoOption (src/admin/nav.js) em vez do perfil");
});

test("as opções de cada operação têm perfis conhecidos, sempre com o dono", () => {
  const file = yaml.load(readFileSync(YAML_PATH, "utf8"));
  for (const [key, op] of Object.entries(file.operations)) {
    for (const [name, roles] of Object.entries(op.options || {})) {
      assert.ok(Array.isArray(roles) && roles.includes("owner") && roles.every((r) => op.roles.includes(r)), `${key}: ${name}`);
    }
  }
});

test("as partes de uma operação seguem os perfis de hoje", () => {
  const ACTIONS = "POST /staff/reservations/{id}/actions";
  for (const role of ["owner", "manager"]) {
    assert.equal(canDoOption(role, "GET /staff/reservations", "any_day"), true, role);
    assert.equal(canDoOption(role, "GET /staff/reservations/{id}", "private_notes"), true, role);
    assert.equal(canDoOption(role, "POST /staff/reservations", "override"), true, role);
    assert.equal(canDoOption(role, ACTIONS, "closed_night"), true, role);
    assert.equal(canDoOption(role, "GET /staff/events/{id}/guests", "print"), true, role);
  }
  assert.equal(canDoOption("floor", "GET /staff/reservations", "any_day"), false, "a recepção vê só hoje");
  assert.equal(canDoOption("floor", "GET /staff/reservations/{id}", "private_notes"), false);
  assert.equal(canDoOption("floor", "POST /staff/reservations", "override"), false);
  assert.equal(canDoOption("floor", ACTIONS, "any_day"), false, "a recepção remarca só no mesmo dia");
  assert.equal(canDoOption("floor", ACTIONS, "closed_night"), false);
  assert.equal(canDoOption("floor", "GET /staff/events/{id}/guests", "print"), false);
  assert.equal(canDoOption("owner", ACTIONS, "opcao_que_nao_existe"), false, "na dúvida, negado");
  assert.equal(canDoAction("manager", ACTIONS, "approve"), true);
  assert.equal(canDoAction("floor", ACTIONS, "approve"), false);
  assert.equal(canDoAction("manager", ACTIONS, "approve", ["cardapio"]), false, "o dono tirou as áreas da reserva");
});
