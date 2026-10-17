// A prévia do cardápio, como o site e /cardapio mostram: uma folha por categoria, no estilo dos
// cardápios impressos da casa, no idioma escolhido. Pratos arquivados e categorias vazias ficam
// de fora, prato sem preço aparece sem preço (nunca "a confirmar"), "acabou" vem escrito.
import { html, nothing } from "../../../lib/html.js";
import { langTabs } from "../site/comum.js";

const BADGE = {
  vegetarian: { pt: "vegetariano", es: "vegetariano", en: "vegetarian" },
  gluten_free: { pt: "sem glúten", es: "sin gluten", en: "gluten free" },
  spicy: { pt: "picante", es: "picante", en: "spicy" },
};
const SOLD_OUT = { pt: "acabou", es: "agotado", en: "sold out" };
// um prato sem preço, quando Configurações › Cardápio diz "consulte" (nunca "a confirmar")
const ASK = { pt: "consulte", es: "consultá", en: "ask us" };

const money = (cents) => (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: cents % 100 ? 2 : 0 });

/** O texto de uma categoria ou prato no idioma, caindo para o português. */
export const nameOf = (c, lang) => (lang === "pt" ? c.name : c.i18n?.[lang]?.name || c.name);
const subtitleOf = (c, lang) => (lang === "pt" ? c.subtitle : c.i18n?.[lang]?.subtitle || c.subtitle);
const descOf = (i, lang) => (lang === "pt" ? i.description : i.i18n?.[lang]?.description || i.description);
const translated = (value, lang) => lang === "pt" || Boolean(value);

/** Categorias que ficariam vazias no site. */
export const emptyCategories = (categories) => categories.filter((c) => !c.items.some((i) => !i.archived));

function groups(items) {
  const out = [];
  for (const item of items) {
    const last = out.at(-1);
    if (last && last.group === (item.group || null)) last.items.push(item);
    else out.push({ group: item.group || null, items: [item] });
  }
  return out;
}

function item(i, lang, unpriced) {
  const desc = descOf(i, lang);
  return html`<li class="cd-folha__item ${i.available ? "" : "is-acabou"}">
    <p class="cd-folha__linha">
      <b lang="pt-BR">${i.name}</b>
      ${(i.badges || []).map((b) => html`<span class="cd-folha__selo">${BADGE[b]?.[lang] || b}</span>`)}
      ${i.price_cents != null
        ? html`<span class="cd-folha__preco">R$ ${money(i.price_cents)}</span>`
        : unpriced === "ask"
          ? html`<span class="cd-folha__preco cd-folha__preco--consulte">${ASK[lang]}</span>`
          : nothing}
      ${i.available ? nothing : html`<span class="cd-folha__acabou">${SOLD_OUT[lang]}</span>`}
    </p>
    ${desc ? html`<p class="cd-folha__desc" lang=${translated(i.i18n?.[lang]?.description, lang) ? (lang === "pt" ? "pt-BR" : lang) : "pt-BR"}>${desc}</p>` : nothing}
  </li>`;
}

function sheet(c, lang, unpriced) {
  const items = c.items.filter((i) => !i.archived);
  const style = c.sheet_style === "handmade" ? "mao" : c.sheet_style === "light" ? "clara" : "preta";
  const ramen = /ramen/i.test(c.name);
  return html`<article class="cd-folha cd-folha--${style} ${ramen ? "cd-folha--ramen" : ""}" aria-labelledby=${`folha-${c.id}`}>
    <h3 class="cd-folha__titulo" id=${`folha-${c.id}`}>${nameOf(c, lang)}</h3>
    ${subtitleOf(c, lang) ? html`<p class="cd-folha__sub">${subtitleOf(c, lang)}</p>` : nothing}
    ${groups(items).map(
      (g) => html`${g.group ? html`<h4 class="cd-folha__grupo">${g.group}</h4>` : nothing}
        <ul class="cd-folha__itens">${g.items.map((i) => item(i, lang, unpriced))}</ul>`,
    )}
    ${c.footer ? html`<p class="cd-folha__mao" lang="pt-BR">${c.footer}</p>` : nothing}
  </article>`;
}

/** O corpo da janela de prévia; `state.lang` muda com as abas, `state.unpriced` é a configuração. */
export function previewBody(categories, state, redraw) {
  const empty = emptyCategories(categories);
  const shown = categories.filter((c) => !empty.includes(c));
  return html`${langTabs({ id: "previa", lang: state.lang, onPick: (code) => ((state.lang = code), redraw()), label: "Língua da prévia" })}
    ${empty.length
      ? html`<ul class="cd-avisos" role="list">
          ${empty.map((c) => html`<li class="notice notice--alert">${c.name} está vazia e não vai aparecer.</li>`)}
        </ul>`
      : nothing}
    <div class="cd-folhas" role="tabpanel" id="previa-painel" aria-labelledby=${`previa-tab-${state.lang}`}>
      ${shown.length ? shown.map((c) => sheet(c, state.lang, state.unpriced)) : html`<p class="cs-dica">Nenhum prato para mostrar: o site ficaria sem cardápio.</p>`}
    </div>`;
}
