// Acesso da equipe e Configurações (épicos 1 e 2) contra o contrato e o catálogo da casa:
// cada grupo de configurações responde só os campos do seu próprio schema (2.14, 2.17), nenhuma resposta do
// mock leva segredo (2.20), os pedidos para aprovar sempre chegam a alguém ativo (2.15), e
// toda mensagem vem do catálogo único, nunca do texto do servidor (1.5).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { loadContract, startMock } from "./contract-harness.mjs";
import { runScenario } from "./contract-scenario.mjs";

const doc = loadContract();
let mock;
let api;

before(async () => {
  mock = await startMock({ papel: "dono" });
  const load = (n) => mock.load(`/src/services/api/${n}.js`);
  api = { client: await load("client"), cfg: await load("staff-configuracoes"), equipe: await load("staff-equipe") };
});
after(async () => {
  await mock?.close();
});

/** O schema dos dados de um grupo: o ramo do SettingsDocument para esse grupo. */
function schemaOf(group) {
  const branch = doc.components.schemas.SettingsDocument.allOf.find((b) => b.if?.properties?.group?.const === group);
  return branch?.then?.properties?.data?.$ref || null;
}

test("cada grupo das configurações traz só os campos do seu próprio schema", async () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema(doc, "contract");
  const index = await api.cfg.index();
  const problems = [];
  for (const { group } of index.groups) {
    const ref = schemaOf(group);
    if (!ref) {
      problems.push(`${group}: sem schema no SettingsDocument`);
      continue;
    }
    const schema = ref.split("/").slice(1).reduce((n, k) => n[k], doc);
    const answer = await api.cfg.group(group);
    const known = new Set(Object.keys(schema.properties || {}));
    for (const key of Object.keys(answer.data || {})) if (!known.has(key)) problems.push(`${group}.${key} fora de ${ref.split("/").pop()}`);
    const validate = ajv.compile({ $ref: `contract${ref}` });
    if (!validate(answer.data)) for (const e of validate.errors) problems.push(`${group}${e.instancePath}: ${e.message}`);
  }
  assert.deepEqual(problems, []);
});

test("o cardápio guarda item sem preço e “acabou”; o site, só as línguas (2.17)", () => {
  const { SettingsMenu, SettingsSite, SettingsMessages } = doc.components.schemas;
  assert.deepEqual(Object.keys(SettingsMenu.properties).sort(), ["show_sold_out", "unpriced_item"]);
  assert.equal("unpriced_item" in SettingsSite.properties, false);
  assert.equal(SettingsMessages.properties.ready_messages.maxItems, 3, "só as 3 mensagens prontas da casa (2.14)");
});

test("nenhuma resposta da simulação traz campo de segredo (2.20)", async () => {
  const from = mock.exchanges.length;
  await runScenario(mock);
  await mock.settle();
  mock.as("dono");
  // o cenário entra e sai pelo caminho: o grupo de integrações e o Sistema são lidos como o dono
  await api.cfg.group("integrations");
  await mock.load("/src/services/api/staff-sistema.js").then((m) => Promise.all(Object.values(m).filter((f) => typeof f === "function").map((f) => f().catch(() => null))));
  await mock.settle();
  const secret = /(^|_)(token|secret|senha|password|api_?key|private_?key|connection|dsn|credentials?)($|_)/i;
  // o que tem nome de segredo mas não é: o token CSRF da página, a chave pública do
  // widget do Turnstile, e { secret: true }, a marca do registro para "trocado" (2.21)
  const allowed = /^(csrf_token|turnstile_site_key|site_key)$/;
  // o único lugar onde um segredo precisa chegar à tela: a pessoa configurando o próprio autenticador
  const own = /^POST \/api\/v1\/staff\/(me\/mfa|auth\/setup|auth\/accept-invite)$/;
  const leaks = new Set();
  const walk = (node, at, url) => {
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      if (secret.test(key) && !allowed.test(key) && !own.test(url) && value != null && typeof value !== "object" && typeof value !== "boolean" && value !== "") leaks.add(`${url} ${at}${key}`);
      walk(value, `${at}${key}.`, url);
    }
  };
  const exchanges = mock.exchanges.slice(from);
  assert.ok(exchanges.length > 300, `só ${exchanges.length} trocas`);
  for (const x of exchanges) if (/\/api\/v1\/staff\//.test(x.url)) walk(x.responseBody, "", `${x.method} ${new URL(x.url).pathname}`);
  assert.deepEqual([...leaks], []);
});

test("pendentes sem ninguém ativo para receber: a gravação recusa (2.15)", async () => {
  mock.as("dono");
  api.client.setCsrfToken(null);
  const users = await api.equipe.users();
  const list = Array.isArray(users) ? users : users.items || users.users;
  const manager = list.find((u) => u.role === "manager" && u.status === "active");
  assert.ok(manager, "a gerente do seed");
  const approval = await api.cfg.group("approval_no_shows");
  assert.notEqual(approval.data.approval_mode, "auto");
  await api.equipe.update(manager.id, { status: "disabled" });
  const alerts = await api.cfg.group("alerts");
  const outcome = await api.cfg.save("alerts", { data: { pending_to: [manager.id] } }, alerts.version).then(
    () => "ok",
    (e) => e,
  );
  assert.equal(outcome.type, "validation");
  assert.ok(outcome.errors.some((e) => e.field === "pending_to" && /receber os pedidos para aprovar/.test(e.message)));
  await api.equipe.update(manager.id, { status: "active" });
});

test("as mensagens saem do catálogo único, nunca do texto do servidor (1.5)", async () => {
  const { describeError } = await mock.load("/src/lib/errors.js");
  const { ApiError } = api.client;
  // a recepção tentando a entrada pessoal
  const floor = new ApiError({ status: 403, type: "forbidden", title: "texto do servidor", detail: "detalhe do servidor" });
  const login = describeError(floor, { variant: "login" });
  assert.equal(login.title, "A recepção entra pelo aparelho da casa");
  assert.doesNotMatch(`${login.title} ${login.text}`, /servidor/);
  // userMessage nunca repete a frase do servidor, seja qual for o tipo
  for (const type of ["validation", "conflict", "not_found", "gone", "invalid_transition", "precondition_failed", "forbidden"]) {
    const e = new ApiError({ status: type === "validation" ? 422 : 409, type, title: "Texto cru do servidor", detail: "Detalhe cru do servidor" });
    assert.doesNotMatch(e.userMessage, /cru do servidor/, type);
  }
  // as páginas do cliente leem o mesmo catálogo, no idioma da página
  const strings = await mock.load("/src/lib/strings.js");
  const ui = await mock.load("/src/pages/cliente-ui.js");
  const { CATALOG } = await mock.load("/src/lib/errors.js");
  for (const locale of ["pt", "es", "en"]) {
    strings.setLocale?.(locale);
    const entry = ui.catalog("slot_full.cutoff");
    assert.equal(entry.title, CATALOG["slot_full.cutoff"][locale].title, locale);
  }
  strings.setLocale?.("pt");
});
