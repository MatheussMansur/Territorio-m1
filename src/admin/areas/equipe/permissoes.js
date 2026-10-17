// Permissões por área (história 1.15), só do dono: as 15 áreas do trilho em linhas, gerente e
// recepção em colunas, uma chave por célula com o padrão marcado "padrão"; a coluna do
// dono fica sempre ligada e travada. Gravar e "Voltar ao padrão" pedem a confirmação de identidade e vão
// para o registro de ações.
import { confirmAction } from "../../../components/confirm.js";
import { toast } from "../../../components/toast.js";
import { html, nothing, render } from "../../../lib/html.js";
import { staffErrorMessage } from "../../../lib/errors.js";
import * as api from "../../../services/api/staff-equipe.js";
import { withIdentity } from "../../identity.js";
import { AREAS, GROUPS, canDo } from "../../nav.js";
import { errorState, when } from "../clientes/comum.js";
import { equipeNav } from "./pessoas.js";

const PROFILES = [
  { key: "manager", label: "Gerente" },
  { key: "floor", label: "Recepção" },
];

const same = (a, b) => a.size === b.size && [...a].every((k) => b.has(k));

export async function mountPermissions(container, { user }) {
  // o arquivo de permissões diz que a tela é do dono, mesmo para quem recebeu Equipe (1.3, 1.15)
  if (!canDo(user.role, "GET /staff/permissions", user.areas ?? undefined)) {
    render(
      html`<div class="area__vazio area__vazio--proibido" role="alert">
        <span class="raiz raiz--atencao" aria-hidden="true"></span>
        <p><b>As permissões são só do dono.</b> Se precisar, peça ao dono.</p>
      </div>`,
      container,
    );
    return;
  }

  const state = { status: "loading", data: null, draft: null, error: null, saving: false };
  const controller = new AbortController();
  let gone = false;
  const draw = () => !gone && render(view(), container);

  const fromData = (data) => Object.fromEntries(PROFILES.map((p) => [p.key, new Set(data.allowed[p.key])]));
  const changed = () => state.data && PROFILES.some((p) => !same(state.draft[p.key], new Set(state.data.allowed[p.key])));
  const changeCount = () =>
    state.data ? PROFILES.reduce((n, p) => n + AREAS.filter((a) => state.draft[p.key].has(a.key) !== state.data.allowed[p.key].includes(a.key)).length, 0) : 0;
  const atDefault = () => state.data && PROFILES.every((p) => same(new Set(state.data.allowed[p.key]), new Set(state.data.defaults[p.key])));

  async function load() {
    state.status = "loading";
    draw();
    try {
      state.data = await api.permissions({ signal: controller.signal });
      state.draft = fromData(state.data);
      state.status = "ready";
    } catch (error) {
      if (controller.signal.aborted) return;
      state.error = error;
      state.status = "error";
    }
    draw();
  }

  const flip = (profile, key) => {
    const set = state.draft[profile];
    if (set.has(key)) set.delete(key);
    else set.add(key);
    draw();
  };

  async function save({ reset = false } = {}) {
    const message = `${reset ? "Voltar ao padrão" : "Gravar as permissões"} pede a senha e o código de novo. Vale por 5 minutos.`;
    state.saving = true;
    draw();
    const allowed = reset ? state.data.defaults : Object.fromEntries(PROFILES.map((p) => [p.key, AREAS.map((a) => a.key).filter((k) => state.draft[p.key].has(k))]));
    try {
      // a confirmação de identidade só quando a última tem mais de 5 minutos (história 1.7)
      const saved = await withIdentity(() => api.savePermissions({ allowed, reset }), { message });
      if (!saved) {
        state.saving = false;
        return draw();
      }
      state.data = saved;
      state.draft = fromData(state.data);
      toast({ title: reset ? "Permissões de volta ao padrão" : "Permissões gravadas", message: "Vale na próxima vez que cada pessoa abrir o painel. Ficou no registro." });
    } catch (error) {
      toast({ kind: "error", title: "Não gravou", message: staffErrorMessage(error) });
    }
    state.saving = false;
    draw();
  }

  async function backToDefault() {
    const ok = await confirmAction({
      title: "Voltar ao padrão?",
      message: "Gerente e recepção voltam a ver as áreas do arquivo de permissões da casa. O que você escolheu antes se perde.",
      confirmLabel: "Voltar ao padrão",
      danger: true,
    });
    if (ok) save({ reset: true });
  }

  const discard = () => {
    state.draft = fromData(state.data);
    draw();
  };

  function cell(profile, area) {
    const on = state.draft[profile.key].has(area.key);
    const isDefault = state.data.defaults[profile.key].includes(area.key) === on;
    const dirty = state.data.allowed[profile.key].includes(area.key) !== on;
    return html`<td data-label=${profile.label} class=${dirty ? "is-mudou" : ""}>
      <button
        class="chave"
        type="button"
        role="switch"
        aria-checked=${on ? "true" : "false"}
        aria-label=${`${profile.label}: ${area.label}`}
        aria-describedby=${`padrao-${profile.key}-${area.key}`}
        ?disabled=${state.saving}
        @click=${() => flip(profile.key, area.key)}
      >
        <span class="chave__trilho" aria-hidden="true"><span class="chave__botao"></span></span>
        <span class="chave__texto" aria-hidden="true">${on ? "ligada" : "desligada"}</span>
      </button>
      <span class="chave__padrao" id=${`padrao-${profile.key}-${area.key}`}>${dirty ? "mudou, falta gravar" : isDefault ? "padrão" : "escolha sua"}</span>
    </td>`;
  }

  function body() {
    if (state.status === "loading") return html`<div class="area__vazio" role="status"><span class="raiz raiz--gira" aria-hidden="true"></span><p>Carregando as permissões…</p></div>`;
    if (state.status === "error") return errorState(state.error, load, "As permissões não abriram");
    const count = changeCount();
    return html`<div class="table-wrap">
        <table class="data-table permissoes">
          <caption class="sr-only">Áreas do painel que cada perfil abre</caption>
          <thead>
            <tr>
              <th scope="col">Área</th>
              <th scope="col">Dono</th>
              ${PROFILES.map((p) => html`<th scope="col">${p.label}</th>`)}
            </tr>
          </thead>
          ${GROUPS.map(
            (group) => html`<tbody>
              <tr class="permissoes__grupo"><th scope="colgroup" colspan="4">${group.label}</th></tr>
              ${AREAS.filter((a) => a.group === group.key).map(
                (area) => html`<tr>
                  <th scope="row" class="permissoes__area">${area.label}</th>
                  <td data-label="Dono">
                    <span class="chave chave--travada" role="img" aria-label=${`Dono: ${area.label}, sempre ligada`}>
                      <span class="chave__trilho" aria-hidden="true"><span class="chave__botao"></span></span>
                      <span class="chave__texto" aria-hidden="true">sempre</span>
                    </span>
                  </td>
                  ${PROFILES.map((p) => cell(p, area))}
                </tr>`,
              )}
            </tbody>`,
          )}
        </table>
      </div>
      <div class="permissoes__barra" role="region" aria-label="Gravar permissões">
        <p class="permissoes__estado" role="status">
          ${count ? `${count} ${count === 1 ? "mudança" : "mudanças"} para gravar` : state.data.updated_at ? `Gravado ${when(state.data.updated_at)} por ${state.data.updated_by}` : "Tudo no padrão do arquivo de permissões"}
        </p>
        <div class="ferramentas__fim">
          ${changed() ? html`<button class="btn btn--sm btn--outline" type="button" @click=${discard}>Descartar</button>` : nothing}
          <button class="btn btn--sm btn--outline" type="button" ?disabled=${state.saving || (atDefault() && !changed())} @click=${backToDefault}>Voltar ao padrão</button>
          <button class="btn btn--sm" type="button" ?disabled=${!changed()} aria-busy=${state.saving ? "true" : "false"} @click=${() => save()}>Gravar mudanças</button>
        </div>
      </div>`;
  }

  const view = () => html`${equipeNav("permissoes")}
    <p class="notice permissoes__aviso"><b>O dono sempre vê tudo.</b> Exportar, mudar perfil, anonimizar, revogar aparelho e esta tela continuam só do dono, mesmo com a área liberada.</p>
    ${body()}`;

  load();
  return () => {
    gone = true;
    controller.abort();
  };
}
