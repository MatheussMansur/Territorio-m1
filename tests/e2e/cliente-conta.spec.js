// A conta do cliente: /entrar com o código do WhatsApp e o Google (retorno de exemplo), "Minhas
// reservas" (ver, cancelar, mudar, sair da fila) e "Meus dados" (perfil, número, baixar,
// apagar). Histórias 7.8 a 7.13.
import { NOW, bookOne, consent, force, open, patchDb, seriousBothThemes, expect, test } from "./cliente-helpers.js";

test.describe.configure({ timeout: 90_000 });
test.beforeEach(async ({ page }) => consent(page));

async function signIn(page, phone = "45988121212", { remember = true } = {}) {
  await open(page, `/entrar/?mock=normal&${NOW}`);
  await page.locator("#entrar-tel").fill(phone);
  if (!remember) await page.getByLabel("Lembrar este aparelho por 90 dias").uncheck();
  await page.getByRole("button", { name: "Receber código no WhatsApp" }).click();
  await page.locator(".otp__input").fill("123456");
  await page.waitForURL(/\/minhas-reservas\//);
  await page.waitForSelector("html[data-ready]");
}

test("entrar pelo código do WhatsApp, ver as reservas e sair", async ({ page }) => {
  await open(page, `/minhas-reservas/?mock=normal&${NOW}`);
  await expect(page.getByRole("heading", { name: "Entre para continuar" })).toBeVisible();
  await page.getByRole("link", { name: "Entrar" }).last().click();
  await page.waitForSelector("html[data-ready]");
  await expect(page.getByRole("heading", { name: "Entrar com o WhatsApp" })).toBeVisible();
  expect(await seriousBothThemes(page)).toEqual([]);
  await page.locator("#entrar-tel").fill("45988121212");
  await page.getByRole("button", { name: "Receber código no WhatsApp" }).click();
  await page.locator(".otp__input").fill("123456");
  await page.waitForURL(/\/minhas-reservas\//);
  await expect(page.getByText("Nenhuma reserva por enquanto.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Fazer uma reserva" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Sair" }).click();
  await page.waitForURL(/\/entrar\//);
});

test("lembrar este aparelho: sem marcar, a entrada acaba com o navegador", async ({ page, context }) => {
  await signIn(page, "45988131313", { remember: false });
  await expect(page.getByRole("tab", { name: "Reservas" })).toBeVisible();
  const other = await context.newPage(); // uma aba nova tem um sessionStorage novo, como um navegador fechado
  await consent(other);
  await open(other, `/minhas-reservas/?mock=normal&${NOW}`);
  await expect(other.getByRole("heading", { name: /Entre para continuar|Você saiu da conta/ })).toBeVisible();
});

test("entrar: o mesmo campo do WhatsApp (Confere? e país de fora) e os limites do código", async ({ page }) => {
  await open(page, `/entrar/?mock=normal&${NOW}`);
  await page.locator(".phone select").selectOption("PY");
  await page.locator("#entrar-tel").fill("0983 123456");
  await page.getByRole("button", { name: "Receber código no WhatsApp" }).click();
  await expect(page.locator(".phone__confere")).toContainText("Confere? +595 983 123 456");
  await page.getByRole("button", { name: "Sim, é esse" }).click();
  await page.getByRole("button", { name: "Receber código no WhatsApp" }).click();
  await expect(page.locator(".otp__input")).toBeVisible();
  await expect(page.getByRole("button", { name: /Mandar de novo em \d+s/ })).toBeDisabled();
  await expect(page.getByText(/Já já dá para pedir outro/)).toBeVisible();
  await page.getByRole("button", { name: "Mudar o número" }).click();
  await page.locator("#entrar-tel").fill("+1 415 555 0100");
  await page.getByRole("button", { name: "Receber código no WhatsApp" }).click();
  await expect(page.locator(".field[data-phone]")).toContainText("Por aqui, só números do Brasil, Paraguai e Argentina");
  await expect(page.getByRole("link", { name: "Reservar pelo WhatsApp da casa" })).toHaveAttribute("href", /wa\.me/);
});

test("entrar com o Google: volta de exemplo, conta nova pede o WhatsApp, erro oferece tentar de novo", async ({ page }) => {
  await open(page, `/entrar/?mock=normal&${NOW}`);
  await patchDb(page, (db) => (db.booking.google_login = true));
  await page.getByRole("link", { name: "Entrar com o Google" }).click();
  await page.waitForSelector("html[data-ready]");
  await page.getByRole("button", { name: "Cancelou no Google" }).click();
  await page.waitForURL(/auth_error=/);
  await page.waitForSelector("html[data-ready]");
  await expect(page.locator("[data-aviso=google_failed]")).toContainText("Não deu para entrar com o Google");
  await expect(page.locator("#entrar-tel")).toBeVisible(); // o código ainda está lá

  await page.getByRole("link", { name: "Entrar com o Google" }).click();
  await page.waitForSelector("html[data-ready]");
  await page.getByRole("button", { name: "Conta nova, sem WhatsApp" }).click();
  await page.waitForURL(/needs_phone=1/);
  await page.waitForSelector("html[data-ready]");
  await expect(page.locator("[data-aviso=google_needs_phone]").first()).toContainText("Falta só o seu WhatsApp");
  await page.getByRole("link", { name: "Receber código" }).click();
  await page.waitForSelector("html[data-ready]");
  await page.locator("#entrar-tel").fill("45988141414");
  await page.getByRole("button", { name: "Receber código no WhatsApp" }).click();
  await page.locator(".otp__input").fill("123456");
  await page.waitForURL(/\/minhas-reservas\//);
  await page.getByRole("tab", { name: "Meus dados" }).click();
  await expect(page.getByText(/Seu WhatsApp: \(45\) 9••••-1414/)).toBeVisible();
});

test("no navegador do Instagram, Google não aparece: o passo a passo e copiar o link", async ({ browser }) => {
  const context = await browser.newContext({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Instagram 300.0.0" });
  const page = await context.newPage();
  await consent(page);
  await open(page, `/entrar/?mock=normal&${NOW}`);
  await patchDb(page, (db) => (db.booking.google_login = true));
  await expect(page.getByRole("link", { name: "Entrar com o Google" })).toHaveCount(0);
  await expect(page.locator("[data-aviso=google_in_app_browser]")).toContainText("Para entrar com o Google, abra no navegador");
  await expect(page.getByRole("button", { name: "Copiar o link" })).toBeVisible();
  await expect(page.locator("#entrar-tel")).toBeVisible();
  await context.close();
});

test("minhas reservas: status em texto, prazo copiado na reserva e cancelar dentro do prazo", async ({ page }) => {
  const { code } = await bookOne(page);
  // a casa muda o prazo depois da reserva: a reserva fica com o que tinha (AR-29)
  await patchDb(page, (db) => (db.booking.cancel_until_hours = 6));
  await open(page, `/minhas-reservas/?mock=normal&${NOW}`);
  const item = page.locator(`#reserva-${code}`);
  await expect(item).toContainText("Confirmada");
  await expect(item).toContainText(/Cancelar sem custo até \d\d:\d\d/);
  const time = await item.locator(".lista-reservas__quando").textContent();
  const [, hh, mm] = time.match(/(\d\d):(\d\d)/);
  await expect(item).toContainText(`até ${String(Number(hh) - 2).padStart(2, "0")}:${mm}`);
  await expect(item.getByRole("link", { name: "Ver o comprovante" })).toHaveAttribute("href", /\/r\/\?t=/);
  expect(await seriousBothThemes(page)).toEqual([]);
  await item.getByRole("button", { name: "Cancelar reserva" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancelar reserva" }).click();
  await expect(page.getByText(`Reserva ${code} cancelada`)).toBeVisible();
  await expect(page.locator(".lista-reservas").last()).toContainText("Cancelada");
});

test("cancelar depois do prazo: em cima da hora quando a casa deixa, outside_cancel_window quando não", async ({ page }) => {
  const { code } = await bookOne(page);
  await open(page, `/minhas-reservas/?mock=normal&agora=2026-10-14T19:30`);
  const item = page.locator(`#reserva-${code}`);
  await expect(item).toContainText("O prazo para cancelar passou");
  await patchDb(page, (db) => (db.booking.customer_can_cancel_late = false));
  await item.getByRole("button", { name: "Cancelar reserva" }).click();
  await expect(page.locator("[data-aviso=outside_cancel_window]")).toContainText("Passou o prazo para cancelar por aqui");
  await patchDb(page, (db) => (db.booking.customer_can_cancel_late = true));
  await page.locator(`#reserva-${code}`).getByRole("button", { name: "Cancelar reserva" }).click();
  await expect(page.getByRole("dialog")).toContainText("em cima da hora");
  await page.getByRole("dialog").getByRole("button", { name: "Cancelar reserva" }).click();
  await expect(page.getByText("contou como em cima da hora")).toBeVisible();
});

test("prazo inclusivo: às 19:00:00 a reserva das 21:00 ainda cancela sem custo; às 19:00:01 já é em cima da hora (N7)", async ({ page }) => {
  const { code } = await bookOne(page, { time: "21:00", name: "Prazo Exato", phone: "45988717171" });
  await open(page, "/minhas-reservas/?mock=normal&agora=2026-10-14T19:00:01");
  await expect(page.locator(`#reserva-${code}`)).toContainText("O prazo para cancelar passou");
  // o relógio do celular também fica parado, então o "agora" da página é o 19:00:00 do servidor enquanto a pessoa lê
  await page.clock.setFixedTime(new Date("2026-10-14T19:00:00-03:00"));
  await open(page, "/minhas-reservas/?mock=normal&agora=2026-10-14T19:00:00");
  const item = page.locator(`#reserva-${code}`);
  await expect(item).toContainText("Cancelar sem custo até 19:00");
  await item.getByRole("button", { name: "Cancelar reserva" }).click();
  await expect(page.getByRole("dialog")).not.toContainText("em cima da hora");
  await page.getByRole("dialog").getByRole("button", { name: "Cancelar reserva" }).click();
  await expect(page.getByText(`Reserva ${code} cancelada`)).toBeVisible();
  const late = await page.evaluate((c) => JSON.parse(localStorage.getItem("territorio:mock-db")).reservations.find((r) => r.code === c).canceled_late, code);
  expect(late).toBe(false);
});

test("equipe e cliente cancelando juntos: só um grava, o outro vê invalid_transition", async ({ page }) => {
  const { code } = await bookOne(page);
  const answers = await page.evaluate(async (c) => {
    const call = () => fetch(`/api/v1/reservations/mine/${c}/cancel`, { method: "POST", headers: { "X-CSRF-Token": "mock-csrf" } }).then((r) => r.status);
    return Promise.all([call(), call()]);
  }, code);
  expect(answers.sort()).toEqual([200, 409]);
  const messages = await page.evaluate((c) => JSON.parse(localStorage.getItem("territorio:mock-db")).reservations.find((r) => r.code === c).messages.filter((m) => m.template === "booking_canceled").length, code);
  expect(messages).toBe(1);
});

test("mudar pessoas, dia e horário: o mesmo código TR; horário que lotou deixa a antiga valendo", async ({ page }) => {
  const { code } = await bookOne(page);
  await open(page, `/minhas-reservas/?mock=normal&${NOW}`);
  const item = page.locator(`#reserva-${code}`);
  await item.getByRole("button", { name: "Mudar" }).click();
  const edit = item.locator("[data-mudar]");
  await edit.getByRole("radio", { name: "3 pessoas" }).click();
  await edit.locator('.day:not(.is-closed):not(.is-full)').nth(1).click();
  await edit.locator('.slot:not(.is-full)[aria-disabled="false"]').first().click();
  await force(page, "lotou");
  await edit.getByRole("button", { name: "Salvar a mudança" }).click();
  await expect(edit.locator("[data-aviso=slot_full]")).toBeVisible();
  await expect(item).toContainText("2 pessoas"); // a antiga ainda vale
  await edit.locator('.slot:not(.is-full)[aria-disabled="false"]').first().click();
  await edit.getByRole("button", { name: "Salvar a mudança" }).click();
  await expect(page.getByText(new RegExp(`Pronto: a reserva ${code} agora é`))).toBeVisible();
  await expect(page.locator(`#reserva-${code}`)).toContainText("3 pessoas");
  // 9 ou mais vai para o caminho de grupo grande
  await page.locator(`#reserva-${code}`).getByRole("button", { name: "Mudar" }).click();
  await page.locator(`#reserva-${code} [data-mudar]`).getByRole("radio", { name: "9 ou mais" }).click();
  await expect(page.locator("[data-aviso=party_too_large]")).toContainText("Grupo grande a casa monta com você");
});

test("mudar fora do prazo ou com a remarcação desligada: conflict.reschedule com o WhatsApp", async ({ page }) => {
  const { code } = await bookOne(page);
  await patchDb(page, (db) => (db.settings.booking.data.customer_can_reschedule = false));
  await open(page, `/minhas-reservas/?mock=normal&${NOW}`);
  await expect(page.locator(`#reserva-${code}`).getByRole("button", { name: "Mudar" })).toHaveCount(0);
  await expect(page.locator(`#reserva-${code}`).getByRole("link", { name: "Mudar pelo WhatsApp" })).toHaveAttribute("href", /wa\.me/);
  const status = await page.evaluate(async (c) => {
    const r = await fetch(`/api/v1/reservations/mine/${c}/reschedule`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": "mock-csrf" }, body: JSON.stringify({ party_size: 3 }) });
    return { status: r.status, body: await r.json() };
  }, code);
  expect(status.status).toBe(409);
  expect(status.body.reason).toBe("reschedule");
});

test("meus dados: nome, e-mail, língua e novidades (desmarcado, à parte), com erro no campo", async ({ page }) => {
  await signIn(page);
  await page.getByRole("tab", { name: "Meus dados" }).click();
  await expect(page.getByLabel("Quero receber as novidades da casa")).not.toBeChecked();
  await page.getByLabel("Nome").fill("L");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByLabel("Nome")).toBeFocused();
  await page.getByLabel("Nome").fill("Lúcia Faria");
  await page.getByLabel("E-mail (opcional)").fill("lucia@exemplo.com");
  await page.getByLabel("Língua das mensagens").selectOption("es");
  await page.getByLabel("Quero receber as novidades da casa").check();
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Dados salvos.")).toBeVisible();
  expect(await seriousBothThemes(page)).toEqual([]);
  await page.reload();
  await page.waitForSelector("html[data-ready]");
  await expect(page.getByLabel("Língua das mensagens")).toHaveValue("es");
});

test("trocar o número: código no número novo; número de outra conta mostra phone_in_use", async ({ page }) => {
  await bookOne(page, { phone: "45988151515", name: "Outra Pessoa" });
  await page.evaluate(() => fetch("/api/v1/auth/logout", { method: "POST" }));
  await signIn(page, "45988161616");
  await page.getByRole("tab", { name: "Meus dados" }).click();
  await page.getByRole("button", { name: "Trocar o número" }).click();
  await page.locator("#novo-tel").fill("45988151515");
  await page.getByRole("button", { name: "Receber código no WhatsApp" }).click();
  await page.locator("#novo-codigo").fill("123456");
  await expect(page.locator("[data-aviso=phone_in_use]")).toContainText("Esse número já está em outra conta");
  await page.getByRole("button", { name: "Mudar o número" }).click();
  await page.locator("#novo-tel").fill("45988171717");
  await page.getByRole("button", { name: "Receber código no WhatsApp" }).click();
  await page.locator("#novo-codigo").fill("123456");
  await expect(page.getByText(/Número trocado: \(45\) 9••••-1717/)).toBeVisible();
});

test("baixar meus dados (JSON e versão para ler) e a falha no meio", async ({ page }) => {
  await bookOne(page);
  await open(page, `/minhas-reservas/?mock=normal&${NOW}#dados`);
  const files = [];
  page.on("download", (d) => files.push(d.suggestedFilename()));
  await page.getByRole("button", { name: "Baixar meus dados" }).click();
  await expect(page.getByText("Pronto: dois arquivos")).toBeVisible();
  await expect.poll(() => files.length).toBe(2);
  expect(files.some((f) => f.endsWith(".json"))).toBe(true);
  expect(files.some((f) => f.endsWith(".txt"))).toBe(true);
  await force(page, "download");
  await page.getByRole("button", { name: "Baixar meus dados" }).click();
  await expect(page.locator("[data-aviso=download_failed]")).toContainText("O arquivo não baixou");
});

test("apagar meus dados: avisa das reservas e da fila, cancela e diz quando chega a confirmação", async ({ page }) => {
  const { code } = await bookOne(page);
  await open(page, `/minhas-reservas/?mock=normal&${NOW}#dados`);
  await page.getByRole("button", { name: "Apagar meus dados" }).click();
  await expect(page.getByRole("dialog")).toContainText("Suas 1 reservas futuras serão canceladas agora.");
  await page.getByRole("dialog").getByRole("button", { name: "Apagar meus dados" }).click();
  await expect(page.getByRole("heading", { name: "Pedido recebido" })).toBeVisible();
  await expect(page.getByText(/A casa apaga seus dados até .*\d\d\/\d\d/)).toBeVisible();
  const db = await page.evaluate(() => JSON.parse(localStorage.getItem("territorio:mock-db")));
  expect(db.reservations.find((r) => r.code === code).status).toBe("canceled");
  expect(db.privacy_requests.at(-1)).toMatchObject({ kind: "deletion", channel: "account", status: "open" });
});

test("sair da lista de espera por Minhas reservas", async ({ page }) => {
  await open(page, `/reservar/?mock=normal&${NOW}`);
  await page.locator('.slot.is-full[aria-disabled="false"]').first().click();
  await page.locator("#reserva-nome").fill("Nina Couto");
  await page.locator("#reserva-tel").fill("45988181818");
  await page.locator("input[name=combinado]").check();
  await page.getByRole("button", { name: "Receber código no WhatsApp" }).click();
  await page.locator(".otp__input").fill("123456");
  await expect(page.locator(".receipt")).toContainText("na lista de espera");
  await open(page, `/minhas-reservas/?mock=normal&${NOW}`);
  await expect(page.locator(".lista-reservas").first()).toContainText("Lista de espera");
  await page.getByRole("button", { name: "Sair da fila" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Sair da fila" }).click();
  await expect(page.getByText("Você saiu da lista de espera.")).toBeVisible();
});
