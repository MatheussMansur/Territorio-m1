// Equipe (histórias 1.9 e 1.15): convite por e-mail, cadastrar alguém só com o PIN,
// mudar um perfil com a confirmação de identidade, desativar, as chaves de permissão e os estados.
import AxeBuilder from "@axe-core/playwright";
import { expect as baseExpect, test } from "@playwright/test";

// o servidor de dev é compartilhado com outras baterias: dá folga às respostas lentas
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
  // a barra da demonstração fica dobrada, para nunca cobrir o que o teste clica
  await page.addInitScript(() => localStorage.setItem("territorio:demo-open", "false"));
  await page.goto(url);
  await page.waitForSelector("html[data-ready]");
}

async function confirmIdentity(page) {
  const dialog = page.getByRole("dialog", { name: /Confirme|Exportar/ });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Senha").fill("admin");
  await dialog.getByLabel("Código do aplicativo").fill("123456");
  await dialog.getByRole("button", { name: "Confirmar" }).click();
  await expect(dialog).toBeHidden();
}

test("dono convida, cadastra só com PIN, muda perfil e desativa", async ({ page }) => {
  await open(page, "/admin/equipe?papel=dono&mock=normal");
  await expect(page.getByRole("heading", { level: 1, name: "Equipe" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Débora Kato" })).toBeVisible();
  await bothThemes(page);

  // um e-mail que já está na equipe é recusado no campo
  await page.getByRole("button", { name: "Convidar por e-mail" }).click();
  let dialog = page.getByRole("dialog", { name: "Convidar por e-mail" });
  await dialog.getByLabel("E-mail").fill("debora@territorio.test");
  await dialog.getByRole("button", { name: "Mandar convite" }).click();
  await expect(dialog.getByText("Esse e-mail já é da equipe.")).toBeVisible();
  await dialog.getByLabel("E-mail").fill("joana@territorio.test");
  await dialog.getByRole("button", { name: "Mandar convite" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "joana@territorio.test" })).toBeVisible();

  await page.getByRole("button", { name: "Cadastrar só com PIN" }).click();
  dialog = page.getByRole("dialog", { name: "Cadastrar só com PIN" });
  await dialog.getByLabel("Nome").fill("Yuki Fernandes");
  await dialog.getByRole("textbox", { name: /Celular/ }).fill("45 99876-5432");
  await dialog.getByRole("button", { name: "Cadastrar" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".toast", { hasText: "O PIN é o final do celular: 5432." })).toBeVisible();

  await page.getByRole("button", { name: "Tainá Oliveira" }).click();
  const drawer = page.getByRole("dialog", { name: "Tainá Oliveira" });
  await drawer.getByRole("radio", { name: /Gerente/ }).check();
  await page.getByRole("dialog", { name: /vira gerente/ }).getByRole("button", { name: "Mudar perfil" }).click();
  await confirmIdentity(page);
  await expect(page.locator(".toast", { hasText: "Tainá Oliveira agora é gerente" })).toBeVisible();
  await drawer.getByRole("button", { name: "Desativar" }).click();
  await page.getByRole("dialog", { name: /Desativar Tainá/ }).getByRole("button", { name: "Desativar" }).click();
  await expect(drawer.getByRole("button", { name: "Reativar" })).toBeVisible();
  await drawer.getByRole("button", { name: "Fechar" }).click();
  await expect(drawer).toBeHidden();

  // continua depois de recarregar
  await page.reload();
  await page.waitForSelector("html[data-ready]");
  const row = page.locator(".tabela-equipe tr", { hasText: "Tainá Oliveira" });
  await expect(row).toContainText("Gerente");
  await expect(row).toContainText("Desativada");
});

test("permissões: dono sempre ligado, troca e volta ao padrão", async ({ page }) => {
  await open(page, "/admin/equipe/permissoes?papel=dono&mock=normal");
  await expect(page.getByText("O dono sempre vê tudo.")).toBeVisible();
  await expect(page.getByRole("img", { name: "Dono: Sistema, sempre ligada" })).toBeVisible();
  const floorClients = page.getByRole("switch", { name: "Recepção: Clientes" });
  await expect(floorClients).toHaveAttribute("aria-checked", "false");
  await bothThemes(page);

  await floorClients.click();
  await expect(floorClients).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("1 mudança para gravar")).toBeVisible();
  await page.getByRole("button", { name: "Gravar mudanças" }).click();
  await confirmIdentity(page);
  await expect(page.locator(".toast", { hasText: "Permissões gravadas" })).toBeVisible();

  await page.reload();
  await page.waitForSelector("html[data-ready]");
  await expect(page.getByRole("switch", { name: "Recepção: Clientes" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Voltar ao padrão" }).click();
  await page.getByRole("dialog", { name: "Voltar ao padrão?" }).getByRole("button", { name: "Voltar ao padrão" }).click();
  // confirmado há menos de 5 minutos: sem segunda confirmação de identidade (história 1.7)
  await expect(page.getByRole("dialog", { name: /Confirme/ })).toHaveCount(0);
  await expect(page.getByRole("switch", { name: "Recepção: Clientes" })).toHaveAttribute("aria-checked", "false");
});

test("gerente e recepção não abrem Equipe", async ({ page }) => {
  await open(page, "/admin/equipe?papel=gerente&mock=normal");
  await expect(page.getByRole("heading", { level: 1, name: "Essa parte é de outro perfil da equipe" })).toBeVisible();
  await open(page, "/admin/equipe/permissoes?papel=recepcao&mock=normal");
  await expect(page.getByRole("heading", { level: 1, name: "Essa parte é de outro perfil da equipe" })).toBeVisible();
});

test("só o dono na equipe: o vazio chama para convidar", async ({ page }) => {
  await open(page, "/admin/equipe?papel=dono&mock=vazio");
  await expect(page.getByText("Só você na equipe por enquanto")).toBeVisible();
  await bothThemes(page);
});

test("API fora mostra o aviso da casa no lugar", async ({ page }) => {
  await open(page, "/admin/equipe?papel=dono&mock=normal");
  await expect(page.getByRole("button", { name: "Débora Kato" })).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem("territorio:mock-scenario", JSON.stringify("erro")));
  await page.getByRole("link", { name: "Permissões" }).click();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("As permissões não abriram");
  await expect(alert).not.toContainText("Erro simulado");
  await bothThemes(page);
});

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

/** Os dados do mock, lidos do navegador. */
const db = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("territorio:mock-db")));

/** Uma chamada direta à API, como a tela mandaria (com o token CSRF da sessão). */
function call(page, method, path, body) {
  return page.evaluate(
    async ([m, p, b]) => {
      const session = await (await fetch("/api/v1/staff/auth/session")).json().catch(() => ({}));
      const headers = { "Content-Type": "application/json", Accept: "application/json" };
      if (session?.csrf_token) headers["X-CSRF-Token"] = session.csrf_token;
      const response = await fetch(`/api/v1${p}`, { method: m, headers, body: b === undefined ? undefined : JSON.stringify(b) });
      return { status: response.status, body: await response.json().catch(() => null) };
    },
    [method, path, body],
  );
}

test("zerar a verificação encerra as sessões da pessoa, e a confirmação vale 5 minutos", async ({ page }) => {
  await open(page, "/admin/equipe?papel=dono&mock=normal");
  await expect(page.getByRole("button", { name: "Débora Kato" })).toBeVisible();
  // Débora tem uma sessão aberta no celular
  await editState(
    page,
    `const debora = db.users.find((u) => u.name === "Débora Kato");
     db.auth ??= {};
     db.auth.sessions ??= [];
     db.auth.sessions.push({ id: "sessao-debora", user_id: debora.id, created_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3_600_000).toISOString(), ended_at: null, csrf: "x", device: "Chrome no Android", place: "Foz do Iguaçu, PR (aproximado)" });`,
  );

  // sem a confirmação de identidade, o servidor recusa (nunca com senha nenhuma)
  const id = (await db(page)).users.find((u) => u.name === "Débora Kato").id;
  const refused = await call(page, "POST", `/staff/users/${id}/mfa/reset`, { password: "qualquer" });
  expect(refused.status).toBe(403);
  expect(refused.body.type).toBe("reauth_required");

  await page.getByRole("button", { name: "Débora Kato" }).click();
  const drawer = page.getByRole("dialog", { name: "Débora Kato" });
  await drawer.getByRole("button", { name: "Zerar verificação em duas etapas" }).click();
  await page.getByRole("dialog", { name: /Zerar a verificação/ }).getByRole("button", { name: "Zerar verificação" }).click();
  await confirmIdentity(page);
  await expect(page.locator(".toast", { hasText: "As sessões de Débora Kato foram encerradas" })).toBeVisible();
  const after = await db(page);
  expect(after.auth.sessions.find((s) => s.id === "sessao-debora").ended_at).toBeTruthy();
  expect(after.users.find((u) => u.id === id).mfa_enabled).toBe(false);
  expect(after.audit.some((a) => a.action === "user.mfa_reset" && /1 sessão encerrada/.test(a.summary))).toBe(true);

  // dentro dos 5 minutos, outra mudança sensível passa direto
  await drawer.getByRole("radio", { name: /Recepção/ }).check();
  await page.getByRole("dialog", { name: /vira recepção/ }).getByRole("button", { name: "Mudar perfil" }).click();
  await expect(page.locator(".toast", { hasText: "Débora Kato agora é recepção" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: /Confirme/ })).toHaveCount(0);

  // depois dos 5 minutos, a confirmação volta
  await page.evaluate(() => {
    const old = Date.now() - 6 * 60_000;
    sessionStorage.setItem("territorio:painel-identidade", JSON.stringify(old));
    sessionStorage.setItem("territorio:mock-reauth", JSON.stringify(old));
  });
  await drawer.getByRole("radio", { name: /Gerente/ }).check();
  await page.getByRole("dialog", { name: /vira gerente/ }).getByRole("button", { name: "Mudar perfil" }).click();
  await confirmIdentity(page);
  await expect(page.locator(".toast", { hasText: "Débora Kato agora é gerente" })).toBeVisible();
});

test("desativar quem está no aparelho guarda o aparelho no registro e passa os avisos ao dono", async ({ page }) => {
  await open(page, "/admin/equipe?papel=dono&mock=normal");
  await expect(page.getByRole("button", { name: "Rodrigo Benítez" })).toBeVisible();
  // Rodrigo é o único que recebe os pedidos de última hora
  await editState(page, `db.settings.alerts.data.late_request_to = [db.users.find((u) => u.name === "Rodrigo Benítez").id];`);
  await page.getByRole("button", { name: "Rodrigo Benítez" }).click();
  const drawer = page.getByRole("dialog", { name: "Rodrigo Benítez" });
  await drawer.getByRole("button", { name: "Desativar" }).click();
  const ask = page.getByRole("dialog", { name: /Desativar Rodrigo/ });
  await expect(ask).toContainText("Só ela recebe os avisos de pedidos em cima da hora: eles passam para você, o dono.");
  await ask.getByRole("button", { name: "Desativar" }).click();
  await expect(page.locator(".toast", { hasText: "Os avisos de pedidos em cima da hora agora chegam para você" })).toBeVisible();

  const after = await db(page);
  const owner = after.users.find((u) => u.role === "owner" && u.status === "active");
  expect(after.settings.alerts.data.late_request_to).toEqual([owner.id]);
  const entry = after.audit.find((a) => a.action === "user.update" && /Desativou Rodrigo/.test(a.summary));
  expect(entry.summary).toContain("estava no Tablet do salão");
  expect(entry.changes.device.from).toBe("Tablet do salão");

  await open(page, "/admin/registro?papel=dono&mock=normal");
  await page.getByText(/Desativou Rodrigo Benítez \(estava no Tablet do salão\)/).first().waitFor();
});
