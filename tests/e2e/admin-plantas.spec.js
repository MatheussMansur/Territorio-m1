// Plantas (histórias 3.1 a 3.3): a lista com onde cada planta é usada, duplicar e arquivar
// (recusado enquanto em uso), o editor com movimentos pelo teclado, mesas novas e junções, só leitura
// abaixo de 768 px, perfis e os estados.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// o axe roda quatro vezes em alguns testes, sobre um mês inteiro de dias
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

async function goInside(page, path) {
  await page.evaluate((p) => {
    window.history.pushState(null, "", p);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

const isPhone = () => test.info().project.name === "celular";

test("dono vê as plantas, duplica e não arquiva a que está em uso", async ({ page }) => {
  await open(page, "/admin/plantas?papel=dono&mock=normal");
  await expect(page.getByRole("heading", { level: 1, name: "Plantas" })).toBeVisible();
  await expect(page.getByText("Padrão de quarta a sábado")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Áreas da casa" })).toBeVisible();
  await bothThemes(page);

  await page.getByRole("button", { name: "Arquivar Padrão" }).click();
  const inUse = page.getByRole("dialog", { name: "Essa planta está em uso" });
  await expect(inUse).toBeVisible();
  await expect(inUse.getByRole("link", { name: "Ver os dias" })).toBeVisible();
  await inUse.getByRole("button", { name: "Voltar" }).click();

  await page.getByRole("button", { name: "Duplicar Casa cheia" }).click();
  await expect(page.locator(".toast").filter({ hasText: "Cópia criada" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Casa cheia (cópia)" })).toBeVisible();

  await page.getByRole("button", { name: "Arquivar Casa cheia (cópia)" }).click();
  await page.getByRole("button", { name: "Arquivar", exact: true }).click();
  await expect(page.locator(".toast").filter({ hasText: "Planta arquivada" })).toBeVisible();
  await expect(page.getByText("Arquivadas · 2")).toBeVisible();
});

test("editor: mover com o teclado, criar mesa, juntar e gravar", async ({ page }) => {
  test.skip(isPhone(), "o editor pede 768 px; o celular tem o próprio teste");
  await open(page, "/admin/plantas?papel=gerente&mock=normal");
  await page.getByRole("link", { name: "Casa cheia", exact: true }).click();
  await expect(page.getByLabel("Nome da planta")).toHaveValue("Casa cheia");
  const s1 = page.locator('.pl-mesa[data-code="S1"]');
  await s1.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(page.locator(".pl-editor [aria-live=polite]")).toContainText("S1 na coluna");
  await page.keyboard.press(" ");
  await page.locator('.pl-mesa[data-code="S2"]').focus();
  await page.keyboard.press(" ");
  await page.getByRole("button", { name: /Juntar 2 mesas/ }).click();
  await expect(page.locator(".pl-juncoes__lista")).toContainText("S1 + S2");
  await page.getByRole("button", { name: "Nova mesa" }).click();
  await expect(page.locator(".pl-ficha h3")).toContainText("Mesa");
  await bothThemes(page);

  await page.getByRole("tab", { name: "Lista" }).click();
  await expect(page.getByRole("table", { name: "Mesas da planta" })).toBeVisible();
  // um código repetido aparece no campo e não é enviado
  await page.getByLabel("Código da mesa 2", { exact: true }).fill("S1");
  await page.getByLabel("Código da mesa 2", { exact: true }).blur();
  await page.getByRole("button", { name: "Ver o efeito e gravar" }).click();
  await expect(page.getByText("Já existe uma mesa S1 nesta planta.").first()).toBeVisible();
  await page.getByLabel("Código da mesa 2", { exact: true }).fill("S2");
  await page.getByLabel("Código da mesa 2", { exact: true }).blur();
  await page.getByRole("button", { name: "Ver o efeito e gravar" }).click();
  await expect(page.locator(".toast").filter({ hasText: "Planta gravada" })).toBeVisible();
  await expect(page.getByText(/Gravado · Gerente da casa/)).toBeVisible();
});

test("no celular a planta é só para leitura", async ({ page }) => {
  test.skip(!isPhone(), "só no celular");
  await open(page, "/admin/plantas?papel=dono&mock=normal");
  await page.getByRole("link", { name: "Padrão", exact: true }).click();
  await expect(page.getByText("Para editar a planta, use uma tela de 768 px ou mais")).toBeVisible();
  await expect(page.locator("button.pl-mesa")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ver o efeito e gravar" })).toHaveCount(0);
  await bothThemes(page);
});

test("gerente não arquiva; recepção não entra", async ({ page }) => {
  await open(page, "/admin/plantas?papel=gerente&mock=normal");
  await expect(page.getByRole("link", { name: "Padrão", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Arquivar/ })).toHaveCount(0);
  await open(page, "/admin/plantas?papel=recepcao&mock=normal");
  await expect(page.getByRole("heading", { level: 1, name: "Essa parte é de outro perfil da equipe" })).toBeVisible();
});

test("vazio e erro", async ({ page }) => {
  await open(page, "/admin/plantas?papel=dono&mock=vazio");
  await expect(page.getByText("Nenhuma planta ainda")).toBeVisible();
  await expect(page.getByRole("button", { name: "Criar planta" }).last()).toBeVisible();
  await bothThemes(page);

  await page.evaluate(() => sessionStorage.setItem("territorio:mock-scenario", JSON.stringify("erro")));
  await goInside(page, "/admin/eventos");
  await goInside(page, "/admin/plantas");
  const alert = page.locator("#area-corpo [role=alert]");
  await expect(alert).toContainText("Não deu para carregar.");
  await expect(alert).not.toContainText("Erro simulado");
  await bothThemes(page);
});

/** "Ver o efeito e gravar" pelo teclado (a barra da demonstração pode cobrir o fim da página). */
async function saveLayout(page) {
  const button = page.getByRole("button", { name: "Ver o efeito e gravar" });
  await expect(button).toBeEnabled();
  await button.focus();
  await page.keyboard.press("Enter");
}

test("junção com mínimo e máximo de lugares", async ({ page }) => {
  test.skip(isPhone(), "o editor pede 768 px");
  await open(page, "/admin/plantas?papel=dono&mock=normal");
  await page.getByRole("link", { name: "Casa cheia", exact: true }).click();
  const join = page.locator(".pl-juncoes__lista li", { hasText: "Q3 + Q6" });
  await expect(join).toBeVisible();
  await join.getByLabel(/Mínimo/).fill("14");
  await join.getByLabel(/Máximo/).fill("12");
  await saveLayout(page);
  await expect(page.getByText("O mínimo da junção passa do máximo.").first()).toBeVisible();
  await join.getByLabel(/Mínimo/).fill("8");
  await join.getByLabel(/Mínimo/).blur();
  await saveLayout(page);
  const sheet = page.locator("dialog.ag-sheet[open]");
  if (await sheet.waitFor({ timeout: 3000 }).then(() => true, () => false)) {
    for (const caso of await sheet.locator(".ag-caso").all()) await caso.getByText("Cancelar avisando").click();
    await sheet.locator(".ag-sheet__acoes .btn:not(.btn--outline)").click();
  }
  await expect(page.locator(".toast").filter({ hasText: "Planta gravada" })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("territorio:mock-db")).layouts.find((l) => l.name === "Casa cheia").combos.find((c) => c.codes.join("+") === "Q3+Q6"));
  expect(saved).toMatchObject({ min_seats: 8, max_seats: 12 });
});

test("outra pessoa gravou a planta antes: juntar mantém o desenho", async ({ page }) => {
  test.skip(isPhone(), "o editor pede 768 px");
  await open(page, "/admin/plantas?papel=dono&mock=normal");
  const href = await page.getByRole("link", { name: "Casa cheia", exact: true }).getAttribute("href");
  // a outra pessoa da demonstração grava antes quando a página tem ?conflito=1
  await open(page, `${href}?papel=dono&mock=normal&conflito=1`);
  await page.getByLabel("Para quando").fill("Sexta e sábado de casa cheia");
  await page.getByLabel("Para quando").blur();
  await saveLayout(page);
  const sheet = page.locator("dialog.ag-sheet[open]", { hasText: "gravou antes de você" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("Para quando");
  await bothThemes(page);
  await sheet.getByRole("button", { name: "Juntar com as minhas" }).click();
  await expect(page.getByLabel("Para quando")).toHaveValue("Sexta e sábado de casa cheia");
  await saveLayout(page);
  const effect = page.locator("dialog.ag-sheet[open]");
  if (await effect.waitFor({ timeout: 3000 }).then(() => true, () => false)) {
    for (const caso of await effect.locator(".ag-caso").all()) await caso.getByText("Cancelar avisando").click();
    await effect.locator(".ag-sheet__acoes .btn:not(.btn--outline)").click();
  }
  await expect(page.locator(".toast").filter({ hasText: "Planta gravada" })).toBeVisible();
});

test("sem conexão, a lista das plantas fica só para leitura", async ({ page }) => {
  await open(page, "/admin/plantas?papel=dono&mock=normal&rede=ok");
  await expect(page.getByRole("link", { name: "Padrão", exact: true })).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem("territorio:mock-rede", "true"));
  await goInside(page, "/admin/eventos");
  await goInside(page, "/admin/plantas");
  await expect(page.getByText("Sem conexão. Você vê a última versão.").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Padrão", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Criar planta" })).toHaveCount(0);
  await bothThemes(page);
  await page.evaluate(() => sessionStorage.setItem("territorio:mock-rede", "false"));
});

/** A folha de efeito, quando a planta é usada por noites com reservas: cancela quem perde mesa. */
async function passEffect(page) {
  const sheet = page.locator("dialog.ag-sheet[open]");
  if (await sheet.waitFor({ timeout: 3000 }).then(() => true, () => false)) {
    for (const caso of await sheet.locator(".ag-caso").all()) await caso.getByText("Cancelar avisando").click();
    await sheet.locator(".ag-sheet__acoes .btn:not(.btn--outline)").click();
  }
}

/** A próxima sexta na casa (UTC−3), uma noite em que a semana padrão abre. */
function nextFriday() {
  const d = new Date(Date.now() - 3 * 3600_000);
  do d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() !== 5);
  return d.toISOString().slice(0, 10);
}

test("área nova de 60 × 40 m com mesa no canto aparece no Salão e na reserva", async ({ page }) => {
  test.skip(isPhone(), "o editor pede 768 px");
  const friday = nextFriday();
  await open(page, `/admin/plantas?papel=dono&mock=normal&agora=${friday}T20:00`);
  await expect(page.getByRole("link", { name: "Padrão", exact: true })).toBeVisible();
  // a planta que aquela noite usa, como o mock resolve
  const layoutId = await page.evaluate((d) => {
    const s = JSON.parse(localStorage.getItem("territorio:mock-db"));
    const plan = s.day_plans?.[d];
    const event = s.events.find((e) => e.published && e.date === d);
    return plan?.layout_id ?? event?.layout_id ?? s.hours.find((h) => h.weekday === 5).layout_id;
  }, friday);
  await open(page, `/admin/plantas/${layoutId}?papel=dono&mock=normal`);

  await page.getByRole("button", { name: "Nova área" }).click();
  const sheet = page.getByRole("dialog", { name: "Nova área" });
  await sheet.getByLabel("Nome da área").fill("Tenda do evento");
  await sheet.getByLabel("Largura (m)").fill("60");
  await sheet.getByLabel("Fundo (m)").fill("40");
  await bothThemes(page);
  await sheet.getByRole("button", { name: "Criar área" }).click();
  await expect(page.locator(".toast").filter({ hasText: "Área criada" })).toBeVisible();

  const tools = page.getByRole("group", { name: "Ferramentas do desenho" });
  await expect(tools.getByLabel("Área em foco")).toHaveValue("tenda-do-evento");
  await expect(tools.getByLabel("Largura (m)")).toHaveValue("60");
  await expect(tools.getByLabel("Fundo (m)")).toHaveValue("40");
  await tools.getByRole("button", { name: "Nova mesa" }).click();
  const tent = page.locator('.pl-area[data-area="tenda-do-evento"]');
  await expect(tent.locator('.pl-mesa[data-code="T1"]')).toBeVisible();

  // o canto mais distante: 120 × 80 quadrados, a mesa tem 6 × 6
  await page.getByRole("tab", { name: "Lista" }).click();
  await page.getByLabel("Coluna de T1").fill("114");
  await page.getByLabel("Coluna de T1").blur();
  await page.getByLabel("Linha de T1").fill("74");
  await page.getByLabel("Linha de T1").blur();
  await page.getByRole("tab", { name: "Desenho" }).click();
  await expect(page.getByText("T1 está fora da área.")).toHaveCount(0);
  // as setas param na borda da área
  await tent.locator('.pl-mesa[data-code="T1"]').focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".pl-editor [aria-live=polite]")).toContainText("T1 na coluna 114, linha 74");

  await tools.getByRole("button", { name: "50%" }).click();
  await expect(tools.getByRole("button", { name: "50%" })).toHaveAttribute("aria-pressed", "true");
  await expect(tent.locator(".pl-quadro-medida")).toHaveCSS("width", "600px");
  await bothThemes(page);

  await saveLayout(page);
  await passEffect(page);
  await expect(page.locator(".toast").filter({ hasText: "Planta gravada" })).toBeVisible();
  const saved = await page.evaluate((id) => JSON.parse(localStorage.getItem("territorio:mock-db")).layouts.find((l) => l.id === id), layoutId);
  expect(saved.areas.find((a) => a.key === "tenda-do-evento")).toMatchObject({ mode: "tables", width_m: 60, depth_m: 40 });
  expect(saved.tables.find((t) => t.code === "T1")).toMatchObject({ area: "tenda-do-evento", x: 114, y: 74 });

  // o site de reservas oferece a área nova naquela noite
  const slots = await page.evaluate(async (d) => (await fetch(`/api/v1/availability/slots?date=${d}&party_size=2`)).json(), friday);
  expect(slots.areas).toContainEqual(expect.objectContaining({ key: "tenda-do-evento", name: "Tenda do evento", mode: "tables" }));

  await open(page, `/admin/salao?papel=dono&mock=normal&agora=${friday}T20:00`);
  const floorArea = page.locator("section.floor-area", { has: page.locator(".floor-area__name", { hasText: "Tenda do evento" }) });
  await expect(floorArea).toBeVisible();
  await expect(floorArea).toContainText("T1");
});

test("a casa apaga a área que nenhuma planta usa; a área em uso diz onde está", async ({ page }) => {
  await open(page, "/admin/plantas?papel=dono&mock=normal");
  const areas = page.getByRole("region", { name: "Áreas da casa" });
  await expect(areas.locator("li").filter({ has: page.locator("b", { hasText: /^Quintal$/ }) })).toContainText("Em uso: Padrão");

  await areas.getByRole("button", { name: "Apagar Quintal" }).click();
  const inUse = page.getByRole("dialog", { name: "Essa área está em uso" });
  await expect(inUse).toBeVisible();
  await expect(inUse.getByRole("link", { name: "Padrão" })).toBeVisible();
  await bothThemes(page);
  await inUse.getByRole("button", { name: "Voltar" }).click();

  await areas.getByRole("button", { name: "Nova área" }).click();
  const sheet = page.getByRole("dialog", { name: "Nova área" });
  await sheet.getByLabel("Nome da área").fill("Calçada");
  await sheet.getByLabel("Como funciona de começo").selectOption("list");
  await sheet.getByLabel("Pessoas na lista").fill("20");
  await sheet.getByRole("button", { name: "Criar área" }).click();
  await expect(page.locator(".toast").filter({ hasText: "Área criada" })).toBeVisible();
  const row = areas.locator("li", { hasText: "Calçada" });
  await expect(row).toContainText("lista com capacidade de 20");
  await expect(row).toContainText("Nenhuma planta usa.");

  await areas.getByRole("button", { name: "Apagar Calçada" }).click();
  await page.getByRole("button", { name: "Apagar área" }).click();
  await expect(page.locator(".toast").filter({ hasText: "Área apagada" })).toBeVisible();
  await expect(areas.locator("li", { hasText: "Calçada" })).toHaveCount(0);
});

test("a barra do desenho fica à vista e a de gravar acompanha a tela", async ({ page }) => {
  test.skip(isPhone(), "o editor pede 768 px");
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "/admin/plantas?papel=gerente&mock=normal");
  await page.getByRole("link", { name: "Casa cheia", exact: true }).click();
  const tools = page.getByRole("group", { name: "Ferramentas do desenho" });
  for (const name of ["Nova mesa", "Nova área", "50%", "75%", "100%"]) await expect(tools.getByRole("button", { name })).toBeInViewport();
  await expect(tools.getByLabel("Largura (m)")).toBeInViewport();
  await expect(page.getByRole("tab", { name: "Desenho" })).toBeInViewport();
  await expect(page.getByText("Mudanças não gravadas.")).toHaveCount(0);

  // N cria uma mesa na área em foco, e a barra de gravar vem para o fim da tela
  await tools.getByLabel("Área em foco").selectOption({ label: "Quintal" });
  await page.getByRole("tab", { name: "Desenho" }).focus();
  await page.keyboard.press("n");
  await expect(page.locator(".pl-editor [aria-live=polite]")).toContainText("criada em Quintal");
  await expect(page.getByText("Mudanças não gravadas.")).toBeInViewport();
  await expect(page.getByRole("button", { name: "Ver o efeito e gravar" })).toBeInViewport();

  // o tamanho da área em foco fica entre 2 e 100 m
  await tools.getByLabel("Largura (m)").fill("150");
  await tools.getByLabel("Largura (m)").blur();
  await expect(tools.getByLabel("Largura (m)")).toHaveValue("100");
  await bothThemes(page);

  await page.getByRole("button", { name: "Desfazer tudo" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Desfazer tudo" }).click();
  await expect(page.getByText("Mudanças não gravadas.")).toHaveCount(0);
  await expect(tools.getByLabel("Largura (m)")).toHaveValue("32");
});

test("cada planta escolhe as áreas: põe e tira uma área sem mesa", async ({ page }) => {
  test.skip(isPhone(), "o editor pede 768 px");
  await open(page, "/admin/plantas?papel=dono&mock=normal");
  await page.getByRole("link", { name: "Casa cheia", exact: true }).click();
  const panel = page.getByRole("region", { name: "Áreas desta planta" });
  await expect(panel.getByText("Tem 6 mesas e 3 pontos fixos: mude de área ou apague para tirar Balcão desta planta.")).toBeVisible();
  await panel.getByRole("button", { name: "Criar área" }).click();
  const sheet = page.getByRole("dialog", { name: "Nova área" });
  await sheet.getByLabel("Nome da área").fill("Tenda do evento");
  await sheet.getByRole("button", { name: "Criar área" }).click();
  await expect(page.locator('.pl-area[data-area="tenda-do-evento"]')).toBeVisible();
  await panel.getByRole("button", { name: "Tirar Tenda do evento desta planta" }).click();
  await expect(page.locator('.pl-area[data-area="tenda-do-evento"]')).toHaveCount(0);
  await panel.getByRole("button", { name: "Pôr nesta planta" }).click();
  await expect(page.locator('.pl-area[data-area="tenda-do-evento"]')).toBeVisible();
});
