// Conta Google da casa (história 2.22): a autorização simulada do Google, a agenda e a
// pasta, o que vai em cada evento e o que nunca vai, os próximos eventos, a linha do Sistema,
// desligar a agenda com a confirmação de identidade, e desconectar a conta inteira;
// axe no claro e no escuro, no computador e no celular.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.setTimeout(120_000);

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

const block = (page) => page.locator(".cfg-google");

async function connect(page) {
  await open(page, "/admin/configuracoes/integracoes?papel=dono&mock=normal");
  await expect(block(page).getByRole("button", { name: "Ligar conta Google" })).toBeVisible({ timeout: 30_000 });
  await block(page).getByRole("button", { name: "Ligar conta Google" }).click();
  const google = page.getByRole("dialog", { name: "Escolha uma conta" });
  await expect(google).toBeVisible();
  await expect(serious(page)).resolves.toEqual([]);
  await google.getByRole("button", { name: /territorio\.foz@gmail\.com/ }).click();
  const grant = page.getByRole("dialog", { name: /quer acessar sua conta/ });
  await expect(grant.getByLabel("Ver e editar eventos da agenda")).toBeChecked();
  await expect(grant.getByLabel(/arquivos do Drive criados por este app/)).toBeChecked();
  await grant.getByRole("button", { name: "Permitir" }).click();
  await expect(block(page).getByText("territorio.foz@gmail.com")).toBeVisible({ timeout: 30_000 });
}

test("liga a conta, cria a agenda, escolhe a pasta e vê a prévia do evento", async ({ page }) => {
  await connect(page);
  // a agenda: criar "Reservas · Território"
  const agenda = page.locator("#linha-google-agenda");
  await expect(agenda.getByLabel("Nome da agenda")).toHaveValue("Reservas · Território");
  await agenda.getByRole("button", { name: "Usar esta agenda" }).click();
  await expect(agenda.getByRole("switch", { name: "Reservas na Agenda" })).toHaveAttribute("aria-checked", "true", { timeout: 30_000 });
  // a pasta: uma que a conta já tem
  const drive = page.locator("#linha-google-drive");
  await drive.getByLabel("Usar uma pasta que a conta já tem").check();
  await drive.getByLabel("Pasta", { exact: true }).selectOption({ label: "Contabilidade 2026" });
  await drive.getByRole("button", { name: "Usar esta pasta" }).click();
  await expect(drive.getByText("Contabilidade 2026", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(drive.getByRole("switch", { name: "Folha da noite e exportações no Drive" })).toHaveAttribute("aria-checked", "true");

  // o que vai e o que nunca vai, e a prévia de um evento
  await expect(block(page).getByText("Nunca vai")).toBeVisible();
  await expect(block(page).locator(".cfg-google__itens--nunca")).toContainText("telefone");
  await expect(block(page).locator(".cfg-google__itens--nunca")).toContainText("restrição alimentar");
  const preview = block(page).locator(".cfg-gevento");
  await expect(preview).toContainText(/TR-\d+/);
  await expect(preview).toContainText("/admin/reservas/");
  await expect(preview).not.toContainText("+55");
  await expect(block(page).getByRole("list", { name: "Próximos eventos na agenda" }).locator("li").first()).toBeVisible();
  await expect(page.locator("#linha-google-sincronizacao")).toContainText("ligada");
  // nada mais largo que a tela, no celular também
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await bothThemes(page);

  // o registro de ações tem a conexão
  const audit = await page.evaluate(() => JSON.parse(localStorage.getItem("territorio:mock-db")).audit.slice(0, 4).map((a) => a.action));
  expect(audit).toContain("settings.google_connect");
  expect(audit).toContain("settings.google_update");

  // o status do Sistema responde com a linha do Google
  const status = await page.evaluate(() => fetch("/api/v1/staff/system/status").then((r) => r.json()));
  const google = status.items.find((i) => i.key === "google");
  expect(google.state).toBe("ok");
  expect(google.detail).toContain("Reservas · Território");
});

test("desligar a Agenda pede identidade e pergunta pelos eventos; desligar a conta volta ao começo", async ({ page }) => {
  await connect(page);
  const agenda = page.locator("#linha-google-agenda");
  await agenda.getByRole("button", { name: "Usar esta agenda" }).click();
  const sw = agenda.getByRole("switch", { name: "Reservas na Agenda" });
  await expect(sw).toHaveAttribute("aria-checked", "true", { timeout: 30_000 });

  await sw.click();
  const ask = page.getByRole("dialog", { name: "Desligar as reservas na Agenda?" });
  await expect(ask.getByRole("button", { name: "Voltar" })).toBeFocused();
  await ask.getByLabel("Deixar na agenda (param de ser atualizados)").check();
  await ask.getByRole("button", { name: "Desligar a Agenda" }).click();
  const who = page.getByRole("dialog", { name: "Confirme que é você" });
  await who.getByLabel("Senha").fill("admin");
  await who.locator("input[name=code]").fill("123456");
  await who.getByRole("button", { name: "Confirmar" }).click();
  await expect(sw).toHaveAttribute("aria-checked", "false", { timeout: 30_000 });
  await expect(page.locator("#linha-google-sincronizacao")).toContainText(/ficaram na agenda|ficou na agenda/);
  await expect(page.locator("#linha-google-sincronizacao")).toContainText("não ligada");

  // a conta inteira (identidade ainda recente: sem segunda confirmação)
  await block(page).getByRole("button", { name: "Desligar a conta" }).click();
  await page.getByRole("dialog", { name: "Desligar a conta Google?" }).getByRole("button", { name: "Desligar a conta" }).click();
  await expect(block(page).getByRole("button", { name: "Ligar conta Google" })).toBeVisible({ timeout: 30_000 });
  const audit = await page.evaluate(() => JSON.parse(localStorage.getItem("territorio:mock-db")).audit.slice(0, 2).map((a) => a.action));
  expect(audit).toEqual(["settings.google_disconnect", "settings.google_disconnect"]);
});

test("vazio mostra a conta para ligar; gerente não chega a Integrações", async ({ page }) => {
  await open(page, "/admin/configuracoes/integracoes?papel=dono&mock=vazio");
  await expect(block(page).getByText("Nenhuma conta ligada")).toBeVisible({ timeout: 30_000 });
  await expect(block(page).getByRole("button", { name: "Ligar conta Google" })).toBeVisible();
  await bothThemes(page);

  await open(page, "/admin/configuracoes/integracoes?papel=gerente&mock=normal");
  await expect(page.getByText("Esse grupo não está aqui.")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".cfg-google")).toHaveCount(0);
});

test("erro ao abrir Integrações fica no lugar, sem texto do servidor", async ({ page }) => {
  await open(page, "/admin/configuracoes/integracoes?papel=dono&mock=erro");
  const alert = page.getByRole("alert").filter({ hasText: "Não deu para abrir" });
  await expect(alert).toBeVisible({ timeout: 30_000 });
  await expect(alert).not.toContainText("simulado");
  await expect(alert.getByRole("button", { name: "Tentar de novo" })).toBeVisible();
});
