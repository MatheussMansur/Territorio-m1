// Pedidos de privacidade (história 5.18), só do dono: cada pedido com o prazo de 15 dias contado,
// "Atender" e "Recusar" (com o motivo), e "Registrar pedido" para o que chegou por
// WhatsApp, e-mail ou na casa. Atender uma exclusão deixa o cliente anônimo.
import { confirmAction } from "../../../components/confirm.js";
import { toast } from "../../../components/toast.js";
import { html, render } from "../../../lib/html.js";
import * as api from "../../../services/api/staff-clientes.js";
import { confirmIdentity, dayOf, daysUntil, emptyState, errorState, fieldError, formDialog, messageOf } from "./comum.js";
import { clientesNav, readsRequests } from "./lista.js";

const KIND = { access: "Ver os dados", correction: "Corrigir dados", deletion: "Apagar os dados", portability: "Levar os dados", opt_out: "Parar as novidades" };
const CHANNEL = { account: "Conta no site", whatsapp: "WhatsApp", email: "E-mail", in_person: "Na casa" };
const FILTERS = [
  { key: "open", label: "Abertos" },
  { key: "done", label: "Atendidos" },
  { key: "rejected", label: "Recusados" },
  { key: "", label: "Todos" },
];
// o que "Atender" quer dizer em cada tipo, dito antes de marcar como feito
const HOW = {
  access: "Use \"Exportar dados\" na ficha e mande a versão legível ao cliente. Depois marque aqui.",
  portability: "Use \"Exportar dados\" na ficha e mande o JSON ao cliente. Depois marque aqui.",
  correction: "Corrija na ficha o que o cliente pediu. Depois marque aqui.",
  opt_out: "O cliente deixa de receber novidades da casa. As mensagens da reserva continuam.",
};

function deadline(r, now) {
  if (r.status !== "open") return html`<span class="fraco">${r.status === "done" ? "atendido" : "recusado"} ${dayOf(r.resolved_at, now)}</span>`;
  const days = daysUntil(r.due_at, now);
  if (days < 0) return html`<span class="badge badge--no-show">venceu há ${-days} ${-days === 1 ? "dia" : "dias"}</span>`;
  if (days === 0) return html`<span class="badge badge--no-show">vence hoje</span>`;
  const text = `faltam ${days} ${days === 1 ? "dia" : "dias"}`;
  return html`<span class=${days <= 3 ? "badge badge--pending prazo--perto" : "badge"}>${text}</span>`;
}

export async function mountRequests(container, { user }) {
  if (!readsRequests(user)) {
    render(
      html`<div class="area__vazio area__vazio--proibido" role="alert">
        <span class="raiz raiz--atencao" aria-hidden="true"></span>
        <p><b>Os pedidos do site são só do dono.</b> Se precisar, peça ao dono.</p>
        <a class="btn btn--sm" href="/admin/clientes">Voltar aos clientes</a>
      </div>`,
      container,
    );
    return;
  }

  const state = { filter: "open", items: [], status: "loading", error: null, open: 0 };
  const controller = new AbortController();
  let gone = false;
  const draw = () => !gone && render(view(), container);

  async function load() {
    state.status = "loading";
    draw();
    try {
      const [page, open] = await Promise.all([
        api.privacyRequests({ status: state.filter || undefined }, { signal: controller.signal }),
        state.filter === "open" ? null : api.privacyRequests({ status: "open" }, { signal: controller.signal }),
      ]);
      state.items = page.items;
      state.open = (open || page).items.length;
      state.status = "ready";
    } catch (error) {
      if (controller.signal.aborted) return;
      state.error = error;
      state.status = "error";
    }
    draw();
  }

  async function attend(r) {
    const name = r.customer_label.split(" · ")[0];
    if (r.kind === "deletion") {
      const ok = await confirmAction({
        title: `Apagar os dados de ${name}?`,
        message: "O cliente recebe a confirmação pelo WhatsApp e depois é anonimizado: nome, telefone e notas somem, e as reservas futuras são canceladas. Não dá para desfazer.",
        confirmLabel: "Atender e apagar",
        danger: true,
      });
      if (!ok) return;
      const who = await confirmIdentity({ title: "Confirme para apagar", message: "Apagar os dados pede a senha e o código de novo." });
      if (!who) return;
    } else {
      const ok = await confirmAction({ title: `Atender o pedido de ${name}?`, message: HOW[r.kind], confirmLabel: "Marcar atendido" });
      if (!ok) return;
    }
    try {
      await api.resolvePrivacyRequest(r.id, { status: "done" });
      toast({ title: "Pedido atendido", message: "A confirmação foi para a fila do WhatsApp e a ação ficou no registro." });
      load();
    } catch (error) {
      toast({ kind: "error", title: "Não gravou", message: messageOf(error) });
    }
  }

  async function reject(r) {
    const done = await formDialog({
      title: "Recusar o pedido?",
      intro: "O motivo vai para o cliente, junto com a resposta. Escreva com cuidado.",
      body: html`<div class="field">
        <label class="field__label" for="motivo-recusa">Motivo</label>
        <textarea class="field__input" id="motivo-recusa" name="note" maxlength="500" required></textarea>
      </div>`,
      submitLabel: "Recusar pedido",
      danger: true,
      onSubmit: async (form) => {
        const note = form.elements.namedItem("note").value.trim();
        if (!note) throw fieldError("note", "Conte o motivo da recusa: ele vai para o cliente.");
        return api.resolvePrivacyRequest(r.id, { status: "rejected", note });
      },
    });
    if (!done) return;
    toast({ title: "Pedido recusado", message: "A resposta foi para a fila do WhatsApp." });
    load();
  }

  async function register() {
    let customers;
    try {
      customers = (await api.list({ limit: 100 })).items.filter((c) => !c.anonymized).sort((a, b) => a.name.localeCompare(b.name, "pt"));
    } catch (error) {
      toast({ kind: "error", title: "A lista de clientes não abriu", message: messageOf(error) });
      return;
    }
    const done = await formDialog({
      title: "Registrar pedido",
      intro: "Para o pedido que chegou por WhatsApp, e-mail ou na casa. O prazo de 15 dias começa agora.",
      body: html`<div class="field">
          <label class="field__label" for="pedido-cliente">Cliente</label>
          <select class="field__input" id="pedido-cliente" name="customer_id" required>
            <option value="">Escolha…</option>
            ${customers.map((c) => html`<option value=${c.id}>${c.name} · ${c.phone_masked}</option>`)}
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="pedido-tipo">O que pediu</label>
          <select class="field__input" id="pedido-tipo" name="kind" required>
            <option value="">Escolha…</option>
            ${Object.entries(KIND).map(([k, v]) => html`<option value=${k}>${v}</option>`)}
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="pedido-canal">Por onde chegou</label>
          <select class="field__input" id="pedido-canal" name="channel" required>
            ${Object.entries(CHANNEL).filter(([k]) => k !== "account").map(([k, v]) => html`<option value=${k}>${v}</option>`)}
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="pedido-nota">Observação <small>opcional</small></label>
          <textarea class="field__input" id="pedido-nota" name="note" maxlength="500"></textarea>
        </div>`,
      submitLabel: "Registrar",
      onSubmit: (form) => {
        const value = (name) => form.elements.namedItem(name).value;
        if (!value("customer_id")) throw fieldError("customer_id", "Escolha o cliente que fez o pedido.");
        if (!value("kind")) throw fieldError("kind", "Escolha o que o cliente pediu.");
        return api.createPrivacyRequest({ customer_id: value("customer_id"), kind: value("kind"), channel: value("channel"), note: value("note").trim() });
      },
    });
    if (!done) return;
    toast({ title: "Pedido registrado", message: "O prazo de 15 dias começou a contar." });
    state.filter = "open";
    load();
  }

  const setFilter = (key) => {
    state.filter = key;
    load();
  };

  function body() {
    if (state.status === "loading") return html`<div class="area__vazio" role="status"><span class="raiz raiz--gira" aria-hidden="true"></span><p>Carregando os pedidos…</p></div>`;
    if (state.status === "error") return errorState(state.error, load, "Os pedidos não abriram");
    if (!state.items.length) {
      return state.filter === "open"
        ? emptyState({ title: "Nenhum pedido aberto", text: "Quando um cliente pedir os dados dele pelo site, o pedido aparece aqui com o prazo de 15 dias.", action: { label: "Registrar pedido", onClick: register } })
        : emptyState({ title: "Nada por aqui", text: "Nenhum pedido nesta situação.", action: { label: "Ver os abertos", onClick: () => setFilter("open") } });
    }
    const now = new Date();
    return html`<div class="table-wrap">
      <table class="data-table data-table--stack tabela-pedidos">
        <caption class="sr-only">Pedidos de dados dos clientes</caption>
        <thead><tr><th scope="col">Cliente</th><th scope="col">Pedido</th><th scope="col">Chegou</th><th scope="col">Prazo</th><th scope="col">Observação</th><th scope="col"><span class="sr-only">Ações</span></th></tr></thead>
        <tbody>
          ${state.items.map(
            (r) => html`<tr>
              <td data-label="Cliente" class="strong">${r.customer_id && !r.customer_label.startsWith("cliente anonimizado") ? html`<a class="nome-cliente" href=${`/admin/clientes/${r.customer_id}`}>${r.customer_label}</a>` : r.customer_label}</td>
              <td data-label="Pedido">${KIND[r.kind] || r.kind}</td>
              <td data-label="Chegou">${CHANNEL[r.channel] || r.channel}<br /><span class="fraco num">${dayOf(r.opened_at, now)}</span></td>
              <td data-label="Prazo">${deadline(r, now)}</td>
              <td data-label="Observação" class="is-wide">${r.note || html`<span class="fraco">—</span>`}</td>
              <td data-label="Ações" class="is-wide acoes-celula">
                ${r.status === "open"
                  ? html`<span class="acoes-pedido">
                      <button class="action action--solid" type="button" @click=${() => attend(r)}>Atender</button>
                      <button class="action" type="button" @click=${() => reject(r)}>Recusar</button>
                    </span>`
                  : html`<span class="fraco">por ${r.resolved_by || "—"}</span>`}
              </td>
            </tr>`,
          )}
        </tbody>
      </table>
    </div>`;
  }

  const view = () => html`${clientesNav(user, "pedidos", state.open)}
    <div class="ferramentas">
      <div class="filtros" role="group" aria-label="Situação dos pedidos">
        ${FILTERS.map((f) => html`<button class="filtro" type="button" aria-pressed=${state.filter === f.key ? "true" : "false"} @click=${() => setFilter(f.key)}>${f.label}</button>`)}
      </div>
      <div class="ferramentas__fim"><button class="btn btn--sm" type="button" @click=${register}>Registrar pedido</button></div>
    </div>
    <p class="bloco__nota prazo-nota">A lei dá 15 dias para responder. O prazo conta a partir do dia em que o pedido chegou.</p>
    ${body()}`;

  load();
  return () => {
    gone = true;
    controller.abort();
  };
}
