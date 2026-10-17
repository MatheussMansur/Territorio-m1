// Configurações (épico 2): o índice com busca e módulos travados, um grupo gravado pelo
// "O que muda", validação, conflito, descartar, a visão só de leitura do gerente, os estados vazio e
// de erro, e a aprovação de aparelho; axe no claro e no escuro, no computador e no celular.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.setTimeout(90_000);

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

const groupTitle = (page, name) => page.getByRole("heading", { level: 2, name, exact: true });

test("índice: grupos por seção, módulos travados e busca que leva à linha", async ({ page }) => {
  await open(page, "/admin/configuracoes?papel=dono&mock=normal");
  await expect(page.getByRole("heading", { name: "Reservas e recepção" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: /Aparelhos e impressoras/ })).toBeVisible();
  await expect(page.getByText("Operação, travado, módulo 3")).toBeAttached();
  await expect(page.getByRole("heading", { name: /Primeiro acesso/ })).toBeVisible();
  await bothThemes(page);

  await page.getByLabel("Buscar configuração").fill("xyzw");
  await expect(page.getByText("Nada com esse nome.")).toBeVisible();
  await page.getByLabel("Buscar configuração").fill("atraso");
  await page.getByRole("link", { name: /Tolerância de atraso/ }).click();
  await expect(groupTitle(page, "Reservas")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#linha-tolerance-min")).toHaveClass(/is-destaque/);
});

test("reservas: muda a tolerância, vê o efeito e grava com versão", async ({ page }) => {
  await open(page, "/admin/configuracoes/reservas?papel=dono&mock=normal");
  await expect(groupTitle(page, "Reservas")).toBeVisible({ timeout: 30_000 });
  const row = page.locator("#linha-tolerance-min");
  await row.getByRole("button", { name: "Mais 5 min" }).click();
  await expect(row.getByText("mudou", { exact: true })).toBeVisible();
  await expect(row.getByText(/vale na hora para/)).toBeVisible();
  const bar = page.getByRole("region", { name: "Mudanças não gravadas" });
  await expect(bar).toContainText("1 mudança");
  // a prévia do cliente já lê o número novo
  await expect(page.locator(".cfg-canhoto mark").first()).toHaveText("25");
  await bothThemes(page);

  await bar.getByRole("button", { name: "Ver o efeito e gravar" }).click();
  const dialog = page.getByRole("dialog", { name: "O que muda" });
  await expect(dialog.getByText("20 min → 25 min")).toBeVisible();
  await expect(dialog.getByText(/versão 3/)).toBeVisible();
  expect(await serious(page)).toEqual([]);
  await dialog.getByRole("button", { name: "Gravar" }).click();
  await expect(page.getByText("Gravado. Vale a partir de agora.").first()).toBeVisible();
  await expect(page.locator(".cfg-grupo__ultima")).toContainText("Gravado");
  await expect(bar).toHaveCount(0);

  await page.reload();
  await expect(page.locator("#linha-tolerance-min input")).toHaveValue("25", { timeout: 30_000 });
});

test("aprovação: regra fora do limite mostra o erro na linha", async ({ page }) => {
  await open(page, "/admin/configuracoes/aprovacao-e-faltas?papel=dono&mock=normal");
  await expect(groupTitle(page, "Aprovação e faltas")).toBeVisible({ timeout: 30_000 });
  await page.locator("#linha-rule-party-over").getByRole("button", { name: "Menos 1 pessoas" }).click();
  await page.getByRole("button", { name: "Ver o efeito e gravar" }).click();
  await expect(page.locator("#linha-rule-party-over .cfg-erro")).toContainText("Fica abaixo do máximo");
  await expect(page.getByRole("region", { name: "Mudanças não gravadas" })).toContainText("1 campo para corrigir");
});

test("espera: outra pessoa gravou antes, e dá para juntar", async ({ page }) => {
  await open(page, "/admin/configuracoes/espera?papel=dono&mock=normal&conflito=1");
  await expect(groupTitle(page, "Lista de espera")).toBeVisible({ timeout: 30_000 });
  await page.locator("#linha-offer-min").getByRole("button", { name: "Mais 1 min" }).click();
  await page.getByRole("button", { name: "Ver o efeito e gravar" }).click();
  await page.getByRole("dialog", { name: "O que muda" }).getByRole("button", { name: "Gravar" }).click();
  const conflict = page.getByRole("dialog", { name: /gravou antes de você/ });
  await expect(conflict).toContainText("Fila máxima por horário");
  await conflict.getByRole("button", { name: "Juntar com as minhas" }).click();
  await expect(page.locator("#linha-offer-min").getByText("mudou", { exact: true })).toBeVisible();
});

test("sair com mudanças pergunta antes de descartar", async ({ page }) => {
  await open(page, "/admin/configuracoes/salao?papel=dono&mock=normal");
  await expect(groupTitle(page, "Salão")).toBeVisible({ timeout: 30_000 });
  await page.locator("#linha-undo-check-in-min").getByRole("button", { name: "Mais 5 min" }).click();
  await page.locator('a[href="/admin/configuracoes"]:visible').first().click();
  const ask = page.getByRole("dialog", { name: "Descartar as mudanças?" });
  await expect(ask.getByRole("button", { name: "Continuar editando" })).toBeFocused();
  await ask.getByRole("button", { name: "Descartar" }).click();
  await expect(page.getByLabel("Buscar configuração")).toBeVisible({ timeout: 30_000 });
});

test("gerente só vê, sem Acesso, Aparelhos e Integrações", async ({ page }) => {
  await open(page, "/admin/configuracoes?papel=gerente&mock=normal");
  await expect(page.getByText(/Só o dono muda as regras/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: /^Acesso/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Aparelhos/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Integrações/ })).toHaveCount(0);
  await bothThemes(page);
  await page.locator(".cfg-cartao__link", { hasText: "tolerância" }).click();
  await expect(groupTitle(page, "Reservas")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#linha-tolerance-min input")).toBeDisabled();
  await expect(page.getByRole("region", { name: "Mudanças não gravadas" })).toHaveCount(0);
  await bothThemes(page);
});

test("vazio mostra o padrão e o próximo passo", async ({ page }) => {
  await open(page, "/admin/configuracoes?papel=dono&mock=vazio");
  await expect(page.getByText("Ainda no padrão da casa").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Próximo passo:/)).toContainText("Casa");
});

test("erro ao abrir um grupo fica no lugar dele, com Tentar de novo", async ({ page }) => {
  await open(page, "/admin/configuracoes?papel=dono&mock=normal");
  await expect(page.getByLabel("Buscar configuração")).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => sessionStorage.setItem("territorio:mock-scenario", JSON.stringify("erro")));
  await page.locator(".cfg-cartao__link", { hasText: "Cookies" }).click();
  const alert = page.getByRole("alert").filter({ hasText: "Não deu para abrir" });
  await expect(alert).toBeVisible({ timeout: 30_000 });
  await expect(alert).not.toContainText("simulado");
  await expect(alert.getByRole("button", { name: "Tentar de novo" })).toBeVisible();
});

test("aparelhos: aprova o pedido com o código da tela", async ({ page }) => {
  await open(page, "/admin/configuracoes/aparelhos-e-impressoras?papel=dono&mock=normal");
  await expect(groupTitle(page, "Aparelhos e impressoras")).toBeVisible({ timeout: 30_000 });
  await bothThemes(page);
  // o próprio botão do pedido de pareamento: a faixa crítica pode trazer outro "Aprovar" (uma reserva)
  await page.getByRole("group", { name: "Pedidos de pareamento" }).getByRole("button", { name: "Aprovar" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Aprovar aparelho" });
  await dialog.getByLabel("Código da tela do aparelho").fill("ERRADO12");
  await dialog.getByLabel("Onde fica").fill("Quintal");
  await dialog.getByRole("button", { name: "Aprovar" }).click();
  await expect(dialog.getByText("O código não confere")).toBeVisible();
  await dialog.getByLabel("Código da tela do aparelho").fill("Q7M2K9XD");
  await dialog.getByRole("button", { name: "Aprovar" }).click();
  await expect(page.getByText("Tablet novo do quintal aprovado").first()).toBeVisible();
});

test("cada grupo abre com as linhas e sem erro de acessibilidade", async ({ page }) => {
  test.skip(test.info().project.name === "celular", "one pass on the computer is enough for every group");
  test.setTimeout(300_000);
  const groups = [
    ["casa", "Casa"], ["horarios", "Horários"], ["acesso", "Acesso"], ["avisos", "Avisos à equipe"], ["aparencia", "Aparência"],
    ["combinados", "Combinados"], ["espera", "Lista de espera"], ["salao", "Salão"], ["mensagens", "Mensagens"], ["eventos", "Eventos"],
    ["site", "Site"], ["cardapio", "Cardápio"], ["privacidade", "Privacidade"], ["cookies", "Cookies"], ["integracoes", "Integrações"],
  ];
  await open(page, "/admin/configuracoes?papel=dono&mock=normal");
  await expect(page.getByLabel("Buscar configuração")).toBeVisible({ timeout: 30_000 });
  for (const [slug, label] of groups) {
    await page.locator(`.cfg-cartao__link[href="/admin/configuracoes/${slug}"], .cfg-indice__item[href="/admin/configuracoes/${slug}"]`).first().click();
    await expect(groupTitle(page, label)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".cfg-bloco").first()).toBeVisible();
    expect(await serious(page), slug).toEqual([]);
  }
});

// ---- histórias 2.1 a 2.21 e 3.12: o que esta fase fechou --------------------------------------

const bar = (page) => page.getByRole("region", { name: "Mudanças não gravadas" });
const effect = (page) => page.getByRole("dialog", { name: "O que muda" });

/** Uma chamada ao mock de dentro da página, com o token CSRF da sessão, como o painel faz. */
function call(page, method, path, body) {
  return page.evaluate(
    async ([m, p, b]) => {
      const session = await (await fetch("/api/v1/staff/auth/session")).json().catch(() => ({}));
      const headers = { "Content-Type": "application/json", Accept: "application/json" };
      if (session?.csrf_token) headers["X-CSRF-Token"] = session.csrf_token;
      const response = await fetch(`/api/v1${p}`, { method: m, headers, body: b === undefined ? undefined : JSON.stringify(b) });
      return { status: response.status, body: await response.json().catch(() => null) };
    },
    [method, path, body],
  );
}

test("o menu lateral deixa de fora os módulos que ainda não chegaram", async ({ page }) => {
  test.skip(test.info().project.name === "celular", "the side menu is only on the computer");
  await open(page, "/admin/configuracoes/espera?papel=dono&mock=normal");
  await expect(groupTitle(page, "Lista de espera")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".cfg-indice")).not.toContainText("Operação");
  await expect(page.locator(".cfg-indice").getByText("pendente").first()).toBeVisible();
});

test("casa: WhatsApp no campo com país, publicação que falha e Publicar de novo", async ({ page }) => {
  await open(page, "/admin/configuracoes/casa?papel=dono&mock=normal&publicacao=falha");
  await expect(groupTitle(page, "Casa")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel("País do WhatsApp")).toHaveValue("BR");
  const phone = page.locator("#linha-whatsapp input[type=tel]");
  await phone.fill("45 99911-2233");
  await phone.blur();
  await expect(phone).toHaveValue("(45) 99911-2233");
  await expect(page.locator("#linha-whatsapp").getByText("mudou", { exact: true })).toBeVisible();
  await bar(page).getByRole("button", { name: "Ver o efeito e gravar" }).click();
  await expect(effect(page).getByText("Nenhuma reserva afetada.")).toBeVisible();
  await effect(page).getByRole("button", { name: "Gravar" }).click();
  await expect(page.getByText("Publicando…")).toBeVisible();
  const failed = page.getByRole("alert").filter({ hasText: "O site não atualizou" });
  await expect(failed).toBeVisible({ timeout: 20_000 });
  await bothThemes(page);
  // o valor gravado continua gravado; só o site é refeito (e desta vez a publicação funciona)
  await page.evaluate(() => {
    sessionStorage.setItem("territorio:mock-publicacao", JSON.stringify("ok"));
    window.history.replaceState(null, "", window.location.pathname);
  });
  await failed.getByRole("button", { name: "Publicar de novo" }).click();
  await expect(page.getByText("Publicando…")).toBeVisible();
  await expect(page.locator(".cfg-publicacao")).toContainText("no ar", { timeout: 20_000 });
  await page.reload();
  await expect(page.locator("#linha-whatsapp input[type=tel]")).toHaveValue("(45) 99911-2233", { timeout: 30_000 });
});

test("horários lista os dias especiais gravados na Agenda", async ({ page }) => {
  await open(page, "/admin/configuracoes/horarios?papel=dono&mock=normal");
  await expect(groupTitle(page, "Horários")).toBeVisible({ timeout: 30_000 });
  const list = page.locator(".cfg-excecoes__lista");
  await expect(list.locator("a").first()).toBeVisible({ timeout: 30_000 });
  await expect(list).toContainText("fechado");
  await expect(page.getByRole("link", { name: "Feriados e dias especiais na Agenda" })).toBeVisible();
});

test("horários: fechar um dia com reservas pede a decisão de cada uma", async ({ page }) => {
  await open(page, "/admin/configuracoes/horarios?papel=dono&mock=normal");
  await expect(groupTitle(page, "Horários")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("switch", { name: "Sexta aberto" }).click();
  await bar(page).getByRole("button", { name: "Ver o efeito e gravar" }).click();
  const dialog = effect(page);
  await expect(dialog.locator(".ag-caso").first()).toBeVisible({ timeout: 30_000 });
  // um dia fechado só oferece "Cancelar avisando"
  await expect(dialog.locator(".ag-caso").first().getByText("Remarcar")).toHaveCount(0);
  expect(await serious(page)).toEqual([]);
  await dialog.getByRole("button", { name: "Gravar" }).click();
  await expect(dialog.getByText(/sem decisão/)).toBeVisible();
  for (const caso of await dialog.locator(".ag-caso").all()) await caso.getByText("Cancelar avisando").click();
  await dialog.getByRole("button", { name: /Gravar|Tentar de novo/ }).click();
  await expect(page.getByText("Gravado. Vale a partir de agora.").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("switch", { name: "Sexta aberto" })).toHaveAttribute("aria-checked", "false");
});

test("salão: folha na abertura ou numa hora, e o erro com atalho para Reservas", async ({ page }) => {
  await open(page, "/admin/configuracoes/salao?papel=dono&mock=normal");
  await expect(groupTitle(page, "Salão")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#linha-print-sheet-at")).toHaveCount(0);
  await page.locator("#linha-print-sheet-mode").getByRole("radio", { name: "Numa hora" }).click();
  await expect(page.locator("#linha-print-sheet-at")).toBeVisible();
  await page.locator("#linha-on-tolerance-end").getByRole("radio", { name: "Soltar a mesa sozinho" }).click();
  await bar(page).getByRole("button", { name: "Ver o efeito e gravar" }).click();
  const row = page.locator("#linha-on-tolerance-end");
  await expect(row.locator(".cfg-erro")).toContainText("Soltar a mesa sozinho só vale");
  await expect(row.getByRole("link", { name: "Abrir Reservas" })).toBeVisible();
});

test("mensagens: modelos na Meta e texto novo vai como revisão", async ({ page }) => {
  await open(page, "/admin/configuracoes/mensagens?papel=dono&mock=normal");
  await expect(groupTitle(page, "Mensagens")).toBeVisible({ timeout: 30_000 });
  const models = page.locator(".cfg-modelos");
  await expect(models).toContainText("recusado", { timeout: 30_000 });
  await expect(models).toContainText("Motivo da Meta");
  await expect(models).toContainText("aguardando aprovação");
  await bothThemes(page);
  const ready = page.locator(".cfg-pronta").filter({ hasText: "Mesa pronta" });
  await ready.locator("input, textarea").first().fill("Sua mesa está pronta. Pode entrar!");
  await bar(page).getByRole("button", { name: "Ver o efeito e gravar" }).click();
  await expect(effect(page).getByText(/Até aprovar, vale o texto anterior/)).toBeVisible();
  await effect(page).getByRole("button", { name: "Gravar" }).click();
  await expect(page.getByText("O texto novo foi para a Meta. Até aprovar, vale o anterior.").first()).toBeVisible();
  await expect(models.locator(".cfg-modelo").filter({ hasText: "Mesa pronta" })).toContainText("aguardando aprovação");
});

test("integrações: Testar agora diz como foi, e nenhum segredo chega à tela", async ({ page }) => {
  const secret = /(token|secret|senha|password|api_?key|private_?key|connection|dsn|credential)/i;
  const leaks = [];
  page.on("response", async (response) => {
    const url = response.url();
    if (!/\/api\/v1\/staff\/(settings|integrations|system)/.test(url)) return;
    const body = await response.json().catch(() => null);
    const walk = (node, path) => {
      if (!node || typeof node !== "object") return;
      for (const [key, value] of Object.entries(node)) {
        if (secret.test(key) && value != null && typeof value !== "object") leaks.push(`${url} ${path}${key}`);
        walk(value, `${path}${key}.`);
      }
    };
    walk(body, "");
  });
  await open(page, "/admin/configuracoes/integracoes?papel=dono&mock=normal");
  await expect(groupTitle(page, "Integrações")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Testar E-mail agora" }).click();
  await expect(page.locator(".cfg-teste").filter({ hasText: "respondeu agora" })).toBeVisible();
  await page.getByRole("button", { name: "Testar Monitor externo agora" }).click();
  await expect(page.locator(".cfg-teste").filter({ hasText: "com problema" })).toBeVisible();
  await bothThemes(page);
  for (const [slug, label] of [["reservas", "Reservas"], ["mensagens", "Mensagens"], ["privacidade", "Privacidade"], ["acesso", "Acesso"]]) {
    // dentro do painel, sem recarregar a página
    await page.evaluate((path) => {
      window.history.pushState(null, "", path);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, `/admin/configuracoes/${slug}`);
    await expect(groupTitle(page, label)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".cfg-bloco").first()).toBeVisible({ timeout: 30_000 });
  }
  // integrações nunca são gravadas: um PATCH forçado responde 405
  const forced = await call(page, "PATCH", "/staff/settings/integrations?if_match=1", { data: {} });
  expect(forced.status).toBe(405);
  expect(leaks).toEqual([]);
});

test("histórico: ver quem mudou e voltar a uma versão antiga pela barra", async ({ page }) => {
  await open(page, "/admin/configuracoes/reservas?papel=dono&mock=normal");
  await expect(groupTitle(page, "Reservas")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Histórico" }).click();
  const dialog = page.getByRole("dialog", { name: "Histórico de Reservas" });
  await expect(dialog.getByText("Versão 7")).toBeVisible({ timeout: 30_000 });
  await expect(dialog).toContainText("Tolerância de atraso");
  expect(await serious(page)).toEqual([]);
  await dialog.getByRole("button", { name: /Voltar à versão 6/ }).click();
  await expect(page.locator("#linha-few-left-pct").getByText("mudou", { exact: true })).toBeVisible();
  await expect(page.locator("#linha-few-left-pct input")).toHaveValue("25");
  await expect(bar(page)).toContainText("2 mudanças");
  await bar(page).getByRole("button", { name: "Ver o efeito e gravar" }).click();
  await expect(effect(page)).toBeVisible();
});

test("privacidade: o efeito conta pela última atividade", async ({ page }) => {
  await open(page, "/admin/configuracoes/privacidade?papel=dono&mock=normal");
  await expect(groupTitle(page, "Privacidade")).toBeVisible({ timeout: 30_000 });
  const { body: preview } = await call(page, "POST", "/staff/settings/privacy/preview", { data: { customer_retention_months: 6, audit_retention_months: 6 } });
  expect(preview.notes.join(" ")).toContain("Conta pela última atividade");
  expect(preview.notes.join(" ")).toMatch(/\d+ (cliente é anonimizado|clientes são anonimizados)/);
});

test("tablet: a prévia do cliente vira aba", async ({ page }) => {
  test.skip(test.info().project.name === "celular", "the tablet width is set here");
  await page.setViewportSize({ width: 1024, height: 900 });
  await open(page, "/admin/configuracoes/reservas?papel=dono&mock=normal");
  await expect(groupTitle(page, "Reservas")).toBeVisible({ timeout: 30_000 });
  const tabs = page.getByRole("tablist", { name: "Ver" });
  await expect(tabs.getByRole("tab", { name: "Configuração" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".cfg-canhoto")).toBeHidden();
  await tabs.getByRole("tab", { name: "Como o cliente vê" }).click();
  await expect(page.locator(".cfg-canhoto")).toBeVisible();
  await expect(page.locator("#linha-tolerance-min")).toBeHidden();
  await bothThemes(page);
});

test("celular: o diálogo O que muda ocupa a tela inteira", async ({ page }) => {
  test.skip(test.info().project.name !== "celular", "phone only");
  await open(page, "/admin/configuracoes/espera?papel=dono&mock=normal");
  await expect(groupTitle(page, "Lista de espera")).toBeVisible({ timeout: 30_000 });
  await page.locator("#linha-offer-min").getByRole("button", { name: "Mais 1 min" }).click();
  await bar(page).getByRole("button", { name: "Ver o efeito e gravar" }).click();
  await expect(effect(page)).toBeVisible();
  const screen = await page.evaluate(() => ({ width: document.documentElement.clientWidth, height: window.innerHeight }));
  // medido depois que a animação de abertura acaba
  await expect.poll(async () => Math.round((await effect(page).boundingBox()).width)).toBeGreaterThanOrEqual(screen.width - 1);
  expect((await effect(page).boundingBox()).height).toBeGreaterThanOrEqual(screen.height - 1);
});

test("primeiro acesso: cinco passos, abre onde parou e segue com a planta estimada", async ({ page }) => {
  await open(page, "/admin/primeiro-acesso?papel=dono&mock=normal");
  await expect(page.getByRole("heading", { name: /2\. Horários/ })).toBeVisible({ timeout: 30_000 });
  const steps = page.getByRole("list", { name: "Passos do primeiro acesso" });
  await expect(steps.locator("li")).toHaveCount(5);
  await expect(groupTitle(page, "Horários")).toBeVisible({ timeout: 30_000 });
  await bothThemes(page);
  await steps.getByRole("link", { name: /Plantas/ }).click();
  await expect(page.getByRole("heading", { name: /3\. Plantas/ })).toBeVisible({ timeout: 30_000 });
  if (test.info().project.name === "celular") {
    await expect(page.getByText("Para desenhar a planta, use o computador.")).toBeVisible();
    await page.getByRole("button", { name: "Seguir com ela" }).click();
  } else {
    await page.getByRole("button", { name: "Seguir com a planta estimada" }).click();
  }
  await expect(page.getByRole("heading", { name: /4\. Combinados/ })).toBeVisible({ timeout: 30_000 });
  await expect(steps.locator("li").filter({ hasText: "Plantas" })).toContainText("feito");
  await expect.poll(async () => (await call(page, "GET", "/staff/onboarding")).body?.current_step, { timeout: 15_000 }).toBe("terms");
  // voltar abre onde o dono parou
  await open(page, "/admin/primeiro-acesso");
  await expect(page.getByRole("heading", { name: /4\. Combinados/ })).toBeVisible({ timeout: 30_000 });
});

test("primeiro acesso é só do dono", async ({ page }) => {
  await open(page, "/admin/primeiro-acesso?papel=gerente&mock=normal");
  await expect(page.getByRole("heading", { name: "Essa parte é de outro perfil da equipe" })).toBeVisible({ timeout: 30_000 });
});

test("integrações e Sistema leem a mesma fonte: o WhatsApp fora aparece nos dois", async ({ page }) => {
  await open(page, "/admin/configuracoes/integracoes?papel=dono&mock=normal");
  await expect(groupTitle(page, "Integrações")).toBeVisible({ timeout: 30_000 });
  const whatsapp = page.locator(".cfg-integracoes tbody tr").filter({ hasText: "WhatsApp" });
  await expect(whatsapp).toContainText("ligada");
  let status = (await call(page, "GET", "/staff/system/status")).body;
  expect(status.items.find((i) => i.key === "whatsapp").state).toBe("ok");
  // o mesmo WhatsApp fora do ar, em todo lugar
  await open(page, "/admin/configuracoes/integracoes?whatsapp=fora");
  await expect(whatsapp).toContainText("com problema", { timeout: 30_000 });
  status = (await call(page, "GET", "/staff/system/status")).body;
  expect(status.items.find((i) => i.key === "whatsapp").state).toBe("problem");
  const group = (await call(page, "GET", "/staff/settings/integrations")).body;
  expect(group.data.items.find((i) => i.key === "whatsapp").state).toBe("problem");
  expect(group.data.items.find((i) => i.key === "google").state).toBe(status.items.find((i) => i.key === "google").state === "ok" ? "ok" : "unused");
});

test("tolerância: a tabela única da casa em Reservas e em Salão, com os valores da tela", async ({ page }) => {
  await open(page, "/admin/configuracoes/reservas?papel=dono&mock=normal");
  await expect(groupTitle(page, "Reservas")).toBeVisible({ timeout: 30_000 });
  const table = page.locator(".cfg-linha--tolerancia .tolerancia");
  await expect(table).toContainText("Reservas › Depois da tolerância");
  await expect(table).toContainText("Salão › Ao fim da tolerância");
  await expect(table.locator('[data-opcao="lose_priority"]')).toContainText("em uso");
  await expect(table.locator('[data-opcao="suggest_no_show"]')).toContainText("em uso");
  await expect(table.locator("tfoot")).toContainText("20 min");
  await page.locator("#linha-after-tolerance").getByRole("radio", { name: "Libera a mesa" }).click();
  await expect(table.locator('[data-opcao="release"]')).toContainText("em uso");
  await expect(table.locator('[data-opcao="lose_priority"]')).not.toContainText("em uso");
  await bothThemes(page);

  await open(page, "/admin/configuracoes/salao?papel=dono&mock=normal");
  await expect(groupTitle(page, "Salão")).toBeVisible({ timeout: 30_000 });
  const floor = page.locator(".cfg-linha--tolerancia .tolerancia");
  await expect(floor.locator('[data-opcao="suggest_no_show"]')).toContainText("em uso");
  await page.locator("#linha-on-tolerance-end").getByRole("radio", { name: "Soltar a mesa sozinho" }).click();
  await expect(floor.locator('[data-opcao="auto_release"]')).toContainText("em uso");
});

test("horários: com dois turnos por dia, cada dia aberto ganha outro turno, sem cruzar o principal", async ({ page }) => {
  await open(page, "/admin/configuracoes/horarios?papel=dono&mock=normal");
  await expect(groupTitle(page, "Horários")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Abrir outro turno em quarta" })).toHaveCount(0);
  await page.locator("#linha-max-shifts-per-day").getByRole("radio", { name: "Dois turnos" }).click();
  await page.getByRole("button", { name: "Abrir outro turno em quarta" }).click();
  const shift = page.getByRole("group", { name: "Outro turno de quarta" });
  await shift.getByLabel("Outro turno abre").fill("20:00");
  await shift.getByLabel("Fecha").fill("22:00");
  await shift.getByLabel("Fecha").blur();
  await bar(page).getByRole("button", { name: "Ver o efeito e gravar" }).click();
  await expect(page.locator("#cfg-linha-week-dia-3-erro2")).toContainText("cruza o horário principal", { timeout: 30_000 });
  await shift.getByLabel("Outro turno abre").fill("12:00");
  await shift.getByLabel("Fecha").fill("15:00");
  await shift.getByLabel("Fecha").blur();
  await bothThemes(page);
  await bar(page).getByRole("button", { name: "Ver o efeito e gravar" }).click();
  await effect(page).getByRole("button", { name: "Gravar" }).click();
  await expect(page.getByText("Gravado. Vale a partir de agora.").first()).toBeVisible({ timeout: 30_000 });
  const hours = (await call(page, "GET", "/staff/settings/hours")).body;
  expect(hours.data.max_shifts_per_day).toBe(2);
  expect(hours.data.week.find((d) => d.weekday === 3).second_shift).toEqual({ opens_at: "12:00", closes_at: "15:00" });
});

test("combinados: o botão de aceite em inglês chega aos dados da página da reserva", async ({ page }) => {
  await open(page, "/admin/configuracoes/combinados?papel=dono&mock=normal");
  await expect(groupTitle(page, "Combinados")).toBeVisible({ timeout: 30_000 });
  let house = (await call(page, "GET", "/house")).body;
  expect(house.terms.locales.pt.accept_label).toBe("Li e tá combinado");
  expect(house.terms.locales.es.accept_label).toBe("Leí y está combinado");
  const version = house.terms.version;
  const row = page.locator("#linha-accept-label");
  await row.getByRole("tab", { name: /^EN/ }).click();
  await row.locator("input.cfg-texto").fill("Read and agreed");
  await bar(page).getByRole("button", { name: "Ver o efeito e gravar" }).click();
  await effect(page).getByRole("button", { name: "Gravar" }).click();
  await expect(page.getByText("Gravado. Vale a partir de agora.").first()).toBeVisible({ timeout: 30_000 });
  house = (await call(page, "GET", "/house")).body;
  expect(house.terms.locales.en.accept_label).toBe("Read and agreed");
  expect(house.terms.version).not.toBe(version);
});

test("combinados: sem limite de tempo de mesa e tolerância 0, a prévia diz como a página da reserva", async ({ page }) => {
  test.skip(test.info().project.name === "celular", "the preview's words are the same on the phone");
  await open(page, "/admin/configuracoes/combinados?papel=dono&mock=normal");
  await expect(groupTitle(page, "Combinados")).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem("territorio:mock-db"));
    Object.assign(db.settings.booking.data, { duration_min: null, duration_by_weekday: [], tolerance_min: 0 });
    db.settings.terms.data.show_duration_item = true;
    localStorage.setItem("territorio:mock-db", JSON.stringify(db));
  });
  await page.reload();
  await expect(groupTitle(page, "Combinados")).toBeVisible({ timeout: 30_000 });
  const stub = page.locator(".cfg-canhoto");
  await expect(stub).toContainText("A mesa é de vocês, sem limite de tempo.");
  await expect(stub).toContainText("em ponto");
  await expect(stub).not.toContainText("por sem limite");
});
