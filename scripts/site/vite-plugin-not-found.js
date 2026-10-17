// Plugin do Vite: o 404 da casa com status 404 de verdade, no idioma do endereço
// (história 4.7), para o servidor de dev e para o `vite preview` do build. Em produção o nginx
// faz o mesmo (10.3). Um evento que o build ainda não conhece (/eventos/{slug}/) recebe a
// casca de evento, que o script da página preenche pela API ou deixa como o texto do 404.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// o que nunca é página: os arquivos do próprio Vite, os fontes, a API, o painel, os arquivos estáticos
const NOT_A_PAGE = /^\/(@|src\/|node_modules\/|api\/|admin(\/|$)|_ds(\/|$)|__)/;
const EVENT = /^\/(?:(es|en)\/)?eventos\/([^/]+)\/?$/;

const localeOf = (path) => (path.match(/^\/(es|en)(\/|$)/) || [])[1] || "pt";
const prefix = (locale) => (locale === "pt" ? "" : `${locale}/`);

/**
 * O que fazer com um GET para `path`, dada a pasta das páginas (`dir`):
 * { action: "next" } quando existe ou não é página, { action: "event", url } para a casca
 * de evento, ou { action: "404", locale }.
 */
export function decide(dir, rawPath) {
  let path;
  try {
    path = decodeURIComponent(rawPath || "/");
  } catch {
    return { action: "404", locale: "pt" };
  }
  if (NOT_A_PAGE.test(path)) return { action: "next" };
  // um arquivo com extensão diferente de .html é arquivo estático: o servidor responde
  if (/\.[a-z0-9]+$/i.test(path) && !path.endsWith(".html")) return { action: "next" };
  const clean = path.replace(/\/+$/, "") || "/";
  const exists = clean.endsWith(".html") ? existsSync(join(dir, clean)) : existsSync(join(dir, clean, "index.html"));
  if (exists) return { action: "next" };
  const event = clean.match(EVENT);
  if (event && existsSync(join(dir, prefix(event[1] || "pt"), "eventos", "evento", "index.html"))) {
    return { action: "event", url: `/${prefix(event[1] || "pt")}eventos/evento/` };
  }
  return { action: "404", locale: localeOf(path) };
}

export function notFoundPages({ root }) {
  const handle = (dir, send404) => async (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const [path, query = ""] = (req.url || "/").split("?");
    const accepts = String(req.headers.accept || "");
    // só pedidos de página: os navegadores pedem text/html, e um fetch simples de página também
    if (accepts && !accepts.includes("text/html") && !accepts.includes("*/*")) return next();
    const what = decide(dir(), path);
    if (what.action === "next") return next();
    if (what.action === "event") {
      req.url = `${what.url}${query ? `?${query}` : ""}`;
      return next();
    }
    try {
      const html = await send404(what.locale, req);
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(req.method === "HEAD" ? undefined : html);
    } catch (error) {
      next(error);
    }
  };
  return {
    name: "not-found-pages",
    configureServer(server) {
      server.middlewares.use(
        handle(
          () => root,
          (locale, req) => {
            const file = resolve(root, `${prefix(locale)}404.html`);
            return server.transformIndexHtml(`/${prefix(locale)}404.html`, readFileSync(file, "utf8"), req.originalUrl);
          },
        ),
      );
    },
    configurePreviewServer(server) {
      const outDir = () => resolve(root, server.config.build.outDir || "dist");
      server.middlewares.use(handle(outDir, async (locale) => readFileSync(join(outDir(), `${prefix(locale)}404.html`), "utf8")));
    },
  };
}
