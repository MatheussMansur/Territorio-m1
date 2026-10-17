// Os eventos da casa (história 4.10): a agenda (/eventos/, também em /es/ e /en/), uma página por
// evento (/eventos/{slug}/) e o bloco "Território Convida" da página da casa. Feitos a partir de
// src/content/events.json, a foto do que o painel publicou; com a API ligada, o
// script da página (src/site/live/events.js) atualiza a lista. Modos de reserva: tables,
// list e mixed mostram "Reservar" com o dia do evento já escolhido; private e none dizem
// por que não há botão.
import { HTML_LANG, h, hour, loc, pathIn, picture, raw } from "../render.js";
import { siteFooter, siteHeader } from "./chrome.js";
import { notFoundBody } from "./not-found.js";

const BOOKABLE = new Set(["tables", "list", "mixed"]);

/** A noite a que um instante pertence: um evento depois da meia-noite é "hoje" até 05:00. */
export function nightOf(instant = new Date()) {
  const shifted = new Date(new Date(instant).getTime() - 5 * 3_600_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(shifted);
}

/** Eventos de hoje à noite em diante, por ordem de data. */
export function upcoming(events, instant = new Date()) {
  const night = nightOf(instant);
  return [...(events?.events || [])].filter((e) => e.date >= night).sort((a, b) => `${a.date}${a.starts_at}`.localeCompare(`${b.date}${b.starts_at}`));
}

/** "quinta-feira, 22 de outubro" no idioma da página (a data é um dia do calendário, sem fuso). */
export function longDate(date, locale) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(HTML_LANG[locale], { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

export const eventPath = (locale, slug) => pathIn(locale, `/eventos/${slug}/`);

/** A parte da reserva: o botão com o dia já escolhido, ou o motivo de não haver um. */
export function bookingBit(event, { t, locale }) {
  if (BOOKABLE.has(event.booking_mode)) {
    return h`<p class="evento__reserva">
      <a class="btn btn--sm" href="${pathIn(locale, "/reservar/")}?dia=${event.date}" data-book data-book-day="${event.date}">${t("site.eventBook")}</a>
      <span class="evento__modo">${t(`site.eventMode.${event.booking_mode}`)}</span>
    </p>`;
  }
  const why = loc(event.no_booking_label, locale) || t(event.booking_mode === "private" ? "site.eventPrivate" : "site.eventFree");
  return h`<p class="evento__reserva evento__reserva--sem"><b>${why}</b></p>`;
}

function photo(event, locale, sizes) {
  if (!event.photo) return "";
  return h`<figure class="evento__foto">
    ${picture(event.photo, { alt: loc(event.photo_alt, locale), sizes })}
    ${event.credit ? h`<figcaption class="evento__credito">${event.credit}</figcaption>` : ""}
  </figure>`;
}

/** Um evento numa lista (a agenda e a página da casa). */
export function eventCard(event, { t, locale, level = 3, now = new Date() }) {
  const tag = raw(level === 2 ? "h2" : "h3");
  const tonight = event.date === nightOf(now);
  const title = loc(event.title, locale);
  return h`<li class="painel evento" data-event="${event.slug}">
    ${photo(event, locale, "(max-width: 860px) 100vw, 360px")}
    <div class="evento__texto">
      <p class="rotulo evento__quando"><time datetime="${event.date}T${event.starts_at}">${tonight ? h`<b class="evento__hoje">${t("site.eventTonight")}</b> · ` : ""}${t("site.eventWhen", { day: longDate(event.date, locale), time: hour(event.starts_at, locale) })}</time></p>
      <${tag} class="evento__titulo"><a href="${eventPath(locale, event.slug)}">${title}</a></${tag}>
      <p class="evento__desc"${event.description?.[locale] ? "" : h` lang="pt-BR"`}>${loc(event.description, locale)}</p>
      ${bookingBit(event, { t, locale })}
    </div>
  </li>`;
}

/** "Território Convida" na página da casa: some quando não há evento, a não ser que as configurações digam "sempre". */
export function eventsBlock({ events, t, locale, now = new Date() }) {
  const list = upcoming(events, now);
  if (!list.length && events?.agenda !== "always") return h`<section class="sec sec-barra" id="convida" aria-labelledby="convida-titulo" data-agenda hidden></section>`;
  return h`<section class="sec sec-barra" id="convida" aria-labelledby="convida-titulo" data-agenda>
    <div class="wrap">
      <span class="placa">${t("site.events")}</span>
      <h2 class="letreiro sec-titulo" id="convida-titulo">${t("site.events")}</h2>
      ${list.length
        ? h`<ul class="esq eventos" data-agenda-list>${list.slice(0, 3).map((e) => eventCard(e, { t, locale, now }))}</ul>`
        : h`<p class="prose" data-agenda-list>${t("site.eventsEmpty")}</p>`}
      <p class="eventos__mais"><a class="link" href="${pathIn(locale, "/eventos/")}">${t("site.eventsAll")}</a></p>
    </div>
  </section>`;
}

/** /eventos/: a agenda dos próximos eventos, ou o estado vazio com a raiz e o caminho para reservar. */
export function events({ house, events: data, locale, t }) {
  const route = "/eventos/";
  const list = upcoming(data);
  const body = h`
  ${siteHeader({ house, locale, t, route })}
  <main id="conteudo" class="wrap eventos-pagina">
    <span class="placa">${t("site.events")}</span>
    <div class="sec-cabeca">
      <h1 class="letreiro">${t("site.eventsTitle")}</h1>
      <p class="prose">${t("site.eventsLede")}</p>
    </div>
    <div data-agenda-page>
      ${list.length
        ? h`<ul class="esq eventos eventos--pagina" data-agenda-list>${list.map((e) => eventCard(e, { t, locale, level: 2 }))}</ul>`
        : emptyAgenda({ t, locale })}
    </div>
  </main>
  ${siteFooter({ house, locale, t })}`;
  return { route, body, script: "/src/pages/site.js", bodyClass: "site site--eventos" };
}

export function emptyAgenda({ t, locale }) {
  return h`<div class="painel eventos__vazio" data-agenda-list>
    <span class="raiz-marca eventos__raiz" aria-hidden="true"></span>
    <p class="prose">${t("site.eventsEmpty")}</p>
    <p><a class="btn" href="${pathIn(locale, "/reservar/")}" data-book>${t("site.bookTable")}</a></p>
  </div>`;
}

/** /eventos/{slug}/: um evento. Um slug desconhecido recebe o 404 da casa (a casca do servidor de desenvolvimento é "evento"). */
export function event({ house, events: data, locale, t, path }) {
  const slug = String(path || "").replace(/\\/g, "/").split("/").filter(Boolean).filter((p) => !["es", "en", "eventos", "index.html"].includes(p))[0];
  const found = (data?.events || []).find((e) => e.slug === slug);
  const route = `/eventos/${slug || "evento"}/`;
  if (!found) {
    // a casca responde por todo evento que o build ainda não conhece; o script a preenche pela API
    const body = h`
    ${siteHeader({ house, locale, t, route })}
    <main id="conteudo" class="wrap evento-pagina" data-event-shell="${slug || ""}">
      ${notFoundBody({ t, locale })}
    </main>
    ${siteFooter({ house, locale, t })}`;
    return { route, body, script: "/src/pages/site.js", bodyClass: "site site--evento", title: t("site.notFound.title") };
  }
  const title = loc(found.title, locale);
  const body = h`
  ${siteHeader({ house, locale, t, route })}
  <main id="conteudo" class="wrap evento-pagina" data-event-page="${found.slug}">
    <p class="evento-pagina__voltar"><a class="link" href="${pathIn(locale, "/eventos/")}">← ${t("site.eventBack")}</a></p>
    <span class="placa">${t("site.events")}</span>
    <article class="esq${found.photo ? " esq--2" : ""} evento evento--pagina" data-event="${found.slug}">
      ${photo(found, locale, "(max-width: 860px) 100vw, 50vw")}
      <div class="painel evento__texto">
        <p class="rotulo evento__quando"><time datetime="${found.date}T${found.starts_at}">${t("site.eventWhen", { day: longDate(found.date, locale), time: hour(found.starts_at, locale) })}</time></p>
        <h1 class="letreiro evento__titulo">${title}</h1>
        <p class="prose evento__desc"${found.description?.[locale] ? "" : h` lang="pt-BR"`}>${loc(found.description, locale)}</p>
        ${bookingBit(found, { t, locale })}
      </div>
    </article>
  </main>
  ${siteFooter({ house, locale, t })}`;
  return { route, body, script: "/src/pages/site.js", bodyClass: "site site--evento", title: `${title} · ${house.name}` };
}
