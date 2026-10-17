// Área da Galeria (histórias 3.7, 3.8): envio em lote com texto alternativo obrigatório e erros por arquivo,
// edição, onde cada foto é usada, apagar só quando não usada; estados vazio e de erro; axe.
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

// o servidor de dev é compartilhado e o axe roda duas vezes por tela: dá folga a cada teste
test.describe.configure({ timeout: 90_000 });

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

async function bothThemes(page) {
  expect(await serious(page)).toEqual([]);
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await serious(page)).toEqual([]);
  await page.emulateMedia({ colorScheme: "light" });
}

async function open(page, url) {
  await page.goto(url);
  await page.waitForSelector("html[data-ready]");
  // a barra da demonstração fica sobre o fim da página; dobrada, deixa os botões livres
  const hide = page.getByRole("button", { name: "Esconder a barra" });
  if (await hide.isVisible()) await hide.click();
}

const PHOTO = { name: "salao-novo.jpg", mimeType: "image/jpeg", buffer: readFileSync("public/img/fotos/salao-480.jpg") };

test("dono vê as fotos da casa, com o que falta descrever e onde cada uma aparece", async ({ page }) => {
  await open(page, "/admin/galeria?papel=dono&mock=normal");
  await expect(page.getByRole("heading", { level: 1, name: "Galeria" })).toBeVisible();
  await expect(page.locator(".gl-foto")).toHaveCount(19);
  await expect(page.locator(".gl-foto__falta")).toHaveCount(2);
  await expect(page.locator(".gl-foto").first()).toContainText("em uso");
  await bothThemes(page);
});

test("enviar fotos em lote: tipo recusado, descrição obrigatória e envio", async ({ page }) => {
  await open(page, "/admin/galeria?papel=gerente&mock=normal");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Enviar fotos" }).click();
  await (await chooser).setFiles([PHOTO, { name: "IMG_2041.HEIC", mimeType: "image/heic", buffer: Buffer.from("not a jpeg") }]);
  const win = page.getByRole("dialog", { name: "Enviar fotos" });
  await expect(win.locator(".gl-envio__item--refused")).toContainText("Mais compatível");
  await win.getByRole("button", { name: "Enviar 1 foto" }).click();
  await expect(win.locator(".field__error")).toContainText("Falta descrever a foto");
  await win.getByLabel("O que aparece na foto").fill("Salão com as mesas postas antes de abrir");
  await win.getByLabel("Crédito").fill("Larissa Okamoto");
  await bothThemes(page);
  await win.getByRole("button", { name: "Enviar 1 foto" }).click();
  await expect(win.locator(".badge--confirmed")).toContainText("enviada", { timeout: 20_000 });
  await win.getByRole("button", { name: "Ver na galeria" }).click();
  await expect(page.locator(".gl-foto")).toHaveCount(20);
  await expect(page.locator(".gl-foto").first()).toContainText("Salão com as mesas postas antes de abrir");

  await page.reload();
  await page.waitForSelector("html[data-ready]");
  await expect(page.locator(".gl-foto")).toHaveCount(20);
});

test("descrever uma foto e apagar só o que não está em uso", async ({ page }) => {
  await open(page, "/admin/galeria?papel=dono&mock=normal");
  // uma foto em uso não pode ser apagada: a janela lista onde ela aparece
  await page.locator(".gl-foto").first().getByRole("button", { name: /^Editar / }).click();
  let win = page.getByRole("dialog", { name: "Foto" });
  await win.getByRole("button", { name: "Apagar foto" }).click();
  const inUse = page.getByRole("dialog", { name: "Essa foto está em uso" });
  await expect(inUse).toContainText("Ambiente");
  await inUse.locator(".dialog__actions").getByRole("button", { name: "Fechar" }).click();
  await expect(inUse).toHaveCount(0);
  await page.keyboard.press("Escape");

  // as fotos sem descrição
  await page.getByRole("button", { name: /Sem descrição/ }).click();
  await expect(page.locator(".gl-foto")).toHaveCount(2);
  await page.locator(".gl-foto").first().getByRole("button", { name: /^Editar / }).click();
  win = page.getByRole("dialog", { name: "Foto" });
  await win.getByRole("button", { name: "Salvar foto" }).click();
  await expect(win.locator(".field__error")).toContainText("Falta descrever a foto");
  await bothThemes(page);
  await win.getByLabel("O que aparece na foto").fill("Cartaz do Território Faz 01, em preto e branco");
  await win.getByRole("button", { name: "Salvar foto" }).click();
  await expect(page.locator(".gl-foto")).toHaveCount(1);

  // uma foto sem uso some depois de confirmar
  await page.getByRole("button", { name: /Sem uso/ }).click();
  const before = await page.locator(".gl-foto").count();
  await page.locator(".gl-foto").first().getByRole("button", { name: /^Editar / }).click();
  await page.getByRole("dialog", { name: "Foto" }).getByRole("button", { name: "Apagar foto" }).click();
  await page.getByRole("dialog", { name: "Apagar a foto?" }).getByRole("button", { name: "Apagar foto" }).click();
  await expect(page.locator(".gl-foto")).toHaveCount(before - 1);
});

test("vazio mostra o próximo passo", async ({ page }) => {
  await open(page, "/admin/galeria?papel=dono&mock=vazio");
  await expect(page.getByText("Nenhuma foto ainda")).toBeVisible();
  await expect(page.getByRole("button", { name: "Enviar fotos" })).toBeVisible();
  await bothThemes(page);
});

test("erro fica contido na área", async ({ page }) => {
  // a sessão abre normal, depois toda chamada falha e o painel vai para a Galeria
  await open(page, "/admin/site?papel=dono&mock=normal");
  await expect(page.locator(".st-bloco").first()).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem("territorio:mock-scenario", JSON.stringify("erro")));
  await page.evaluate(() => window.history.pushState(null, "", "/admin/galeria"));
  await page.evaluate(() => window.dispatchEvent(new PopStateEvent("popstate")));
  await expect(page.getByRole("alert").filter({ hasText: "A galeria não abriu." })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Erro simulado pela demonstração")).toHaveCount(0);
  await bothThemes(page);
});

test("recepção não abre a Galeria", async ({ page }) => {
  await open(page, "/admin/galeria?papel=recepcao&mock=normal");
  await expect(page.getByRole("heading", { level: 1, name: "Essa parte é de outro perfil da equipe" })).toBeVisible();
});

test("mudar a foto e a ordem vai para o registro de ações (bug 14)", async ({ page }) => {
  await open(page, "/admin/galeria?papel=dono&mock=normal");
  await page.locator(".gl-foto").first().getByRole("button", { name: /^Editar / }).click();
  const win = page.getByRole("dialog", { name: "Foto" });
  await win.getByLabel("Crédito").fill("@plongeefotografia");
  await win.getByRole("button", { name: "Salvar foto" }).click();
  await expect(win).toHaveCount(0);
  await page.locator(".gl-foto").nth(1).locator('[data-dir="up"]').click();
  await expect(page.locator(".gl-foto").first()).toBeVisible();
  const log = await page.evaluate(() => JSON.parse(localStorage.getItem("territorio:mock-db")).audit.filter((e) => e.entity_type === "image"));
  const edit = log.find((e) => e.action === "image.update");
  expect(edit.changes.credit.to).toBe("@plongeefotografia");
  expect(edit).toMatchObject({ actor_type: "user", device_label: "Acesso pessoal" });
  await expect.poll(async () => (await page.evaluate(() => JSON.parse(localStorage.getItem("territorio:mock-db")).audit.some((e) => e.action === "image.order")))).toBe(true);
});

test("foto recém-enviada fica preparando e não vai para o site até ficar pronta (?mock=preparando)", async ({ page }) => {
  await open(page, "/admin/galeria?papel=dono&mock=preparando");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Enviar fotos" }).click();
  await (await chooser).setFiles([PHOTO]);
  const win = page.getByRole("dialog", { name: "Enviar fotos" });
  await win.getByLabel("O que aparece na foto").fill("Balcão com os copos de saquê");
  await win.getByRole("button", { name: "Enviar 1 foto" }).click();
  await expect(win.locator(".badge--confirmed")).toContainText("enviada", { timeout: 20_000 });
  await win.getByRole("button", { name: "Ver na galeria" }).click();
  const first = page.locator(".gl-foto").first();
  await expect(first).toContainText("Balcão com os copos de saquê");
  await expect(first.locator(".gl-foto__estado")).toContainText("preparando");
  await bothThemes(page);

  // colocar num prato é recusado com o image_not_ready do catálogo
  const answer = await page.evaluate(async () => {
    const session = await (await fetch("/api/v1/staff/auth/session")).json().catch(() => ({}));
    const headers = { "Content-Type": "application/json", Accept: "application/json" };
    if (session?.csrf_token) headers["X-CSRF-Token"] = session.csrf_token;
    const images = await (await fetch("/api/v1/staff/images", { headers })).json();
    const menu = await (await fetch("/api/v1/staff/menu", { headers })).json();
    const categories = menu.categories || menu;
    const item = categories.flatMap((c) => c.items || [])[0];
    const response = await fetch(`/api/v1/staff/menu/items/${item.id}`, { method: "PATCH", headers, body: JSON.stringify({ image_id: images[0].id }) });
    return { status: response.status, body: await response.json().catch(() => null) };
  });
  expect(answer.status).toBe(409);
  expect(answer.body.type).toBe("image_not_ready");
});
