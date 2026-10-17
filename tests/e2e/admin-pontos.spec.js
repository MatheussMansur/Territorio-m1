// Pontos fixos da casa (história 3.13, FR-86): o dono ou o gerente marca o bar, a cozinha,
// a entrada e outros pontos fixos na planta; eles se movem e mudam de tamanho como uma mesa, mas não têm
// lugares, nunca juntam e nunca contam; o Salão e a folha da noite os mostram como referência.
// Também as mesas juntas desenhadas como um grupo com nome (N17) e as pessoas numa mesa reservada (N21).
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { demoNight } from "./noite-helpers.js";

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
  await page.goto(url);
  await page.waitForSelector("html[data-ready]");
}

const isPhone = () => test.info().project.name === "celular";
const live = (page) => page.locator(".pl-editor [aria-live=polite]");

/** A folha de efeito, quando a planta é usada por noites com reservas: cancela quem perde mesa. */
async function passEffect(page) {
  const sheet = page.locator("dialog.ag-sheet[open]");
  if (await sheet.waitFor({ timeout: 3000 }).then(() => true, () => false)) {
    for (const caso of await sheet.locator(".ag-caso").all()) await caso.getByText("Cancelar avisando").click();
    await sheet.locator(".ag-sheet__acoes .btn:not(.btn--outline)").click();
  }
}

/** "Ver o efeito e gravar" pelo teclado (a barra da demonstração pode cobrir o fim da página). */
async function saveLayout(page) {
  const button = page.getByRole("button", { name: "Ver o efeito e gravar" });
  await expect(button).toBeEnabled();
  await button.focus();
  await page.keyboard.press("Enter");
}

test("editor: novo ponto, mover, mudar o tamanho, aviso em cima de mesa, apagar e gravar sem mudar a capacidade", async ({ page }) => {
  test.skip(isPhone(), "o editor pede 768 px; o celular tem o próprio teste");
  await open(page, "/admin/plantas?papel=gerente&mock=normal");
  const href = await page.getByRole("link", { name: "Padrão", exact: true }).getAttribute("href");
  const id = href.split("/").pop();
  const before = await page.evaluate(async (layoutId) => (await (await fetch(`/api/v1/staff/layouts/${layoutId}`)).json()).seats_total, id);
  await page.getByRole("link", { name: "Padrão", exact: true }).click();

  // os pontos da casa vêm com a planta, e S3 + S4 são desenhadas como um grupo com nome
  await expect(page.getByRole("button", { name: /^Ponto fixo: Bar,/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Ponto fixo: Entrada,/ })).toBeVisible();
  await expect(page.locator('.pl-grupo[data-grupo="S3+S4"]')).toContainText("S3 + S4 · 8 lugares");
  await expect(page.locator('.pl-mesa[data-code="S3"]')).toHaveAttribute("aria-label", /S3 e S4 juntas, 8 lugares/);

  // um ponto novo: "outro" precisa de nome
  const tools = page.getByRole("group", { name: "Ferramentas do desenho" });
  await tools.getByLabel("Área em foco").selectOption({ label: "Salão · dentro" });
  await tools.getByRole("button", { name: "Novo ponto" }).click();
  const sheet = page.getByRole("dialog", { name: "Novo ponto" });
  await sheet.getByLabel("Tipo").selectOption({ label: "Outro" });
  await sheet.getByRole("button", { name: "Pôr na planta" }).click();
  await expect(sheet.getByText("Dê um nome ao ponto.")).toBeVisible();
  await sheet.getByLabel(/Nome/).fill("Telão");
  await bothThemes(page);
  await sheet.getByRole("button", { name: "Pôr na planta" }).click();
  await expect(live(page)).toContainText("Ponto Telão posto em Salão · dentro");
  const telao = page.getByRole("button", { name: /^Ponto fixo: Telão,/ });
  await expect(telao).toBeFocused();
  await expect(page.getByRole("heading", { name: "Ponto fixo · Telão" })).toBeVisible();

  // o tamanho em metros na folha lateral, as setas e o mouse o movem como uma mesa
  await page.getByLabel("Largura do ponto (m)").fill("4");
  await page.getByLabel("Largura do ponto (m)").blur();
  await expect(telao).toHaveAttribute("aria-label", /4 m por 3 m/);
  await telao.focus();
  await page.keyboard.press("ArrowRight");
  await expect(live(page)).toContainText(/Telão na coluna \d+, linha \d+/);
  const box = await telao.boundingBox();
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + 30, { steps: 4 });
  await page.mouse.up();
  await expect(live(page)).toContainText(/Telão na coluna \d+, linha \d+/);

  // em cima de uma mesa: um alerta que não impede gravar; na aba Lista, os pontos também
  await page.getByRole("tab", { name: "Lista" }).click();
  await expect(page.getByRole("table", { name: "Pontos fixos" })).toBeVisible();
  await page.getByLabel("Coluna de Telão").fill("2");
  await page.getByLabel("Coluna de Telão").blur();
  await page.getByLabel("Linha de Telão").fill("3");
  await page.getByLabel("Linha de Telão").blur();
  await expect(page.getByText("S1 está em cima de Telão.")).toBeVisible();
  await page.getByLabel("Coluna de Telão").fill("2");
  await page.getByLabel("Linha de Telão").fill("12");
  await page.getByLabel("Linha de Telão").blur();
  await expect(page.getByText("S1 está em cima de Telão.")).toHaveCount(0);

  // apagar com confirmação, pela lista
  await page.getByRole("button", { name: "Apagar o ponto Banheiros" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Apagar ponto" }).click();
  await expect(page.getByLabel("Nome do ponto 1")).toBeVisible();
  await expect(page.getByRole("button", { name: "Apagar o ponto Banheiros" })).toHaveCount(0);
  await bothThemes(page);

  await saveLayout(page);
  await passEffect(page);
  await expect(page.locator(".toast").filter({ hasText: "Planta gravada" })).toBeVisible();
  const saved = await page.evaluate((layoutId) => JSON.parse(localStorage.getItem("territorio:mock-db")).layouts.find((l) => l.id === layoutId), id);
  expect(saved.fixtures.find((f) => f.name === "Telão")).toMatchObject({ kind: "other", area: "salao", x: 2, y: 12, w: 8, h: 6 });
  expect(saved.fixtures.some((f) => f.name === "Banheiros")).toBe(false);
  // um ponto nunca conta: os lugares são os mesmos de antes
  const after = await page.evaluate(async (layoutId) => (await (await fetch(`/api/v1/staff/layouts/${layoutId}`)).json()).seats_total, id);
  expect(after).toBe(before);
});

test("teclado: Delete num ponto pede confirmação", async ({ page }) => {
  test.skip(isPhone(), "o editor pede 768 px");
  await open(page, "/admin/plantas?papel=dono&mock=normal");
  await page.getByRole("link", { name: "Casa cheia", exact: true }).click();
  const caixa = page.getByRole("button", { name: /^Ponto fixo: Caixa,/ });
  await caixa.focus();
  await page.keyboard.press("Delete");
  const confirm = page.getByRole("dialog", { name: "Apagar o ponto Caixa?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Apagar ponto" }).click();
  await expect(caixa).toHaveCount(0);
  await expect(live(page)).toContainText("Ponto Caixa apagado.");
  // a junção do quintal é um grupo com nome próprio
  await expect(page.locator('.pl-grupo[data-grupo="Q1+Q2"]')).toContainText("Mesa da figueira · 8 lugares");
});

test("os pontos não entram na reserva nem na capacidade", async ({ page }) => {
  await open(page, "/admin/plantas?papel=dono&mock=normal");
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem("territorio:mock-db")));
  const standard = state.layouts.find((l) => l.name === "Padrão");
  expect(standard.fixtures.map((f) => f.kind).sort()).toEqual(["bar", "cashier", "entrance", "kitchen", "other", "toilet"]);
  const names = new Set(standard.fixtures.map((f) => f.name));
  const ids = new Set(standard.fixtures.map((f) => f.id));
  // os horários das próximas noites oferecem mesas e junções, nunca um ponto
  const d = new Date(Date.now() - 3 * 3600_000);
  do d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() !== 5);
  const friday = d.toISOString().slice(0, 10);
  const slots = await page.evaluate(async (date) => (await fetch(`/api/v1/availability/slots?date=${date}&party_size=2`)).json(), friday);
  expect(JSON.stringify(slots)).not.toMatch(new RegExp([...ids].join("|")));
  for (const area of slots.areas || []) expect(names.has(area.name)).toBe(false);
});

test("Salão: os pontos aparecem como referência, sem ação, e a mesa reservada diz quantas pessoas", async ({ page }) => {
  // a noite da demonstração às 20:40 seja qual for a hora: S6 ainda espera a Paula
  await open(page, `/admin/salao?papel=recepcao&mock=normal&${await demoNight(page)}`);
  await expect(page.getByRole("heading", { level: 1, name: "Salão" })).toBeVisible();
  if (isPhone()) {
    // a lista põe os pontos no topo de cada área
    const refs = page.getByRole("list", { name: "Pontos fixos de Balcão" });
    await expect(refs).toBeVisible();
    await expect(refs).toContainText("Bar");
    await expect(refs).toContainText("Cozinha");
    await expect(page.getByRole("list", { name: "Pontos fixos de Salão · dentro" })).toContainText("Entrada");
    await expect(page.locator('.linha-mesa[data-mesa="S6"]')).toContainText("21:00 · Paula · 2 pessoas");
  } else {
    const bar = page.getByRole("img", { name: "Bar, ponto fixo" });
    await expect(bar).toBeVisible();
    await expect(page.getByRole("img", { name: "Entrada, ponto fixo" })).toBeVisible();
    await expect(bar.locator("button")).toHaveCount(0);
    // a mesa está onde a planta a coloca, não numa pilha
    const s1 = await page.locator('.table-node[data-mesa="S1"]').boundingBox();
    const s2 = await page.locator('.table-node[data-mesa="S2"]').boundingBox();
    expect(s2.x - s1.x).toBeCloseTo(160, -1);
    await expect(page.locator('.table-node[data-mesa="S6"]')).toContainText("21:00 · Paula · 2 pessoas");
  }
  await bothThemes(page);
});

test("folha da noite: a planta com as mesas e os pontos fixos", async ({ page }) => {
  await open(page, `/admin/salao/folha?papel=recepcao&mock=normal&${await demoNight(page)}`);
  const plan = page.getByRole("region", { name: "Planta da noite" });
  await expect(plan).toBeVisible({ timeout: 20_000 });
  await expect(plan.getByRole("img", { name: "Bar, ponto fixo" })).toBeVisible();
  await expect(plan.getByRole("img", { name: "Cozinha, ponto fixo" })).toBeVisible();
  await expect(plan.locator(".folha-mesa", { hasText: "S1" })).toBeVisible();
  await expect(plan.getByRole("heading", { name: "Balcão" })).toBeVisible();
  await bothThemes(page);
});

test("no celular, o editor mostra os pontos só para leitura", async ({ page }) => {
  test.skip(!isPhone(), "só no celular");
  await open(page, "/admin/plantas?papel=dono&mock=normal");
  await page.getByRole("link", { name: "Padrão", exact: true }).click();
  await expect(page.getByRole("img", { name: /^Ponto fixo: Bar,/ })).toBeAttached();
  await expect(page.locator("button.pl-ponto")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Novo ponto" })).toHaveCount(0);
});
