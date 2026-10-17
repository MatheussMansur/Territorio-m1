// A noite do salão (histórias 6.2 a 6.14): a tolerância dos ajustes salvos (0 é
// "em ponto", e cada mistura de "depois da tolerância" e "ao fim da tolerância"), o contador no
// modo lista, dois aparelhos no mesmo "Chegou", o aparelho na linha do tempo e os dados de giro,
// as mensagens prontas com "avisado às" e o WhatsApp fora do ar, a porta do evento, a folha e
// as suas mudanças, o fechamento da noite, as notas do papel, o retrato da noite sem
// conexão e o sistema fora do ar. O relógio do mock é fixado com ?agora= na data de hoje.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { DEMO_TIME, tonight as nightOf } from "./noite-helpers.js";

test.setTimeout(120_000);

async function serious(page) {
  // uma troca de tema esmaece as cores e a capa entra aos poucos; medido no meio, o contraste sai errado
  // (animações sem fim e guiadas pela rolagem, como as raízes girando, nunca acabam: ficam como estão)
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

/** A data de hoje pelo mock (a próxima noite aberta), semeada às 20:40 seja qual for a hora. */
const tonight = (page) => nightOf(page, open);

/** Muda os dados salvos do mock, depois recarrega para o mock ler. */
async function editState(page, change) {
  // aplicado antes de o app rodar na próxima carga (uma vez), para uma gravação da página aberta nunca desfazer
  const id = `teste-patch-${Math.random().toString(36).slice(2)}`;
  await page.addInitScript(
    ({ code, id }) => {
      if (sessionStorage.getItem(id)) return;
      const raw = localStorage.getItem("territorio:mock-db");
      if (!raw) return;
      const db = JSON.parse(raw);
      new Function("db", code)(db);
      localStorage.setItem("territorio:mock-db", JSON.stringify(db));
      sessionStorage.setItem(id, "1");
    },
    { code: change, id },
  );
  await page.reload();
  await page.waitForSelector("html[data-ready]");
}

/** Um POST à API do mock como a tela manda (com o token CSRF da sessão). */
async function call(page, path, body, key) {
  return page.evaluate(
    async ({ path, body, key }) => {
      const session = await fetch("/api/v1/staff/auth/session").then((r) => r.json());
      const headers = { "Content-Type": "application/json", "X-CSRF-Token": session.csrf_token };
      if (key) headers["Idempotency-Key"] = key;
      const r = await fetch(`/api/v1${path}`, { method: "POST", headers, body: JSON.stringify(body) });
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    { path, body, key },
  );
}

/** A mesa na planta (computador) ou a sua linha na lista (celular): só a visível conta. */
const table = (page, code) => page.locator(`.table-node[data-mesa="${code}"], .linha-mesa[data-mesa="${code}"]`).locator("visible=true");

async function confirmIdentity(page) {
  const dialog = page.getByRole("dialog", { name: /Confirme|Exportar/ });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Senha").fill("admin");
  await dialog.getByLabel("Código do aplicativo").fill("123456");
  await dialog.getByRole("button", { name: /^Confirmar/ }).click();
  await expect(dialog).toBeHidden();
}

test("tolerância perde a prioridade: a mesa atrasada fica para quem chega, e Não veio é da recepção", async ({ page }) => {
  const date = await tonight(page);
  await open(page, `/admin/salao?papel=recepcao&mock=normal&agora=${date}T21:25`);
  // Paula (21:00, S6) passou dos 20 min de tolerância
  await expect(table(page, "S6")).toContainText("atrasada");
  await table(page, "S6").click();
  const drawer = page.locator(".salao__gaveta");
  await expect(drawer).toContainText("A tolerância acabou às");
  await expect(drawer).toContainText("deixa de ser prioridade");
  await expect(drawer.getByRole("button", { name: "Não veio" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Sentar quem chegou" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Liberar a mesa" })).toHaveCount(0);
  await bothThemes(page);
});

test("com libera a mesa, a recepção solta a mesa e a reserva espera o Não veio", async ({ page }) => {
  const date = await tonight(page);
  await open(page, `/admin/salao?papel=recepcao&mock=normal&agora=${date}T21:25`);
  await editState(page, "db.settings.booking.data.after_tolerance = 'release'; db.settings.floor.data.on_tolerance_end = 'suggest_no_show';");
  await table(page, "S6").click();
  const drawer = page.locator(".salao__gaveta");
  await expect(drawer).toContainText("A reserva perde a mesa");
  await drawer.getByRole("button", { name: "Liberar a mesa" }).click();
  await expect(page.locator(".toast").getByText("Mesa S6 livre")).toBeVisible();
  await expect(table(page, "S6")).toContainText("livre");
  // a reserva ainda está lá para chegar: "Quem chegou?" pede uma mesa
  await page.getByRole("searchbox", { name: "Quem chegou?" }).fill("Paula");
  await page.getByRole("searchbox", { name: "Quem chegou?" }).press("Enter");
  await expect(page.locator(".salao__gaveta")).toContainText("foi liberada no fim da tolerância");
});

test("com soltar sozinho, a simulação solta a mesa no fim da tolerância", async ({ page }) => {
  const date = await tonight(page);
  await open(page, `/admin/salao?papel=recepcao&mock=normal&agora=${date}T21:10`);
  await editState(page, "db.settings.booking.data.after_tolerance = 'release'; db.settings.floor.data.on_tolerance_end = 'auto_release';");
  await expect(table(page, "S6")).toContainText("atrasada");
  await page.goto(`/admin/salao?agora=${date}T21:25`);
  await page.waitForSelector("html[data-ready]");
  await expect(table(page, "S6")).toContainText("livre");
  await expect(page.locator(".salao__regra")).toContainText("sozinha");
});

test("tolerância 0: a mesa espera em ponto, e a contagem tem o horário-limite para o leitor de tela", async ({ page }) => {
  const date = await tonight(page);
  await open(page, `/admin/salao?papel=recepcao&mock=normal&agora=${date}T20:55`);
  await editState(page, "db.settings.booking.data.tolerance_min = 0;");
  await table(page, "S6").click();
  await expect(page.locator(".salao__gaveta")).toContainText("A mesa espera às 21:00 em ponto");
  await expect(page.locator(".salao__regra")).toContainText("em ponto");
  await page.keyboard.press("Escape");
  await editState(page, "db.settings.booking.data.tolerance_min = 20;");
  await page.goto(`/admin/salao?agora=${date}T21:10`);
  await page.waitForSelector("html[data-ready]");
  if (test.info().project.name === "computador") await expect(page.locator('.table-node[data-mesa="S6"]')).toHaveAttribute("aria-label", /atrasada\. A mesa espera até 21:20/);
});

test("balcão em modo lista: senta sem escolher mesa e conta as pessoas", async ({ page }) => {
  await tonight(page);
  await editState(page, "for (const l of db.layouts) for (const a of l.areas) if (a.key === 'balcao') { a.mode = 'list'; a.list_capacity = 8; }");
  await page.getByRole("button", { name: "Sentar no balcão" }).locator("visible=true").first().click();
  const drawer = page.locator(".salao__gaveta");
  await expect(drawer).toContainText("Aqui não se escolhe mesa");
  await bothThemes(page);
  await drawer.getByRole("button", { name: "Sentar", exact: true }).click();
  await expect(page.locator(".toast").first()).toContainText("sem reserva");
  await expect(page.locator(".salao__contagem").locator("visible=true").first()).toContainText("de 8 pessoas");
});

test("Chegou em dois aparelhos: o segundo recebe quem marcou, e o registro guarda o aparelho", async ({ page }) => {
  const date = await tonight(page);
  await open(page, `/admin/salao?papel=recepcao&mock=normal&agora=${date}T20:58`);
  const id = await page.evaluate(() => fetch("/api/v1/staff/floor").then((r) => r.json()).then((f) => f.reservations.find((r) => r.code && r.customer.name === "Paula").id));
  const body = { action: "check_in", people: 2, table_codes: ["S6"], occurred_at: new Date().toISOString() };
  const answers = [await call(page, `/staff/reservations/${id}/actions`, body, "aparelho-1"), await call(page, `/staff/reservations/${id}/actions`, body, "aparelho-2")];
  expect(answers[0].status).toBe(200);
  expect(answers[1].status).toBe(409);
  expect(answers[1].body.detail).toMatch(/Chegada já marcada por .+ às \d{2}:\d{2}/);
  // o registro do dono tem quem, o aparelho e a hora real
  await page.goto("/admin/registro?papel=dono");
  await page.waitForSelector("html[data-ready]");
  const entry = page.locator("li, tr").filter({ hasText: "Chegou: Paula" }).first();
  await expect(entry).toContainText("Computador da recepção");
});

test("linha do tempo da mesa com o aparelho, e a sessão encerrada pronta para o giro", async ({ page }) => {
  const date = await tonight(page);
  await open(page, `/admin/salao?papel=recepcao&mock=normal&agora=${date}T${DEMO_TIME}`);
  await table(page, "S1").click();
  const drawer = page.locator(".salao__gaveta");
  await drawer.getByRole("button", { name: "Linha do tempo" }).click();
  await expect(drawer.locator(".linha-tempo")).toContainText("mesa aberta");
  await expect(drawer.locator(".linha-tempo")).toContainText("Computador da recepção");
  await drawer.getByRole("button", { name: "Voltar" }).click();
  await drawer.getByRole("button", { name: "Liberar mesa" }).click();
  await expect(table(page, "S1")).toContainText("livre");
  const closed = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem("territorio:mock-db"));
    return db.table_sessions.filter((s) => s.status === "closed" && !s.undone);
  });
  expect(closed.length).toBeGreaterThan(0);
  for (const s of closed) {
    expect(s.seated_at).toBeTruthy();
    expect(s.released_at).toBeTruthy();
    expect(s.people).toBeGreaterThan(0);
  }
  const detail = await page.evaluate((id) => fetch(`/api/v1/staff/floor/sessions/${id}`).then((r) => r.json()), closed[0].id);
  expect(detail.duration_min).toBeGreaterThan(0);
});

test("mensagem pronta pelo Salão: avisado às, repetir pergunta antes, WhatsApp fora desliga", async ({ page }) => {
  const date = await tonight(page);
  await open(page, `/admin/salao?papel=recepcao&mock=normal&agora=${date}T21:30`);
  // Beatriz, 21:30 na Q5, tem WhatsApp
  await table(page, "Q5").click();
  const drawer = page.locator(".salao__gaveta");
  await drawer.getByText("Mensagens prontas").click();
  await drawer.getByRole("button", { name: "Sua mesa está pronta" }).click();
  await expect(page.locator(".toast").getByText("Mensagem enviada")).toBeVisible();
  await expect(drawer).toContainText("avisado às");
  await drawer.getByRole("button", { name: "Sua mesa está pronta" }).click();
  const again = page.getByRole("dialog", { name: "Mandar de novo?" });
  await expect(again).toContainText("Você já mandou essa às");
  await again.getByRole("button", { name: "Voltar" }).click();
  await page.keyboard.press("Escape");

  await page.goto(`/admin/salao?whatsapp=fora&agora=${date}T21:30`);
  await page.waitForSelector("html[data-ready]");
  await table(page, "Q5").click();
  await page.locator(".salao__gaveta").getByText("Mensagens prontas").click();
  await expect(page.locator(".salao__gaveta")).toContainText("O WhatsApp da casa está fora");
  await expect(page.locator(".salao__gaveta").getByRole("button", { name: "Sua mesa está pronta" })).toBeDisabled();
  await bothThemes(page);
});

test("porta do evento: lista vazia, pôr para dentro, chegou e desfazer; imprimir e exportar do dono", async ({ page }) => {
  await open(page, "/admin/salao?papel=dono&mock=normal");
  const id = await page.evaluate(() => JSON.parse(localStorage.getItem("territorio:mock-db")).events[0].id);
  await page.goto(`/admin/salao/porta?evento=${id}`);
  await page.waitForSelector("html[data-ready]");
  await expect(page.getByText("A lista ainda está vazia.")).toBeVisible();
  await bothThemes(page);
  await page.getByRole("button", { name: "Pôr para dentro" }).click();
  await page.getByLabel("Nome", { exact: true }).fill("Joana Ribeiro");
  await page.getByRole("button", { name: "Mais uma pessoa" }).click();
  await page.locator(".porta__entrar").getByRole("button", { name: "Pôr para dentro" }).click();
  const line = page.locator(".porta__linha").filter({ hasText: "Joana" });
  await expect(line).toContainText("chegou às");
  await expect(page.locator(".porta__numeros")).toContainText("3");
  await line.getByRole("button", { name: /Desfazer/ }).click();
  await expect(line.getByRole("button", { name: "Chegou" })).toBeVisible();
  await line.getByRole("button", { name: "Chegou" }).click();
  await page.locator(".porta__linha.is-chegando").getByRole("button", { name: "Confirmar chegada" }).click();
  await expect(line).toContainText("chegou às");
  await expect(page.getByRole("button", { name: "Imprimir lista da porta" })).toBeVisible();
  await page.getByRole("button", { name: "Exportar lista (CSV)" }).click();
  const download = page.waitForEvent("download");
  await confirmIdentity(page);
  expect((await download).suggestedFilename()).toMatch(/^lista-.*\.csv$/);

  // o gerente imprime, mas não exporta
  await page.goto(`/admin/salao/porta?evento=${id}&papel=gerente`);
  await page.waitForSelector("html[data-ready]");
  await expect(page.getByRole("button", { name: "Imprimir lista da porta" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Exportar lista (CSV)" })).toHaveCount(0);
  const direct = await call(page, `/staff/events/${id}/guests/export`, {});
  expect(direct.status).toBe(403);
  expect(direct.body.type).toBe("forbidden");
});

test("folha da noite: imprimir tira o alerta do Hoje, e as mudanças depois saem na folha curta", async ({ page }) => {
  const date = await tonight(page);
  await open(page, `/admin/?papel=gerente&mock=normal&agora=${date}T19:30`);
  await editState(page, "db.settings.floor.data.print_sheet_mode = 'at_time'; db.settings.floor.data.print_sheet_at = '19:00';");
  const alert = page.locator(".hoje-alerta--print_sheet");
  await expect(alert).toContainText("Imprima a folha da noite");
  await page.goto("/admin/salao/folha");
  await page.waitForSelector("html[data-ready]");
  await page.evaluate(() => (window.print = () => {}));
  const printed = page.waitForResponse((r) => r.url().includes("/staff/night/sheet"));
  await page.getByRole("button", { name: "Imprimir ou salvar PDF" }).click();
  await printed;
  // uma reserva nova para hoje depois da folha (o relógio do mock avança para 19:35)
  await page.goto(`/admin/salao/folha?agora=${date}T19:35`);
  await page.waitForSelector("html[data-ready]");
  const made = await call(page, "/staff/reservations", { source: "phone", party_size: 2, date, time: "21:30", name: "Clara Moraes", locale: "pt", flags: [], override_reason: "Teste da folha" }, "folha-depois");
  expect(made.status).toBe(201);
  await page.goto(`/admin/?agora=${date}T19:40`);
  await page.waitForSelector("html[data-ready]");
  await expect(page.locator(".hoje-alerta--print_sheet")).toHaveCount(0);
  await expect(page.locator(".hoje-folha")).toContainText(/\d+ mudanças? desde a folha das 19:30/, { timeout: 15_000 });
  await page.getByRole("link", { name: "Imprimir só as mudanças" }).click();
  await expect(page.getByRole("heading", { name: /Mudanças desde a folha/ })).toBeVisible();
  await expect(page.locator(".folha")).toContainText("entrou");
  await expect(page.locator(".folha")).toContainText("Clara");
  await bothThemes(page);
});

test("fechamento da noite: aviso 15 min antes com adiar, e depois tudo com estado final", async ({ page }) => {
  const date = await tonight(page);
  await open(page, `/admin/salao?papel=gerente&mock=normal&agora=${date}T23:20`);
  await editState(page, "db.settings.floor.data.night_close_delay_min = 0;");
  // uma ação nos últimos 30 min numa mesa aberta
  expect((await call(page, "/staff/floor/walk-ins", { table_codes: ["Q7"], party_size: 2 }, "fecha-1")).status).toBe(201);
  await page.reload();
  await page.waitForSelector("html[data-ready]");
  await expect(page.getByText(/A noite fecha às 23:30:/)).toBeVisible();
  await page.getByRole("button", { name: "Adiar 1 h" }).first().click();
  await expect(page.locator(".toast").getByText("Fechamento adiado")).toBeVisible();

  // passado o fechamento: nenhuma reserva da noite sem estado final
  await page.goto(`/admin/salao?papel=recepcao&agora=${date}T23:31`);
  await page.waitForSelector("html[data-ready]");
  await editState(page, "db.nights[Object.keys(db.nights).find((d) => db.nights[d].postponed)].postponed = false;");
  await expect(page.getByText("A noite já fechou.").first()).toBeVisible();
  const left = await page.evaluate((day) => {
    const db = JSON.parse(localStorage.getItem("territorio:mock-db"));
    return db.reservations.filter((r) => r.date === day && ["pending", "confirmed", "waitlisted", "offered"].includes(r.status)).length;
  }, date);
  expect(left).toBe(0);
  const openTables = await page.evaluate((day) => {
    const db = JSON.parse(localStorage.getItem("territorio:mock-db"));
    const ids = new Set(db.reservations.filter((r) => r.date === day).map((r) => r.id));
    return db.table_sessions.filter((s) => ids.has(s.reservation_id) && s.status === "open" && !s.undone).length;
  }, date);
  expect(openTables).toBe(0);
  // a recepção não pode mudar a noite fechada
  const answer = await call(page, "/staff/floor/walk-ins", { table_codes: ["Q2"], party_size: 2 }, "fecha-2");
  expect(answer.body.type).toBe("night_closed");
});

test("lançar do papel: hora no futuro pede conferir, hora certa grava com a hora anotada", async ({ page }) => {
  const date = await tonight(page);
  await open(page, `/admin/salao/papel?papel=recepcao&mock=normal&agora=${date}T21:00`);
  const line = page.locator(".papel__linha").filter({ hasText: "Beatriz" });
  await line.getByLabel("Chegou às").fill("21:40");
  await line.getByRole("button", { name: "Lançar chegada" }).click();
  await expect(line).toContainText("Confira a hora anotada");
  await line.getByLabel("Chegou às").fill("20:50");
  await line.getByRole("button", { name: "Lançar chegada" }).click();
  await expect(line).toContainText("Chegada às 20:50 lançada.");
  const at = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem("territorio:mock-db"));
    const c = db.customers.find((x) => x.name === "Beatriz");
    return db.reservations.find((r) => r.customer_id === c.id && r.status === "completed")?.arrived_at;
  });
  expect(new Date(at).toISOString()).toBe(new Date(`${date}T20:50:00-03:00`).toISOString());
  await bothThemes(page);
});

test("noite fechada: o papel vai para o dono ou o gerente corrigir no Hoje", async ({ page }) => {
  const date = await tonight(page);
  await open(page, `/admin/salao/papel?papel=recepcao&mock=normal&agora=${date}T23:40`);
  await editState(page, "db.settings.floor.data.night_close_delay_min = 0;");
  const line = page.locator(".papel__linha").filter({ hasText: "Beatriz" });
  await line.getByLabel("Chegou às").fill("21:35");
  await line.getByRole("button", { name: "Lançar chegada" }).click();
  await page.getByRole("button", { name: "Mandar para o dono ou o gerente corrigir" }).click();
  await expect(page.locator(".toast").getByText("Mandado para corrigir")).toBeVisible();
  await page.goto(`/admin/?papel=gerente&agora=${date}T23:45`);
  await page.waitForSelector("html[data-ready]");
  const alert = page.locator(".hoje-alerta--paper_correction");
  await expect(alert).toContainText("Beatriz");
  await alert.getByRole("button", { name: "Aplicar" }).click();
  await expect(page.locator(".toast").getByText("Correção aplicada")).toBeVisible();
  await expect(page.locator(".hoje-alerta--paper_correction")).toHaveCount(0);
});

test("sem conexão: o Salão mostra o retrato da noite, só leitura, e gravar abre o aviso", async ({ page, context }) => {
  await open(page, "/admin/salao?papel=recepcao&mock=normal");
  await expect(table(page, "S1")).toBeVisible();
  // o retrato está no aparelho
  await expect.poll(() => page.evaluate(() => new Promise((ok) => {
    const req = indexedDB.open("territorio-painel");
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("retrato")) return db.close(), ok(false);
      const get = db.transaction("retrato").objectStore("retrato").get("noite");
      get.onsuccess = () => (db.close(), ok(Boolean(get.result)));
      get.onerror = () => (db.close(), ok(false));
    };
    req.onerror = () => ok(false);
  }))).toBe(true);
  await context.setOffline(true);
  const band = page.locator(".retrato-faixa[data-modo='offline.panel']");
  await expect(band).toContainText("Sem conexão. Você vê a noite como estava às");
  await expect(band.getByRole("link", { name: "Imprimir a folha" })).toBeVisible();
  await table(page, "Q7").click();
  await expect(page.getByRole("dialog", { name: "Sem conexão agora" })).toBeVisible();
  await bothThemes(page);
  await page.getByRole("button", { name: "Entendi" }).click();
  await context.setOffline(false);
  await expect(page.locator(".retrato-faixa[data-modo='offline_backlog']")).toContainText("A conexão voltou");
  await expect(page.getByRole("link", { name: "Lançar do papel" }).first()).toBeVisible();
});

test("sem retrato desta noite no aparelho: use a folha impressa", async ({ page, context }) => {
  await open(page, "/admin/espera?papel=recepcao&mock=normal");
  await expect(page.getByRole("button", { name: "Pôr na espera quem chegou" })).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => new Promise((ok) => {
    const del = indexedDB.deleteDatabase("territorio-painel");
    del.onsuccess = del.onerror = del.onblocked = () => ok();
  }));
  await context.setOffline(true);
  await expect(page.getByText("este aparelho não tem o retrato desta noite")).toBeVisible({ timeout: 10_000 });
  await context.setOffline(false);
});

test("noite fechada: o gerente corrige com motivo, e o motivo vai ao registro (6.14)", async ({ page }) => {
  const date = await tonight(page);
  await open(page, `/admin/salao?papel=gerente&mock=normal&agora=${date}T23:20`);
  expect((await call(page, "/staff/night/close", { date }, "fecha-motivo")).status).toBe(200);
  // sem motivo a mudança é recusada, com a frase da casa
  const refused = await call(page, "/staff/floor/walk-ins", { table_codes: ["Q2"], party_size: 2 }, "corrige-sem");
  expect(refused.status).toBe(422);
  expect(refused.body.reason).toBe("correction_reason_required");

  await page.reload();
  await page.waitForSelector("html[data-ready]");
  await expect(page.locator('[data-estado="noite-fechada"]')).toContainText("cada mudança pede o motivo");
  await table(page, "Q7").click();
  const drawer = page.locator(".salao__gaveta");
  await drawer.getByRole("button", { name: "Sentar sem reserva" }).click();
  await drawer.getByRole("button", { name: "Sentar", exact: true }).click();
  const ask = page.getByRole("dialog", { name: "A noite já fechou" });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Corrigir com motivo" }).click();
  await expect(ask.getByText("Escreva o motivo da correção.")).toBeVisible();
  await bothThemes(page);
  await ask.getByLabel("Motivo da correção").fill("Mesa sentada às 23:00 que a recepção esqueceu de lançar");
  await ask.getByRole("button", { name: "Corrigir com motivo" }).click();
  await expect(ask).toHaveCount(0);
  await expect(page.locator(".toast").first()).toContainText("sem reserva");
  const logged = await page.evaluate(() => JSON.parse(localStorage.getItem("territorio:mock-db")).audit.filter((e) => e.action === "reservation.walk_in").pop());
  expect(logged.summary).toContain("correção depois do fechamento: Mesa sentada às 23:00");
  expect(logged.changes.correction_reason.to).toContain("recepção esqueceu");
});

test("liberar a mesa oferece a vaga à espera na hora (7.16)", async ({ page }) => {
  const date = await tonight(page);
  await open(page, `/admin/salao?papel=gerente&mock=normal&agora=${date}T19:40`);
  const floor = await page.evaluate(() => fetch("/api/v1/staff/floor").then((r) => r.json()));
  const seated = floor.sessions.filter((s) => s.status === "open");
  expect(seated.length).toBeGreaterThan(0);
  for (const [i, s] of seated.entries()) {
    expect((await call(page, `/staff/floor/sessions/${s.id}/release`, {}, `libera-oferta-${i}`)).status).toBe(200);
  }
  const db = await page.evaluate(() => JSON.parse(localStorage.getItem("territorio:mock-db")));
  const freed = db.capacity_freed.filter((f) => f.reason === "release");
  expect(freed.length).toBe(seated.length);
  const offered = freed.flatMap((f) => f.offered_to);
  // cada oferta sai pelo WhatsApp com os seus minutos para aceitar
  for (const id of offered) {
    const r = db.reservations.find((x) => x.id === id);
    expect(r.status).toBe("offered");
    expect(r.messages.map((m) => m.template)).toContain("waitlist_offer");
  }
});

test("mesa presa por pedido pendente fica reservada mesmo depois da hora, e oferta aceita no meio recusa sentar (6.1)", async ({ page }) => {
  const date = await tonight(page);
  await open(page, `/admin/salao?papel=gerente&mock=normal&agora=${date}T21:25`);
  // uma mesa que ninguém usa hoje
  const free = await page.evaluate(() =>
    fetch("/api/v1/staff/floor")
      .then((r) => r.json())
      .then((f) => {
        const used = new Set([...f.reservations.flatMap((r) => r.table_codes || []), ...f.sessions.flatMap((s) => s.table_codes || [])]);
        return f.day.layout.tables.find((t) => !used.has(t.code))?.code;
      }),
  );
  expect(free).toBeTruthy();
  const id = "5b0e7a52-6f1c-4d55-9a61-0c3f2d8e7a11";
  // um pedido para as 21:00 ainda esperando a casa às 21:25 (nos dados salvos do mock)
  await editState(
    page,
    `const base = db.reservations.find((r) => r.date === "${date}" && r.status === "confirmed");
     const r = JSON.parse(JSON.stringify(base));
     Object.assign(r, { id: "${id}", code: "TR-PEND1", status: "pending", table_codes: ["${free}"], time: "21:00",
       starts_at: new Date("${date}T21:00:00-03:00").toISOString(), ends_at: new Date("${date}T23:00:00-03:00").toISOString(),
       pending_until: new Date("${date}T21:50:00-03:00").toISOString(), arrived_at: null, table_session_id: null, history: [], messages: [] });
     db.reservations.push(r);`,
  );
  await expect(table(page, free)).toContainText("reservada");
  await expect(table(page, free)).toContainText("pendente");
  const holds = await page.evaluate(() => fetch("/api/v1/staff/floor").then((r) => r.json()).then((f) => f.holds));
  expect(holds).toContainEqual(expect.objectContaining({ table_codes: [free], reason: "pending", reservation_id: id, time: "21:00" }));
  // o grupo da lista de espera aceitou a oferta desta mesa enquanto a recepção sentava alguém
  await editState(page, `Object.assign(db.reservations.find((r) => r.id === "${id}"), { status: "confirmed", pending_until: null, history: [{ at: new Date().toISOString(), actor_label: "Cliente", action: "offer_accepted", summary: "Aceitou a mesa oferecida" }] });`);
  const refused = await call(page, "/staff/floor/walk-ins", { table_codes: [free], party_size: 2 }, "senta-na-oferta");
  expect(refused.status).toBe(409);
  expect(refused.body.reason).toBe("table_taken");
});
