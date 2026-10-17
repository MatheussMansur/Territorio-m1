// O link do comprovante (/r/?t=…, também em /es/ e /en/): o que a mensagem do WhatsApp e a página
// de reserva abrem. O script lê o token e desenha o comprovante; nunca indexado.
import { h, raw } from "../render.js";
import { siteFooter, siteHeader, whatsappLink } from "./chrome.js";

export function receipt({ house, locale, t }) {
  const route = "/r/";
  const body = h`
  ${raw('<meta name="referrer" content="no-referrer">')}
  ${siteHeader({ house, locale, t, route })}
  <main id="conteudo" class="wrap reserva-pagina">
    <span class="placa">${t("site.plateBook")}</span>
    <h1 class="letreiro comprovante__titulo">${t("receipt.title")}</h1>
    <div class="esq comprovante" data-comprovante data-whatsapp="${whatsappLink(house, "")}">
      <div class="painel comprovante__corpo" data-comprovante-corpo>
        <p class="prose">${t("receipt.noScript")}</p>
      </div>
    </div>
  </main>
  ${siteFooter({ house, locale, t })}`;
  return { route, body, script: "/src/pages/comprovante.js", bodyClass: "site site--comprovante" };
}
