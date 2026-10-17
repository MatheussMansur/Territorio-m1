// Os links das mensagens: /confirmar (Confirmo, Vou atrasar um pouco, Não vou mais) e /espera
// (o lugar na fila, a oferta, aceitar ou passar a vez). Abrir nunca muda nada.
// Histórias 7.14, 7.15 e 7.16.
import { NOW, choose, consent, fillAndBook, linksOf, open, patchDb, seriousBothThemes, expect, test } from "./cliente-helpers.js";

test.describe.configure({ timeout: 90_000 });
test.beforeEach(async ({ page }) => consent(page));

/** Uma reserva hoje às 21:00 (tolerância de 20 min: a mesa espera até 21:20). */
async function tonightAt2100(page, opts = {}) {
  await choose(page, { time: "21:00", ...opts });
  await fillAndBook(page, { name: "Paula Reis", phone: "45988202020", ...opts });
  await expect(page.locator(".receipt__code")).toBeVisible();
  const code = await page.locator(".receipt__code").textContent();
  return { code, links: await linksOf(page, code) };
}

const db = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("territorio:mock-db")));

test("abrir o link não muda nada; Confirmo, de novo é link usado; Vou atrasar aplica uma vez", async ({ page }) => {
  const { code, links } = await tonightAt2100(page);
  const before = (await db(page)).reservations.find((r) => r.code === code);
  await open(page, links.confirm_url);
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.locator(".receipt__code")).toHaveText(code);
  const after = (await db(page)).reservations.find((r) => r.code === code);
  expect(after).toEqual(before); // ler não mudou nada
  expect(await seriousBothThemes(page)).toEqual([]);

  await page.getByRole("button", { name: "Confirmo" }).click();
  await expect(page.getByText("Obrigado! A casa já sabe que você vem.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirmo" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Confirmo" }).click();
  await expect(page.locator("[data-aviso='conflict.link_used']")).toContainText("Isso já foi feito");
  await expect(page.locator("[data-aviso='conflict.link_used']").getByRole("link", { name: "Ver a reserva" })).toBeVisible();

  await page.getByRole("button", { name: "Vou atrasar um pouco" }).click();
  await expect(page.getByText("Avisado. A mesa espera você até as 21:30.")).toBeVisible();
  await page.getByRole("button", { name: "Vou atrasar um pouco" }).click();
  await expect(page.locator("[data-aviso='conflict.link_used']")).toBeVisible();
  await expect(page.getByText("Avisado. A mesa espera você até as 21:30.")).toBeVisible(); // ainda 21:30, não 21:40
  await expect(page.getByRole("link", { name: "Mudar" })).toHaveAttribute("href", new RegExp(`/minhas-reservas/\\?reserva=${code}`));
});

test("Vou atrasar às 21:19:59 entra (até 21:30); às 21:20:00 recebe invalid_transition.late", async ({ page }) => {
  const { links } = await tonightAt2100(page);
  await open(page, `${links.confirm_url}&agora=2026-10-14T21:20:00`);
  await page.getByRole("button", { name: "Vou atrasar um pouco" }).click();
  await expect(page.locator("[data-aviso='invalid_transition.late']")).toContainText("A mesa já não está guardada");
  await expect(page.locator("main")).not.toContainText(/tolerância/i); // a palavra fica no painel e nos combinados (N9)
  await open(page, `${links.confirm_url}&agora=2026-10-14T21:19:59`);
  await page.getByRole("button", { name: "Vou atrasar um pouco" }).click();
  await expect(page.getByText("Avisado. A mesa espera você até as 21:30.")).toBeVisible();
});

test("extra em 0: o botão some e o link responde late_off", async ({ page }) => {
  const { links } = await tonightAt2100(page);
  await open(page, links.confirm_url);
  await patchDb(page, (d) => (d.booking.extra_tolerance_min = 0));
  await expect(page.getByRole("button", { name: "Vou atrasar um pouco" })).toHaveCount(0);
  const token = new URL(links.confirm_url, "http://x").searchParams.get("t");
  const answer = await page.evaluate(async (tk) => (await fetch(`/api/v1/links/${tk}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answer: "late" }) })).json(), token);
  expect(answer.reason).toBe("late_off");
});

test("Não vou mais cancela; numa reserva que já chegou, nada muda e o painel vê o toque", async ({ page }) => {
  const first = await tonightAt2100(page);
  await open(page, first.links.confirm_url);
  await page.getByRole("button", { name: "Não vou mais" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Não vou mais" }).click();
  await expect(page.getByText(/Reserva cancelada|contou como em cima da hora/)).toBeVisible();
  await expect(page.locator(".receipt")).toContainText("Cancelada");

  const second = await tonightAt2100(page, { time: "21:30" });
  await open(page, second.links.confirm_url);
  await patchDb(page, (d, c) => (d.reservations.find((r) => r.code === c).status = "completed"), second.code);
  const token = new URL(second.links.confirm_url, "http://x").searchParams.get("t");
  const answer = await page.evaluate(async (tk) => (await fetch(`/api/v1/links/${tk}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answer: "no" }) })).json(), token);
  expect(answer.type).toBe("invalid_transition");
  const r = (await db(page)).reservations.find((x) => x.code === second.code);
  expect(r.status).toBe("completed");
  expect(r.history.at(-1).action).toBe("link_tap");
});

test("link de leitura não age; link vencido e link cortado têm tela própria", async ({ page }) => {
  const { links } = await tonightAt2100(page);
  const readOnly = (await db(page)).reservations.at(-1).public_token;
  await open(page, `/confirmar/?t=${readOnly}`);
  await page.getByRole("button", { name: "Confirmo" }).click();
  await expect(page.locator("[data-aviso=read_only_link]")).toContainText("Este link é só para ver");
  await open(page, `${links.confirm_url}&forcar=link_vencido`);
  await expect(page.getByRole("heading", { name: "Esse link venceu" })).toBeVisible();
  await open(page, "/confirmar/?t=cortado");
  await expect(page.getByRole("heading", { name: "Esse link não abriu" })).toBeVisible();
});

test("a página do link vem na língua da reserva", async ({ page }) => {
  await choose(page, { path: "/es/reservar/" });
  await fillAndBook(page, { name: "Lucía Benítez", phone: "45988212121" });
  const code = await page.locator(".receipt__code").textContent();
  const links = await linksOf(page, code);
  const pt = links.confirm_url.replace(/^\/es/, "");
  await open(page, pt);
  await expect(page).toHaveURL(/\/es\/confirmar\//);
  await expect(page.getByRole("button", { name: "Ya no voy" })).toBeVisible();
});

/** Uma entrada na lista de espera num horário cheio, com login; devolve o código e os links. */
async function waitlisted(page) {
  await open(page, `/reservar/?mock=normal&${NOW}`);
  await page.locator('.slot.is-full[aria-disabled="false"]').first().click();
  await fillAndBook(page, { name: "Rita Moraes", phone: "45988222222" });
  await expect(page.locator(".receipt")).toContainText("na lista de espera");
  const code = await page.locator(".receipt__code").textContent();
  return { code, links: await linksOf(page, code) };
}

const offer = () => (d, [c, m]) => {
  const r = d.reservations.find((x) => x.code === c);
  r.status = "offered";
  r.offer_expires_at = new Date(Date.parse("2026-10-14T18:00:00Z") + m * 60_000).toISOString(); // 15:00 em Foz + m
};

test("espera: posição sem mudar nada, oferta com o tempo em texto, Quero a mesa confirma", async ({ page }) => {
  const { code, links } = await waitlisted(page);
  await open(page, links.waitlist_url);
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  await expect(page.locator(".receipt")).toContainText(/\dº na lista de espera/);
  await expect(page.getByRole("link", { name: "Minhas reservas" }).last()).toHaveAttribute("href", /minhas-reservas/);
  await patchDb(page, offer(10), [code, 10]);
  await expect(page.getByRole("heading", { name: "Abriu uma mesa para você" })).toBeVisible();
  await expect(page.locator(".contagem")).toHaveText(/\d+ min/);
  await expect(page.locator("p.prose", { hasText: "Responda até 15:10." })).toBeVisible();
  await expect(page.locator("[aria-live=polite]")).toContainText("15:10");
  expect(await seriousBothThemes(page)).toEqual([]);
  await page.getByRole("button", { name: "Quero a mesa" }).click();
  await expect(page.getByText("A mesa é sua!")).toBeVisible();
  await expect(page.locator(".receipt")).toContainText("Confirmada".slice(0, 0) || /A mesa te espera até/);
  await page.reload();
  await page.waitForSelector("html[data-ready]");
  await expect(page.getByRole("button", { name: "Quero a mesa" })).toHaveCount(0);
});

test("espera: passar a vez tira da fila; oferta vencida volta ao fim da fila", async ({ page }) => {
  const { code, links } = await waitlisted(page);
  await open(page, links.waitlist_url);
  await patchDb(page, offer(-1), [code, -1]); // acabou há um minuto
  await expect(page.locator("[data-aviso=offer_expired]")).toContainText("O tempo para aceitar passou");
  await expect(page.locator(".receipt")).toContainText(/\dº na lista de espera/);
  await patchDb(page, offer(10), [code, 10]);
  await page.getByRole("button", { name: "Pode passar a vez" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Pode passar a vez" }).click();
  await expect(page.getByText("Tudo certo: a vez passou para a próxima pessoa.")).toBeVisible();
});

test("espera: com outra reserva na mesma noite, pergunta se troca e mantém o código TR", async ({ page }) => {
  const { code, links } = await waitlisted(page);
  await choose(page, { party: 2 });
  await page.locator("input[name=combinado]").check();
  await page.getByRole("button", { name: "Confirmar reserva" }).click();
  const ask = page.getByRole("dialog");
  if (await ask.isVisible().catch(() => false)) await ask.getByRole("button", { name: "Fazer outra mesmo assim" }).click();
  await expect(page.locator(".receipt__code")).toBeVisible();
  const other = await page.locator(".receipt__code").textContent();
  await open(page, links.waitlist_url);
  await patchDb(page, offer(10), [code, 10]);
  await page.getByRole("button", { name: "Quero a mesa" }).click();
  await expect(page.getByRole("dialog")).toContainText(/Trocar a reserva das \d\d:\d\d por esta\?/);
  await page.getByRole("dialog").getByRole("button", { name: "Trocar" }).click();
  await expect(page.getByText(`Trocado: a reserva ${other} agora é nesta mesa.`)).toBeVisible();
  await expect(page.locator(".receipt__code")).toHaveText(other);
});
