// A barra de ferro no topo e o rodapé que toda página pública divide, como no site aprovado:
// a placa pintada à esquerda, as seções, os idiomas, o tema e "Reservar".
import { hoursSummary } from "../hours.js";
import { HTML_LANG, h, pathIn, raw } from "../render.js";

const NAMES = { pt: "Português", es: "Español", en: "English" };

export function whatsappLink(house, message) {
  const number = house.whatsapp.replace(/\D/g, "");
  return message ? `https://wa.me/${number}?text=${encodeURIComponent(message)}` : `https://wa.me/${number}`;
}

function languages(locale, route) {
  return Object.keys(NAMES).map((l) =>
    l === locale
      ? h`<li><span class="langs__current" aria-current="true">${l.toUpperCase()}</span></li>`
      : h`<li><a href="${pathIn(l, route)}" hreflang="${HTML_LANG[l]}" lang="${HTML_LANG[l]}" title="${NAMES[l]}">${l.toUpperCase()}</a></li>`,
  );
}

/** overCover: a barra começa transparente sobre a foto da capa e vira ferro ao rolar. */
export function siteHeader({ house, locale, t, route, overCover = false }) {
  const home = pathIn(locale, "/");
  return h`<a class="skip-link" href="#conteudo">${t("site.skip")}</a>
  <header class="viga${overCover ? " viga--capa" : ""}" data-viga>
    <div class="wrap viga__in">
      <a class="viga__marca" href="${home}" aria-label="${house.name}"><span class="logo-letreiro logo-letreiro--viga" aria-hidden="true"></span></a>
      <nav class="viga__nav" aria-label="${house.name}">
        <a href="${pathIn(locale, "/cardapio/")}">${t("site.navMenu")}</a>
        <a href="${home}#casa">${t("site.navHouse")}</a>
        <a href="${pathIn(locale, "/eventos/")}"${route.startsWith("/eventos/") ? raw(' aria-current="page"') : ""}>${t("site.navEvents")}</a>
        <a href="${home}#onde">${t("site.navWhere")}</a>
      </nav>
      <div class="viga__tools">
        <ul class="langs" aria-label="${t("site.language")}">${languages(locale, route)}</ul>
        <button class="theme-toggle" type="button" data-theme-toggle hidden aria-label="${t("site.themeAuto")}" data-label-light="${t("site.themeLight")}" data-label-dark="${t("site.themeDark")}" data-label-auto="${t("site.themeAuto")}"><span aria-hidden="true"></span></button>
        <a class="btn viga__reservar" href="${pathIn(locale, "/reservar/")}"${route === "/reservar/" ? raw(' aria-current="page"') : raw(" data-book")}>${t("site.book")}</a>
      </div>
    </div>
  </header>`;
}

/** O horário da semana numa linha, com os dois turnos quando houver (história 2.8). */
export function openDays({ house, t }) {
  return hoursSummary(house.hours, t);
}

export function siteFooter({ house, locale, t }) {
  const a = house.address;
  return h`<footer class="rodape">
    <div class="wrap rodape__grade">
      <div>
        <h2 class="rodape__titulo">${t("site.footerHouse")}</h2>
        <p>${a.street}, ${a.number}<br>${a.district} · ${a.city} – ${a.state}</p>
        <p>${openDays({ house, t, locale })}</p>
      </div>
      <div>
        <h2 class="rodape__titulo">${t("site.footerContact")}</h2>
        <ul class="rodape__lista">
          <li><a href="${whatsappLink(house, "")}" rel="noopener">WhatsApp</a></li>
          <li><a href="https://www.instagram.com/${house.links.instagram}/" rel="noopener">@${house.links.instagram}</a></li>
          <li><a href="https://www.instagram.com/${house.links.shop}/" rel="noopener">${t("site.shop")} · @${house.links.shop}</a></li>
        </ul>
      </div>
      <div>
        <h2 class="rodape__titulo">${t("site.footerSite")}</h2>
        <ul class="rodape__lista">
          <li><a href="${pathIn(locale, "/privacidade/")}">${t("site.privacy")}</a></li>
          <li><button class="rodape__cookies" type="button" data-cookies-open hidden>${t("site.cookies")}</button></li>
          <li><a href="/admin/">${t("site.staffArea")}</a></li>
        </ul>
      </div>
      <span class="logo-letreiro logo-letreiro--rodape" role="img" aria-label="${house.name}"></span>
    </div>
    <div class="wrap"><p class="rodape__creditos">${t("site.photos", { credits: house.photo_credits.join(", ") })}</p></div>
  </footer>`;
}
