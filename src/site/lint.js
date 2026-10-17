// A checagem de conteúdo dos textos públicos (NFR-34, UX-DR-125), usada pelo painel (antes de
// "Publicar"), pela API simulada (422 no campo) e pelos testes: as palavras proibidas da casa
// (src/content/words.json) e emoji. Só palavras inteiras, sem ligar para acentos e maiúsculas, então
// "Brasa" e "brasas" são pegas, mas "abrasado" não.
import WORDS from "../content/words.json" with { type: "json" };

const fold = (text) => String(text || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const EMOJI = /\p{Extended_Pictographic}/u;

const RULES = WORDS.forbidden.map((w) => ({ ...w, re: new RegExp(`(^|[^\\p{L}])${fold(w.match).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?(?=$|[^\\p{L}])`, "u") }));

/** O primeiro problema de um texto, como frase para o painel, ou null. */
export function lintText(text) {
  if (!text) return null;
  if (EMOJI.test(text)) return "Sem emoji nos textos do site.";
  const folded = fold(text);
  const rule = RULES.find((r) => r.re.test(folded));
  return rule ? `“${rule.match}”: ${rule.why}. Troque antes de publicar.` : null;
}

/**
 * Todos os problemas de um conjunto de campos: `fields` é [{ field, label, text }] e a resposta é
 * [{ field, label, message }], no formato de erro da API (field + message).
 */
export function lintFields(fields) {
  const out = [];
  for (const f of fields) {
    const message = lintText(f.text);
    if (message) out.push({ field: f.field, label: f.label, message });
  }
  return out;
}

/** Os textos de um LocalizedText como campos da checagem: "lede.pt", "lede.es"… */
export const localizedFields = (field, label, value) =>
  value && typeof value === "object"
    ? ["pt", "es", "en"].filter((l) => value[l]).map((l) => ({ field: `${field}.${l}`, label: `${label} (${l})`, text: value[l] }))
    : [{ field, label, text: value }];

// chaves que são notas para a equipe, nunca impressas; e as frases do próprio dono, mantidas como ele disse
const NOT_PUBLIC = new Set(["note", "data_source", "geo_source", "pending", "why", "match", "photo", "slug", "id", "style", "booking_mode"]);
const QUOTED = /^content\.about\.quotes\./;

/**
 * Os arquivos de conteúdo do build (content.json, menu.json, events.json…) percorridos texto a texto:
 * [{ field: "menu.categories.2.items.0.description.pt", message }]. O build para em qualquer um.
 */
export function lintContent(files) {
  const out = [];
  const walk = (value, path) => {
    if (typeof value === "string") {
      const message = QUOTED.test(path) ? null : lintText(value);
      if (message) out.push({ field: path, message });
    } else if (value && typeof value === "object") {
      for (const [key, inner] of Object.entries(value)) if (!NOT_PUBLIC.has(key)) walk(inner, `${path}.${key}`);
    }
  };
  for (const [name, json] of Object.entries(files)) walk(json, name);
  return out;
}
