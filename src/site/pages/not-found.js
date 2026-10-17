// O 404 da casa (história 4.7), no idioma do endereço: /404.html, /es/404.html e
// /en/404.html. Os servidores de desenvolvimento e de prévia respondem qualquer endereço desconhecido com ele e um status
// 404 de verdade (vite.config.js); em produção o nginx faz o mesmo (10.3). Nunca indexado.
import { h, pathIn } from "../render.js";
import { siteFooter, siteHeader } from "./chrome.js";

export function notFoundBody({ t, locale }) {
  return h`<section class="painel nao-achou" aria-labelledby="nao-achou-titulo">
    <span class="raiz-marca nao-achou__raiz" aria-hidden="true"></span>
    <h1 class="letreiro nao-achou__titulo" id="nao-achou-titulo">${t("site.notFound.title")}</h1>
    <p class="prose">${t("site.notFound.text")}</p>
    <p class="nao-achou__acoes">
      <a class="btn" href="${pathIn(locale, "/")}">${t("site.notFound.home")}</a>
      <a class="btn btn--outline" href="${pathIn(locale, "/reservar/")}" data-book>${t("site.bookTable")}</a>
    </p>
  </section>`;
}

export function notFound({ house, locale, t }) {
  const route = "/404/";
  const body = h`
  ${siteHeader({ house, locale, t, route })}
  <main id="conteudo" class="wrap nao-achou-pagina">
    ${notFoundBody({ t, locale })}
  </main>
  ${siteFooter({ house, locale, t })}`;
  return { route, body, script: "/src/pages/site.js", bodyClass: "site site--404", title: `${t("site.notFound.title")} · ${house.name}` };
}
