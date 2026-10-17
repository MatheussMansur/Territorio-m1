// Reservas (histórias 5.4 a 5.11): a lista com filtros no endereço, a busca sem
// acentos, a gaveta no seu próprio endereço, a reserva nova por telefone, aprovar, cancelar com
// motivo, a exportação, o que a recepção vê, os estados vazio e de erro, no
// computador e no celular, com axe nos dois temas.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// axe em dois temas numa página com muitas linhas leva tempo
test.setTimeout(90_000);

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

async function openList(page, papel, query = "") {
  await page.goto(`/admin/reservas?papel=${papel}&mock=normal${query}`);
  await page.waitForSelector("html[data-ready]");
  await expect(page.locator(".res-contagem")).toContainText(/reserva/, { timeout: 20_000 });
}

const rows = (page) => page.locator(".res-tabela tbody tr:not(.data-table__state)");

/** O próximo dia em que a casa abre (quarta a sábado), como AAAA-MM-DD na casa. */
function nextOpenDay() {
  const now = new Date(Date.now() - 3 * 3_600_000);
  for (let i = 1; i < 8; i++) {
    const d = new Date(now.getTime() + i * 86_400_000);
    if (d.getUTCDay() >= 3 && d.getUTCDay() <= 6) return d.toISOString().slice(0, 10);
  }
  return null;
}

test("dono busca sem acento, filtra pelo endereço e abre a gaveta no endereço da reserva", async ({ page }) => {
  await openList(page, "dono");
  await expect(rows(page)).not.toHaveCount(0);
  await expect(page.getByRole("group", { name: "Período" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Exportar" })).toBeVisible();
  await bothThemes(page);

  await page.getByLabel("Buscar").fill("RENATA");
  await expect(rows(page)).toHaveCount(1);
  await expect(page).toHaveURL(/q=RENATA/);
  await page.getByRole("link", { name: "Renata Souza" }).click();
  await expect(page).toHaveURL(/\/admin\/reservas\/[0-9a-f-]{36}/);
  const drawer = page.locator(".res-gaveta");
  await expect(drawer.getByRole("heading", { name: "Renata Souza" })).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "Linha do tempo" })).toBeVisible();
  await expect(drawer).toContainText("cadeirinha");
  expect(await serious(page)).toEqual([]);
  const address = page.url();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(page).toHaveURL(/\/admin\/reservas\?/);

  // o endereço próprio da gaveta a abre direto
  await page.goto(address);
  await expect(page.locator(".res-gaveta").getByRole("heading", { name: "Renata Souza" })).toBeVisible({ timeout: 20_000 });
});

test("filtro sem resultado mostra o vazio e Limpar filtros", async ({ page }) => {
  await openList(page, "gerente", "&q=zzzz");
  await expect(page.getByText("Nenhuma reserva com esses filtros.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Exportar" })).toHaveCount(0); // o gerente não exporta
  await page.getByRole("button", { name: "Limpar filtros" }).click();
  await expect(rows(page)).not.toHaveCount(0);
});

test("nova reserva por telefone entra na lista com o canal", async ({ page }) => {
  await openList(page, "gerente");
  await page.getByRole("button", { name: "Nova reserva" }).click();
  const win = page.locator(".res-janela");
  await expect(win.getByRole("heading", { name: "Nova reserva" })).toBeVisible();
  await win.getByLabel("Dia").fill(nextOpenDay());
  await win.getByLabel("Dia").dispatchEvent("change");
  const free = win.locator(".res-hora:not(.is-cheio)").filter({ hasText: /mesa/ }).first();
  await expect(free).toBeVisible({ timeout: 15_000 });
  await free.click();
  await expect(win.locator('input[name="mesa"]:checked')).toHaveCount(1);
  await win.getByLabel("Nome").fill("Conceição Ferreira");
  await win.locator("#nova-fone").fill("45 99876-1203");
  await win.getByLabel("aniversário").check();
  await win.getByRole("button", { name: "Lançar reserva" }).click();
  await expect(win).toHaveCount(0);
  await expect(page.locator(".toast").first()).toContainText("lançada");

  await page.getByLabel("Buscar").fill("conceicao");
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("Telefone");
  await expect(rows(page).first()).toContainText("aniversário");
});

test("gerente aprova o pedido e cancela uma reserva com motivo", async ({ page }) => {
  await openList(page, "gerente", "&status=pendentes&periodo=semana");
  await page.getByRole("link", { name: "Gustavo" }).click();
  const drawer = page.locator(".res-gaveta");
  await drawer.getByRole("button", { name: /^Aprovar/ }).click();
  await expect(drawer.locator(".res-gaveta__selos")).toContainText("Confirmada");

  // cancelar: a escolha segura tem o foco, o verbo está no botão
  await drawer.getByRole("button", { name: "Cancelar reserva" }).click();
  const win = page.locator(".res-janela");
  await expect(win.getByRole("button", { name: "Manter reserva" })).toBeFocused();
  await win.getByLabel("Imprevisto da casa").check();
  await win.getByRole("button", { name: "Cancelar reserva" }).click();
  await expect(win).toHaveCount(0);
  await expect(drawer.locator(".res-gaveta__selos")).toContainText("Cancelada");
  await expect(drawer).toContainText("Motivo do cancelamento: Imprevisto da casa");
  await expect(drawer.locator(".feed-item").first()).toContainText("Cancelada pela casa");
});

test("dono exporta o período em CSV", async ({ page }) => {
  await openList(page, "dono");
  await page.getByRole("button", { name: "Exportar" }).click();
  // a confirmação de identidade dos últimos 5 minutos: senha e código (história 5.11)
  const dialog = page.getByRole("dialog", { name: "Exportar as reservas" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Senha").fill("admin");
  await dialog.getByLabel("Código do aplicativo").fill("123456");
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Confirmar e baixar" }).click();
  expect((await download).suggestedFilename()).toMatch(/^reservas-.*\.csv$/);
  // dentro dos 5 minutos, a segunda exportação não pede de novo
  const again = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar" }).click();
  await again;
  await expect(page.getByRole("dialog", { name: "Exportar as reservas" })).toHaveCount(0);
});

test("recepção vê só hoje, sem período, canal nem exportar", async ({ page }) => {
  await openList(page, "recepcao");
  await expect(page.getByRole("group", { name: "Período" })).toHaveCount(0);
  await expect(page.getByLabel("Canal")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Exportar|Nenhuma reserva para exportar/ })).toHaveCount(0);
  await expect(page.locator(".res-dia")).toContainText("Reservas de hoje");
  await expect(page.locator(".res-tabela thead")).not.toContainText("Dia");
  // só o primeiro nome
  await expect(page.getByRole("link", { name: "Renata Souza" })).toHaveCount(0);
  await bothThemes(page);
});

test("sem nenhuma reserva, o vazio leva a lançar uma", async ({ page }) => {
  await page.goto("/admin/reservas?papel=dono&mock=vazio");
  await page.waitForSelector("html[data-ready]");
  await expect(page.getByText("Nenhuma reserva no período")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Lançar uma reserva" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Nenhuma reserva para exportar" })).toBeDisabled();
  await bothThemes(page);
});

test("lista que não carrega mostra o erro no lugar, sem o texto do servidor", async ({ page }) => {
  await page.goto("/admin/?papel=dono&mock=normal");
  await page.waitForSelector("html[data-ready]");
  await expect(page.getByRole("heading", { level: 1, name: "Hoje" })).toBeVisible();
  await page.evaluate(() => {
    sessionStorage.setItem("territorio:mock-scenario", JSON.stringify("erro"));
    history.replaceState(null, "", "/admin/");
  });
  const menu = page.locator(test.info().project.name === "celular" ? ".barra" : ".trilho");
  await menu.getByRole("link", { name: "Reservas", exact: true }).click();
  const alert = page.locator("#area-corpo .error-state");
  await expect(alert).toContainText("Algo deu errado do nosso lado", { timeout: 20_000 });
  await expect(alert).not.toContainText("Erro simulado");
  await bothThemes(page);
});

// ---- as visões: Dia, Mesas, Semana, Mês (histórias 5.20 e 5.21) ----

/** A noite em que cai a lista cheia da demonstração: hoje quando a casa abre (quarta a sábado), senão a próxima. */
function busyNight() {
  const now = new Date(Date.now() - 3 * 3_600_000);
  for (let i = 0; i < 8; i++) {
    const d = new Date(now.getTime() + i * 86_400_000);
    if (d.getUTCDay() >= 3 && d.getUTCDay() <= 6) return d.toISOString().slice(0, 10);
  }
  return null;
}

async function openView(page, papel, query) {
  await page.goto(`/admin/reservas?papel=${papel}&mock=normal${query}`);
  await page.waitForSelector("html[data-ready]");
  await expect(page.locator(".res-contagem")).toContainText(/reserva/, { timeout: 20_000 });
}

const views = (page) => page.getByRole("group", { name: "Ver as reservas por" });

test("Dia: blocos por horário, faixa à parte, gaveta e a visão lembrada", async ({ page }) => {
  const night = busyNight();
  await openView(page, "dono", "");
  await views(page).getByRole("button", { name: "Dia" }).click();
  await expect(page).toHaveURL(/visao=dia/);
  await page.goto(`/admin/reservas?papel=dono&mock=normal&visao=dia&data=${night}`);
  await page.waitForSelector("html[data-ready]");
  const blocks = page.locator(".rv-bloco");
  await expect(blocks.first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".rv-bloco", { hasText: "Renata" })).toContainText("mesa S3 + S4");
  // o pedido e a lista de espera ficam acima da grade
  const strip = page.locator(".rv-faixa");
  await expect(strip).toContainText("Gustavo");
  await expect(strip).toContainText("Camila");
  await expect(page.locator(".rv-dia__blocos")).not.toContainText("Gustavo");
  // mesmo horário, lado a lado
  const carla = await page.locator(".rv-bloco", { hasText: "Carla" }).boundingBox();
  const rafael = await page.locator(".rv-bloco", { hasText: "Rafael" }).boundingBox();
  expect(carla.y < rafael.y + rafael.height && rafael.y < carla.y + carla.height).toBe(true);
  expect(Math.abs(carla.x - rafael.x)).toBeGreaterThan(20);
  await bothThemes(page);

  await page.locator(".rv-bloco", { hasText: "Renata" }).click();
  const drawer = page.locator(".res-gaveta");
  await expect(drawer.getByRole("heading", { name: "Renata Souza" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(page).toHaveURL(/visao=dia/);

  // lembrado: o endereço puro abre o dia de novo
  await page.goto("/admin/reservas?papel=dono&mock=normal");
  await page.waitForSelector("html[data-ready]");
  await expect(views(page).getByRole("button", { name: "Dia" })).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
});

test("Mesas: uma linha por mesa, juntas, livres e a coluna das mesas fixa", async ({ page }) => {
  const night = busyNight();
  await openView(page, "gerente", `&visao=mesas&data=${night}`);
  const grid = page.locator(".rv-mesas__grade");
  await expect(grid.getByRole("heading", { name: "Salão" })).toBeVisible();
  await expect(grid.getByRole("heading", { name: "Quintal" })).toBeVisible();
  await expect(page.locator(".rv-mesas__linha")).not.toHaveCount(0);
  // as mesas juntas mostram a junção em cada uma delas
  await expect(page.locator(".rv-barra.is-junta", { hasText: "Renata" })).toHaveCount(2);
  await expect(page.locator(".rv-barra.is-junta", { hasText: "Renata" }).first()).toContainText("junta S3 + S4");
  await expect(page.locator(".rv-mesas__livre").first()).toBeAttached();
  await bothThemes(page);

  // a página nunca rola para o lado; a grade rola, com a coluna das mesas no lugar
  const scroller = page.locator(".rv-mesas__rolagem");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  if (test.info().project.name === "celular") {
    const before = await page.locator(".rv-mesas__linha .rv-mesas__mesa").first().boundingBox();
    await scroller.evaluate((el) => (el.scrollLeft = 300));
    const after = await page.locator(".rv-mesas__linha .rv-mesas__mesa").first().boundingBox();
    expect(Math.abs(after.x - before.x)).toBeLessThan(2);
    const bar = await page.locator(".rv-barra").first().boundingBox();
    expect(bar.height).toBeGreaterThanOrEqual(44);
  }

  await page.locator(".rv-barra", { hasText: "Juliana" }).first().click();
  await expect(page.locator(".res-gaveta").getByRole("heading", { name: /Juliana/ })).toBeVisible();
});

test("Semana: sete noites, fechadas ditas em texto, cabeçalho abre o Dia", async ({ page }) => {
  const night = busyNight();
  await openView(page, "dono", `&visao=semana&data=${night}`);
  const nights = page.locator(".rv-semana__noite");
  await expect(nights).toHaveCount(7);
  // de domingo a terça a casa não abre
  await expect(nights.nth(0)).toHaveClass(/is-fechado/);
  await expect(nights.nth(0)).toContainText("Fechado");
  await expect(page.locator(".rv-semana")).toContainText("Renata");
  await expect(page.locator(".rv-semana")).toContainText("ocupada");
  await bothThemes(page);

  const weekday = new Date(`${night}T12:00:00Z`).getUTCDay();
  await nights.nth(weekday).locator(".rv-semana__cab").click();
  await expect(page).toHaveURL(/visao=dia/);
  await expect(views(page).getByRole("button", { name: "Dia" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".rv-bloco", { hasText: "Renata" })).toBeVisible({ timeout: 20_000 });
});

test("Mês: calendário com reservas e hoje, o dia abre o Dia", async ({ page }) => {
  const night = busyNight();
  await openView(page, "dono", `&visao=mes&data=${night}`);
  const days = page.locator(".rv-mes__dia");
  await expect(days.first()).toBeVisible();
  await expect(page.locator(".rv-mes__dia.is-fechado").first()).toContainText("Fechado");
  await expect(page.locator(".rv-mes__dia", { hasText: /reservas?/ }).first()).toBeVisible();
  await bothThemes(page);

  const target = page.locator(".rv-mes__dia").nth(Number(night.slice(8)) - 1);
  await target.click();
  await expect(page).toHaveURL(new RegExp(`visao=dia`));
  await expect(page.locator(".rv-nav__titulo")).toBeVisible();
});

test("recepção tem só Lista, Dia e Mesas de hoje", async ({ page }) => {
  await openView(page, "recepcao", "&visao=semana");
  const group = views(page);
  await expect(group.getByRole("button")).toHaveText(["Lista", "Dia", "Mesas"]);
  // um endereço com semana volta para a lista
  await expect(group.getByRole("button", { name: "Lista" })).toHaveAttribute("aria-pressed", "true");
  await group.getByRole("button", { name: "Mesas" }).click();
  await expect(page.locator(".rv-nav__titulo")).toContainText("Hoje");
  await expect(page.getByRole("button", { name: "Próxima noite" })).toHaveCount(0);
  await bothThemes(page);
});

test("visões que não carregam mostram o erro no lugar", async ({ page }) => {
  await openView(page, "dono", "&visao=semana");
  await expect(page.locator(".rv-semana__noite")).toHaveCount(7);
  await page.goto("/admin/?papel=dono&mock=normal");
  await page.waitForSelector("html[data-ready]");
  await expect(page.getByRole("heading", { level: 1, name: "Hoje" })).toBeVisible();
  await page.evaluate(() => {
    sessionStorage.setItem("territorio:mock-scenario", JSON.stringify("erro"));
    history.replaceState(null, "", "/admin/");
  });
  const menu = page.locator(test.info().project.name === "celular" ? ".barra" : ".trilho");
  await menu.getByRole("link", { name: "Reservas", exact: true }).click();
  // a semana foi lembrada, e falha no seu lugar
  await expect(views(page).getByRole("button", { name: "Semana" })).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
  const alert = page.locator("#area-corpo .error-state");
  await expect(alert).toContainText("Algo deu errado do nosso lado", { timeout: 20_000 });
  await expect(alert).not.toContainText("Erro simulado");
});

// ---- histórias 5.5, 5.6, 5.10, 5.16, 5.19 e 6.2 em Reservas ---------------------------------

/** A data de hoje pelo mock (a próxima noite aberta). */
async function tonight(page) {
  await page.goto("/admin/salao?papel=dono&mock=normal");
  await page.waitForSelector("html[data-ready]");
  return page.evaluate(() => fetch("/api/v1/staff/floor").then((r) => r.json()).then((f) => f.date));
}

/** Um POST à API do mock como a tela manda (com o token CSRF da sessão). */
async function call(page, path, body, key) {
  return page.evaluate(
    async ({ path, body, key }) => {
      const session = await fetch("/api/v1/staff/auth/session").then((r) => r.json());
      const headers = { "Content-Type": "application/json", "X-CSRF-Token": session.csrf_token };
      if (key) headers["Idempotency-Key"] = key;
      const r = await fetch(`/api/v1${path}`, { method: "POST", headers, body: JSON.stringify(body) });
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    { path, body, key },
  );
}

/** Abre "Nova reserva" no próximo dia aberto e escolhe o primeiro horário com mesa livre. */
async function newBooking(page) {
  await page.getByRole("button", { name: "Nova reserva" }).first().click();
  const win = page.locator(".res-janela");
  await win.getByLabel("Dia").fill(nextOpenDay());
  await win.getByLabel("Dia").dispatchEvent("change");
  const free = win.locator(".res-hora:not(.is-cheio)").filter({ hasText: /mesa/ }).first();
  await expect(free).toBeVisible({ timeout: 15_000 });
  await free.click();
  await expect(win.locator('input[name="mesa"]:checked')).toHaveCount(1);
  return win;
}

test("recepção marca Chegou na lista e o Desfazer fica na linha", async ({ page }) => {
  const date = await tonight(page);
  await page.goto(`/admin/reservas?papel=recepcao&mock=normal&agora=${date}T20:05`);
  await page.waitForSelector("html[data-ready]");
  await page.getByRole("button", { name: "Chegou: Mariana" }).click();
  await page.getByRole("dialog", { name: "Chegou: Mariana" }).getByRole("button", { name: /Confirmar chegada/ }).click();
  await expect(page.locator(".toast").getByText("Chegou", { exact: true })).toBeVisible();
  const undo = page.getByRole("button", { name: /Desfazer a chegada de Mariana/ });
  await expect(undo).toBeVisible();
  await bothThemes(page);
  await undo.click();
  await expect(page.locator(".toast").getByText("Chegada desfeita")).toBeVisible();
});

test("cliente que a casa já conhece: a língua vem da que ele usa, e fica gravada na reserva (5.6)", async ({ page }) => {
  await openList(page, "gerente");
  // um número brasileiro cujo cliente fala com a casa em inglês (nos dados salvos do mock)
  const phone = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem("territorio:mock-db"));
    const c = db.customers.find((x) => !x.anonymized_at && String(x.phone_e164 || "").startsWith("+55"));
    c.locale = "en";
    localStorage.setItem("territorio:mock-db", JSON.stringify(db));
    return c.phone_e164;
  });
  await page.reload();
  await page.waitForSelector("html[data-ready]");
  const win = await newBooking(page);
  await win.getByLabel("Nome").fill("Cliente da casa");
  await win.locator("#nova-fone").fill(phone.slice(3));
  await win.locator("#nova-fone").blur();
  await expect(win.getByLabel("Língua das mensagens")).toHaveValue("en");
  await expect(win.getByText("A língua que o cliente já usa com a casa")).toBeVisible();
  const confere = win.locator(".res-confere");
  if (await confere.isVisible()) await confere.getByRole("button", { name: "Sim, confere" }).click();
  const created = page.waitForResponse((r) => r.url().endsWith("/api/v1/staff/reservations") && r.request().method() === "POST");
  await win.getByRole("button", { name: "Lançar reserva" }).click();
  expect((await created).request().postDataJSON().locale).toBe("en");
  // um número que a casa não conhece fica com a sugestão do país
  const unknown = await page.evaluate(() => fetch("/api/v1/staff/customers/language?phone=%2B5545999990001").then((r) => r.json()));
  expect(unknown).toEqual({ locale: null });
});

test("número argentino com o 15 pede Confere? antes de criar, e a língua vira espanhol", async ({ page }) => {
  await openList(page, "gerente");
  const win = await newBooking(page);
  await win.getByLabel("Nome").fill("Martín Acosta");
  await win.getByLabel("País").selectOption("AR");
  await win.locator("#nova-fone").fill("3757 15 123456");
  await win.locator("#nova-fone").blur();
  const confere = win.locator(".res-confere");
  await expect(confere).toContainText("Confere? +54 9 3757 12-3456");
  await expect(win.getByLabel("Língua das mensagens")).toHaveValue("es");
  await bothThemes(page);
  await win.getByRole("button", { name: "Lançar reserva" }).click();
  await expect(win).toContainText("Confira o número com o cliente");
  await confere.getByRole("button", { name: "Sim, confere" }).click();
  await win.getByRole("button", { name: "Lançar reserva" }).click();
  await expect(win).toHaveCount(0);
  await expect(page.locator(".toast").first()).toContainText("lançada");
});

test("a mesma pessoa no mesmo horário mostra a reserva que já existe", async ({ page }) => {
  await openList(page, "gerente");
  let win = await newBooking(page);
  const time = await win.locator('.res-hora input[name="time"]:checked').inputValue();
  await win.getByLabel("Nome").fill("Helena Duarte");
  await win.locator("#nova-fone").fill("45 99811-4477");
  await win.getByRole("button", { name: "Lançar reserva" }).click();
  await expect(win).toHaveCount(0);
  win = await newBooking(page);
  await win.locator(`.res-hora input[value="${time}"]`).check();
  await win.getByLabel("Nome").fill("Helena Duarte");
  await win.locator("#nova-fone").fill("45 99811-4477");
  await win.getByRole("button", { name: "Lançar reserva" }).click();
  await expect(win.locator(".res-janela__erro")).toContainText("Já tem reserva nesse horário");
  await expect(win.locator(".res-janela__erro")).toContainText(/Já existe: TR-\d+/);
});

test("cliente sem WhatsApp: nasce confirmada com o marcador, sem mensagem, e a tela mostra Ler para o cliente", async ({ page }) => {
  await openList(page, "recepcao");
  const win = await newBooking(page);
  await win.getByLabel("Nome").fill("Dona Lourdes");
  await win.getByLabel("O cliente não tem WhatsApp: confirmar por ligação").check();
  await expect(win.getByText("Telefone para ligar")).toBeVisible();
  await win.locator("#nova-fone").fill("45 99733-2100");
  await win.getByRole("button", { name: "Lançar reserva" }).click();
  const read = page.getByRole("dialog", { name: "Ler para o cliente" });
  await expect(read).toContainText("Sua reserva está confirmada.");
  await expect(read).toContainText(/A mesa espera (até \d{2}:\d{2}|às \d{2}:\d{2} em ponto)\./);
  await expect(read).toContainText("Código: TR");
  await bothThemes(page);
  await read.getByRole("button", { name: "Pronto, li" }).click();
  const saved = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem("territorio:mock-db"));
    const c = db.customers.find((x) => x.name === "Dona Lourdes");
    const r = db.reservations.find((x) => x.customer_id === c.id);
    return { status: r.status, flags: r.flags, messages: r.messages.length };
  });
  expect(saved).toEqual({ status: "confirmed", flags: ["no_whatsapp"], messages: 0 });
  // a recepção vê só hoje: a marca é conferida nos dados da gaveta
  expect(saved.flags).toContain("no_whatsapp");
});

test("Ver telefone na gaveta: a gerência confirma a identidade; a recepção não tem o botão", async ({ page }) => {
  await openList(page, "gerente", "&q=Renata");
  await page.getByRole("link", { name: "Renata Souza" }).click();
  const drawer = page.locator(".res-gaveta");
  await drawer.getByRole("button", { name: "Ver telefone" }).click();
  const dialog = page.getByRole("dialog", { name: /Confirme/ });
  await dialog.getByLabel("Senha").fill("admin");
  await dialog.getByLabel("Código do aplicativo").fill("123456");
  await dialog.getByRole("button", { name: "Confirmar" }).click();
  await expect(drawer.locator(".res-telefone")).toBeVisible();
  expect(await serious(page)).toEqual([]);
  await page.keyboard.press("Escape");

  await page.goto("/admin/reservas?papel=recepcao&mock=normal");
  await page.waitForSelector("html[data-ready]");
  await rows(page).first().getByRole("button", { name: /Abrir|Chegou/ }).first().waitFor();
  await page.locator(".res-nome").first().click();
  await expect(page.locator(".res-gaveta").getByRole("heading", { level: 2 })).toBeVisible();
  await expect(page.locator(".res-gaveta").getByRole("button", { name: "Ver telefone" })).toHaveCount(0);
});

test("cliente e casa cancelam juntos: só um grava, a casa ouve quando o cliente cancelou", async ({ page }) => {
  const date = await tonight(page);
  await page.goto(`/admin/reservas?papel=gerente&mock=normal&agora=${date}T17:00`);
  await page.waitForSelector("html[data-ready]");
  const r = await page.evaluate(() => fetch("/api/v1/staff/floor").then((x) => x.json()).then((f) => f.reservations.find((x) => x.customer.name.startsWith("Beatriz"))));
  // o cliente cancela um pouco antes (nos dados salvos do mock, como o site faz)
  await page.evaluate((id) => {
    const db = JSON.parse(localStorage.getItem("territorio:mock-db"));
    const x = db.reservations.find((y) => y.id === id);
    Object.assign(x, { status: "canceled", canceled_by: "customer", canceled_at: new Date().toISOString(), cancel_reason: "Pelo site", table_codes: [] });
    x.messages.push({ template: "canceled", status: "sent", sent_at: new Date().toISOString() });
    localStorage.setItem("territorio:mock-db", JSON.stringify(db));
  }, r.id);
  await page.reload();
  await page.waitForSelector("html[data-ready]");
  const answer = await call(page, `/staff/reservations/${r.id}/actions`, { action: "cancel", reason: "Casa cheia", notify_customer: true }, "cancela-junto");
  expect(answer.status).toBe(409);
  expect(answer.body.type).toBe("invalid_transition");
  expect(answer.body.detail).toMatch(/O cliente cancelou às \d{2}:\d{2}/);
  const after = await page.evaluate((id) => {
    const db = JSON.parse(localStorage.getItem("territorio:mock-db"));
    const x = db.reservations.find((y) => y.id === id);
    return { messages: x.messages.filter((m) => m.template === "canceled").length, freed: (db.capacity_freed || []).filter((f) => f.reservation_id === id).length };
  }, r.id);
  expect(after).toEqual({ messages: 1, freed: 0 });
});

test("cancelar pela casa registra a vaga para a espera uma vez só, e o reenviar vai ao registro", async ({ page }) => {
  await openList(page, "gerente");
  const r = await page.evaluate(() => fetch("/api/v1/staff/reservations?status=confirmed&limit=5").then((x) => x.json()).then((p) => p.items.find((i) => !i.no_whatsapp)));
  expect((await call(page, `/staff/reservations/${r.id}/actions`, { action: "resend_confirmation" }, "reenvia-1")).status).toBe(200);
  expect((await call(page, `/staff/reservations/${r.id}/actions`, { action: "cancel", reason: "Pedido do cliente", notify_customer: true }, "cancela-1")).status).toBe(200);
  expect((await call(page, `/staff/reservations/${r.id}/actions`, { action: "cancel", reason: "Pedido do cliente", notify_customer: true }, "cancela-2")).status).toBe(409);
  const after = await page.evaluate((id) => {
    const db = JSON.parse(localStorage.getItem("territorio:mock-db"));
    return {
      freed: (db.capacity_freed || []).filter((f) => f.reservation_id === id).length,
      logged: db.audit.filter((e) => e.entity_id === id).map((e) => e.action),
    };
  }, r.id);
  expect(after.freed).toBe(1);
  expect(after.logged).toEqual(expect.arrayContaining(["reservation.resend_confirmation", "reservation.cancel"]));
});

test("a gaveta aberta ouve a mudança feita em outro aparelho", async ({ page, context }) => {
  await openList(page, "gerente", "&q=Renata");
  await page.getByRole("link", { name: "Renata Souza" }).click();
  const drawer = page.locator(".res-gaveta");
  await expect(drawer.getByRole("heading", { name: "Renata Souza" })).toBeVisible();
  const id = page.url().split("/admin/reservas/")[1].split("?")[0];
  const other = await context.newPage();
  await other.goto("/admin/reservas?papel=gerente&mock=normal");
  await other.waitForSelector("html[data-ready]");
  expect((await call(other, `/staff/reservations/${id}/actions`, { action: "note", internal_notes: "Trocar a cadeirinha de lugar." }, "nota-outro")).status).toBe(200);
  await expect(drawer).toContainText("Isso mudou agora há pouco", { timeout: 10_000 });
  await expect(drawer).toContainText("Trocar a cadeirinha de lugar.");
  await other.close();
});

test("exportar leva os filtros da tela: status, canal e busca (5.11)", async ({ page }) => {
  await openList(page, "dono", "&status=confirmadas&canal=site");
  await page.getByRole("button", { name: "Exportar" }).click();
  const dialog = page.getByRole("dialog", { name: "Exportar as reservas" });
  await expect(dialog).toContainText("só confirmadas, canal Site");
  await dialog.getByLabel("Senha").fill("admin");
  await dialog.getByLabel("Código do aplicativo").fill("123456");
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Confirmar e baixar" }).click();
  const stream = await (await download).createReadStream();
  const text = await new Promise((resolve, reject) => {
    let out = "";
    stream.on("data", (chunk) => (out += chunk));
    stream.on("end", () => resolve(out));
    stream.on("error", reject);
  });
  const lines = text.replace(/^\s*/, "").trim().split(/\r?\n/).slice(1);
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) {
    const cells = line.split(";");
    expect(cells[6]).toBe("site");
    expect(cells[7]).toBe("confirmed");
  }
  const logged = await page.evaluate(() => JSON.parse(localStorage.getItem("territorio:mock-db")).audit.filter((e) => e.action === "reservations.export").pop()?.summary);
  expect(logged).toMatch(/filtro por status, canal/);
});

test("horário cheio na nova reserva: a recepção não passa do limite e tem Ver horários (5.6)", async ({ page }) => {
  await openList(page, "recepcao");
  await page.getByRole("button", { name: "Nova reserva" }).click();
  const win = page.locator(".res-janela");
  await win.getByLabel("Dia").fill(nextOpenDay());
  await win.getByLabel("Dia").dispatchEvent("change");
  await win.locator("#nova-pessoas").fill("40");
  await win.locator("#nova-pessoas").dispatchEvent("change");
  const slot = win.locator(".res-hora").first();
  await expect(slot).toContainText("cheio", { timeout: 15_000 });
  await slot.click();
  await expect(win.getByText("Esse horário está cheio.")).toBeVisible();
  await expect(win.getByLabel("Passar do limite")).toHaveCount(0);
  await win.getByRole("button", { name: "Ver horários" }).click();
  await expect(win.locator('input[name="time"]:checked')).toHaveCount(0);
  await expect(win.locator(".res-hora input").first()).toBeFocused();

  // tentando mesmo assim: slot_full.staff com "Ver horários", nada criado
  await win.locator(".res-hora").first().click();
  await win.getByLabel("Nome").fill("Grupo da formatura");
  await win.getByRole("button", { name: "Lançar reserva" }).click();
  const problem = win.locator(".res-janela__erro");
  await expect(problem).toContainText("Esse horário está cheio. Escolha outro horário.");
  await problem.getByRole("button", { name: "Ver horários" }).click();
  await expect(win.locator('input[name="time"]:checked')).toHaveCount(0);
});

test("cancelar pela casa oferece a vaga à espera na hora, como o cancelamento do cliente (7.16)", async ({ page }) => {
  const date = await tonight(page);
  await page.goto(`/admin/reservas?papel=gerente&mock=normal&agora=${date}T17:00`);
  await page.waitForSelector("html[data-ready]");
  const list = await page.evaluate((d) => fetch(`/api/v1/staff/reservations?from=${d}&to=${d}&status=confirmed,waitlisted&limit=100`).then((x) => x.json()).then((p) => p.items), date);
  const waiting = list.filter((r) => r.status === "waitlisted").map((r) => r.id);
  expect(waiting.length).toBeGreaterThan(0);
  const offeredNow = () =>
    page.evaluate((ids) => {
      const db = JSON.parse(localStorage.getItem("territorio:mock-db"));
      const r = db.reservations.find((x) => ids.includes(x.id) && x.status === "offered");
      return r ? { id: r.id, messages: r.messages.map((m) => m.template), freed: db.capacity_freed.filter((f) => (f.offered_to || []).includes(r.id)).length } : null;
    }, waiting);
  let offered = null;
  for (const [i, r] of list.filter((x) => x.status === "confirmed").entries()) {
    expect((await call(page, `/staff/reservations/${r.id}/actions`, { action: "cancel", reason: "Pedido do cliente" }, `oferta-${i}`)).status).toBe(200);
    offered = await offeredNow();
    if (offered) break;
  }
  expect(offered).not.toBeNull();
  expect(offered.messages).toContain("waitlist_offer");
  expect(offered.freed).toBe(1);
});

test("vai atrasar: o extra soma uma vez só, pelo aviso do cliente ou pela ligação (2.12)", async ({ page }) => {
  await openList(page, "gerente");
  const [a, b] = await page.evaluate(() =>
    fetch("/api/v1/staff/reservations?status=confirmed&limit=50")
      .then((x) => x.json())
      .then((p) => p.items.filter((i) => !i.customer_late).slice(0, 2)),
  );
  // a: o cliente já tocou em "Vou atrasar um pouco" (como o mock do cliente escreve)
  await page.evaluate((id) => {
    const db = JSON.parse(localStorage.getItem("territorio:mock-db"));
    Object.assign(db.reservations.find((x) => x.id === id), { late_notice_at: new Date().toISOString(), extra_tolerance_min: 10 });
    localStorage.setItem("territorio:mock-db", JSON.stringify(db));
  }, a.id);
  await page.reload();
  await page.waitForSelector("html[data-ready]");
  const extra = (id) => page.evaluate((x) => fetch(`/api/v1/staff/reservations/${x}`).then((r) => r.json()).then((r) => r.extra_tolerance_min), id);
  expect((await call(page, `/staff/reservations/${a.id}/actions`, { action: "call_answer", answer: "late" }, "atraso-a")).status).toBe(200);
  expect(await extra(a.id)).toBe(10);
  // b: avisado por telefone, depois dito de novo em outra ligação: o extra uma vez só
  expect((await call(page, `/staff/reservations/${b.id}/actions`, { action: "call_answer", answer: "late" }, "atraso-b1")).status).toBe(200);
  const once = await extra(b.id);
  expect(once).toBeGreaterThan(0);
  expect((await call(page, `/staff/reservations/${b.id}/actions`, { action: "call_answer", answer: "late" }, "atraso-b2")).status).toBe(200);
  expect(await extra(b.id)).toBe(once);
});
