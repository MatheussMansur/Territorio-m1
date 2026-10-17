// Espera (histórias 5.12 e 5.13): a fila por horário com as posições, oferecer uma mesa, o
// WhatsApp que falta, um grupo na porta, tirar alguém da fila e o estado vazio.
// Toda página abre na noite da demonstração (hoje às 20:40, com ?agora=), para a fila ser a semeada
// seja qual for a hora.
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

const row = (page, name) => page.locator(".espera__linha", { hasText: name });

test("a fila por horário com posição e a oferta em curso", async ({ page }) => {
  await open(page, "/admin/espera?papel=dono&mock=normal");
  await expect(page.getByRole("heading", { level: 1, name: "Espera" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^20:00/ })).toBeVisible();
  await expect(row(page, "Camila")).toContainText("1º");
  await expect(row(page, "Letícia")).toContainText("oferecida");
  await bothThemes(page);
});

test("oferecer uma mesa livre por WhatsApp", async ({ page }) => {
  await open(page, "/admin/espera?papel=recepcao&mock=normal");
  await row(page, "Camila").getByRole("button", { name: "Oferecer mesa" }).click();
  const drawer = page.locator(".espera__gaveta");
  await drawer.getByRole("button", { name: /^Q7/ }).click();
  await bothThemes(page);
  await drawer.getByRole("button", { name: "Mandar oferta" }).click();
  await expect(page.locator(".toast").getByText("Oferta enviada")).toBeVisible();
  await expect(row(page, "Camila")).toContainText("oferecida");
});

test("sem WhatsApp confirmado a oferta não sai", async ({ page }) => {
  await open(page, "/admin/espera?papel=recepcao&mock=normal");
  await row(page, "Sabrina").getByRole("button", { name: "Oferecer mesa" }).click();
  const drawer = page.locator(".espera__gaveta");
  await drawer.getByRole("button", { name: /^Q7/ }).click();
  await drawer.getByRole("button", { name: "Mandar oferta" }).click();
  await expect(page.locator(".toast").getByText("Esse cliente não tem WhatsApp confirmado")).toBeVisible();
});

test("pôr na espera quem chegou à porta e tirar alguém da fila", async ({ page }) => {
  await open(page, "/admin/espera?papel=recepcao&mock=normal");
  await page.getByRole("button", { name: "Pôr na espera quem chegou" }).click();
  const drawer = page.locator(".espera__gaveta");
  await drawer.getByRole("button", { name: "Pôr na espera" }).click();
  await expect(drawer.getByText("Escreva o nome de quem espera.")).toBeVisible();
  await drawer.getByRole("textbox", { name: "Nome" }).fill("Marta");
  await bothThemes(page);
  await drawer.getByRole("button", { name: "Pôr na espera" }).click();
  await expect(page.locator(".toast").getByText("Na espera")).toBeVisible();
  await expect(row(page, "Marta")).toContainText("na porta");
  // o aviso sai antes do próximo toque, para nunca cobrir a fila
  await expect(page.locator(".toast")).toHaveCount(0, { timeout: 8_000 });

  await row(page, "Igor").getByRole("button", { name: "Tirar da fila" }).click();
  await drawer.getByRole("button", { name: "Tirar da fila" }).click();
  await page.locator(".dialog--confirm").getByRole("button", { name: "Tirar da fila" }).click();
  await expect(page.locator(".toast").getByText("Saiu da fila")).toBeVisible();
  await expect(row(page, "Igor")).toHaveCount(0);
});

test("ninguém esperando mostra o vazio com o próximo passo", async ({ page }) => {
  await open(page, "/admin/espera?papel=recepcao&mock=vazio");
  await expect(page.getByText("Ninguém esperando agora.")).toBeVisible();
  await bothThemes(page);
});

// ---- histórias 5.12 e 6.9 em Espera ----------------------------------------------------------

test("oferta que o WhatsApp não entregou aparece na linha, com o próximo passo", async ({ page }) => {
  await open(page, "/admin/espera?papel=recepcao&mock=normal");
  const leticia = row(page, "Letícia");
  await expect(leticia).toContainText("oferta não entregue");
  await expect(leticia).toContainText("Chame na porta ou ofereça a mesa a outra pessoa");
  await bothThemes(page);
});

test("avisar quem espera na porta que a mesa está pronta, sem mostrar o telefone", async ({ page }) => {
  await open(page, "/admin/espera?papel=recepcao&mock=normal");
  const fernando = row(page, "Fernando");
  await expect(fernando).not.toContainText("99987");
  await fernando.getByRole("button", { name: "Avisar que a mesa está pronta" }).click();
  await expect(page.locator(".toast").getByText("Mensagem enviada")).toBeVisible();
  await expect(fernando).toContainText("avisado às");
  await fernando.getByRole("button", { name: "Avisar que a mesa está pronta" }).click();
  const again = page.getByRole("dialog", { name: "Mandar de novo?" });
  await expect(again).toContainText("Você já mandou essa às");
  await again.getByRole("button", { name: "Voltar" }).click();
  // sem telefone, o botão não aparece
  await expect(row(page, "Família Okada").getByRole("button", { name: "Avisar que a mesa está pronta" })).toHaveCount(0);
});
