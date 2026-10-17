// Testes de permissão (histórias 5.11, 5.17, 5.18, 1.9, 1.13, 1.15 e 3.12): o que a tela esconde do
// gerente e da recepção, o mock também recusa. Cada rota só do dono chamada direto por
// outro perfil responde 403 forbidden, e as rotas sensíveis do dono respondem 403
// reauth_required sem a confirmação de identidade, seja qual for a senha que venha no corpo.
import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 60_000 });

async function open(page, url) {
  await page.addInitScript(() => localStorage.setItem("territorio:demo-open", "false"));
  await page.goto(url);
  await page.waitForSelector("html[data-ready]");
}

const db = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("territorio:mock-db")));

/** Uma chamada direta à API, como a tela mandaria (com o token CSRF da sessão). */
function call(page, method, path, body) {
  return page.evaluate(
    async ([m, p, b]) => {
      const session = await (await fetch("/api/v1/staff/auth/session")).json().catch(() => ({}));
      const headers = { "Content-Type": "application/json", Accept: "application/json" };
      if (session?.csrf_token) headers["X-CSRF-Token"] = session.csrf_token;
      const response = await fetch(`/api/v1${p}`, { method: m, headers, body: b === undefined ? undefined : JSON.stringify(b) });
      return { status: response.status, type: (await response.json().catch(() => null))?.type ?? null };
    },
    [method, path, body],
  );
}

/** As rotas só do dono, com os ids dos dados semeados. */
async function ownerRoutes(page) {
  const state = await db(page);
  const customer = state.customers.find((c) => !c.anonymized_at) || state.customers[0];
  const person = state.users.find((u) => u.role === "floor" && u.status === "active");
  const manager = state.users.find((u) => u.role === "manager" && u.status === "active");
  return [
    ["POST", "/staff/reservations/export", { from: "2026-10-01", to: "2026-10-31" }, "exportar as reservas (5.11)"],
    ["POST", `/staff/customers/${customer.id}/export`, {}, "exportar os dados do cliente (5.17)"],
    ["POST", `/staff/customers/${customer.id}/anonymize`, {}, "anonimizar o cliente (5.17)"],
    ["GET", "/staff/privacy/requests", undefined, "pedidos de dados do site (5.18)"],
    ["GET", "/staff/users", undefined, "a equipe (1.9)"],
    ["PATCH", `/staff/users/${person.id}`, { role: "manager", password: "admin" }, "mudar o perfil (1.9)"],
    ["PATCH", `/staff/users/${person.id}`, { status: "disabled" }, "desativar (1.9)"],
    ["POST", `/staff/users/${manager.id}/mfa/reset`, { password: "admin" }, "zerar a verificação (1.9)"],
    ["POST", `/staff/users/${person.id}/revoke-sessions`, {}, "encerrar as sessões de outra pessoa (1.9)"],
    ["GET", "/staff/permissions", undefined, "ver as permissões (1.15)"],
    ["PUT", "/staff/permissions", { allowed: { manager: [], floor: [] }, password: "admin" }, "gravar as permissões (1.15)"],
    ["POST", "/staff/audit/export", { password: "admin" }, "exportar o registro (1.13)"],
    ["PUT", "/staff/onboarding", { dismissed: true }, "mexer no primeiro acesso (3.12)"],
  ];
}

for (const [papel, label] of [
  ["gerente", "gerente"],
  ["recepcao", "recepção"],
]) {
  test(`${label}: cada rota só do dono, chamada direto, recebe 403 forbidden`, async ({ page }) => {
    await open(page, `/admin/?papel=${papel}&mock=normal`);
    for (const [method, path, body, what] of await ownerRoutes(page)) {
      const answer = await call(page, method, path, body);
      expect.soft(answer.status, what).toBe(403);
      expect.soft(answer.type, what).toBe("forbidden");
    }
    // nada mudou por trás da tela
    const state = await db(page);
    expect(state.users.filter((u) => u.status === "disabled").map((u) => u.name)).toEqual(["Paulo Henrique Silva"]);
  });
}

test("dono: ação sensível sem confirmar a identidade recebe reauth_required, com qualquer senha no corpo", async ({ page }) => {
  await open(page, "/admin/?papel=dono&mock=normal");
  const state = await db(page);
  const person = state.users.find((u) => u.role === "floor" && u.status === "active");
  const manager = state.users.find((u) => u.role === "manager" && u.status === "active");
  for (const [method, path, body] of [
    ["PATCH", `/staff/users/${person.id}`, { role: "manager", password: "qualquer" }],
    ["POST", `/staff/users/${manager.id}/mfa/reset`, { password: "qualquer" }],
    ["PUT", "/staff/permissions", { allowed: { manager: [], floor: [] }, password: "qualquer" }],
    ["POST", "/staff/audit/export", { password: "qualquer" }],
  ]) {
    const answer = await call(page, method, path, body);
    expect.soft(answer.status, path).toBe(403);
    expect.soft(answer.type, path).toBe("reauth_required");
  }
  // com a identidade confirmada, a mesma mudança passa
  expect((await call(page, "POST", "/staff/auth/reauth", { password: "admin", code: "123456" })).status).toBe(204);
  expect((await call(page, "PATCH", `/staff/users/${person.id}`, { role: "manager" })).status).toBe(200);
});
