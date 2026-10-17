// A moldura do painel: depois do primeiro acesso do dono o painel abre o assistente de primeiro uso
// até ser terminado ou deixado de lado (história 3.12), e numa noite de evento com lista na porta o
// "Mais" do celular tem "Porta do evento" (história 6.8).
import AxeBuilder from "@axe-core/playwright";
import { expect as baseExpect, test } from "@playwright/test";

const expect = baseExpect.configure({ timeout: 10_000 });
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

async function open(page, url) {
  await page.addInitScript(() => localStorage.setItem("territorio:demo-open", "false"));
  await page.goto(url);
  await page.waitForSelector("html[data-ready]");
}

const db = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("territorio:mock-db")));
/** Muda os dados salvos do mock antes de o app rodar na próxima carga, para nenhuma gravação da página aberta desfazer. */
async function editState(page, change, arg) {
  const id = `teste-patch-${Math.random().toString(36).slice(2)}`;
  await page.addInitScript(
    ({ code, id, arg }) => {
      if (sessionStorage.getItem(id)) return;
      const raw = localStorage.getItem("territorio:mock-db");
      if (!raw) return;
      const db = JSON.parse(raw);
      new Function("db", "arg", code)(db, arg);
      localStorage.setItem("territorio:mock-db", JSON.stringify(db));
      sessionStorage.setItem(id, "1");
    },
    { code: change, id, arg },
  );
  await page.reload();
  await page.waitForSelector("html[data-ready]");
}

const assistant = (page) => page.getByRole("heading", { level: 1, name: "Primeiro acesso", exact: true });
const today = (page) => page.getByRole("heading", { level: 1, name: "Hoje" });

test("depois do primeiro acesso, o painel leva o dono ao assistente até ele deixar para depois", async ({ page }) => {
  await open(page, "/admin/?mock=normal");
  const { auth } = await db(page);
  const link = auth.tokens.find((t) => t.kind === "owner_setup" && !t.used_at && !t.recovery).token;
  await open(page, `/admin/entrar/primeiro-acesso/${link}`);
  await page.getByLabel("Crie uma senha").fill("lanterna na varanda");
  await page.getByLabel("Repita a senha").fill("lanterna na varanda");
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByLabel("Código do aplicativo").fill("123456");
  await page.getByRole("button", { name: "Ligar a verificação" }).click();
  await page.getByLabel("Guardei os códigos num lugar seguro").check();
  await page.getByRole("button", { name: "Entrar no painel" }).click();

  await expect(assistant(page)).toBeVisible();
  await expect(page).toHaveURL((url) => url.pathname.startsWith("/admin/primeiro-acesso"));
  await expect(page.getByRole("list", { name: "Passos do primeiro acesso" })).toBeVisible();
  await bothThemes(page);

  // ainda pendente: voltar ao painel abre de novo
  await page.goto("/admin/");
  await page.waitForSelector("html[data-ready]");
  await expect(assistant(page)).toBeVisible();

  // deixado de lado: o painel abre no Hoje, onde o que falta continua listado
  await page.getByRole("button", { name: "Continuar depois" }).click();
  await expect(today(page)).toBeVisible();
  await page.goto("/admin/");
  await page.waitForSelector("html[data-ready]");
  await expect(today(page)).toBeVisible();
});

test("dono de sempre entra direto no Hoje", async ({ page }) => {
  await open(page, "/admin/?papel=dono&mock=normal");
  await expect(today(page)).toBeVisible();
});

test("noite de evento com lista: Porta do evento no Mais do celular", async ({ page }) => {
  test.skip(test.info().project.name !== "celular", "Mais is the phone's menu");
  await open(page, "/admin/salao?papel=recepcao&mock=normal");
  const date = await page.evaluate(() => fetch("/api/v1/staff/floor").then((r) => r.json()).then((f) => f.date));
  // hoje é a noite de um evento publicado com lista na porta
  await editState(
    page,
    `const event = db.events.find((e) => e.published && ["list", "mixed"].includes(e.booking_mode));
     for (const e of db.events) if (e.date === arg && e !== event) e.date = "2099-01-01";
     event.date = arg;`,
    date,
  );
  const event = (await db(page)).events.find((e) => e.date === date);
  await page.goto("/admin/?mock=normal");
  await page.waitForSelector("html[data-ready]");
  await expect(today(page)).toBeVisible();
  await page.getByRole("button", { name: "Mais", exact: true }).click();
  const door = page.getByRole("dialog", { name: "Mais" }).getByRole("link", { name: "Porta do evento" });
  await expect(door).toBeVisible();
  await expect(door).toHaveAttribute("href", `/admin/salao/porta?evento=${encodeURIComponent(event.id)}`);
  await bothThemes(page);
  await door.click();
  await page.waitForSelector("html[data-ready]");
  await expect(page.getByRole("button", { name: "Pôr para dentro" }).first()).toBeVisible();
});
