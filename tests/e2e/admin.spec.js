// A moldura do painel (história 1.1): o menu por perfil, a tela de proibido, a entrada, o estado
// de erro, o "Mais" do celular com os links da própria pessoa, e axe nos dois temas, no
// computador e no celular. ?papel= pula o login (a entrada está em admin-entrada*.spec.js).
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// o Turnstile da Cloudflare na entrada, substituído para os testes nunca dependerem da internet
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.turnstile = { render: (el, o) => (setTimeout(() => o.callback("XXXX.DUMMY.TOKEN.XXXX"), 20), "w"), reset() {}, remove() {} };
  });
});

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
  await page.goto(url);
  await page.waitForSelector("html[data-ready]");
}

const isPhone = () => test.info().project.name === "celular";
/** O menu do aparelho: o trilho no computador, a barra mais o "Mais" no celular. */
const menu = (page) => page.locator(isPhone() ? ".barra, .mais" : ".trilho");

async function bothThemes(page) {
  expect(await serious(page)).toEqual([]);
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await serious(page)).toEqual([]);
  await page.emulateMedia({ colorScheme: "light" });
}

test("sem sessão, aparece a entrada da equipe", async ({ page }) => {
  await open(page, "/admin/?mock=normal");
  await expect(page.getByRole("heading", { level: 1, name: "Entrar no painel" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Território" })).toBeVisible();
  await expect(page.locator(".trilho, .barra")).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await bothThemes(page);
});

test("dono vê as 15 áreas, com Hoje ativo", async ({ page }) => {
  await open(page, "/admin/?papel=dono&mock=normal");
  await expect(page).toHaveTitle(/Território · Painel/);
  await expect(page.getByRole("heading", { level: 1, name: "Hoje" })).toBeVisible();
  if (isPhone()) {
    const bar = page.locator(".barra");
    await expect(bar.locator(".barra__item")).toHaveText(["Hoje", "Reservas", "Salão", "Mais"]);
    await expect(bar.getByRole("link", { name: "Hoje", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".mais .mais__item")).toHaveCount(12);
  } else {
    const rail = page.locator(".trilho");
    await expect(rail.locator(".trilho__item")).toHaveCount(15);
    await expect(rail.getByRole("link", { name: "Hoje", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".trilho [aria-current]")).toHaveCount(1);
  }
  await bothThemes(page);
});

test("recepção abre o Salão, que fica ativo", async ({ page }) => {
  await open(page, "/admin/salao?papel=recepcao&mock=normal");
  await expect(page.getByRole("heading", { level: 1, name: "Salão" })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Quem chegou?" })).toBeVisible();
  await expect(menu(page).getByRole("link", { name: "Salão", exact: true })).toHaveAttribute("aria-current", "page");
  // recepção: Hoje, Reservas, Salão, Espera e Cardápio
  const links = menu(page).locator("a.trilho__item, a.barra__item, a.mais__item");
  await expect(links).toHaveCount(5);
});

test("recepção num endereço de outro perfil vê a tela forbidden", async ({ page }) => {
  await open(page, "/admin/configuracoes?papel=recepcao&mock=normal");
  await expect(page.getByRole("heading", { level: 1, name: "Essa parte é de outro perfil da equipe" })).toBeVisible();
  await expect(page.getByText("Se precisar, peça ao dono ou ao gerente.")).toBeVisible();
  await expect(page.locator("[aria-current]")).toHaveCount(0);
  await expect(page.locator(".barra__item.is-dentro")).toHaveCount(0);
  await bothThemes(page);
  await page.getByRole("link", { name: "Voltar ao Hoje" }).click();
  await expect(page).toHaveURL(/\/admin\/$/);
  await expect(page.getByRole("heading", { level: 1, name: "Hoje" })).toBeVisible();
});

test("endereço desconhecido volta para Hoje", async ({ page }) => {
  await open(page, "/admin/xyz?papel=dono&mock=normal");
  await expect(page).toHaveURL((url) => url.pathname === "/admin/");
  await expect(page.getByRole("heading", { level: 1, name: "Hoje" })).toBeVisible();
});

test("API fora mostra o aviso com Tentar de novo", async ({ page }) => {
  await open(page, "/admin/?papel=dono&mock=erro");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Não deu para abrir o painel");
  await expect(alert).not.toContainText("Erro simulado");
  await expect(page.getByRole("button", { name: "Tentar de novo" })).toBeVisible();
  await bothThemes(page);
  // a API volta: tentar de novo abre o painel e o título pega o foco
  // (?mock= no endereço vence a escolha salva, então sai do endereço também)
  await page.evaluate(() => {
    sessionStorage.setItem("territorio:mock-scenario", JSON.stringify("normal"));
    history.replaceState(null, "", "/admin/");
  });
  await page.getByRole("button", { name: "Tentar de novo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Hoje" })).toBeFocused();
});

test("menu troca de área sem recarregar e o voltar do navegador funciona", async ({ page }) => {
  await open(page, "/admin/?papel=gerente&mock=normal");
  await page.evaluate(() => (window.__semRecarregar = true));
  await menu(page).getByRole("link", { name: "Reservas", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/reservas$/);
  await expect(page.getByRole("heading", { level: 1, name: "Reservas" })).toBeFocused();
  expect(await page.evaluate(() => window.__semRecarregar)).toBe(true);
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Hoje" })).toBeFocused();
  expect(await page.evaluate(() => window.__semRecarregar)).toBe(true);
});

test("\"Área da casa\" do rodapé abre o painel", async ({ page }) => {
  await open(page, "/?mock=normal");
  await page.getByRole("link", { name: "Área da casa" }).click();
  await expect(page).toHaveURL(/\/admin\/$/);
  await page.waitForSelector("html[data-ready]");
  await expect(page.getByRole("heading", { level: 1, name: "Entrar no painel" })).toBeVisible();
});

test("o papel fica guardado na aba", async ({ page }) => {
  await open(page, "/admin/?papel=gerente&mock=normal");
  await expect(page.getByRole("heading", { level: 1, name: "Hoje" })).toBeVisible();
  await open(page, "/admin/reservas");
  await expect(page.getByRole("heading", { level: 1, name: "Reservas" })).toBeVisible();
  await expect(menu(page).getByRole("link", { name: "Reservas", exact: true })).toHaveAttribute("aria-current", "page");
});

test("?papel=sair encerra a sessão simulada", async ({ page }) => {
  await open(page, "/admin/?papel=dono&mock=normal");
  await expect(page.getByRole("heading", { level: 1, name: "Hoje" })).toBeVisible();
  await open(page, "/admin/?papel=sair");
  await expect(page.getByRole("heading", { level: 1, name: "Entrar no painel" })).toBeVisible();
});

test.describe("computador", () => {
  test.skip(() => isPhone(), "só no computador");

  test("trilho de 200 px e a área com o resto da largura", async ({ page }) => {
    await open(page, "/admin/?papel=dono&mock=normal");
    const rail = await page.locator(".trilho").boundingBox();
    const area = await page.locator("main#conteudo").boundingBox();
    const width = page.viewportSize().width;
    expect(rail.width).toBe(200);
    expect(Math.round(area.x)).toBe(200);
    expect(Math.round(area.width)).toBe(width - 200);
    await expect(page.locator(".barra")).toBeHidden();
  });
});

test.describe("celular", () => {
  test.skip(() => !isPhone(), "só no celular");

  test("Mais abre o resto do papel, prende o foco e fecha com Esc ou tocando fora", async ({ page }) => {
    await open(page, "/admin/?papel=recepcao&mock=normal");
    await expect(page.locator(".trilho")).toBeHidden();
    const more = page.getByRole("button", { name: "Mais" });
    const box = await more.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);

    await more.click();
    const sheet = page.getByRole("dialog", { name: "Mais" });
    await expect(sheet).toBeVisible();
    await expect(sheet.locator(".mais__item")).toHaveText(["Espera", "Cardápio"]);
    expect(await serious(page)).toEqual([]);
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest("#mais")))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(more).toBeFocused();

    await more.click();
    await expect(sheet).toBeVisible();
    await page.mouse.click(20, 20); // o fundo escurecido, acima da folha
    await expect(sheet).toBeHidden();
    await expect(more).toBeFocused();

    await more.click();
    await sheet.getByRole("link", { name: "Espera" }).click();
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL(/\/admin\/espera$/);
    await expect(page.getByRole("heading", { level: 1, name: "Espera" })).toBeFocused();
    await expect(page.locator(".barra__mais")).toHaveClass(/is-dentro/);
  });
});
