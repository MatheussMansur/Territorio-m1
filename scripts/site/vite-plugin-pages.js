// Plugin do Vite: uma entrada HTML que só tem <!-- @site nome --> vira a página inteira,
// montada a partir de src/site/pages/<nome>.js no idioma da sua pasta (/, /es/, /en/).
// O mesmo modelo de arquivo de entrada serve os três idiomas, então a página é escrita uma vez (AD-35).
// As páginas de evento (/eventos/{slug}/) são uma entrada por evento de src/content/events.json; o build
// falha quando um evento não tem entrada em um dos idiomas.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { iconProblems } from "./icons.js";

const MARKER = /<!--\s*@site\s+([\w-]+)\s*-->/;
const LOCALES = ["pt", "es", "en"];

export function localeOfPath(path) {
  const first = path.replace(/\\/g, "/").replace(/^\//, "").split("/")[0];
  return first === "es" || first === "en" ? first : "pt";
}

/** "not-found" → "notFound": a função que o módulo da página exporta. */
const exportName = (name) => name.replace(/-(\w)/g, (_, c) => c.toUpperCase());

/** Os arquivos de entrada que os eventos de events.json pedem e não têm. */
export function missingEventEntries(root, events) {
  const missing = [];
  for (const e of events?.events || []) {
    for (const locale of LOCALES) {
      const file = `${locale === "pt" ? "" : `${locale}/`}eventos/${e.slug}/index.html`;
      if (!existsSync(resolve(root, file))) missing.push(file);
    }
  }
  return missing;
}

/** Chaves da seção "site" que faltam em um dos idiomas ("es: site.langSuggest"). */
export function missingSiteKeys(root) {
  const flat = (node, prefix = "", out = []) => {
    for (const [k, v] of Object.entries(node || {})) {
      if (v && typeof v === "object") flat(v, `${prefix}${k}.`, out);
      else out.push(`${prefix}${k}`);
    }
    return out;
  };
  const keys = Object.fromEntries(LOCALES.map((l) => [l, new Set(flat(JSON.parse(readFileSync(resolve(root, "src/i18n", `${l}.json`), "utf8")).site, "site."))]));
  const all = new Set(LOCALES.flatMap((l) => [...keys[l]]));
  return LOCALES.flatMap((l) => [...all].filter((k) => !keys[l].has(k)).map((k) => `${l}: ${k}`));
}

export function sitePages({ root }) {
  let server = null;
  const load = async (file) => {
    const full = resolve(root, file);
    // em dev, o grafo de módulos do Vite recarrega o módulo da página e o JSON dela quando mudam
    // o nome vem do marcador [\w-]+ dos nossos próprios arquivos HTML, dentro de src/site
    // eslint-disable-next-line no-unsanitized/method
    return server ? server.ssrLoadModule(full) : import(pathToFileURL(full).href);
  };
  const read = (f) => JSON.parse(readFileSync(resolve(root, "src/content", f), "utf8"));
  return {
    name: "site-pages",
    configureServer(s) {
      server = s;
      s.watcher.add(resolve(root, "src/site"));
      s.watcher.add(resolve(root, "src/content"));
      s.watcher.add(resolve(root, "src/i18n"));
      s.watcher.on("change", (file) => {
        if (/[\\/]src[\\/](site|content|i18n)[\\/]/.test(file)) s.ws.send({ type: "full-reload" });
      });
    },
    async buildStart() {
      const missing = missingEventEntries(root, read("events.json"));
      if (missing.length) this.error(`evento sem página no build (crie o arquivo com <!-- @site event -->): ${missing.join(", ")}`);
      // todo texto do site nos três idiomas (AR-5): a barra de idioma, o 404, os eventos…
      const gaps = missingSiteKeys(root);
      if (gaps.length) this.error(`texto do site sem tradução: ${gaps.join(", ")}`);
      // a raiz como ícone do site e do painel, todos os tamanhos no lugar (história 4.8)
      const icons = iconProblems(root);
      if (icons.length) this.error(`ícones: ${icons.join(" | ")}`);
      // o lint de conteúdo (NFR-34): uma palavra proibida da casa nunca chega ao site
      const { lintContent } = await load("src/site/lint.js");
      const problems = lintContent({ content: read("content.json"), menu: read("menu.json"), events: read("events.json") });
      if (problems.length) this.error(`texto público com palavra que a casa não usa: ${problems.map((p) => `${p.field}: ${p.message}`).join(" | ")}`);
    },
    transformIndexHtml: {
      order: "pre",
      async handler(html, ctx) {
        const match = html.match(MARKER);
        if (!match) return html;
        const locale = localeOfPath(ctx.path);
        const { translator, HTML_LANG, escape } = await load("src/site/render.js");
        const page = (await load(`src/site/pages/${match[1]}.js`))[exportName(match[1])];
        const house = read("house.json");
        const content = read("content.json");
        const seo = read("seo.json");
        const menu = read("menu.json");
        const privacy = read("privacy.json");
        const events = read("events.json");
        const t = translator(locale);
        const out = page({ house, content, menu, privacy, events, locale, t, path: ctx.path });
        const entry = seo.pages.find((p) => p.route === out.route);
        const title = out.title || entry?.title?.[locale] || entry?.title?.pt || house.name;
        return `<!doctype html>
<html lang="${HTML_LANG[locale]}" data-locale="${locale}">
<head>
  <!-- @include head.html -->
  <link rel="manifest" href="/site.webmanifest">
  <title>${escape(title)}</title>
  <script type="module" src="${out.script}"></script>
</head>
<body class="${escape(out.bodyClass)}">
${out.body}
</body>
</html>
`;
      },
    },
  };
}
