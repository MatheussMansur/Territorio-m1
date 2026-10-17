// Os links de uso único da entrada: o primeiro acesso do dono (e o link de recuperação, que
// só refaz senha e autenticador), o convite da equipe (histórias 1.6 e 1.9), e
// "Esqueci a senha" com o link de senha nova (história 1.8). Um link usado, vencido ou substituído
// abre como gone.setup, gone.invite ou gone.reset, nunca como erro cru.
import { describeError } from "../../lib/errors.js";
import { html, nothing, render } from "../../lib/html.js";
import * as auth from "../../services/api/staff-auth.js";
import { ENTRY } from "../nav.js";
import { demoHint, field, fieldErrorsOf, notice, passwordField, problemPage } from "./comum.js";
import { mountTotp } from "./totp.js";

const ROLE = { owner: "dono", manager: "gerente", floor: "recepção" };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const GONE = { setup: "setup", invite: "invite", reset: "reset" };

const loading = (text) => html`<section class="entrada__caixa"><div class="entrada__carregando" role="status"><span class="raiz raiz--gira" aria-hidden="true"></span><p>${text}</p></div></section>`;

function passwordRules(s) {
  const errors = {};
  if (s.password.length < 12) errors.password = "Use 12 caracteres ou mais. Uma frase curta é fácil de lembrar.";
  else if (s.password !== s.repeat) errors.repeat = "As duas senhas não estão iguais.";
  return errors;
}

/**
 * Primeiro acesso do dono (tipo "setup") ou o convite da equipe (tipo "invite"): o link,
 * o nome e a senha, depois o autenticador, depois o painel.
 * @param {HTMLElement} container
 * @param {{kind: "setup"|"invite", token: string, onDone: () => void}} options
 */
export function mountLink(container, { kind, token, onDone }) {
  const s = { step: "loading", info: null, name: "", password: "", repeat: "", shown: false, errors: {}, problem: null, busy: false };
  let alive = true;
  let inner = null;

  const set = (patch) => {
    Object.assign(s, patch);
    draw();
  };

  async function load() {
    try {
      const info = await auth.token(token);
      if (!alive) return;
      const right = (kind === "setup" && info.kind === "owner_setup") || (kind === "invite" && info.kind === "invite");
      set(right && info.valid ? { step: "form", info, name: info.name || "" } : { step: "gone" });
    } catch (error) {
      if (!alive) return;
      set(error?.status === 404 ? { step: "gone" } : { step: "error", problem: error });
    }
    requestAnimationFrame(() => container.querySelector(".entrada__titulo")?.focus());
  }

  async function submit(event) {
    event.preventDefault();
    if (s.busy) return;
    const errors = passwordRules(s);
    if (s.name.trim().length < 2) errors.name = "Escreva o seu nome.";
    if (Object.keys(errors).length) {
      set({ errors, problem: null });
      return container.querySelector("[aria-invalid='true']")?.focus();
    }
    set({ busy: true, errors: {}, problem: null });
    try {
      if (kind === "setup") await auth.setup({ token, name: s.name.trim(), email: s.info.email, password: s.password });
      else await auth.acceptInvite({ token, name: s.name.trim(), password: s.password });
      if (!alive) return;
      // a sessão está aberta: agora, o autenticador
      set({ step: "totp", busy: false });
    } catch (error) {
      if (!alive) return;
      if (error?.status === 410) return set({ step: "gone", busy: false });
      const errors = fieldErrorsOf(error);
      set({ busy: false, errors, problem: Object.keys(errors).length ? null : error });
      container.querySelector("[aria-invalid='true']")?.focus();
    }
  }

  function form() {
    const setup = kind === "setup";
    const recovery = s.info?.recovery;
    const title = setup ? (recovery ? "Refazer a senha e a verificação" : "Primeiro acesso do dono") : "Entrar para a equipe";
    const intro = setup
      ? recovery
        ? "Este link troca a sua senha e a verificação em duas etapas e encerra as suas outras sessões."
        : "Crie a sua senha. Depois, ligue a verificação em duas etapas com o celular."
      : `${s.info?.invited_by || "O dono"} convidou você como ${ROLE[s.info?.role] || "equipe"}. Crie a sua senha; depois, ligue a verificação em duas etapas.`;
    return html`<section class="entrada__caixa" aria-labelledby="link-titulo">
      <h1 class="entrada__titulo" id="link-titulo" tabindex="-1">${title}</h1>
      <p class="entrada__texto">${intro}</p>
      <form class="entrada__form" novalidate @submit=${submit}>
        ${field({ id: "link-email", label: "E-mail", name: "email", type: "email", value: s.info?.email || "", readonly: true, required: false, autocomplete: "username" })}
        ${field({ id: "link-nome", label: "Seu nome", name: "name", value: s.name, error: s.errors.name, autocomplete: "name", maxlength: 60, onInput: (v) => (s.name = v) })}
        ${passwordField({
          id: "link-senha",
          label: "Crie uma senha",
          value: s.password,
          error: s.errors.password,
          help: "12 caracteres ou mais, e uma que você não use em outro site. Uma frase curta é fácil de lembrar.",
          autocomplete: "new-password",
          shown: s.shown,
          onToggle: () => set({ shown: !s.shown }),
          onInput: (v) => (s.password = v),
        })}
        ${field({ id: "link-repetir", label: "Repita a senha", name: "repeat", type: s.shown ? "text" : "password", value: s.repeat, error: s.errors.repeat, autocomplete: "new-password", onInput: (v) => (s.repeat = v) })}
        ${s.problem ? notice({ title: describeError(s.problem).title, text: describeError(s.problem).text }) : nothing}
        <button class="btn entrada__enviar" type="submit" aria-busy=${String(s.busy)} ?disabled=${s.busy}>${s.busy ? "Gravando…" : "Continuar"}</button>
      </form>
      ${demoHint("senhas que aparecem em vazamentos, como territorio123, são recusadas.")}
    </section>`;
  }

  function draw() {
    if (!alive) return;
    if (s.step === "totp") {
      if (!inner) {
        render(nothing, container);
        inner = mountTotp(container, { onDone });
      }
      return;
    }
    if (s.step === "loading") return render(loading("Conferindo o link…"), container);
    if (s.step === "gone") return render(problemPage({ type: "gone" }, { variant: GONE[kind] }), container);
    if (s.step === "error") {
      const d = describeError(s.problem);
      return render(html`<section class="entrada__caixa" aria-labelledby="link-titulo"><h1 class="entrada__titulo" id="link-titulo" tabindex="-1">Não deu para abrir o link</h1>${notice({ title: d.title, text: d.text, action: "Tentar de novo", onAction: () => set({ step: "loading" }) || load() })}</section>`, container);
    }
    render(form(), container);
  }

  draw();
  load();
  return () => {
    alive = false;
    inner?.();
  };
}

/** "Esqueci a senha": sempre a mesma resposta; o link dura 30 minutos e funciona uma vez. */
export function mountForgot(container) {
  const s = { email: "", error: "", busy: false, sent: false, problem: null };
  let alive = true;
  const set = (patch) => {
    Object.assign(s, patch);
    draw();
  };

  async function submit(event) {
    event.preventDefault();
    if (s.busy) return;
    if (!EMAIL.test(s.email.trim())) {
      set({ error: "Confira o e-mail: falta o @ ou o final." });
      return container.querySelector("#esqueci-email")?.focus();
    }
    set({ busy: true, error: "", problem: null });
    try {
      await auth.forgot(s.email.trim());
      if (!alive) return;
      set({ busy: false, sent: true });
      requestAnimationFrame(() => container.querySelector(".entrada__titulo")?.focus());
    } catch (error) {
      if (alive) set({ busy: false, problem: error });
    }
  }

  function draw() {
    if (!alive) return;
    if (s.sent) {
      return render(
        html`<section class="entrada__caixa" aria-labelledby="esqueci-titulo">
          <h1 class="entrada__titulo" id="esqueci-titulo" tabindex="-1">Confira o seu e-mail</h1>
          <p class="entrada__texto">Se esse e-mail for da equipe, o link para criar uma senha nova chega em instantes. Ele vale 30 minutos e uma vez só. Pedir outro faz o anterior parar de funcionar.</p>
          <div class="entrada__links"><a class="link-button" href=${ENTRY}>Voltar à entrada</a></div>
          ${demoHint("o e-mail não sai na demonstração: o link aparece na barra de demonstração, em Entrada.")}
        </section>`,
        container,
      );
    }
    const d = s.problem && describeError(s.problem);
    render(
      html`<section class="entrada__caixa" aria-labelledby="esqueci-titulo">
        <h1 class="entrada__titulo" id="esqueci-titulo" tabindex="-1">Esqueci a senha</h1>
        <p class="entrada__texto">Diga o e-mail com que você entra no painel. Mandamos um link para criar uma senha nova.</p>
        <form class="entrada__form" novalidate @submit=${submit}>
          ${field({ id: "esqueci-email", label: "E-mail", name: "email", type: "email", value: s.email, error: s.error, autocomplete: "username", inputmode: "email", onInput: (v) => (s.email = v) })}
          ${d ? notice({ title: d.title, text: d.text }) : nothing}
          <button class="btn entrada__enviar" type="submit" aria-busy=${String(s.busy)} ?disabled=${s.busy}>${s.busy ? "Enviando…" : "Mandar o link"}</button>
        </form>
        <div class="entrada__links"><a class="link-button" href=${ENTRY}>Voltar à entrada</a></div>
      </section>`,
      container,
    );
  }

  draw();
  return () => {
    alive = false;
  };
}

/** O link de senha nova: 30 minutos, uma vez, e só o mais novo pedido. */
export function mountReset(container, { token }) {
  const s = { step: "loading", password: "", repeat: "", shown: false, errors: {}, busy: false, problem: null };
  let alive = true;
  const set = (patch) => {
    Object.assign(s, patch);
    draw();
  };

  async function load() {
    try {
      const info = await auth.token(token);
      if (alive) set({ step: info.kind === "reset" && info.valid ? "form" : "gone" });
    } catch (error) {
      if (alive) set({ step: error?.status === 404 ? "gone" : "form", problem: error?.status === 404 ? null : error });
    }
    requestAnimationFrame(() => container.querySelector(".entrada__titulo")?.focus());
  }

  async function submit(event) {
    event.preventDefault();
    if (s.busy) return;
    const errors = passwordRules(s);
    if (Object.keys(errors).length) {
      set({ errors });
      return container.querySelector("[aria-invalid='true']")?.focus();
    }
    set({ busy: true, errors: {}, problem: null });
    try {
      await auth.reset({ token, password: s.password });
      if (!alive) return;
      set({ step: "done", busy: false });
      requestAnimationFrame(() => container.querySelector(".entrada__titulo")?.focus());
    } catch (error) {
      if (!alive) return;
      if (error?.status === 410 || error?.status === 404) return set({ step: "gone", busy: false });
      const fields = fieldErrorsOf(error);
      set({ busy: false, errors: fields, problem: Object.keys(fields).length ? null : error });
    }
  }

  function draw() {
    if (!alive) return;
    if (s.step === "loading") return render(loading("Conferindo o link…"), container);
    if (s.step === "gone") {
      return render(problemPage({ type: "gone" }, { variant: "reset", actions: html`<a class="btn" href=${`${ENTRY}/esqueci`}>Pedir outro link</a>` }), container);
    }
    if (s.step === "done") {
      return render(
        html`<section class="entrada__caixa" aria-labelledby="nova-titulo">
          <h1 class="entrada__titulo" id="nova-titulo" tabindex="-1">Senha trocada</h1>
          <p class="entrada__texto">As outras sessões abertas com a senha antiga foram encerradas. Entre com a senha nova.</p>
          <a class="btn entrada__enviar" href=${ENTRY}>Entrar</a>
        </section>`,
        container,
      );
    }
    const d = s.problem && describeError(s.problem);
    render(
      html`<section class="entrada__caixa" aria-labelledby="nova-titulo">
        <h1 class="entrada__titulo" id="nova-titulo" tabindex="-1">Criar uma senha nova</h1>
        <form class="entrada__form" novalidate @submit=${submit}>
          ${passwordField({
            id: "nova-senha",
            label: "Senha nova",
            value: s.password,
            error: s.errors.password,
            help: "12 caracteres ou mais, e uma que você não use em outro site.",
            autocomplete: "new-password",
            shown: s.shown,
            onToggle: () => set({ shown: !s.shown }),
            onInput: (v) => (s.password = v),
          })}
          ${field({ id: "nova-repetir", label: "Repita a senha", name: "repeat", type: s.shown ? "text" : "password", value: s.repeat, error: s.errors.repeat, autocomplete: "new-password", onInput: (v) => (s.repeat = v) })}
          ${d ? notice({ title: d.title, text: d.text }) : nothing}
          <button class="btn entrada__enviar" type="submit" aria-busy=${String(s.busy)} ?disabled=${s.busy}>${s.busy ? "Gravando…" : "Trocar a senha"}</button>
        </form>
      </section>`,
      container,
    );
  }

  draw();
  load();
  return () => {
    alive = false;
  };
}
