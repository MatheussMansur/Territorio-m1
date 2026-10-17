// O cardápio (/cardapio/, também em /es/ e /en/): o destino do QR nas mesas.
// A comida vem na folha preta de ramen, as bebidas no cartão feito à mão, como a casa imprime.
// Um item sem preço não mostra preço (nunca "a confirmar"); nomes de pratos nunca são traduzidos.
import { h, loc, pathIn, picture } from "../render.js";
import { sheetBody } from "./sheets.js";
import { siteFooter, siteHeader } from "./chrome.js";

export function menu({ house, menu: data, locale, t }) {
  const route = "/cardapio/";
  const categories = data.categories.filter((c) => c.items.length);
  const body = h`
  ${siteHeader({ house, locale, t, route })}
  <main id="conteudo" class="menu-page" data-menu-live>
    <div class="wrap menu-page__head">
      <h1 class="letreiro menu-page__title">${t("site.menuTitle")}</h1>
      <p class="prose menu-page__lede">${t("site.menuLede")}</p>
      ${locale !== "pt" ? h`<p class="menu-page__note">${t("site.menuNoteLanguage")}</p>` : ""}
      <nav class="menu-jump" aria-label="${t("site.menuJump")}">
        <ul class="cluster">${categories.map((c) => h`<li><a class="chip" href="#${c.id}">${loc(c.name, locale)}</a></li>`)}</ul>
      </nav>
    </div>
    <div class="wrap menu-page__sheets">
      ${categories.map(
        (c) => h`<section class="sheet sheet--${c.style}" id="${c.id}" aria-labelledby="${c.id}-titulo">
          ${c.photo ? h`<div class="sheet__coluna">${picture(c.photo, { alt: "", sizes: "(max-width: 860px) 100vw, 320px", className: "sheet__photo" })}</div>` : ""}
          <div class="sheet__body">
            ${sheetBody(c, { t, locale, unpriced: data.price_missing })}
          </div>
        </section>`,
      )}
    </div>
    <div class="wrap menu-page__book">
      <p class="letreiro menu-page__book-title">${t("site.menuBook")}</p>
      <a class="btn btn--lg" href="${pathIn(locale, "/reservar/")}" data-book>${t("site.bookTable")}</a>
      <a class="btn btn--lg btn--outline" href="${pathIn(locale, "/")}">${house.name}</a>
    </div>
  </main>
  ${siteFooter({ house, locale, t })}`;
  return { route, body, script: "/src/pages/site.js", bodyClass: "site site--menu" };
}
