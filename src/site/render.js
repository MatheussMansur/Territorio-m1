// HTML gerado no build para as páginas públicas (AD-15: o site abre sem a API e sem
// JavaScript). Roda no Node dentro do plugin do Vite e nunca vai para o navegador.
// Todo valor interpolado é escapado, a não ser que seja um pedaço raw() feito por estas funções.
import images from "../content/images.json" with { type: "json" };
import en from "../i18n/en.json" with { type: "json" };
import es from "../i18n/es.json" with { type: "json" };
import pt from "../i18n/pt.json" with { type: "json" };
import { formatTime } from "./time.js";

const TABLES = { pt, es, en };
export const HTML_LANG = { pt: "pt-BR", es: "es", en: "en" };

class Raw {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

export const raw = (value) => new Raw(String(value));

export function escape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function piece(value) {
  if (value == null || value === false) return "";
  if (value instanceof Raw) return value.value;
  if (Array.isArray(value)) return value.map(piece).join("");
  return escape(value);
}

/** h`<p>${text}</p>`: escapa todo valor; arrays e pedaços raw() passam direto. */
export function h(strings, ...values) {
  return raw(strings.reduce((out, s, i) => out + s + (i < values.length ? piece(values[i]) : ""), ""));
}

/** Um LocalizedText ({pt, es, en}) ou uma string simples, no idioma da página (cai para pt). */
export function loc(field, locale) {
  if (field == null) return "";
  if (typeof field === "string") return field;
  return field[locale] || field.pt || "";
}

/** t() para o build: os mesmos arquivos e a mesma volta para o pt de src/lib/strings.js. */
export function translator(locale) {
  const find = (table, key) => key.split(".").reduce((n, p) => (n == null ? undefined : n[p]), table);
  return (key, vars = {}) => {
    const found = find(TABLES[locale], key);
    const text = typeof found === "string" ? found : find(TABLES.pt, key);
    if (typeof text !== "string") return key;
    return text.replace(/\{(\w+)\}/g, (_, name) => (name in vars ? String(vars[name]) : `{${name}}`));
  };
}

/** <picture> com AVIF, WebP e JPG dos tamanhos feitos por `npm run images`. */
export function picture(key, { alt, sizes = "100vw", eager = false, className = "" }) {
  const meta = images[key];
  if (!meta) throw new Error(`foto sem tamanhos gerados: ${key}`);
  const set = (ext) => meta.widths.map((w) => `/img/fotos/${key}-${w}.${ext} ${w}w`).join(", ");
  const largest = meta.widths[meta.widths.length - 1];
  return h`<picture class="${className}" style="background:${meta.placeholder}">
    <source type="image/avif" srcset="${set("avif")}" sizes="${sizes}">
    <source type="image/webp" srcset="${set("webp")}" sizes="${sizes}">
    <img src="/img/fotos/${key}-${largest}.jpg" srcset="${set("jpg")}" sizes="${sizes}" width="${meta.width}" height="${meta.height}" alt="${alt}" ${raw(eager ? 'fetchpriority="high"' : 'loading="lazy" decoding="async"')}>
  </picture>`;
}

/** Caminho de uma página num idioma: pt não tem prefixo, es e en ficam em /es/ e /en/. */
export function pathIn(locale, route) {
  return locale === "pt" ? route : `/${locale}${route}`;
}

export function money(cents) {
  return (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: cents % 100 ? 2 : 0 });
}

/** "19:00" → "19h", "23:30" → "23h30" em pt; o formato de cada idioma fica no catálogo. */
export function hour(hhmm, locale) {
  return formatTime(hhmm, translator(locale));
}
