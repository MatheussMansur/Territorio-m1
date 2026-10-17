// O que os buscadores leem, gerado do mesmo conteúdo que o site mostra (AD-36):
// tags do head por página com JSON-LD, e também robots.txt, sitemap.xml e llms.txt.
// Funções puras: o plugin do Vite passa src/content para elas e grava o resultado.
//
// Nada sem confirmação é publicado: o horário só sai com hours_confirmed, o pino do mapa
// só com lat/lng preenchidos. Sem endereço do site (homolog, demo, dev) quer dizer "fique de fora".

import { shiftsOf } from "../../src/site/hours.js";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const HREFLANG = { pt: "pt-BR", es: "es", en: "en" };

export function routeFor(locale, route, defaultLocale) {
  return locale === defaultLocale ? route : `/${locale}${route}`;
}

export function absolute(site, path) {
  return new URL(path, site).href;
}

function escapeAttr(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeXml(value) {
  return escapeAttr(value).replace(/'/g, "&apos;");
}

function text(field, locale, fallback) {
  if (!field) return "";
  return field[locale] || field[fallback] || "";
}

/** A entrada da página para uma rota, ou null quando a rota não tem entrada (fica fora da busca). */
export function pageFor(seo, route) {
  return seo.pages.find((p) => p.route === route) ?? null;
}

/**
 * A entrada de busca de uma página de evento (/eventos/{slug}/), de src/content/events.json: o
 * título e a descrição dela, e o evento para o JSON-LD. Null para qualquer outra coisa.
 */
export function eventPage(events, route) {
  const slug = route.match(/^\/eventos\/([^/]+)\/$/)?.[1];
  const event = slug && (events?.events || []).find((e) => e.slug === slug);
  if (!event) return null;
  const withHouse = (field) => Object.fromEntries(Object.entries(field || {}).map(([l, v]) => [l, `${v} · Território`]));
  // uma festa fechada tem página (a data está ocupada), mas fica fora da busca
  return { route, index: event.booking_mode !== "private", localized: true, kind: "event", title: withHouse(event.title), description: event.description, event };
}

/** schema.org Event para uma página de evento: data e hora no fuso da casa, no restaurante. */
export function eventNode({ event, locale, seo, site, restaurantId, pageUrl }) {
  const name = (field) => text(field, locale, seo.default_locale);
  const start = `${event.date}T${event.starts_at}:00-03:00`;
  let end;
  if (event.ends_at) {
    // uma noite que acaba depois da meia-noite acaba no dia seguinte do calendário
    const [y, m, d] = event.date.split("-").map(Number);
    const next = event.ends_at <= event.starts_at ? new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10) : event.date;
    end = `${next}T${event.ends_at}:00-03:00`;
  }
  return {
    "@type": "Event",
    "@id": `${pageUrl}#evento`,
    name: name(event.title),
    description: name(event.description) || undefined,
    startDate: start,
    endDate: end,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    inLanguage: HREFLANG[locale],
    image: event.photo ? absolute(site, `/img/fotos/${event.photo}-900.jpg`) : undefined,
    location: { "@id": restaurantId },
    organizer: { "@id": restaurantId },
    url: pageUrl,
  };
}

export function isIndexable(seo, page, site) {
  if (!site || !page || !page.index) return false;
  const path = page.route;
  return ![...seo.private_prefixes, ...seo.noindex_prefixes].some((prefix) => path.startsWith(prefix));
}

function openingHours(house) {
  if (!house.hours_confirmed) return undefined;
  // um item por turno: com dois turnos no dia, o dia aparece duas vezes (história 2.8)
  return house.hours.flatMap((h) =>
    shiftsOf(h).map((s) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: `https://schema.org/${DAYS[h.weekday]}`,
      opens: s.opens_at,
      closes: s.closes_at,
    })),
  );
}

function postalAddress(address) {
  const out = {
    "@type": "PostalAddress",
    streetAddress: `${address.street}, ${address.number}`,
    addressLocality: address.city,
    addressRegion: address.state,
    addressCountry: address.country || "BR",
  };
  if (address.zip) out.postalCode = address.zip;
  return out;
}

/** Grafo JSON-LD: o site, o restaurante e esta página (schema.org, campos de LocalBusiness do Google). */
/** schema.org Menu com as seções e os itens com preço, para a página do cardápio. */
function menuNode({ menu, locale, seo, site }) {
  const name = (field) => (typeof field === "string" ? field : field?.[locale] || field?.[seo.default_locale] || "");
  return {
    "@type": "Menu",
    "@id": absolute(site, `${routeFor(locale, "/cardapio/", seo.default_locale)}#cardapio`),
    inLanguage: HREFLANG[locale],
    hasMenuSection: menu.categories
      .filter((c) => c.items.length)
      .map((c) => ({
        "@type": "MenuSection",
        name: name(c.name),
        description: name(c.subtitle) || undefined,
        hasMenuItem: c.items.map((item) => ({
          "@type": "MenuItem",
          name: item.name,
          description: name(item.description) || undefined,
          suitableForDiet: item.badges?.includes("vegetarian") ? "https://schema.org/VegetarianDiet" : undefined,
          offers:
            item.price_cents == null
              ? undefined
              : { "@type": "Offer", price: (item.price_cents / 100).toFixed(2), priceCurrency: menu.currency || "BRL" },
        })),
      })),
  };
}

export function jsonLd({ house, seo, page, locale, site, menu }) {
  const pageUrl = absolute(site, routeFor(locale, page.route, seo.default_locale));
  const restaurant = {
    "@type": "Restaurant",
    "@id": absolute(site, "/#restaurante"),
    name: house.name,
    description: text(house.description, locale, seo.default_locale) || undefined,
    url: absolute(site, routeFor(locale, "/", seo.default_locale)),
    image: house.images?.share ? absolute(site, house.images.share) : undefined,
    logo: house.images?.logo ? absolute(site, house.images.logo) : undefined,
    address: postalAddress(house.address),
    telephone: house.whatsapp || undefined,
    servesCuisine: Array.isArray(house.cuisine) ? house.cuisine : house.cuisine?.[locale] || house.cuisine?.[seo.default_locale],
    priceRange: house.price_range || undefined,
    acceptsReservations: absolute(site, routeFor(locale, "/reservar/", seo.default_locale)),
    menu: absolute(site, routeFor(locale, "/cardapio/", seo.default_locale)),
    openingHoursSpecification: openingHours(house),
    sameAs: house.instagram ? [`https://www.instagram.com/${house.instagram}/`] : undefined,
  };
  if (typeof house.address.lat === "number" && typeof house.address.lng === "number") {
    restaurant.geo = { "@type": "GeoCoordinates", latitude: house.address.lat, longitude: house.address.lng };
  }
  const graph = [
    {
      "@type": "WebSite",
      "@id": absolute(site, "/#site"),
      url: absolute(site, "/"),
      name: house.name,
      inLanguage: seo.locales.map((l) => HREFLANG[l]),
      publisher: { "@id": restaurant["@id"] },
    },
    restaurant,
    {
      "@type": "WebPage",
      "@id": `${pageUrl}#pagina`,
      url: pageUrl,
      name: text(page.title, locale, seo.default_locale),
      description: text(page.description, locale, seo.default_locale),
      inLanguage: HREFLANG[locale],
      isPartOf: { "@id": absolute(site, "/#site") },
      about: { "@id": restaurant["@id"] },
    },
  ];
  if (page.kind === "event" && page.event) {
    graph.push(eventNode({ event: page.event, locale, seo, site, restaurantId: restaurant["@id"], pageUrl }));
  }
  if (page.kind === "menu" && menu) {
    const node = menuNode({ menu, locale, seo, site });
    restaurant.hasMenu = { "@id": node["@id"] };
    graph.push(node);
  }
  // JSON.stringify descarta os campos undefined, então dado sem confirmação nunca aparece
  return { "@context": "https://schema.org", "@graph": graph };
}

/** O que entra no <head> de uma página em um idioma. */
export function headTags({ house, seo, page, locale, site, menu }) {
  const indexable = isIndexable(seo, page, site);
  const lines = [];
  if (!indexable) {
    lines.push('<meta name="robots" content="noindex, nofollow">');
    return lines.join("\n");
  }
  const title = text(page.title, locale, seo.default_locale);
  const description = text(page.description, locale, seo.default_locale);
  const url = absolute(site, routeFor(locale, page.route, seo.default_locale));
  lines.push(`<meta name="description" content="${escapeAttr(description)}">`);
  lines.push(`<link rel="canonical" href="${escapeAttr(url)}">`);
  if (page.localized) {
    for (const l of seo.locales) {
      lines.push(`<link rel="alternate" hreflang="${HREFLANG[l]}" href="${escapeAttr(absolute(site, routeFor(l, page.route, seo.default_locale)))}">`);
    }
    lines.push(`<link rel="alternate" hreflang="x-default" href="${escapeAttr(absolute(site, page.route))}">`);
  }
  lines.push(`<meta property="og:type" content="website">`);
  lines.push(`<meta property="og:site_name" content="${escapeAttr(house.name)}">`);
  lines.push(`<meta property="og:title" content="${escapeAttr(title)}">`);
  lines.push(`<meta property="og:description" content="${escapeAttr(description)}">`);
  lines.push(`<meta property="og:url" content="${escapeAttr(url)}">`);
  lines.push(`<meta property="og:locale" content="${HREFLANG[locale].replace("-", "_")}">`);
  if (page.kind === "event" && page.event?.photo) {
    lines.push(`<meta property="og:image" content="${escapeAttr(absolute(site, `/img/fotos/${page.event.photo}-900.jpg`))}">`);
  } else if (house.images?.share) {
    lines.push(`<meta property="og:image" content="${escapeAttr(absolute(site, house.images.share))}">`);
    lines.push(`<meta property="og:image:width" content="1200">`);
    lines.push(`<meta property="og:image:height" content="630">`);
  }
  lines.push(`<meta name="twitter:card" content="summary_large_image">`);
  // um "<" dentro do JSON-LD fecharia o elemento script antes da hora
  const ld = JSON.stringify(jsonLd({ house, seo, page, locale, site, menu })).replace(/</g, "\\u003c");
  lines.push(`<script type="application/ld+json">${ld}</script>`);
  return lines.join("\n");
}

/** robots.txt: todos os robôs (de busca e de respostas) leem as páginas públicas; as áreas privadas e a API ficam de fora. */
export function robotsTxt({ seo, site }) {
  if (!site) return "# Ambiente fora do ar para buscadores (sem SITE_URL).\nUser-agent: *\nDisallow: /\n";
  const lines = ["User-agent: *", "Allow: /"];
  for (const prefix of seo.private_prefixes) lines.push(`Disallow: ${prefix}`);
  // as páginas com token não são bloqueadas aqui: elas levam noindex, e uma página bloqueada não poderia mostrá-lo
  lines.push("", `Sitemap: ${absolute(site, "/sitemap.xml")}`, "");
  return lines.join("\n");
}

/** sitemap.xml com as versões em outros idiomas de toda página indexável. */
export function sitemapXml({ seo, site }) {
  const urls = [];
  for (const page of seo.pages.filter((p) => isIndexable(seo, p, site))) {
    const locales = page.localized ? seo.locales : [seo.default_locale];
    for (const locale of locales) {
      const loc = absolute(site, routeFor(locale, page.route, seo.default_locale));
      const alternates = page.localized
        ? seo.locales
            .map((l) => `    <xhtml:link rel="alternate" hreflang="${HREFLANG[l]}" href="${escapeXml(absolute(site, routeFor(l, page.route, seo.default_locale)))}"/>`)
            .join("\n")
        : "";
      urls.push(`  <url>\n    <loc>${escapeXml(loc)}</loc>${alternates ? `\n${alternates}` : ""}\n  </url>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join("\n")}\n</urlset>\n`;
}

/** llms.txt: um resumo curto e simples da casa para os buscadores que respondem perguntas (formato llmstxt.org). */
export function llmsTxt({ house, seo, site }) {
  if (!site) return "";
  const pt = seo.default_locale;
  const a = house.address;
  const lines = [`# ${house.name}`, "", `> ${text(house.description, pt, pt)}`, ""];
  const street = [`${a.street}, ${a.number}`, a.district, `${a.city}-${a.state}`].filter(Boolean).join(", ");
  lines.push(`- Endereço: ${street}`);
  const cuisine = Array.isArray(house.cuisine) ? house.cuisine : house.cuisine?.[pt];
  if (cuisine?.length) lines.push(`- Cozinha: ${cuisine.join(", ")}`);
  if (house.hours_confirmed) {
    const names = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
    const open = house.hours
      .filter((h) => shiftsOf(h).length)
      .map((h) => `${names[h.weekday]} ${shiftsOf(h).map((s) => `${s.opens_at}–${s.closes_at}`).join(" e ")}`);
    lines.push(`- Horário: ${open.join("; ")}`);
  }
  lines.push(`- Reservas: ${absolute(site, "/reservar/")}`);
  lines.push(`- Línguas do site: português, español, English`);
  const pages = seo.pages.filter((p) => isIndexable(seo, p, site));
  if (pages.length) {
    lines.push("", "## Páginas", "");
    for (const p of pages) lines.push(`- [${text(p.title, pt, pt)}](${absolute(site, p.route)}): ${text(p.description, pt, pt)}`);
  }
  return `${lines.join("\n")}\n`;
}
