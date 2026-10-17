// A central de avisos (FR-87, mudança de 16/10): o sino com os não lidos, a gaveta com "Para
// agir", "Tudo" e "Resolvidos", a faixa dos críticos em toda tela, o silêncio da noite, o que
// cada perfil recebe, "Meus avisos" e a atualização ao vivo, no computador e no celular.
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

const houseDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

/**
 * Abre com o relógio da casa às 15:00 de hoje (?agora=), para o que o sino mostra não depender
 * da hora em que a bateria roda: à noite os pedidos de hoje já estão perto do prazo
 * ("vencendo" em vez de "Pedido para aprovar"), e de madrugada o silêncio os segura.
 */
async function open(page, url) {
  await page.addInitScript(() => localStorage.setItem("territorio:demo-open", "false"));
  await page.goto(`${url}&agora=${houseDate()}T15:00`);
  await page.waitForSelector("html[data-ready]");
  await expect(page.locator(".area__titulo")).toBeVisible({ timeout: 20_000 });
}

/** O sino que está na tela (o do trilho no computador, o da barra de cima no celular). */
const bell = (page) => page.locator("[data-sino]:visible");
const drawer = (page) => page.getByRole("dialog", { name: "Avisos" });

async function openDrawer(page) {
  await expect(bell(page)).toHaveAttribute("aria-label", /Avisos: \d+ não lid/);
  await bell(page).click();
  await expect(drawer(page)).toBeVisible();
  return drawer(page);
}

test("dono: o sino conta os não lidos e a gaveta tem as três abas, com teclado e foco preso", async ({ page }) => {
  await open(page, "/admin/?papel=dono&mock=normal");
  await expect(bell(page)).toHaveAttribute("aria-label", /Avisos: [1-9]\d* não lidos?/);
  const before = Number((await bell(page).getAttribute("aria-label")).match(/\d+/)[0]);
  const box = await openDrawer(page);
  const tabs = box.getByRole("tab");
  await expect(tabs).toHaveText([/Para agir/, /Tudo/, /Resolvidos/]);
  await expect(box.getByRole("tab", { name: /Para agir/ })).toBeFocused();
  // o pedido pendente pede o dono: "Aprovar" abre a reserva
  const pending = box.locator('[data-aviso="pending_request"]').first();
  await expect(pending).toContainText("Pedido para aprovar");
  await expect(pending.getByRole("button", { name: "Aprovar" })).toBeVisible();
  // o crítico primeiro, e sem como dispensar
  const critical = box.locator('[data-aviso="pin_locked"]');
  await expect(critical).toContainText("crítico");
  await expect(critical.getByRole("button", { name: /Dispensar/ })).toHaveCount(0);
  await expect(box.locator(".avisos-item").first()).toHaveClass(/avisos-item--critical/);
  // as setas andam entre as abas
  await page.keyboard.press("ArrowRight");
  await expect(box.getByRole("tab", { name: /Tudo/ })).toBeFocused();
  await expect(box.getByRole("tab", { name: /Tudo/ })).toHaveAttribute("aria-selected", "true");
  await expect(box.locator('[data-aviso="birthday"], [data-aviso="large_group"]').first()).toBeVisible();
  // o Tab dá a volta dentro da gaveta
  for (let i = 0; i < 40; i++) await page.keyboard.press("Tab");
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest("#avisos")))).toBe(true);
  await bothThemes(page);
  // Esc fecha, o foco volta ao sino, e o que foi visto fica lido
  await page.keyboard.press("Escape");
  await expect(drawer(page)).toBeHidden();
  await expect(bell(page)).toBeFocused();
  await expect
    .poll(async () => Number(((await bell(page).getAttribute("aria-label")).match(/\d+/) || [0])[0]))
    .toBeLessThan(before);
});

test("informativo: dispensar só para mim vai para Resolvidos, e os outros continuam vendo", async ({ page }) => {
  await open(page, "/admin/reservas?papel=dono&mock=normal");
  const box = await openDrawer(page);
  await box.getByRole("tab", { name: /Tudo/ }).click();
  const info = box.locator('[data-aviso="birthday"], [data-aviso="large_group"], [data-aviso="dietary"]').first();
  const id = await info.getAttribute("data-id");
  await info.getByRole("button", { name: /^Dispensar só para mim/ }).click();
  await expect(page.locator(".toast", { hasText: "Dispensado só para você" })).toBeVisible();
  await expect(box.locator(`[data-id="${id}"]`)).toHaveCount(0);
  await box.getByRole("tab", { name: /Resolvidos/ }).click();
  await expect(box.locator(`[data-id="${id}"]`)).toContainText("Dispensado só para você");
  // o gerente ainda vê (dispensado só para o dono)
  const other = await page.context().newPage();
  await open(other, "/admin/?papel=gerente&mock=normal");
  const box2 = await openDrawer(other);
  await box2.getByRole("tab", { name: /Tudo/ }).click();
  await expect(box2.locator(`[data-id="${id}"]`)).toHaveCount(1);
  await other.close();
});

test("a faixa dos críticos aparece em toda tela e ninguém fecha", async ({ page }) => {
  await open(page, "/admin/?papel=dono&mock=normal");
  const band = page.getByRole("region", { name: "Avisos críticos" });
  await expect(band).toContainText("PIN travado");
  await expect(band).toContainText("Aparelho perdeu a chave");
  await expect(band.getByRole("button", { name: /Dispensar|Fechar/ })).toHaveCount(0);
  for (const path of ["/admin/reservas", "/admin/clientes", "/admin/configuracoes"]) {
    await page.goto(`${path}?papel=dono&mock=normal`);
    await expect(page.getByRole("region", { name: "Avisos críticos" })).toContainText("PIN travado");
  }
  // a ação leva até onde se resolve
  await page.getByRole("region", { name: "Avisos críticos" }).getByRole("link", { name: "Ver aparelhos" }).click();
  await expect(page).toHaveURL(/\/admin\/configuracoes\/aparelhos-e-impressoras/);
});

test("recepção: recebe o WhatsApp fora como crítico, e não recebe pedidos para aprovar nem avisos só do dono", async ({ page }) => {
  await open(page, "/admin/salao?papel=recepcao&mock=normal&whatsapp=fora");
  await expect(page.getByRole("region", { name: "Avisos críticos" })).toContainText("WhatsApp da casa fora do ar");
  const box = await openDrawer(page);
  await box.getByRole("tab", { name: /Tudo/ }).click();
  await expect(box.locator('[data-aviso="whatsapp_down"]')).toHaveCount(1);
  for (const kind of ["pending_request", "pin_locked", "device_key_lost", "privacy_request_due", "reminder_failed"]) {
    await expect(box.locator(`[data-aviso="${kind}"]`)).toHaveCount(0);
  }
  // a pessoa do aparelho da casa não tem o link "Meus avisos"; o acesso pessoal tem
  await expect(box.getByRole("link", { name: "Escolher o que seguir" })).toBeVisible();
});

test("Meus avisos: o crítico não desliga; o que a pessoa não segue sai de Para agir e do sino", async ({ page }) => {
  await open(page, "/admin/conta/avisos?papel=gerente&mock=normal");
  await expect(page.getByRole("heading", { level: 1, name: "Meus avisos" })).toBeVisible();
  const critical = page.getByRole("checkbox", { name: /Pedido para aprovar vencendo/ });
  await expect(critical).toBeChecked();
  await expect(critical).toBeDisabled();
  const pending = page.getByRole("checkbox", { name: /^Pedido para aprovar Some/ });
  await expect(pending).toBeChecked();
  await bothThemes(page);
  await pending.uncheck();
  await page.getByRole("button", { name: "Gravar" }).click();
  await expect(page.locator(".toast", { hasText: "Gravado" })).toBeVisible();
  const box = await openDrawer(page);
  await expect(box.locator('[data-aviso="pending_request"]')).toHaveCount(0);
  await box.getByRole("tab", { name: /Tudo/ }).click();
  await expect(box.locator('[data-aviso="pending_request"]').first()).toContainText("Você não segue este aviso");
  // um crítico na lista é recusado pela API também
  const answer = await page.evaluate(async () => {
    const session = await fetch("/api/v1/staff/auth/session").then((r) => r.json());
    const r = await fetch("/api/v1/staff/me/alert-preferences", { method: "PUT", headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrf_token }, body: JSON.stringify({ muted: ["pending_expiring"] }) });
    return r.status;
  });
  expect(answer).toBe(422);
});

test("silêncio da noite: o que nasce nele espera, o crítico não", async ({ page }) => {
  const date = houseDate();
  await open(page, `/admin/?papel=dono&mock=normal`);
  // um pedido feito às 02:10, visto às 02:30
  await page.addInitScript((date) => {
    if (sessionStorage.getItem("teste-silencio")) return;
    const db = JSON.parse(localStorage.getItem("territorio:mock-db"));
    const r = db.reservations.find((x) => x.status === "pending" && x.date >= date);
    const at = new Date(`${date}T02:10:00-03:00`).toISOString();
    r.created_at = at;
    for (const h of r.history || []) if (h.action === "created") h.at = at;
    r.pending_until = new Date(`${date}T08:00:00-03:00`).toISOString();
    delete db.notices;
    localStorage.setItem("territorio:mock-db", JSON.stringify(db));
    sessionStorage.setItem("teste-silencio", "1");
  }, date);
  await page.goto(`/admin/?papel=dono&mock=normal&agora=${date}T02:30`);
  await page.waitForSelector("html[data-ready]");
  const box = await openDrawer(page);
  await expect(box).toContainText("Silêncio da noite até 09:00");
  await box.getByRole("tab", { name: /Tudo/ }).click();
  await expect(box.locator('[data-aviso="pending_request"]').filter({ hasText: "Chegou no silêncio da noite" })).toHaveCount(1);
  await expect(box.locator('[data-aviso="pin_locked"], [data-aviso="device_key_lost"]').filter({ hasText: "Chegou no silêncio" })).toHaveCount(0);
});

test("ao vivo: o que outra aba faz chega ao sino sem recarregar", async ({ page }) => {
  await open(page, "/admin/reservas?papel=dono&mock=normal");
  await expect(bell(page)).toHaveAttribute("aria-label", /Avisos: [1-9]\d* não lidos?/);
  const other = await page.context().newPage();
  await open(other, "/admin/?papel=dono&mock=normal");
  const box = await openDrawer(other);
  await box.getByRole("button", { name: "Marcar tudo como lido" }).click();
  await expect(other.locator(".toast", { hasText: "Tudo marcado como lido" })).toBeVisible();
  await expect(bell(page)).toHaveAttribute("aria-label", "Avisos: nenhum não lido", { timeout: 15_000 });
  await other.close();
});

test("celular: o sino fica na barra de cima e a gaveta ocupa a tela", async ({ page }, info) => {
  test.skip(info.project.name !== "celular", "só no celular");
  await open(page, "/admin/?papel=dono&mock=normal");
  await expect(page.locator(".topo [data-sino]")).toBeVisible();
  const box = await openDrawer(page);
  const size = await box.boundingBox();
  const view = page.viewportSize();
  expect(size.width).toBeGreaterThanOrEqual(view.width - 2);
  await expect(box.getByRole("button", { name: "Fechar os avisos" })).toBeVisible();
  await box.getByRole("button", { name: "Fechar os avisos" }).click();
  await expect(drawer(page)).toBeHidden();
});
