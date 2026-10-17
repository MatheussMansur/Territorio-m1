// Registro (história 1.13), só do dono: quem fez o quê, quando e em qual aparelho, o mais novo primeiro,
// agrupado por dia; filtros por pessoa, tipo de ação, aparelho e período; cada entrada abre o
// antes e depois, e segredos só aparecem como "trocado". A exportação pede a confirmação de identidade
// e segue os filtros. Não há como editar ou apagar uma entrada.
import "./registro.css";
import { toast } from "../../components/toast.js";
import { houseParts } from "../../lib/dates.js";
import { html, nothing, render } from "../../lib/html.js";
import * as equipe from "../../services/api/staff-equipe.js";
import * as api from "../../services/api/staff-registro.js";
import * as sistema from "../../services/api/staff-sistema.js";
import { staffErrorMessage } from "../../lib/errors.js";
import { withIdentity } from "../identity.js";
import { emptyState, errorState, longDay, saveFile } from "./clientes/comum.js";

const TYPES = [
  { key: "reservation", label: "Reservas" },
  { key: "waitlist", label: "Espera" },
  { key: "table_session", label: "Mesas do salão" },
  { key: "night", label: "Noite" },
  { key: "alert", label: "Alertas do Hoje" },
  { key: "customer", label: "Clientes" },
  { key: "privacy", label: "Pedidos de dados" },
  { key: "user", label: "Equipe" },
  { key: "permissions", label: "Permissões" },
  { key: "settings", label: "Configurações" },
  { key: "menu", label: "Cardápio" },
  { key: "content", label: "Site" },
  { key: "image", label: "Galeria" },
  { key: "layout", label: "Plantas" },
  { key: "event", label: "Eventos" },
  { key: "device", label: "Aparelhos" },
  { key: "auth", label: "Entradas" },
  { key: "audit", label: "Registro" },
  { key: "message", label: "Mensagens" },
  { key: "backup", label: "Backup" },
  { key: "restore", label: "Restauração" },
];
const TYPE_LABEL = Object.fromEntries(TYPES.map((t) => [t.key, t.label]));

// nomes legíveis dos campos que aparecem em "antes e depois"
const FIELD = {
  status: "Situação",
  tolerance_min: "Tolerância (min)",
  extra_tolerance_min: "Tolerância extra (min)",
  internal_notes: "Notas da casa",
  available: "Disponível",
  table_codes: "Mesa",
  totp_secret: "Código de duas etapas",
  whatsapp_token: "Chave do WhatsApp",
  role: "Perfil",
  blocked: "Bloqueado",
  blocked_reason: "Motivo do bloqueio",
  pin: "PIN",
  combos: "Mesas juntas",
  tags: "Marcadores",
  list_capacity: "Capacidade da lista",
  file: "Arquivo",
  window_days: "Janela de reserva (dias)",
  password: "Senha",
  waitlist_enabled: "Lista de espera",
  phone: "Telefone",
  device: "Aparelho em que estava",
  alerts: "Avisos passados ao dono",
  name: "Nome",
  invite_link: "Link do convite",
  people: "Pessoas",
  tolerance_until: "Tolerância até",
  ends_at: "Mesa até",
  customer_confirmation: "Resposta do cliente",
};
const VALUE = {
  pending: "pendente",
  confirmed: "confirmada",
  completed: "chegou",
  canceled: "cancelada",
  no_show: "não veio",
  approved: "aprovado",
  revoked: "revogado",
  active: "ativa",
  disabled: "desativada",
  open: "aberto",
  done: "atendido",
  rejected: "recusado",
  waitlisted: "na espera",
  offered: "com mesa oferecida",
  closed: "fechada",
  owner: "dono",
  manager: "gerente",
  floor: "recepção",
  true: "sim",
  false: "não",
};
const show = (v) => (v === null || v === undefined || v === "" ? "—" : VALUE[String(v)] ?? String(v));

const EMPTY_FILTERS = { actor: "", action: "", device: "", from: "", to: "" };

export async function mount(container) {
  const state = {
    filters: { ...EMPTY_FILTERS },
    items: [],
    next: null,
    total: 0,
    status: "loading",
    error: null,
    more: false,
    people: [],
    devices: [],
    exporting: false,
  };
  let controller = null;
  let gone = false;
  const draw = () => !gone && render(view(), container);
  const hasFilters = () => Object.values(state.filters).some(Boolean);

  async function load({ append = false } = {}) {
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    if (append) state.more = true;
    else state.status = "loading";
    draw();
    try {
      const page = await api.list({ ...state.filters, cursor: append ? state.next : undefined, limit: 30 }, { signal });
      state.items = append ? [...state.items, ...page.items] : page.items;
      state.next = page.next_cursor;
      state.total = page.total ?? state.items.length;
      state.status = "ready";
    } catch (error) {
      if (signal.aborted) return;
      state.error = error;
      if (append) toast({ kind: "error", title: "Não carregou mais", message: staffErrorMessage(error) });
      else state.status = "error";
    }
    state.more = false;
    draw();
  }

  const setFilter = (name, value) => {
    state.filters = { ...state.filters, [name]: value };
    load();
  };

  const clearFilters = () => {
    state.filters = { ...EMPTY_FILTERS };
    load();
    container.querySelector("#registro-pessoa")?.focus();
  };

  async function exportLog() {
    state.exporting = true;
    draw();
    try {
      // a confirmação de identidade só quando a última tem mais de 5 minutos (história 1.7)
      const blob = await withIdentity(() => api.exportCsv({ ...state.filters }), {
        title: "Exportar o registro",
        message: "Exportar pede a senha e o código de novo. O arquivo segue os filtros escolhidos, e a exportação também fica no registro.",
      });
      if (!blob) {
        state.exporting = false;
        return draw();
      }
      const today = houseParts(new Date()).date;
      saveFile(blob, `registro-territorio-${today}.csv`);
      toast({ title: "Registro exportado", message: "O arquivo está nos downloads." });
      load();
    } catch (error) {
      toast({ kind: "error", title: "Não exportou", message: staffErrorMessage(error) });
    }
    state.exporting = false;
    draw();
  }

  function changes(entry) {
    const list = Object.entries(entry.changes || {});
    if (!list.length) return nothing;
    return html`<details class="registro__mudancas">
      <summary>Antes e depois</summary>
      <table class="registro__tabela">
        <caption class="sr-only">O que mudou</caption>
        <thead><tr><th scope="col">Campo</th><th scope="col">Antes</th><th scope="col">Depois</th></tr></thead>
        <tbody>
          ${list.map(([field, change]) =>
            change?.secret
              ? html`<tr><th scope="row">${FIELD[field] || field}</th><td colspan="2"><span class="trocado">trocado</span></td></tr>`
              : html`<tr><th scope="row">${FIELD[field] || field}</th><td>${show(change?.from)}</td><td>${show(change?.to)}</td></tr>`,
          )}
        </tbody>
      </table>
    </details>`;
  }

  const actorLine = (e) => {
    const who = e.actor_type === "system" ? "Sistema" : e.actor_type === "customer" ? `${e.actor_label} (cliente)` : e.actor_label;
    return html`<span class="registro__quem">${who}</span>${e.device_label ? html`<span class="registro__aparelho">${e.device_label}</span>` : nothing}`;
  };

  function list() {
    const groups = [];
    for (const e of state.items) {
      const day = houseParts(e.occurred_at).date;
      if (groups.at(-1)?.day !== day) groups.push({ day, items: [] });
      groups.at(-1).items.push(e);
    }
    return groups.map(
      (g) => html`<section class="registro__dia" aria-label=${longDay(g.day)}>
        <h2 class="registro__data">${longDay(g.day)}</h2>
        <ol class="registro__lista">
          ${g.items.map(
            (e) => html`<li class=${`registro__item registro__item--${e.actor_type}`}>
              <time class="registro__hora" datetime=${e.occurred_at}>${houseParts(e.occurred_at).time}</time>
              <div class="registro__corpo">
                <p class="registro__resumo">${e.summary}</p>
                <p class="registro__meta">${actorLine(e)}<span class="registro__tipo">${TYPE_LABEL[String(e.action).split(".")[0]] || e.action}</span></p>
                ${changes(e)}
              </div>
            </li>`,
          )}
        </ol>
      </section>`,
    );
  }

  function body() {
    if (state.status === "loading") return html`<div class="area__vazio" role="status"><span class="raiz raiz--gira" aria-hidden="true"></span><p>Carregando o registro…</p></div>`;
    if (state.status === "error") return errorState(state.error, () => load(), "O registro não abriu");
    if (!state.items.length) {
      return hasFilters()
        ? emptyState({ title: "Nenhuma ação com esses filtros", text: "Tente outro período ou outra pessoa.", action: { label: "Limpar filtros", onClick: clearFilters } })
        : emptyState({ title: "Nenhuma ação registrada ainda", text: "Cada mudança feita no painel aparece aqui, com quem fez, quando e em qual aparelho.", action: { label: "Atualizar", onClick: () => load() } });
    }
    return html`<p class="contagem" role="status">${state.total} ${state.total === 1 ? "ação" : "ações"}${hasFilters() ? " com esses filtros" : ""}</p>
      ${list()}
      ${state.next
        ? html`<div class="data-table__more"><button class="btn btn--sm btn--outline" type="button" aria-busy=${state.more ? "true" : "false"} @click=${() => load({ append: true })}>Carregar mais</button></div>`
        : nothing}`;
  }

  const select = (id, name, label, options) => html`<div class="field">
    <label class="field__label" for=${id}>${label}</label>
    <select class="field__input" id=${id} .value=${state.filters[name]} @change=${(e) => setFilter(name, e.target.value)}>
      ${options.map((o) => html`<option value=${o.value} ?selected=${state.filters[name] === o.value}>${o.label}</option>`)}
    </select>
  </div>`;

  const view = () => html`<form class="ferramentas registro__filtros" aria-label="Filtros do registro" @submit=${(e) => e.preventDefault()}>
      ${select("registro-pessoa", "actor", "Pessoa", [
        { value: "", label: "Todas" },
        ...state.people.map((p) => ({ value: p.id, label: p.name || p.email })),
        { value: "customer", label: "Clientes (pelo site)" },
        { value: "system", label: "Sistema" },
      ])}
      ${select("registro-tipo", "action", "Tipo de ação", [{ value: "", label: "Todos" }, ...TYPES.map((t) => ({ value: t.key, label: t.label }))])}
      ${select("registro-aparelho", "device", "Aparelho", [
        { value: "", label: "Todos" },
        { value: "Acesso pessoal", label: "Acesso pessoal" },
        ...state.devices.filter((d) => d.status === "approved" || d.status === "revoked").map((d) => ({ value: d.name, label: d.name })),
      ])}
      <div class="field registro__periodo">
        <label class="field__label" for="registro-de">De</label>
        <input class="field__input" id="registro-de" type="date" .value=${state.filters.from} max=${state.filters.to || nothing} @change=${(e) => setFilter("from", e.target.value)} />
      </div>
      <div class="field registro__periodo">
        <label class="field__label" for="registro-ate">Até</label>
        <input class="field__input" id="registro-ate" type="date" .value=${state.filters.to} min=${state.filters.from || nothing} @change=${(e) => setFilter("to", e.target.value)} />
      </div>
      <div class="ferramentas__fim">
        ${hasFilters() ? html`<button class="btn btn--sm btn--outline" type="button" @click=${clearFilters}>Limpar filtros</button>` : nothing}
        <button class="btn btn--sm" type="button" aria-busy=${state.exporting ? "true" : "false"} ?disabled=${state.status !== "ready" || !state.items.length} @click=${exportLog}>Exportar</button>
      </div>
    </form>
    <p class="bloco__nota registro__nota">O registro não se edita nem se apaga. Senhas, códigos e chaves aparecem só como "trocado".</p>
    ${body()}`;

  // as pessoas e os aparelhos para os filtros; o registro funciona sem eles
  equipe.users().then((people) => ((state.people = people.filter((p) => p.status !== "invited")), draw())).catch(() => {});
  sistema.devices().then((devices) => ((state.devices = devices), draw())).catch(() => {});
  load();
  return () => {
    gone = true;
    controller?.abort();
  };
}
