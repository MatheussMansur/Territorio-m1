// A entrada da equipe (Épico 1): login com e-mail, senha, Turnstile e o código (1.6), o
// código de recuperação, "manter conectado", o link de primeiro acesso e gone.setup, a confirmação de identidade e
// "Sair" (1.7), "Esqueci a senha", gone.reset e "Minhas sessões" (1.8), o convite e
// gone.invite (1.9), o login sobre a tela que guarda o que foi digitado (bug 5), a
// raiz de carregamento (1.2) e as áreas escolhidas pelo dono chegando à recepção (1.15).
import AxeBuilder from "@axe-core/playwright";
import { expect as baseExpect, test } from "@playwright/test";

// o servidor de dev é compartilhado com outros trabalhos: dá um pouco mais de tempo a cada tela
const expect = baseExpect.configure({ timeout: 15_000 });
import { DEMO_PASSWORD, inviteToken } from "../../src/mocks/seeds/auth.js";

// o widget da Cloudflare, substituído para os testes nunca dependerem da internet; o de verdade
// (chave de teste grátis) roda no navegador da demonstração
const TURNSTILE = `window.turnstile = {
  o: {},
  render(el, o) { const id = "w" + Math.random(); this.o[id] = o; const p = document.createElement("p"); p.textContent = "Checagem feita"; el.append(p); setTimeout(() => o.callback("XXXX.DUMMY.TOKEN.XXXX"), 20); return id; },
  reset(id) { const o = this.o[id]; if (o) setTimeout(() => o.callback("XXXX.DUMMY.TOKEN.XXXX"), 20); },
  remove() {},
};`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(TURNSTILE);
});

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
/** Muda os dados da demonstração como o servidor faria, depois abre a página de novo. */
async function editDb(page, fn, arg) {
  await page.evaluate(
    ([source, value]) => {
      const state = JSON.parse(localStorage.getItem("territorio:mock-db"));
      new Function("state", "value", source)(state, value);
      localStorage.setItem("territorio:mock-db", JSON.stringify(state));
    },
    [fn, arg],
  );
}

const email = (page) => page.getByLabel("E-mail", { exact: true });
const password = (page) => page.getByLabel("Senha", { exact: true });
const enter = (page) => page.getByRole("button", { name: "Entrar", exact: true });

async function signIn(page, { mail = "marcus@territorio.test", pass = "admin", code = "123456", remember = false } = {}) {
  await email(page).fill(mail);
  await password(page).fill(pass);
  if (remember) await page.getByLabel(/Manter conectado neste aparelho/).check();
  await enter(page).click();
  if (code === null) return;
  await page.getByLabel("Código do aplicativo").fill(code);
  await enter(page).click();
}

/** "Sair" fica embaixo do nome da pessoa: no trilho, ou em "Mais" no celular. */
async function signOut(page) {
  if (isPhone()) await page.getByRole("button", { name: "Mais", exact: true }).click();
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Entrar no painel" })).toBeVisible();
}

test("sem sessão, a entrada pede e-mail, senha e o Turnstile", async ({ page }) => {
  await open(page, "/admin/?mock=normal");
  await expect(page.getByRole("heading", { level: 1, name: "Entrar no painel" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Território" }).first()).toBeVisible();
  await expect(page.locator(".trilho, .barra")).toHaveCount(0);
  await expect(page.getByText("Checagem feita")).toBeVisible();
  await expect(enter(page)).toBeEnabled();
  // sem cadastro público para a equipe
  await expect(page.getByRole("link", { name: /cadastr|criar conta/i })).toHaveCount(0);
  await bothThemes(page);
});

test("e-mail ou senha errados dizem sempre a mesma frase; o código entra", async ({ page }) => {
  await open(page, "/admin/?mock=normal");
  await signIn(page, { mail: "ninguem@territorio.test", code: null });
  await expect(page.getByRole("alert")).toContainText("E-mail ou senha não conferem");
  await signIn(page, { pass: "senha-errada-123", code: null });
  await expect(page.getByRole("alert")).toContainText("E-mail ou senha não conferem");

  await signIn(page, { code: null });
  await expect(page.getByRole("heading", { name: "Verificação em duas etapas" })).toBeVisible();
  await bothThemes(page);
  await page.getByLabel("Código do aplicativo").fill("000000");
  await enter(page).click();
  await expect(page.getByText(/Código não confere/)).toBeVisible();
  await page.getByLabel("Código do aplicativo").fill("123456");
  await enter(page).click();
  await expect(page.getByRole("heading", { level: 1, name: "Hoje" })).toBeVisible();
  await expect(page).toHaveURL((url) => url.pathname === "/admin/");
  if (!isPhone()) await expect(page.locator(".trilho__pessoa")).toContainText("Marcus Norberto");
});

test("sem o token do Turnstile a simulação recusa a entrada", async ({ page }) => {
  await open(page, "/admin/?mock=normal");
  const answer = await page.evaluate(async (pass) => {
    const response = await fetch("/api/v1/staff/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "marcus@territorio.test", password: pass }) });
    return { status: response.status, type: (await response.json()).type };
  }, DEMO_PASSWORD);
  expect(answer).toEqual({ status: 400, type: "turnstile_failed" });
});

test("conta desativada só aparece depois da senha certa", async ({ page }) => {
  await open(page, "/admin/?mock=normal");
  await editDb(page, `state.users.find((u) => u.email === "gerente@territorio.test").status = "disabled";`);
  await open(page, "/admin/?mock=normal");
  await signIn(page, { mail: "gerente@territorio.test", pass: "senha-que-nao-e", code: null });
  await expect(page.getByRole("alert")).toContainText("E-mail ou senha não conferem");
  await signIn(page, { mail: "gerente@territorio.test", code: null });
  await expect(page.getByRole("heading", { name: "Essa conta está desativada" })).toBeVisible();
  await expect(page.getByText("Fale com o dono da casa para reativar.")).toBeVisible();
});

test("manter conectado vale para outra aba; sem marcar, só para esta", async ({ page, context }) => {
  await open(page, "/admin/?mock=normal");
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "Hoje" })).toBeVisible();
  const other = await context.newPage();
  await other.addInitScript(TURNSTILE);
  await open(other, "/admin/?mock=normal");
  await expect(other.getByRole("heading", { level: 1, name: "Entrar no painel" })).toBeVisible();

  await signOut(page);
  await expect(page.getByRole("heading", { level: 1, name: "Entrar no painel" })).toBeVisible();
  await signIn(page, { remember: true });
  await expect(page.getByRole("heading", { level: 1, name: "Hoje" })).toBeVisible();
  const cookie = await page.evaluate(() => JSON.parse(localStorage.getItem("territorio:mock-equipe")));
  expect(cookie.max_age_days).toBe(30);
  await open(other, "/admin/?mock=normal");
  await expect(other.getByRole("heading", { level: 1, name: "Hoje" })).toBeVisible();
});

test("Sair encerra a sessão, inclusive a do ?papel=, e volta à entrada", async ({ page }) => {
  await open(page, "/admin/reservas?papel=dono&mock=normal");
  await expect(page.getByRole("heading", { level: 1, name: "Reservas" })).toBeVisible();
  await signOut(page);
  await expect(page.getByRole("heading", { level: 1, name: "Entrar no painel" })).toBeVisible();
  await expect(page).toHaveURL((url) => url.pathname === "/admin/entrar" && !url.searchParams.has("papel"));
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Entrar no painel" })).toBeVisible();
});

test("primeiro acesso: senha, QR e códigos de recuperação; o link não vale de novo", async ({ page }) => {
  test.setTimeout(60_000);
  await open(page, "/admin/?mock=normal");
  const { auth } = await db(page);
  const link = auth.tokens.find((t) => t.kind === "owner_setup" && !t.used_at && !t.recovery).token;
  await open(page, `/admin/entrar/primeiro-acesso/${link}`);
  await expect(page.getByRole("heading", { level: 1, name: "Primeiro acesso do dono" })).toBeVisible();
  await expect(page.getByLabel("E-mail", { exact: true })).toHaveValue("marcus@territorio.test");
  await page.getByLabel("Crie uma senha").fill("territorio123");
  await page.getByLabel("Repita a senha").fill("territorio123");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByText("Essa senha aparece em vazamentos")).toBeVisible();
  await page.getByLabel("Crie uma senha").fill("lanterna na varanda");
  await page.getByLabel("Repita a senha").fill("lanterna na varanda");
  await page.getByRole("button", { name: "Continuar" }).click();

  await expect(page.getByRole("img", { name: "Código QR para o aplicativo de códigos" })).toBeVisible();
  await bothThemes(page);
  await page.getByLabel("Código do aplicativo").fill("123456");
  await page.getByRole("button", { name: "Ligar a verificação" }).click();
  const codes = page.getByRole("list", { name: "Códigos de recuperação" }).locator("code");
  await expect(codes).toHaveCount(10);
  const recovery = await codes.first().textContent();
  await expect(page.getByRole("button", { name: "Entrar no painel" })).toBeDisabled();
  await page.getByLabel("Guardei os códigos num lugar seguro").check();
  await page.getByRole("button", { name: "Entrar no painel" }).click();
  // depois do primeiro acesso, o painel abre o assistente de primeiro uso (história 3.12)
  await expect(page.getByRole("heading", { level: 1, name: "Primeiro acesso", exact: true })).toBeVisible();

  // usado uma vez: abrir de novo mostra gone.setup, e a tentativa vai para o registro
  await signOut(page);
  await open(page, `/admin/entrar/primeiro-acesso/${link}`);
  await expect(page.getByRole("heading", { name: "Esse link de primeiro acesso já foi usado" })).toBeVisible();
  expect((await db(page)).audit.some((a) => a.action === "auth.setup_link_reused")).toBe(true);

  // a senha nova, depois um código de recuperação, válido uma vez
  await open(page, "/admin/entrar?mock=normal");
  await signIn(page, { pass: "lanterna na varanda", code: null });
  await page.getByRole("button", { name: "Usar um código de recuperação" }).click();
  await page.getByLabel("Código de recuperação").fill(recovery);
  await enter(page).click();
  await expect(page.getByRole("heading", { level: 1, name: "Primeiro acesso", exact: true })).toBeVisible();
  await signOut(page);
  await signIn(page, { pass: "lanterna na varanda", code: null });
  await page.getByRole("button", { name: "Usar um código de recuperação" }).click();
  await page.getByLabel("Código de recuperação").fill(recovery);
  await enter(page).click();
  await expect(page.getByText(/Código não confere/)).toBeVisible();
});

test("link de recuperação do dono refaz senha e código e encerra as outras sessões", async ({ page }) => {
  await open(page, "/admin/?mock=normal");
  const { auth } = await db(page);
  const link = auth.tokens.find((t) => t.recovery).token;
  await open(page, `/admin/entrar/primeiro-acesso/${link}`);
  await expect(page.getByRole("heading", { level: 1, name: "Refazer a senha e a verificação" })).toBeVisible();
  await page.getByLabel("Crie uma senha").fill("cuia de tereré gelado");
  await page.getByLabel("Repita a senha").fill("cuia de tereré gelado");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("img", { name: "Código QR para o aplicativo de códigos" })).toBeVisible();
  const after = await db(page);
  const owner = after.users.find((u) => u.role === "owner");
  expect(after.auth.sessions.filter((s) => s.user_id === owner.id && !s.ended_at)).toHaveLength(1);
  expect(after.audit[0].action).toBe("auth.setup_recovery");
});

test("esqueci a senha: a mesma resposta, o link vale uma vez e o mais novo vence", async ({ page }) => {
  await open(page, "/admin/entrar/esqueci?mock=normal");
  await expect(page.getByRole("heading", { level: 1, name: "Esqueci a senha" })).toBeVisible();
  await page.getByLabel("E-mail").fill("quem@nao.existe");
  await page.getByRole("button", { name: "Mandar o link" }).click();
  const sent = page.getByRole("heading", { name: "Confira o seu e-mail" });
  await expect(sent).toBeVisible();
  const same = await page.locator(".entrada__texto").textContent();

  for (let i = 0; i < 2; i++) {
    await open(page, "/admin/entrar/esqueci");
    await page.getByLabel("E-mail").fill("marcus@territorio.test");
    await page.getByRole("button", { name: "Mandar o link" }).click();
    await expect(sent).toBeVisible();
    expect(await page.locator(".entrada__texto").textContent()).toBe(same);
  }
  const [newest, older] = (await db(page)).auth.outbox;
  await open(page, older.path);
  await expect(page.getByRole("heading", { name: "O link de nova senha venceu" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Pedir outro link" })).toBeVisible();
  await bothThemes(page);

  await open(page, newest.path);
  await page.getByLabel("Senha nova", { exact: true }).fill("sopa de mandioca quente");
  await page.getByLabel("Repita a senha").fill("sopa de mandioca quente");
  await page.getByRole("button", { name: "Trocar a senha" }).click();
  await expect(page.getByRole("heading", { name: "Senha trocada" })).toBeVisible();
  const state = await db(page);
  const owner = state.users.find((u) => u.role === "owner");
  expect(state.auth.sessions.filter((s) => s.user_id === owner.id && !s.ended_at)).toHaveLength(0);

  await open(page, newest.path);
  await expect(page.getByRole("heading", { name: "O link de nova senha venceu" })).toBeVisible();
  await open(page, "/admin/entrar");
  await signIn(page, { pass: "sopa de mandioca quente" });
  await expect(page.getByRole("heading", { level: 1, name: "Hoje" })).toBeVisible();
});

test("Minhas sessões: cada aparelho com local e última atividade, e encerrar", async ({ page }) => {
  await open(page, "/admin/?papel=dono&mock=normal");
  if (isPhone()) await page.getByRole("button", { name: "Mais", exact: true }).click();
  await page.getByRole("link", { name: "Minhas sessões" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Minhas sessões" })).toBeVisible();
  const list = page.getByRole("list", { name: "Sessões abertas" });
  await expect(list.locator(".sessoes__item")).toHaveCount(3);
  await expect(list).toContainText("esta sessão");
  await expect(list).toContainText("Safari no iPhone");
  await expect(list).toContainText("Foz do Iguaçu, PR (aproximado)");
  await bothThemes(page);
  await list.locator(".sessoes__item", { hasText: "Safari no iPhone" }).getByRole("button", { name: "Encerrar" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Encerrar a sessão" }).click();
  await expect(list.locator(".sessoes__item")).toHaveCount(2);
  await expect(list).not.toContainText("Safari no iPhone");
});

test("convite: a pessoa cria senha e código; o link velho mostra gone.invite", async ({ page }) => {
  test.setTimeout(60_000);
  await open(page, "/admin/?mock=normal");
  const invited = (await db(page)).users.find((u) => u.status === "invited");
  // um reenvio dá um novo prazo: o link do antigo para de funcionar
  await open(page, `/admin/entrar/convite/${inviteToken({ ...invited, invite_expires_at: "2026-01-01T00:00:00.000Z" })}`);
  await expect(page.getByRole("heading", { name: "O convite venceu" })).toBeVisible();
  await expect(page.getByText("Peça ao dono para mandar de novo.")).toBeVisible();
  await bothThemes(page);

  await open(page, `/admin/entrar/convite/${inviteToken(invited)}`);
  await expect(page.getByRole("heading", { level: 1, name: "Entrar para a equipe" })).toBeVisible();
  await expect(page.getByText("como gerente")).toBeVisible();
  await page.getByLabel("Seu nome").fill("Isadora Nunes");
  await page.getByLabel("Crie uma senha").fill("mate gelado no quintal");
  await page.getByLabel("Repita a senha").fill("mate gelado no quintal");
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByLabel("Código do aplicativo").fill("123456");
  await page.getByRole("button", { name: "Ligar a verificação" }).click();
  await page.getByLabel("Guardei os códigos num lugar seguro").check();
  await page.getByRole("button", { name: "Entrar no painel" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Hoje" })).toBeVisible();
  if (!isPhone()) {
    await expect(page.locator(".trilho__pessoa")).toContainText("Isadora Nunes");
    await expect(page.locator(".trilho").getByRole("link", { name: "Equipe" })).toHaveCount(0);
  }
  // usado: o mesmo link não abre mais
  await signOut(page);
  await open(page, `/admin/entrar/convite/${inviteToken(invited)}`);
  await expect(page.getByRole("heading", { name: "O convite venceu" })).toBeVisible();
});

test("confirmar identidade: um diálogo só, que confere senha e código", async ({ page }) => {
  test.skip(isPhone(), "uma vez no computador basta");
  await open(page, "/admin/configuracoes/aparelhos-e-impressoras?papel=dono&mock=normal");
  const row = page.locator(".cfg-aparelho", { hasText: "Tablet do salão" });
  await row.getByRole("button", { name: "Revogar" }).click();
  await page.getByRole("dialog", { name: "Revogar Tablet do salão?" }).getByRole("button", { name: "Revogar o aparelho" }).click();
  const who = page.getByRole("dialog", { name: "Confirme que é você" });
  await who.getByLabel("Senha").fill("qualquer-coisa");
  await who.getByLabel("Código do aplicativo").fill("123456");
  await who.getByRole("button", { name: "Confirmar" }).click();
  await expect(who.getByText("A senha não confere.")).toBeVisible();
  await expect(row.locator(".badge")).toHaveText("aprovado");
  await bothThemes(page);
  await who.getByLabel("Senha").fill("admin");
  await who.getByLabel("Código do aplicativo").fill("654321");
  await who.getByRole("button", { name: "Confirmar" }).click();
  await expect(who.getByText(/O código não confere/)).toBeVisible();
  await who.getByLabel("Código do aplicativo").fill("123456");
  await who.getByRole("button", { name: "Confirmar" }).click();
  await expect(who).toHaveCount(0);
  await expect(page.locator(".cfg-aparelho", { hasText: "Tablet do salão" }).locator(".badge")).toHaveText("revogado");

  // os 5 minutos do servidor acabaram antes (confirmado com 4 min 50 s): 403 reauth_required, pede
  // de novo ali mesmo, e a ação segue sem sair do painel
  await page.evaluate(() => sessionStorage.setItem("territorio:mock-reauth", JSON.stringify(Date.now() - 6 * 60_000)));
  await page.locator(".cfg-aparelho", { hasText: "Computador da recepção" }).getByRole("button", { name: "Revogar" }).click();
  await page.getByRole("dialog", { name: "Revogar Computador da recepção?" }).getByRole("button", { name: "Revogar o aparelho" }).click();
  await who.getByLabel("Senha").fill("admin");
  await who.getByLabel("Código do aplicativo").fill("123456");
  await who.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.locator(".cfg-aparelho", { hasText: "Computador da recepção" }).locator(".badge")).toHaveText("revogado");
  await expect(page.getByRole("heading", { level: 1, name: "Configurações" })).toBeVisible();
});

test("sessão vencida no meio: entra de novo por cima e grava o que foi digitado", async ({ page }) => {
  await open(page, "/admin/equipe?papel=dono&mock=normal");
  await page.getByRole("button", { name: "Cadastrar só com PIN" }).click();
  const form = page.getByRole("dialog", { name: "Cadastrar só com PIN" });
  await form.getByLabel("Nome").fill("Joana Arce");
  await form.getByLabel(/Celular/).fill("45 99911-2233");
  // a sessão acaba no servidor enquanto o formulário está aberto
  await page.evaluate(() => {
    sessionStorage.removeItem("territorio:mock-papel");
    sessionStorage.setItem("territorio:mock-equipe", JSON.stringify({ id: "vencida" }));
    history.replaceState(null, "", location.pathname);
  });
  await form.getByRole("button", { name: "Cadastrar" }).click();
  const again = page.getByRole("dialog", { name: "Você saiu do painel" });
  await expect(again).toBeVisible();
  await expect(again.getByText("A tela continua onde estava.")).toBeVisible();
  await expect(again.getByLabel("E-mail", { exact: true })).toHaveValue("marcus@territorio.test");
  await again.getByLabel("Senha", { exact: true }).fill("admin");
  await again.getByRole("button", { name: "Entrar", exact: true }).click();
  await again.getByLabel("Código do aplicativo").fill("123456");
  await again.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByText("Joana Arce cadastrada").first()).toBeVisible();
  await expect(form).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Equipe" })).toBeVisible();
});

test("o carregando é a raiz girando a cada 2 s, parada com menos movimento", async ({ page }) => {
  await page.goto("/admin/?papel=dono&mock=lento", { waitUntil: "commit" });
  const root = page.getByRole("status").filter({ hasText: "Abrindo o painel…" }).locator(".raiz--gira");
  await expect(root).toBeVisible();
  expect(await root.evaluate((el) => getComputedStyle(el).animationDuration)).toBe("2s");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/admin/?papel=dono&mock=lento", { waitUntil: "commit" });
  await expect(root).toBeVisible();
  expect(await root.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
});

test("a recepção ganha e perde uma área escolhida pelo dono", async ({ page }) => {
  // no celular o "Mais" fechado fica fora da árvore de acessibilidade: conta os links pelo texto
  const agenda = () => page.locator(isPhone() ? ".barra a, .mais a" : ".trilho a", { hasText: /^Agenda$/ });
  const setAgenda = (give) =>
    page.evaluate(async ([on, pass]) => {
      // o dono, em outra sessão, muda o perfil da recepção
      history.replaceState(history.state, "", location.pathname);
      sessionStorage.setItem("territorio:mock-papel", JSON.stringify("dono"));
      // o dono confirmou a identidade há pouco (história 1.7: a janela de 5 minutos)
      sessionStorage.setItem("territorio:mock-reauth", JSON.stringify(Date.now()));
      const floor = ["hoje", "reservas", "salao", "espera", "cardapio", ...(on ? ["agenda"] : [])];
      const response = await fetch("/api/v1/staff/permissions", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "mock-csrf-equipe" },
        body: JSON.stringify({ allowed: { floor }, password: pass }),
      });
      sessionStorage.setItem("territorio:mock-papel", JSON.stringify("recepcao"));
      return response.status;
    }, [give, DEMO_PASSWORD]);
  await open(page, "/admin/?papel=recepcao&mock=normal");
  await expect(page.getByRole("heading", { level: 1, name: "Hoje" })).toBeVisible();
  await expect(agenda()).toHaveCount(0);
  expect(await setAgenda(true)).toBe(200);
  // no próximo pedido o menu acompanha
  await page.locator(isPhone() ? ".barra" : ".trilho").getByRole("link", { name: "Reservas", exact: true }).click();
  await expect(agenda()).toHaveCount(1);
  await page.goto("/admin/agenda");
  await expect(page.getByRole("heading", { level: 1, name: "Agenda" })).toBeVisible();
  expect(await setAgenda(false)).toBe(200);
  await page.evaluate(() => window.dispatchEvent(new PopStateEvent("popstate")));
  await expect(page.getByRole("heading", { level: 1, name: "Essa parte é de outro perfil da equipe" })).toBeVisible();
  await expect(agenda()).toHaveCount(0);
});
