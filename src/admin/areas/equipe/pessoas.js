// As pessoas da casa (história 1.9): convidar por e-mail (link de 72 h), cadastrar quem só entra
// com o PIN nos aparelhos da casa (o PIN são os 4 últimos dígitos do telefone), e na
// gaveta de cada pessoa: mudar o papel (checagem de identidade), mudar o telefone (e o PIN),
// desativar ou reativar (nunca apaga), reenviar o convite, encerrar as sessões e refazer a
// verificação em duas etapas. A casa nunca fica sem um dono ativo.
import { confirmAction } from "../../../components/confirm.js";
import { openDialog } from "../../../components/dialog.js";
import { toast } from "../../../components/toast.js";
import { live } from "lit-html/directives/live.js";
import { staffErrorMessage } from "../../../lib/errors.js";
import { html, nothing, render } from "../../../lib/html.js";
import { COUNTRIES, toE164 } from "../../../lib/phone.js";
import * as api from "../../../services/api/staff-equipe.js";
import { withIdentity } from "../../identity.js";
import { ROLES } from "../../nav.js";
import { emptyState, errorState, fieldError, formDialog, since, subnav, when } from "../clientes/comum.js";

export const ROLE = { owner: "Dono", manager: "Gerente", floor: "Recepção" };
const ROLE_HINT = {
  owner: "Vê e muda tudo, inclusive equipe, registro e sistema.",
  manager: "Cuida das reservas, da agenda, do site e dos clientes.",
  floor: "Conduz a noite: Hoje, Reservas, Salão, Espera e o cardápio da noite.",
};
const STATUS = {
  active: { label: "Ativa", cls: "badge--confirmed" },
  invited: { label: "Convite enviado", cls: "badge--pending" },
  disabled: { label: "Desativada", cls: "badge--canceled" },
};

export const equipeNav = (current) =>
  subnav(
    "Partes de Equipe",
    [
      { key: "pessoas", href: "/admin/equipe", label: "Pessoas" },
      { key: "permissoes", href: "/admin/equipe/permissoes", label: "Permissões" },
    ],
    current,
  );

const nameOf = (u) => u.name || u.email || "Pessoa";
const statusBadge = (u) => html`<span class=${`badge ${STATUS[u.status]?.cls || ""}`}>${STATUS[u.status]?.label || u.status}</span>`;

const PHONE_HINT = "Confira o celular, com o DDD: o PIN é o final dele.";
// o que withIdentity responde quando a pessoa desistiu da checagem de identidade
const GAVE_UP = Symbol("gave-up");

const phoneFields = (id) => html`<div class="field">
  <label class="field__label" for=${id}>Celular <small>o PIN é o final dele</small></label>
  <div class="phone">
    <select class="field__input" name="country" aria-label="País do celular">
      ${COUNTRIES.map((c) => html`<option value=${c.id}>${c.label}</option>`)}
    </select>
    <input class="field__input" id=${id} name="phone" type="tel" inputmode="tel" autocomplete="off" placeholder="(45) 99999-0000" />
  </div>
</div>`;

function readPhone(form) {
  const phone = toE164(form.elements.namedItem("phone").value, form.elements.namedItem("country").value);
  if (!phone) throw fieldError("phone", PHONE_HINT);
  return phone;
}

export async function mountPeople(container, { user }) {
  const state = { status: "loading", users: [], error: null, openId: null };
  const controller = new AbortController();
  let gone = false;
  let drawer = null; // { el, close }

  const draw = () => {
    if (gone) return;
    render(view(), container);
    if (drawer) render(drawerView(), drawer.el);
  };

  async function load({ quiet = false } = {}) {
    if (!quiet) state.status = "loading";
    draw();
    try {
      state.users = await api.users({ signal: controller.signal });
      state.status = "ready";
    } catch (error) {
      if (controller.signal.aborted) return;
      state.error = error;
      if (!quiet) state.status = "error";
    }
    draw();
  }

  const replace = (u) => {
    state.users = state.users.map((x) => (x.id === u.id ? u : x));
    draw();
  };

  async function inviteDialog() {
    const created = await formDialog({
      title: "Convidar por e-mail",
      intro: "A pessoa recebe um link que vale 72 horas. Ao aceitar, cria a senha e liga o aplicativo de códigos.",
      body: html`<div class="field">
          <label class="field__label" for="convite-email">E-mail</label>
          <input class="field__input" id="convite-email" name="email" type="email" autocomplete="off" required />
        </div>
        <div class="field">
          <label class="field__label" for="convite-perfil">Perfil</label>
          <select class="field__input" id="convite-perfil" name="role">
            <option value="manager">Gerente</option>
            <option value="floor">Recepção</option>
            <option value="owner">Dono</option>
          </select>
        </div>`,
      submitLabel: "Mandar convite",
      onSubmit: (form) => {
        const email = form.elements.namedItem("email").value.trim();
        if (!email) throw fieldError("email", "Escreva o e-mail da pessoa.");
        return api.invite({ email, role: form.elements.namedItem("role").value });
      },
    });
    if (!created) return;
    state.users = [...state.users, created];
    draw();
    toast({ title: "Convite enviado", message: `${created.email} tem 72 horas para aceitar.` });
  }

  async function pinDialog() {
    const created = await formDialog({
      title: "Cadastrar só com PIN",
      intro: "Para quem trabalha só no computador ou no tablet da casa, sem e-mail. Entra tocando o nome e digitando o PIN.",
      body: html`<div class="field">
          <label class="field__label" for="pin-nome">Nome</label>
          <input class="field__input" id="pin-nome" name="name" autocomplete="off" maxlength="60" required />
        </div>
        <div class="field">
          <label class="field__label" for="pin-perfil">Perfil</label>
          <select class="field__input" id="pin-perfil" name="role">
            <option value="floor">Recepção</option>
            <option value="manager">Gerente</option>
          </select>
        </div>
        ${phoneFields("pin-celular")}`,
      submitLabel: "Cadastrar",
      onSubmit: (form) => {
        const name = form.elements.namedItem("name").value.trim();
        if (name.length < 2) throw fieldError("name", "Escreva o nome da pessoa, com pelo menos 2 letras.");
        return api.createPinUser({ name, role: form.elements.namedItem("role").value, phone: readPhone(form) });
      },
    });
    if (!created) return;
    state.users = [...state.users, created];
    draw();
    toast({ title: `${created.name} cadastrada`, message: `O PIN é o final do celular: ${created.phone_masked.slice(-4)}.` });
  }

  // ---- a gaveta da pessoa --------------------------------------------------------------

  const current = () => state.users.find((u) => u.id === state.openId);

  function openPerson(u) {
    state.openId = u.id;
    const el = document.createElement("dialog");
    el.className = "dialog dialog--drawer pessoa";
    el.setAttribute("aria-labelledby", "pessoa-titulo");
    document.body.append(el);
    render(drawerView(), el);
    const { close } = openDialog(el, {
      onClose: () => {
        el.remove();
        drawer = null;
        state.openId = null;
      },
    });
    drawer = { el, close };
    el.querySelector(".dialog__close")?.focus();
  }

  /** Faz uma mudança; `done` é o título do aviso (ou uma função da resposta). False quando não aconteceu. */
  async function act(run, done) {
    try {
      const result = await run();
      if (result === GAVE_UP) return false;
      if (result && result.id) replace(result);
      const said = typeof done === "function" ? done(result) : typeof done === "string" ? { title: done } : done;
      if (said) toast(said);
      return result ?? true;
    } catch (error) {
      toast({ kind: "error", title: "Não gravou", message: staffErrorMessage(error) });
      return false;
    }
  }

  /**
   * Uma mudança sensível (história 1.7): pede a senha e o código só quando não foram
   * confirmados nos últimos 5 minutos, e de novo se o servidor disser que a janela fechou.
   */
  const sensitive = (call, message) => async () => (await withIdentity(async () => ({ value: await call() }), { message }))?.value ?? GAVE_UP;

  async function changeRole(u, role) {
    if (role === u.role) return;
    const ok = await confirmAction({
      title: `${nameOf(u)} vira ${ROLE[role].toLowerCase()}?`,
      message: `${ROLE_HINT[role]} O menu dela muda na próxima vez que o painel falar com a casa.`,
      confirmLabel: "Mudar perfil",
    });
    if (!ok) return draw();
    await act(sensitive(() => api.update(u.id, { role }), "Mudar o perfil pede a senha e o código de novo. Vale por 5 minutos."), `${nameOf(u)} agora é ${ROLE[role].toLowerCase()}`);
    draw();
  }

  async function toggleActive(u) {
    const off = u.status === "active";
    const sole = off ? u.sole_alerts || [] : [];
    const ok = await confirmAction({
      title: off ? `Desativar ${nameOf(u)}?` : `Reativar ${nameOf(u)}?`,
      message: off
        ? `Ela deixa de entrar na hora, em qualquer aparelho, e some da lista do PIN. Nada é apagado: o registro de ações continua com o nome dela.${
            sole.length ? ` Só ela recebe os avisos de ${sole.join(", ")}: eles passam para você, o dono.` : ""
          }`
        : "Ela volta a entrar com o mesmo perfil de antes.",
      confirmLabel: off ? "Desativar" : "Reativar",
      danger: off,
    });
    if (!ok) return;
    await act(
      () => api.update(u.id, { status: off ? "disabled" : "active" }),
      (result) =>
        off && result?.alerts_handed_to_owner?.length
          ? { title: `${nameOf(u)} desativada`, message: `Os avisos de ${result.alerts_handed_to_owner.join(", ")} agora chegam para você. Mude em Configurações › Avisos à equipe.` }
          : { title: off ? `${nameOf(u)} desativada` : `${nameOf(u)} reativada` },
    );
    if (off) load({ quiet: true });
  }

  async function changePhone(event, u) {
    event.preventDefault();
    const form = event.currentTarget;
    let phone;
    try {
      phone = readPhone(form);
    } catch (error) {
      const input = form.elements.namedItem("phone");
      input.setAttribute("aria-invalid", "true");
      toast({ kind: "error", title: "Confira o celular", message: error?.fields ? PHONE_HINT : staffErrorMessage(error) });
      input.focus();
      return;
    }
    if (await act(() => api.update(u.id, { phone }), "Celular trocado")) {
      form.reset();
      toast({ title: "PIN novo", message: `Agora o PIN de ${nameOf(u)} é o final do celular novo.` });
    }
  }

  async function resetMfa(u) {
    const ok = await confirmAction({
      title: "Zerar a verificação em duas etapas?",
      message: `As sessões de ${nameOf(u)} são encerradas e, no próximo acesso, ela liga o aplicativo de códigos de novo.`,
      confirmLabel: "Zerar verificação",
      danger: true,
    });
    if (!ok) return;
    await act(sensitive(() => api.resetMfa(u.id), "Zerar a verificação pede a senha e o código de novo. Vale por 5 minutos."), {
      title: "Verificação zerada",
      message: `As sessões de ${nameOf(u)} foram encerradas. No próximo acesso, ela liga o aplicativo de códigos de novo.`,
    });
  }

  async function endSessions(u) {
    const ok = await confirmAction({ title: `Encerrar as sessões de ${nameOf(u)}?`, message: "Ela sai do painel em todos os aparelhos e entra de novo quando precisar.", confirmLabel: "Encerrar sessões" });
    if (ok) await act(() => api.revokeSessions(u.id), "Sessões encerradas");
  }

  function drawerView() {
    const u = current();
    if (!u) return nothing;
    const isMe = u.id === user.id;
    return html`<div class="dialog__bar">
        <h2 class="dialog__title" id="pessoa-titulo">${nameOf(u)}</h2>
        <button class="dialog__close" type="button" data-close aria-label="Fechar">×</button>
      </div>
      <div class="dialog__body pessoa__corpo">
        <p class="pessoa__linha">${statusBadge(u)} <span>${ROLE[u.role]}</span>${isMe ? html` <span class="fraco">(você)</span>` : nothing}</p>
        <dl class="dados">
          ${u.email ? html`<div><dt>E-mail</dt><dd>${u.email}</dd></div>` : nothing}
          ${u.phone_masked ? html`<div><dt>Celular</dt><dd class="mono">${u.phone_masked}</dd></div>` : nothing}
          <div><dt>Entra</dt><dd>${u.pin_only ? "só com PIN, no aparelho da casa" : "com e-mail, senha e código"}</dd></div>
          <div><dt>Último acesso</dt><dd>${u.last_login_at ? when(u.last_login_at) : "ainda não entrou"}</dd></div>
          ${u.status === "invited" ? html`<div><dt>Convite</dt><dd>vence ${when(u.invite_expires_at)}</dd></div>` : nothing}
        </dl>

        ${u.status !== "disabled"
          ? html`<fieldset class="bloco perfis">
              <legend class="bloco__titulo">Perfil</legend>
              ${Object.keys(ROLE).map(
                (role) => html`<label class="check perfil">
                  <input type="radio" name="perfil" value=${role} .checked=${live(u.role === role)} @change=${() => changeRole(u, role)} />
                  <span><b>${ROLE[role]}</b> · ${ROLE_HINT[role]}</span>
                </label>`,
              )}
              <p class="bloco__nota">Mudar o perfil pede a sua senha de novo e fica no registro.</p>
            </fieldset>`
          : nothing}

        ${u.pin_only && u.status !== "disabled"
          ? html`<section class="bloco" aria-labelledby="pin-titulo">
              <h3 class="bloco__titulo" id="pin-titulo">Celular e PIN</h3>
              <p class="bloco__nota">O PIN é sempre os 4 últimos números do celular. Trocar o celular troca o PIN.</p>
              <form class="pin-form" novalidate @submit=${(e) => changePhone(e, u)}>${phoneFields("pessoa-celular")}<button class="btn btn--sm btn--outline" type="submit">Trocar celular</button></form>
            </section>`
          : nothing}

        <section class="bloco" aria-labelledby="acesso-titulo">
          <h3 class="bloco__titulo" id="acesso-titulo">Acesso</h3>
          <div class="pessoa__acoes">
            ${u.status === "invited" ? html`<button class="btn btn--sm" type="button" @click=${() => act(() => api.resendInvite(u.id), "Convite reenviado: o link anterior deixou de valer")}>Reenviar convite</button>` : nothing}
            ${u.status === "active" && !isMe ? html`<button class="btn btn--sm btn--outline" type="button" @click=${() => endSessions(u)}>Encerrar sessões</button>` : nothing}
            ${u.mfa_enabled && !u.pin_only && u.status === "active" && !isMe ? html`<button class="btn btn--sm btn--outline" type="button" @click=${() => resetMfa(u)}>Zerar verificação em duas etapas</button>` : nothing}
            ${u.status === "active" && !isMe ? html`<button class="btn btn--sm btn--danger" type="button" @click=${() => toggleActive(u)}>Desativar</button>` : nothing}
            ${u.status === "disabled" ? html`<button class="btn btn--sm" type="button" @click=${() => toggleActive(u)}>Reativar</button>` : nothing}
          </div>
          ${isMe ? html`<p class="bloco__nota">Para sair do perfil de dono, passe o perfil para outra pessoa antes. A casa nunca fica sem dono.</p>` : nothing}
        </section>
      </div>`;
  }

  // ---- a lista ------------------------------------------------------------------------

  function body() {
    if (state.status === "loading") return html`<div class="area__vazio" role="status"><span class="raiz raiz--gira" aria-hidden="true"></span><p>Carregando a equipe…</p></div>`;
    if (state.status === "error") return errorState(state.error, () => load(), "A equipe não abriu");
    const others = state.users.filter((u) => u.id !== user.id);
    const order = { active: 0, invited: 1, disabled: 2 };
    const rows = [...state.users].sort((a, b) => order[a.status] - order[b.status] || ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || nameOf(a).localeCompare(nameOf(b), "pt"));
    return html`${!others.length
        ? emptyState({ title: "Só você na equipe por enquanto", text: "Convide a gerente por e-mail e cadastre quem trabalha no aparelho da casa só com o PIN.", action: { label: "Convidar por e-mail", onClick: inviteDialog } })
        : nothing}
      <div class="table-wrap">
        <table class="data-table data-table--stack tabela-equipe">
          <caption class="sr-only">Pessoas da equipe</caption>
          <thead><tr><th scope="col">Pessoa</th><th scope="col">Perfil</th><th scope="col">Situação</th><th scope="col">Entra com</th><th scope="col">Último acesso</th></tr></thead>
          <tbody>
            ${rows.map(
              (u) => html`<tr class=${u.status === "disabled" ? "is-desativada" : ""}>
                <td data-label="Pessoa" class="is-wide">
                  <button class="link-linha" type="button" @click=${() => openPerson(u)}>${nameOf(u)}</button>${u.id === user.id ? html` <span class="fraco">(você)</span>` : nothing}
                  <br /><span class="fraco pessoa__sub">${u.pin_only ? `só PIN · ${u.phone_masked || ""}` : u.email || ""}</span>
                </td>
                <td data-label="Perfil">${ROLE[u.role]}</td>
                <td data-label="Situação">${statusBadge(u)}${u.status === "invited" ? html`<br /><span class="fraco pessoa__sub">vence ${when(u.invite_expires_at)}</span>` : nothing}</td>
                <td data-label="Entra com">${u.pin_only ? "PIN no aparelho" : u.mfa_enabled ? "senha + código" : u.status === "invited" ? "—" : html`senha <span class="badge badge--pending">sem código</span>`}</td>
                <td data-label="Último acesso" class="num">${u.last_login_at ? since(u.last_login_at) : "—"}</td>
              </tr>`,
            )}
          </tbody>
        </table>
      </div>`;
  }

  const view = () => html`${equipeNav("pessoas")}
    <div class="ferramentas">
      <p class="bloco__nota ferramentas__texto">Desativar nunca apaga: o registro de ações guarda o nome de quem fez cada coisa.</p>
      <div class="ferramentas__fim">
        <button class="btn btn--sm" type="button" @click=${inviteDialog}>Convidar por e-mail</button>
        <button class="btn btn--sm btn--outline" type="button" @click=${pinDialog}>Cadastrar só com PIN</button>
      </div>
    </div>
    ${body()}`;

  load();
  return () => {
    gone = true;
    controller.abort();
    drawer?.close();
  };
}
