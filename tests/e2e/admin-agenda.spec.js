// Agenda (histórias 3.4 a 3.6): o mês com dias fechados e especiais, a semana, o plano de
// uma data com "quem perde mesa" antes de gravar, várias datas de uma vez, perfis e os estados.
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

// uma tarde fixa da casa (uma quarta no meio do mês), para o mês sempre ter noites pela frente
const AGORA = "agora=2026-10-14T15:00";

async function open(page, url) {
  await page.goto(url);
  await page.waitForSelector("html[data-ready]");
}

/** Navega dentro do painel sem recarregar a sessão (mantém um cenário definido depois). */
async function goInside(page, path) {
  await page.evaluate((p) => {
    window.history.pushState(null, "", p);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

/** "Quem perde mesa": quando a folha abre, cancela cada caso sem mesa e grava. */
async function settleEffect(page) {
  const sheet = page.locator("dialog.ag-sheet[open]");
  // a folha só abre quando alguém é afetado; senão a mudança é gravada direto
  if (!(await sheet.waitFor({ timeout: 3000 }).then(() => true, () => false))) return;
  for (const caso of await sheet.locator(".ag-caso").all()) await caso.getByText("Cancelar avisando").click();
  await sheet.locator(".ag-sheet__acoes .btn:not(.btn--outline)").click();
  await expect(sheet).toBeHidden();
}

test("dono vê o mês com dias fechados e fora do padrão, e a semana", async ({ page }) => {
  await open(page, "/admin/agenda?papel=dono&mock=normal");
  await expect(page.getByRole("heading", { level: 1, name: "Agenda" })).toBeVisible();
  const days = page.locator(".ag-mes__dias .ag-dia");
  await expect(days.first()).toBeVisible();
  await expect(page.locator(".ag-dia.is-fechado").first()).toContainText("Fechado");
  await expect(page.locator(".ag-dia.is-hoje")).toHaveCount(1);
  await bothThemes(page);

  await page.getByRole("button", { name: "Semana", exact: true }).click();
  await expect(page.locator(".ag-semana__dia")).toHaveCount(7);
  await expect(page.getByRole("link", { name: "Abrir o plano" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Próxima semana" }).click();
  await expect(page.locator(".ag-nav__titulo")).toContainText("Semana de");
  await bothThemes(page);
});

test("trocar a planta de um dia com reservas mostra o efeito antes de gravar", async ({ page }) => {
  await open(page, `/admin/agenda?papel=dono&mock=normal&${AGORA}`);
  // não hoje: grupos já sentados hoje não podem ser movidos daqui (veja o teste abaixo)
  const day = page.locator("a.ag-dia:not(.is-passado):not(.is-fechado):not(.is-hoje)", { hasText: /\d+ reservas/ }).first();
  await day.click();
  await expect(page.getByRole("heading", { name: "Trocar a planta do dia" })).toBeVisible();
  await page.locator(".ag-rapido select").selectOption({ label: "Sem quintal (chuva)" });
  await page.getByRole("button", { name: "Ver o efeito", exact: true }).click();
  const sheet = page.locator("dialog.ag-sheet[open]");
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("Nada foi gravado ainda");
  await expect(sheet.locator(".ag-efeito__resumo")).toContainText("Mantêm a mesa");
  await bothThemes(page);
  await settleEffect(page);
  await expect(page.locator(".toast").filter({ hasText: "Plano do dia gravado" })).toBeVisible();
  await expect(page.locator(".ag-resumo")).toContainText("Sem quintal (chuva)");
  await expect(page.locator(".ag-dia-plano__cabeca")).toContainText("Fora do padrão");

  // de volta à semana padrão
  await page.getByRole("button", { name: "Voltar à semana padrão" }).click();
  await settleEffect(page);
  await expect(page.locator(".toast").filter({ hasText: "O dia voltou à semana padrão" })).toBeVisible();
});

test("fechar o dia pede o motivo para o cliente", async ({ page }) => {
  await open(page, `/admin/agenda?papel=dono&mock=normal&${AGORA}`);
  await page.locator("a.ag-dia:not(.is-passado):not(.is-fechado)", { hasText: "Sem reservas" }).first().click();
  await page.locator(".ag-plano").getByText("Fecha", { exact: true }).click();
  const reason = page.locator(".ag-plano input[name=public_label]");
  await reason.fill("");
  await page.getByRole("button", { name: "Ver o efeito e gravar" }).click();
  await expect(page.locator(".field__error", { hasText: "Diga ao cliente por que a casa fecha" })).toBeVisible();
  await reason.fill("Feriado");
  // o motivo em três línguas: as que faltam dizem "falta", o espanhol é digitado aqui
  await expect(page.getByRole("tab", { name: /English.*falta/ })).toBeVisible();
  await page.getByRole("tab", { name: /Español/ }).click();
  await page.getByLabel("O que o cliente lê no calendário do site (Español)").fill("Feriado");
  await expect(page.getByRole("tab", { name: /Español/ })).not.toContainText("falta");
  await page.getByRole("button", { name: "Ver o efeito e gravar" }).click();
  await settleEffect(page);
  await expect(page.locator(".ag-resumo")).toContainText("Fechado · Feriado");
});

test("várias datas recebem o mesmo plano", async ({ page }) => {
  test.skip(test.info().project.name === "celular", "a escolha de várias datas é a mesma no celular; uma vez basta");
  await open(page, `/admin/agenda?papel=gerente&mock=normal&${AGORA}`);
  await page.getByRole("button", { name: "Várias datas" }).click();
  const free = page.locator("button.ag-dia:not(:disabled):not(.is-fechado)", { hasText: "Sem reservas" });
  await free.nth(0).click();
  await free.nth(1).click();
  await expect(page.locator(".ag-selecao")).toContainText("2 datas escolhidas");
  await page.getByRole("button", { name: "Definir o plano" }).click();
  const sheet = page.locator("dialog.ag-sheet[open]").first();
  await expect(sheet).toContainText("Plano de 2 datas");
  await sheet.getByLabel("Pessoas por horário").fill("20");
  await sheet.getByRole("button", { name: "Ver o efeito e gravar" }).click();
  await expect(page.locator(".toast").filter({ hasText: "Plano gravado" })).toBeVisible();
});

test("recepção não vê a Agenda e o acesso direto é proibido", async ({ page }) => {
  await open(page, "/admin/agenda?papel=recepcao&mock=normal");
  await expect(page.getByRole("heading", { level: 1, name: "Essa parte é de outro perfil da equipe" })).toBeVisible();
});

test("vazio e erro", async ({ page }) => {
  await open(page, "/admin/agenda?papel=dono&mock=vazio");
  await expect(page.getByText("Nenhuma reserva nem dia especial neste período")).toBeVisible();
  await bothThemes(page);

  await page.evaluate(() => sessionStorage.setItem("territorio:mock-scenario", JSON.stringify("erro")));
  await goInside(page, "/admin/plantas");
  await goInside(page, "/admin/agenda");
  const alert = page.locator("#area-corpo [role=alert]");
  await expect(alert).toContainText("Não deu para carregar.");
  await expect(alert).not.toContainText("Erro simulado");
  await expect(page.getByRole("button", { name: "Tentar de novo" })).toBeVisible();
  await bothThemes(page);
});

// ---- as datas da casa, como o mock monta ------------------------------------------------------

const houseToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

/** Muda o banco do mock (guardado no localStorage) e recarrega, para o painel ler. */
async function editDb(page, fn, arg) {
  await page.evaluate(
    ([source, a]) => {
      const db = JSON.parse(localStorage.getItem("territorio:mock-db"));
      new Function("db", "a", source)(db, a);
      localStorage.setItem("territorio:mock-db", JSON.stringify(db));
    },
    [fn, arg],
  );
}

/** Uma noite aberta futura (pela semana padrão) sem plano nem evento, daqui a duas semanas. */
async function freeNight(page) {
  return page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem("territorio:mock-db"));
    const day = (d) => new Date(`${d}T12:00:00Z`).getUTCDay();
    let d = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(Date.now() + 14 * 86_400_000));
    for (let i = 0; i < 20; i++) {
      const busy = db.day_plans?.[d] || db.events.some((e) => e.date === d) || db.reservations.some((r) => r.date === d);
      if (db.hours.find((h) => h.weekday === day(d))?.open && !busy) return d;
      d = new Date(Date.parse(`${d}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    }
    return null;
  });
}

test("mesa já sentada numa mesa que sai da planta impede gravar", async ({ page }) => {
  const today = houseToday();
  await open(page, `/admin/agenda/${today}?papel=dono&mock=normal&agora=${today}T21:30`);
  const quick = page.getByRole("heading", { name: "Trocar a planta do dia" });
  await expect(page.locator(".ag-resumo")).toBeVisible({ timeout: 30_000 });
  test.skip(!(await quick.isVisible()), "a casa não abre hoje");
  await page.locator(".ag-rapido select").selectOption({ label: "Sem quintal (chuva)" });
  await page.getByRole("button", { name: "Ver o efeito", exact: true }).click();
  const sheet = page.locator("dialog.ag-sheet[open]");
  await expect(sheet.getByText(/Mesas sentadas que saem/)).toBeVisible();
  await expect(sheet.getByText(/troque o grupo de mesa no/)).toBeVisible();
  await expect(sheet.locator(".ag-sheet__acoes .btn:not(.btn--outline)")).toBeDisabled();
  await bothThemes(page);
});

test("voltar à semana padrão leva a decisão de quem ficou sem mesa", async ({ page }) => {
  await open(page, "/admin/agenda?papel=dono&mock=normal");
  await expect(page.locator(".ag-mes__dias .ag-dia").first()).toBeVisible();
  const date = await freeNight(page);
  // o painel guarda a sua própria cópia dos dados e pode gravar por cima da edição; uma página sem
  // o painel não pode
  await page.goto("/privacidade/");
  await editDb(
    page,
    `const full = db.layouts.find((l) => l.name === "Casa cheia");
     db.day_plans[a] = { layout_id: full.id, held_tables: [], closed_areas: [], version: "v-teste", updated_by: "Marcus Norberto", updated_at: new Date().toISOString() };
     db.customers.push({ id: "c-teste", name: "Grupo da Mesa Comprida", phone_e164: "+5545999990000", visits: 1, no_shows: 0, tags: [] });
     db.reservations.push({ id: "r-teste", code: "TR-9901", customer_id: "c-teste", date: a, time: "20:00", party_size: 10, status: "confirmed", table_codes: ["Q3", "Q6"], area_key: "quintal", duration_min: 120, internal_notes: "" });`,
    date,
  );
  await open(page, `/admin/agenda/${date}?papel=dono&mock=normal`);
  await page.getByRole("button", { name: "Voltar à semana padrão" }).click();
  const sheet = page.locator("dialog.ag-sheet[open]");
  const caso = sheet.locator(".ag-caso", { hasText: "Grupo da Mesa Comprida" });
  await expect(caso).toBeVisible();
  // "Remarcar" oferece o mesmo horário em outra mesa, além de outro horário
  await caso.getByText("Remarcar").click();
  await expect(caso.getByLabel("Horário").locator("option", { hasText: "(o mesmo, outra mesa)" })).toHaveCount(1);
  await caso.getByText("Manter com observação").click();
  await caso.getByLabel(/Observação/).fill("Encaixar no quintal com mesas extras");
  const sent = page.waitForRequest((r) => r.method() === "DELETE" && r.url().includes(`/staff/day-plans/${date}`) && !r.url().includes("dry_run"));
  await sheet.locator(".ag-sheet__acoes .btn:not(.btn--outline)").click();
  const body = (await sent).postDataJSON();
  expect(body.resolutions).toEqual([expect.objectContaining({ reservation_id: "r-teste", action: "keep", note: "Encaixar no quintal com mesas extras" })]);
  await expect(page.locator(".toast").filter({ hasText: "O dia voltou à semana padrão" })).toBeVisible();
  const note = await page.evaluate(() => JSON.parse(localStorage.getItem("territorio:mock-db")).reservations.find((r) => r.id === "r-teste").internal_notes);
  expect(note).toContain("Encaixar no quintal com mesas extras");
});

test("outra pessoa gravou o dia antes: juntar mantém o formulário", async ({ page }) => {
  await open(page, "/admin/agenda?papel=dono&mock=normal");
  await expect(page.locator(".ag-mes__dias .ag-dia").first()).toBeVisible();
  const date = await freeNight(page);
  await open(page, `/admin/agenda/${date}?papel=dono&mock=normal&conflito=1`);
  await page.locator(".ag-plano").getByLabel("Pessoas por horário").fill("24");
  await page.getByRole("button", { name: "Ver o efeito e gravar" }).focus();
  await page.keyboard.press("Enter");
  const sheet = page.locator("dialog.ag-sheet[open]");
  await expect(sheet).toContainText("gravou antes de você");
  await expect(sheet).toContainText("Nota da equipe");
  await bothThemes(page);
  await sheet.getByRole("button", { name: "Juntar com as minhas" }).click();
  await expect(page.locator(".ag-plano").getByLabel("Pessoas por horário")).toHaveValue("24");
  await page.getByRole("button", { name: "Ver o efeito e gravar" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".toast").filter({ hasText: "Plano do dia gravado" })).toBeVisible();
});

test("sem conexão, o dia aparece como estava, só para leitura", async ({ page }) => {
  await open(page, "/admin/agenda?papel=dono&mock=normal&rede=ok");
  await expect(page.locator(".ag-mes__dias .ag-dia").first()).toBeVisible();
  const date = await freeNight(page);
  await goInside(page, `/admin/agenda/${date}`);
  await expect(page.getByRole("heading", { name: "Plano do dia" })).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem("territorio:mock-rede", "true"));
  await goInside(page, "/admin/agenda");
  await expect(page.getByText("Sem conexão. Você vê a última versão.")).toBeVisible();
  await goInside(page, `/admin/agenda/${date}`);
  await expect(page.getByText("Sem conexão. Você vê a última versão.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ver o efeito e gravar" })).toBeDisabled();
  await bothThemes(page);
  await page.evaluate(() => sessionStorage.setItem("territorio:mock-rede", "false"));
});

test("a sessão vence ao gravar: entrar de novo abre por cima e o formulário fica", async ({ page }) => {
  await open(page, "/admin/agenda?papel=dono&mock=normal");
  await expect(page.locator(".ag-mes__dias .ag-dia").first()).toBeVisible();
  const date = await freeNight(page);
  // dentro do painel o endereço perde o ?papel=, então a sessão de demonstração é só da aba
  await goInside(page, `/admin/agenda/${date}`);
  await page.locator(".ag-plano").getByLabel("Pessoas por horário").fill("30");
  await page.evaluate(() => {
    sessionStorage.removeItem("territorio:mock-papel");
    sessionStorage.removeItem("territorio:mock-equipe");
    localStorage.removeItem("territorio:mock-equipe");
  });
  await page.getByRole("button", { name: "Ver o efeito e gravar" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("dialog.entrar-de-novo[open]")).toBeVisible();
  await expect(page.locator(".ag-plano").getByLabel("Pessoas por horário")).toHaveValue("30");
});

test("mudar o plano do dia oferece à espera o lugar que abriu, como o cancelamento do cliente (7.16)", async ({ page }) => {
  await open(page, `/admin/agenda?papel=gerente&mock=normal&${AGORA}`);
  const date = AGORA.slice(6, 16);
  const answer = await page.evaluate(async (day) => {
    const session = await fetch("/api/v1/staff/auth/session").then((r) => r.json());
    const r = await fetch("/api/v1/staff/day-plans", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrf_token },
      body: JSON.stringify({ dates: [day], plan: {}, confirm_conflicts: true }),
    });
    return r.status;
  }, date);
  expect(answer).toBe(200);
  const db = await page.evaluate(() => JSON.parse(localStorage.getItem("territorio:mock-db")));
  const freed = (db.capacity_freed || []).filter((f) => f.reason === "day_plan" && f.date === date);
  expect(freed).toHaveLength(1);
  for (const id of freed[0].offered_to) {
    const r = db.reservations.find((x) => x.id === id);
    expect(r.status).toBe("offered");
    expect(r.messages.map((m) => m.template)).toContain("waitlist_offer");
  }
});
