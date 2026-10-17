// Mensagens dos campos: o erro fica embaixo do campo, ligado a ele para leitores de tela,
// e o primeiro campo com erro recebe o foco.
import { html, render } from "../lib/html.js";
import { t } from "../lib/strings.js";

let seq = 0;

function parts(input) {
  const field = input.closest(".field") || input.closest(".otp")?.closest(".field");
  let error = field?.querySelector(".field__error");
  if (field && !error) {
    error = document.createElement("p");
    error.className = "field__error";
    field.append(error);
  }
  if (!input.id) input.id = `campo-${++seq}`; // dois campos com nomes parecidos nunca dividem um erro
  if (error && !error.id) error.id = `${input.id}-erro`;
  return { field, error };
}

export function setFieldError(input, message) {
  const { field, error } = parts(input);
  if (!field) return;
  field.classList.toggle("field--invalid", Boolean(message));
  field.classList.remove("field--valid");
  input.setAttribute("aria-invalid", message ? "true" : "false");
  const described = new Set((input.getAttribute("aria-describedby") || "").split(" ").filter(Boolean));
  if (message) {
    error.textContent = message;
    described.add(error.id);
  } else {
    error.textContent = "";
    described.delete(error.id);
  }
  if (described.size) input.setAttribute("aria-describedby", [...described].join(" "));
  else input.removeAttribute("aria-describedby");
}

export function setFieldValid(input, valid) {
  const { field } = parts(input);
  field?.classList.toggle("field--valid", Boolean(valid));
}

/**
 * Mostra todas as mensagens de um formulário de uma vez. `errors` é { fieldName: message } (das
 * regras ou de ApiError.fieldErrors). Devolve true quando houve algum erro.
 */
export function showFormErrors(form, errors, summaryHost) {
  const entries = Object.entries(errors).filter(([, message]) => message);
  for (const input of form.querySelectorAll("[name]")) setFieldError(input, errors[input.name] || null);
  // um erro que a API manda sobre algo que não é campo aqui aparece mesmo assim, sem link
  const control = (name) => {
    const found = form.elements.namedItem(name);
    const el = found instanceof RadioNodeList ? found[0] : found;
    return el instanceof HTMLElement ? el : null;
  };
  if (summaryHost) {
    render(
      entries.length
        ? html`<div class="form-errors" role="alert" tabindex="-1">
            <h3>${t("errors.formSummary", { n: entries.length, campos: entries.length === 1 ? "campo" : "campos" })}</h3>
            <ul>
              ${entries.map(([name, message]) => {
                const el = control(name);
                return html`<li>${el?.id ? html`<a href=${`#${el.id}`}>${message}</a>` : message}</li>`;
              })}
            </ul>
          </div>`
        : null,
      summaryHost,
    );
  }
  const first = entries.map(([name]) => control(name)).find(Boolean);
  if (first) first.focus();
  else if (entries.length) summaryHost?.querySelector(".form-errors")?.focus();
  return entries.length > 0;
}
