// Os grupos por seção, ao lado do grupo aberto no computador (no celular o grupo abre
// em tela cheia com um caminho de volta ao índice). As seções dos próximos módulos só aparecem,
// apagadas, na página do índice; o menu lateral deixa elas de fora.
import { html, nothing } from "../../../lib/html.js";
import { GROUPS, GROUP_KEYS, SECTIONS } from "./catalog.js";
import { canDo } from "../../nav.js";

/** Os grupos que esta sessão vê: os que a API listou, mais os aparelhos para o dono. */
export function visibleSlugs(index, user) {
  const listed = new Set((index?.groups || []).map((g) => g.group));
  return GROUP_KEYS.filter((slug) => {
    const group = GROUPS[slug];
    // os grupos do dono são de quem o arquivo de permissões deixa gravar as configurações (1.3)
    if (group.ownerOnly && !canDo(user.role, "PATCH /staff/settings/{group}", user.areas ?? undefined)) return false;
    // a tela de aparelhos não é um grupo de configurações: o arquivo de permissões diz quem lista aparelhos (1.3)
    return group.api === null ? canDo(user.role, "GET /staff/devices", user.areas ?? undefined) : listed.has(group.api);
  });
}

export const infoOf = (index, slug) => (index?.groups || []).find((g) => g.group === GROUPS[slug].api);

export function sideNav(index, active, user) {
  const slugs = visibleSlugs(index, user);
  return html`<nav class="cfg-indice" aria-label="Grupos de configuração">
    ${SECTIONS.map((section) => {
      const inSection = slugs.filter((slug) => GROUPS[slug].section === section.key);
      if (!inSection.length) return nothing;
      return html`<h3 class="cfg-indice__secao">${section.label}</h3>
        <ul class="cfg-indice__lista">
          ${inSection.map((slug) => {
            const pending = infoOf(index, slug)?.pending?.length;
            return html`<li>
              <a class="cfg-indice__item" href=${`/admin/configuracoes/${slug}`} aria-current=${slug === active ? "page" : nothing}>
                ${GROUPS[slug].label}${pending ? html`<span class="cfg-indice__pendente"><span class="losango" aria-hidden="true"></span>pendente</span>` : nothing}
              </a>
            </li>`;
          })}
        </ul>`;
    })}
  </nav>`;
}
