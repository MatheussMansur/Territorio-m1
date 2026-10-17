// O catálogo é a fonte da verdade de todo componente: tem que carregar limpo, ser usável
// pelo teclado, passar na checagem de acessibilidade e caber numa tela de celular.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function open(page, url) {
  await page.goto(url);
  await page.waitForSelector("html[data-ready]");
}

function watchConsole(page) {
  const problems = [];
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  return problems;
}

test.describe("catálogo /_ds", () => {
  test.beforeEach(async ({ page }) => {
    // um meio-dia de quarta fixo: de madrugada o "hoje" vira "já passou" e os dias mudam
    await open(page, "/_ds/?mock=normal&agora=2026-09-30T12:00");
  });

  test("carrega sem erro e sem rolagem lateral", async ({ page }) => {
    const problems = watchConsole(page);
    await page.reload();
    await page.waitForSelector("html[data-ready]");
    await expect(page.locator("#api-house")).toContainText("Território");
    expect(problems).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("a API simulada devolve a casa e a janela de 30 dias", async ({ page }) => {
    await expect(page.locator("#api-house")).toContainText("Rua Sérgio Roncato, 703");
    await expect(page.locator("#api-days .day")).toHaveCount(30);
    await expect(page.locator("#api-days .day.is-closed").first()).toContainText(/produção|fechado/);
  });

  test("sem acessibilidade quebrada (axe)", async ({ page }) => {
    test.slow(); // o catálogo inteiro no axe; com todos os workers ocupados precisa de mais de 30 s
    await expect(page.locator("#api-house")).toContainText("Território");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    const serious = results.violations.filter((v) => ["serious", "critical"].includes(v.impact));
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`)).toEqual([]);
  });

  test("no tema escuro, sem acessibilidade quebrada (axe)", async ({ page }) => {
    test.slow(); // o catálogo inteiro no axe; com todos os workers ocupados precisa de mais de 30 s
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("#api-house")).toContainText("Território");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    const serious = results.violations.filter((v) => ["serious", "critical"].includes(v.impact));
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`)).toEqual([]);
  });

  test("a escolha do tema vale antes da primeira pintura", async ({ page }) => {
    await page.evaluate(() => (document.cookie = "trt_tema=escuro; Path=/; SameSite=Lax"));
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "escuro");
    const fundo = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(fundo).not.toBe("rgb(233, 224, 207)");
  });

  test("horários: um Tab, setas andam, espaço escolhe", async ({ page }) => {
    const chosen = page.locator('#demo-slots [role="radio"][aria-checked="true"]');
    await expect(chosen).toHaveText(/20:30/);
    await chosen.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Space");
    await expect(page.locator('#demo-slots [role="radio"][aria-checked="true"]')).toHaveText(/21:00/);
    const tabStops = await page.locator('#demo-slots [role="radio"][tabindex="0"]').count();
    expect(tabStops).toBe(1);
  });

  test("janela com algo digitado pergunta antes de fechar", async ({ page }) => {
    await page.getByRole("button", { name: "Abrir janela" }).click();
    await page.locator("#dlg-name").fill("Ana");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Descartar a reserva?" })).toBeVisible();
    await page.getByRole("button", { name: "Continuar reservando" }).click();
    await expect(page.locator("#demo-dialog")).toHaveAttribute("open", "");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Descartar", exact: true }).click();
    await expect(page.locator("#demo-dialog")).not.toHaveAttribute("open", "");
    await expect(page.getByRole("button", { name: "Abrir janela" })).toBeFocused();
  });

  test("telefone de outro país é aceito e formatado", async ({ page }) => {
    await page.locator("#f5-pais").selectOption("PY");
    await page.locator("#f5").fill("0981 123 456");
    await page.locator("#f5").blur();
    await expect(page.locator("#f5")).toHaveValue("+595 981 123 456");
    await page.locator("#f5").fill("123");
    await page.locator("#f5").blur();
    await expect(page.locator("#phone-demo")).toHaveClass(/field--invalid/);
  });

  test("telefone digitado com +55 troca o país e tira o erro antigo", async ({ page }) => {
    await page.locator("#f5").fill("123");
    await page.locator("#f5").blur();
    await expect(page.locator("#phone-demo")).toHaveClass(/field--invalid/);
    await page.locator("#f5-pais").selectOption("PY");
    await page.locator("#f5").fill("+55 45 99830-4994");
    await page.locator("#f5").blur();
    await expect(page.locator("#f5-pais")).toHaveValue("BR");
    await expect(page.locator("#f5")).toHaveValue("(45) 99830-4994");
    await expect(page.locator("#phone-demo")).not.toHaveClass(/field--invalid/);
    await expect(page.locator("#f5")).toHaveAttribute("aria-invalid", "false");
  });

  test("código colado com espaço ou texto fica com os seis dígitos", async ({ page }) => {
    const input = page.locator("#otp-demo-input");
    await input.focus();
    await input.evaluate((el) => {
      const data = new DataTransfer();
      data.setData("text", "Seu código: 123 456");
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await expect(input).toHaveValue("123456");
  });

  test("abas que mostram a mesma tabela nunca escondem a tabela", async ({ page }) => {
    for (const name of ["Carregando", "Vazio", "Com dados"]) {
      await page.locator("#table-state").getByRole("tab", { name }).click();
      await expect(page.locator("#demo-table")).toBeVisible();
    }
  });

  test("tocar no espaço vazio dentro da janela não fecha a janela", async ({ page }) => {
    await page.getByRole("button", { name: "Abrir janela" }).click();
    const box = await page.locator("#demo-dialog").boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 4);
    await expect(page.locator("#demo-dialog")).toHaveAttribute("open", "");
  });
});

test.describe("estados forçados pela demonstração", () => {
  test("com erro, a chamada mostra a mensagem e o tentar de novo", async ({ page }) => {
    await open(page, "/_ds/?mock=erro");
    await expect(page.locator("#api-house")).toContainText("Algo deu errado do nosso lado");
    await expect(page.locator("#api-house").getByRole("button", { name: "Tentar de novo" })).toBeVisible();
    await open(page, "/_ds/?mock=normal");
  });

  test("lenta, aparece o esqueleto antes dos dados", async ({ page }) => {
    await page.goto("/_ds/?mock=lento");
    await expect(page.locator("#api-house .skeleton").first()).toBeVisible();
    await expect(page.locator("#api-house")).toContainText("Território", { timeout: 8000 });
    await open(page, "/_ds/?mock=normal");
  });

  test("vazia, os dias abertos aparecem lotados", async ({ page }) => {
    await open(page, "/_ds/?mock=vazio");
    await expect(page.locator("#api-days .day.is-full").first()).toBeVisible();
    await open(page, "/_ds/?mock=normal");
  });
});
