// A noite da demonstração num relógio fixo da casa, para as specs de Salão, Espera e Hoje. Não é uma spec.
// Fora do horário de serviço o mock simula a noite a partir das 20:40 no relógio do aparelho; a partir de uma hora
// antes de abrir ele usa a hora real, então uma spec que conta com a noite da demonstração
// passaria ou falharia conforme a hora em que roda. Estes passos fixam o ?agora= na data de hoje.

export const DEMO_TIME = "20:40"; // onde o mock começa a noite da demonstração (seeds/salao.js)

/** A data de hoje na casa (America/Sao_Paulo), pelo relógio desta máquina. */
export const houseToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

async function plainOpen(page, url) {
  await page.goto(url);
  await page.waitForSelector("html[data-ready]");
}

/**
 * A data de hoje pelo mock (a próxima noite aberta), com a noite semeada às 20:40 seja qual for a
 * hora: o relógio do mock fica em `${date}T20:40` pelo resto da aba até outro ?agora=.
 * Um dia fechado responde com a próxima noite aberta, e a segunda carga semeia essa.
 */
export async function tonight(page, open = plainOpen) {
  let date = houseToday();
  for (let i = 0; i < 2; i++) {
    await open(page, `/admin/salao?papel=dono&mock=normal&agora=${date}T${DEMO_TIME}`);
    const night = await page.evaluate(() => fetch("/api/v1/staff/floor").then((r) => r.json()).then((f) => f.date));
    if (night === date) return date;
    date = night;
  }
  return date;
}

/** O ?agora= da noite da demonstração: hoje às 20:40. */
export async function demoNight(page, open) {
  return `agora=${await tonight(page, open)}T${DEMO_TIME}`;
}
