// Os blocos de texto do site (história 4.14/4.15) como o painel edita: três línguas, um rascunho,
// a versão publicada e seu histórico. Feito a partir de src/content/content.json e seo.json,
// os mesmos arquivos de onde o site é montado. Também o histórico de publicações do site (site_render).
import { addDays, houseParts } from "../../lib/dates.js";
import { uuid } from "../../lib/uuid.js";
import CONTENT from "../../content/content.json" with { type: "json" };
import SEO from "../../content/seo.json" with { type: "json" };

const L = (pt = "", es = "", en = "") => ({ pt, es: es || null, en: en || null });
const copy = (text) => (typeof text === "string" ? L(text) : L(text?.pt, text?.es, text?.en));

/** Os campos em pt dos blocos, no formato que a rota pública /content lê (state.content). */
export function publicContent(blocks, previous = {}) {
  const f = (key) => blocks[key]?.published || {};
  const pt = (value) => value?.pt || "";
  const today = f("today");
  return {
    ...previous,
    cover: { kicker: pt(f("cover").kicker), tagline: pt(f("cover").hand), lede: pt(f("cover").lede) },
    about: { title: "A casa", text: pt(f("about").text), signature: pt(f("about").hand) },
    today_rules: Object.entries(today.rules || {})
      .filter(([, text]) => pt(text))
      .map(([weekday, text]) => ({ weekday: Number(weekday), text: pt(text) })),
    today_default: pt(today.default) || previous.today_default || "",
    notices: (f("notices").items || []).map((n) => ({
      text: pt(n.text),
      starts_at: `${n.starts_on}T00:00:00-03:00`,
      ends_at: `${addDays(n.ends_on, 1)}T00:00:00-03:00`,
    })),
    links: { instagram: f("links").instagram || "", shop: f("links").shop || "" },
    seo: { title: pt(f("seo").title), description: pt(f("seo").description) },
  };
}

export function extend(state, now) {
  const today = houseParts(now).date;
  const at = (days, hour = 15) => new Date(`${addDays(today, days)}T${String(hour).padStart(2, "0")}:12:00-03:00`).toISOString();
  const rules = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, L()]));
  for (const rule of CONTENT.today.rules) rules[rule.weekday] = copy(rule.text);
  rules[3] = L("Quarta é dia de ramen: o caldo sai da panela às 19h.");
  rules[6] = L("Sábado tem música um pouco mais alta no quintal.", "El sábado hay música un poco más alta en el patio.");
  const home = SEO.pages[0];

  const current = {
    cover: { kicker: copy(CONTENT.cover.kicker), hand: copy(CONTENT.cover.hand), lede: copy(CONTENT.cover.lede) },
    about: {
      text: copy(CONTENT.about.text),
      hand: copy(CONTENT.about.hand),
      story_1: copy(CONTENT.about.story[0]),
      story_2: copy(CONTENT.about.story[1]),
    },
    notices: {
      items: [
        {
          id: uuid(),
          text: L("Feriado de Finados: a casa abre no sábado a partir das 18h.", "Feriado: el sábado abrimos desde las 18h."),
          starts_on: addDays(today, 10),
          ends_on: addDays(today, 17),
        },
      ],
    },
    today: { rules, default: L("Casa aberta a partir das 19:00.", "Abierto desde las 19:00.", "Open from 7 pm.") },
    links: { instagram: "_territorio_", shop: "lojinhadoterritorio", whatsapp_text: "Oi! Quero reservar uma mesa no Território." },
    seo: { title: copy(home.title), description: copy(home.description) },
  };

  // versões publicadas mais antigas, para o histórico e o "Voltar a esta versão" terem o que mostrar
  const older = {
    cover: [
      { kicker: L("Izakaya na fronteira"), hand: L("Pode entrar!"), lede: L("Comida pra compartilhar e boa bebida, na casa do chef Marcus Norberto.") },
      { kicker: L("Izakaya com sotaque da fronteira"), hand: L("Pode entrar! A casa é sua!"), lede: L("Comida pra compartilhar, boa bebida e música um pouco mais alta.") },
    ],
    seo: [{ title: L("Território · Izakaya em Foz"), description: L("Boteco japonês em Foz do Iguaçu. Reserve sua mesa.") }],
    today: [{ rules: { ...rules, 3: L(), 6: L() }, default: L("Casa aberta a partir das 19:00.") }],
  };
  const people = ["Marcus Norberto", "Gerente da casa"];

  state.site_blocks = {};
  for (const [key, fields] of Object.entries(current)) {
    const past = older[key] || [];
    const history = [...past, fields].map((f, i) => ({
      version: i + 1,
      fields: structuredClone(f),
      published_at: at(-(past.length - i) * 9 - 2, 14 + i),
      published_by: people[i % 2],
    }));
    const last = history.at(-1);
    state.site_blocks[key] = {
      block: key,
      published: structuredClone(fields),
      draft: null,
      version: last.version,
      published_at: last.published_at,
      published_by: last.published_by,
      history,
    };
  }
  // um bloco com um rascunho esperando, para a demonstração mostrar "rascunho" ao lado de "publicado"
  const about = state.site_blocks.about;
  about.draft = structuredClone(about.published);
  about.draft.hand = L("Se aprochegue, a casa é sua!");
  about.draft_saved_at = at(0, 11);
  about.draft_saved_by = "Gerente da casa";

  state.content = publicContent(state.site_blocks, state.content);

  // a tarefa site_render: as últimas publicações, uma delas falhou e foi feita de novo
  const build = (days, hour, reason, status, by, error = null) => {
    const requested = at(days, hour);
    return {
      id: uuid(),
      status,
      reason,
      requested_by: by,
      requested_at: requested,
      started_at: new Date(new Date(requested).getTime() + 2000).toISOString(),
      finished_at: new Date(new Date(requested).getTime() + 48000).toISOString(),
      error,
    };
  };
  state.site_builds = [
    build(-2, 16, "content:cover", "done", "Marcus Norberto"),
    build(-3, 18, "menu:publish", "done", "Gerente da casa"),
    build(-3, 17, "menu:publish", "failed", "Gerente da casa", "render timeout"),
    build(-11, 15, "content:seo", "done", "Marcus Norberto"),
  ];
}
