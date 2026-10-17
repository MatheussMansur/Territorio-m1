// As folhas do cardápio como a casa imprime: a comida na folha preta de ramen, as bebidas no
// cartão feito à mão. Usadas pela página do cardápio e pelo bloco do cardápio na página da casa.
// "Acabou" nunca é impresso pelo build: só aparece ao vivo, lido de GET /menu (história 4.13),
// então com a API fora do ar o cardápio não mostra marca de esgotado nenhuma. Cada prato leva o nome em
// data-item para o script. Um prato sem preço segue Configurações › Cardápio (o price_missing do
// menu.json): sem preço nenhum ("omit") ou a palavra "consulte" ("ask"), nunca "a confirmar".
import { h, loc, money, raw } from "../render.js";

function badges(item, t) {
  return (item.badges || []).map((b) => h`<span class="sheet__tag">${t(`site.badge_${b}`)}</span>`);
}

/** Descrições ainda não traduzidas mantêm lang="pt-BR", para os leitores de tela lerem certo. */
function descLang(item, locale) {
  return item.description?.[locale] ? "" : raw(' lang="pt-BR"');
}

function price(item, t, unpriced) {
  if (item.price_cents != null) return h`<span class="sheet__price">${money(item.price_cents)}</span>`;
  return unpriced === "ask" ? h`<span class="sheet__price sheet__price--consulte" data-price-ask>${t("site.priceAsk")}</span>` : "";
}

/** A marca que o script liga quando o prato acaba nesta noite (escondida no build). */
const soldOut = (t) => h` <span class="sheet__out" data-sold-out hidden>${t("site.soldOut")}</span>`;

/** Itens separados pelo título do grupo ("Coquetéis", "Cervejas"…), mantendo a ordem. */
function grouped(items) {
  const groups = [];
  for (const item of items) {
    const key = item.group ? JSON.stringify(item.group) : "";
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, group: item.group, items: [item] });
  }
  return groups;
}

export function darkSheet(category, { t, locale, unpriced }) {
  return h`<ul class="sheet__items">${category.items.map(
    (item) => h`<li class="sheet__item" data-item="${item.name}">
      <p class="sheet__line"><b lang="pt-BR">${item.name}</b> ${badges(item, t)} ${price(item, t, unpriced)}${soldOut(t)}</p>
      ${item.description ? h`<p class="sheet__desc"${descLang(item, locale)}>${loc(item.description, locale)}</p>` : ""}
    </li>`,
  )}</ul>`;
}

export function handSheet(category, { t, locale, unpriced }) {
  return grouped(category.items).map(
    (g) => h`<div class="sheet__box">
      ${g.group ? h`<h3 class="sheet__group">${loc(g.group, locale)}</h3>` : ""}
      <ul class="sheet__items">${g.items.map(
        (item) => h`<li class="sheet__item" data-item="${item.name}">
          <p class="sheet__line"><b>${item.name}</b> ${badges(item, t)} ${price(item, t, unpriced)}${soldOut(t)}</p>
          ${item.description ? h`<p class="sheet__desc"${descLang(item, locale)}>${loc(item.description, locale)}</p>` : ""}
        </li>`,
      )}</ul>
    </div>`,
  );
}


/** O corpo inteiro da folha: título, subtítulo, itens e a linha escrita à mão no pé. */
export function sheetBody(category, { t, locale, unpriced = "omit" }, level = 2) {
  const tag = raw(`h${level}`);
  return h`<${tag} class="sheet__title" id="${category.id}-titulo">${loc(category.name, locale)}</${tag}>
    <p class="sheet__sub">${loc(category.subtitle, locale)}</p>
    ${category.style === "handmade" ? handSheet(category, { t, locale, unpriced }) : darkSheet(category, { t, locale, unpriced })}
    <p class="sheet__hand mao" lang="pt-BR">${category.hand}</p>`;
}
