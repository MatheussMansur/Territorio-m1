// A moldura impressa das páginas do próprio cliente (entrar, minhas-reservas, confirmar, espera):
// o cabeçalho e o rodapé do site, um título e o lugar que o script preenche. Sem JavaScript a
// página avisa e oferece o WhatsApp da casa. As páginas de link pedem ao navegador para não mandar referrer.
import { h, raw } from "../render.js";
import { siteFooter, siteHeader, whatsappLink } from "./chrome.js";

export function clientePagina({ house, locale, t, route, title, script, slug, link = false }) {
  const body = h`
  ${link ? raw('<meta name="referrer" content="no-referrer">') : ""}
  ${siteHeader({ house, locale, t, route })}
  <main id="conteudo" class="wrap reserva-pagina">
    <span class="placa">${t("site.plateBook")}</span>
    <h1 class="letreiro comprovante__titulo">${title}</h1>
    <div class="esq conta" data-cliente="${slug}" data-whatsapp="${whatsappLink(house, "")}" data-instagram="${house.links.instagram}">
      <div class="painel conta__corpo" data-cliente-corpo>
        <p class="prose">${t("cliente.noScript")}</p>
        <p><a class="btn" href="${whatsappLink(house, "")}" rel="noopener">${t("site.whatsapp")}</a></p>
      </div>
    </div>
  </main>
  ${siteFooter({ house, locale, t })}`;
  return { route, body, script, bodyClass: `site site--cliente site--${slug}` };
}
