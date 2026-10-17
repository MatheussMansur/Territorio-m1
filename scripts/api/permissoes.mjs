// Monta src/admin/permissoes.json a partir de docs/api/permissoes.yaml (história 1.3): o navegador lê
// JSON, as pessoas leem YAML. Rode `npm run permissoes` depois de editar o YAML; um teste de unidade
// (tests/unit/contract-permissoes.test.mjs) falha quando os dois diferem.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const YAML_PATH = resolve(root, "docs/api/permissoes.yaml");
export const JSON_PATH = resolve(root, "src/admin/permissoes.json");

/**
 * O texto JSON deste texto YAML: uma linha por área e por operação, para os diffs ficarem legíveis.
 * As notas ficam no YAML (são para as pessoas, não para as telas).
 */
export function buildPermissions(text) {
  const data = yaml.load(text);
  const block = (entries) => entries.map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(",\n");
  return `{
  "version": ${JSON.stringify(data.version)},
  "roles": ${JSON.stringify(data.roles)},
  "areas": {
${block(Object.entries(data.areas))}
  },
  "operations": {
${block(Object.entries(data.operations).map(([k, { note: _note, ...v }]) => [k, v]))}
  }
}
`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeFileSync(JSON_PATH, buildPermissions(readFileSync(YAML_PATH, "utf8")));
  console.log(`permissoes.json gerado de ${YAML_PATH}`);
}
