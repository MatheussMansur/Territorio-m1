// Hoje (histórias 5.1 e 5.2): os números da noite, quem chega agora, as colunas de horário, os
// alertas, os pedidos pendentes, a semana, a gaveta aberta a partir dela, os perfis, os estados vazio e
// de erro, no computador e no celular, com axe nos dois temas.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { tonight as nightOf } from "./noite-helpers.js";

// axe em dois temas numa página com muitas linhas leva tempo
test.setTimeout(90_000);

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

/** Abre o Hoje; num dia em que a casa está fechada, vai para a próxima noite. */
async function openNight(page, papel) {
  await page.goto(`/admin/?papel=${papel}&mock=normal`);
  await page.waitForSelector("html[data-ready]");
  await expect(page.locator(".hoje-topo")).toBeVisible({ timeout: 20_000 });
  const next = page.getByRole("button", { name: /^Ver a noite de/ });
  if (await next.isVisible()) {
    await next.click();
    await expect(page.locator(".hoje-stats")).toBeVisible();
  }
}

test("dono vê a noite, os alertas, os pedidos e a semana, e abre uma reserva", async ({ page }) => {
  await openNight(page, "dono");
  await expect(page.locator(".hoje-stats .stat")).toHaveCount(5);
  await expect(page.locator(".hoje-stats")).toContainText("pessoas esperadas");
  await expect(page.getByRole("heading", { name: "Horários" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Precisa de atenção" })).toBeVisible();
  await expect(page.locator(".hoje-alerta--large_group")).toContainText("Gustavo");
  await expect(page.locator(".hoje-alerta--onboarding").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /Pedidos esperando a casa/ })).toBeVisible();
  await expect(page.locator(".hoje-semana li")).toHaveCount(7);
  await bothThemes(page);

  // o pedido pendente abre na gaveta, com a sua linha do tempo, e o Esc devolve o foco
  const see = page.getByRole("button", { name: "Ver o pedido" }).first();
  await see.click();
  const drawer = page.locator(".res-gaveta");
  await expect(drawer.getByRole("heading", { name: "Gustavo" })).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "Linha do tempo" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: /^Aprovar/ })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Recusar" })).toBeVisible();
  await expect(drawer.locator(".feed-item")).not.toHaveCount(0);
  expect(await serious(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(see).toBeFocused();
});

test("aprovar um pedido pelo Hoje tira ele da lista de pendentes", async ({ page }) => {
  await openNight(page, "gerente");
  await page.getByRole("button", { name: "Ver o pedido" }).first().click();
  const drawer = page.locator(".res-gaveta");
  await drawer.getByRole("button", { name: /^Aprovar/ }).click();
  await expect(drawer.locator(".res-gaveta__selos")).toContainText("Confirmada");
  await expect(page.locator(".toast").first()).toContainText("Reserva aprovada");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: /Pedidos esperando a casa/ })).toHaveCount(0);
});

test("recepção vê a noite sem pedidos para aprovar nem pendências do primeiro uso", async ({ page }) => {
  await openNight(page, "recepcao");
  await expect(page.locator(".hoje-stats")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Pedidos esperando a casa/ })).toHaveCount(0);
  await expect(page.locator(".hoje-alerta--onboarding")).toHaveCount(0);
  // só o primeiro nome, e o detalhe de alimentação fica com a gerência
  const dietary = page.locator(".hoje-alerta--dietary");
  if (await dietary.count()) await expect(dietary.first()).toContainText("O detalhe fica com a gerência");
  await expect(page.locator(".hoje-chegada__quem b", { hasText: "Souza" })).toHaveCount(0);
  await bothThemes(page);
});

test("noite sem reservas mostra o vazio com o próximo passo", async ({ page }) => {
  await page.goto("/admin/?papel=dono&mock=vazio");
  await page.waitForSelector("html[data-ready]");
  await expect(page.locator(".hoje-topo")).toBeVisible({ timeout: 20_000 });
  const empty = page.locator(".hoje-vazio");
  const closed = page.locator(".hoje-fechado");
  await expect(empty.or(closed)).toBeVisible();
  if (await empty.isVisible()) {
    await expect(empty).toContainText("Nenhuma reserva para hoje ainda");
    await expect(empty.getByRole("button", { name: "Lançar uma reserva" })).toBeVisible();
  } else {
    await expect(closed).toContainText("Próxima abertura");
  }
  await bothThemes(page);
});

test("carga que falha mostra o erro no lugar, com Tentar de novo", async ({ page }) => {
  await page.goto("/admin/reservas?papel=dono&mock=normal");
  await page.waitForSelector("html[data-ready]");
  await expect(page.getByRole("heading", { level: 1, name: "Reservas" })).toBeVisible();
  // a API cai só agora: o painel está aberto, o Hoje falha no seu próprio lugar
  await page.evaluate(() => {
    sessionStorage.setItem("territorio:mock-scenario", JSON.stringify("erro"));
    history.replaceState(null, "", "/admin/reservas");
  });
  const menu = page.locator(test.info().project.name === "celular" ? ".barra" : ".trilho");
  await menu.getByRole("link", { name: "Hoje", exact: true }).click();
  const alert = page.locator(".hoje-estado");
  await expect(alert).toContainText("Não deu para carregar a noite", { timeout: 20_000 });
  await expect(alert).not.toContainText("Erro simulado");
  await bothThemes(page);
  await page.evaluate(() => sessionStorage.setItem("territorio:mock-scenario", JSON.stringify("normal")));
  await alert.getByRole("button", { name: "Tentar de novo" }).click();
  await expect(page.locator(".hoje-topo")).toBeVisible();
});

// ---- histórias 5.2, 5.3, 5.19, 6.2, 6.11, 6.12 e 6.14 no Hoje ------------------------------

async function open(page, url) {
  await page.addInitScript(() => localStorage.setItem("territorio:demo-open", "false"));
  await page.goto(url);
  await page.waitForSelector("html[data-ready]");
}

/** A data de hoje pelo mock (a próxima noite aberta), semeada às 20:40 seja qual for a hora. */
const tonight = (page) => nightOf(page, open);

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

/** Se o retrato da noite está no aparelho (IndexedDB). */
const hasPicture = (page) =>
  page.evaluate(
    () =>
      new Promise((ok) => {
        const req = indexedDB.open("territorio-painel");
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("retrato")) return db.close(), ok(false);
          const get = db.transaction("retrato").objectStore("retrato").get("noite");
          get.onsuccess = () => (db.close(), ok(Boolean(get.result)));
          get.onerror = () => (db.close(), ok(false));
        };
        req.onerror = () => ok(false);
      }),
  );

async function confirmIdentity(page) {
  const dialog = page.getByRole("dialog", { name: /Confirme/ });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Senha").fill("admin");
  await dialog.getByLabel("Código do aplicativo").fill("123456");
  await dialog.getByRole("button", { name: "Confirmar" }).click();
  await expect(dialog).toBeHidden();
}

test("dono vê os avisos do painel nos alertas e os 5 passos do primeiro uso", async ({ page }) => {
  await openNight(page, "dono");
  const privacy = page.locator(".hoje-alerta--privacy_request_due").first();
  await expect(privacy).toContainText("Pedido de dados");
  await expect(privacy.getByRole("link", { name: "Ver os pedidos" })).toHaveAttribute("href", "/admin/clientes/pedidos");
  await expect(page.locator(".hoje-alerta--pin_locked")).toContainText("Lucía");
  const device = page.locator(".hoje-alerta--device_key_lost");
  await expect(device).toContainText(/Tablet/);
  await expect(device.getByRole("link", { name: "Ver aparelhos" })).toBeVisible();
  await expect(page.locator(".hoje-alerta--reminder_failed")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Primeiro uso · \d de 5 prontos/ })).toBeVisible();
  await expect(page.locator(".hoje-passos > li")).toHaveCount(5);
  await bothThemes(page);
  // um aviso crítico não tem "Dispensar": sai quando o aparelho é aprovado de novo (FR-87)
  await expect(device).toContainText("crítico");
  await expect(device.getByRole("button", { name: /^Dispensar/ })).toHaveCount(0);
  // o que não sai sozinho é marcado como resolvido para todos, e continua resolvido
  await page.locator(".hoje-alerta--reminder_failed").getByRole("button", { name: /^Marcar como resolvido/ }).click();
  await expect(page.locator(".hoje-alerta--reminder_failed")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".hoje-topo")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".hoje-alerta--reminder_failed")).toHaveCount(0);
  await expect(page.locator(".hoje-alerta--device_key_lost")).toHaveCount(1);
});

test("gerente recebe o que o catálogo de avisos dá a ele, e não o que é só do dono", async ({ page }) => {
  await openNight(page, "gerente");
  await expect(page.locator(".hoje-alerta--privacy_request_due")).toHaveCount(0);
  await expect(page.locator(".hoje-alerta--pin_locked")).toHaveCount(0);
  // o lembrete que não saiu é para o dono e o gerente (era só do dono)
  await expect(page.locator(".hoje-alerta--reminder_failed")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Primeiro uso/ })).toHaveCount(0);
});

test("Chegou pelo Hoje, com Desfazer na linha enquanto vale o prazo", async ({ page }) => {
  const date = await tonight(page);
  await open(page, `/admin/?papel=recepcao&mock=normal&agora=${date}T20:05`);
  await page.getByRole("button", { name: "Chegou: Mariana" }).click();
  const win = page.getByRole("dialog", { name: "Chegou: Mariana" });
  await expect(win.getByLabel("Quantas pessoas entraram?")).toHaveValue("2");
  await bothThemes(page);
  await win.getByRole("button", { name: /Confirmar chegada na Q1/ }).click();
  await expect(page.locator(".toast").getByText("Chegou", { exact: true })).toBeVisible();
  const undo = page.getByRole("button", { name: /Desfazer a chegada de Mariana \(até 20:20\)/ });
  await expect(undo).toBeVisible();
  await undo.click();
  await expect(page.locator(".toast").getByText("Chegada desfeita")).toBeVisible();
  await expect(page.getByRole("button", { name: "Chegou: Mariana" })).toBeVisible();
});

test("Ligar para confirmar: a gerência vê o telefone e marca a resposta; a recepção pede a eles", async ({ page }) => {
  const date = await tonight(page);
  await open(page, `/admin/?papel=gerente&mock=normal&agora=${date}T18:00`);
  const section = page.locator(".hoje-ligacao").filter({ hasText: "Paula" });
  await expect(section).toContainText("sem WhatsApp · confirmar por ligação");
  await section.getByRole("button", { name: "Ver telefone" }).click();
  await confirmIdentity(page);
  await expect(section.locator(".hoje-telefone")).toBeVisible();
  await bothThemes(page);
  await section.getByRole("button", { name: "Confirmou" }).click();
  await expect(page.locator(".toast").getByText(/Paula.*confirmou por ligação/)).toBeVisible();
  await expect(page.locator(".hoje-ligacao")).toHaveCount(0);
  // a resposta está na linha do tempo da reserva, "por ligação"
  const answer = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem("territorio:mock-db"));
    const c = db.customers.find((x) => x.name === "Paula");
    return db.reservations.find((r) => r.customer_id === c.id && r.history?.some((h) => /por ligação/.test(h.summary)))?.call_answer;
  });
  expect(answer).toBe("yes");

  await open(page, `/admin/?papel=recepcao&agora=${date}T18:00`);
  await editState(page, "const c = db.customers.find((x) => x.name === 'Paula'); const r = db.reservations.find((x) => x.customer_id === c.id); r.call_answer = null;");
  const desk = page.locator(".hoje-ligacao").filter({ hasText: "Paula" });
  await expect(desk).toContainText("Pedir ao dono ou à gerente");
  await expect(desk.getByRole("button")).toHaveCount(0);
});

test("ao vivo: a mudança em outro aparelho chega sozinha, com o resumo para o leitor de tela", async ({ page, context }) => {
  const date = await tonight(page);
  await open(page, `/admin/?papel=recepcao&mock=normal&agora=${date}T20:05`);
  await expect(page.getByRole("button", { name: "Chegou: Mariana" })).toBeVisible({ timeout: 20_000 });
  // outro aparelho da casa: outra aba do mesmo navegador
  const other = await context.newPage();
  await other.goto(`/admin/reservas?papel=recepcao&mock=normal&agora=${date}T20:05`);
  await other.waitForSelector("html[data-ready]");
  const id = await other.evaluate(() => fetch("/api/v1/staff/floor").then((r) => r.json()).then((f) => f.reservations.find((r) => r.customer.name === "Mariana").id));
  expect((await call(other, `/staff/reservations/${id}/actions`, { action: "check_in", people: 2, table_codes: ["Q1"] }, "outro-aparelho")).status).toBe(200);
  await expect(page.getByRole("button", { name: "Chegou: Mariana" })).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator(".hoje > p.sr-only[aria-live='polite']")).toHaveText("1 reserva mudou");
  await other.close();

  // a transmissão cai: "Atualização ao vivo pausada", até abrir de novo
  await page.evaluate(() => window.__painelStream.drop());
  const lost = page.locator("[data-estado='realtime_lost']");
  await expect(lost).toContainText("Atualização ao vivo pausada");
  await expect(lost).toHaveCount(0, { timeout: 15_000 });
});

test("sem conexão: o Hoje mostra o retrato da noite, só leitura, e gravar abre o aviso", async ({ page, context }) => {
  await open(page, "/admin/?papel=recepcao&mock=normal");
  await expect(page.locator(".hoje-topo, .hoje-fechado").first()).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => hasPicture(page), { timeout: 20_000 }).toBe(true);
  await context.setOffline(true);
  const band = page.locator(".retrato-faixa[data-modo='offline.panel']");
  await expect(band).toContainText("Sem conexão. Você vê a noite como estava às");
  await bothThemes(page);
  const chegou = page.locator(".hoje-chegada__acoes").getByRole("button", { name: "Chegou" }).first();
  if (await chegou.count()) {
    await chegou.click();
    await expect(page.getByRole("dialog", { name: "Sem conexão agora" })).toBeVisible();
    await page.getByRole("button", { name: "Entendi" }).click();
  }
  await context.setOffline(false);
  const backlog = page.locator(".retrato-faixa[data-modo='offline_backlog']");
  await expect(backlog).toContainText("A conexão voltou");
  await backlog.getByRole("button", { name: "Dispensar" }).click();
  await expect(backlog).toHaveCount(0);
});

test("sistema da casa fora com a internet no ar: entra no modo só leitura e sai quando volta", async ({ page }) => {
  await open(page, "/admin/?papel=recepcao&mock=normal");
  await expect(page.locator(".hoje-topo, .hoje-fechado").first()).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => hasPicture(page), { timeout: 20_000 }).toBe(true);
  // o cenário do mock muda agora (o endereço não traz mais ?mock=normal)
  await page.evaluate(() => {
    sessionStorage.setItem("territorio:mock-scenario", JSON.stringify("fora"));
    history.replaceState(null, "", "/admin/");
  });
  const wake = () => page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
  const band = page.locator(".retrato-faixa[data-modo='offline.server']");
  await expect(async () => {
    await wake();
    await expect(band).toContainText("O sistema da casa está fora. Você vê a noite como estava às", { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await bothThemes(page);
  await page.evaluate(() => sessionStorage.setItem("territorio:mock-scenario", JSON.stringify("normal")));
  await expect(async () => {
    await wake();
    await expect(page.locator(".retrato-faixa[data-modo='offline_backlog']")).toContainText("A conexão voltou", { timeout: 2_000 });
  }).toPass({ timeout: 40_000 });
  await expect(band).toHaveCount(0);
});

test("o fechamento de ontem marcou Não veio: a gerência confere e desfaz com motivo", async ({ page }) => {
  await open(page, "/admin/?papel=gerente&mock=normal");
  await expect(page.locator(".hoje-topo, .hoje-fechado").first()).toBeVisible({ timeout: 20_000 });
  const alert = page.locator(".hoje-alerta--no_show_review");
  if (!(await alert.count())) test.skip(true, "a última noite aberta está longe demais de hoje");
  await expect(alert).toContainText("Vinícius");
  const undo = alert.getByRole("button", { name: /Desfazer o "Não veio" de Vinícius/ });
  if (await undo.count()) {
    await undo.click();
    const win = page.getByRole("dialog", { name: /Desfazer o "Não veio"/ });
    await win.getByLabel("Motivo").fill("Ligou avisando, conferido com a recepção.");
    await win.getByRole("button", { name: "Desfazer" }).click();
    await expect(page.locator(".toast").getByText('"Não veio" desfeito')).toBeVisible();
  } else {
    await expect(alert).toContainText("Passou o prazo de desfazer");
  }
});

test("a noite de ontem não fechou: o alerta diz o que ficou sem estado final e fecha à mão", async ({ page }) => {
  await open(page, "/admin/?papel=gerente&mock=normal");
  await expect(page.locator(".hoje-topo, .hoje-fechado").first()).toBeVisible({ timeout: 20_000 });
  const ok = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("territorio:mock-db")).nights || {}).length > 0);
  if (!ok) test.skip(true, "sem noite anterior no exemplo");
  await editState(page, "const d = Object.keys(db.nights).find((k) => db.nights[k].closed_at); delete db.nights[d]; const r = db.reservations.find((x) => x.date === d && x.status === 'no_show'); r.status = 'confirmed';");
  const alert = page.locator(".hoje-alerta--night_not_closed");
  await expect(alert).toContainText("não fechou");
  await expect(alert).toContainText("1 reserva");
  await alert.getByRole("button", { name: "Fechar a noite agora" }).click();
  await expect(page.locator(".toast").getByText("Noite fechada")).toBeVisible();
  await expect(page.locator(".hoje-alerta--night_not_closed")).toHaveCount(0);
});
