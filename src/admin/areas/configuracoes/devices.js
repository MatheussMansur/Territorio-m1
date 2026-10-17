// Aparelhos e impressoras: os aparelhos da casa (histórias 1.10 e 1.11 dentro de Configurações).
// Pedidos de pareamento são aprovados com o código mostrado na tela do próprio aparelho, com o seu tipo,
// lugar, perfil e inatividade (5 a 60 min); um aparelho que perdeu a chave é oferecido para
// revogar no mesmo passo. Aparelhos aprovados podem ser renomeados e revogados na hora (com a
// checagem de identidade do painel), e as impressoras chegam com o módulo 3. Só o dono.
import { openDialog } from "../../../components/dialog.js";
import { confirmAction } from "../../../components/confirm.js";
import { toast } from "../../../components/toast.js";
import { describeError, staffErrorMessage } from "../../../lib/errors.js";
import { html, nothing, render } from "../../../lib/html.js";
import * as api from "../../../services/api/staff-configuracoes.js";
import { withIdentity } from "../../identity.js";
import { GROUPS } from "./catalog.js";
import { when } from "./group.js";
import { sideNav } from "./side-nav.js";

const KINDS = { desktop: "Computador", tablet: "Tablet", phone: "Celular" };
const ROLES = { floor: "Recepção", manager: "Gerente" };
const IS_MOCK = import.meta.env?.VITE_API_MODE === "mock";
// o código na tela do aparelho de exemplo da demonstração
const DEMO_CODE = "Q7M2K9XD";

export function mountDevices(container, { user, index }) {
  const group = GROUPS["aparelhos-e-impressoras"];
  const s = { status: "loading", list: [], dialog: null, codes: {} };
  let alive = true;
  let handle = null;

  async function load() {
    s.status = "loading";
    draw();
    try {
      s.list = await api.devices.list();
      s.status = "ready";
    } catch (error) {
      s.status = error?.status === 403 ? "forbidden" : "error";
      s.error = error;
    }
    if (alive) draw();
  }

  // ---- janelas ----
  function open(dialog) {
    s.dialog = dialog;
    draw();
    const el = container.querySelector(".cfg-dialogo");
    handle = openDialog(el, {
      onClose: () => {
        handle = null;
        s.dialog = null;
        draw();
      },
    });
    el.querySelector("[data-foco]")?.focus();
  }

  function close() {
    handle?.close();
  }

  const setD = (patch) => {
    s.dialog = { ...s.dialog, ...patch };
    draw();
  };

  /** Um aparelho aprovado do mesmo lugar (ou o que este pedido substitui): o antigo a revogar. */
  const samePlace = (d) =>
    s.list.find(
      (x) =>
        x.status === "approved" &&
        x.id !== d.device.id &&
        (x.id === d.device.replaces || (String(d.location || "").trim() && x.location?.trim().toLowerCase() === String(d.location).trim().toLowerCase())),
    );

  async function approve(e) {
    e.preventDefault();
    const d = s.dialog;
    if (d.busy) return;
    const idle = Number(d.idle_min);
    if (!Number.isInteger(idle) || idle < 5 || idle > 60) {
      setD({ errors: { idle_min: "A inatividade vai de 5 a 60 min." }, error: "" });
      return container.querySelector("#aparelho-idle_min")?.focus();
    }
    const old = samePlace(d);
    setD({ busy: true, errors: {}, error: "" });
    try {
      let device = await api.devices.approve(d.device.id, { code: d.code, name: d.name, kind: d.kind, location: d.location, role: d.role, idle_min: idle });
      if (device.idle_min !== idle) device = await api.devices.update(device.id, { idle_min: idle }, device.version);
      s.list = s.list.map((x) => (x.id === device.id ? device : x));
      close();
      toast({ title: `${device.name} aprovado`, message: "Na tela do aparelho aparecem os nomes da equipe para entrar com PIN." });
      // o aparelho do mesmo lugar que perdeu a chave vai no mesmo passo
      if (old && d.revokeOld) await revoke(old, { reason: old.key_lost ? "chave perdida" : "trocado por outro aparelho no mesmo local", ask: false });
    } catch (error) {
      if (error?.status === 409) {
        // decidido ou vencido nesse meio-tempo: dizer isso, e mostrar a lista como está agora
        const said = describeError(error, { variant: "device_decided", staff: true });
        setD({ busy: false, error: `${said.title}. ${said.text}` });
        s.list = await api.devices.list().catch(() => s.list);
        return draw();
      }
      setD({ busy: false, errors: error?.fieldErrors || {}, error: error?.status === 422 ? "" : staffErrorMessage(error) });
      container.querySelector(".cfg-dialogo [aria-invalid='true']")?.focus();
    }
  }

  async function rename(e) {
    e.preventDefault();
    const d = s.dialog;
    if (d.busy) return;
    setD({ busy: true, errors: {}, error: "" });
    try {
      const device = await api.devices.update(d.device.id, { name: d.name, location: d.location, kind: d.kind, idle_min: Number(d.idle_min) }, d.device.version);
      s.list = s.list.map((x) => (x.id === device.id ? device : x));
      close();
      toast({ title: "Aparelho atualizado" });
    } catch (error) {
      setD({ busy: false, errors: error?.fieldErrors || {}, error: error?.status === 422 ? "" : staffErrorMessage(error) });
    }
  }

  async function revoke(device, { reason, ask = true } = {}) {
    const pending = device.status === "pending";
    if (ask) {
      const ok = await confirmAction({
        title: pending ? `Recusar ${device.name}?` : `Revogar ${device.name}?`,
        message: pending ? "O pedido some e o aparelho precisa pedir de novo." : "A sessão do aparelho cai na hora. Para usar de novo, ele pede o pareamento outra vez.",
        confirmLabel: pending ? "Recusar o pedido" : "Revogar o aparelho",
        cancelLabel: "Manter",
        danger: true,
      });
      if (!ok) return;
    }
    try {
      const call = () => api.devices.revoke(device.id, reason || (pending ? "pedido recusado" : "revogado pelo dono"));
      // revogar um aparelho aprovado pede a checagem de identidade do painel (FR-74)
      const updated = pending ? await call() : await withIdentity(call, { message: "Revogar um aparelho pede a senha e o código de novo. Vale por 5 minutos." });
      if (!updated) return;
      s.list = s.list.map((x) => (x.id === updated.id ? updated : x));
      draw();
      toast({ title: pending ? "Pedido recusado" : `${device.name} revogado` });
    } catch (error) {
      toast({ kind: "error", title: "Não deu para revogar agora", message: staffErrorMessage(error) });
    }
  }

  async function simulatePairing() {
    try {
      const pairing = await api.devices.requestPairing({
        public_key: { kty: "EC", crv: "P-256", x: "demo", y: "demo" },
        label: "Celular do salão",
        user_agent: navigator.userAgent,
      });
      s.codes[pairing.id] = pairing.code;
      s.list = await api.devices.list();
      draw();
      toast({ title: "Pedido de pareamento chegou", message: `Na tela do aparelho aparece o código ${pairing.code}.` });
    } catch (error) {
      toast({ kind: "error", title: "Não deu para simular o pedido", message: staffErrorMessage(error) });
    }
  }

  // ---- telas ----
  const field = (d, key, label, extra = {}) => html`<div class="field ${d.errors?.[key] ? "field--invalid" : ""}">
    <label class="field__label" for=${`aparelho-${key}`}>${label}</label>
    <input
      id=${`aparelho-${key}`}
      class="field__input"
      ?data-foco=${extra.focus}
      inputmode=${extra.mode || "text"}
      maxlength=${extra.max || 60}
      autocomplete="off"
      .value=${String(d[key] ?? "")}
      aria-invalid=${d.errors?.[key] ? "true" : "false"}
      aria-describedby=${d.errors?.[key] ? `aparelho-${key}-erro` : nothing}
      @input=${(e) => (s.dialog = { ...s.dialog, [key]: extra.upper ? e.target.value.toUpperCase() : e.target.value })}
    />
    ${d.errors?.[key] ? html`<p class="field__error" id=${`aparelho-${key}-erro`}>${d.errors[key]}</p>` : nothing}
  </div>`;

  const kindPick = (d) => html`<div class="field">
    <span class="field__label" id="aparelho-tipo">Tipo</span>
    <div class="cfg-seg" role="radiogroup" aria-labelledby="aparelho-tipo">
      ${Object.entries(KINDS).map(
        ([k, label]) => html`<button type="button" role="radio" class="cfg-seg__opcao" aria-checked=${String(d.kind === k)} tabindex=${d.kind === k ? "0" : "-1"} @click=${() => setD({ kind: k })}>${label}</button>`,
      )}
    </div>
  </div>`;

  function dialogContent() {
    const d = s.dialog;
    if (!d) return nothing;
    const approving = d.mode === "approve";
    return html`<form class="dialog__body cfg-dialogo__corpo" @submit=${approving ? approve : rename} novalidate>
      <h2 id="cfg-dialogo-titulo">${approving ? "Aprovar aparelho" : "Mudar aparelho"}</h2>
      ${approving ? html`<p>Confira o código de 8 letras e números que aparece na tela do aparelho.</p>` : nothing}
      ${approving ? field(d, "code", "Código da tela do aparelho", { focus: true, max: 8, upper: true }) : nothing}
      ${field(d, "name", "Nome", { focus: !approving })} ${field(d, "location", "Onde fica")} ${kindPick(d)}
      ${approving
        ? html`<div class="field">
            <span class="field__label" id="aparelho-perfil">Perfil do aparelho</span>
            <div class="cfg-seg" role="radiogroup" aria-labelledby="aparelho-perfil">
              ${Object.entries(ROLES).map(
                ([k, label]) => html`<button type="button" role="radio" class="cfg-seg__opcao" aria-checked=${String(d.role === k)} tabindex=${d.role === k ? "0" : "-1"} @click=${() => setD({ role: k })}>${label}</button>`,
              )}
            </div>
          </div>`
        : nothing}
      ${field(d, "idle_min", "Inatividade (min)", { mode: "numeric", max: 2 })}
      ${approving ? html`<p class="cfg-ajuda">Sem uso por esse tempo, o aparelho pede o PIN de novo, sem perder a tela. De 5 a 60 min.</p>` : nothing}
      ${approving && samePlace(d)
        ? html`<label class="check">
            <input type="checkbox" .checked=${d.revokeOld} @change=${(e) => (s.dialog = { ...s.dialog, revokeOld: e.target.checked })} />
            <span>Revogar ${samePlace(d).name}${samePlace(d).key_lost ? ", que perdeu a chave" : ", do mesmo local"}, no mesmo passo</span>
          </label>`
        : nothing}
      ${d.error ? html`<p class="cfg-erro" role="alert">${d.error}</p>` : nothing}
      <div class="dialog__actions">
        <button type="button" class="btn btn--outline btn--sm" data-close>Voltar</button>
        <button type="submit" class="btn btn--sm" aria-busy=${String(Boolean(d.busy))} ?disabled=${d.busy}>${d.busy ? "Gravando…" : approving ? "Aprovar" : "Gravar"}</button>
      </div>
    </form>`;
  }

  function deviceRow(d) {
    const pending = d.status === "pending";
    const status = { approved: "aprovado", pending: "pedindo pareamento", revoked: "revogado", rejected: "recusado", expired: "vencido" }[d.status];
    const cls = { approved: "badge--confirmed", pending: "badge--pending", revoked: "badge--canceled", rejected: "badge--declined", expired: "badge--expired" }[d.status];
    const code = s.codes[d.id] || (IS_MOCK && pending && !s.codes[d.id] ? DEMO_CODE : null);
    return html`<li class="cfg-aparelho">
      <div class="cfg-aparelho__info">
        <b>${d.name}</b>
        <span>${KINDS[d.kind] || d.kind}${d.location ? ` · ${d.location}` : ""}${d.role ? ` · ${ROLES[d.role] || "Dono"}` : ""}</span>
        <span class="cfg-ajuda">
          ${d.status === "approved" ? `Aprovado por ${d.approved_by}, ${when(d.approved_at)} · visto ${d.last_seen_at ? when(d.last_seen_at) : "nunca"} · inatividade ${d.idle_min ?? 15} min` : ""}
          ${d.revoked_at ? `Desde ${when(d.revoked_at)}` : ""}
          ${pending && code ? html`Na demonstração, o código na tela dele é <b>${code}</b>.` : ""}
          ${d.key_lost && d.status === "approved" ? html`<b>Perdeu a chave da casa:</b> revogue ao aprovar o pedido novo.` : ""}
        </span>
      </div>
      <span class="badge ${cls}">${status}</span>
      <span class="cfg-aparelho__acoes">
        ${pending
          ? html`<button type="button" class="action action--solid" @click=${() => open({ mode: "approve", device: d, code: "", name: d.name, location: d.location || s.list.find((x) => x.id === d.replaces)?.location || "", kind: d.kind || "tablet", role: "floor", idle_min: 15, revokeOld: true, errors: {} })}>Aprovar</button>
              <button type="button" class="action" @click=${() => revoke(d)}>Recusar</button>`
          : nothing}
        ${d.status === "approved"
          ? html`<button type="button" class="action" @click=${() => open({ mode: "rename", device: d, name: d.name, location: d.location, kind: d.kind, idle_min: d.idle_min ?? 15, errors: {} })}>Mudar</button>
              <button type="button" class="action action--alert" @click=${() => revoke(d)}>Revogar</button>`
          : nothing}
      </span>
    </li>`;
  }

  function body() {
    if (s.status === "loading") return html`<div class="area__vazio" role="status"><span class="raiz raiz--gira" aria-hidden="true"></span><p>Abrindo os aparelhos…</p></div>`;
    if (s.status === "forbidden") return html`<div class="area__vazio" role="alert"><span class="raiz raiz--atencao" aria-hidden="true"></span><p><b>Essa parte é só do dono.</b></p></div>`;
    if (s.status === "error") {
      return html`<div class="area__vazio" role="alert">
        <span class="raiz raiz--atencao" aria-hidden="true"></span>
        <p><b>Não deu para abrir os aparelhos.</b> ${staffErrorMessage(s.error)}</p>
        <button class="btn" type="button" @click=${load}>Tentar de novo</button>
      </div>`;
    }
    const pending = s.list.filter((d) => d.status === "pending");
    const approved = s.list.filter((d) => d.status === "approved");
    const old = s.list.filter((d) => !["pending", "approved"].includes(d.status));
    return html`
      ${IS_MOCK
        ? html`<p class="cfg-aviso" role="note">
            Demonstração: um aparelho novo pede o pareamento na tela dele.
            <button type="button" class="link-button" @click=${simulatePairing}>Simular um pedido de aparelho novo</button>
          </p>`
        : nothing}
      ${!s.list.length
        ? html`<div class="empty">
            <b>Nenhum aparelho ainda</b>
            <p>No computador ou tablet da recepção, abra o painel e toque “Usar este aparelho na casa”. O pedido aparece aqui para você aprovar.</p>
          </div>`
        : nothing}
      ${pending.length
        ? html`<fieldset class="cfg-bloco"><legend class="cfg-bloco__titulo">Pedidos de pareamento</legend><ul class="cfg-aparelhos">${pending.map(deviceRow)}</ul></fieldset>`
        : nothing}
      ${approved.length ? html`<fieldset class="cfg-bloco"><legend class="cfg-bloco__titulo">Aparelhos da casa</legend><ul class="cfg-aparelhos">${approved.map(deviceRow)}</ul></fieldset>` : nothing}
      ${old.length ? html`<fieldset class="cfg-bloco"><legend class="cfg-bloco__titulo">Revogados e recusados</legend><ul class="cfg-aparelhos">${old.map(deviceRow)}</ul></fieldset>` : nothing}
      <fieldset class="cfg-bloco">
        <legend class="cfg-bloco__titulo">Impressoras</legend>
        <div class="cfg-linha cfg-linha--travada">
          <div class="cfg-linha__rot">
            <span class="cfg-linha__rotulo">Impressoras e roteamento<span class="sr-only">, travado, módulo 3</span></span>
            <p class="cfg-ajuda">Praças, largura do papel, impressora reserva e o que vai para cada uma.</p>
          </div>
          <span class="cfg-modulo" aria-hidden="true">Módulo 3</span>
        </div>
      </fieldset>`;
  }

  function draw() {
    if (!alive) return;
    render(
      html`<div class="cfg cfg--grupo">
        ${sideNav(index, "aparelhos-e-impressoras", user)}
        <section class="cfg-grupo" aria-labelledby="cfg-grupo-titulo">
          <a class="cfg-voltar" href="/admin/configuracoes">‹ Todas as configurações</a>
          <p class="cfg-trilha">Configurações / A casa</p>
          <h2 class="cfg-grupo__titulo" id="cfg-grupo-titulo" tabindex="-1">${group.label}</h2>
          <p class="cfg-grupo__intro">${group.intro}</p>
          ${body()}
        </section>
        <dialog class="dialog dialog--confirm cfg-dialogo" aria-labelledby="cfg-dialogo-titulo">${dialogContent()}</dialog>
      </div>`,
      container,
    );
  }

  load();
  return () => {
    alive = false;
    handle?.close();
  };
}
