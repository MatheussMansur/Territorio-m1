// O cliente reserva sozinho na API da casa (mock): pessoas, dia, horário, dados, o código do
// WhatsApp, o comprovante; depois o link do comprovante. Histórias 7.1 a 7.7 e os bugs 1 a 4 da reserva.
import { NOW, bookOne, choose, consent, contentRight, expect, fillAndBook, force, open, patchDb, serious, seriousBothThemes, test } from "./cliente-helpers.js";

test.describe.configure({ timeout: 90_000 });
test.beforeEach(async ({ page }) => consent(page));

/** Dados preenchidos e o código pedido; a página espera na tela do código. */
async function untilCode(page, { name, phone }) {
  await page.locator("#reserva-nome").fill(name);
  await page.locator("#reserva-tel").fill(phone);
  await page.locator("input[name=combinado]").check();
  await page.getByRole("button", { name: "Receber código no WhatsApp" }).click();
  await expect(page.locator(".otp__input")).toBeVisible();
}

test("reserva do começo ao fim, com código no WhatsApp, e o comprovante cancela", async ({ page }) => {
  await choose(page);
  await expect(page.locator(".summary")).toContainText("2 pessoas");
  await page.locator("#reserva-nome").fill("Ana Souza");
  await page.locator("#reserva-tel").fill("45988887766");
  await page.locator(".reserva__mais summary").click();
  await page.getByLabel("Aniversário").check();

  // sem concordar, os combinados da casa param a reserva
  await page.getByRole("button", { name: "Receber código no WhatsApp" }).click();
  await expect(page.getByRole("alert")).toContainText("tá combinado");
  await page.locator("input[name=combinado]").check();
  await page.getByRole("button", { name: "Receber código no WhatsApp" }).click();

  await expect(page.getByText("Mandamos um código")).toBeVisible();
  await expect(page.locator(".otp__input")).toHaveAttribute("autocomplete", "one-time-code");
  await expect(page.locator(".otp__input")).toHaveAttribute("inputmode", "numeric");
  await page.locator(".otp__input").fill("000000");
  await expect(page.getByRole("alert")).toContainText("Código não confere");
  await expect(page.getByRole("alert")).toContainText("Restam 4 tentativas");
  await page.locator(".otp__input").fill("123456");

  await expect(page.locator(".receipt__code")).toHaveText(/^TR-\d+$/);
  await expect(page.locator(".receipt")).toContainText("Pode entrar, Ana!");
  await expect(page.locator(".receipt")).toContainText(/A mesa te espera até \d\d:\d\d/);
  await expect(page.getByText(/Use o código TR-\d+ se falar com a casa/)).toBeVisible();
  await expect(page.locator(".reserva__pronto")).not.toContainText(/tolerância/i);
  for (const action of ["Pôr na agenda", "Compartilhar", "Como chegar"]) await expect(page.getByRole("button", { name: action })).toBeVisible();
  await expect(page.locator(".recibo__acoes").getByRole("link", { name: "Minhas reservas" })).toBeVisible();
  expect(await seriousBothThemes(page)).toEqual([]);

  await page.locator(`.reserva__pronto a[href*="/r/?t="]`).first().click();
  await page.waitForSelector("html[data-ready]");
  await expect(page.locator(".receipt__code")).toHaveText(/^TR-\d+$/);
  await expect(page.locator("main")).not.toContainText(/tolerância/i);
  // "Vou atrasar um pouco": a mesa espera os minutos extras dos ajustes
  await page.getByRole("button", { name: "Vou atrasar um pouco" }).click();
  await expect(page.getByText(/Avisado\. A mesa espera você até as \d\d:\d\d\./)).toBeVisible();
  await expect(page.getByRole("button", { name: "Vou atrasar um pouco" })).toHaveCount(0);
  await page.getByRole("button", { name: "Cancelar reserva" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancelar reserva" }).click();
  await expect(page.locator(".receipt")).toContainText("Cancelada");
  await expect(page.getByRole("button", { name: "Cancelar reserva" })).toHaveCount(0);
});

test("comprovante: agenda (.ics no fuso da casa), como chegar, e falha ao baixar", async ({ page }) => {
  await bookOne(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Pôr na agenda" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^territorio-TR-\d+\.ics$/);
  const chunks = [];
  for await (const chunk of await file.createReadStream()) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString()).toMatch(/DTSTART;TZID=America\/Sao_Paulo:2026101\dT\d{4}00/);
  await page.getByRole("button", { name: "Como chegar" }).click();
  await expect(page.getByRole("link", { name: "Waze" })).toHaveAttribute("href", /waze\.com/);
  await expect(page.getByRole("link", { name: "Google Maps" })).toHaveAttribute("href", /google\.com\/maps/);
  await force(page, "ics");
  await page.getByRole("button", { name: "Pôr na agenda" }).click();
  await expect(page.locator("[data-aviso=download_failed]")).toContainText("O arquivo não baixou");
});

test("com a sessão aberta, a segunda reserva no mesmo horário não pede código e mostra a que já existe", async ({ page }) => {
  const time = await choose(page, { date: "2026-10-14" });
  await fillAndBook(page, { name: "Bruno Lima", phone: "45988112233" });
  await expect(page.locator(".receipt__code")).toBeVisible();

  await choose(page, { time, date: "2026-10-14" });
  await expect(page.getByText("Você entrou com o WhatsApp")).toBeVisible();
  await page.locator("input[name=combinado]").check();
  await page.getByRole("button", { name: /Confirmar reserva|Entrar na lista de espera/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Você já tem reserva nesse horário");
  await page.getByRole("dialog").getByRole("button", { name: "Voltar" }).click();
  await expect(page.locator("[data-aviso=duplicate_reservation]").getByRole("link", { name: "Ver minha reserva" })).toHaveAttribute("href", /\/r\/\?t=/);
});

test("já abre com 2 pessoas, a janela inteira em semanas e o primeiro dia com mesa escolhido", async ({ page }) => {
  await open(page, `/reservar/?mock=normal&${NOW}`);
  await expect(page.getByRole("radio", { name: "2 pessoas" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".calendario__grade .day")).toHaveCount(30); // a janela, não 14 dias (bug 2)
  await expect(page.locator(".calendario__semana span")).toHaveCount(7);
  await expect(page.locator('.day[aria-checked="true"]')).toHaveCount(1);
  await expect(page.locator(".slot").first()).toBeVisible();
  await expect(page.getByRole("radio", { name: "9 ou mais" })).toBeVisible();
  await expect(page.locator(".day.is-closed").first()).toHaveAttribute("aria-label", /produção|fechado|evento/);
  await page.setViewportSize({ width: 360, height: 740 });
  await expect.poll(() => contentRight(page)).toBeLessThanOrEqual(360);
});

test("?pessoas=4 e ?dia= dentro da janela vêm escolhidos; dia fechado diz o motivo; data ruim é ignorada", async ({ page }) => {
  await open(page, `/reservar/?mock=normal&${NOW}&pessoas=4&dia=2026-10-16`);
  await expect(page.getByRole("radio", { name: "4 pessoas" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator('.day[aria-checked="true"]')).toHaveAttribute("data-value", "2026-10-16");
  await open(page, `/reservar/?mock=normal&${NOW}&dia=2026-10-19`); // uma segunda-feira: produção
  await expect(page.getByRole("status").filter({ hasText: "a casa não abre" })).toContainText("produção");
  await expect(page.locator('.day[aria-checked="true"]')).toHaveCount(1);
  await open(page, `/reservar/?mock=normal&${NOW}&dia=2027-99-99`);
  await expect(page.locator('.day[aria-checked="true"]')).toHaveAttribute("data-value", "2026-10-14");
});

test("lembrar de mim: a próxima reserva já vem com nome, WhatsApp e o grupo de costume", async ({ page }) => {
  await open(page, `/reservar/?mock=normal&${NOW}`);
  await page.getByRole("radio", { name: "3 pessoas" }).click();
  await page.locator('.slot:not(.is-full)[aria-disabled="false"]').first().click();
  await page.locator("#reserva-nome").fill("Carla Dias");
  await page.locator("#reserva-tel").fill("45988445566");
  await page.locator("input[name=lembrar]").check();
  await page.locator("input[name=combinado]").check();
  await page.getByRole("button", { name: "Receber código no WhatsApp" }).click();
  await page.locator(".otp__input").fill("123456");
  await expect(page.locator(".receipt__code")).toBeVisible();

  await page.evaluate(() => fetch("/api/v1/auth/logout", { method: "POST" }));
  await open(page, `/reservar/?mock=normal&${NOW}`);
  await expect(page.getByRole("radio", { name: "3 pessoas" })).toHaveAttribute("aria-checked", "true");
  await page.locator('.slot:not(.is-full)[aria-disabled="false"]').first().click();
  await expect(page.locator("#reserva-nome")).toHaveValue("Carla Dias");
  await expect(page.locator("#reserva-tel")).toHaveValue("(45) 98844-5566");
});

test("horário lotado vira lista de espera, com a posição no comprovante", async ({ page }) => {
  await open(page, `/reservar/?mock=normal&${NOW}`);
  const full = page.locator('.slot.is-full[aria-disabled="false"]').first();
  await expect(full).toBeVisible();
  await full.click();
  await expect(page.getByText("Você entra na lista de espera")).toBeVisible();
  await expect(page.locator(".summary")).toContainText("Lista de espera");
  await fillAndBook(page, { name: "Dora Lins", phone: "45988001122" });
  await expect(page.locator(".receipt")).toContainText(/\dº na lista de espera/);
});

test("9 ou mais pelo WhatsApp: mensagem pronta na língua da página, sem código e sem reserva", async ({ page }) => {
  await open(page, `/reservar/?mock=normal&${NOW}`);
  await patchDb(page, (db) => (db.booking.large_group_action = "whatsapp"));
  await page.getByRole("radio", { name: "9 ou mais" }).click();
  await page.locator("#reserva-grupo-n").fill("12");
  const link = page.locator("[data-grupo-whatsapp]");
  const message = async () => decodeURIComponent((await link.getAttribute("href")).split("text=")[1]);
  await expect(link).toHaveAttribute("href", /wa\.me\/\d+\?text=/);
  expect(await message()).toBe("Oi! Queria uma mesa para 12 pessoas.");
  await page.locator("#grupo-nome").fill("Rafael Souza");
  await page.locator("#grupo-dia").selectOption({ index: 2 });
  await page.locator("#grupo-hora").selectOption("20:00");
  expect(await message()).toMatch(/^Oi! Meu nome é Rafael\. Queria uma mesa para 12 pessoas em \p{L}+, \d\d\/\d\d, às 20:00\.$/u);
  await expect(page.getByText("A casa responde por lá e monta a mesa com você.")).toBeVisible();
  await expect(page.locator(".otp__input, #reserva-tel")).toHaveCount(0);
  expect(await serious(page)).toEqual([]);

  await page.evaluate(() => sessionStorage.clear());
  await open(page, `/es/reservar/?mock=normal&${NOW}`);
  await page.getByRole("radio", { name: "9 o más" }).click();
  await page.locator("#reserva-grupo-n").fill("10");
  expect(decodeURIComponent((await page.locator("[data-grupo-whatsapp]").getAttribute("href")).split("text=")[1])).toBe("¡Hola! Quería una mesa para 10 personas.");
});

test("9 ou mais como pedido: segue como reserva comum e nasce pendente com o prazo da casa", async ({ page }) => {
  await open(page, `/reservar/?mock=normal&${NOW}`);
  await page.getByRole("radio", { name: "9 ou mais" }).click(); // o caminho da semente: um pedido
  await page.locator("#reserva-grupo-n").fill("11");
  await page.locator('.slot[aria-disabled="false"]').first().click();
  await fillAndBook(page, { name: "Gustavo Reis", phone: "45988223344" });
  await expect(page.locator(".receipt")).toContainText("11 pessoas");
  await expect(page.locator(".receipt")).toContainText(/A casa confirma até \d\d:\d\d/);
});

test("Turnstile: o código leva o token; recusado, tenta de novo sem perder nada", async ({ page }) => {
  await choose(page);
  await page.locator("#reserva-nome").fill("Elisa Prado");
  await page.locator("#reserva-tel").fill("45988334455");
  await page.locator("input[name=combinado]").check();
  await force(page, "turnstile");
  const sent = page.waitForRequest((r) => r.url().includes("/auth/otp"));
  await page.getByRole("button", { name: "Receber código no WhatsApp" }).click();
  expect((await sent).postDataJSON().turnstile_token).toBe("XXXX.DUMMY.TOKEN.XXXX");
  const notice = page.locator("[data-aviso=turnstile_failed]");
  await expect(notice).toContainText("Precisamos conferir de novo");
  await notice.getByRole("button", { name: "Tentar de novo" }).click();
  await expect(page.locator(".otp__input")).toBeVisible();
  await expect(page.locator("#reserva-nome")).toHaveValue("Elisa Prado");
  const booked = page.waitForRequest((r) => r.url().endsWith("/api/v1/reservations") && r.method() === "POST");
  await page.locator(".otp__input").fill("123456");
  expect((await booked).postDataJSON().turnstile_token).toBe("XXXX.DUMMY.TOKEN.XXXX");
});

test("telefone: +54 e +595 corrigidos com Confere?, e país de fora com o WhatsApp da casa", async ({ page }) => {
  await choose(page);
  await page.locator("#reserva-nome").fill("Martín Gómez");
  await page.locator(".phone select").selectOption("AR");
  await page.locator("#reserva-tel").fill("3757 15-12-3456");
  await page.locator("#reserva-nome").focus();
  await expect(page.locator("#reserva-tel")).toHaveValue("+54 9 3757 12-3456");
  await expect(page.locator(".phone__confere")).toContainText("Confere?");
  await page.locator("input[name=combinado]").check();
  await page.getByRole("button", { name: "Receber código no WhatsApp" }).click();
  await expect(page.locator(".otp__input")).toHaveCount(0); // o código espera o sim
  await page.getByRole("button", { name: "Sim, é esse" }).click();
  const sent = page.waitForRequest((r) => r.url().includes("/auth/otp"));
  await page.getByRole("button", { name: "Receber código no WhatsApp" }).click();
  expect((await sent).postDataJSON().phone).toBe("+5493757123456");
  await page.getByRole("button", { name: "Mudar o número" }).click();

  await page.locator(".phone select").selectOption("PY");
  await page.locator("#reserva-tel").fill("0983 123456");
  await page.locator("#reserva-nome").focus();
  await expect(page.locator("#reserva-tel")).toHaveValue("+595 983 123 456");
  await expect(page.locator(".phone__confere")).toBeVisible();

  await page.locator("#reserva-tel").fill("+34 612 345 678");
  await page.locator("#reserva-nome").focus();
  await expect(page.locator(".field[data-phone]")).toContainText("Por aqui, só números do Brasil, Paraguai e Argentina");
  const wa = page.getByRole("link", { name: "Reservar pelo WhatsApp da casa" });
  expect(decodeURIComponent(await wa.getAttribute("href"))).toMatch(/Meu nome é Martín\. Queria uma mesa para 2 pessoas em .*, às \d\d:\d\d\./);
  await expect(page.locator("#reserva-nome")).toHaveValue("Martín Gómez");
});

test("restrição alimentar: o aviso de dado de saúde aparece ligado ao marcador e some ao desmarcar", async ({ page }) => {
  await choose(page);
  await page.locator(".reserva__mais summary").click();
  const box = page.getByLabel("Restrição alimentar");
  await box.check();
  const notice = page.locator("#aviso-dieta");
  await expect(notice).toContainText("Restrição alimentar é um dado de saúde. Só quem atende a sua mesa vê, e apagamos 30 dias depois da visita.");
  await expect(box).toHaveAttribute("aria-describedby", "aviso-dieta");
  await expect(notice.getByRole("link")).toHaveAttribute("href", "/privacidade/");
  expect(await serious(page)).toEqual([]);
  await box.uncheck();
  await expect(notice).toHaveCount(0);
});

test("observação: 280 passa, 281 mostra 281/280 sem cortar, link não entra (bug 3)", async ({ page }) => {
  await choose(page);
  await page.locator(".reserva__mais summary").click();
  const notes = page.locator("#reserva-obs");
  await notes.fill("🎂".repeat(280));
  await expect(page.locator(".reserva__contador")).toHaveText("280/280");
  await notes.fill("a".repeat(281));
  await expect(page.locator(".reserva__contador")).toHaveText("281/280");
  await expect(notes).toHaveValue("a".repeat(281)); // nada cortado
  await page.locator("#reserva-nome").fill("Flávia Ramos");
  await page.locator("#reserva-tel").fill("45988556677");
  await page.locator("input[name=combinado]").check();
  await page.getByRole("button", { name: "Receber código no WhatsApp" }).click();
  await expect(page.locator(".reserva__mais .field")).toContainText("281/280");
  await expect(page.locator(".otp__input")).toHaveCount(0);
  await notes.fill("veja www.exemplo.com");
  await page.getByRole("button", { name: "Receber código no WhatsApp" }).click();
  await expect(page.locator(".reserva__mais .field")).toContainText("links");
});

test("rascunho: quem sai para o WhatsApp e volta (mesmo recarregando) encontra tudo e a tela do código", async ({ page }) => {
  await choose(page);
  await untilCode(page, { name: "Gabi Torres", phone: "45988667788" });
  await page.reload();
  await page.waitForSelector("html[data-ready]");
  await expect(page.locator(".otp__input")).toBeVisible();
  await expect(page.locator("#reserva-nome")).toHaveValue("Gabi Torres");
  await expect(page.locator("input[name=combinado]")).toBeChecked();
  await page.locator(".otp__input").fill("123456");
  await expect(page.locator(".receipt__code")).toBeVisible();
});

test("horário que lotou no caminho: alternativas e espera, dados preservados", async ({ page }) => {
  await choose(page);
  await page.locator(".reserva__mais summary").click();
  await page.getByLabel("Aniversário").check();
  await page.locator("#reserva-obs").fill("Mesa perto da janela");
  await untilCode(page, { name: "Heitor Melo", phone: "45988778899" });
  await force(page, "lotou");
  await page.locator(".otp__input").fill("123456");
  await expect(page.locator("[data-aviso=slot_full]")).toContainText("Esse horário acabou de lotar");
  await page.locator(".reserva__alternativas button").first().click();
  await expect(page.locator("#reserva-nome")).toHaveValue("Heitor Melo");
  await expect(page.locator("#reserva-obs")).toHaveValue("Mesa perto da janela");
  await expect(page.getByLabel("Aniversário")).toBeChecked();
  await expect(page.locator("input[name=combinado]")).toBeChecked();
  await page.getByRole("button", { name: "Confirmar reserva" }).click();
  await expect(page.locator(".receipt__code")).toBeVisible();
});

test("horário que fechou (antecedência) e dia que a casa fechou: a frase certa e os dados ficam", async ({ page }) => {
  await choose(page);
  await untilCode(page, { name: "Iara Nunes", phone: "45988889900" });
  await force(page, "cutoff");
  await page.locator(".otp__input").fill("123456");
  await expect(page.locator("[data-aviso='slot_full.cutoff']")).toContainText("Esse horário já fechou para reserva online");
  await page.locator('.slot:not(.is-full)[aria-disabled="false"]').first().click();
  await expect(page.locator("#reserva-nome")).toHaveValue("Iara Nunes");
  await force(page, "dia_fechado");
  await page.getByRole("button", { name: "Confirmar reserva" }).click();
  await expect(page.locator("[data-aviso='slot_full.day_closed']")).toContainText("A casa fechou esse dia");
});

test("sem conexão no envio: tentar de novo reenvia com a mesma chave e não duplica (bug 1)", async ({ page }) => {
  await choose(page);
  await untilCode(page, { name: "João Pires", phone: "45988990011" });
  const keys = [];
  page.on("request", (r) => r.url().endsWith("/api/v1/reservations") && r.method() === "POST" && keys.push(r.headers()["idempotency-key"]));
  // a reserva é feita mas a resposta se perde, depois a rede cai: a página tenta uma vez sozinha
  await force(page, "perde_resposta", "rede");
  await page.locator(".otp__input").fill("123456");
  const notice = page.locator("[data-aviso=network]");
  await expect(notice).toContainText("Sem conexão");
  await expect(notice.getByRole("link", { name: "Chamar no WhatsApp" })).toHaveAttribute("href", /wa\.me/);
  await notice.getByRole("button", { name: "Tentar de novo" }).click();
  await expect(page.locator(".receipt__code")).toBeVisible();
  expect(keys.length).toBeGreaterThanOrEqual(3);
  expect(new Set(keys).size).toBe(1);
  const mine = await page.evaluate(async () => (await (await fetch("/api/v1/reservations/mine")).json()).items.length);
  expect(mine).toBe(1);
});

test("dia lotado e janela lotada têm próximo passo; casa fora do ar oferece tentar de novo e WhatsApp", async ({ page }) => {
  await open(page, `/reservar/?mock=vazio&${NOW}`);
  await expect(page.locator("[data-aviso=window_full]")).toContainText("Todos os dias abertos estão cheios");
  await expect(page.locator("[data-aviso=window_full]").getByRole("link", { name: "Instagram da casa" })).toBeVisible();

  await open(page, `/reservar/?mock=erro&${NOW}`);
  const down = page.locator("[data-aviso]").first();
  await expect(down).toContainText(/Algo deu errado do nosso lado|Sem conexão/);
  await expect(down.getByRole("button", { name: "Tentar de novo" })).toBeVisible();
  await expect(down.getByRole("link", { name: "Chamar no WhatsApp" })).toHaveAttribute("href", /wa\.me/);
});

test("dia sem mesa para o grupo: day_full com os próximos dias com mesa", async ({ page }) => {
  await open(page, `/reservar/?mock=normal&${NOW}`);
  await patchDb(page, (db) => {
    for (const r of db.reservations) if (r.date === "2026-10-14") r.status = "confirmed";
    db.day_plans = { ...(db.day_plans || {}), "2026-10-14": { open: true, max_covers_night: 1 } };
  });
  await page.locator('.day[data-value="2026-10-14"]').click();
  const notice = page.locator("[data-aviso=day_full]");
  await expect(notice).toContainText("Esse dia lotou");
  await expect(notice.getByRole("button").first()).toBeVisible();
});

test("dia 31 da janela: a simulação responde fora da janela, não lotado (bug 3)", async ({ page }) => {
  await bookOne(page);
  const answer = await page.evaluate(async () => {
    const house = await (await fetch("/api/v1/house")).json();
    const response = await fetch("/api/v1/reservations", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ party_size: 2, date: "2026-11-13", time: "20:00", name: "Teste Janela", terms_version: house.terms.version, turnstile_token: "XXXX.DUMMY.TOKEN.XXXX" }),
    });
    return { status: response.status, body: await response.json() };
  });
  expect(answer.status).toBe(422);
  expect(answer.body.errors[0].code).toBe("outside_window");
});

test("sem JavaScript, a página de reserva leva ao WhatsApp e mostra os combinados", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/reservar/");
  await expect(page.locator(".reserva a", { hasText: "WhatsApp" })).toHaveAttribute("href", /^https:\/\/wa\.me\//);
  await expect(page.locator(".reserva__combinados li")).toHaveCount(3);
  await context.close();
});

/** Publica um evento de cada modo de reserva em noites abertas da janela (a semente só tem alguns). */
async function eventsOfEachMode(page) {
  await patchDb(page, (d) => {
    const layout = d.layouts.find((l) => /Evento/.test(l.name)) || d.layouts.at(-1);
    const event = (date, title, mode) => ({
      id: `teste-${mode}`, title, date, starts_at: "20:00", ends_at: null, description: "", image_id: null, published: true,
      booking_mode: mode, list_capacity: 40, entry_times: ["20:00", "21:00"], party_max: 8, requires_approval: false, price_cents: 5000,
      layout_id: mode === "tables" ? null : layout.id, internal_note: "",
    });
    d.events.push(
      event("2026-10-23", "Noite de lista", "list"),
      event("2026-10-24", "Noite de mesas", "tables"),
      event("2026-10-28", "Roda aberta", "none"),
      event("2026-10-29", "Festa fechada", "private"),
    );
  });
}

test("evento: lista sem escolher mesa, mesas como sempre, entrada livre sem botão, privado fechado, nunca valor", async ({ page }) => {
  await open(page, `/reservar/?mock=normal&${NOW}`);
  await eventsOfEachMode(page);
  await expect(page.locator('.day[data-value="2026-10-23"]')).toContainText("Noite de lista");

  await page.locator('.day[data-value="2026-10-23"]').click();
  await expect(page.locator(".reserva__evento")).toContainText("você reserva o seu lugar, sem escolher mesa");
  await expect(page.locator(".slot").first()).toContainText("lugar na lista");
  await page.locator('.slot[aria-disabled="false"]').first().click();
  await fillAndBook(page, { name: "Lista Nunes", phone: "45988505050" });
  await expect(page.locator(".receipt")).toContainText("Lugar na lista");
  await expect(page.locator("main")).not.toContainText(/R\$|ingresso/i);

  await open(page, `/reservar/?mock=normal&${NOW}&dia=2026-10-24`);
  await expect(page.locator(".reserva__evento")).toContainText("reserva de mesa como sempre");
  await expect(page.locator(".slot").first()).toContainText(/tem mesa|últimas mesas|lotado/);

  await page.locator('.day[data-value="2026-10-28"]').click();
  await expect(page.getByRole("status").filter({ hasText: "Entrada livre" })).toBeVisible();
  await expect(page.locator(".slot")).toHaveCount(0);
  await expect(page.locator("#reserva-nome")).toHaveCount(0);

  await expect(page.locator('.day[data-value="2026-10-29"]')).toHaveAttribute("aria-disabled", "true");
  await expect(page.locator('.day[data-value="2026-10-29"]')).toHaveAttribute("aria-label", /evento/i);
});

test("evento misto: escolhe mesa ou lugar na lista, cada um com o seu limite", async ({ page }) => {
  await open(page, `/reservar/?mock=normal&${NOW}`);
  const fish = await page.evaluate(() => JSON.parse(localStorage.getItem("territorio:mock-db")).events.find((e) => e.booking_mode === "mixed" && e.published)?.date);
  test.skip(!fish, "the seed has no published mixed event");
  await page.locator(`.day[data-value="${fish}"]`).click();
  await expect(page.getByRole("radio", { name: "Mesa", exact: true })).toBeVisible();
  await page.getByRole("radio", { name: /Lista \(\d+ lugares\)/ }).click();
  await expect(page.locator(".slot").first()).toContainText(/lugar na lista|últimos lugares|lista cheia/);
});

test("limites do código: 3 por número e por hora, teto do dia da casa com o WhatsApp", async ({ page }) => {
  await choose(page);
  await untilCode(page, { name: "Limite Código", phone: "45988515151" });
  const clock = (at) => page.evaluate((a) => history.replaceState(null, "", `${location.pathname}?mock=normal&agora=2026-10-14T${a}`), at);
  for (const at of ["15:01", "15:02"]) {
    await clock(at);
    await page.getByRole("button", { name: "Mudar o número" }).click();
    await page.getByRole("button", { name: "Receber código no WhatsApp" }).click();
    await expect(page.locator(".otp__input")).toBeVisible();
  }
  await clock("15:03");
  await page.getByRole("button", { name: "Mudar o número" }).click();
  await page.getByRole("button", { name: "Receber código no WhatsApp" }).click();
  await expect(page.locator("[data-aviso='rate_limited.otp']")).toContainText("Já mandamos códigos demais");
  await page.locator("#reserva-tel").fill("45988525252");
  await force(page, "otp_casa");
  await page.getByRole("button", { name: "Receber código no WhatsApp" }).click();
  const house = page.locator("[data-aviso='rate_limited.otp_house']");
  await expect(house).toContainText("Hoje não conseguimos mandar mais códigos");
  await expect(house.getByRole("link", { name: "Chamar no WhatsApp" })).toBeVisible();
});

test("1 min sem digitar o código: otp_not_arrived com reenviar e o WhatsApp, nunca SMS", async ({ page }) => {
  await page.clock.install();
  await choose(page);
  await untilCode(page, { name: "Sem Código", phone: "45988535353" });
  await page.clock.fastForward("01:05");
  const notice = page.locator("[data-aviso=otp_not_arrived]");
  await expect(notice).toContainText("O código não chegou?");
  await expect(notice.getByRole("button", { name: "Mandar de novo" })).toBeEnabled();
  await expect(notice.getByRole("link", { name: "Chamar no WhatsApp" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(/SMS/);
});

test("combinados mudados no caminho: mostra os novos, pede o aceite e segue sem perder nada", async ({ page }) => {
  await choose(page);
  await untilCode(page, { name: "Termos Novos", phone: "45988545454" });
  await force(page, "termos");
  await page.locator(".otp__input").fill("123456");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Os combinados mudaram");
  await dialog.getByRole("button", { name: "Li e tá combinado" }).click();
  await expect(page.locator(".receipt__code")).toBeVisible();
});

test("cliente bloqueado: Vamos combinar pelo WhatsApp, nunca a palavra bloqueado", async ({ page }) => {
  await choose(page);
  await untilCode(page, { name: "Ricardo Nogueira", phone: "45999001122" }); // bloqueado na semente
  await page.locator(".otp__input").fill("123456");
  const notice = page.locator("[data-aviso=customer_blocked]");
  await expect(notice).toContainText("Vamos combinar pelo WhatsApp");
  await expect(notice.getByRole("link", { name: "Chamar no WhatsApp" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(/bloquead/i);
});

test("reserva às 00:30: o dia do calendário e a noite a que pertence, no comprovante e no .ics", async ({ page }) => {
  await open(page, `/reservar/?mock=normal&${NOW}`);
  await patchDb(page, (d) => {
    d.day_plans = { ...(d.day_plans || {}), "2026-10-15": { open: true, opens_at: "00:00", closes_at: "02:00", slots: ["00:30"] } };
  });
  await page.locator('.day[data-value="2026-10-15"]').click();
  await page.locator('.slot[data-value="00:30"]').click();
  await fillAndBook(page, { name: "Madrugada Reis", phone: "45988555555" });
  await expect(page.locator(".recibo__quando")).toContainText("quinta, 15/10, às 00:30 (noite de quarta)");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Pôr na agenda" }).click();
  const chunks = [];
  for await (const chunk of await (await download).createReadStream()) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString()).toContain("DTSTART;TZID=America/Sao_Paulo:20261015T003000");
});

test("comprovante em inglês: hora num formato só", async ({ page }) => {
  await choose(page, { path: "/en/reservar/" });
  await fillAndBook(page, { name: "Emma Stone", phone: "45988565656" });
  await expect(page.locator(".receipt")).toContainText(/\d{1,2}:\d\d pm/);
  await expect(page.locator(".receipt")).toContainText(/Your table is held until \d{1,2}:\d\d pm/);
});

// ---- eventos de cada modo, da semente (história 7.3, N12) ----

/** O evento futuro publicado da semente para um modo (a demonstração tem um de cada). */
async function seededEvent(page, mode) {
  const event = await page.evaluate((m) => {
    const db = JSON.parse(localStorage.getItem("territorio:mock-db"));
    return db.events.filter((e) => e.published && e.booking_mode === m && e.date >= "2026-10-14").sort((a, b) => a.date.localeCompare(b.date))[0] || null;
  }, mode);
  expect(event, `o seed tem um evento publicado no modo ${mode}`).not.toBeNull();
  return event;
}

test("evento do seed em modo mesas: a reserva é a normal, com o nome do evento no calendário e no comprovante", async ({ page }) => {
  await open(page, `/reservar/?mock=normal&${NOW}`);
  const event = await seededEvent(page, "tables");
  const day = page.locator(`.day[data-value="${event.date}"]`);
  await expect(day).toContainText(event.title);
  await day.click();
  await expect(page.locator(".reserva__evento")).toContainText("reserva de mesa como sempre");
  await expect(page.locator(".reserva__modo")).toHaveCount(0);
  await page.locator('.slot:not(.is-full)[aria-disabled="false"]').first().click();
  await fillAndBook(page, { name: "Mesa Evento", phone: "45988616161" });
  await expect(page.locator(".receipt")).toContainText(event.title);
  await expect(page.locator(".receipt")).toContainText("Mesa");
  await expect(page.locator("main")).not.toContainText(/R\$|ingresso/i);
});

test("evento do seed em modo lista: conta pessoas sem escolher mesa, e o comprovante diz lugar na lista", async ({ page }) => {
  await open(page, `/reservar/?mock=normal&${NOW}`);
  const event = await seededEvent(page, "list");
  await page.locator(`.day[data-value="${event.date}"]`).click();
  await expect(page.locator(".reserva__evento")).toContainText("sem escolher mesa (40 lugares)");
  await expect(page.locator(".slot").first()).toContainText("lugar na lista");
  await page.locator('.slot[aria-disabled="false"]').first().click();
  await fillAndBook(page, { name: "Lista Seed", phone: "45988626262" });
  await expect(page.locator(".receipt")).toContainText("Lugar na lista");
  await expect(page.locator("main")).not.toContainText(/R\$|ingresso/i);
});

test("evento do seed com entrada livre: diz Entrada livre e não tem botão de reservar", async ({ page }) => {
  await open(page, `/reservar/?mock=normal&${NOW}`);
  const event = await seededEvent(page, "none");
  const day = page.locator(`.day[data-value="${event.date}"]`);
  await expect(day).toContainText("Entrada livre");
  await day.click();
  await expect(page.getByRole("status").filter({ hasText: "Entrada livre" })).toContainText(event.title);
  await expect(page.locator(".slot")).toHaveCount(0);
  await expect(page.locator("#reserva-nome")).toHaveCount(0);
});

test("evento privado do seed: a data fica bloqueada com o motivo público, sem reserva pelo site", async ({ page }) => {
  await open(page, `/reservar/?mock=normal&${NOW}`);
  const event = await seededEvent(page, "private");
  const day = page.locator(`.day[data-value="${event.date}"]`);
  await expect(day).toHaveAttribute("aria-disabled", "true");
  await expect(day).toContainText("Festa fechada");
  await expect(day).not.toContainText(event.title);
});

test("evento publicado depois que a página abriu: a frase do modo do evento, não a casa fechou, e os dados ficam", async ({ page }) => {
  await choose(page);
  const date = await page.locator('.day[aria-checked="true"]').getAttribute("data-value");
  await untilCode(page, { name: "Evento Novo", phone: "45988636363" });
  // o dono publica um evento de entrada livre naquela noite enquanto a pessoa espera o código
  await page.evaluate((d) => {
    const db = JSON.parse(localStorage.getItem("territorio:mock-db"));
    db.events.push({ id: "teste-agora", title: "Roda surpresa", date: d, starts_at: "20:00", ends_at: null, description: "", image_id: null, published: true, booking_mode: "none", list_capacity: null, entry_times: [], party_max: null, requires_approval: false, price_cents: null, layout_id: null, internal_note: "" });
    localStorage.setItem("territorio:mock-db", JSON.stringify(db));
    window.dispatchEvent(new StorageEvent("storage", { key: "territorio:mock-db" }));
  }, date);
  await page.locator(".otp__input").fill("123456");
  await expect(page.locator("[data-aviso='slot_full.event_mode']")).toContainText("Esse dia virou noite de evento");
  await expect(page.locator("main")).not.toContainText("A casa fechou esse dia");
  await page.locator('.slot:not(.is-full)[aria-disabled="false"]').first().click();
  await expect(page.locator("#reserva-nome")).toHaveValue("Evento Novo");
});

// ---- a lista de espera de um horário está cheia: só "lotado" (história 7.15, N11) ----

test("fila do horário cheia: o horário aparece só lotado, sem lista de espera", async ({ page }) => {
  await open(page, `/reservar/?mock=normal&${NOW}`);
  const full = page.locator('.slot.is-full[aria-disabled="false"]').first();
  await expect(full).toContainText("lotado · lista de espera");
  const time = await full.getAttribute("data-value");
  const date = await page.locator('.day[aria-checked="true"]').getAttribute("data-value");
  await patchDb(
    page,
    (db, at) => {
      db.settings.waitlist.data.max_per_slot = 2;
      for (let i = 0; i < 2; i++) {
        db.reservations.push({ id: `fila-${i}`, code: `TR-99${i}`, customer_id: null, date: at.date, time: at.time, party_size: 2, status: "waitlisted", table_codes: [], waitlist_position: i + 1, created_at: "2026-10-14T12:00:00Z" });
      }
    },
    { date, time },
  );
  const slot = page.locator(`.slot[data-value="${time}"]`);
  await expect(slot).toHaveAttribute("aria-disabled", "true");
  await expect(slot.locator("span")).toHaveText("lotado");
});

// ---- os combinados que o dono edita chegam à página, em cada língua (N14) ----

test("combinados do painel chegam à reserva: o item em espanhol, o botão de aceite e o tempo de mesa sem limite", async ({ page }) => {
  await open(page, `/es/reservar/?mock=normal&${NOW}`);
  await patchDb(page, (db) => {
    const terms = db.settings.terms.data;
    terms.items[0].text.es = "Texto del dueño para la mesa: te espera {tolerancia} minutos.";
    terms.accept_label = { pt: "Li e concordo", es: "Leí y acepto", en: "" };
    terms.show_duration_item = true;
    // cada gravação em Combinados é uma nova versão dos combinados
    db.terms.version = terms.version = "2026-10-14.9";
    db.settings.booking.data.duration_by_weekday = [{ weekday: 3, minutes: 120 }, { weekday: 6, minutes: null }];
  });
  const list = page.locator(".reserva__combinados");
  await expect(list).toContainText(/Texto del dueño para la mesa: te espera \d+ minutos\./);
  await expect(list).toContainText("Los otros días: La mesa es de ustedes por 2 h.");
  await expect(list).toContainText("Sábado: sin límite de tiempo de mesa.");
  await expect(list).not.toContainText("{");
  await page.locator('.slot:not(.is-full)[aria-disabled="false"]').first().click();
  await expect(page.locator("label.agree")).toHaveText("Leí y acepto");
  // inglês deixado vazio pelo dono: o cliente lê o português da casa, como a prévia diz
  await open(page, `/en/reservar/?mock=normal&${NOW}`);
  await page.locator('.slot:not(.is-full)[aria-disabled="false"]').first().click();
  await expect(page.locator("label.agree")).toHaveText("Li e concordo");
  // o que aquela versão dizia fica guardado por língua
  const archived = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem("territorio:mock-db"));
    return db.terms_archive?.[db.terms.version]?.locales?.es?.items?.[0]?.text || "";
  });
  expect(archived).toMatch(/Texto del dueño/);
});

// ---- dentro do Instagram, o código que não chegou: "Copiar o link" em vez do Google (N10) ----

test.describe("navegador do Instagram na reserva", () => {
  test.use({ userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Instagram 310.0.0.0" });

  test("otp_not_arrived: sem Entrar com o Google, com o passo a passo e Copiar o link", async ({ page }) => {
    await page.clock.install();
    await open(page, `/reservar/?mock=normal&${NOW}`);
    await patchDb(page, (db) => (db.booking.google_login = true));
    await choose(page);
    await untilCode(page, { name: "Insta Código", phone: "45988646464" });
    await page.clock.fastForward("01:05");
    const notice = page.locator("[data-aviso=otp_not_arrived]");
    await expect(notice).toContainText("O código não chegou?");
    await expect(notice.getByRole("link", { name: "Entrar com o Google" })).toHaveCount(0);
    await expect(notice.locator("[data-aviso=google_in_app_browser]")).toContainText("Para entrar com o Google, abra no navegador");
    await notice.getByRole("button", { name: "Copiar o link" }).click();
    await expect(notice.locator("[data-aviso=google_in_app_browser] [role=status]")).toHaveText(/Link copiado|Não deu para copiar/);
    await expect(notice.getByRole("button", { name: "Mandar de novo" })).toBeVisible();
    await expect(notice.getByRole("link", { name: "Chamar no WhatsApp" })).toBeVisible();
  });
});

// ---- de volta do Google na reserva (7.9) ----

test("volta do Google com recusa na reserva: google_failed com tentar de novo, e o código continua ali", async ({ page }) => {
  await open(page, `/reservar/?mock=normal&${NOW}&auth_error=access_denied`);
  const notice = page.locator("[data-aviso=google_failed]");
  await expect(notice).toContainText("Não deu para entrar com o Google");
  await expect(notice.getByRole("button", { name: "Tentar de novo" })).toBeVisible();
  await page.locator('.slot:not(.is-full)[aria-disabled="false"]').first().click();
  await expect(page.getByRole("button", { name: "Receber código no WhatsApp" })).toBeVisible();
});
