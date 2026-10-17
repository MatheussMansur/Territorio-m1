// A página de reserva (/reservar/, também em /es/ e /en/): o cliente reserva sozinho, como no
// app final. A página impressa mostra os combinados da casa e o caminho pelo WhatsApp; o script
// (src/pages/reservar.js) troca o aviso pelo fluxo de reserva na API da casa.
import { fillTerms } from "../../lib/terms.js";
import { h, loc } from "../render.js";
import { siteFooter, siteHeader, whatsappLink } from "./chrome.js";

export function book({ house, content, locale, t }) {
  const route = "/reservar/";
  const body = h`
  ${siteHeader({ house, locale, t, route })}
  <main id="conteudo" class="wrap reserva-pagina">
    <span class="placa">${t("site.plateBook")}</span>
    <div class="sec-cabeca">
      <h1 class="letreiro">${t("site.bookHeadA")} <em>${t("site.bookHeadB")}</em></h1>
      <p class="prose">${t("book.lede")}</p>
    </div>
    <div class="esq reserva" data-reserva data-whatsapp="${whatsappLink(house, t("site.bookMessage"))}">
      <div class="painel reserva__fluxo" data-reserva-fluxo>
        <p class="prose">${t("book.noScript")}</p>
        <p><a class="btn" href="${whatsappLink(house, t("site.bookMessage"))}" rel="noopener">${t("site.whatsapp")}</a></p>
      </div>
      <aside class="painel reserva__lado" aria-labelledby="combinados-titulo">
        <div data-reserva-resumo></div>
        <h2 class="rotulo" id="combinados-titulo">${t("site.termsTitle")}</h2>
        <ol class="reserva__combinados">
          ${content.terms.map((term) => h`<li><b>${fillTerms(loc(term.title, locale), house.booking_rules)}</b> ${fillTerms(loc(term.text, locale), house.booking_rules)}</li>`)}
        </ol>
      </aside>
    </div>
  </main>
  ${siteFooter({ house, locale, t })}`;
  return { route, body, script: "/src/pages/reservar.js", bodyClass: "site site--reserva" };
}
