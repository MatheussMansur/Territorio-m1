// Os três idiomas sempre têm as mesmas chaves e as mesmas {variáveis} (AD-35), e o
// arquivo em português nunca mostra palavra que a casa proibiu.
import assert from "node:assert/strict";
import { test } from "node:test";
import { LOCALES, getLocale, localeOf, setLocale, t } from "../../src/lib/strings.js";

function flatten(node, prefix = "", out = {}) {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") flatten(value, path, out);
    else out[path] = value;
  }
  return out;
}

const vars = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const flat = Object.fromEntries(Object.entries(LOCALES).map(([l, table]) => [l, flatten(table)]));

test("as três línguas têm exatamente as mesmas chaves", () => {
  const ptKeys = Object.keys(flat.pt).sort();
  for (const locale of ["es", "en"]) {
    assert.deepEqual(Object.keys(flat[locale]).sort(), ptKeys, `chaves diferentes em ${locale}`);
  }
});

test("cada frase usa as mesmas variáveis nas três línguas", () => {
  for (const [key, text] of Object.entries(flat.pt)) {
    for (const locale of ["es", "en"]) {
      assert.deepEqual(vars(flat[locale][key]), vars(text), `${locale}: ${key}`);
    }
  }
});

test("nenhum texto vazio e nenhuma palavra que a casa vetou", () => {
  for (const [locale, table] of Object.entries(flat)) {
    for (const [key, text] of Object.entries(table)) {
      assert.ok(String(text).trim(), `${locale}: ${key} vazio`);
      assert.doesNotMatch(String(text), /experi[eê]ncia|experiencia|experience/i, `${locale}: ${key}`);
    }
  }
});

test("a língua vem da tag da página e volta ao português", () => {
  assert.equal(localeOf("pt-BR"), "pt");
  assert.equal(localeOf("es-AR"), "es");
  assert.equal(localeOf("en"), "en");
  assert.equal(localeOf("fr"), "pt");
  const before = getLocale();
  setLocale("es");
  assert.equal(t("validation.party", { max: 8 }), "Elegí de 1 a 8 personas.");
  setLocale("en");
  assert.equal(t("common.retry"), "Try again");
  assert.equal(t("chave.que.nao.existe"), "chave.que.nao.existe");
  setLocale(before);
});
