// O índice de Configurações: busca pelo nome e pelas palavras da casa, o passo a passo do primeiro uso
// para o dono, as pendências no topo, todos os grupos por seção com quem mudou por último,
// e as seções apagadas dos próximos módulos.
import { toast } from "../../../components/toast.js";
import { staffErrorMessage } from "../../../lib/errors.js";
import { html, nothing, render } from "../../../lib/html.js";
import * as api from "../../../services/api/staff-configuracoes.js";
import { GROUPS, LOCKED_SECTIONS, SECTIONS, anchorOf, search } from "./catalog.js";
import { when } from "./group.js";
import { infoOf, visibleSlugs } from "./side-nav.js";
import { canDo } from "../../nav.js";

// cada chave do progresso leva à sua etapa no passo a passo do primeiro uso (história 3.12)
const STEPS = {
  house: ["Casa", "/admin/primeiro-acesso/casa"],
  hours: ["Horários", "/admin/primeiro-acesso/horarios"],
  layouts: ["Plantas", "/admin/primeiro-acesso/plantas"],
  booking: ["Reservas", "/admin/primeiro-acesso/horarios/reservas"],
  terms: ["Combinados", "/admin/primeiro-acesso/combinados"],
  team: ["Equipe", "/admin/primeiro-acesso/equipe"],
  devices: ["Aparelhos", "/admin/primeiro-acesso/equipe/aparelhos"],
  messages: ["Mensagens", "/admin/primeiro-acesso/equipe/mensagens"],
};

/**
 * @param {HTMLElement} container
 * @param {{index: any, user: any, navigate: (path: string, highlight?: string) => void, scenario?: string}} options
 */
export function mountHome(container, { index, user, navigate }) {
  // do arquivo de permissões (história 1.3): mudar um grupo e o passo a passo do primeiro uso
  const isOwner = canDo(user.role, "PATCH /staff/settings/{group}", user.areas ?? undefined);
  const runsOnboarding = canDo(user.role, "PUT /staff/onboarding", user.areas ?? undefined);
  const slugs = visibleSlugs(index, user);
  let query = "";
  let onboarding = null;
  let alive = true;

  const pendingAll = slugs.flatMap((slug) => (infoOf(index, slug)?.pending || []).map((text) => ({ slug, text })));

  function results() {
    if (query.trim().length < 2) return nothing;
    const hits = search(query, slugs);
    if (!hits.length) {
      return html`<div class="cfg-busca__vazio" role="status">
        <p><b>Nada com esse nome.</b> Os grupos estão logo abaixo.</p>
      </div>`;
    }
    return html`<ul class="cfg-busca__lista" aria-label="Resultados">
      ${hits.map(
        (hit) => html`<li>
          <a
            class="cfg-busca__item"
            href=${`/admin/configuracoes/${hit.slug}`}
            @click=${(e) => {
              e.preventDefault();
              navigate(`/admin/configuracoes/${hit.slug}`, hit.row ? anchorOf(hit.row) : undefined);
            }}
          >
            <b>${hit.row?.label ?? hit.group.label}</b>
            <span>${hit.row ? hit.group.label : SECTIONS.find((s) => s.key === hit.group.section)?.label}</span>
          </a>
        </li>`,
      )}
    </ul>`;
  }

  async function updateOnboarding(body) {
    try {
      onboarding = await api.onboarding.update(body, { version: onboarding?.version });
      draw();
      if (body.dismissed) toast({ title: "Primeiro acesso fechado. As configurações continuam aqui." });
    } catch (error) {
      toast({ kind: "error", title: "Não deu para salvar agora", message: staffErrorMessage(error) });
    }
  }

  function onboardingCard() {
    if (!runsOnboarding || !onboarding || onboarding.dismissed || onboarding.done) return nothing;
    const ready = onboarding.steps.filter((st) => st.done || st.skipped).length;
    const next = onboarding.steps.find((st) => !st.done && !st.skipped);
    return html`<section class="cfg-primeiro" aria-labelledby="cfg-primeiro-titulo">
      <div class="cfg-primeiro__topo">
        <h3 id="cfg-primeiro-titulo">Primeiro acesso · ${ready} de ${onboarding.steps.length} prontos</h3>
        <span class="cfg-primeiro__botoes">
          <a class="btn btn--sm" href="/admin/primeiro-acesso">Abrir o primeiro acesso</a>
          <button type="button" class="link-button" @click=${() => updateOnboarding({ dismissed: true })}>Fechar o assistente</button>
        </span>
      </div>
      ${next ? html`<p>Próximo passo: <a href=${STEPS[next.key][1]}>${STEPS[next.key][0]}</a>${next.missing?.length ? `: ${next.missing.join(", ")}` : ""}.</p>` : nothing}
      <ol class="cfg-primeiro__passos">
        ${onboarding.steps.map((st) => {
          const [label, href] = STEPS[st.key];
          const status = st.done ? "pronto" : st.skipped ? "pulado" : "falta";
          return html`<li class=${`is-${status}`}>
            <a href=${href}>${label}</a>
            <span class="cfg-primeiro__estado">${status === "falta" ? st.missing?.join(", ") || "falta" : status}</span>
            ${status === "falta"
              ? html`<button type="button" class="link-button" aria-label=${`Pular ${label}`} @click=${() => updateOnboarding({ skipped: [...onboarding.steps.filter((x) => x.skipped).map((x) => x.key), st.key] })}>
                  Pular
                </button>`
              : nothing}
          </li>`;
        })}
      </ol>
    </section>`;
  }

  function groupCard(slug) {
    const group = GROUPS[slug];
    const info = infoOf(index, slug);
    const pending = info?.pending || [];
    const last = info?.updated_by ? `${info.updated_by}, ${when(info.updated_at)}` : group.api ? "Ainda no padrão da casa" : "";
    return html`<li class="cfg-cartao">
      <a class="cfg-cartao__link" href=${`/admin/configuracoes/${slug}`}>
        <span class="cfg-cartao__nome">${group.label}</span>
        ${info?.summary ? html`<span class="cfg-cartao__valor">${info.summary}</span>` : nothing}
        <span class="cfg-cartao__ultima">${last}${info && !info.editable ? html` · só para ver` : nothing}</span>
        ${pending.map((p) => html`<span class="cfg-cartao__pendente"><span class="losango" aria-hidden="true"></span>${p}</span>`)}
      </a>
    </li>`;
  }

  function draw() {
    if (!alive) return;
    render(
      html`<div class="cfg cfg--indice">
        ${isOwner ? nothing : html`<p class="cfg-aviso" role="note">Só o dono muda as regras. Fale com o ${index?.owner_name || "dono"}.</p>`}
        <div class="cfg-busca" role="search">
          <label class="field__label" for="cfg-busca">Buscar configuração</label>
          <input
            id="cfg-busca"
            class="field__input"
            type="search"
            autocomplete="off"
            placeholder="“atraso”, “lembrete”, “PIN”…"
            .value=${query}
            @input=${(e) => {
              query = e.target.value;
              draw();
            }}
          />
          ${results()}
        </div>
        ${onboardingCard()}
        ${pendingAll.length
          ? html`<section class="cfg-pendencias-todas" aria-labelledby="cfg-pend-titulo">
              <h3 id="cfg-pend-titulo">Pendências</h3>
              <ul>
                ${pendingAll.map((p) => html`<li><span class="losango" aria-hidden="true"></span><a href=${`/admin/configuracoes/${p.slug}`}>${GROUPS[p.slug].label}</a>: ${p.text}</li>`)}
              </ul>
            </section>`
          : html`<p class="cfg-tudo-certo">Nada pendente. Tudo traduzido e conferido.</p>`}
        ${SECTIONS.map((section) => {
          const inSection = slugs.filter((slug) => GROUPS[slug].section === section.key);
          if (!inSection.length) return nothing;
          return html`<section class="cfg-secao" aria-labelledby=${`cfg-secao-${section.key}`}>
            <h3 class="cfg-secao__titulo" id=${`cfg-secao-${section.key}`}>${section.label}</h3>
            <ul class="cfg-cartoes">${inSection.map(groupCard)}</ul>
          </section>`;
        })}
        <section class="cfg-secao cfg-secao--travada" aria-labelledby="cfg-secao-modulos">
          <h3 class="cfg-secao__titulo" id="cfg-secao-modulos">Chegam com os módulos</h3>
          <ul class="cfg-cartoes">
            ${LOCKED_SECTIONS.map(
              (l) => html`<li class="cfg-cartao cfg-cartao--travado">
                <span class="cfg-cartao__nome">${l.label}<span class="sr-only">, travado, ${l.module.toLowerCase()}</span></span>
                <span class="cfg-cartao__valor">${l.what}</span>
                <span class="cfg-modulo" aria-hidden="true">${l.module}</span>
              </li>`,
            )}
          </ul>
        </section>
      </div>`,
      container,
    );
  }

  draw();
  if (runsOnboarding) {
    api.onboarding
      .get()
      .then((o) => {
        onboarding = o;
        draw();
      })
      .catch(() => {});
  }
  return () => {
    alive = false;
  };
}
