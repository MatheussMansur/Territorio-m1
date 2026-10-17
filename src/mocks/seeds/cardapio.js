// O cardápio como o painel edita (histórias 4.11 a 4.13). state.menu (dados iniciais básicos) continua sendo o
// cardápio publicado que o site lê; state.menu_draft é o que o dono e o gerente mudam
// até publicarem. As traduções vêm de src/content/menu.json, o arquivo de onde o site é
// montado, e algumas mudanças no rascunho mostram como é um "rascunho".
import { addDays, houseParts } from "../../lib/dates.js";
import { uuid } from "../../lib/uuid.js";
import MENU from "../../content/menu.json" with { type: "json" };

const tr = (text) => ({ es: text?.es || null, en: text?.en || null });

export function extend(state, now) {
  const today = houseParts(now).date;
  // os dados iniciais básicos fizeram o cardápio publicado; acrescenta as outras línguas e a marca de arquivado
  state.menu.forEach((category, ci) => {
    const source = MENU.categories[ci];
    category.i18n = { es: { name: source?.name?.es || null, subtitle: source?.subtitle?.es || null }, en: { name: source?.name?.en || null, subtitle: source?.subtitle?.en || null } };
    category.items.forEach((item, i) => {
      const from = source?.items?.[i];
      item.i18n = { es: { description: tr(from?.description).es }, en: { description: tr(from?.description).en } };
      item.archived = false;
    });
  });
  // hoje à noite o camarão acabou cedo, no site e no painel
  const shrimp = state.menu.flatMap((c) => c.items).find((item) => item.name === "Ebi Tempurá");
  if (shrimp) shrimp.available = false;

  state.menu_meta = { published_at: new Date(`${addDays(today, -3)}T18:04:00-03:00`).toISOString(), published_by: "Gerente da casa" };
  state.menu_draft = structuredClone(state.menu);

  // o que o gerente deixou no rascunho: um prato novo e um preço novo
  const share = state.menu_draft[0];
  if (share) {
    share.items.push({
      id: uuid(), category_id: share.id, name: "Tempurá de legumes", group: null,
      description: "Abóbora, berinjela e cebola numa massa fininha, com molho tentsuyu.",
      i18n: { es: { description: null }, en: { description: null } },
      price_cents: 3400, price_label: null, badges: ["vegetarian"], available: true, featured: false, archived: false, sort: share.items.length,
    });
  }
  const ramen = state.menu_draft.find((c) => c.name === "Ramen");
  const shoyu = ramen?.items.find((item) => /shoyu/i.test(item.name));
  if (shoyu && shoyu.price_cents) shoyu.price_cents += 200;
}
