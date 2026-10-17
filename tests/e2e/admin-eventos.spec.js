// Eventos (histórias 3.9 a 3.11): a lista, criar um rascunho, publicar passando pelo efeito na
// noite, a lista de convidados com "Chegou" na porta e a lista da casa de um evento fechado,
// perfis e os estados.
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

async function settleEffect(page) {
  const sheet = page.locator("dialog.ag-sheet[open]");
  // a folha só abre quando alguém é afetado; senão a mudança é gravada direto
  if (!(await sheet.waitFor({ timeout: 3000 }).then(() => true, () => false))) return;
  for (const caso of await sheet.locator(".ag-caso").all()) await caso.getByText("Cancelar avisando").click();
  await sheet.locator(".ag-sheet__acoes .btn:not(.btn--outline)").click();
  await expect(sheet).toBeHidden();
}

test("dono vê os eventos e publica o rascunho passando pelo efeito", async ({ page }) => {
  await open(page, "/admin/eventos?papel=dono&mock=normal");
  await expect(page.getByRole("heading", { level: 1, name: "Eventos" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Noite do peixe" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Passados" })).toBeVisible();
  await bothThemes(page);

  await page.getByRole("button", { name: "Publicar Forró no quintal" }).click();
  await settleEffect(page);
  await expect(page.locator(".toast").filter({ hasText: "Evento publicado" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Despublicar Forró no quintal" })).toBeVisible();
});

test("criar um rascunho e escolher o modo de reserva", async ({ page }) => {
  await open(page, "/admin/eventos?papel=gerente&mock=normal");
  await page.getByRole("link", { name: "Criar evento" }).first().click();
  await expect(page.getByRole("heading", { name: "Novo evento" })).toBeVisible();
  await page.getByRole("button", { name: "Criar rascunho" }).click();
  await expect(page.getByText("Dê um nome ao evento.").first()).toBeVisible();
  await page.getByLabel("Nome do evento").fill("Noite do karaokê");
  const future = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel("Data").fill(future);
  await page.getByText("Só lista", { exact: true }).click();
  await expect(page.getByLabel("Pessoas na lista")).toBeVisible();
  await bothThemes(page);
  await page.getByRole("button", { name: "Criar rascunho" }).click();
  await expect(page.locator(".toast").filter({ hasText: "Rascunho criado" })).toBeVisible();
  await expect(page.locator(".ev-titulo")).toHaveText("Noite do karaokê");
  await expect(page.getByRole("button", { name: "Publicar", exact: true })).toBeVisible();
  // o gerente não remove eventos
  await expect(page.getByRole("button", { name: "Remover" })).toHaveCount(0);
});

test("lista do evento: chegou na porta e desfazer", async ({ page }) => {
  await open(page, "/admin/eventos?papel=dono&mock=normal");
  await page.getByRole("link", { name: "Noite do peixe" }).click();
  await page.getByRole("tab", { name: "Lista" }).click();
  await expect(page.locator(".ev-lista .ag-resumo")).toContainText("de 40 pessoas");
  await page.getByRole("button", { name: "Helena Sato chegou" }).click();
  await expect(page.locator(".toast").filter({ hasText: "Helena Sato chegou" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Desfazer a chegada de Helena Sato" })).toBeVisible();
  await bothThemes(page);
  await page.getByRole("button", { name: "Desfazer a chegada de Helena Sato" }).click();
  await expect(page.getByRole("button", { name: "Helena Sato chegou" })).toBeVisible();

  await page.getByLabel("Nome", { exact: true }).fill("Casal da mesa da janela");
  await page.getByLabel("Pessoas", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Entrou na porta" }).click();
  await expect(page.locator(".toast").filter({ hasText: "Entrou, já com a chegada marcada" })).toBeVisible();
});

test("evento fechado: a casa monta a lista", async ({ page }) => {
  await open(page, "/admin/eventos?papel=dono&mock=normal");
  await page.getByRole("link", { name: "Aniversário de 40 anos da Fernanda" }).click();
  await page.getByRole("tab", { name: "Lista" }).click();
  await page.getByLabel("Nome", { exact: true }).fill("Primos de Cascavel");
  await page.getByLabel("Pessoas", { exact: true }).fill("4");
  await page.getByRole("button", { name: "Acrescentar nome" }).click();
  await expect(page.locator(".toast").filter({ hasText: "Nome na lista" })).toBeVisible();
  await expect(page.locator("td", { hasText: "Primos de Cascavel" }).first()).toBeVisible();
  // acima da capacidade
  await page.getByLabel("Nome", { exact: true }).fill("Excursão");
  await page.getByLabel("Pessoas", { exact: true }).fill("40");
  await page.getByRole("button", { name: "Acrescentar nome" }).click();
  await expect(page.locator(".toast").filter({ hasText: "A lista do evento está cheia" })).toBeVisible();
});

test("recepção não entra; vazio e erro", async ({ page }) => {
  await open(page, "/admin/eventos?papel=recepcao&mock=normal");
  await expect(page.getByRole("heading", { level: 1, name: "Essa parte é de outro perfil da equipe" })).toBeVisible();

  await open(page, "/admin/eventos?papel=dono&mock=vazio");
  await expect(page.getByText("Nenhum evento ainda")).toBeVisible();
  await bothThemes(page);

  await page.evaluate(() => sessionStorage.setItem("territorio:mock-scenario", JSON.stringify("erro")));
  await goInside(page, "/admin/plantas");
  await goInside(page, "/admin/eventos");
  const alert = page.locator("#area-corpo [role=alert]");
  await expect(alert).toContainText("Não deu para carregar.");
  await expect(alert).not.toContainText("Erro simulado");
  await bothThemes(page);
});

/** Abre a folha de um evento pelo endereço, para a página manter os parâmetros da demonstração. */
async function openEvent(page, title, params = "papel=dono&mock=normal") {
  await open(page, `/admin/eventos?${params}`);
  const href = await page.getByRole("link", { name: title }).first().getAttribute("href");
  await open(page, `${href}?${params}`);
  await expect(page.locator(".ev-titulo")).toHaveText(title);
}

/** Muda o banco do mock (guardado no localStorage); a próxima carga da página lê. */
async function editDb(page, source) {
  await page.evaluate((src) => {
    const db = JSON.parse(localStorage.getItem("territorio:mock-db"));
    new Function("db", src)(db);
    localStorage.setItem("territorio:mock-db", JSON.stringify(db));
  }, source);
}

test("evento fechado: o motivo que a casa escreve chega ao site nas três línguas", async ({ page }) => {
  await openEvent(page, "Aniversário de 40 anos da Fernanda");
  const reason = page.locator("input[name=private_label]");
  await expect(reason).toHaveValue("Festa fechada");
  await reason.fill("Festa da Fernanda");
  const tabs = page.locator(".ag-palavras");
  await tabs.getByRole("tab", { name: /English/ }).click();
  await page.getByLabel("O que o cliente lê no calendário (English)").fill("");
  await expect(tabs.getByRole("tab", { name: /English.*falta/ })).toBeVisible();
  await bothThemes(page);
  await page.getByRole("button", { name: "Ver o efeito e gravar" }).click();
  await settleEffect(page);
  await expect(page.locator(".toast").filter({ hasText: "Evento gravado" })).toBeVisible();
  const date = await page.evaluate(() => JSON.parse(localStorage.getItem("territorio:mock-db")).events.find((e) => e.title.startsWith("Aniversário")).date);
  const day = await page.evaluate(async (d) => (await fetch(`/api/v1/availability/slots?date=${d}&party_size=2`)).json(), date);
  expect(day.open).toBe(false);
  expect(day.reason_label).toBe("Festa da Fernanda");
  expect(day.reason_labels).toEqual({ pt: "Festa da Fernanda", es: "Fiesta privada", en: "Festa da Fernanda" });
});

test("modo misto: limite das mesas além da lista", async ({ page }) => {
  await openEvent(page, "Noite do peixe");
  const limit = page.getByLabel(/Pessoas nas mesas/);
  await expect(limit).toBeVisible();
  await limit.fill("-3");
  await page.getByRole("button", { name: "Ver o efeito e gravar" }).click();
  await expect(page.getByText(/Use um número inteiro maior que zero/).first()).toBeVisible();
  await limit.fill("24");
  await page.getByRole("button", { name: "Ver o efeito e gravar" }).click();
  await settleEffect(page);
  await expect(page.locator(".toast").filter({ hasText: "Evento gravado" })).toBeVisible();
  await expect(page.getByLabel(/Pessoas nas mesas/)).toHaveValue("24");
});

test("foto do evento vem da Galeria; a que está sendo preparada não vai", async ({ page }) => {
  await openEvent(page, "Forró no quintal");
  // uma foto da Galeria ainda sem as suas versões
  await editDb(page, `const img = db.images[0]; img.status = "processing"; img.variants = []; img.alt = "Foto ainda chegando";`);
  await page.reload();
  await expect(page.locator(".ev-titulo")).toHaveText("Forró no quintal");
  await page.getByRole("button", { name: "Escolher na Galeria" }).click();
  const sheet = page.locator("dialog.ag-sheet[open]");
  await expect(sheet.getByRole("button", { name: /Foto ainda chegando.*preparando/ })).toBeVisible();
  await bothThemes(page);
  await sheet.getByRole("button", { name: /Foto ainda chegando/ }).click();
  await page.getByRole("button", { name: "Gravar", exact: true }).click();
  await expect(page.locator(".ev-foto .field__error")).toContainText("A foto ainda está sendo preparada");
  await page.getByRole("button", { name: "Trocar a foto" }).click();
  await page.locator("dialog.ag-sheet[open] .ev-galeria__foto").nth(1).click();
  await page.getByRole("button", { name: "Gravar", exact: true }).click();
  await expect(page.locator(".toast").filter({ hasText: "Evento gravado" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Trocar a foto" })).toBeVisible();
});

test("evento novo nasce com o modo padrão do grupo Eventos", async ({ page }) => {
  await open(page, "/admin/eventos?papel=dono&mock=normal");
  // o painel guarda a sua própria cópia dos dados e pode gravar por cima da edição; uma página sem
  // o painel não pode
  await page.goto("/privacidade/");
  await editDb(page, `db.settings.events.data.default_booking_mode = "list";`);
  await open(page, "/admin/eventos/novo?papel=dono&mock=normal");
  await expect(page.getByRole("heading", { name: "Novo evento" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Só lista/ })).toBeChecked();
});

test("outra pessoa gravou o evento antes: juntar ou descartar", async ({ page }) => {
  await openEvent(page, "Forró no quintal", "papel=dono&mock=normal&conflito=1");
  await page.getByLabel("Nome do evento").fill("Forró pé de serra no quintal");
  await page.getByRole("button", { name: "Gravar", exact: true }).click();
  const sheet = page.locator("dialog.ag-sheet[open]", { hasText: "gravou antes de você" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("Nota da equipe");
  await sheet.getByRole("button", { name: "Juntar com as minhas" }).click();
  await expect(page.getByLabel("Nome do evento")).toHaveValue("Forró pé de serra no quintal");
  await page.getByRole("button", { name: "Gravar", exact: true }).click();
  await expect(page.locator(".toast").filter({ hasText: "Evento gravado" })).toBeVisible();
});

test("sem conexão, os eventos ficam só para leitura", async ({ page }) => {
  await open(page, "/admin/eventos?papel=dono&mock=normal&rede=ok");
  await expect(page.getByRole("link", { name: "Noite do peixe" })).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem("territorio:mock-rede", "true"));
  await goInside(page, "/admin/plantas");
  await goInside(page, "/admin/eventos");
  await expect(page.getByText("Sem conexão. Você vê a última versão.").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Criar evento" })).toHaveCount(0);
  await bothThemes(page);
  await page.evaluate(() => sessionStorage.setItem("territorio:mock-rede", "false"));
});
