// Área do Cardápio (histórias 4.11 a 4.13): rascunho por categorias e pratos, prévia, publicar,
// "acabou" na hora; a recepção vê só os botões de liga e desliga; estados vazio e de erro; axe.
import AxeBuilder from "@axe-core/playwright";
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

test("dono edita um prato no rascunho, vê a prévia e publica", async ({ page }) => {
  await open(page, "/admin/cardapio?papel=dono&mock=normal");
  await expect(page.getByRole("heading", { level: 1, name: "Cardápio" })).toBeVisible();
  await expect(page.locator(".cd-mudancas")).toContainText("2 mudanças");
  await bothThemes(page);

  await page.getByRole("button", { name: "Editar Gyoza" }).click();
  const win = page.getByRole("dialog", { name: "Editar Gyoza" });
  await win.getByLabel("Preço em reais").fill("34,50");
  await win.getByRole("tab", { name: /Inglês/ }).click();
  await win.getByLabel("Descrição em inglês").fill("Pan-fried dumplings");
  await win.getByRole("button", { name: "Salvar prato" }).click();
  await expect(page.locator(".toast").filter({ hasText: "Gyoza salvo no rascunho" })).toBeVisible();
  await expect(page.locator(".cd-mudancas")).toContainText("3 mudanças");

  await page.getByRole("button", { name: "Ver prévia" }).click();
  const preview = page.getByRole("dialog", { name: "Prévia do cardápio" });
  await expect(preview.locator(".cd-folha").first()).toContainText("R$ 34,50");
  await preview.getByRole("tab", { name: /Inglês/ }).click();
  await expect(preview.locator(".cd-folha").first()).toContainText("To share");
  await expect(preview.locator(".cd-folha").first()).toContainText("sold out");
  await bothThemes(page);
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);

  await page.getByRole("button", { name: "Publicar", exact: true }).click();
  await expect(page.locator(".toast").filter({ hasText: "Cardápio publicado" })).toBeVisible();
  await expect(page.locator(".cd-topo")).toContainText("O rascunho está igual ao site");
  await expect(page.locator(".cs-pub--feito")).toContainText("no ar", { timeout: 30_000 });

  await page.reload();
  await page.waitForSelector("html[data-ready]");
  await expect(page.getByRole("row", { name: /Gyoza/ })).toContainText("R$ 34,50");
});

test("nova categoria, ordem e arquivar", async ({ page }) => {
  await open(page, "/admin/cardapio?papel=gerente&mock=normal");
  await page.getByRole("button", { name: "Nova categoria" }).click();
  const win = page.getByRole("dialog", { name: "Nova categoria" });
  await win.getByRole("button", { name: "Criar categoria" }).click();
  await expect(win.locator(".field__error")).toContainText("Dê um nome à categoria");
  await win.getByLabel("Nome da categoria").fill("Sobremesas");
  await win.getByRole("button", { name: "Criar categoria" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Sobremesas" })).toBeVisible();
  await expect(page.locator(".cd-vazia")).toContainText("está vazia e não vai aparecer");

  await page.locator(".cd-categoria__nome", { hasText: "Pra compartilhar" }).click();
  await page.getByRole("button", { name: "Descer Karage" }).click();
  await expect(page.locator(".cd-tabela tbody tr").nth(1)).toContainText("Karage");
  await page.getByRole("button", { name: "Arquivar Tonkatsu" }).click();
  await expect(page.locator(".cd-arquivados")).toContainText("Arquivados (1)");
});

test("recepção só marca o que acabou, e o site já sabe", async ({ page }) => {
  await open(page, "/admin/cardapio?papel=recepcao&mock=normal");
  await expect(page.getByRole("button", { name: "Publicar" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Novo prato" })).toHaveCount(0);
  const gyoza = page.getByRole("checkbox", { name: "Gyoza Acabou" });
  await gyoza.check();
  await expect(page.locator(".toast").filter({ hasText: "Gyoza: acabou" })).toBeVisible();
  await expect(page.locator(".cd-resumo")).toContainText("Gyoza");
  const menu = await page.evaluate(async () => (await fetch("/api/v1/menu")).json());
  const item = menu.categories.flatMap((c) => c.items).find((i) => i.name === "Gyoza");
  expect(item.available).toBe(false);
  await bothThemes(page);
});

test("vazio mostra o próximo passo", async ({ page }) => {
  await open(page, "/admin/cardapio?papel=dono&mock=vazio");
  await expect(page.getByText("O cardápio está vazio")).toBeVisible();
  await expect(page.getByRole("button", { name: "Criar a primeira categoria" })).toBeVisible();
  await bothThemes(page);
});

test("erro fica contido na área", async ({ page }) => {
  // a sessão abre normal, depois toda chamada falha e o painel vai para o Cardápio
  await open(page, "/admin/site?papel=dono&mock=normal");
  await expect(page.locator(".st-bloco").first()).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem("territorio:mock-scenario", JSON.stringify("erro")));
  await page.evaluate(() => window.history.pushState(null, "", "/admin/cardapio"));
  await page.evaluate(() => window.dispatchEvent(new PopStateEvent("popstate")));
  await expect(page.getByRole("alert").filter({ hasText: "O cardápio não abriu." })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Erro simulado pela demonstração")).toHaveCount(0);
  await bothThemes(page);
});

// ---- ordem arrastando, duas pessoas gravando, as palavras da casa, falhas, ajustes, o registro ----

/** Muda o banco da demonstração (como Configurações faria) e recarrega. */
async function setInDb(page, path, value) {
  // uma chamada da página aberta pode gravar a sua cópia por cima da nossa antes de recarregar: grava até ficar
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.evaluate(
      ([keys, v]) => {
        const db = JSON.parse(localStorage.getItem("territorio:mock-db"));
        let node = db;
        for (const k of keys.slice(0, -1)) node = node[k];
        node[keys.at(-1)] = v;
        localStorage.setItem("territorio:mock-db", JSON.stringify(db));
      },
      [path.split("."), value],
    );
    await page.reload();
    await page.waitForSelector("html[data-ready]");
    const held = await page.evaluate(([keys, v]) => {
      let node = JSON.parse(localStorage.getItem("territorio:mock-db"));
      for (const k of keys) node = node?.[k];
      return node === v;
    }, [path.split("."), value]);
    if (held) return;
  }
}

test("arrastar vários pratos de uma vez manda a ordem inteira (PUT /staff/menu/order)", async ({ page }, info) => {
  test.skip(info.project.name === "celular", "no celular a ordem muda pelas setas, testadas acima");
  await open(page, "/admin/cardapio?papel=dono&mock=normal");
  const order = page.waitForRequest((r) => r.url().endsWith("/api/v1/staff/menu/order") && r.method() === "PUT");
  const rows = page.locator(".cd-tabela tbody tr");
  await page.getByRole("checkbox", { name: "Escolher Karage para arrastar junto" }).check();
  await page.getByRole("checkbox", { name: "Escolher Gyoza para arrastar junto" }).check();
  await expect(page.locator(".cd-dica-ordem")).toContainText("2 pratos escolhidos");
  await rows.filter({ hasText: "Karage" }).dragTo(rows.filter({ hasText: "Ebi Furai" }));
  const body = (await order).postDataJSON();
  expect(body.items.slice(0, 4)).toHaveLength(4);
  await expect(page.locator(".toast").filter({ hasText: "Ordem mudada no rascunho" })).toBeVisible();
  const names = await rows.locator(".cd-tabela__prato b").allTextContents();
  expect(names.indexOf("Karage")).toBeGreaterThan(names.indexOf("Tonkatsu"));
  expect(names.indexOf("Gyoza")).toBe(names.indexOf("Karage") + 1);
});

test("outra pessoa gravou o mesmo prato: juntar as mudanças", async ({ page }) => {
  await open(page, "/admin/cardapio?papel=dono&mock=normal&conflito=1");
  await page.getByRole("button", { name: "Editar Gyoza" }).click();
  const win = page.getByRole("dialog", { name: "Editar Gyoza" });
  await win.getByLabel("Descrição em português").fill("Pastelzinho japonês, frito na chapa.");
  await win.getByRole("button", { name: "Salvar prato" }).click();
  const conflict = page.getByRole("dialog", { name: "Outra pessoa gravou antes de você" });
  await expect(conflict).toContainText("preço");
  await bothThemes(page);
  await conflict.getByRole("button", { name: "Juntar as mudanças" }).click();
  await expect(page.locator(".toast").filter({ hasText: "Gyoza salvo no rascunho" })).toBeVisible();
  const row = page.getByRole("row", { name: /Gyoza/ });
  await expect(row).toContainText("Pastelzinho japonês"); // o meu
  await expect(row).toContainText("R$ 34"); // o deles: o preço foi de 32 para 34
});

test("palavra que a casa não usa barra a publicação e diz qual prato ajeitar", async ({ page }) => {
  await open(page, "/admin/cardapio?papel=gerente&mock=normal");
  await page.getByRole("button", { name: "Editar Karage" }).click();
  const win = page.getByRole("dialog", { name: "Editar Karage" });
  await win.getByLabel("Descrição em português").fill("Frango frito, uma experiência da casa.");
  await win.getByRole("button", { name: "Salvar prato" }).click();
  await expect(page.locator(".toast").filter({ hasText: "Karage salvo no rascunho" })).toBeVisible();
  await page.getByRole("button", { name: "Publicar", exact: true }).click();
  const alert = page.locator(".cd-palavras");
  await expect(alert).toContainText("Karage");
  await expect(alert).toContainText("experiência");
  await alert.getByRole("button", { name: "Editar Karage" }).click();
  await expect(page.getByRole("dialog", { name: "Editar Karage" })).toBeVisible();
});

test("publicação que falha no cenário de erro: o site não atualizou e o rascunho fica (4.12)", async ({ page }) => {
  await open(page, "/admin/cardapio?papel=dono&mock=normal");
  await expect(page.locator(".cd-mudancas")).toContainText("mudanças");
  // uma gravação antes: o painel guarda o token da sessão antes de as chamadas começarem a falhar
  await page.getByRole("checkbox", { name: "Gyoza Acabou" }).check();
  await expect(page.locator(".toast").filter({ hasText: "Gyoza: acabou" })).toBeVisible();
  // o "Com erro" da barra da demonstração, depois de a tela abrir: o endereço não diz mais mock=normal
  await page.evaluate(() => {
    sessionStorage.setItem("territorio:mock-scenario", JSON.stringify("erro"));
    history.replaceState(null, "", `${location.pathname}?papel=dono`);
  });
  await page.getByRole("button", { name: "Publicar", exact: true }).click();
  await expect(page.locator(".cs-pub--falhou")).toContainText("O site não atualizou", { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Publicar de novo" })).toBeVisible();
});

test("recepção sem permissão de marcar acabou não vê as chaves", async ({ page }) => {
  await open(page, "/admin/cardapio?papel=recepcao&mock=normal");
  await setInDb(page, "floor_settings.reception_can_finish", false);
  await expect(page.getByText("Por enquanto, quem marca o acabou é o gerente.")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Acabou/ })).toHaveCount(0);
  // a API recusa também
  const answer = await page.evaluate(async () => {
    const session = await (await fetch("/api/v1/staff/auth/session")).json().catch(() => ({}));
    const headers = { "Content-Type": "application/json" };
    if (session?.csrf_token) headers["X-CSRF-Token"] = session.csrf_token;
    const menu = await (await fetch("/api/v1/staff/menu")).json();
    const id = menu.categories[0].items[0].id;
    const response = await fetch(`/api/v1/staff/menu/items/${id}`, { method: "PATCH", headers, body: JSON.stringify({ available: false }) });
    return { status: response.status, type: (await response.json().catch(() => ({}))).type };
  });
  expect(answer).toEqual({ status: 403, type: "forbidden" });
});

test("prévia com a regra de item sem preço da configuração", async ({ page }) => {
  await open(page, "/admin/cardapio?papel=dono&mock=normal");
  await setInDb(page, "menu_settings.unpriced_item", "ask");
  await page.getByRole("button", { name: "Ver prévia" }).click();
  const preview = page.getByRole("dialog", { name: "Prévia do cardápio" });
  await expect(preview.locator(".cd-folha__preco--consulte").first()).toHaveText("consulte");
  await expect(preview).not.toContainText("a confirmar");
});

test("acabou, edição e publicação vão para o registro de ações (bug 14)", async ({ page }) => {
  await open(page, "/admin/cardapio?papel=dono&mock=normal");
  await page.getByRole("checkbox", { name: "Gyoza Acabou" }).check();
  await expect(page.locator(".toast").filter({ hasText: "Gyoza: acabou" })).toBeVisible();
  await page.getByRole("button", { name: "Arquivar Tonkatsu" }).click();
  await expect(page.locator(".cd-arquivados")).toBeVisible();
  const log = await page.evaluate(() => JSON.parse(localStorage.getItem("territorio:mock-db")).audit.filter((e) => e.action.startsWith("menu.")));
  const soldOut = log.find((e) => e.action === "menu.sold_out" && e.summary.includes("Gyoza"));
  expect(soldOut).toMatchObject({ actor_type: "user", entity_type: "menu_item", changes: { available: { from: true, to: false } } });
  expect(soldOut.actor_label).toBeTruthy();
  expect(soldOut.device_label).toBeTruthy();
  expect(soldOut.occurred_at).toBeTruthy();
  expect(log.some((e) => e.action === "menu.item_archive" && e.summary.includes("Tonkatsu"))).toBe(true);
});
