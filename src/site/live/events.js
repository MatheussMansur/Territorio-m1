// Os eventos com a API ligada (história 4.10): a agenda da página da casa e de /eventos/ é
// redesenhada a partir de GET /content, então um evento publicado no painel aparece sem build novo;
// uma página de evento que o build ainda não conhece (a casca do servidor de desenvolvimento) é preenchida pela mesma
// lista, ou fica no 404 da casa quando o slug não existe ou o evento foi despublicado.
// O HTML é o do build (src/site/pages/events.js), então a página fica igual.
import { html, nothing, render } from "../../lib/html.js";
import { formatTime } from "../time.js";
import { inLang } from "./house-day.js";

const BOOKABLE = new Set(["tables", "list", "mixed"]);
const LANG = { pt: "pt-BR", es: "es", en: "en" };

// o lit-html acrescenta depois do que um container já tem: o HTML do build é limpo uma vez, antes
// do primeiro desenho ao vivo
const drawn = new WeakSet();
function draw(template, container) {
  if (!drawn.has(container)) {
    container.replaceChildren();
    drawn.add(container);
  }
  render(template, container);
}

const pathIn = (locale, route) => (locale === "pt" ? route : `/${locale}${route}`);

function longDate(date, locale) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(LANG[locale], { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

/** <picture> a partir das fontes de um ImageRef (AVIF, WebP, JPEG). */
function picture(image, sizes) {
  const by = (format) => (image.sources || []).filter((s) => s.format === format);
  const set = (list) => list.map((s) => `${s.url} ${s.width}w`).join(", ");
  const jpeg = by("jpeg");
  const fallback = jpeg.at(-1)?.url || image.sources?.[0]?.url || "";
  return html`<picture style=${image.placeholder ? `background:${image.placeholder}` : ""}>
    ${by("avif").length ? html`<source type="image/avif" srcset=${set(by("avif"))} sizes=${sizes} />` : nothing}
    ${by("webp").length ? html`<source type="image/webp" srcset=${set(by("webp"))} sizes=${sizes} />` : nothing}
    <img src=${fallback} srcset=${jpeg.length ? set(jpeg) : nothing} sizes=${sizes} width=${image.width || nothing} height=${image.height || nothing} alt=${image.alt || ""} loading="lazy" decoding="async" />
  </picture>`;
}

function photo(event, sizes) {
  if (!event.image) return nothing;
  return html`<figure class="evento__foto">
    ${picture(event.image, sizes)}
    ${event.image.credit ? html`<figcaption class="evento__credito">${event.image.credit}</figcaption>` : nothing}
  </figure>`;
}

function bookingBit(event, { t, locale }) {
  if (BOOKABLE.has(event.booking_mode)) {
    return html`<p class="evento__reserva">
      <a class="btn btn--sm" href=${`${pathIn(locale, "/reservar/")}?dia=${event.date}`} data-book data-book-day=${event.date}>${t("site.eventBook")}</a>
      <span class="evento__modo">${t(`site.eventMode.${event.booking_mode}`)}</span>
    </p>`;
  }
  const why = inLang(event.no_booking_label, locale) || t(event.booking_mode === "private" ? "site.eventPrivate" : "site.eventFree");
  return html`<p class="evento__reserva evento__reserva--sem"><b>${why}</b></p>`;
}

const when = (event, { t, locale }) =>
  html`<time datetime=${`${event.date}T${event.starts_at}`}
    >${event.tonight ? html`<b class="evento__hoje">${t("site.eventTonight")}</b> · ` : nothing}${t("site.eventWhen", {
      day: longDate(event.date, locale),
      time: formatTime(event.starts_at, t),
    })}</time
  >`;

const description = (event, locale) => {
  const own = event.description_i18n?.[locale] && event.description_i18n[locale] !== event.description_i18n.pt;
  return html`<p class="evento__desc" lang=${own || locale === "pt" ? nothing : "pt-BR"}>${inLang(event.description_i18n, locale) || event.description}</p>`;
};

export function eventCard(event, { t, locale, level = 3 }) {
  const title = inLang(event.title_i18n, locale) || event.title;
  const link = html`<a href=${pathIn(locale, `/eventos/${event.slug}/`)}>${title}</a>`;
  return html`<li class="painel evento" data-event=${event.slug}>
    ${photo(event, "(max-width: 860px) 100vw, 360px")}
    <div class="evento__texto">
      <p class="rotulo evento__quando">${when(event, { t, locale })}</p>
      ${level === 2 ? html`<h2 class="evento__titulo">${link}</h2>` : html`<h3 class="evento__titulo">${link}</h3>`}
      ${description(event, locale)}
      ${bookingBit(event, { t, locale })}
    </div>
  </li>`;
}

/**
 * O bloco de agenda da página da casa e a lista de /eventos/, a partir dos eventos ao vivo.
 * `agenda` é Configurações › Eventos ("only_with_event" esconde o bloco sem eventos).
 */
export function renderAgenda(events, { t, locale, agenda = "only_with_event" }) {
  const upcoming = events.filter((e) => !e.past);
  const block = document.querySelector("[data-agenda]");
  if (block) {
    const list = block.querySelector("[data-agenda-list]");
    block.hidden = !upcoming.length && agenda !== "always";
    if (list && upcoming.length) {
      const ul = document.createElement("ul");
      ul.className = "esq eventos";
      ul.dataset.agendaList = "";
      draw(upcoming.slice(0, 3).map((e) => eventCard(e, { t, locale })), ul);
      list.replaceWith(ul);
    } else if (list && !upcoming.length) {
      const p = document.createElement("p");
      p.className = "prose";
      p.dataset.agendaList = "";
      p.textContent = t("site.eventsEmpty");
      list.replaceWith(p);
    }
  }
  const page = document.querySelector("[data-agenda-page]");
  if (page) {
    draw(
      upcoming.length
        ? html`<ul class="esq eventos eventos--pagina" data-agenda-list>${upcoming.map((e) => eventCard(e, { t, locale, level: 2 }))}</ul>`
        : html`<div class="painel eventos__vazio" data-agenda-list>
            <span class="raiz-marca eventos__raiz" aria-hidden="true"></span>
            <p class="prose">${t("site.eventsEmpty")}</p>
            <p><a class="btn" href=${pathIn(locale, "/reservar/")} data-book>${t("site.bookTable")}</a></p>
          </div>`,
      page,
    );
  }
}

/** O slug de uma página de evento a partir do endereço: /es/eventos/noite-do-peixe/ → "noite-do-peixe". */
export const slugOfPath = (path = location.pathname) => path.match(/\/eventos\/([^/]+)\/?$/)?.[1] || null;

/**
 * Uma página de evento: a página do build recebe a data e o título ao vivo; a casca é preenchida pela
 * lista, ou mantém o texto do 404 quando o evento não existe ou foi despublicado.
 */
export function renderEventPage(events, { t, locale }) {
  const slug = slugOfPath();
  const shell = document.querySelector("[data-event-shell]");
  const event = slug ? events.find((e) => e.slug === slug) : null;
  if (!shell || !event) return;
  const title = inLang(event.title_i18n, locale) || event.title;
  document.title = `${title} · Território`;
  draw(
    html`<p class="evento-pagina__voltar"><a class="link" href=${pathIn(locale, "/eventos/")}>← ${t("site.eventBack")}</a></p>
      <span class="placa">${t("site.events")}</span>
      <article class=${`esq${event.image ? " esq--2" : ""} evento evento--pagina`} data-event=${event.slug}>
        ${photo(event, "(max-width: 860px) 100vw, 50vw")}
        <div class="painel evento__texto">
          <p class="rotulo evento__quando">${when(event, { t, locale })}</p>
          <h1 class="letreiro evento__titulo">${title}</h1>
          ${description(event, locale)}
          ${bookingBit(event, { t, locale })}
        </div>
      </article>`,
    shell,
  );
  shell.removeAttribute("data-event-shell");
  shell.dataset.eventPage = event.slug;
}
