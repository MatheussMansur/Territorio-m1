// A única checagem de identidade do painel (história 1.7, FR-74, AR-17) e a entrada sobre a tela.
//
// confirmIdentity(): a senha E o código de 6 dígitos de novo antes de uma ação sensível (exportar,
// telefone completo, troca de perfil, anonimizar, revogar um aparelho, os ajustes marcados, permissões). A
// API confere os dois (POST /staff/auth/reauth) e abre uma janela de 5 minutos para as próximas.
// ensureIdentity() pula a janela de diálogo dentro desse prazo; withIdentity(call) também responde ao
// reauth_required do servidor (403, nunca 401) pedindo de novo e repetindo a chamada com o que
// a pessoa tinha escolhido.
//
// signInAgain(): quando a sessão acaba no meio (401), a entrada abre sobre a tela atual;
// depois dela, a chamada que falhou vai de novo (src/services/api/client.js), então nada do
// que foi digitado se perde. O main.js liga isso a toda chamada do painel.
import { openDialog } from "../components/dialog.js";
import { otpInput } from "../components/otp.js";
import { describeError } from "../lib/errors.js";
import { html, nothing, render } from "../lib/html.js";
import { session } from "../lib/storage.js";
import * as auth from "../services/api/staff-auth.js";
import { mountLogin } from "./auth/entrada.js";

const FRESH_KEY = "territorio:painel-identidade";
const WINDOW_MS = 5 * 60_000;
const IS_MOCK = import.meta.env?.VITE_API_MODE === "mock";

/** Se a pessoa confirmou quem é nos últimos 5 minutos. */
export const identityFresh = () => Date.now() - Number(session.get(FRESH_KEY, 0)) < WINDOW_MS;

/** Esquece a janela (no "Sair", ou quando o servidor diz que acabou). */
export const forgetIdentity = () => session.remove(FRESH_KEY);

let seq = 0;
let asking = null;

/**
 * Pede a senha e o código, conferidos pela API. Resolve { password, code } quando
 * batem, ou null quando a pessoa desiste. Só uma janela por vez: uma segunda chamada com ela
 * aberta recebe a mesma resposta.
 */
export function confirmIdentity({ title = "Confirme que é você", message = "Essa ação pede a senha e o código de novo. Vale por 5 minutos.", confirmLabel = "Confirmar" } = {}) {
  if (asking) return asking;
  asking = new Promise((resolve) => {
    const id = `identidade-${++seq}`;
    const dialog = document.createElement("dialog");
    dialog.className = "dialog dialog--confirm identidade";
    dialog.setAttribute("aria-labelledby", `${id}-titulo`);
    dialog.setAttribute("aria-describedby", `${id}-texto`);
    document.body.append(dialog);
    const s = { busy: false, errors: {}, problem: null, password: "" };
    let answer = null;
    let otp = null;

    async function submit(event) {
      event.preventDefault();
      if (s.busy) return;
      const code = otp?.value || "";
      const errors = {};
      if (!s.password) errors.password = "Digite a sua senha.";
      if (!/^\d{6}$/.test(code)) errors.code = "Digite os 6 números do aplicativo de códigos.";
      if (Object.keys(errors).length) {
        Object.assign(s, { errors, problem: null });
        draw();
        return dialog.querySelector(errors.password ? "input[name=password]" : "input[name=code]")?.focus();
      }
      Object.assign(s, { busy: true, errors: {}, problem: null });
      draw();
      try {
        await auth.reauth({ password: s.password, code });
        session.set(FRESH_KEY, Date.now());
        answer = { password: s.password, code };
        dialog.close();
      } catch (error) {
        s.busy = false;
        if (error?.status === 401 || error?.status === 422) {
          const fields = Object.fromEntries((error.errors || []).map((e) => [e.field, e.message]));
          s.errors = Object.keys(fields).length ? fields : { password: "Senha ou código não conferem." };
          otp?.clear();
          if (s.errors.password) s.password = "";
        } else {
          s.problem = describeError(error);
        }
        draw();
        dialog.querySelector(s.errors.password ? "input[name=password]" : "input[name=code]")?.focus();
      }
    }

    const fieldError = (name) => (s.errors[name] ? html`<p class="field__error" id=${`${id}-${name}-erro`}>${s.errors[name]}</p>` : nothing);

    function draw() {
      render(
        html`<form class="dialog__body" novalidate @submit=${submit}>
          <h2 id=${`${id}-titulo`}>${title}</h2>
          <p id=${`${id}-texto`}>${message}</p>
          <div class="field ${s.errors.password ? "field--invalid" : ""}">
            <label class="field__label" for=${`${id}-senha`}>Senha</label>
            <input
              class="field__input"
              id=${`${id}-senha`}
              name="password"
              type="password"
              autocomplete="current-password"
              .value=${s.password}
              aria-invalid=${s.errors.password ? "true" : "false"}
              aria-describedby=${s.errors.password ? `${id}-password-erro` : nothing}
              @input=${(e) => (s.password = e.target.value)}
            />
            ${fieldError("password")}
          </div>
          <div class="field ${s.errors.code ? "field--invalid" : ""}">
            <label class="field__label" for=${`${id}-codigo`}>Código do aplicativo</label>
            <div class="otp ${s.errors.code ? "otp--invalid" : ""}">
              <input
                class="otp__input"
                id=${`${id}-codigo`}
                name="code"
                inputmode="numeric"
                autocomplete="one-time-code"
                aria-invalid=${s.errors.code ? "true" : "false"}
                aria-describedby=${s.errors.code ? `${id}-code-erro` : IS_MOCK ? `${id}-dica` : nothing}
              />
              <div class="otp__boxes" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span></div>
            </div>
            ${fieldError("code")}
          </div>
          ${s.problem ? html`<p class="notice notice--alert" role="alert"><b>${s.problem.title}.</b> ${s.problem.text}</p>` : nothing}
          ${IS_MOCK ? html`<p class="identidade__dica" id=${`${id}-dica`}>Na demonstração: senha <b>admin</b> e código <b>123456</b>.</p>` : nothing}
          <div class="dialog__actions">
            <button type="button" class="btn btn--outline btn--sm" data-close>Voltar</button>
            <button type="submit" class="btn btn--sm" aria-busy=${String(s.busy)} ?disabled=${s.busy}>${s.busy ? "Conferindo…" : confirmLabel}</button>
          </div>
        </form>`,
        dialog,
      );
      const box = dialog.querySelector(".otp");
      if (box && !box.dataset.on) {
        box.dataset.on = "1";
        otp = otpInput(box);
      }
    }

    draw();
    openDialog(dialog, {
      onClose: () => {
        dialog.remove();
        asking = null;
        resolve(answer);
      },
    });
    dialog.querySelector("input[name=password]").focus();
  });
  return asking;
}

/** True quando a identidade está em dia, ou depois que a pessoa confirma; false quando desiste. */
export async function ensureIdentity(options) {
  if (identityFresh()) return true;
  return Boolean(await confirmIdentity(options));
}

/**
 * Faz uma chamada sensível: pede a identidade quando precisa e, quando o servidor responde
 * reauth_required (os 5 minutos dele acabaram antes), pede de novo e repete a mesma chamada.
 * Resolve com o resultado da chamada, ou null quando a pessoa desistiu.
 */
export async function withIdentity(call, options) {
  if (!(await ensureIdentity(options))) return null;
  try {
    return await call();
  } catch (error) {
    if (error?.type !== "reauth_required") throw error;
    forgetIdentity();
    if (!(await confirmIdentity(options))) return null;
    return call();
  }
}

let signing = null;

/**
 * A entrada sobre a tela atual depois que a sessão acabou. Resolve a nova sessão, ou
 * null quando a pessoa escolheu sair. Uma por vez: chamadas que falham juntas esperam por ela.
 */
export function signInAgain({ email = "" } = {}) {
  if (signing) return signing;
  signing = new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "dialog dialog--confirm entrar-de-novo";
    dialog.setAttribute("aria-labelledby", "entrar-de-novo-titulo");
    document.body.append(dialog);
    const body = document.createElement("div");
    body.className = "dialog__body";
    dialog.append(body);
    let answer = null;
    const cleanup = mountLogin(body, {
      email,
      again: true,
      onSignedIn: (opened) => {
        answer = opened;
        dialog.close();
      },
      onGiveUp: () => dialog.close(),
      titleId: "entrar-de-novo-titulo",
    });
    openDialog(dialog, {
      onClose: () => {
        cleanup();
        dialog.remove();
        signing = null;
        resolve(answer);
      },
    });
    body.querySelector(email ? "input[name=password]" : "input[name=email]")?.focus();
  });
  return signing;
}
