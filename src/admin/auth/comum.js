// Peças comuns às telas da entrada: a raiz e o letreiro, um campo com o erro
// ligado a ele, o campo de senha com "Mostrar", um aviso com o próximo passo, e o erro
// do catálogo da casa para uma falha.
import "./auth.css";
import { describeError } from "../../lib/errors.js";
import { html, nothing } from "../../lib/html.js";

export const IS_MOCK = import.meta.env?.VITE_API_MODE === "mock";

export const raiz = (extra = "") => html`<span class="raiz ${extra}" aria-hidden="true"></span>`;
export const marca = () => html`<span class="marca">${raiz()}<span class="marca__logo" role="img" aria-label="Território"></span></span>`;

/**
 * Um campo com rótulo. O erro fica embaixo, ligado por aria-describedby, o campo marcado com
 * a borda e o "!" (nunca só cor).
 */
export function field({ id, label, name = id, type = "text", value = "", error, help, autocomplete = "off", inputmode, required = true, readonly = false, maxlength, onInput, extra = nothing }) {
  const describedBy = [error ? `${id}-erro` : "", help ? `${id}-ajuda` : ""].filter(Boolean).join(" ");
  return html`<div class="field ${error ? "field--invalid" : ""}">
    <label class="field__label" for=${id}>${label}</label>
    <div class="campo-linha">
      <input
        class="field__input"
        id=${id}
        name=${name}
        type=${type}
        .value=${value ?? ""}
        autocomplete=${autocomplete}
        inputmode=${inputmode || nothing}
        maxlength=${maxlength || nothing}
        ?required=${required}
        ?readonly=${readonly}
        aria-invalid=${error ? "true" : "false"}
        aria-describedby=${describedBy || nothing}
        @input=${(e) => onInput?.(e.target.value)}
      />
      ${extra}
    </div>
    ${help ? html`<p class="field__help" id=${`${id}-ajuda`}>${help}</p>` : nothing}
    ${error ? html`<p class="field__error" id=${`${id}-erro`}>${error}</p>` : nothing}
  </div>`;
}

/** A senha, com um botão que mostra o que foi digitado. */
export function passwordField({ id, label = "Senha", value, error, help, autocomplete = "current-password", shown, onToggle, onInput }) {
  return field({
    id,
    label,
    name: "password",
    type: shown ? "text" : "password",
    value,
    error,
    help,
    autocomplete,
    onInput,
    extra: html`<button type="button" class="campo-linha__botao" aria-pressed=${String(Boolean(shown))} aria-controls=${id} @click=${onToggle}>${shown ? "Esconder" : "Mostrar"}</button>`,
  });
}

/** Um aviso no lugar, com o próximo passo dentro. Nunca some sozinho. */
export function notice({ title, text, action, onAction, role = "alert", kind = "alerta" }) {
  return html`<div class="aviso aviso--${kind}" role=${role}>
    <p>${title ? html`<b>${title}</b> ` : nothing}${text || nothing}</p>
    ${action && onAction ? html`<button class="btn btn--sm btn--outline" type="button" @click=${onAction}>${action}</button>` : nothing}
  </div>`;
}

/** O aviso do catálogo para uma falha. */
export const problemNotice = (error, { variant, vars, onAction, action } = {}) => {
  const d = describeError(error, { variant, vars });
  return notice({ title: d.title, text: d.text, action: action ?? d.action, onAction });
};

/** Uma tela inteira para uma falha que não deixa nada a fazer aqui (link perdido, conta desativada). */
export function problemPage(error, { variant, vars, actions = nothing, headingId = "entrada-titulo" } = {}) {
  const d = describeError(error, { variant, vars });
  return html`<section class="entrada__caixa entrada__caixa--estado" aria-labelledby=${headingId}>
    ${raiz("raiz--atencao")}
    <h1 class="entrada__titulo" id=${headingId} tabindex="-1">${d.title}</h1>
    <p>${d.text}</p>
    ${actions}
  </section>`;
}

/** Uma dica que só a demonstração mostra: como passar sem e-mail ou autenticador de verdade. */
export const demoHint = (text) => (IS_MOCK ? html`<p class="entrada__demo" role="note"><b>Demonstração:</b> ${text}</p>` : nothing);

/** Erros de campo de um 422 como { field: message }. */
export const fieldErrorsOf = (error) => (error?.errors?.length ? Object.fromEntries(error.errors.map((e) => [e.field, e.message])) : {});
