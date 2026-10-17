// Registro (história 1.13): o registro do dono com filtros, "trocado" para segredos, a exportação
// com a confirmação de identidade, e os estados.
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

async function confirmIdentity(page) {
  const dialog = page.getByRole("dialog", { name: /Confirme|Exportar/ });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Senha").fill("admin");
  await dialog.getByLabel("Código do aplicativo").fill("123456");
  await dialog.getByRole("button", { name: "Confirmar" }).click();
  await expect(dialog).toBeHidden();
}

test("dono filtra o registro, vê antes e depois e exporta", async ({ page }) => {
  await open(page, "/admin/registro?papel=dono&mock=normal");
  await expect(page.getByRole("heading", { level: 1, name: "Registro" })).toBeVisible();
  await expect(page.getByText("Mudou a tolerância de atraso")).toBeVisible();
  await bothThemes(page);

  await page.getByLabel("Tipo de ação").selectOption("settings");
  await expect(page.getByText("Trocou a chave do WhatsApp")).toBeVisible();
  await expect(page.getByText(/^Chegou:/)).toHaveCount(0);
  const secret = page.locator(".registro__item", { hasText: "Trocou a chave do WhatsApp" });
  await secret.getByText("Antes e depois").click();
  await expect(secret.getByText("trocado")).toBeVisible();
  const tolerance = page.locator(".registro__item", { hasText: "Mudou a tolerância de atraso" });
  await tolerance.getByText("Antes e depois").click();
  await expect(tolerance.getByRole("row", { name: /Tolerância \(min\) 15 20/ })).toBeVisible();

  await page.getByLabel("Aparelho").selectOption("Tablet do salão");
  await expect(page.getByText("Nenhuma ação com esses filtros")).toBeVisible();
  await page.locator(".vazio").getByRole("button", { name: "Limpar filtros" }).click();
  await expect(page.getByText("Mudou a tolerância de atraso")).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar" }).click();
  await confirmIdentity(page);
  expect((await download).suggestedFilename()).toMatch(/^registro-territorio-.*\.csv$/);
  await expect(page.locator(".registro__resumo", { hasText: /Exportou o registro/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Editar|Apagar/ })).toHaveCount(0);
});

test("gerente e recepção não abrem o Registro", async ({ page }) => {
  await open(page, "/admin/registro?papel=gerente&mock=normal");
  await expect(page.getByRole("heading", { level: 1, name: "Essa parte é de outro perfil da equipe" })).toBeVisible();
  await open(page, "/admin/registro?papel=recepcao&mock=normal");
  await expect(page.getByRole("heading", { level: 1, name: "Essa parte é de outro perfil da equipe" })).toBeVisible();
});

test("registro vazio diz o que aparece ali", async ({ page }) => {
  await open(page, "/admin/registro?papel=dono&mock=vazio");
  await expect(page.getByText("Nenhuma ação registrada ainda")).toBeVisible();
  await bothThemes(page);
});

test("API fora mostra o aviso da casa no lugar", async ({ page }) => {
  await open(page, "/admin/registro?papel=dono&mock=normal");
  await expect(page.getByText("Mudou a tolerância de atraso")).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem("territorio:mock-scenario", JSON.stringify("erro")));
  await page.evaluate(() => history.replaceState(null, "", "/admin/registro"));
  await page.getByLabel("Tipo de ação").selectOption("user");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("O registro não abriu");
  await expect(alert).not.toContainText("Erro simulado");
  await bothThemes(page);
});
