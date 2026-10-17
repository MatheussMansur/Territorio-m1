// A parte ao vivo do cardápio (história 4.13 e Configurações › Cardápio): "acabou" dito por extenso
// (nunca só pela cor) lido de GET /menu, então o site mostra em até um minuto sem um
// build novo; nada quando a casa desliga "mostrar acabou no site"; e um prato sem
// preço aparece sem preço ou com "consulte", como dizem as configurações. Com a API fora do ar o
// cardápio impresso fica como está: sem marca de esgotado, sem erro.

/** Aplica o cardápio publicado a todo [data-item] da página. Devolve os nomes dos pratos que acabaram. */
export function applyMenu(menu, t) {
  const byName = new Map((menu?.categories || []).flatMap((c) => c.items || []).map((item) => [item.name, item]));
  const showOut = menu?.show_sold_out !== false;
  const out = [];
  for (const li of document.querySelectorAll("[data-item]")) {
    const item = byName.get(li.dataset.item);
    const soldOut = showOut && item?.available === false;
    if (soldOut) out.push(li.dataset.item);
    li.classList.toggle("is-out", soldOut);
    const mark = li.querySelector("[data-sold-out]");
    if (mark) mark.hidden = !soldOut;
    if (item && item.price_cents == null) askPrice(li, menu.unpriced_item === "ask", t);
  }
  return out;
}

/** "consulte" no lugar do preço, ou nada, para um prato sem preço. */
function askPrice(li, ask, t) {
  const line = li.querySelector(".sheet__line");
  let span = li.querySelector("[data-price-ask]");
  if (ask && !span && line) {
    span = document.createElement("span");
    span.className = "sheet__price sheet__price--consulte";
    span.dataset.priceAsk = "";
    span.textContent = t("site.priceAsk");
    line.insertBefore(span, line.querySelector("[data-sold-out]"));
  } else if (!ask && span) {
    span.remove();
  }
}

/** O prato do dia que ainda está valendo: ele vai para "Hoje na casa". */
export const dishOfTheDay = (menu) =>
  (menu?.categories || []).flatMap((c) => c.items || []).find((item) => item.featured && item.available !== false && !item.archived)?.name || null;
