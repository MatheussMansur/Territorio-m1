// Área do Site (histórias 4.14, 4.15): blocos em três línguas com prévia, rascunho, publicar,
// histórico e restaurar; a aba "Números"; estados vazio e de erro; axe nos dois temas.
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

test("dono vê os blocos do site com o que está no ar e o rascunho", async ({ page }) => {
  await open(page, "/admin/site?papel=dono&mock=normal");
  await expect(page.getByRole("heading", { level: 1, name: "Site" })).toBeVisible();
  const blocks = page.locator(".st-bloco");
  await expect(blocks).toHaveCount(6);
  const block = (name) => blocks.filter({ has: page.getByRole("heading", { name, exact: true }) });
  await expect(block("Capa")).toContainText("no ar");
  await expect(block("A casa")).toContainText("rascunho");
  await expect(page.locator(".cs-pub")).toContainText("Última publicação");
  await bothThemes(page);
});

test("editar a capa: língua sem tradução, prévia, salvar, publicar e voltar a uma versão", async ({ page }) => {
  await open(page, "/admin/site/capa?papel=dono&mock=normal");
  await expect(page.getByRole("heading", { level: 2, name: "Capa" })).toBeVisible();
  const kicker = page.getByLabel("Frase de cima");
  await kicker.fill("Izakaya da fronteira, aberto de quarta a sábado");
  await expect(page.locator(".st-previa--capa")).toContainText("Izakaya da fronteira, aberto de quarta a sábado");
  await expect(page.locator(".field__count").first()).toContainText("/60");

  // espanhol: o texto antigo ainda está lá; esvazie e o losango aparece
  await page.getByRole("tab", { name: /Espanhol/ }).click();
  await page.getByLabel("Frase escrita à mão").fill("");
  await expect(page.getByRole("tab", { name: /Espanhol/ })).toContainText("sem tradução");
  await expect(page.locator(".cs-pendente")).toContainText("Sem tradução em espanhol");
  await bothThemes(page);

  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(page.locator(".toast").filter({ hasText: "Rascunho guardado" })).toBeVisible();
  await expect(page.locator(".st-estado")).toContainText("rascunho");

  await page.getByRole("button", { name: "Publicar", exact: true }).click();
  await expect(page.locator(".cs-pub--andando")).toBeVisible();
  await expect(page.locator(".cs-pub--feito")).toContainText("no ar", { timeout: 30_000 });

  // o histórico traz uma versão mais antiga de volta como rascunho
  await page.getByRole("button", { name: "Histórico" }).click();
  const drawer = page.getByRole("dialog", { name: "Histórico · Capa" });
  await expect(drawer.locator(".st-versao")).toHaveCount(4);
  await expect(drawer.locator(".st-versao").first()).toContainText("no ar");
  await drawer.getByRole("button", { name: "Voltar à versão 1" }).click();
  await expect(page.locator(".toast").filter({ hasText: "A versão 1 voltou como rascunho" })).toBeVisible();
  await page.getByRole("tab", { name: /Português/ }).click();
  await expect(page.getByLabel("Frase de cima")).toHaveValue("Izakaya na fronteira");

  // continua depois de recarregar
  await page.reload();
  await page.waitForSelector("html[data-ready]");
  await expect(page.getByLabel("Frase de cima")).toHaveValue("Izakaya na fronteira");
});

test("campo obrigatório vazio não grava e sair com mudanças pergunta antes", async ({ page }) => {
  await open(page, "/admin/site/busca?papel=gerente&mock=normal");
  await page.getByLabel("Título na busca").fill("");
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(page.locator(".field--invalid .field__error")).toContainText("Escreva em português");
  await page.getByRole("link", { name: "← Blocos do site" }).click();
  const ask = page.getByRole("dialog", { name: "Descartar as mudanças?" });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Continuar editando" }).click();
  await expect(page.getByLabel("Título na busca")).toBeVisible();
});

test("avisos com validade e frases por dia", async ({ page }) => {
  await open(page, "/admin/site/avisos?papel=dono&mock=normal");
  await expect(page.locator(".st-aviso")).toHaveCount(1);
  await page.getByRole("button", { name: "Novo aviso" }).click();
  await expect(page.locator(".st-aviso")).toHaveCount(2);
  await page.locator(".st-aviso").nth(1).getByLabel("Texto do aviso").fill("Hoje a cozinha fecha mais cedo, às 22h.");
  await expect(page.locator(".st-previa--hoje")).toContainText("Hoje a cozinha fecha mais cedo");
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(page.locator(".toast").filter({ hasText: "Rascunho guardado" })).toBeVisible();

  await open(page, "/admin/site/frases?papel=dono&mock=normal");
  await expect(page.getByLabel("Quinta")).toHaveValue("Toda quinta é dia de peixe fresco!");
});

test("números do site com exemplo", async ({ page }) => {
  await open(page, "/admin/site/numeros?papel=dono&mock=normal");
  await expect(page.getByText("Números de exemplo.")).toBeVisible();
  await expect(page.locator(".stat")).toHaveCount(4);
  await expect(page.getByRole("heading", { name: "Visitas por dia" })).toBeVisible();
  await bothThemes(page);
});

test("vazio mostra o próximo passo", async ({ page }) => {
  await open(page, "/admin/site?papel=dono&mock=vazio");
  await expect(page.getByText("O site ainda não tem textos")).toBeVisible();
  await expect(page.getByRole("link", { name: "Escrever a capa" })).toBeVisible();
  await bothThemes(page);
});

test("erro fica contido na área", async ({ page }) => {
  // a sessão abre normal, depois toda chamada da área falha: o erro fica no seu lugar
  await open(page, "/admin/site?papel=dono&mock=normal");
  // tira o ?mock=normal do endereço antes: uma chamada feita antes da próxima navegação leria de novo
  await page.evaluate(() => {
    window.history.replaceState(null, "", "/admin/site");
    sessionStorage.setItem("territorio:mock-scenario", JSON.stringify("erro"));
  });
  await page.locator(".cs-subnav").getByRole("link", { name: "Números" }).click();
  await expect(page.getByRole("alert")).toContainText("Os números não abriram.");
  await expect(page.getByRole("button", { name: "Tentar de novo" })).toBeVisible();
  await expect(page.getByText("Erro simulado pela demonstração")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Site" })).toBeVisible();
  await bothThemes(page);
});

test("recepção não abre o Site", async ({ page }) => {
  await open(page, "/admin/site?papel=recepcao&mock=normal");
  await expect(page.getByRole("heading", { level: 1, name: "Essa parte é de outro perfil da equipe" })).toBeVisible();
});

// ---- duas pessoas gravando, as palavras da casa, a sessão que acaba, falhas e o registro ----

test("outra pessoa gravou a capa: juntar ou descartar (4.14)", async ({ page }) => {
  await open(page, "/admin/site/capa?papel=dono&mock=normal&conflito=1");
  await page.getByLabel("Frase de cima").fill("Izakaya da fronteira, de quarta a sábado");
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  const conflict = page.getByRole("dialog", { name: "Outra pessoa gravou antes de você" });
  await expect(conflict).toContainText("Frase escrita à mão");
  await bothThemes(page);
  await conflict.getByRole("button", { name: "Juntar as mudanças" }).click();
  await expect(page.locator(".toast").filter({ hasText: "Rascunho guardado" })).toBeVisible();
  // o meu e o deles, juntos
  await expect(page.getByLabel("Frase de cima")).toHaveValue("Izakaya da fronteira, de quarta a sábado");
  await expect(page.getByLabel("Frase escrita à mão")).toHaveValue("Pode entrar, a casa é sua!");
});

test("palavra que a casa não usa: a publicação diz qual campo ajeitar (4.12, NFR-34)", async ({ page }) => {
  await open(page, "/admin/site/capa?papel=gerente&mock=normal");
  await page.getByLabel("Texto de apoio").fill("Uma experiência de izakaya na fronteira.");
  await page.getByRole("button", { name: "Publicar", exact: true }).click();
  const field = page.getByLabel("Texto de apoio");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toBeFocused();
  await expect(page.locator(".field__error")).toContainText("experiência");
});

test("a entrada venceu no meio da edição: entra de novo ali mesmo e o texto continua (4.14)", async ({ page }) => {
  await open(page, "/admin/site/capa?papel=dono&mock=normal");
  await page.getByLabel("Frase de cima").fill("Texto que não pode se perder");
  // a sessão acaba: o perfil da demonstração vai embora
  await page.evaluate(() => {
    sessionStorage.removeItem("territorio:mock-papel");
    history.replaceState(null, "", location.pathname);
  });
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(page.locator("dialog.entrar-de-novo")).toBeVisible();
  await expect(page.getByLabel("Frase de cima")).toHaveValue("Texto que não pode se perder");
});

test("publicação que falha no cenário de erro mostra o site não atualizou (4.15)", async ({ page }) => {
  await open(page, "/admin/site/casa?papel=dono&mock=normal");
  await expect(page.locator(".st-estado")).toContainText("rascunho");
  // uma gravação antes: o painel guarda o token da sessão antes de as chamadas começarem a falhar
  await page.getByLabel("Assinatura à mão").fill("Chega mais, a casa é sua!");
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(page.locator(".toast").filter({ hasText: "Rascunho guardado" })).toBeVisible();
  // o "Com erro" da barra da demonstração, depois de a tela abrir: o endereço não diz mais mock=normal
  await page.evaluate(() => {
    sessionStorage.setItem("territorio:mock-scenario", JSON.stringify("erro"));
    history.replaceState(null, "", `${location.pathname}?papel=dono`);
  });
  await page.getByRole("button", { name: "Publicar", exact: true }).click();
  await expect(page.locator(".cs-pub--falhou")).toContainText("O site não atualizou", { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Publicar de novo" })).toBeVisible();
});

test("salvar e publicar um bloco vão para o registro de ações (bug 14)", async ({ page }) => {
  await open(page, "/admin/site/links?papel=dono&mock=normal");
  await page.getByLabel("Lojinha").fill("lojinhadoterritorio.foz");
  await page.getByRole("button", { name: "Publicar", exact: true }).click();
  await expect(page.locator(".toast").filter({ hasText: "Publicado: Links" })).toBeVisible();
  const log = await page.evaluate(() => JSON.parse(localStorage.getItem("territorio:mock-db")).audit.filter((e) => e.entity_type === "content"));
  const save = log.find((e) => e.action === "content.save" && e.entity_id === "links");
  expect(save.changes.shop).toEqual({ from: "lojinhadoterritorio", to: "lojinhadoterritorio.foz" });
  expect(save).toMatchObject({ actor_type: "user", device_label: "Acesso pessoal" });
  expect(log.some((e) => e.action === "content.publish" && e.entity_id === "links")).toBe(true);
});
