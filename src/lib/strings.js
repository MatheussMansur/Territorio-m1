// Toda frase que as telas mostram, na voz da casa, em src/i18n/{pt,es,en}.json (AD-35).
// As telas chamam t("key", {vars}); nenhum texto é escrito dentro dos componentes. As páginas públicas seguem
// o <html lang>; o painel é só em português. Uma chave que falta num idioma cai para o português
// (o teste de unidade garante que isso nunca acontece numa versão publicada).
import en from "../i18n/en.json" with { type: "json" };
import es from "../i18n/es.json" with { type: "json" };
import pt from "../i18n/pt.json" with { type: "json" };

export const LOCALES = { pt, es, en };
const FALLBACK = "pt";

/** pt, es ou en, a partir de uma tag BCP 47 como "pt-BR" ou "es-AR". */
export function localeOf(tag) {
  const base = String(tag || "").slice(0, 2).toLowerCase();
  return base in LOCALES ? base : FALLBACK;
}

let current = localeOf(globalThis.document?.documentElement?.lang);

export function setLocale(tag) {
  current = localeOf(tag);
}

export function getLocale() {
  return current;
}

function lookup(table, key) {
  return key.split(".").reduce((node, part) => (node == null ? undefined : node[part]), table);
}

/** t("validation.party", {max: 8}) → "Escolha de 1 a 8 pessoas." */
export function t(key, vars = {}) {
  const found = lookup(LOCALES[current], key);
  const text = typeof found === "string" ? found : lookup(LOCALES[FALLBACK], key);
  if (typeof text !== "string") return key;
  return text.replace(/\{(\w+)\}/g, (_, name) => (name in vars ? String(vars[name]) : `{${name}}`));
}

export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}
