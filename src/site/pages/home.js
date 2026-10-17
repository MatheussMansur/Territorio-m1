// A página da casa (/, /es/, /en/), como no site aprovado e no PDF: a fachada acesa com o
// círculo de sementes, hoje na casa, o cardápio com abas e folhas, a faixa de reserva com os
// combinados da casa, a casa e a semana, onde fica. Tudo vem de src/content.
import { houseParts } from "../../lib/dates.js";
import { CORE, GRAIN, ROTATIONS } from "../../lib/seal-geometry.js";
import { fillTerms } from "../../lib/terms.js";
import images from "../../content/images.json" with { type: "json" };
import mapImage from "../../content/map.json" with { type: "json" };
import { todayLine, weekDays } from "../live/house-day.js";
import { shiftsOf, shiftsText } from "../hours.js";
import { h, hour, loc, pathIn, picture, raw } from "../render.js";
import { openDays, siteFooter, siteHeader, whatsappLink } from "./chrome.js";
import { eventsBlock } from "./events.js";
import { sheetBody } from "./sheets.js";

/** "Rangos" + "da casa": a segunda metade em marsala, como nos títulos aprovados. */
const heading = (t, key) => h`${t(`site.${key}A`)} <em>${t(`site.${key}B`)}</em>`;

/** O selo da capa, desenhado semente a semente depois do título, como no site aprovado (veja site.css). */
function liveSeal() {
  const seeds = ROTATIONS.map((r, i) => `<g transform="rotate(${r})"><path class="semente" style="--i:${i}" d="${GRAIN}"/></g>`).join("");
  return raw(`<svg class="selo-vivo" viewBox="0 0 100 100" focusable="false"><g transform="translate(50 50)" fill="currentColor">${seeds}<polygon class="miolo" points="${CORE}"/></g></svg>`);
}

function week({ house, t }) {
  const short = t("site.weekdays").split(",");
  return [1, 2, 3, 4, 5, 6, 0].map((wd) => {
    const day = house.hours.find((d) => d.weekday === wd);
    const shifts = shiftsOf(day);
    return shifts.length
      ? h`<li><b>${short[wd]}</b>${shiftsText(shifts, t)}</li>`
      : h`<li class="fecha"><b>${short[wd]}</b>${t(`day.${day?.reason || "closed"}`)}</li>`;
  });
}

function menuBlock({ menu, t, locale }) {
  const categories = menu.categories.filter((c) => c.items.length);
  return h`<div class="esq cardapio" data-tabs>
    <div class="painel cardapio__lado">
      <div class="cardapio__abas" role="tablist" aria-label="${t("site.menuParts")}">
        ${categories.map(
          (c, i) => h`<a class="cardapio__aba" role="tab" href="#folha-${c.id}" id="aba-${c.id}" aria-controls="folha-${c.id}" aria-selected="${i === 0 ? "true" : "false"}" data-tab="${c.id}">
            <span>${loc(c.name, locale)}</span><small>${t("site.menuDishes", { n: c.items.length })}</small></a>`,
        )}
      </div>
      ${categories.map((c) =>
        c.photo
          ? h`<figure class="cardapio__foto" data-tab-photo="${c.id}">
              ${picture(c.photo, { alt: "", sizes: "(max-width: 860px) 100vw, 420px" })}
              <figcaption>${loc(c.name, locale)}</figcaption>
            </figure>`
          : h`<figure class="cardapio__foto cardapio__foto--sem" data-tab-photo="${c.id}">
              <span class="seal-mask" aria-hidden="true"></span>
              <figcaption class="mao" lang="pt-BR">${c.hand}</figcaption>
            </figure>`,
      )}
    </div>
    <div class="cardapio__folhas">
      ${categories.map(
        (c) => h`<section class="sheet sheet--${c.style} cardapio__folha" id="folha-${c.id}" role="tabpanel" aria-labelledby="aba-${c.id}" data-tab-panel="${c.id}">
          <div class="sheet__body">${sheetBody(c, { t, locale, unpriced: menu.price_missing }, 3)}</div>
        </section>`,
      )}
    </div>
  </div>
  <p class="cardapio__mais"><a class="link" href="${pathIn(locale, "/cardapio/")}">${t("site.menuAll")}</a></p>`;
}

/**
 * O que "Hoje na casa" precisa para decidir de novo no navegador: os avisos do build (com a
 * validade), a frase de cada dia da semana e o horário semanal. O script compara as datas
 * com o relógio da casa, então um aviso que acabou depois do build nunca aparece (história 4.4).
 */
function todayData({ house, content }) {
  const rules = Object.fromEntries((content.today.rules || []).map((r) => [r.weekday, r.text]));
  const notices = (content.today.notices || []).map((n) => ({
    text: n.text,
    starts_at: n.starts_at || `${n.starts_on}T00:00:00-03:00`,
    ends_at: n.ends_at || `${n.ends_on}T23:59:59-03:00`,
  }));
  return { hours: house.hours, rules, fallback: content.today.default || null, notices };
}

/** A linha impressa no HTML: o dia da casa quando a página é gerada. */
function todayAtBuild(data, { t, locale }) {
  const now = new Date();
  return todayLine({ ...data, days: weekDays(data.hours, houseParts(now).date), instant: now, t, locale }).text;
}

/** JSON dentro de um elemento script: o "<" nunca o fecha antes da hora. */
const jsonScript = (id, value) => raw(`<script type="application/json" id="${id}">${JSON.stringify(value).replace(/</g, "\\u003c")}</script>`);

/**
 * Se a imagem do mapa vale para a casa: coordenadas confirmadas pelo dono (FR-10) e o mapa feito
 * para esse mesmo ponto. Se a casa mudar de lugar e o mapa não for refeito, ele sai do ar.
 */
export function mapFits(address, map = mapImage) {
  if (address?.coords_confirmed === false || typeof address?.lat !== "number" || typeof address?.lng !== "number") return false;
  return Math.abs(map.lat - address.lat) < 1e-6 && Math.abs(map.lng - address.lng) < 1e-6;
}

/**
 * "Onde fica": a imagem fixa do mapa do OpenStreetMap com o pino da casa (história 4.5), feita
 * por scripts/site/mapa-osm.mjs e servida pelo próprio site, com o crédito pedido pelo OSM.
 */
function whereMap({ house, t }) {
  const a = house.address;
  if (!mapFits(a)) return "";
  const address = `${a.street}, ${a.number} · ${a.district} · ${a.city} – ${a.state}`;
  const set = (ext) => mapImage.widths.map((w) => `/img/mapa/mapa-${w}.${ext} ${w}w`).join(", ");
  const sizes = "(max-width: 860px) 100vw, 560px";
  const largest = mapImage.widths.at(-1);
  return h`<figure class="painel onde__mapa">
    <picture class="onde__imagem" style="background:${mapImage.placeholder}">
      <source type="image/avif" srcset="${set("avif")}" sizes="${sizes}">
      <source type="image/webp" srcset="${set("webp")}" sizes="${sizes}">
      <img class="mapa" src="/img/mapa/mapa-${largest}.png" srcset="${set("png")}" sizes="${sizes}" width="${mapImage.width}" height="${mapImage.height}" alt="${t("site.mapAlt", { address })}" loading="lazy" decoding="async">
    </picture>
    <figcaption class="onde__credito"><a href="${mapImage.credit_url}" rel="noopener">${t("site.mapCredit")}</a></figcaption>
  </figure>`;
}

export function home({ house, content, menu, events, locale, t }) {
  const route = "/";
  const a = house.address;
  const book = pathIn(locale, "/reservar/");
  // o pino só com coordenadas confirmadas; senão os apps procuram o endereço (FR-10)
  const pinned = a.coords_confirmed !== false && typeof a.lat === "number" && typeof a.lng === "number";
  const query = encodeURIComponent(`${a.street}, ${a.number}, ${a.district}, ${a.city} - ${a.state}`);
  const mapsUrl = pinned ? `https://www.google.com/maps/search/?api=1&query=${a.lat},${a.lng}` : `https://www.google.com/maps/search/?api=1&query=${query}`;
  const wazeUrl = pinned ? `https://waze.com/ul?ll=${a.lat},${a.lng}&navigate=yes` : `https://waze.com/ul?q=${query}&navigate=yes`;
  const today = todayData({ house, content });

  const body = h`
  ${siteHeader({ house, locale, t, route, overCover: true })}
  <main id="conteudo">
    <section class="capa" aria-labelledby="capa-titulo">
      <div class="capa__foto">
        <picture>
          <source media="(max-width: 860px)" type="image/avif" srcset="/img/fotos/capa-cel-480.avif 480w, /img/fotos/capa-cel-960.avif 960w, /img/fotos/capa-cel-1080.avif 1080w" sizes="100vw">
          <source media="(max-width: 860px)" type="image/webp" srcset="/img/fotos/capa-cel-480.webp 480w, /img/fotos/capa-cel-960.webp 960w, /img/fotos/capa-cel-1080.webp 1080w" sizes="100vw">
          <source media="(max-width: 860px)" srcset="/img/fotos/capa-cel-960.jpg 960w, /img/fotos/capa-cel-1080.jpg 1080w" sizes="100vw">
          <source type="image/avif" srcset="/img/fotos/capa-960.avif 960w, /img/fotos/capa-1440.avif 1440w" sizes="100vw">
          <source type="image/webp" srcset="/img/fotos/capa-960.webp 960w, /img/fotos/capa-1440.webp 1440w" sizes="100vw">
          <img src="/img/fotos/capa-1440.jpg" srcset="/img/fotos/capa-960.jpg 960w, /img/fotos/capa-1440.jpg 1440w" sizes="100vw" width="1440" height="960" alt="${loc(content.cover.photo_alt, locale)}" fetchpriority="high">
        </picture>
      </div>
      <div class="capa__escuro" aria-hidden="true"></div>
      <div class="capa__apagada" aria-hidden="true"></div>
      <div class="wrap capa__in">
        <div class="capa__texto">
          <p class="rotulo capa__rotulo entra" style="--atraso: 0.9s"><span data-text="cover.kicker">${loc(content.cover.kicker, locale)}</span> · ${a.city}</p>
          <h1 class="entra" id="capa-titulo" style="--atraso: 0.98s"><span class="logo-letreiro capa__logo" role="img" aria-label="${house.name}"></span></h1>
          <p class="mao capa__mao entra" lang="pt-BR" style="--atraso: 1.06s" data-text="cover.hand" data-text-lang="pt">${content.cover.hand}</p>
          <p class="capa__lede entra" style="--atraso: 1.14s" data-text="cover.lede">${loc(content.cover.lede, locale)}</p>
          <div class="capa__acoes entra" style="--atraso: 1.22s">
            <a class="btn btn-inverso" href="${book}" data-book>${t("site.bookTable")}</a>
            <a class="link link--claro" href="${pathIn(locale, "/cardapio/")}">${t("site.seeMenu")}</a>
          </div>
        </div>
        <div class="selo-palco" aria-hidden="true" data-selo><div class="selo-palco__selo"><div class="selo-palco__giro">${liveSeal()}</div></div></div>
      </div>
      <div class="capa__rodape">
        <div class="wrap">
          <span data-live="open-status"><b>${openDays({ house, t, locale })}</b> <small class="capa__fuso" data-live="foz-time" hidden>${t("site.fozTime")}</small></span>
          <span>${a.street}, ${a.number} · ${a.district}</span>
          <span>${a.city} – ${a.state}</span>
        </div>
      </div>
    </section>

    <section class="hoje" aria-labelledby="hoje-titulo">
      <div class="wrap hoje__in">
        <span class="seal-mask hoje__selo" aria-hidden="true"></span>
        <div>
          <h2 class="sr-only" id="hoje-titulo">${t("site.today")}</h2>
          <p class="hoje__regra" data-live="today">${todayAtBuild(today, { t, locale })}</p>
          ${jsonScript("hoje-dados", today)}
          <p class="hoje__dica">${t("site.openFrom", { open: hour(shiftsOf(house.hours.find((d) => d.open))[0]?.opens_at || "19:00", locale) })} ${t("site.bookHere")}</p>
        </div>
      </div>
    </section>

    <section class="sec sec-barra sec-kraft" id="rangos" aria-labelledby="rangos-titulo">
      <div class="wrap">
        <span class="placa">${t("site.plateMenu")}</span>
        <div class="sec-cabeca">
          <h2 class="letreiro" id="rangos-titulo">${heading(t, "menuHead")}</h2>
          <p class="prose">${t("site.menuLede")}</p>
        </div>
        ${menuBlock({ menu, t, locale })}
      </div>
    </section>

    <section class="sec sec-barra" id="reservar" aria-labelledby="reservar-titulo">
      <div class="wrap">
        <span class="placa">${t("site.plateBook")}</span>
        <div class="reserva-faixa">
          <div>
            <h2 class="letreiro" id="reservar-titulo">${heading(t, "bookHead")}</h2>
            <p class="prose">${t("site.bookBandText")}</p>
          </div>
          <a class="btn btn--lg" href="${book}" data-book>${t("site.bookTable")}</a>
        </div>
        <h3 class="combinados__titulo">${t("site.termsTitle")}</h3>
        <ol class="notas">
          ${content.terms.map(
            (term, i) => h`<li><span class="notas__num">${i + 1}</span><div><h4>${fillTerms(loc(term.title, locale), house.booking_rules)}</h4><p>${fillTerms(loc(term.text, locale), house.booking_rules)}</p></div></li>`,
          )}
        </ol>
      </div>
    </section>

    <section class="sec sec-barra sec-kraft" id="casa" aria-labelledby="casa-titulo">
      <div class="wrap">
        <span class="placa">${t("site.plateHouse")}</span>
        <div class="esq esq--2 casa">
          <figure class="painel painel-foto casa__foto">
            ${picture(content.about.photo, { alt: loc(content.about.photo_alt, locale), sizes: "(max-width: 860px) 100vw, 50vw" })}
          </figure>
          <div class="painel casa__texto">
            <h2 class="letreiro sec-titulo" id="casa-titulo">${heading(t, "houseHead")}</h2>
            <p class="mao casa__mao" lang="pt-BR" data-text="about.hand" data-text-lang="pt">${content.about.hand}</p>
            ${content.about.story.map((p, i) => h`<p class="prose casa__lede" data-text="about.story_${i + 1}">${loc(p, locale)}</p>`)}
            <h3 class="rotulo casa__semana-titulo">${t("site.week")}</h3>
            <ol class="esq esq-fina semana">${week({ house, t, locale })}</ol>
          </div>
        </div>

        <h3 class="casa__subtitulo">${loc(content.about.night_title, locale)}</h3>
        <ol class="notas noite">
          ${content.about.night.map(
            (step, i) => h`<li><span class="notas__num">${i + 1}</span><div><h4>${loc(step.title, locale)}</h4><p>${loc(step.text, locale)}</p></div></li>`,
          )}
        </ol>

        <h3 class="casa__subtitulo">${loc(content.about.quotes_title, locale)}</h3>
        <div class="esq verbetes">
          ${content.about.quotes.map(
            (q) => h`<figure class="painel verbete">
              <figcaption class="verbete__titulo">${loc(q.title, locale)}</figcaption>
              <blockquote><p>${loc(q.text, locale)}</p></blockquote>
              <p class="verbete__fonte">${t("site.quoteBy")}</p>
            </figure>`,
          )}
          <div class="painel verbete-fecho">
            <span class="seal-mask" aria-hidden="true"></span>
            <p class="mao" lang="pt-BR">${content.about.closing.hand}</p>
            <span class="rotulo">${content.about.closing.by}</span>
          </div>
        </div>
      </div>
    </section>

    <section class="sec sec-barra" id="ambiente" aria-labelledby="ambiente-titulo">
      <div class="wrap">
        <span class="placa">${loc(content.gallery_title, locale)}</span>
        <h2 class="sr-only" id="ambiente-titulo">${loc(content.gallery_title, locale)}</h2>
        <ul class="esq galeria" data-galeria data-prev="${t("site.galleryPrev")}" data-next="${t("site.galleryNext")}" data-close="${t("site.galleryClose")}" data-count="${t("site.galleryCount")}">
          ${content.gallery.map(
            (g, i) => h`<li class="galeria__item${g.wide ? " galeria__item--largo" : ""}" data-photo="${g.photo}">
              <a class="galeria__link" href="/img/fotos/${g.photo}-${images[g.photo].widths.at(-1)}.jpg" data-galeria-foto="${i}" aria-label="${t("site.galleryOpen", { area: loc(g.area, locale) })}">
                ${picture(g.photo, { alt: loc(g.alt, locale), sizes: "(max-width: 860px) 50vw, 25vw" })}
                <span class="galeria__legenda">${loc(g.area, locale)}</span>
              </a>
              <small class="galeria__credito" data-credit${g.credit ? "" : raw(" hidden")}>${g.credit ? t("site.galleryCredit", { credit: g.credit }) : ""}</small>
            </li>`,
          )}
        </ul>
      </div>
    </section>

    ${eventsBlock({ events, t, locale })}

    <section class="sec sec-barra" id="onde" aria-labelledby="onde-titulo">
      <div class="wrap">
        <span class="placa">${t("site.plateWhere")}</span>
        <div class="esq esq--2 onde">
          <div class="painel onde__texto">
            <h2 class="letreiro sec-titulo" id="onde-titulo">${heading(t, "whereHead")}</h2>
            <address class="onde__endereco">${a.street}, ${a.number}<br>${a.district} · ${a.city} – ${a.state}<br>${a.zip}</address>
            <p class="onde__horario"><b>${t("site.hours")}</b> ${openDays({ house, t, locale })}</p>
            <div class="onde__acoes">
              <a class="btn" href="${mapsUrl}" rel="noopener">${t("site.maps")}</a>
              <a class="btn btn--outline" href="${wazeUrl}" rel="noopener">${t("site.waze")}</a>
              <a class="btn btn--outline" href="${whatsappLink(house, "")}" rel="noopener">${t("site.whatsapp")}</a>
            </div>
          </div>
          ${whereMap({ house, t, locale })}
        </div>
      </div>
    </section>
  </main>
  ${siteFooter({ house, locale, t })}`;

  return { route, body, script: "/src/pages/site.js", bodyClass: "site site--home" };
}
