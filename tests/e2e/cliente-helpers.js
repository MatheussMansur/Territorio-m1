// Passos comuns das specs do cliente (reserva, conta, links, estados de borda). Não é uma spec.
import AxeBuilder from "@axe-core/playwright";
import { expect as base, test as baseTest } from "@playwright/test";

// o servidor de dev é compartilhado e compila sob demanda: as specs do cliente ganham folga
export const expect = base.configure({ timeout: 10_000 });
export const test = baseTest;

export const NOW = "agora=2026-10-14T15:00"; // uma tarde de quarta, a casa abre às 19:00

export async function serious(page) {
  // uma troca de tema esmaece as cores; medido no meio, o contraste sai errado
  await page.waitForFunction(() => document.getAnimations().every((a) => !(a instanceof CSSTransition) || a.playState !== "running"));
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  return results.violations
    .filter((v) => ["serious", "critical"].includes(v.impact))
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
}

/** axe no tema claro e no escuro. */
export async function seriousBothThemes(page) {
  const found = [];
  for (const theme of ["claro", "escuro"]) {
    await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
    found.push(...(await serious(page)).map((v) => `${theme}: ${v}`));
  }
  await page.evaluate(() => delete document.documentElement.dataset.theme);
  return found;
}

/** A escolha de cookies já feita (só os necessários), para o aviso não atrapalhar. */
export async function consent(page) {
  await page.addInitScript(() => {
    if (document.cookie.includes("trt_consent=")) return;
    const choice = { version: "2026-10-14", necessary: true, remember: false, measurement: false, id: "teste" };
    document.cookie = `trt_consent=${encodeURIComponent(JSON.stringify(choice))}; Path=/; SameSite=Lax`;
  });
}

export async function open(page, path) {
  await page.goto(path);
  await page.waitForSelector("html[data-ready]");
}

/** Faz o mock responder um caso difícil uma vez (veja src/mocks/handlers/customer.js). */
export async function force(page, ...names) {
  await page.evaluate((list) => {
    const now = JSON.parse(sessionStorage.getItem("territorio:mock-forcar") || "[]");
    sessionStorage.setItem("territorio:mock-forcar", JSON.stringify([...now, ...list]));
  }, names);
}

/** Muda os dados do mock (ficam no localStorage) e recarrega, para a página ler do zero. */
export async function patchDb(page, fn, arg) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(
    ([source, value]) => {
      const db = JSON.parse(localStorage.getItem("territorio:mock-db"));
      new Function("db", "arg", source)(db, value);
      localStorage.setItem("territorio:mock-db", JSON.stringify(db));
    },
    [`(${fn.toString()})(db, arg)`, arg],
  );
  await page.reload();
  await page.waitForSelector("html[data-ready]");
}

/** Pessoas, o primeiro dia aberto e um horário (o primeiro livre, ou o informado); devolve o horário. */
export async function choose(page, { path = "/reservar/", time = null, party = 2, query = "", date = null } = {}) {
  await open(page, `${path}?mock=normal&${NOW}${query}`);
  await page.locator(`.tile[data-value="${party}"]`).click();
  await page.locator(date ? `.day[data-value="${date}"]` : ".calendario__grade .day:not(.is-closed):not(.is-full)").first().click();
  const slot = time ? page.locator(`.slot[data-value="${time}"]`) : page.locator('.slot:not(.is-full)[aria-disabled="false"]').first();
  const chosen = await slot.getAttribute("data-value");
  await slot.click();
  await expect(page.locator("#reserva-nome")).toBeVisible(); // os dados abrem logo abaixo do horário
  return chosen;
}

/** Nome, WhatsApp e o combinado, depois o código: termina no comprovante. */
export async function fillAndBook(page, { name = "Ana Souza", phone = "45988887766", code = "123456" } = {}) {
  await page.locator("#reserva-nome").fill(name);
  if (await page.locator("#reserva-tel").count()) await page.locator("#reserva-tel").fill(phone);
  await page.locator("input[name=combinado]").check();
  await page.locator(".reserva__dados button[type=submit]").click();
  const otp = page.locator(".otp__input");
  if (await otp.waitFor({ timeout: 4000 }).then(() => true, () => false)) await otp.fill(code);
}

/** Uma reserva inteira pela página, com login no fim; devolve o código do comprovante e o seu link. */
export async function bookOne(page, options = {}) {
  await choose(page, options);
  await fillAndBook(page, options);
  await expect(page.locator(".receipt__code")).toHaveText(/^TR-\d+$/);
  const code = await page.locator(".receipt__code").textContent();
  const receipt = await page.locator(`.reserva__pronto a[href*="/r/?t="]`).first().getAttribute("href");
  return { code, receipt };
}

/** Os links do mock para uma reserva (como as mensagens de WhatsApp levam). */
export async function linksOf(page, code) {
  return page.evaluate(async (c) => {
    const mine = await (await fetch("/api/v1/reservations/mine")).json();
    const r = mine.items.find((x) => x.code === c);
    return r.demo;
  }, code);
}

/** O ponto mais largo do conteúdo da página (o cabeçalho comum é conferido na spec do próprio site). */
export const contentRight = (page) =>
  page.evaluate(() => Math.max(0, ...[...document.querySelectorAll("main *")].map((e) => Math.round(e.getBoundingClientRect().right))));
