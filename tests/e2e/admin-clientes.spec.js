// Clientes (histórias 5.14 a 5.18): busca sem acentos, a ficha com notas e o telefone
// completo depois da confirmação de identidade, anonimizar, os pedidos de privacidade, perfis e os estados.
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

test("dono busca sem acento, abre a ficha, anota e vê o telefone", async ({ page }) => {
  await open(page, "/admin/clientes?papel=dono&mock=normal");
  await expect(page.getByRole("heading", { level: 1, name: "Clientes" })).toBeVisible();
  await expect(page.locator(".tabela-clientes tbody tr").first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Pedidos do site/ })).toBeVisible();
  await bothThemes(page);

  const search = page.getByLabel("Buscar cliente");
  await search.fill("conceicao");
  await expect(page.getByRole("link", { name: "Conceição Ferreira" })).toBeVisible();
  await search.fill("JOAO");
  await expect(page.getByRole("link", { name: "João Pedro Almeida" })).toBeVisible();
  await search.fill("ninguém-assim");
  await expect(page.getByText("Nenhum cliente com esse nome ou telefone")).toBeVisible();
  await page.getByRole("button", { name: "Limpar busca" }).click();
  await search.fill("joão");
  await page.getByRole("link", { name: "João Pedro Almeida" }).click();

  await expect(page).toHaveURL(/\/admin\/clientes\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { level: 2, name: "João Pedro Almeida" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Histórico de reservas" })).toBeVisible();
  await bothThemes(page);

  const notes = page.getByLabel(/Preferências e cuidados/);
  await notes.fill("Gosta do balcão. Pediu saquê gelado.");
  await page.getByRole("button", { name: "Gravar notas" }).click();
  await expect(page.locator(".toast", { hasText: "Notas gravadas" })).toBeVisible();

  await page.getByRole("button", { name: "Ver telefone" }).click();
  await confirmIdentity(page);
  await expect(page.locator(".telefone__completo")).toHaveText("(45) 99911-2233");

  await page.reload();
  await page.waitForSelector("html[data-ready]");
  await expect(page.getByLabel(/Preferências e cuidados/)).toHaveValue("Gosta do balcão. Pediu saquê gelado.");
});

test("dono anonimiza um cliente e ele vira cliente anonimizado", async ({ page }) => {
  await open(page, "/admin/clientes?papel=dono&mock=normal");
  await page.getByLabel("Buscar cliente").fill("valentina");
  await page.getByRole("link", { name: "Valentina Duarte" }).click();
  await page.getByRole("button", { name: "Anonimizar" }).click();
  await page.getByRole("dialog", { name: /Anonimizar Valentina/ }).getByRole("button", { name: "Anonimizar" }).click();
  await confirmIdentity(page);
  await expect(page.getByRole("heading", { level: 2, name: "Cliente anonimizado" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ver telefone" })).toHaveCount(0);
});

test("pedidos do site: prazo de 15 dias e recusa pede motivo", async ({ page }) => {
  await open(page, "/admin/clientes/pedidos?papel=dono&mock=normal");
  const table = page.locator(".tabela-pedidos");
  await expect(table.getByText(/Daniela/)).toBeVisible();
  await expect(table.getByText("faltam 2 dias")).toBeVisible();
  await bothThemes(page);

  const row = table.locator("tr", { hasText: "Otávio" });
  await row.getByRole("button", { name: "Recusar" }).click();
  const dialog = page.getByRole("dialog", { name: "Recusar o pedido?" });
  await dialog.getByRole("button", { name: "Recusar pedido" }).click();
  await expect(dialog.getByText("Conte o motivo da recusa: ele vai para o cliente.")).toBeVisible();
  await dialog.getByLabel("Motivo").fill("O cliente pediu de novo receber as novidades.");
  await dialog.getByRole("button", { name: "Recusar pedido" }).click();
  await expect(dialog).toBeHidden();
  await expect(table.getByText(/Otávio/)).toHaveCount(0);
});

test("gerente vê a ficha sem exportar nem anonimizar, e sem os pedidos", async ({ page }) => {
  await open(page, "/admin/clientes?papel=gerente&mock=normal");
  await expect(page.locator(".tabela-clientes tbody tr").first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Pedidos do site/ })).toHaveCount(0);
  await page.getByLabel("Buscar cliente").fill("lívia");
  await page.getByRole("link", { name: "Lívia Sato" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Lívia Sato" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ver telefone" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Exportar dados" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Anonimizar" })).toHaveCount(0);
  await open(page, "/admin/clientes/pedidos");
  await expect(page.getByText("Os pedidos do site são só do dono.")).toBeVisible();
});

test("recepção não abre Clientes", async ({ page }) => {
  await open(page, "/admin/clientes?papel=recepcao&mock=normal");
  await expect(page.getByRole("heading", { level: 1, name: "Essa parte é de outro perfil da equipe" })).toBeVisible();
});

test("lista vazia diz o próximo passo", async ({ page }) => {
  await open(page, "/admin/clientes?papel=dono&mock=vazio");
  await expect(page.getByText("Ainda não tem cliente aqui")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ver reservas" })).toBeVisible();
  await bothThemes(page);
});

test("API fora mostra o aviso da casa no lugar, sem o texto do servidor", async ({ page }) => {
  await open(page, "/admin/clientes?papel=dono&mock=normal");
  await expect(page.locator(".tabela-clientes tbody tr").first()).toBeVisible();
  // daqui em diante toda chamada falha; o painel já está aberto, então só a área mostra
  await page.evaluate(() => sessionStorage.setItem("territorio:mock-scenario", JSON.stringify("erro")));
  await page.getByRole("link", { name: /Pedidos do site/ }).click();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Os pedidos não abriram");
  await expect(alert).not.toContainText("Erro simulado");
  await expect(page.getByRole("button", { name: "Tentar de novo" })).toBeVisible();
  await bothThemes(page);
});

// ---- histórias 5.15 e 5.17 na ficha ----------------------------------------------------------

/** Abre a ficha de um cliente pelo nome. */
async function card(page, papel, name) {
  await open(page, `/admin/clientes?papel=${papel}&mock=normal`);
  await page.getByLabel("Buscar cliente").fill(name);
  await page.getByRole("link", { name }).click();
  await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
}

test("gerente perdoa uma falta na ficha, com motivo", async ({ page }) => {
  await card(page, "gerente", "Vinícius Prates");
  const forgive = page.getByRole("button", { name: /^Perdoar a falta de/ });
  await forgive.click();
  const dialog = page.getByRole("dialog", { name: /Perdoar a falta/ });
  await dialog.getByRole("button", { name: "Perdoar falta" }).click();
  await expect(dialog).toContainText("Conte o motivo");
  await dialog.getByLabel("Motivo").fill("Avisou que a filha passou mal.");
  await dialog.getByRole("button", { name: "Perdoar falta" }).click();
  await expect(page.locator(".toast", { hasText: "Falta perdoada" })).toBeVisible();
  await expect(page.locator(".ficha__historico")).toContainText("perdoada");
  await bothThemes(page);
});

test("outra pessoa gravou a ficha antes: juntar as duas notas", async ({ page, context }) => {
  await card(page, "gerente", "João Pedro Almeida");
  const id = page.url().split("/admin/clientes/")[1];
  // outra pessoa grava antes, em outro aparelho
  const other = await context.newPage();
  await other.goto(`/admin/clientes/${id}?papel=dono&mock=normal`);
  await other.waitForSelector("html[data-ready]");
  await other.getByLabel(/Preferências e cuidados/).fill("Prefere o quintal.");
  await other.getByRole("button", { name: "Gravar notas" }).click();
  await expect(other.locator(".toast", { hasText: "Notas gravadas" })).toBeVisible();
  await other.close();
  // esta tela ainda tem a versão antiga
  await page.getByLabel(/Preferências e cuidados/).fill("Alérgico a amendoim.");
  await page.getByRole("button", { name: "Gravar notas" }).click();
  const dialog = page.getByRole("dialog", { name: "Outra pessoa gravou a ficha antes" });
  await expect(dialog).toContainText("Prefere o quintal.");
  await bothThemes(page);
  await dialog.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByLabel(/Preferências e cuidados/)).toHaveValue("Prefere o quintal.\nAlérgico a amendoim.");
});

test("anonimizar cancela as reservas futuras com aviso ao cliente", async ({ page }) => {
  await open(page, "/admin/clientes?papel=dono&mock=normal");
  // um cliente com uma reserva pela frente
  const target = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem("territorio:mock-db"));
    const r = db.reservations.find((x) => x.status === "confirmed" && new Date(x.starts_at) > new Date() && x.customer_id && db.customers.find((c) => c.id === x.customer_id)?.phone_e164);
    return { customer: r.customer_id, reservation: r.id };
  });
  await page.goto(`/admin/clientes/${target.customer}`);
  await page.waitForSelector("html[data-ready]");
  await page.getByRole("button", { name: "Anonimizar" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Anonimizar" }).click();
  await confirmIdentity(page);
  await expect(page.locator(".toast", { hasText: "Cliente anonimizado" })).toContainText("foi avisado");
  const after = await page.evaluate((id) => {
    const db = JSON.parse(localStorage.getItem("territorio:mock-db"));
    const r = db.reservations.find((x) => x.id === id);
    return { status: r.status, notice: r.messages.some((m) => m.template === "canceled"), outbox: (db.outbox || []).some((o) => o.reservation_id === id) };
  }, target.reservation);
  expect(after).toEqual({ status: "canceled", notice: true, outbox: true });
});
