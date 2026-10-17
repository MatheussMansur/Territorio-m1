// Tags de busca: nada sem confirmação fica público, as páginas privadas ficam de fora, e cada
// versão de idioma aponta para as outras.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { headTags, jsonLd, llmsTxt, robotsTxt, sitemapXml } from "../../scripts/seo/seo.js";

const house = JSON.parse(readFileSync(new URL("../../src/content/house.json", import.meta.url), "utf8"));
const SITE = "https://exemplo.com.br";

const seo = {
  locales: ["pt", "es", "en"],
  default_locale: "pt",
  pages: [
    { route: "/", index: true, localized: true, title: { pt: "Território", es: "Território · ES" }, description: { pt: "Casa" } },
    { route: "/cardapio/", index: true, localized: true, title: { pt: "Cardápio" }, description: { pt: "Rangos" } },
    { route: "/r/", index: true, localized: false, title: { pt: "Comprovante" }, description: { pt: "x" } },
    { route: "/admin/", index: true, localized: false, title: { pt: "Painel" }, description: { pt: "x" } },
  ],
  private_prefixes: ["/admin/", "/api/", "/_ds/"],
  noindex_prefixes: ["/r/", "/confirmar/"],
};

test("sem SITE_URL, o robots fecha tudo e a página leva noindex", () => {
  assert.match(robotsTxt({ seo }), /Disallow: \/\n/);
  assert.equal(headTags({ house, seo, page: seo.pages[0], locale: "pt" }), '<meta name="robots" content="noindex, nofollow">');
  assert.equal(llmsTxt({ house, seo }), "");
});

test("robots: abre o site, fecha painel e API, aponta o sitemap", () => {
  const robots = robotsTxt({ seo, site: SITE });
  assert.match(robots, /User-agent: \*\nAllow: \//);
  assert.match(robots, /Disallow: \/admin\//);
  assert.match(robots, /Disallow: \/api\//);
  assert.doesNotMatch(robots, /Disallow: \/r\//, "páginas de link carregam noindex e não podem ser bloqueadas");
  assert.match(robots, /Sitemap: https:\/\/exemplo\.com\.br\/sitemap\.xml/);
});

test("página de link e painel nunca são indexáveis, mesmo marcadas", () => {
  assert.match(headTags({ house, seo, page: seo.pages[2], locale: "pt", site: SITE }), /noindex/);
  assert.match(headTags({ house, seo, page: seo.pages[3], locale: "pt", site: SITE }), /noindex/);
});

test("sitemap: só páginas públicas, com as três línguas ligadas entre si", () => {
  const xml = sitemapXml({ seo, site: SITE });
  assert.match(xml, /<loc>https:\/\/exemplo\.com\.br\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/exemplo\.com\.br\/es\/cardapio\/<\/loc>/);
  assert.match(xml, /hreflang="en" href="https:\/\/exemplo\.com\.br\/en\/cardapio\/"/);
  assert.doesNotMatch(xml, /\/r\/|\/admin\//);
});

test("cabeça da página: canônico, alternativas de língua, Open Graph e JSON-LD", () => {
  const head = headTags({ house, seo, page: seo.pages[0], locale: "es", site: SITE });
  assert.match(head, /<link rel="canonical" href="https:\/\/exemplo\.com\.br\/es\/">/);
  assert.match(head, /hreflang="pt-BR" href="https:\/\/exemplo\.com\.br\/"/);
  assert.match(head, /hreflang="x-default"/);
  assert.match(head, /og:locale" content="es"/);
  assert.match(head, /<script type="application\/ld\+json">/);
  assert.match(head, /Território · ES/);
});

test("JSON-LD do restaurante: obrigatórios do Google e nada sem confirmação", () => {
  const pending = { ...house, hours_confirmed: false, price_range: null };
  const graph = JSON.parse(JSON.stringify(jsonLd({ house: pending, seo, page: seo.pages[0], locale: "pt", site: SITE })))["@graph"];
  const r = graph.find((n) => n["@type"] === "Restaurant");
  assert.equal(r.name, "Território");
  assert.equal(r.address.addressLocality, "Foz do Iguaçu");
  assert.equal(r.acceptsReservations, "https://exemplo.com.br/reservar/");
  assert.equal(r.menu, "https://exemplo.com.br/cardapio/");
  assert.equal(r.openingHoursSpecification, undefined, "horário a confirmar não vai ao ar");
  assert.equal(r.priceRange, undefined, "faixa de preço só com a casa confirmando");
  assert.deepEqual(r.servesCuisine, ["Japonesa", "Izakaya"]);
  const noPin = { ...house, address: { ...house.address, lat: null, lng: null } };
  assert.equal(jsonLd({ house: noPin, seo, page: seo.pages[0], locale: "pt", site: SITE })["@graph"][1].geo, undefined, "sem coordenada, sem pino");
  const en = jsonLd({ house, seo, page: seo.pages[0], locale: "en", site: SITE })["@graph"][1];
  assert.deepEqual(en.servesCuisine, ["Japanese", "Izakaya"]);
  assert.equal(en.acceptsReservations, "https://exemplo.com.br/en/reservar/");
  const confirmed = { ...house, hours_confirmed: true, address: { ...house.address, lat: -25.49412, lng: -54.55531 } };
  const r2 = jsonLd({ house: confirmed, seo, page: seo.pages[0], locale: "pt", site: SITE })["@graph"][1];
  assert.equal(r2.openingHoursSpecification.length, 4);
  assert.equal(r2.openingHoursSpecification[0].dayOfWeek, "https://schema.org/Wednesday");
  assert.equal(r2.geo.latitude, -25.49412);
});

test("JSON-LD não deixa o texto fechar o <script>", () => {
  const evil = { ...seo.pages[0], title: { pt: "</script><script>alert(1)</script>" } };
  const head = headTags({ house, seo, page: evil, locale: "pt", site: SITE });
  assert.doesNotMatch(head.split('<script type="application/ld+json">')[1], /<\/script><script>/);
});

test("llms.txt: resumo com endereço e reserva, sem horário a confirmar", () => {
  const txt = llmsTxt({ house: { ...house, hours_confirmed: false }, seo, site: SITE });
  assert.match(txt, /^# Território/);
  assert.match(txt, /Rua Sérgio Roncato, 703/);
  assert.match(txt, /Reservas: https:\/\/exemplo\.com\.br\/reservar\//);
  assert.doesNotMatch(txt, /Horário:/);
});

test("dados da casa confirmados: horário, CEP e preço saem iguais em todo lugar", () => {
  const r = jsonLd({ house, seo, page: seo.pages[0], locale: "pt", site: SITE })["@graph"][1];
  assert.equal(r.address.postalCode, "85869-090");
  assert.equal(r.priceRange, "R$ 40–120");
  assert.deepEqual(r.openingHoursSpecification.map((h) => h.closes), ["23:30", "23:30", "23:30", "23:30"]);
  assert.match(llmsTxt({ house, seo, site: SITE }), /Horário: quarta 19:00–23:30; quinta 19:00–23:30; sexta 19:00–23:30; sábado 19:00–23:30/);
  assert.match(llmsTxt({ house, seo, site: SITE }), /Ipê, Foz do Iguaçu-PR/);
});

test("domínio de produção: só o build de produção tem SITE_URL, os outros ficam com noindex", () => {
  const env = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
  assert.ok(env(".env.production").split(/\r?\n/).includes("SITE_URL=https://territoriofoz.com.br"));
  for (const file of [".env", ".env.development", ".env.demo", ".env.site"]) assert.doesNotMatch(env(file), /SITE_URL/, file);
  const site = "https://territoriofoz.com.br";
  assert.ok(robotsTxt({ seo, site }).includes("Sitemap: https://territoriofoz.com.br/sitemap.xml"));
  assert.ok(headTags({ house, seo, page: seo.pages[0], locale: "es", site }).includes('<link rel="canonical" href="https://territoriofoz.com.br/es/">'));
});
