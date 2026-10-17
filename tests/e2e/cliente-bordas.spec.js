// História 7.17: cada caminho difícil da reserva tem o seu teste, com o mock forçando o caso,
// conferindo a tela, a frase do catálogo e o próximo passo. Os 14 estados de borda do plano 09
// §10, os caminhos que o épico acrescentou, outros fusos, o navegador do Instagram e 360 px nas três
// línguas.
import { NOW, bookOne, choose, consent, contentRight, expect, fillAndBook, force, linksOf, open, patchDb, test } from "./cliente-helpers.js";

test.describe.configure({ timeout: 90_000 });
test.beforeEach(async ({ page }) => consent(page));

async function toCode(page, { name = "Teste Borda", phone = "45988303030" } = {}) {
  await page.locator("#reserva-nome").fill(name);
  await page.locator("#reserva-tel").fill(phone);
  await page.locator("input[name=combinado]").check();
  await page.getByRole("button", { name: "Receber código no WhatsApp" }).click();
  await expect(page.locator(".otp__input")).toBeVisible();
}

const setClock = (page, at) => page.evaluate((a) => history.replaceState(null, "", `${location.pathname}?mock=normal&agora=${a}`), at);

test.describe("os 14 estados de borda", () => {
  test("1. horário lotado: lotado · lista de espera, ainda clicável", async ({ page }) => {
    await open(page, `/reservar/?mock=normal&${NOW}`);
    const full = page.locator(".slot.is-full").first();
    await expect(full).toContainText("lotado · lista de espera");
    await expect(full).toHaveAttribute("aria-disabled", "false");
  });

  test("2. últimas mesas: o aviso em texto, não só na cor", async ({ page }) => {
    await open(page, `/reservar/?mock=normal&${NOW}`);
    await expect(page.locator(".slot.is-few").first()).toContainText("últimas mesas");
  });

  test("3. dia fechado: hachura, motivo em texto e sem toque", async ({ page }) => {
    await open(page, `/reservar/?mock=normal&${NOW}`);
    const closed = page.locator('.day[data-value="2026-10-19"]');
    await expect(closed).toHaveClass(/is-closed/);
    await expect(closed).toContainText("produção");
    await expect(closed).toHaveAttribute("aria-disabled", "true");
  });

  test("4. 9 ou mais: o caminho do grupo grande", async ({ page }) => {
    await open(page, `/reservar/?mock=normal&${NOW}`);
    await page.getByRole("radio", { name: "9 ou mais" }).click();
    await expect(page.locator("#reserva-grupo-n")).toHaveValue("9");
    const status = await page.evaluate(async () => {
      const house = await (await fetch("/api/v1/house")).json();
      return house.booking.large_group_action;
    });
    if (status === "whatsapp") await expect(page.locator("[data-grupo-whatsapp]")).toBeVisible();
    else await expect(page.getByText(/Grupo grande vira um pedido/)).toBeVisible();
  });

  test("5. lotou no meio: alternativas e espera", async ({ page }) => {
    await choose(page);
    await toCode(page);
    await force(page, "lotou");
    await page.locator(".otp__input").fill("123456");
    await expect(page.locator("[data-aviso=slot_full]")).toContainText("Esse horário acabou de lotar");
    await expect(page.locator(".reserva__alternativas button").first()).toBeVisible();
  });

  test("6. código errado: restam tentativas", async ({ page }) => {
    await choose(page);
    await toCode(page);
    await page.locator(".otp__input").fill("000000");
    await expect(page.locator("[data-aviso='validation.otp']")).toContainText("Restam 4 tentativas");
  });

  test("7. código vencido: pede outro e o formulário fica", async ({ page }) => {
    await choose(page);
    await toCode(page);
    await setClock(page, "2026-10-14T15:12");
    await page.locator(".otp__input").fill("123456");
    const notice = page.locator("[data-aviso='gone.otp']");
    await expect(notice).toContainText("O código venceu");
    await expect(notice.getByRole("button", { name: "Mandar de novo" })).toBeVisible();
    await expect(page.locator("#reserva-nome")).toHaveValue("Teste Borda");
  });

  test("8. sem internet: o aviso de estado e a página segue quando volta", async ({ page, context }) => {
    await choose(page);
    await context.setOffline(true);
    await expect(page.locator("[data-aviso=offline]")).toContainText("Você está sem internet");
    await context.setOffline(false);
    await expect(page.locator("[data-aviso=offline]")).toHaveCount(0);
    await expect(page.locator("#reserva-nome")).toBeVisible();
  });

  test("9. API fora: tentar de novo e WhatsApp com a mensagem pronta", async ({ page }) => {
    await open(page, `/reservar/?mock=erro&${NOW}`);
    const notice = page.locator("[data-aviso]").first();
    await expect(notice.getByRole("button", { name: "Tentar de novo" })).toBeVisible();
    await expect(notice.getByRole("link", { name: "Chamar no WhatsApp" })).toHaveAttribute("href", /wa\.me\/\d+\?text=/);
  });

  test("10. reserva repetida: mostra a que existe", async ({ page }) => {
    const time = await choose(page, { date: "2026-10-14" });
    await fillAndBook(page, { name: "Repetida Silva", phone: "45988313131" });
    await expect(page.locator(".receipt__code")).toBeVisible();
    await choose(page, { time, date: "2026-10-14" });
    await page.locator("input[name=combinado]").check();
    await page.getByRole("button", { name: /Confirmar reserva|Entrar na lista de espera/ }).click();
    await expect(page.getByRole("dialog")).toContainText("Você já tem reserva nesse horário");
  });

  test("11. pendente: a casa confirma até a hora calculada, sem citar falta", async ({ page }) => {
    await open(page, `/reservar/?mock=normal&${NOW}`);
    await patchDb(page, (d) => (d.booking.approval_mode = "manual"));
    await page.locator('.slot:not(.is-full)[aria-disabled="false"]').first().click();
    await fillAndBook(page, { name: "Pendente Lopes", phone: "45988323232" });
    await expect(page.locator(".receipt")).toContainText(/A casa confirma até \d\d:\d\d/);
    await expect(page.locator(".reserva__pronto")).not.toContainText(/falta/i);
  });

  test("12. lista de espera: a posição no comprovante", async ({ page }) => {
    await open(page, `/reservar/?mock=normal&${NOW}`);
    await page.locator('.slot.is-full[aria-disabled="false"]').first().click();
    await fillAndBook(page, { name: "Fila Rocha", phone: "45988333333" });
    await expect(page.locator(".receipt")).toContainText(/\dº na lista de espera/);
  });

  for (const [n, title, minutes] of [["13", "oferta aceita: vira reserva confirmada", 10], ["14", "oferta vencida: volta ao fim da fila", -1]]) {
    test(`${n}. ${title}`, async ({ page }) => {
      await open(page, `/reservar/?mock=normal&${NOW}`);
      await page.locator('.slot.is-full[aria-disabled="false"]').first().click();
      await fillAndBook(page, { name: "Oferta Lima", phone: "45988343434" });
      const code = await page.locator(".receipt__code").textContent();
      const links = await linksOf(page, code);
      await open(page, links.waitlist_url);
      await patchDb(page, (d, [c, m]) => {
        const r = d.reservations.find((x) => x.code === c);
        r.status = "offered";
        r.offer_expires_at = new Date(Date.parse("2026-10-14T18:00:00Z") + m * 60_000).toISOString();
      }, [code, minutes]);
      if (minutes > 0) {
        await page.getByRole("button", { name: "Quero a mesa" }).click();
        await expect(page.getByText("A mesa é sua!")).toBeVisible();
      } else {
        await expect(page.locator("[data-aviso=offer_expired]")).toContainText("Você voltou para o fim da lista");
      }
    });
  }
});

test.describe("os caminhos novos do épico", () => {
  test("slot_full.cutoff e slot_full.day_closed", async ({ page }) => {
    await choose(page);
    await toCode(page);
    await force(page, "cutoff");
    await page.locator(".otp__input").fill("123456");
    await expect(page.locator("[data-aviso='slot_full.cutoff']")).toContainText("Esse horário já fechou para reserva online");
    await page.locator('.slot:not(.is-full)[aria-disabled="false"]').first().click();
    await force(page, "dia_fechado");
    await page.getByRole("button", { name: "Confirmar reserva" }).click();
    await expect(page.locator("[data-aviso='slot_full.day_closed']")).toContainText("A casa fechou esse dia");
  });

  test("session_expired_draft: o código de novo e a mesma chave", async ({ page }) => {
    await bookOne(page, { phone: "45988353535", name: "Sessão Prado" });
    await choose(page, { party: 4, date: "2026-10-15" });
    await page.locator("input[name=combinado]").check();
    await force(page, "sessao");
    const keys = [];
    page.on("request", (r) => r.url().endsWith("/api/v1/reservations") && r.method() === "POST" && keys.push(r.headers()["idempotency-key"]));
    await page.getByRole("button", { name: "Confirmar reserva" }).click();
    const ask = page.getByRole("dialog");
    if (await ask.isVisible().catch(() => false)) await ask.getByRole("button", { name: "Fazer outra mesmo assim" }).click();
    await expect(page.locator("[data-aviso=session_expired_draft]")).toContainText("Precisamos do código de novo");
    await page.locator("#reserva-tel").fill("45988353535");
    await page.getByRole("button", { name: "Receber código no WhatsApp" }).click();
    await page.locator(".otp__input").fill("123456");
    if (await ask.isVisible().catch(() => false)) await ask.getByRole("button", { name: "Fazer outra mesmo assim" }).click();
    await expect(page.locator(".receipt__code")).toBeVisible();
    expect(new Set(keys).size).toBe(1);
  });

  test("phone_country_unsupported e +54/+595 com Confere?", async ({ page }) => {
    await choose(page);
    await page.locator("#reserva-tel").fill("+1 415 555 0100");
    await page.locator("#reserva-nome").focus();
    await expect(page.locator(".field[data-phone]")).toContainText("Por aqui, só números do Brasil, Paraguai e Argentina");
    await page.locator("#reserva-tel").fill("+54 3757 12-3456");
    await page.locator("#reserva-nome").focus();
    await expect(page.locator(".phone__confere")).toContainText("Confere? +54 9 3757 12-3456");
    await page.locator("#reserva-tel").fill("+595 0983 123456");
    await page.locator("#reserva-nome").focus();
    await expect(page.locator(".phone__confere")).toContainText("Confere? +595 983 123 456");
  });

  test("conta Google sem telefone: confirma o WhatsApp antes de reservar", async ({ page }) => {
    await open(page, `/entrar/?mock=normal&${NOW}`);
    await patchDb(page, (d) => (d.booking.google_login = true));
    await page.getByRole("link", { name: "Entrar com o Google" }).click();
    await page.waitForSelector("html[data-ready]");
    await page.getByRole("button", { name: "Conta nova, sem WhatsApp" }).click();
    await page.waitForURL(/needs_phone=1/);
    await choose(page);
    await expect(page.locator("#reserva-tel")).toBeVisible();
    await fillAndBook(page, { name: "Google Novo", phone: "45988363636" });
    await expect(page.locator(".receipt__code")).toBeVisible();
  });

  test("limite de 2 reservas futuras: active_limit com Minhas reservas", async ({ page }) => {
    await bookOne(page, { phone: "45988373737", name: "Limite Dias" });
    for (const party of [3, 4]) {
      await open(page, `/reservar/?mock=normal&${NOW}`);
      await page.locator(`.tile[data-value="${party}"]`).click();
      await page.locator(".calendario__grade .day:not(.is-closed):not(.is-full)").nth(party).click();
      await page.locator('.slot:not(.is-full)[aria-disabled="false"]').first().click();
      await page.locator("input[name=combinado]").check();
      await page.getByRole("button", { name: "Confirmar reserva" }).click();
      if (party === 3) await expect(page.locator(".receipt__code")).toBeVisible();
    }
    await expect(page.getByRole("dialog")).toContainText("Você já tem 2 reservas marcadas");
    await expect(page.getByRole("dialog").getByRole("button", { name: "Minhas reservas" })).toBeVisible();
  });

  test("Turnstile recusado", async ({ page }) => {
    await choose(page);
    await page.locator("#reserva-nome").fill("Robô Talvez");
    await page.locator("#reserva-tel").fill("45988383838");
    await page.locator("input[name=combinado]").check();
    await force(page, "turnstile");
    await page.getByRole("button", { name: "Receber código no WhatsApp" }).click();
    await expect(page.locator("[data-aviso=turnstile_failed]")).toContainText("A checagem contra robôs não passou");
  });

  test("Não vou mais numa reserva que já chegou: nada muda", async ({ page }) => {
    const { code } = await bookOne(page, { phone: "45988393939", name: "Chegou Antes" });
    const links = await linksOf(page, code);
    await open(page, links.confirm_url);
    await patchDb(page, (d, c) => {
      const r = d.reservations.find((x) => x.code === c);
      r.arrived_at = new Date().toISOString();
    }, code);
    await page.getByRole("button", { name: "Não vou mais" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Não vou mais" }).click();
    await expect(page.locator("[data-aviso=invalid_transition]")).toContainText("Essa reserva já mudou");
  });
});

for (const timezoneId of ["America/Asuncion", "Asia/Tokyo"]) {
  test.describe(`aparelho em ${timezoneId}`, () => {
    test.use({ timezoneId });

    test("calendário, horários, comprovante, .ics e oferta mostram o dia e a hora da casa", async ({ page }) => {
      await open(page, `/reservar/?mock=normal&${NOW}`);
      await expect(page.locator('.day[aria-checked="true"]')).toHaveAttribute("data-value", "2026-10-14");
      await expect(page.locator(".slot").first()).toContainText("19:00");
      // dados de fuso novos põem Assunção em UTC−3 como a casa: a nota só aparece quando o relógio é diferente
      const differs = await page.evaluate(() => new Date("2026-10-14T23:00:00Z").getHours() !== 20);
      if (differs) await expect(page.getByText("Horário de Foz do Iguaçu.")).toBeVisible();
      await page.locator('.slot:not(.is-full)[aria-disabled="false"]').first().click();
      const time = await page.locator('.slot[aria-checked="true"]').getAttribute("data-value");
      await fillAndBook(page, { name: "Fuso Teste", phone: "45988404040" });
      await expect(page.locator(".receipt")).toContainText(time);
      if (differs) await expect(page.locator(".recibo__quando")).toContainText("(horário de Foz do Iguaçu)");
      await expect(page.locator(".recibo__quando")).toContainText("14/10");
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "Pôr na agenda" }).click();
      const chunks = [];
      for await (const chunk of await (await download).createReadStream()) chunks.push(chunk);
      expect(Buffer.concat(chunks).toString()).toContain(`DTSTART;TZID=America/Sao_Paulo:20261014T${time.replace(":", "")}00`);
    });

    test("a oferta da espera conta e mostra a hora da casa", async ({ page }) => {
      await open(page, `/reservar/?mock=normal&${NOW}`);
      await page.locator('.slot.is-full[aria-disabled="false"]').first().click();
      await fillAndBook(page, { name: "Fuso Fila", phone: "45988414141" });
      const code = await page.locator(".receipt__code").textContent();
      const links = await linksOf(page, code);
      await open(page, links.waitlist_url);
      await patchDb(page, (d, c) => {
        const r = d.reservations.find((x) => x.code === c);
        r.status = "offered";
        r.offer_expires_at = "2026-10-14T18:10:00.000Z";
      }, code);
      await expect(page.locator("p.prose", { hasText: "Responda até 15:10." })).toBeVisible();
    });
  });
}

test.describe("navegador do Instagram", () => {
  test.use({ userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Instagram 310.0.0.0" });

  test("entrada sem Google (google_in_app_browser) e Pôr na agenda com Abrir no navegador e Copiar o link", async ({ page }) => {
    await open(page, `/entrar/?mock=normal&${NOW}`);
    await patchDb(page, (d) => (d.booking.google_login = true));
    await expect(page.locator("[data-aviso=google_in_app_browser]")).toContainText("Para entrar com o Google, abra no navegador");
    await bookOne(page, { phone: "45988424242", name: "Insta Gram" });
    await page.getByRole("button", { name: "Pôr na agenda" }).click();
    await expect(page.getByRole("link", { name: "Abrir no navegador" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Copiar o link" })).toBeVisible();
  });
});

test.describe("360 px nas três línguas", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  for (const [locale, prefix, people, hour] of [["pt", "", "2 pessoas", /19:00/], ["es", "/es", "2 personas", /19:00/], ["en", "/en", "2 people", /7:00 pm/]]) {
    test(`reserva em ${locale}: sem rolagem lateral, horas no formato da língua`, async ({ page }) => {
      await open(page, `${prefix}/reservar/?mock=normal&${NOW}`);
      await expect(page.getByRole("radio", { name: people })).toHaveAttribute("aria-checked", "true");
      await expect(page.locator(".slot").first()).toContainText(hour);
      await expect.poll(() => contentRight(page)).toBeLessThanOrEqual(360);
      for (const path of ["/entrar/", "/minhas-reservas/", "/confirmar/?t=x", "/espera/?t=x"]) {
        await open(page, `${prefix}${path}`);
        await expect.poll(() => contentRight(page)).toBeLessThanOrEqual(360);
      }
    });
  }
});
