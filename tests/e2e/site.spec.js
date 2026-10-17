// A página da casa: as três línguas, os dois temas, uma tela de celular e nenhum JavaScript.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const PAGES = [
  { path: "/", lang: "pt-BR", book: "Reservar mesa", title: /Izakaya em Foz do Iguaçu/ },
  { path: "/es/", lang: "es", book: "Reservar mesa", title: /Izakaya en Foz do Iguaçu/ },
  { path: "/en/", lang: "en", book: "Book a table", title: /Japanese izakaya in Foz do Iguaçu/ },
];

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

for (const p of PAGES) {
  test.describe(`página da casa ${p.path}`, () => {
    test("abre na língua certa, com título, reserva e endereço", async ({ page }) => {
      await page.goto(`${p.path}?mock=normal`);
      await page.waitForSelector("html[data-ready]");
      await expect(page.locator("html")).toHaveAttribute("lang", p.lang);
      await expect(page).toHaveTitle(p.title);
      await expect(page.locator(".capa a", { hasText: p.book })).toHaveAttribute("href", `${p.path}reservar/`);
      await expect(page.locator(".onde__endereco")).toContainText("Rua Sérgio Roncato, 703");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test("sem acessibilidade quebrada nos dois temas (axe)", async ({ page }) => {
      test.slow(); // axe duas vezes na página inteira; com todos os workers ocupados precisa de mais de 30 s
      await page.goto(`${p.path}?mock=normal`);
      await page.waitForSelector("html[data-ready]");
      expect(await serious(page)).toEqual([]);
      await page.emulateMedia({ colorScheme: "dark" });
      expect(await serious(page)).toEqual([]);
    });
  });
}

test("a página inteira existe sem JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/");
  // em dev o CSS chega pelo JS, então isto confere o conteúdo, não a aparência
  await expect(page.locator("h1 [aria-label='Território']")).toBeAttached();
  await expect(page.locator(".capa__lede")).toContainText("Comida pra compartilhar");
  await expect(page.locator(".cardapio__folha")).toHaveCount(5);
  await expect(page.locator(".semana li")).toHaveCount(7);
  // "Hoje na casa" é o dia em que a página foi gerada, com os dados para decidir de novo no navegador
  await expect(page.locator(".hoje__regra")).not.toBeEmpty();
  await expect(page.locator("#hoje-dados")).toBeAttached();
  // a imagem do mapa está na página, os eventos e todo "Reservar" funcionam como links simples
  await expect(page.locator(".onde img.mapa")).toBeAttached();
  await expect(page.locator(".capa a[data-book]")).toHaveAttribute("href", "/reservar/");
  // "acabou" nunca vem do build: só o cardápio ao vivo diz isso
  await expect(page.locator("[data-sold-out]:not([hidden])")).toHaveCount(0);
  await context.close();
});

test("o botão de tema troca e lembra a escolha", async ({ page }) => {
  await page.goto("/?mock=normal");
  await page.waitForSelector("html[data-ready]");
  const toggle = page.locator("[data-theme-toggle]");
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "escuro");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "escuro");
});

test("trocar de língua leva à mesma página na outra língua", async ({ page }) => {
  await page.goto("/?mock=normal");
  await page.waitForSelector("html[data-ready]");
  await page.locator(".langs a[hreflang='es']").click();
  await expect(page).toHaveURL(/\/es\/$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
});

for (const [path, lang, first] of [["/cardapio/", "pt-BR", "Pra compartilhar"], ["/es/cardapio/", "es", "Para compartir"], ["/en/cardapio/", "en", "To share"]]) {
  test(`cardápio ${path}: as folhas, sem rolagem lateral e acessível`, async ({ page }) => {
    await page.goto(`${path}?mock=normal`);
    await page.waitForSelector("html[data-ready]");
    await expect(page.locator("html")).toHaveAttribute("lang", lang);
    await expect(page.locator(".sheet")).toHaveCount(5);
    await expect(page.locator(".sheet__title").first()).toHaveText(first);
    // nomes de pratos nunca são traduzidos
    await expect(page.locator(".sheet--dark .sheet__line b", { hasText: "Katsukarê" })).toHaveCount(1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    expect(await serious(page)).toEqual([]);
    await page.emulateMedia({ colorScheme: "dark" });
    expect(await serious(page)).toEqual([]);
  });
}

test("item sem preço não mostra preço nem \"a confirmar\"", async ({ page }) => {
  await page.goto("/cardapio/?mock=normal");
  await page.waitForSelector("html[data-ready]");
  const oniguiri = page.locator(".sheet__item", { hasText: "Oniguiri" }).first();
  await expect(oniguiri.locator(".sheet__price")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("a confirmar");
});

test("combinados com os números da configuração, sem marcador sobrando", async ({ page }) => {
  await page.goto("/?mock=normal");
  await expect(page.locator("#reservar .notas")).toContainText("Tolerância de 20 minutos");
  await expect(page.locator("#reservar .notas")).toContainText("deixa de ser prioridade");
  await expect(page.locator("body")).not.toContainText("{tolerancia}");
  await page.goto("/reservar/?mock=normal");
  await expect(page.locator(".reserva__combinados")).toContainText("até 2 h antes");
});

test.describe("banner de cookies", () => {
  test("aparece na primeira visita, Aceitar e Recusar do mesmo tamanho, nada marcado", async ({ page }) => {
    test.slow(); // termina com axe na página inteira, como as outras checagens de axe
    await page.goto("/?mock=normal");
    await page.waitForSelector("html[data-ready]");
    const panel = page.locator(".cookies__panel");
    await expect(panel).toBeVisible();
    const accept = await panel.getByRole("button", { name: "Aceitar" }).boundingBox();
    const reject = await panel.getByRole("button", { name: "Recusar" }).boundingBox();
    expect(Math.round(accept.width)).toBe(Math.round(reject.width));
    expect(Math.round(accept.height)).toBe(Math.round(reject.height));
    await panel.getByRole("button", { name: "Escolher" }).click();
    const optional = panel.locator("input[type=checkbox]:not([disabled])");
    await expect(optional).toHaveCount(2); // Lembrar de mim e Medição
    for (const box of await optional.all()) await expect(box).not.toBeChecked();
    expect(await serious(page)).toEqual([]);
  });

  test("recusar guarda a escolha, não mede, e o rodapé reabre", async ({ page }) => {
    await page.goto("/?mock=normal");
    await page.waitForSelector("html[data-ready]");
    await page.locator(".cookies__panel").getByRole("button", { name: "Recusar" }).click();
    await expect(page.locator(".cookies__panel")).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute("data-measurement", "off");
    await page.reload();
    await page.waitForSelector("html[data-ready]");
    await expect(page.locator(".cookies__panel")).toHaveCount(0);
    await page.locator("[data-cookies-open]").click();
    await page.locator(".cookies__panel").getByRole("button", { name: "Aceitar" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-measurement", "on");
  });

  test("medição só depois do sim: sem nome nem telefone, e recusar depois apaga os números", async ({ page, context }) => {
    const sent = [];
    page.on("request", (r) => r.url().endsWith("/api/v1/measure") && sent.push(r.postDataJSON()));
    await page.goto("/?mock=normal");
    await page.waitForSelector("html[data-ready]");
    await page.waitForTimeout(500);
    expect((await context.cookies()).map((c) => c.name)).not.toContain("trt_vis");

    await page.locator(".cookies__panel").getByRole("button", { name: "Aceitar" }).click();
    await expect.poll(() => sent.length, { timeout: 10_000 }).toBeGreaterThan(0); // enviado em lotes a cada 4 s
    const events = sent.flatMap((b) => b.events);
    expect(events.map((e) => e.name)).toContain("page_view");
    expect(JSON.stringify(sent)).not.toMatch(/\+55|@|Ana|Bruno/);
    expect((await context.cookies()).map((c) => c.name)).toEqual(expect.arrayContaining(["trt_consent", "trt_vis", "trt_visita"]));

    await page.locator("[data-cookies-open]").click();
    await page.locator(".cookies__panel").getByRole("button", { name: "Recusar" }).click();
    const left = (await context.cookies()).map((c) => c.name);
    expect(left).not.toContain("trt_vis");
    expect(left).not.toContain("trt_visita");
  });

  test("a política lista todos os cookies do registro", async ({ page }) => {
    await page.goto("/privacidade/?mock=normal");
    for (const name of ["__Host-trt_sessao", "trt_consent", "trt_tema", "trt:lembrar", "trt_vis", "trt_visita"]) {
      await expect(page.locator(".legal__tabela")).toContainText(name);
    }
  });
});

test("abas do cardápio na página da casa: uma folha por vez, também pelo teclado", async ({ page }) => {
  await page.goto("/?mock=normal");
  await page.waitForSelector("html[data-ready]");
  await expect(page.locator("[data-tab-panel]:visible")).toHaveCount(1);
  await page.locator('[data-tab="ramen"]').click();
  await expect(page.locator("#folha-ramen")).toBeVisible();
  await expect(page.locator("#folha-pra-compartilhar")).toBeHidden();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('[data-tab="oniguiri-e-beliscos"]')).toHaveAttribute("aria-selected", "true");
});

// ---- Épico 4: o que o painel publica chega ao site, e as peças próprias do site ------------

/** Muda o banco da demonstração (como o painel faria) e recarrega, para a página ler. */
async function setInDb(page, path, value) {
  await page.evaluate(
    ([keys, v]) => {
      const db = JSON.parse(localStorage.getItem("territorio:mock-db"));
      let node = db;
      for (const k of keys.slice(0, -1)) node = node[k];
      node[keys.at(-1)] = v;
      localStorage.setItem("territorio:mock-db", JSON.stringify(db));
    },
    [path.split("."), value],
  );
  await page.reload();
  await page.waitForSelector("html[data-ready]");
}

const live = (page) => page.locator('[data-live="open-status"]');
const today = (page) => page.locator('[data-live="today"]');

test.describe("aberto agora e hoje na casa contados no horário de Foz (4.3, 4.4)", () => {
  for (const timezoneId of ["America/Asuncion", "Asia/Tokyo"]) {
    test.describe(timezoneId, () => {
      test.use({ timezoneId });

      test("o mesmo estado e as mesmas horas nas três línguas", async ({ page }) => {
        // uma quarta às 20:00 em Foz: aberto até 23:30, seja o que for que o relógio do aparelho diga
        await page.goto("/?mock=normal&agora=2026-10-14T20:00");
        await page.waitForSelector("html[data-ready]");
        await expect(live(page)).toHaveAttribute("data-state", "open");
        await expect(live(page).locator("b")).toHaveText("Aberto agora · até 23h30");
        if (timezoneId === "Asia/Tokyo") await expect(live(page).locator('[data-live="foz-time"]')).toBeVisible();

        // uma segunda ao meio-dia: fechado, a próxima abertura real na língua da página
        await page.goto("/en/?mock=normal&agora=2026-10-19T12:00");
        await page.waitForSelector("html[data-ready]");
        await expect(live(page)).toHaveAttribute("data-state", "closed");
        await expect(live(page).locator("b")).toHaveText(/^Opens (tomorrow|[A-Z][a-z]+day) at \d{1,2}:\d\d (am|pm)$/);
        await page.goto("/es/?mock=normal&agora=2026-10-19T12:00");
        await page.waitForSelector("html[data-ready]");
        await expect(live(page).locator("b")).toHaveText(/^Abre (mañana|el [a-zé]+) a las \d{1,2}( h|:\d\d h)$/);
        await expect(today(page)).toHaveAttribute("data-kind", "closed");
        await expect(today(page)).toContainText("producción");
      });
    });
  }

  test("dia fechado diz o motivo e a próxima abertura; o estado nunca só por cor", async ({ page }) => {
    await page.goto("/?mock=normal&agora=2026-10-19T12:00");
    await page.waitForSelector("html[data-ready]");
    await expect(today(page)).toHaveText(/^Hoje a casa não abre: produção\. Abre .+\.$/);
    await expect(live(page).locator("b")).toHaveText(/^Abre /);
  });

  test("a frase do dia certo, não a de quinta todos os dias", async ({ page }) => {
    await page.goto("/?mock=normal&agora=2026-10-17T15:00");
    await page.waitForSelector("html[data-ready]");
    await expect(today(page)).toHaveText("Sábado tem música um pouco mais alta no quintal.");
    await page.goto("/es/?mock=normal&agora=2026-10-17T15:00");
    await page.waitForSelector("html[data-ready]");
    await expect(today(page)).toHaveText("El sábado hay música un poco más alta en el patio.");
  });

  test("dois turnos no dia: o site mostra os dois e o aberto agora conta o intervalo (2.8)", async ({ page }) => {
    await page.goto("/?mock=normal&agora=2026-10-17T13:00");
    await page.waitForSelector("html[data-ready]");
    // o sábado passa a abrir também no almoço, como o dono liga em Configurações › Horários
    await setInDb(page, "hours.6.second_shift", { opens_at: "12:00", closes_at: "15:00" });
    await expect(live(page)).toHaveAttribute("data-state", "open");
    await expect(live(page).locator("b")).toHaveText("Aberto agora · até 15h");
    await expect(today(page)).toHaveText("Sábado tem música um pouco mais alta no quintal.");

    // entre os turnos: fechado, abre de novo à noite, nas três línguas
    await page.goto("/?mock=normal&agora=2026-10-17T16:00");
    await page.waitForSelector("html[data-ready]");
    await expect(live(page)).toHaveAttribute("data-state", "closed");
    await expect(live(page).locator("b")).toHaveText("Fechado agora · abre de novo às 19h");
    await page.goto("/es/?mock=normal&agora=2026-10-17T16:00");
    await page.waitForSelector("html[data-ready]");
    await expect(live(page).locator("b")).toHaveText("Cerrado ahora · abre de nuevo a las 19 h");
    await page.goto("/en/?mock=normal&agora=2026-10-17T16:00");
    await page.waitForSelector("html[data-ready]");
    await expect(live(page).locator("b")).toHaveText("Closed now · opens again at 7:00 pm");

    // antes do primeiro turno, a abertura do almoço; no segundo, até o fim da noite
    await page.goto("/?mock=normal&agora=2026-10-17T10:00");
    await page.waitForSelector("html[data-ready]");
    await expect(live(page).locator("b")).toHaveText("Abre hoje às 12h");
    await page.goto("/?mock=normal&agora=2026-10-17T21:00");
    await page.waitForSelector("html[data-ready]");
    await expect(live(page).locator("b")).toHaveText("Aberto agora · até 23h30");
  });

  test("com a API fora fica o texto do build, sem erro na tela", async ({ page }) => {
    await page.goto("/?mock=erro");
    await page.waitForSelector("html[data-ready]");
    await expect(today(page)).not.toBeEmpty();
    await expect(live(page).locator("b")).toContainText("19h");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.locator("[data-sold-out]:not([hidden])")).toHaveCount(0);
  });
});

test("aviso com validade: some sozinho quando o relógio da casa passa do fim (4.4)", async ({ page }) => {
  await page.goto("/?mock=normal&agora=2026-10-14T17:59");
  await page.waitForSelector("html[data-ready]");
  await setInDb(page, "site_blocks.notices.published", null);
  await setInDb(page, "content.notices", [
    { text: { pt: "Hoje a cozinha fecha mais cedo.", es: "Hoy la cocina cierra más temprano.", en: "" }, starts_at: "2026-10-14T10:00:00-03:00", ends_at: "2026-10-14T18:00:00-03:00" },
  ]);
  await expect(today(page)).toHaveText("Hoje a cozinha fecha mais cedo.");
  await expect(today(page)).toHaveAttribute("data-kind", "notice");
  await page.goto("/es/?mock=normal&agora=2026-10-14T17:59");
  await page.waitForSelector("html[data-ready]");
  await expect(today(page)).toHaveText("Hoy la cocina cierra más temprano.");
  // 18:00 pelo relógio da casa (o do servidor, não o do celular): o aviso acabou
  await page.goto("/?mock=normal&agora=2026-10-14T18:00");
  await page.waitForSelector("html[data-ready]");
  await expect(today(page)).not.toHaveAttribute("data-kind", "notice");
  await expect(today(page)).not.toContainText("cozinha fecha mais cedo");
  await expect(today(page)).not.toBeEmpty();
});

test("o aviso publicado no painel aparece em Hoje na casa (bug 13)", async ({ page }) => {
  test.slow();
  await page.goto("/admin/site/avisos?papel=dono&mock=normal");
  await page.waitForSelector("html[data-ready]");
  const hide = page.getByRole("button", { name: "Esconder a barra" });
  if (await hide.isVisible()) await hide.click();
  await page.getByRole("button", { name: "Novo aviso" }).click();
  await page.locator('textarea[name="items.1.text.pt"]').fill("Hoje a cozinha fecha às 22h por causa do jogo.");
  await page.getByRole("button", { name: "Publicar", exact: true }).click();
  await expect(page.getByText("Publicado: Avisos").first()).toBeVisible();
  await page.goto("/?mock=normal");
  await page.waitForSelector("html[data-ready]");
  await expect(today(page)).toHaveText("Hoje a cozinha fecha às 22h por causa do jogo.");
  await expect(today(page)).toHaveAttribute("data-kind", "notice");
  // sem tradução, o espanhol mostra o português
  await page.goto("/es/?mock=normal");
  await page.waitForSelector("html[data-ready]");
  await expect(today(page)).toHaveText("Hoje a cozinha fecha às 22h por causa do jogo.");
});

test.describe("acabou ao vivo e as regras do cardápio (4.13, bug 12)", () => {
  test("o acabou vem do painel, dito em texto, e some quando a casa desliga", async ({ page }) => {
    await page.goto("/cardapio/?mock=normal");
    await page.waitForSelector("html[data-ready]");
    const shrimp = page.locator('[data-item="Ebi Tempurá"]').first();
    await expect(shrimp).toHaveClass(/is-out/);
    await expect(shrimp.locator("[data-sold-out]")).toHaveText("acabou");
    await setInDb(page, "menu_settings.show_sold_out", false);
    await expect(page.locator("[data-sold-out]:not([hidden])")).toHaveCount(0);
  });

  test("prato sem preço: sem preço ou “consulte”, nunca “a confirmar”", async ({ page }) => {
    await page.goto("/en/cardapio/?mock=normal");
    await page.waitForSelector("html[data-ready]");
    const oniguiri = page.locator(".sheet__item", { hasText: "Oniguiri" }).first();
    await expect(oniguiri.locator(".sheet__price")).toHaveCount(0);
    await setInDb(page, "menu_settings.unpriced_item", "ask");
    await expect(oniguiri.locator("[data-price-ask]")).toHaveText("ask us");
    await expect(page.locator("body")).not.toContainText("a confirmar");
  });

  test("marcado no painel pela recepção, o site mostra o acabou", async ({ page, context }) => {
    test.slow(); // o painel e o site abrem um depois do outro
    const panel = await context.newPage();
    await panel.goto("/admin/cardapio?papel=recepcao&mock=normal");
    await panel.waitForSelector("html[data-ready]");
    const karage = panel.locator(".cd-lista__item", { hasText: "Karage" });
    await karage.getByRole("checkbox").check();
    await expect(panel.getByText("Karage: acabou").first()).toBeVisible();
    await page.goto("/cardapio/?mock=normal");
    await page.waitForSelector("html[data-ready]");
    await expect(page.locator('[data-item="Karage"]').first()).toHaveClass(/is-out/);
  });
});

test("a galeria do site segue a ordem e os créditos do painel (3.8)", async ({ page }) => {
  await page.goto("/?mock=normal");
  await page.waitForSelector("html[data-ready]");
  await expect(page.locator("[data-credit]:not([hidden])").first()).toContainText("foto:");
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem("territorio:mock-db"));
    for (const img of db.images) img.sort += 1;
    db.images.find((i) => i.key === "placa").sort = 0;
    localStorage.setItem("territorio:mock-db", JSON.stringify(db));
  });
  await page.reload();
  await page.waitForSelector("html[data-ready]");
  await expect(page.locator("[data-galeria] [data-photo]").first()).toHaveAttribute("data-photo", "placa");
});

test.describe("a língua do navegador (4.2)", () => {
  test.use({ locale: "es-AR" });

  test("sugere o espanhol na faixa do pé, sem cobrir o Reservar, e lembra o não", async ({ page, context }) => {
    await page.goto("/?mock=normal");
    await page.waitForSelector("html[data-ready]");
    const bar = page.getByRole("region", { name: "Sugerencia de idioma" });
    await expect(bar).toBeVisible();
    await expect(bar).toContainText("¿Preferís leer el sitio en español?");
    await expect(bar.getByRole("link", { name: "Ver en español" })).toHaveAttribute("href", "/es/");
    const box = await bar.boundingBox();
    expect(box.height).toBeLessThanOrEqual(56);
    const book = await page.locator(".viga__reservar").boundingBox();
    expect(box.y).toBeGreaterThan(book.y + book.height);
    // a página de trás ainda funciona e nada foi redirecionado
    await expect(page).toHaveURL(/\/\?mock=normal$/);
    await bar.getByRole("button", { name: "Seguir en portugués" }).click();
    await expect(bar).toHaveCount(0);
    expect((await context.cookies()).find((c) => c.name === "trt_lingua")?.value).toBe("pt");
    await page.reload();
    await page.waitForSelector("html[data-ready]");
    await expect(page.locator(".lingua")).toHaveCount(0);
  });

  test("aceitar leva à mesma página em espanhol e a troca pelo cabeçalho também grava", async ({ page, context }) => {
    await page.goto("/cardapio/?mock=normal");
    await page.waitForSelector("html[data-ready]");
    await page.getByRole("link", { name: "Ver en español" }).click();
    await expect(page).toHaveURL(/\/es\/cardapio\/$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "es");
    expect((await context.cookies()).find((c) => c.name === "trt_lingua")?.value).toBe("es");
    await page.waitForSelector("html[data-ready]");
    await page.locator(".langs a[hreflang='en']").click();
    await expect(page).toHaveURL(/\/en\/cardapio\/$/);
    expect((await context.cookies()).find((c) => c.name === "trt_lingua")?.value).toBe("en");
  });
});

test.describe("navegador numa língua que o site não tem", () => {
  test.use({ locale: "de-DE" });
  test("não aparece faixa nenhuma", async ({ page }) => {
    await page.goto("/?mock=normal");
    await page.waitForSelector("html[data-ready]");
    await expect(page.locator(".lingua")).toHaveCount(0);
  });
});

test("o mapa de Onde fica é a imagem do OpenStreetMap servida pelo site, com crédito e o endereço no texto alternativo (4.5)", async ({ page }) => {
  const outside = [];
  page.on("request", (r) => /google|gstatic|openstreetmap|mapbox/.test(new URL(r.url()).hostname) && outside.push(r.url()));
  await page.goto("/?mock=normal");
  await page.waitForSelector("html[data-ready]");
  const map = page.locator(".onde img.mapa");
  await expect(map).toHaveAttribute("alt", /Rua Sérgio Roncato, 703/);
  await expect(map).toHaveAttribute("width", "768");
  await expect(map).toHaveAttribute("height", "480");
  await map.scrollIntoViewIfNeeded();
  await expect.poll(() => map.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
  expect(new URL(await map.evaluate((img) => img.currentSrc)).origin).toBe(new URL(page.url()).origin);
  const credit = page.locator(".onde__credito a");
  await expect(credit).toHaveText("© colaboradores do OpenStreetMap");
  await expect(credit).toHaveAttribute("href", "https://www.openstreetmap.org/copyright");
  await page.goto("/en/?mock=normal");
  await expect(page.locator(".onde__credito a")).toHaveText("© OpenStreetMap contributors");
  await expect(page.locator(".onde img.mapa")).toHaveAttribute("alt", /^Map of the streets around the house/);
  await page.goto("/es/?mock=normal");
  await expect(page.locator(".onde__credito a")).toHaveText("© colaboradores de OpenStreetMap");
  await expect(page.locator(".onde iframe")).toHaveCount(0);
  await expect(page.locator(".onde a", { hasText: "Google Maps" })).toHaveAttribute("href", /-25\.4878224,-54\.5669192/);
  expect(outside).toEqual([]);
});

test.describe("Reservar mesa abre numa janela (4.6)", () => {
  test("Esc fecha e devolve o foco; com escolha feita, pergunta antes e guarda o que foi escolhido", async ({ page }) => {
    test.slow();
    await page.goto("/?mock=normal");
    await page.waitForSelector("html[data-ready]");
    const cookies = page.locator(".cookies__panel");
    if (await cookies.isVisible()) await cookies.getByRole("button", { name: "Recusar" }).click();
    const opener = page.locator(".capa a[data-book]");
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Reservar mesa" });
    await expect(dialog).toBeVisible();
    const frame = page.frameLocator("iframe.reserva-janela__quadro");
    await expect(frame.locator("h1")).toContainText("Reserve");
    await expect(frame.locator(".viga")).toBeHidden(); // a página de reserva sem a sua própria barra
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    await expect(page).toHaveURL(/\/\?mock=normal$/);

    await opener.click();
    await frame.locator('[data-group="party"] [role="radio"][data-value="4"]').click();
    await page.getByRole("button", { name: "Fechar a reserva" }).click();
    const question = page.getByRole("alertdialog", { name: "Sair da reserva?" });
    await expect(question).toBeVisible();
    await question.getByRole("button", { name: "Continuar reservando" }).click();
    await expect(dialog).toBeVisible();
    await page.getByRole("button", { name: "Fechar a reserva" }).click();
    await question.getByRole("button", { name: "Sair da reserva" }).click();
    await expect(dialog).toBeHidden();
    // aberto de novo, o que foi escolhido continua lá
    await opener.click();
    await expect(frame.locator('[data-group="party"] [role="radio"][data-value="4"]')).toHaveAttribute("aria-checked", "true");
  });

  test("o voltar do aparelho fecha a janela e a página fica onde estava", async ({ page }) => {
    await page.goto("/?mock=normal");
    await page.waitForSelector("html[data-ready]");
    const cookies = page.locator(".cookies__panel");
    if (await cookies.isVisible()) await cookies.getByRole("button", { name: "Recusar" }).click();
    const band = page.locator("#reservar a[data-book]");
    await band.scrollIntoViewIfNeeded();
    const scrolled = await page.evaluate(() => scrollY);
    await band.click();
    await expect(page.getByRole("dialog", { name: "Reservar mesa" })).toBeVisible();
    const box = await page.locator("dialog.reserva-janela").boundingBox();
    const viewport = page.viewportSize();
    if (viewport.width < 861) expect(Math.round(box.width)).toBe(viewport.width); // a tela inteira no celular
    await page.goBack();
    await expect(page.getByRole("dialog", { name: "Reservar mesa" })).toBeHidden();
    await expect(page).toHaveURL(/\/\?mock=normal$/);
    expect(Math.abs((await page.evaluate(() => scrollY)) - scrolled)).toBeLessThan(40);
  });
});

test.describe("página 404 nas três línguas (4.7)", () => {
  for (const [path, lang, title] of [
    ["/nao-existe/", "pt-BR", "Essa página não existe"],
    ["/es/no-existe/", "es", "Esta página no existe"],
    ["/en/does/not/exist", "en", "This page doesn't exist"],
  ]) {
    test(`${path}: status 404, a voz da casa, cabeçalho, rodapé e noindex`, async ({ page }) => {
      test.slow();
      const response = await page.goto(`${path}?mock=normal`);
      expect(response.status()).toBe(404);
      await page.waitForSelector("html[data-ready]");
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
      await expect(page.locator(".viga")).toBeVisible();
      await expect(page.locator(".rodape")).toBeAttached();
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      await expect(page.locator(".nao-achou a[data-book]")).toBeVisible();
      expect(await serious(page)).toEqual([]);
      await page.emulateMedia({ colorScheme: "dark" });
      expect(await serious(page)).toEqual([]);
    });
  }
});

test("a raiz é o ícone do site e do painel, nos tamanhos de tela inicial (4.8)", async ({ page, request }) => {
  await page.goto("/?mock=normal");
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute("href", "/img/marca/icone.svg");
  const site = await (await request.get(await page.locator('link[rel="manifest"]').getAttribute("href"))).json();
  await page.goto("/admin/?papel=dono&mock=normal");
  const panel = await (await request.get(await page.locator('link[rel="manifest"]').first().getAttribute("href"))).json();
  expect(panel.icons.map((i) => i.src).sort()).toEqual(site.icons.map((i) => i.src).sort());
  for (const icon of [...site.icons.map((i) => i.src), "/img/marca/icone-32.png", "/img/marca/icone-180.png"]) {
    expect((await request.get(icon)).status(), icon).toBe(200);
  }
  expect(site.icons.some((i) => i.purpose === "maskable")).toBe(true);
});

test("fontes: no máximo duas pré-carregadas e o plano B pronto no token (4.9)", async ({ page }) => {
  await page.goto("/?mock=normal");
  await page.waitForSelector("html[data-ready]");
  expect(await page.locator('link[rel="preload"][as="font"]').count()).toBeLessThanOrEqual(2);
  const planB = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--f-letreiro-b"));
  expect(planB).toContain("Londrina Solid");
});

test.describe("eventos (4.10)", () => {
  test("a agenda mostra os eventos publicados, com reserva no dia ou o motivo de não ter", async ({ page }) => {
    test.slow();
    await page.goto("/eventos/?mock=normal");
    await page.waitForSelector("html[data-ready]");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Eventos");
    const fish = page.locator(".evento", { hasText: "Noite do peixe" }).first();
    await expect(fish.getByRole("link", { name: "Reservar" })).toHaveAttribute("href", /\/reservar\/\?dia=\d{4}-\d{2}-\d{2}$/);
    const party = page.locator(".evento", { has: page.locator(".evento__reserva--sem") }).first();
    await expect(party.getByRole("link", { name: "Reservar" })).toHaveCount(0);
    await expect(party.locator(".evento__reserva--sem")).not.toBeEmpty();
    expect(await serious(page)).toEqual([]);
    await page.emulateMedia({ colorScheme: "dark" });
    expect(await serious(page)).toEqual([]);
  });

  test("cada evento tem a sua página, e o Reservar abre a reserva já no dia", async ({ page }) => {
    await page.goto("/eventos/noite-do-peixe/?mock=normal");
    await page.waitForSelector("html[data-ready]");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Noite do peixe");
    await expect(page).toHaveTitle("Noite do peixe · Território");
    await expect(page.locator(".evento__credito")).toHaveText("Acervo da casa");
    const cookies = page.locator(".cookies__panel");
    if (await cookies.isVisible()) await cookies.getByRole("button", { name: "Recusar" }).click();
    await page.locator(".evento__reserva a[data-book]").click();
    await expect(page.locator("iframe.reserva-janela__quadro")).toHaveAttribute("src", /dia=2026-10-22/);
  });

  test("evento da simulação abre pela página do evento; endereço que não existe é a 404", async ({ page }) => {
    await page.goto("/eventos/?mock=normal");
    await page.waitForSelector("html[data-ready]");
    const link = page.locator(".evento__titulo a").first();
    const name = (await link.textContent()).trim();
    await link.click();
    await page.waitForSelector("html[data-ready]");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
    await page.goto("/en/eventos/nao-existe/?mock=normal");
    await page.waitForSelector("html[data-ready]");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("This page doesn't exist");
  });

  test("sem evento, a agenda some da capa e /eventos mostra o vazio com o caminho para reservar", async ({ page }) => {
    await page.goto("/?mock=vazio");
    await page.waitForSelector("html[data-ready]");
    await expect(page.locator("[data-agenda]")).toBeHidden();
    await page.goto("/eventos/?mock=vazio");
    await page.waitForSelector("html[data-ready]");
    await expect(page.locator(".eventos__vazio")).toContainText("Nenhum evento marcado agora");
    await expect(page.locator(".eventos__vazio a[data-book]")).toBeVisible();
  });
});

test.describe("cookies seguem as configurações (bug 16)", () => {
  test("o aviso volta quando o texto sobe de versão", async ({ page }) => {
    await page.goto("/?mock=normal");
    await page.waitForSelector("html[data-ready]");
    await page.locator(".cookies__panel").getByRole("button", { name: "Aceitar" }).click();
    await page.reload();
    await page.waitForSelector("html[data-ready]");
    await expect(page.locator(".cookies__panel")).toHaveCount(0);
    await setInDb(page, "cookies_settings.banner_version", "2099-01-01");
    await expect(page.locator(".cookies__panel")).toBeVisible();
  });

  test("medição desligada na casa: o aviso nem oferece e nada vai para /measure", async ({ page }) => {
    const sent = [];
    page.on("request", (r) => r.url().endsWith("/api/v1/measure") && sent.push(r.url()));
    await page.goto("/?mock=normal");
    await page.waitForSelector("html[data-ready]");
    await setInDb(page, "cookies_settings.measurement_enabled", false);
    const panel = page.locator(".cookies__panel");
    await panel.getByRole("button", { name: "Escolher" }).click();
    await expect(panel.locator("input[type=checkbox]:not([disabled])")).toHaveCount(1); // só "Lembrar de mim"
    await panel.getByRole("button", { name: "Aceitar" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-measurement", "off");
    await page.waitForTimeout(5000); // as medições vão em lotes a cada 4 s
    expect(sent).toEqual([]);
  });
});
