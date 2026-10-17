// Salão (Épico 6): o salão da noite com o estado de cada mesa em palavras, sentar um grupo
// sem reserva, "Chegou" pela busca, liberar uma mesa, a folha da noite e os estados vazio
// e de erro. Toda página abre na noite da demonstração (hoje às 20:40, com ?agora=), para as
// mesas semeadas serem conhecidas seja qual for a hora (S1 prestes a ser liberada, Q7 livre, Paula na S6 às 21:00).
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { demoNight } from "./noite-helpers.js";

async function serious(page) {
  // uma troca de tema esmaece as cores e a capa entra aos poucos; medido no meio, o contraste sai errado
  // (animações sem fim e guiadas pela rolagem, como as raízes girando, nunca acabam: ficam como estão)
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

async function open(page, url) {
  const agora = await demoNight(page);
  await page.goto(`${url}&${agora}`);
  await page.waitForSelector("html[data-ready]");
}

async function bothThemes(page) {
  expect(await serious(page)).toEqual([]);
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await serious(page)).toEqual([]);
  await page.emulateMedia({ colorScheme: "light" });
}

/** A mesa na planta (computador) ou a sua linha na lista (celular): só a visível conta. */
const table = (page, code) => page.locator(`.table-node[data-mesa="${code}"], .linha-mesa[data-mesa="${code}"]`).locator("visible=true");

test("dono vê a planta da noite com o estado de cada mesa em palavras", async ({ page }) => {
  await open(page, "/admin/salao?papel=dono&mock=normal");
  await expect(page.getByRole("heading", { level: 1, name: "Salão" })).toBeVisible();
  await expect(page.getByText(/Noite de/)).toBeVisible();
  await expect(table(page, "S1")).toContainText("para liberar");
  await expect(table(page, "Q7")).toContainText("livre");
  await expect(page.locator(".salao__resumo")).toContainText("sentadas");
  await bothThemes(page);
});

test("sentar sem reserva numa mesa livre fica gravado", async ({ page }) => {
  await open(page, "/admin/salao?papel=recepcao&mock=normal");
  await table(page, "Q7").click();
  const drawer = page.locator(".salao__gaveta");
  await expect(drawer.getByText("Mesa Q7")).toBeVisible();
  await drawer.getByRole("button", { name: "Sentar sem reserva" }).click();
  await drawer.getByRole("button", { name: "Mais uma pessoa" }).click();
  await expect(drawer.locator("output")).toHaveText("3");
  await bothThemes(page);
  await drawer.getByRole("button", { name: "Sentar", exact: true }).click();
  await expect(table(page, "Q7")).toContainText("sentada");
  await page.reload();
  await page.waitForSelector("html[data-ready]");
  await expect(table(page, "Q7")).toContainText("sentada");
});

test("Quem chegou? acha a reserva e o Chegou abre a mesa", async ({ page }) => {
  await open(page, "/admin/salao?papel=recepcao&mock=normal");
  const search = page.getByRole("searchbox", { name: "Quem chegou?" });
  await search.fill("Paula");
  await expect(page.locator(".salao__achados")).toContainText("Paula");
  await search.press("Enter");
  const drawer = page.locator(".salao__gaveta");
  await expect(drawer.getByRole("heading", { name: "Chegou: Paula" })).toBeVisible();
  await drawer.getByRole("button", { name: /Confirmar chegada na S6/ }).click();
  await expect(page.locator(".toast").getByText("Chegou", { exact: true })).toBeVisible();
  await expect(table(page, "S6")).toContainText("sentada");
});

test("liberar a mesa é um toque, com desfazer", async ({ page }) => {
  await open(page, "/admin/salao?papel=dono&mock=normal");
  await table(page, "S1").click();
  await page.locator(".salao__gaveta").getByRole("button", { name: "Liberar mesa" }).click();
  await expect(page.locator(".toast").getByText("Mesa S1 liberada")).toBeVisible();
  await expect(table(page, "S1")).toContainText("livre");
  await page.locator(".toast").getByRole("button", { name: "Desfazer" }).click();
  await expect(table(page, "S1")).not.toContainText("livre");
});

test("folha da noite para imprimir, sem o texto de saúde", async ({ page }) => {
  await open(page, "/admin/salao/folha?papel=recepcao&mock=normal");
  await expect(page.getByRole("heading", { name: /Folha da noite/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Imprimir ou salvar PDF" })).toBeVisible();
  await expect(page.locator(".folha")).not.toContainText("vegetariano");
  await bothThemes(page);
});

test("noite sem plano mostra o vazio com a Agenda", async ({ page }) => {
  await open(page, "/admin/salao?papel=gerente&mock=vazio");
  await expect(page.getByText("Sem planta para esta noite.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Abrir a Agenda" })).toBeVisible();
  await bothThemes(page);
});

test("com a simulação em erro, aparece a frase da casa, nunca o texto do servidor", async ({ page }) => {
  await open(page, "/admin/salao?papel=dono&mock=erro");
  await expect(page.getByRole("button", { name: "Tentar de novo" })).toBeVisible();
  await expect(page.getByText("Erro simulado pela demonstração")).toHaveCount(0);
});
