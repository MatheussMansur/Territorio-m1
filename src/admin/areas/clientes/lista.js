// A lista de clientes (história 5.14): busca pelo nome ou pelo fim do telefone, sem ligar
// para acentos ou maiúsculas; telefone mascarado, visitas, última visita, faltas e etiquetas; "Carregar mais".
import { html, nothing, render } from "../../../lib/html.js";
import * as api from "../../../services/api/staff-clientes.js";
import { canDo } from "../../nav.js";
import { dayOf, emptyState, errorState, subnav } from "./comum.js";

/** Os pedidos do site (LGPD) são de quem o arquivo de permissões indica (história 1.3). */
export const readsRequests = (user) => canDo(user?.role, "GET /staff/privacy/requests", user?.areas ?? undefined);

// a busca sobrevive a uma ida à ficha de um cliente e volta
let lastQuery = "";

export const TAG = { regular: "Frequente", attention: "Atenção" };

export function tagBadges(c) {
  return html`${(c.tags || []).map((t) => html`<span class=${`badge marcador marcador--${t}`}>${TAG[t] || t}</span>`)}${c.blocked
    ? html`<span class="badge marcador marcador--bloqueado">Bloqueado</span>`
    : nothing}`;
}

export function clientesNav(user, current, openCount = 0) {
  if (!readsRequests(user)) return nothing;
  return subnav(
    "Partes de Clientes",
    [
      { key: "lista", href: "/admin/clientes", label: "Clientes" },
      { key: "pedidos", href: "/admin/clientes/pedidos", label: "Pedidos do site", count: openCount },
    ],
    current,
  );
}

export async function mountList(container, { user, navigate }) {
  const state = { q: lastQuery, items: [], next: null, total: 0, status: "loading", error: null, more: false, open: 0 };
  let controller = null;
  let timer = null;
  let gone = false;

  const draw = () => {
    if (gone) return;
    render(view(), container);
  };

  async function load({ append = false } = {}) {
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    if (append) state.more = true;
    else state.status = "loading";
    draw();
    try {
      const page = await api.list({ q: state.q.trim(), cursor: append ? state.next : undefined }, { signal });
      state.items = append ? [...state.items, ...page.items] : page.items;
      state.next = page.next_cursor;
      state.total = page.total ?? state.items.length;
      state.status = "ready";
    } catch (error) {
      if (signal.aborted) return;
      state.error = error;
      state.status = append ? "ready" : "error";
    } finally {
      if (!signal.aborted) state.more = false;
    }
    draw();
  }

  const onSearch = (event) => {
    state.q = lastQuery = event.target.value;
    clearTimeout(timer);
    timer = setTimeout(() => load(), 250);
  };

  const clearSearch = () => {
    state.q = lastQuery = "";
    const input = container.querySelector("#busca-cliente");
    if (input) input.value = "";
    load();
    input?.focus();
  };

  const rows = () =>
    state.items.map(
      (c) => html`<tr class=${c.anonymized ? "is-anonimo" : ""}>
        <td data-label="Nome" class="is-wide">
          ${c.anonymized ? html`<span class="anonimo">cliente anonimizado</span>` : html`<a class="nome-cliente" href=${`/admin/clientes/${c.id}`}>${c.name}</a>`}
        </td>
        <td data-label="Telefone" class="num">${c.phone_masked || "—"}</td>
        <td data-label="Visitas" class="num">${c.visits}</td>
        <td data-label="Última visita" class="num">${c.last_visit_at ? dayOf(c.last_visit_at) : "—"}</td>
        <td data-label="Faltas" class="num">${c.no_shows ? html`<b class="faltas">${c.no_shows}</b>` : "0"}</td>
        <td data-label="Marcadores" class="is-wide"><span class="marcadores">${tagBadges(c)}${!c.tags?.length && !c.blocked ? html`<span class="fraco">—</span>` : nothing}</span></td>
      </tr>`,
    );

  function body() {
    if (state.status === "loading")
      return html`<div class="table-wrap" aria-busy="true"><table class="data-table"><tbody>
        ${[1, 2, 3, 4, 5].map(() => html`<tr aria-hidden="true">${[1, 2, 3, 4, 5, 6].map(() => html`<td><span class="skeleton skeleton--text"></span></td>`)}</tr>`)}
      </tbody></table><p class="sr-only" role="status">Carregando os clientes…</p></div>`;
    if (state.status === "error") return errorState(state.error, () => load(), "A lista de clientes não abriu");
    if (!state.items.length) {
      return state.q.trim()
        ? emptyState({ title: "Nenhum cliente com esse nome ou telefone", text: "Confira a grafia ou busque pelos últimos números do telefone.", action: { label: "Limpar busca", onClick: clearSearch } })
        : emptyState({ title: "Ainda não tem cliente aqui", text: "Cada pessoa que reserva vira um cliente nesta lista, com visitas e faltas.", action: { label: "Ver reservas", onClick: () => navigate("/admin/reservas") } });
    }
    return html`<p class="contagem" role="status">${state.total} ${state.total === 1 ? "cliente" : "clientes"}${state.q.trim() ? " na busca" : ""}</p>
      <div class="table-wrap">
        <table class="data-table data-table--stack tabela-clientes">
          <caption class="sr-only">Clientes da casa</caption>
          <thead><tr><th scope="col">Nome</th><th scope="col">Telefone</th><th scope="col">Visitas</th><th scope="col">Última visita</th><th scope="col">Faltas</th><th scope="col">Marcadores</th></tr></thead>
          <tbody>${rows()}</tbody>
        </table>
      </div>
      ${state.next
        ? html`<div class="data-table__more">
            <button class="btn btn--sm btn--outline mais-clientes" type="button" aria-busy=${state.more ? "true" : "false"} @click=${() => load({ append: true })}>Carregar mais</button>
          </div>`
        : nothing}`;
  }

  const view = () => html`${clientesNav(user, "lista", state.open)}
    <form class="ferramentas" role="search" @submit=${(e) => e.preventDefault()}>
      <div class="field">
        <label class="field__label" for="busca-cliente">Buscar cliente</label>
        <input class="field__input" id="busca-cliente" type="search" placeholder="Nome ou final do telefone" autocomplete="off" .value=${state.q} @input=${onSearch} />
      </div>
    </form>
    ${body()}`;

  // a contagem de pedidos abertos, para o "Pedidos do site" do dono
  if (readsRequests(user)) {
    api
      .privacyRequests({ status: "open" })
      .then((page) => {
        state.open = page.items.length;
        draw();
      })
      .catch(() => {});
  }
  load();
  return () => {
    gone = true;
    clearTimeout(timer);
    controller?.abort();
  };
}
