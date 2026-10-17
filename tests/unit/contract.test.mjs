// O mock contra o contrato (história 1.4, AR-7): toda rota que o front chama e toda rota
// que o mock responde está em docs/api/openapi.yaml, e todo pedido e resposta de uma passada inteira
// pelo painel, pelo site e pelas páginas do cliente é validado contra ele (Ajv), sem nenhum campo
// fora do schema. Roda os handlers do próprio mock no Node (setupServer do MSW).
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, test } from "node:test";
import { findOperation, loadContract, makeChecker, operationsOf, pointer, ROOT, startMock } from "./contract-harness.mjs";
import { runScenario } from "./contract-scenario.mjs";

const doc = loadContract();
const ops = operationsOf(doc);
// a noite no relógio da casa: hoje às 20:30 em Foz do Iguaçu
const houseDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
let mock;

before(async () => {
  mock = await startMock({ papel: "dono", agora: `${houseDate}T20:30` });
});
after(async () => {
  await mock?.close();
});

test("o contrato é OpenAPI 3.1 e todo $ref aponta para algo que existe", () => {
  assert.equal(doc.openapi, "3.1.0");
  const broken = [];
  const walk = (node, at) => {
    if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${at}/${i}`));
    if (!node || typeof node !== "object") return;
    if (typeof node.$ref === "string" && pointer(doc, node.$ref) === undefined) broken.push(`${at}: ${node.$ref}`);
    for (const [k, v] of Object.entries(node)) walk(v, `${at}/${k}`);
  };
  walk(doc, "#");
  assert.deepEqual(broken, []);
});

test("toda rota que a simulação responde está no contrato", async () => {
  const { handlers } = await mock.load("/src/mocks/handlers/index.js");
  const missing = [];
  for (const h of handlers) {
    const { method, path } = h.info || {};
    if (typeof path !== "string" || path.endsWith("*")) continue;
    // um caminho de handler com parâmetros (/night/corrections/:id/:verb) é coberto pelas operações
    // do contrato que ele representa (/night/corrections/{id}/apply e …/dismiss)
    const re = new RegExp(`^${path.replace(/^\/api\/v1/, "").replace(/:[^/]+/g, "[^/]+")}$`);
    const covered = ops.some((o) => o.method === String(method).toUpperCase() && re.test(o.path.replace(/\{[^}]+\}/g, "x")));
    if (!covered) missing.push(`${String(method).toUpperCase()} ${path}`);
  }
  assert.deepEqual(missing, [], `rotas da simulação fora do contrato:\n${missing.join("\n")}`);
});

test("toda rota que src/services/api chama está no contrato", async () => {
  // toda função exportada de todo serviço, chamada com argumentos de mentira: os pedidos que ela
  // faz (método e caminho) têm que ser operações do contrato
  const files = readdirSync(resolve(ROOT, "src/services/api")).filter((f) => f.endsWith(".js") && !["client.js", "index.js", "static.js", "rotas-reais.js"].includes(f));
  const HELPERS = new Set(["readFresh", "downloadCsv", "stream"]);
  const seen = [];
  const strings = [];
  const from = mock.requests.length;
  for (const file of files) {
    const mod = await mock.load(`/src/services/api/${file}`);
    const fns = [];
    for (const [name, value] of Object.entries(mod)) {
      if (typeof value === "function" && !HELPERS.has(name)) fns.push([name, value]);
      else if (value && typeof value === "object") for (const [inner, fn] of Object.entries(value)) if (typeof fn === "function") fns.push([`${name}.${inner}`, fn]);
    }
    for (const [name, fn] of fns) {
      seen.push(`${file}:${name}`);
      try {
        let timer;
        const out = await Promise.race([fn("x", "x", "x"), new Promise((r) => (timer = setTimeout(r, 15_000)))]).finally(() => clearTimeout(timer));
        if (typeof out === "string" && out.startsWith("/api/v1/")) strings.push(out);
      } catch {
        // argumentos de mentira podem ser recusados; só importa o pedido que ela fez
      }
    }
  }
  await mock.settle();
  const missing = new Set();
  for (const r of mock.requests.slice(from)) {
    const path = new URL(r.url).pathname.replace(/^\/api\/v1/, "");
    if (!findOperation(ops, r.method, path)) missing.add(`${r.method} ${path}`);
  }
  for (const s of strings) {
    const path = new URL(s, "http://x").pathname.replace(/^\/api\/v1/, "");
    if (!findOperation(ops, "GET", path)) missing.add(`GET ${path}`);
  }
  assert.ok(seen.length > 100, `só ${seen.length} funções de serviço`);
  assert.deepEqual([...missing], [], `chamadas do front fora do contrato:\n${[...missing].join("\n")}`);
});

test("cada pedido e cada resposta da simulação confere com o contrato", async () => {
  const before = mock.exchanges.length;
  const log = await runScenario(mock);
  await mock.settle();
  const exchanges = mock.exchanges.slice(before);
  assert.deepEqual(log, [], `chamadas que quebraram fora da API:\n${log.join("\n")}`);
  assert.ok(exchanges.length > 300, `só ${exchanges.length} trocas`);
  const checker = makeChecker(doc);
  const problems = new Map();
  for (const x of exchanges) for (const p of checker.check(ops, x)) problems.set(p.replace(/ex\.: .*\)$/, ""), p);
  assert.deepEqual([...problems.values()].sort(), [], "a simulação diverge do contrato");

  // e a passada percorre toda rota que o mock tem (o fluxo ao vivo é conferido pelo tipo)
  const { handlers } = await mock.load("/src/mocks/handlers/index.js");
  const hit = exchanges.map((x) => [x.method, new URL(x.url).pathname]);
  const unused = [];
  for (const h of handlers) {
    const { method, path } = h.info || {};
    if (typeof path !== "string" || path.endsWith("*") || path.endsWith("/staff/stream")) continue;
    const re = new RegExp(`^${path.replace(/:[^/]+/g, "[^/]+")}$`);
    if (!hit.some(([m, p]) => m === String(method).toUpperCase() && re.test(p))) unused.push(`${String(method).toUpperCase()} ${path}`);
  }
  assert.deepEqual(unused, [], "rotas que o teste não exercitou");
});
