import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { msw } from "msw/vite";
import { defineConfig, loadEnv } from "vite";
import { seo } from "./scripts/seo/vite-plugin-seo.js";
import { notFoundPages } from "./scripts/site/vite-plugin-not-found.js";
import { sitePages } from "./scripts/site/vite-plugin-pages.js";
import { refuseInProduction } from "./src/services/api/rotas-reais.js";

const root = dirname(fileURLToPath(import.meta.url));
const NOT_PAGES = new Set([
  ".git", ".githooks", "node_modules", "dist", "src", "public", "docs", "scripts", "tests", "assets-src", "playwright-report", "test-results",
]);

// Todo index.html abaixo da raiz é uma página: o site e o painel têm várias páginas.
function findPages(dir = root) {
  const pages = {};
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!NOT_PAGES.has(name)) Object.assign(pages, findPages(full));
    } else if (name === "index.html" || (name === "404.html" && [root, join(root, "es"), join(root, "en")].includes(dir))) {
      const key = relative(root, full).replace(/\\/g, "/").replace(/\.html$/, "");
      pages[key] = full;
    }
  }
  return pages;
}

// <!-- @include cabecalho.html --> puxa um arquivo de src/partials, assim nenhuma página repete HTML comum.
function partials() {
  const dir = resolve(root, "src/partials");
  const pattern = /<!--\s*@include\s+([\w./-]+)\s*-->/g;
  const expand = (html, depth = 0) => {
    if (depth > 5) throw new Error("partials: include nested too deep");
    return html.replace(pattern, (_, file) => expand(readFileSync(join(dir, file), "utf8"), depth + 1));
  };
  return {
    name: "partials",
    transformIndexHtml: { order: "pre", handler: (html) => expand(html) },
    configureServer(server) {
      server.watcher.add(dir);
      server.watcher.on("change", (file) => {
        if (resolve(file).startsWith(dir)) server.ws.send({ type: "full-reload" });
      });
    },
  };
}

// O painel é uma página só, com rotas próprias: /admin/reservas, /admin/salao … não têm arquivo,
// então os servidores de dev e de preview respondem com admin/index.html (a hospedagem faz igual).
function adminRoutes() {
  const AREA = /^\/admin(\/[^./]+)*\/?$/;
  const rewrite = (req, _res, next) => {
    const [path, query = ""] = (req.url || "").split("?");
    if (path !== "/admin/" && AREA.test(path)) req.url = `/admin/${query ? `?${query}` : ""}`;
    next();
  };
  return {
    name: "admin-routes",
    configureServer: (server) => void server.middlewares.use(rewrite),
    configurePreviewServer: (server) => void server.middlewares.use(rewrite),
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root);
  if (mode === "production" && env.VITE_API_MODE === "mock") {
    throw new Error("Build de produção com VITE_API_MODE=mock. Para a demonstração, use `npm run build:demo`.");
  }
  // as operações que já estão no servidor de verdade só fazem sentido com o mock ligado (história 4.1)
  refuseInProduction(mode);
  // `--mode site` (.env.site): o site sem a API, o adaptador estático (história 4.1, AR-11)
  if ((mode === "site" || mode === "site-ar") && env.VITE_API_MODE !== "static") {
    throw new Error("O modo site é o site sem API: VITE_API_MODE=static em .env.site.");
  }
  // Só os builds do domínio de verdade entram no Google (AD-36): produção e `site-ar`, o
  // site sem a API que vai ao ar primeiro (entrega 1).
  const site = mode === "production" || mode === "site-ar" ? loadEnv(mode, root, "").SITE_URL || undefined : undefined;
  return {
    appType: "mpa",
    plugins: [adminRoutes(), notFoundPages({ root }), sitePages({ root }), partials(), seo({ root, site }), msw()],
    build: {
      sourcemap: mode !== "production",
      rolldownOptions: { input: findPages() },
    },
    server: { port: 5173 },
  };
});
