// O aparelho da casa (histórias 1.10 a 1.12): pareamento com uma chave WebCrypto guardada no IndexedDB, o
// código de 8 caracteres, o dono aprovando em outra aba, todo pedido assinado; os nomes e
// o PIN, 5 erros travam por 15 minutos, a inatividade pede de novo mantendo a tela, "Trocar de
// pessoa", no_active_person; o relógio 6 minutos adiantado, uma assinatura recusada, uma chave perdida, um
// aparelho revogado e um navegador sem WebCrypto.
import AxeBuilder from "@axe-core/playwright";
import { expect as baseExpect, test } from "@playwright/test";

// o servidor de dev é compartilhado com outros trabalhos: dá um pouco mais de tempo a cada tela
const expect = baseExpect.configure({ timeout: 15_000 });

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

const isPhone = () => test.info().project.name === "celular";
const db = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("territorio:mock-db")));
const PIN = { "Tainá Oliveira": "6620", "Rodrigo Benítez": "1144", "Kenji Moraes": "2218" };
const lockTitle = (page) => page.getByRole("heading", { name: "Quem está usando?" });

/** Este navegador pede para parear; o dono aprova em outra aba do mesmo navegador. */
async function pair(page, context, { name = "Computador do bar", place = "Bar", key = "" } = {}) {
  await open(page, `/admin/aparelho?mock=normal${key}`);
  await page.getByLabel("Nome do aparelho").fill(name);
  await page.getByRole("button", { name: /Pedir pareamento/ }).click();
  return approve(page, context, { name, place });
}

async function approve(page, context, { name, place, revokeOld = false }) {
  // o navegador pode apagar a chave (sem armazenamento persistente aqui): avisa antes do código
  const warning = page.getByRole("button", { name: "Mostrar o código mesmo assim" });
  const code = page.locator(".aparelho-codigo");
  await expect(warning.or(code)).toBeVisible();
  if (await warning.isVisible()) await warning.click();
  await expect(code).toBeVisible();
  const value = (await code.textContent()).replace(/\s/g, "");
  expect(value).toMatch(/^[A-Z0-9]{8}$/);

  const owner = await context.newPage();
  await open(owner, "/admin/configuracoes/aparelhos-e-impressoras?papel=dono&mock=normal");
  await owner.locator(".cfg-aparelho", { hasText: name }).filter({ hasText: "pedindo pareamento" }).getByRole("button", { name: "Aprovar" }).click();
  const dialog = owner.getByRole("dialog", { name: "Aprovar aparelho" });
  await dialog.getByLabel("Código da tela do aparelho").fill(value);
  await dialog.getByLabel("Onde fica").fill(place);
  const old = dialog.getByRole("checkbox", { name: /Revogar/ });
  if (await old.count()) await (revokeOld ? old.check() : old.uncheck());
  await dialog.getByRole("button", { name: "Aprovar" }).click();
  if (revokeOld) {
    const who = owner.getByRole("dialog", { name: "Confirme que é você" });
    await who.getByLabel("Senha").fill("admin");
    await who.getByLabel("Código do aplicativo").fill("123456");
    await who.getByRole("button", { name: "Confirmar" }).click();
  }
  await expect(owner.getByText(`${name} aprovado`).first()).toBeVisible();
  await expect(lockTitle(page)).toBeVisible({ timeout: 15_000 });
  return owner;
}

async function enterAs(page, person, pin = PIN[person]) {
  await page.getByRole("button", { name: new RegExp(`^${person}`) }).click();
  await page.getByLabel(/PIN de/).fill(pin);
}

test("pareia com a chave do navegador, o dono aprova e a recepção entra pelo PIN", async ({ page, context }) => {
  test.setTimeout(60_000);
  const signed = [];
  page.on("request", (r) => r.url().includes("/api/v1/staff/me") && signed.push(r.headers()["x-device-signature"] || ""));
  await open(page, "/admin/aparelho?mock=normal");
  await expect(page.getByRole("heading", { level: 1, name: "Usar este aparelho na casa" })).toBeVisible();
  await bothThemes(page);
  await page.getByLabel("Nome do aparelho").fill("Computador do bar");
  await page.getByRole("button", { name: "Pedir pareamento" }).click();
  const warning = page.getByRole("heading", { name: "Este navegador pode apagar a chave da casa" });
  const code = page.locator(".aparelho-codigo");
  await expect(warning.or(code)).toBeVisible();
  if (await warning.isVisible()) {
    await expect(page.getByText("Use um perfil fixo do Chrome ou do Edge")).toBeVisible();
    await page.getByRole("button", { name: "Mostrar o código mesmo assim" }).click();
  }
  await expect(page.getByRole("heading", { name: "Esperando o dono aprovar" })).toBeVisible();
  await bothThemes(page);
  // a chave privada nunca sai do navegador; fora do IndexedDB, só a marca do pareamento
  const kept = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open("territorio-aparelho");
        req.onsuccess = () => {
          const get = req.result.transaction("chaves").objectStore("chaves").get("aparelho");
          get.onsuccess = () => resolve({ extractable: get.result.privateKey.extractable, type: get.result.privateKey.algorithm.name, mark: JSON.parse(localStorage.getItem("territorio:aparelho")) });
        };
      }),
  );
  expect(kept.extractable).toBe(false);
  expect(kept.type).toBe("ECDSA");
  expect(kept.mark.status).toBe("pending");

  await approve(page, context, { name: "Computador do bar", place: "Bar" });
  await expect(page.getByText("Computador do bar").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^Tainá Oliveira/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Marcus/ })).toHaveCount(0);
  await bothThemes(page);
  await enterAs(page, "Tainá Oliveira", "0000");
  await expect(page.getByText(/PIN não confere.*Restam 4 tentativas/)).toBeVisible();
  await bothThemes(page);
  await page.getByLabel(/PIN de/).fill(PIN["Tainá Oliveira"]);
  await expect(page.getByRole("heading", { level: 1, name: "Hoje" })).toBeVisible();
  // o perfil do aparelho, não o mais alto da pessoa, e o registro guarda pessoa e aparelho
  const menu = page.locator(isPhone() ? ".barra, .mais" : ".trilho");
  await expect(menu.locator("a.trilho__item, a.barra__item, a.mais__item")).toHaveCount(5);
  if (!isPhone()) await expect(page.locator(".trilho__pessoa")).toContainText("recepção · Computador do bar");
  expect(signed.at(-1)).not.toBe("");
  const entry = (await db(page)).audit.find((a) => a.action === "auth.pin_login");
  expect(entry).toMatchObject({ actor_label: "Tainá Oliveira", device_label: "Computador do bar" });
});

test("5 PINs errados travam a pessoa por 15 min e o dono vê no Hoje", async ({ page, context }) => {
  test.setTimeout(60_000);
  const owner = await pair(page, context);
  await enterAs(page, "Rodrigo Benítez", "0000");
  for (let i = 0; i < 4; i++) {
    await expect(page.getByLabel(/PIN de/)).toHaveValue("");
    await page.getByLabel(/PIN de/).fill("0000");
  }
  await expect(page.getByText("Rodrigo está travado por 15 min")).toBeVisible();
  await expect(page.getByText("Outra pessoa pode entrar com o próprio nome")).toBeVisible();
  await page.getByRole("button", { name: "Voltar aos nomes" }).click();
  await expect(page.getByRole("button", { name: /^Rodrigo Benítez/ })).toContainText("travado até");
  // outra pessoa ainda entra
  await enterAs(page, "Kenji Moraes");
  await expect(page.getByRole("heading", { level: 1, name: "Hoje" })).toBeVisible();
  await open(owner, "/admin/?papel=dono&mock=normal");
  await expect(owner.getByText(/PIN de Rodrigo Benítez travado no Computador do bar/)).toBeVisible({ timeout: 15_000 });
});

test("inatividade pede o PIN sem perder a tela, e outra pessoa decide se continua", async ({ page, context }) => {
  test.setTimeout(60_000);
  await pair(page, context);
  // o aparelho pede de novo depois de 8 s sem uso (o ?inatividade= da demonstração)
  await open(page, "/admin/?inatividade=8");
  await enterAs(page, "Tainá Oliveira");
  await page.locator(isPhone() ? ".barra" : ".trilho").getByRole("link", { name: "Reservas", exact: true }).click();
  const search = page.locator("#res-busca");
  await expect(search).toBeVisible();
  await search.fill("Ana");
  const lock = page.getByRole("dialog", { name: "Quem está usando?" });
  await expect(lock).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press("Escape");
  await expect(lock).toBeVisible();
  await bothThemes(page);
  await enterAs(page, "Kenji Moraes");
  const ask = page.getByRole("dialog", { name: "Continuar o que Tainá deixou?" });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Continuar" }).click();
  await expect(lock).toHaveCount(0);
  await expect(search).toHaveValue("Ana");
  if (!isPhone()) await expect(page.locator(".trilho__pessoa")).toContainText("Kenji Moraes");

});

test("Trocar de pessoa volta aos nomes na mesma tela, e o registro guarda a pessoa nova", async ({ page, context }) => {
  test.setTimeout(60_000);
  await pair(page, context);
  await enterAs(page, "Tainá Oliveira");
  await page.locator(isPhone() ? ".barra" : ".trilho").getByRole("link", { name: "Reservas", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Reservas" })).toBeVisible();
  if (isPhone()) await page.getByRole("button", { name: "Mais", exact: true }).click();
  await page.getByRole("button", { name: "Trocar de pessoa" }).click();
  const lock = page.getByRole("dialog", { name: "Quem está usando?" });
  await expect(lock).toBeVisible();
  await enterAs(page, "Kenji Moraes");
  await expect(lock).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Reservas" })).toBeVisible();
  if (!isPhone()) await expect(page.locator(".trilho__pessoa")).toContainText("Kenji Moraes");
  // a entrada de PIN mais recente é do Kenji, seja qual for a ordem do registro
  const logins = async () => (await db(page)).audit.filter((a) => a.action === "auth.pin_login");
  // a entrada é escrita quando a resposta do PIN volta, o que pode acontecer depois de a tela mudar
  await expect.poll(async () => (await logins()).map((a) => a.actor_label), { timeout: 10_000 }).toContain("Kenji Moraes");
  const all = await logins();
  const newest = all.reduce((last, a) => ((a.occurred_at || a.at) >= (last.occurred_at || last.at) ? a : last));
  expect(newest.actor_label).toBe("Kenji Moraes");
  expect(all.map((a) => a.actor_label)).toContain("Tainá Oliveira");
});

test("pessoa desativada no aparelho: Quem está usando? e o nome some da lista", async ({ page, context }) => {
  test.setTimeout(60_000);
  const owner = await pair(page, context);
  await enterAs(page, "Tainá Oliveira");
  await expect(page.getByRole("heading", { level: 1, name: "Hoje" })).toBeVisible();
  // o dono a desativa em Equipe
  await owner.evaluate(async () => {
    const users = await (await fetch("/api/v1/staff/users")).json();
    const id = users.find((u) => u.name === "Tainá Oliveira").id;
    await fetch(`/api/v1/staff/users/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json", "X-CSRF-Token": "mock-csrf-equipe" }, body: JSON.stringify({ status: "disabled" }) });
  });
  // a próxima ação descobre; a leitura ao vivo assinada (N5) pode chegar antes, sozinha
  await page.locator(isPhone() ? ".barra" : ".trilho").getByRole("link", { name: "Reservas", exact: true }).click({ timeout: 5_000 }).catch(() => {});
  const lock = page.getByRole("dialog", { name: "Quem está usando?" });
  await expect(lock).toBeVisible();
  await expect(lock.getByRole("button", { name: /^Rodrigo Benítez/ })).toBeVisible();
  await expect(lock.getByRole("button", { name: /^Tainá Oliveira/ })).toHaveCount(0);
});

test("relógio 6 min adiantado avisa sem pedir novo pareamento; assinatura recusada pede para conferir", async ({ page, context }) => {
  test.setTimeout(60_000);
  await pair(page, context);
  await open(page, "/admin/?relogio=6");
  await expect(page.getByRole("heading", { name: "O relógio deste aparelho está errado" })).toBeVisible();
  await expect(page.getByText("Ele está 6 min adiantado. Acerte a data e a hora do aparelho e toque em tentar de novo.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Parear|pareamento/ })).toHaveCount(0);
  // entre 2 e 5 minutos só avisa
  await open(page, "/admin/?relogio=3");
  await expect(lockTitle(page)).toBeVisible();
  await expect(page.getByText("O relógio deste aparelho está 3 min adiantado")).toBeVisible();

  await open(page, "/admin/?relogio=0&assinatura=errada");
  await expect(page.getByRole("heading", { name: "Este aparelho precisa se apresentar de novo" })).toBeVisible();
  await expect(page.getByText("Confira a data e a hora")).toBeVisible();
  await expect(page.getByRole("button", { name: "Tentar de novo" })).toBeVisible();
  await open(page, "/admin/?assinatura=certa");
  await expect(lockTitle(page)).toBeVisible();
});

test("chave perdida: pede o pareamento de novo e o dono revoga o antigo no mesmo passo", async ({ page, context }) => {
  test.setTimeout(90_000);
  const owner = await pair(page, context);
  await owner.close();
  // o navegador apagou os dados do site, mas a marca do pareamento ficou
  await page.evaluate(() => new Promise((resolve) => (indexedDB.deleteDatabase("territorio-aparelho").onsuccess = resolve)));
  await open(page, "/admin/");
  await expect(page.getByRole("heading", { name: "Este aparelho perdeu a chave da casa" })).toBeVisible();
  await bothThemes(page);
  await page.getByRole("button", { name: "Pedir pareamento de novo" }).click();
  const second = await approve(page, context, { name: "Computador do bar", place: "Bar", revokeOld: true });
  await expect(second.getByText("Computador do bar revogado").first()).toBeVisible();
  const state = await db(second);
  expect(state.audit.some((a) => a.action === "device.key_lost")).toBe(true);
  expect(state.devices.filter((d) => d.name === "Computador do bar").map((d) => d.status).sort()).toEqual(["approved", "revoked"]);
});

test("aparelho revogado: a próxima ação volta ao pareamento", async ({ page, context }) => {
  test.setTimeout(60_000);
  const owner = await pair(page, context);
  await enterAs(page, "Tainá Oliveira");
  await expect(page.getByRole("heading", { level: 1, name: "Hoje" })).toBeVisible();
  await owner.locator(".cfg-aparelho", { hasText: "Computador do bar" }).getByRole("button", { name: "Revogar" }).click();
  await owner.getByRole("button", { name: "Revogar o aparelho" }).click();
  const who = owner.getByRole("dialog", { name: "Confirme que é você" });
  await who.getByLabel("Senha").fill("admin");
  await who.getByLabel("Código do aplicativo").fill("123456");
  await who.getByRole("button", { name: "Confirmar" }).click();
  await expect(owner.getByText("Computador do bar revogado").first()).toBeVisible();

  // a próxima ação descobre; a leitura ao vivo assinada (N5) pode chegar antes, sozinha
  await page.locator(isPhone() ? ".barra" : ".trilho").getByRole("link", { name: "Reservas", exact: true }).click({ timeout: 5_000 }).catch(() => {});
  await expect(page.getByRole("heading", { name: "Este aparelho não está liberado" })).toBeVisible();
  await page.getByRole("button", { name: "Parear de novo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Usar este aparelho na casa" })).toBeVisible();
});

test("sem ninguém do perfil do aparelho, a tela diz e a entrada pessoal continua", async ({ page, context }) => {
  test.setTimeout(60_000);
  await pair(page, context);
  await open(page, "/admin/?mock=vazio");
  await expect(page.getByText("Ninguém cadastrado para este aparelho.")).toBeVisible();
  await expect(page.getByText("Peça ao dono para cadastrar em Equipe.")).toBeVisible();
  await page.getByRole("button", { name: "Entrar com e-mail e senha" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Entrar no painel" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Entrar com o PIN" })).toBeVisible();
});

test("navegador sem WebCrypto não vira aparelho da casa", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window.crypto, "subtle", { get: () => undefined }));
  await open(page, "/admin/aparelho?mock=normal");
  await expect(page.getByRole("heading", { name: "Este navegador não serve como aparelho da casa" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tentar de novo" })).toBeVisible();
});
