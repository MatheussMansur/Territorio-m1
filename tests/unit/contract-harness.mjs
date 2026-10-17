// A máquina do teste do contrato (história 1.4, AR-7): o contrato (docs/api/openapi.yaml) lido
// com o Ajv, os handlers do mock rodando no Node (setupServer do MSW, carregado pelo Vite para
// import.meta.glob e os imports de JSON funcionarem como no navegador), e um conferidor que compara
// todo pedido que o front manda e toda resposta que o mock dá com o contrato:
// a operação existe, os parâmetros de query e os cabeçalhos estão declarados, o corpo e a
// resposta validam, e nenhum campo fica fora do schema (uma resposta com um campo que o contrato
// não descreve também falha, assim o contrato acompanha o que as telas leem).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import yaml from "js-yaml";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const METHODS = ["get", "post", "put", "patch", "delete"];
// respostas que qualquer operação pode dar (o contrato diz isso uma vez, em info.description)
const COMMON = new Set(["429", "500", "503"]);

export function loadContract() {
  return yaml.load(readFileSync(resolve(ROOT, "docs/api/openapi.yaml"), "utf8"));
}

/** Toda operação: { method, path, op, pattern } com os {params} do caminho como padrão. */
export function operationsOf(doc) {
  const list = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of METHODS) {
      if (!item[method]) continue;
      const pattern = new RegExp(`^${path.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\\\{[^}]+\\\}|\{[^/}]+\}/g, "([^/]+)")}$`);
      list.push({ method: method.toUpperCase(), path, op: item[method], item, pattern, names: [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]) });
    }
  }
  // um trecho fixo ganha de um parâmetro (/staff/devices/staff antes de /staff/devices/{id})
  return list.sort((a, b) => a.names.length - b.names.length);
}

export function findOperation(ops, method, path) {
  return ops.find((o) => o.method === method.toUpperCase() && o.pattern.test(path)) || null;
}

export function pointer(doc, ref) {
  if (!ref.startsWith("#/")) throw new Error(`ref externo: ${ref}`);
  return ref
    .slice(2)
    .split("/")
    .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce((node, key) => node?.[key], doc);
}

const deref = (doc, node) => {
  let seen = 0;
  while (node && node.$ref && seen++ < 20) node = pointer(doc, node.$ref);
  return node;
};

export function makeChecker(doc) {
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: true });
  addFormats(ajv);
  const rest = { ...doc };
  delete rest.openapi;
  ajv.addSchema({ $id: "contract", ...rest });
  const compiled = new Map();
  const paramValidators = new Map();
  const validatorAt = (ptr) => {
    if (!compiled.has(ptr)) compiled.set(ptr, ajv.compile({ $ref: `contract#${ptr}` }));
    return compiled.get(ptr);
  };
  const esc = (s) => s.replace(/~/g, "~0").replace(/\//g, "~1");

  // campos dos dados que nenhum ramo do schema declara (o contrato tem que descrever o que é mandado)
  // um nó do schema compilado sozinho (as refs dele apontam para dentro do contrato), para escolher ramos
  const nodeValidators = new WeakMap();
  const fits = (node, data) => {
    if (!nodeValidators.has(node)) nodeValidators.set(node, ajv.compile(rewrite(node)));
    return nodeValidators.get(node)(data);
  };
  const declaredKeys = (node) => {
    const keys = new Set();
    for (const { schema: b } of branches(node, "", undefined)) for (const k of Object.keys(b.properties || {})) keys.add(k);
    return keys;
  };

  // cada ramo com o nome do componente de onde vem (para um relatório legível). De um
  // anyOf/oneOf, só conta a opção que serve aos dados (e declara a maior parte dos campos);
  // if/then/else segue os dados, como a validação faz.
  function branches(schema, owner, data, out = []) {
    let seen = 0;
    while (schema && schema.$ref && seen++ < 20) {
      owner = schema.$ref.split("/").pop();
      schema = pointer(doc, schema.$ref);
    }
    if (!schema || typeof schema !== "object") return out;
    out.push({ schema, owner });
    for (const s of schema.allOf || []) branches(s, owner, data, out);
    for (const key of ["anyOf", "oneOf"]) {
      const options = schema[key] || [];
      if (!options.length) continue;
      if (data === undefined) {
        for (const s of options) branches(s, owner, data, out);
        continue;
      }
      const valid = options.filter((s) => fits(s, data));
      const pool = valid.length ? valid : options;
      const keys = data && typeof data === "object" && !Array.isArray(data) ? Object.keys(data) : [];
      const score = (s) => {
        const declared = declaredKeys(s);
        return keys.filter((k) => declared.has(k)).length;
      };
      const best = pool.reduce((a, b) => (score(b) > score(a) ? b : a), pool[0]);
      branches(best, owner, data, out);
    }
    if (schema.if) {
      const next = data !== undefined && fits(schema.if, data) ? schema.then : schema.else;
      if (next) branches(next, owner, data, out);
    }
    return out;
  }
  const sample = (v) => {
    const text = JSON.stringify(v);
    return text.length > 90 ? `${text.slice(0, 87)}...` : text;
  };
  function undeclared(schema, data, owner, at, out) {
    if (data == null || typeof data !== "object") return out;
    const all = branches(schema, owner, data);
    if (Array.isArray(data)) {
      const items = all.filter((b) => b.schema.items);
      if (items.length) data.forEach((v) => undeclared(items[0].schema.items, v, `${items[0].owner}[]`, `${at}[]`, out));
      return out;
    }
    const props = new Map();
    let extra = null;
    let open = true;
    let name = owner;
    for (const { schema: s, owner: o } of all) {
      if (s.properties) {
        open = false;
        name = o;
        for (const [k, v] of Object.entries(s.properties)) if (!props.has(k)) props.set(k, { v, o });
      }
      if (s.additionalProperties === false) open = false;
      if (s.additionalProperties && typeof s.additionalProperties === "object") extra = { v: s.additionalProperties, o };
      if (s.additionalProperties === true || s.patternProperties) extra = extra || { v: {}, o };
    }
    // um schema de objeto sem properties (forma livre) deixa o conteúdo por conta da tela
    for (const [k, v] of Object.entries(data)) {
      if (props.has(k)) undeclared(props.get(k).v, v, `${props.get(k).o}.${k}`, `${at}.${k}`, out);
      else if (extra) undeclared(extra.v, v, `${extra.o}.*`, `${at}.${k}`, out);
      else if (!open) out.push(`${name}.${k} não está no contrato (${at || "raiz"}; ex.: ${sample(v)})`);
    }
    return out;
  }

  function validateAt(ptr, data) {
    const fn = validatorAt(ptr);
    const errors = [];
    if (!fn(data)) {
      for (const e of fn.errors.slice(0, 12)) {
        const rule = e.schemaPath.replace(/^contract#\/components\/schemas\//, "").replace(/^contract#/, "");
        const value = e.instancePath ? e.instancePath.split("/").slice(1).reduce((n, k) => n?.[k], data) : data;
        errors.push(`${rule}: ${e.message}${e.params?.allowedValues ? ` ${JSON.stringify(e.params.allowedValues)}` : ""} (${e.instancePath.replace(/\/\d+/g, "[]") || "raiz"}; ex.: ${sample(value)})`);
      }
    }
    const schema = pointer(doc, `#${ptr}`);
    for (const f of undeclared(schema, data, ptr.split("/").pop(), "", [])) errors.push(f);
    return errors;
  }

  const paramsOf = (o) => [...(o.item.parameters || []), ...(o.op.parameters || [])].map((p) => deref(doc, p));

  function coerce(schema, raw) {
    const s = deref(doc, schema) || {};
    const type = Array.isArray(s.type) ? s.type.find((t) => t !== "null") : s.type;
    if (type === "integer" || type === "number") return Number(raw);
    if (type === "boolean") return raw === "true" ? true : raw === "false" ? false : raw;
    if (type === "array") return String(raw).split(",");
    return raw;
  }

  /**
   * Uma troca: { method, url, requestHeaders, requestBody (JSON lido | "multipart" | undefined),
   * status, contentType, responseBody }. Devolve a lista de problemas (vazia = bate com o contrato).
   */
  function check(ops, x) {
    const url = new URL(x.url);
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const o = findOperation(ops, x.method, path);
    if (!o) return [`${x.method} ${path}: rota fora do contrato`];
    const where = `${x.method} ${o.path}`;
    const problems = [];
    const params = paramsOf(o);
    // query: todo parâmetro mandado está declarado e é válido
    for (const [name, raw] of url.searchParams) {
      const p = params.find((q) => q.in === "query" && q.name === name);
      if (!p) {
        problems.push(`${where}: parâmetro ?${name} fora do contrato`);
        continue;
      }
      if (!p.schema) continue;
      if (!paramValidators.has(p)) paramValidators.set(p, ajv.compile(rewrite(p.schema)));
      const fn = paramValidators.get(p);
      if (!fn(coerce(p.schema, raw))) problems.push(`${where}: ?${name}=${raw} ${fn.errors[0].message}`);
    }
    for (const header of ["If-Match", "If-None-Match", "Idempotency-Key"]) {
      if (x.requestHeaders[header.toLowerCase()] == null) continue;
      if (!params.some((p) => p.in === "header" && p.name.toLowerCase() === header.toLowerCase())) problems.push(`${where}: cabeçalho ${header} fora do contrato`);
    }
    // corpo
    const opPtr = `/paths/${esc(o.path)}/${o.method.toLowerCase()}`;
    if (x.requestBody !== undefined) {
      const rb = deref(doc, o.op.requestBody);
      if (!rb) problems.push(`${where}: corpo enviado, mas o contrato não tem requestBody`);
      else if (x.requestBody === "multipart") {
        if (!rb.content?.["multipart/form-data"]) problems.push(`${where}: corpo multipart fora do contrato`);
      } else if (rb.content?.["application/json"]) {
        const ptr = o.op.requestBody.$ref ? `${o.op.requestBody.$ref.slice(1)}/content/application~1json/schema` : `${opPtr}/requestBody/content/application~1json/schema`;
        for (const e of validateAt(ptr, x.requestBody)) problems.push(`${where} corpo: ${e}`);
      } else problems.push(`${where}: corpo JSON fora do contrato`);
    }
    // um pedido que a API recusou (4xx) pode ser inválido de propósito: só a resposta é conferida
    if (x.status >= 400 && x.status < 500) problems.length = 0;
    // a resposta
    const responses = o.op.responses || {};
    const code = String(x.status);
    const key = responses[code] ? code : responses[`${code[0]}XX`] ? `${code[0]}XX` : responses.default ? "default" : null;
    // as respostas que toda operação pode dar sem repeti-las (info.description do contrato)
    const common = COMMON.has(code) || (o.op.security?.length && ["401", "403"].includes(code)) || (o.names.length && code === "404") || (params.some((p) => p.name === "If-Match") && ["412", "428"].includes(code));
    if (!key && !common) return [...problems, `${where}: resposta ${code} fora do contrato`];
    let resPtr = key ? `${opPtr}/responses/${key}` : "/components/responses/Common";
    let res = key ? responses[key] : { content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } } };
    if (!key && !/json/.test(x.contentType || "")) return [...problems, `${where}: resposta ${code} sem problem+json`];
    if (!key) {
      for (const e of validateAt("/components/schemas/Problem", x.responseBody)) problems.push(`${where} ${code}: ${e}`);
      return problems;
    }
    if (res.$ref) {
      resPtr = res.$ref.slice(1);
      res = pointer(doc, res.$ref);
    }
    if (x.status === 204 || x.status === 304) return problems;
    const type = (x.contentType || "").split(";")[0].trim();
    if (!res.content) {
      if (x.responseBody != null && x.responseBody !== "") problems.push(`${where} ${code}: o contrato não descreve corpo`);
      return problems;
    }
    const mediaKey = res.content[type] ? type : type === "application/json" && res.content["application/problem+json"] ? "application/problem+json" : type === "application/problem+json" && res.content["application/json"] ? "application/json" : null;
    if (!mediaKey) return [...problems, `${where} ${code}: tipo ${type} fora do contrato (${Object.keys(res.content).join(", ")})`];
    if (!/json/.test(mediaKey) || !res.content[mediaKey].schema) return problems;
    for (const e of validateAt(`${resPtr}/content/${esc(mediaKey)}/schema`, x.responseBody)) problems.push(`${where} ${code}: ${e}`);
    return problems;
  }

  // o schema de um parâmetro compilado sozinho: as refs dele apontam para dentro do contrato
  function rewrite(node) {
    if (Array.isArray(node)) return node.map(rewrite);
    if (!node || typeof node !== "object") return node;
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, k === "$ref" && typeof v === "string" && v.startsWith("#/") ? `contract${v}` : rewrite(v)]));
  }

  return { check, validateAt, undeclared };
}

// ---- o mock no Node --------------------------------------------------------------------------

const memory = () => {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k), clear: () => map.clear(), key: (i) => [...map.keys()][i] ?? null, get length() { return map.size; } };
};

/**
 * Liga os handlers do mock no Node. O endereço da página (?papel=, ?agora=, ?mock=) é o que o
 * mock lê para saber quem entrou e o relógio da casa; `as()` muda isso entre as chamadas.
 */
export async function startMock({ papel = "dono", agora } = {}) {
  globalThis.window = globalThis;
  globalThis.sessionStorage = memory();
  globalThis.localStorage = memory();
  globalThis.addEventListener ??= () => {};
  globalThis.removeEventListener ??= () => {};
  globalThis.dispatchEvent ??= () => true;
  globalThis.CustomEvent ??= class CustomEvent extends Event {
    constructor(type, init) {
      super(type);
      this.detail = init?.detail;
    }
  };
  const origin = "http://localhost";
  const at = (search) => {
    globalThis.location = Object.assign(new URL(`${origin}/admin/${search}`), { reload() {}, assign() {}, replace() {} });
  };
  // role: "dono" | "gerente" | "recepcao"; null encerra o atalho (?papel=sair); undefined deixa como está
  const query = (role, extra = {}) =>
    `?${new URLSearchParams({ ...(role ? { papel: role } : role === null ? { papel: "sair" } : {}), mock: "normal", ...(agora ? { agora } : {}), ...extra })}`;
  at(query(papel));

  const { createServer } = await import("vite");
  const vite = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: "error",
    appType: "custom",
    server: { middlewareMode: true, hmr: false, watch: null, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    define: { "import.meta.env.VITE_API_MODE": JSON.stringify("mock") },
    plugins: [
      {
        // o mock guarda os dados na memória entre as chamadas; gravar tudo no armazenamento (falso)
        // a cada mudança é o que o navegador precisa para sobreviver a um recarregamento, não este teste
        name: "contract-memory-db",
        transform(code, id) {
          if (id.replace(/\\/g, "/").endsWith("/src/mocks/db.js")) return code.replace("export function save() {", "export function save() {\n  return;");
          return null;
        },
      },
    ],
  });
  const load = (path) => vite.ssrLoadModule(path);
  const { handlers } = await load("/src/mocks/handlers/index.js");
  const { setupServer } = await import("msw/node");
  const server = setupServer(...handlers);
  server.listen({ onUnhandledRequest: "error" });

  // as demoras "realistas" do mock e os temporizadores da demonstração não fazem sentido aqui: toda espera é curta
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...args) => realTimeout(fn, ms > 20 && ms < 10_000 ? 0 : ms, ...args);

  const exchanges = [];
  const pending = new Map();
  const reading = [];
  const requests = [];
  server.events.on("request:start", ({ request, requestId }) => {
    requests.push({ method: request.method, url: request.url });
    const type = request.headers.get("content-type") || "";
    const copy = request.clone();
    pending.set(
      requestId,
      (async () => {
        let body;
        if (!["GET", "HEAD"].includes(copy.method)) {
          if (type.includes("multipart")) body = "multipart";
          else {
            const text = await copy.text();
            body = text ? JSON.parse(text) : undefined;
          }
        }
        return { method: copy.method, url: copy.url, requestHeaders: Object.fromEntries(copy.headers), requestBody: body, papel: new URL(globalThis.location.href).searchParams.get("papel") };
      })(),
    );
  });
  server.events.on("response:mocked", ({ response, requestId }) => {
    const copy = response.clone();
    reading.push(
      (async () => {
        const base = (await pending.get(requestId)) || {};
        const contentType = copy.headers.get("content-type") || "";
        let responseBody = null;
        if (/json/.test(contentType)) {
          const text = await copy.text();
          responseBody = text ? JSON.parse(text) : null;
        }
        exchanges.push({ ...base, status: copy.status, contentType, responseBody });
      })(),
    );
  });

  return {
    load,
    exchanges,
    /** Todo pedido que chegou à camada de rede, respondido ou não. */
    requests,
    /** Quem está dentro nas próximas chamadas ("dono", "gerente", "recepcao"; null = ninguém; undefined = quem entrou), e o cenário. */
    as(role, extra = {}) {
      at(query(role, extra));
    },
    /** Espera as respostas que ainda estão sendo lidas. */
    settle: () => {
      let timer;
      const late = new Promise((resolve) => {
        timer = setTimeout(resolve, 15_000);
      });
      return Promise.race([Promise.all(reading), late]).finally(() => clearTimeout(timer));
    },
    async close() {
      globalThis.setTimeout = realTimeout;
      server.close();
      await vite.close();
    },
  };
}
