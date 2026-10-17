// Plugin do Vite: escreve as tags de busca de cada página no <head> dela e gera robots.txt,
// sitemap.xml e llms.txt no build, tudo a partir de src/content (AD-36).
// SITE_URL (https://territoriofoz.com.br, no .env.production) liga a indexação; sem ele tudo é noindex,
// assim dev, demo e homolog nunca vão parar no Google.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eventPage, headTags, llmsTxt, pageFor, robotsTxt, sitemapXml } from "./seo.js";

function load(root) {
  const read = (file) => JSON.parse(readFileSync(resolve(root, "src/content", file), "utf8"));
  return { house: read("house.json"), seo: read("seo.json"), menu: read("menu.json"), events: read("events.json") };
}

function routeOf(path) {
  const route = path.replace(/\\/g, "/").replace(/index\.html$/, "").replace(/\.html$/, "/");
  return route.startsWith("/") ? route : `/${route}`;
}

/** "/es/cardapio/" → { locale: "es", route: "/cardapio/" }; as páginas em português não têm prefixo. */
function splitLocale(route) {
  const m = route.match(/^\/(es|en)(\/.*)$/);
  return m ? { locale: m[1], route: m[2] } : { locale: null, route };
}

export function seo({ root, site }) {
  let pages = [];
  return {
    name: "seo",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        const { house, seo: manifest, menu, events } = load(root);
        const { locale, route } = splitLocale(routeOf(ctx.path));
        const page = pageFor(manifest, route) ?? eventPage(events, route) ?? { route, index: false };
        const tags = headTags({ house, seo: manifest, page, locale: locale || manifest.default_locale, site, menu });
        return html
          .replace(/\s*<meta name="robots"[^>]*>/i, "")
          .replace("</head>", `${tags}\n</head>`);
      },
    },
    buildStart(options) {
      // as entradas HTML ("index", "es/index", "_ds/index"): as páginas que este build tem
      pages = Object.keys(options.input || {});
    },
    generateBundle() {
      const { house, seo: manifest } = load(root);
      // uma rota indexável tem que existir, senão o sitemap mandaria o Google para um 404
      const built = new Set(pages.map((key) => splitLocale(routeOf(`${key}.html`)).route));
      const missing = manifest.pages.filter((p) => p.index && !built.has(p.route)).map((p) => p.route);
      if (site && missing.length) this.error(`seo.json marca como indexável uma página que não existe: ${missing.join(", ")}`);
      this.emitFile({ type: "asset", fileName: "robots.txt", source: robotsTxt({ seo: manifest, site }) });
      if (site) {
        // as páginas de evento do build vão para o sitemap junto com as páginas fixas
        const { events } = load(root);
        const withEvents = { ...manifest, pages: [...manifest.pages, ...(events.events || []).map((e) => eventPage(events, `/eventos/${e.slug}/`))] };
        this.emitFile({ type: "asset", fileName: "sitemap.xml", source: sitemapXml({ seo: withEvents, site }) });
        this.emitFile({ type: "asset", fileName: "llms.txt", source: llmsTxt({ house, seo: manifest, site }) });
      }
    },
  };
}
