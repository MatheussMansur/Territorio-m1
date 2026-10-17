// História 1.6: a equipe entra com e-mail e senha (e a checagem do Turnstile), depois o
// código de 6 dígitos do autenticador ou um código de recuperação, que vale uma vez. "Manter conectado neste
// aparelho" mantém a sessão por 30 dias; sem isso, até o navegador fechar. E-mail errado
// e senha errada dão a mesma mensagem; conta desativada só aparece depois da senha certa.
// O mesmo formulário entra de novo sobre a tela quando a sessão acaba no meio (identity.js).
import { otpInput } from "../../components/otp.js";
import { describeError } from "../../lib/errors.js";
import { html, nothing, render } from "../../lib/html.js";
import * as auth from "../../services/api/staff-auth.js";
import { ENTRY, PAIRING } from "../nav.js";
import { demoHint, field, notice, passwordField, problemPage } from "./comum.js";
import { mountTurnstile } from "./turnstile.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RECOVERY = /^[A-Z0-9]{4}-?[A-Z0-9]{4}$/i;
let seq = 0;

/**
 * @param {HTMLElement} container
 * @param {{onSignedIn: (session: any) => void, email?: string, again?: boolean, paired?: boolean, onPin?: () => void, onGiveUp?: () => void}} options
 *   again: a entrada sobre a tela depois que a sessão acabou (sem links para fora, "Sair do painel").
 */
export function mountLogin(container, { onSignedIn, email = "", again = false, paired = false, onPin, onGiveUp, titleId }) {
  const id = `entrada-${++seq}`;
  const headingId = titleId || `${id}-titulo`;
  const s = {
    step: "password",
    email,
    password: "",
    remember: false,
    shown: false,
    token: null,
    check: "loading", // o Turnstile: carregando, pronto, indisponível
    busy: false,
    errors: {},
    problem: null,
    disabled: false,
    challenge: null,
    recovery: false,
    recoveryCode: "",
  };
  let alive = true;
  let widget = null;
  let otp = null;

  const set = (patch) => {
    Object.assign(s, patch);
    draw();
  };
  const focus = (selector) => requestAnimationFrame(() => container.querySelector(selector)?.focus());

  function mountCheck() {
    const host = container.querySelector(".turnstile");
    if (!host || host.dataset.on) return;
    host.dataset.on = "1";
    widget?.remove();
    widget = mountTurnstile(host, {
      onToken: (token) => alive && set({ token, check: token ? "ready" : s.check === "unavailable" ? "unavailable" : "loading" }),
      onUnavailable: () => alive && set({ check: "unavailable" }),
    });
  }

  async function submitPassword(event) {
    event.preventDefault();
    if (s.busy) return;
    const errors = {};
    // na demonstração, "admin" vale pelo e-mail do dono
    const demoLogin = import.meta.env.VITE_API_MODE === "mock" && s.email.trim().toLowerCase() === "admin";
    if (!demoLogin && !EMAIL.test(s.email.trim())) errors.email = "Confira o e-mail: falta o @ ou o final.";
    if (!s.password) errors.password = "Digite a sua senha.";
    if (Object.keys(errors).length) {
      set({ errors, problem: null });
      return focus(errors.email ? `#${id}-email` : `#${id}-senha`);
    }
    set({ busy: true, errors: {}, problem: null });
    try {
      const answer = await auth.login({ email: s.email.trim(), password: s.password, remember: s.remember, turnstileToken: s.token });
      if (!alive) return;
      if (answer?.mfa_required) {
        set({ busy: false, step: "code", challenge: answer.challenge_id, recovery: false });
        return focus(`#${id}-codigo`);
      }
      onSignedIn(answer);
    } catch (error) {
      if (!alive) return;
      widget?.reset(); // um token só se usa uma vez
      if (error?.type === "account_disabled") return set({ busy: false, disabled: true });
      // a recepção entra no aparelho da casa (forbidden.login): as palavras do catálogo, nunca as do servidor
      const variant = error?.status === 401 || ["rate_limited", "forbidden"].includes(error?.type) ? "login" : undefined;
      const problem = { ...describeError(error, { variant }), retry: error?.type === "turnstile_failed" };
      set({ busy: false, password: "", problem });
      focus(`#${id}-senha`);
    }
  }

  async function submitCode(event) {
    event.preventDefault();
    if (s.busy) return;
    const code = otp?.value || "";
    const recoveryCode = s.recoveryCode.trim().toUpperCase();
    if (s.recovery ? !RECOVERY.test(recoveryCode) : !/^\d{6}$/.test(code)) {
      set({ errors: s.recovery ? { recovery: "O código de recuperação tem 8 letras e números, como ABCD-2345." } : { code: "Digite os 6 números do aplicativo de códigos." } });
      return focus(s.recovery ? `#${id}-recuperacao` : `#${id}-codigo`);
    }
    set({ busy: true, errors: {}, problem: null });
    try {
      const session = await auth.mfa(s.recovery ? { challengeId: s.challenge, recoveryCode } : { challengeId: s.challenge, code });
      if (alive) onSignedIn(session);
    } catch (error) {
      if (!alive) return;
      if (error?.type === "session_expired") {
        set({ busy: false, step: "password", password: "", problem: { title: "Entre de novo", text: "O tempo para digitar o código passou. Digite a senha de novo." } });
        return focus(`#${id}-senha`);
      }
      const d = describeError(error, { variant: error?.status === 401 ? "mfa" : undefined });
      set({ busy: false, errors: s.recovery ? { recovery: `${d.title}. ${d.text}` } : { code: `${d.title}. ${d.text}` } });
      otp?.clear();
      focus(s.recovery ? `#${id}-recuperacao` : `#${id}-codigo`);
    }
  }

  const checkView = () => html`<div class="entrada__checagem">
    <div class="turnstile" role="group" aria-label="Checagem contra robôs"></div>
    ${s.check === "unavailable" ? html`<p class="field__help">A checagem contra robôs não carregou. Dá para tentar entrar mesmo assim.</p>` : nothing}
  </div>`;

  function passwordStep() {
    return html`<form class="entrada__form" novalidate @submit=${submitPassword}>
      ${field({ id: `${id}-email`, label: "E-mail", name: "email", type: "email", value: s.email, error: s.errors.email, autocomplete: "username", inputmode: "email", onInput: (v) => (s.email = v) })}
      ${passwordField({ id: `${id}-senha`, value: s.password, error: s.errors.password, shown: s.shown, onToggle: () => set({ shown: !s.shown }), onInput: (v) => (s.password = v) })}
      ${again
        ? nothing
        : html`<label class="check entrada__manter">
            <input type="checkbox" name="remember" .checked=${s.remember} @change=${(e) => (s.remember = e.target.checked)} />
            <span>Manter conectado neste aparelho <small>por 30 dias. Sem marcar, sai quando fechar o navegador.</small></span>
          </label>`}
      ${checkView()}
      ${s.problem
        ? notice({
            title: s.problem.title,
            text: s.problem.text,
            action: s.problem.retry ? "Tentar de novo" : null,
            onAction: () => {
              widget?.reset();
              set({ problem: null });
            },
          })
        : nothing}
      <button class="btn entrada__enviar" type="submit" aria-busy=${String(s.busy)} ?disabled=${s.busy || (s.check === "loading" && !s.token)}>
        ${s.busy ? "Conferindo…" : s.check === "loading" && !s.token ? "Conferindo o navegador…" : "Entrar"}
      </button>
    </form>`;
  }

  function codeStep() {
    return html`<form class="entrada__form" novalidate @submit=${submitCode}>
      <p class="entrada__texto">${s.recovery ? "Digite um dos códigos de recuperação que você guardou. Cada um vale uma vez só." : "Abra o aplicativo de códigos e digite os 6 números que aparecem agora."}</p>
      ${s.recovery
        ? field({ id: `${id}-recuperacao`, label: "Código de recuperação", name: "recovery_code", value: s.recoveryCode, error: s.errors.recovery, maxlength: 9, onInput: (v) => (s.recoveryCode = v) })
        : html`<div class="field ${s.errors.code ? "field--invalid" : ""}">
            <label class="field__label" for=${`${id}-codigo`}>Código do aplicativo</label>
            <div class="otp ${s.errors.code ? "otp--invalid" : ""}">
              <input class="otp__input" id=${`${id}-codigo`} name="code" inputmode="numeric" autocomplete="one-time-code" aria-invalid=${s.errors.code ? "true" : "false"} aria-describedby=${s.errors.code ? `${id}-codigo-erro` : nothing} />
              <div class="otp__boxes" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span></div>
            </div>
            ${s.errors.code ? html`<p class="field__error" id=${`${id}-codigo-erro`}>${s.errors.code}</p>` : nothing}
          </div>`}
      <button class="btn entrada__enviar" type="submit" aria-busy=${String(s.busy)} ?disabled=${s.busy}>${s.busy ? "Conferindo…" : "Entrar"}</button>
      <div class="entrada__links">
        <button class="link-button" type="button" @click=${() => {
          set({ recovery: !s.recovery, errors: {} });
          focus(s.recovery ? `#${id}-recuperacao` : `#${id}-codigo`);
        }}>${s.recovery ? "Usar o código do aplicativo" : "Usar um código de recuperação"}</button>
        <button class="link-button" type="button" @click=${() => {
          set({ step: "password", password: "", errors: {}, problem: null });
          focus(`#${id}-senha`);
        }}>Voltar</button>
      </div>
    </form>`;
  }

  function view() {
    if (s.disabled) {
      return problemPage("account_disabled", {
        headingId,
        actions: html`<button class="link-button" type="button" @click=${() => set({ disabled: false, password: "" })}>Entrar com outra conta</button>`,
      });
    }
    const title = again ? "Você saiu do painel" : s.step === "code" ? "Verificação em duas etapas" : "Entrar no painel";
    const intro = again ? "Entre de novo para continuar. A tela continua onde estava." : s.step === "code" ? "" : "Para o dono e a gerência. A recepção entra pelo aparelho da casa, tocando o nome e o PIN.";
    return html`<section class="entrada__caixa ${again ? "entrada__caixa--janela" : ""}" aria-labelledby=${headingId}>
      ${again ? html`<h2 class="entrada__titulo" id=${headingId}>${title}</h2>` : html`<h1 class="entrada__titulo" id=${headingId} tabindex="-1">${title}</h1>`}
      ${intro ? html`<p class="entrada__texto">${intro}</p>` : nothing}
      ${s.step === "code" ? codeStep() : passwordStep()}
      ${again
        ? html`<div class="entrada__links"><button class="link-button" type="button" @click=${() => onGiveUp?.()}>Sair do painel</button></div>`
        : s.step === "password"
          ? html`<div class="entrada__links">
              <a class="link-button" href=${`${ENTRY}/esqueci`}>Esqueci a senha</a>
              ${paired
                ? html`<button class="link-button" type="button" @click=${() => onPin?.()}>Entrar com o PIN</button>`
                : html`<a class="link-button" href=${PAIRING}>Usar este aparelho na casa</a>`}
            </div>`
          : nothing}
      ${demoHint(html`entre com <b>admin</b> e a senha <b>admin</b> (dono, sem código). Também valem <b>marcus@territorio.test</b> ou <b>gerente@territorio.test</b>, senha <b>admin</b> e código <b>123456</b>.${again ? "" : html` Para pular a entrada, use <b>?papel=dono</b> no endereço.`}`)}
    </section>`;
  }

  function draw() {
    if (!alive) return;
    render(view(), container);
    mountCheck();
    const box = container.querySelector(".otp");
    if (box && !box.dataset.on) {
      box.dataset.on = "1";
      otp = otpInput(box);
    }
  }

  draw();
  return () => {
    alive = false;
    widget?.remove();
  };
}
