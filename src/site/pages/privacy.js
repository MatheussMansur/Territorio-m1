// A política de privacidade (/privacidade/, também em /es/ e /en/), a partir de src/content/privacy.json.
// Ela fica fora do Google até chegarem a revisão jurídica e os dados da empresa (seo.json).
import { COOKIES } from "../../lib/cookie-registry.js";
import { h, loc } from "../render.js";
import { siteFooter, siteHeader, whatsappLink } from "./chrome.js";

const DATE = { pt: "pt-BR", es: "es", en: "en" };

/** Todo cookie e valor guardado, direto do registro que o código obedece. */
function cookieTable({ t, locale }) {
  return h`<div class="legal__tabela" role="region" aria-labelledby="cookies-tabela" tabindex="0">
    <table>
      <caption id="cookies-tabela">${t("site.cookiesTable")}</caption>
      <thead><tr><th scope="col">${t("site.cookiesTableName")}</th><th scope="col">${t("site.cookiesTableCategory")}</th><th scope="col">${t("site.cookiesTableWhere")}</th><th scope="col">${t("site.cookiesTablePurpose")}</th></tr></thead>
      <tbody>${COOKIES.map(
        (c) => h`<tr><th scope="row"><code>${c.name}</code></th><td>${t(`site.cookiesCategory.${c.category}`)}</td><td>${t(c.kind === "cookie" ? "site.cookiesWhereCookie" : "site.cookiesWhereStorage")}</td><td>${c.purpose[locale] || c.purpose.pt}</td></tr>`,
      )}</tbody>
    </table>
  </div>
  <p class="prose">${t("site.cookiesNone")}</p>`;
}

function formatDate(iso, locale) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(DATE[locale], { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export function privacy({ house, privacy: policy, locale, t }) {
  const route = "/privacidade/";
  const legal = house.legal || {};
  const body = h`
  ${siteHeader({ house, locale, t, route })}
  <main id="conteudo" class="wrap legal">
    <h1 class="letreiro legal__title">${t("site.privacyTitle")}</h1>
    <p class="prose legal__lede">${t("site.privacyLede")}</p>
    <p class="legal__updated">${t("site.privacyUpdated", { date: formatDate(policy.version, locale) })}</p>
    <nav class="legal__toc" aria-label="${t("site.privacyTitle")}">
      <ol>${policy.sections.map((s) => h`<li><a href="#${s.id}">${loc(s.title, locale)}</a></li>`)}</ol>
    </nav>
    ${policy.sections.map(
      (s) => h`<section class="legal__section" id="${s.id}" aria-labelledby="${s.id}-titulo">
        <h2 class="legal__heading" id="${s.id}-titulo">${loc(s.title, locale)}</h2>
        ${(s.body[locale] || s.body.pt).map((p) => h`<p class="prose">${p}</p>`)}
        ${s.id === "cookies" ? cookieTable({ t, locale }) : ""}
      </section>`,
    )}
    <section class="legal__section legal__company" id="empresa" aria-labelledby="empresa-titulo">
      <h2 class="legal__heading" id="empresa-titulo">${t("site.privacyCompany")}</h2>
      <p class="prose">${legal.name || house.name}${legal.cnpj ? h` · ${t("site.privacyCnpj")} ${legal.cnpj}` : ""}<br>
        ${house.address.street}, ${house.address.number} · ${house.address.district} · ${house.address.city} – ${house.address.state}</p>
      <p class="prose"><b>${t("site.privacyContact")}:</b>
        ${legal.privacy_contact
          ? h`<a href="mailto:${legal.privacy_contact}">${legal.privacy_contact}</a>`
          : h`<a href="${whatsappLink(house, "")}" rel="noopener">${t("site.privacyContactWhatsapp")}</a>`}</p>
    </section>
  </main>
  ${siteFooter({ house, locale, t })}`;
  return { route, body, script: "/src/pages/site.js", bodyClass: "site site--legal" };
}
