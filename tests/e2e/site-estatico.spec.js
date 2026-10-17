// O site sem a API (histórias 4.1 e 4.6, AR-11 a AR-13): monta o build de verdade
// (`vite build --mode site`) numa pasta à parte, serve com o `vite preview` e confere no
// navegador que as páginas abrem sem chamar a API, sem "Sem conexão" nem erro técnico, e que
// "Reservar mesa" vai ao WhatsApp da casa com a mensagem pronta.
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { build, preview } from "vite";

test.describe.configure({ mode: "serial" });

let server;
let base;
let outDir;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  const info = test.info();
  outDir = join(tmpdir(), `territorio-site-estatico-${process.pid}-${info.workerIndex}`);
  await build({ mode: "site", logLevel: "error", build: { outDir, emptyOutDir: true } });
  server = await preview({ mode: "site", logLevel: "error", build: { outDir }, preview: { port: 5190 + info.workerIndex, strictPort: false } });
  base = server.resolvedUrls.local[0].replace(/\/$/, "");
});

test.afterAll(async () => {
  await server?.close();
  if (outDir) await rm(outDir, { recursive: true, force: true });
});

/** Nada sai para a API nem para o WhatsApp de verdade: o wa.me responde aqui mesmo. */
async function watch(page) {
  const api = [];
  const errors = [];
  page.on("request", (r) => /\/api\//.test(new URL(r.url()).pathname) && api.push(r.url()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route(/https:\/\/(wa\.me|api\.whatsapp\.com)\//, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>WhatsApp</title>" }));
  return { api, errors };
}

const textOf = (href) => new URL(href).searchParams.get("text") || "";

test("as páginas públicas abrem inteiras, sem chamar a API e sem erro na tela", async ({ page }) => {
  const seen = await watch(page);
  for (const path of ["/", "/cardapio/", "/eventos/", "/es/", "/en/", "/privacidade/"]) {
    const answer = await page.goto(`${base}${path}`);
    expect(answer.status(), path).toBe(200);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main"), path).not.toBeEmpty();
    await expect(page.locator("body"), path).not.toContainText(/Sem conexão|Sin conexión|No connection|Algo deu errado/);
  }
  // as partes vivas ficam com o valor impresso: o endereço e o "Onde fica" seguem na capa
  await page.goto(`${base}/`);
  await expect(page.locator(".onde__endereco")).toContainText("Rua Sérgio Roncato, 703");
  expect(seen.api).toEqual([]);
  expect(seen.errors).toEqual([]);
});

test("\"Reservar mesa\" vai ao WhatsApp da casa com a mensagem pronta, sem abrir a janela", async ({ page }) => {
  await watch(page);
  await page.goto(`${base}/`);
  await page.waitForLoadState("networkidle");
  const book = page.locator(".capa a", { hasText: "Reservar mesa" });
  const href = await book.getAttribute("href");
  expect(href).toMatch(/^https:\/\/wa\.me\/\d+\?text=/);
  expect(textOf(href)).toBe("Oi! Queria reservar uma mesa.");
  await book.click();
  await expect(page).toHaveURL(/(wa\.me|api\.whatsapp\.com)\/.*Queria/);
  expect(await page.locator("dialog[open]").count()).toBe(0);
});

test("em espanhol e em inglês a mensagem pronta vem na língua da página", async ({ page }) => {
  await watch(page);
  await page.goto(`${base}/es/`);
  await page.waitForLoadState("networkidle");
  expect(textOf(await page.locator(".capa a", { hasText: "Reservar mesa" }).getAttribute("href"))).toMatch(/^¡Hola! /);
  await page.goto(`${base}/en/`);
  await page.waitForLoadState("networkidle");
  expect(textOf(await page.locator(".capa a", { hasText: "Book a table" }).getAttribute("href"))).toMatch(/^Hi! /);
});

test("o \"Reservar\" de um evento leva o dia na mensagem", async ({ page }) => {
  await watch(page);
  await page.goto(`${base}/eventos/`);
  await page.waitForLoadState("networkidle");
  const hrefs = await page.locator("a[href*='wa.me']").evaluateAll((as) => as.map((a) => a.href));
  const withDay = hrefs.filter((h) => / em \d{2}\/\d{2}\.$/.test(textOf(h)));
  expect(withDay.length).toBeGreaterThan(0);
  expect(textOf(withDay[0])).toMatch(/em \d{2}\/\d{2}\.$/);
});

test("/reservar mostra o aviso do catálogo com pessoas e dia já na mensagem", async ({ page }) => {
  const seen = await watch(page);
  await page.goto(`${base}/reservar/?pessoas=4&dia=2026-10-23`);
  const notice = page.locator('[data-aviso="static_mode"]');
  await expect(notice).toContainText("Por enquanto, a reserva é pelo WhatsApp");
  const href = await notice.locator("a", { hasText: "Chamar no WhatsApp" }).getAttribute("href");
  expect(textOf(href)).toMatch(/4 pessoas.*23\/10/);
  expect(seen.api).toEqual([]);
});

test("conta e links da mensagem mostram o caminho do WhatsApp, nunca \"Sem conexão\"", async ({ page }) => {
  const seen = await watch(page);
  for (const path of ["/entrar/", "/minhas-reservas/", "/confirmar/?t=abc", "/espera/?t=abc", "/r/?t=abc"]) {
    await page.goto(`${base}${path}`);
    const notice = page.locator('[data-aviso="static_mode"]');
    await expect(notice, path).toBeVisible();
    await expect(notice.locator("a[href*='wa.me']"), path).toHaveCount(1);
    await expect(page.locator("body"), path).not.toContainText(/Sem conexão|Tentar de novo/);
  }
  expect(seen.api).toEqual([]);
  expect(seen.errors).toEqual([]);
});
