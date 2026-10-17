// Sistema (história 1.14): cada item com "em dia" ou "com problema" e a hora, os erros
// recentes, os aparelhos com a diferença de relógio, e os estados.
import AxeBuilder from "@axe-core/playwright";
import { expect as baseExpect, test } from "@playwright/test";

// o servidor de dev é compartilhado com outras baterias: dá folga às respostas lentas
const expect = baseExpect.configure({ timeout: 10_000 });
test.describe.configure({ timeout: 90_000 });

async function serious(page) {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.playState !== "running" || a.timeline !== document.timeline || a.effect?.getTiming().iterations === Infinity),
  );
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  return results.violations
    .filter((v) => ["serious", "critical"].includes(v.impact))
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
}

async function bothThemes(page) {
  expect(await serious(page)).toEqual([]);
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await serious(page)).toEqual([]);
  await page.emulateMedia({ colorScheme: "light" });
}

async function open(page, url) {
  // a barra da demonstração fica dobrada, para nunca cobrir o que o teste clica
  await page.addInitScript(() => localStorage.setItem("territorio:demo-open", "false"));
  await page.goto(url);
  await page.waitForSelector("html[data-ready]");
}

test("dono vê o estado da casa e os aparelhos", async ({ page }) => {
  await open(page, "/admin/sistema?papel=dono&mock=normal");
  await expect(page.getByRole("heading", { level: 1, name: "Sistema" })).toBeVisible();
  const items = page.locator(".sistema__item");
  await expect(items).toHaveCount(6);
  await expect(items.filter({ hasText: "WhatsApp" })).toContainText("em dia");
  await expect(items.filter({ hasText: "Teste de restauração" })).toContainText("com problema");
  await expect(page.getByRole("heading", { name: "Aparelhos da casa" })).toBeVisible();
  await expect(page.locator(".sistema__erros li").first()).toBeVisible();
  await bothThemes(page);
  await page.getByRole("button", { name: "Conferir de novo" }).click();
  await expect(page.locator(".sistema__conferido")).toContainText("conferido");
});

test("gerente não abre o Sistema", async ({ page }) => {
  await open(page, "/admin/sistema?papel=gerente&mock=normal");
  await expect(page.getByRole("heading", { level: 1, name: "Essa parte é de outro perfil da equipe" })).toBeVisible();
});

test("casa nova: nada ligado e nenhum aparelho, com o próximo passo", async ({ page }) => {
  await open(page, "/admin/sistema?papel=dono&mock=vazio");
  await expect(page.locator(".sistema__item").first()).toContainText("não ligado");
  await expect(page.getByText("Nenhum aparelho da casa ainda")).toBeVisible();
  await bothThemes(page);
});

test("conferência fora: cada item com problema, sem quebrar a tela", async ({ page }) => {
  await open(page, "/admin/sistema?papel=dono&mock=normal");
  await expect(page.locator(".sistema__item")).toHaveCount(6);
  await page.evaluate(() => sessionStorage.setItem("territorio:mock-scenario", JSON.stringify("erro")));
  await page.evaluate(() => history.replaceState(null, "", "/admin/sistema"));
  await page.getByRole("button", { name: "Conferir de novo" }).click();
  await expect(page.getByText("A conferência não respondeu.")).toBeVisible();
  await expect(page.locator(".sistema__item.is-problema")).toHaveCount(6);
  await expect(page.getByText("Erro simulado")).toHaveCount(0);
  await bothThemes(page);
});
