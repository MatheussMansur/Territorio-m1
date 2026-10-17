// Janelinha de confirmação. O verbo vai no botão ("Cancelar reserva"), e nas
// ações destrutivas a opção segura fica com o foco. Leitores de tela ouvem o título e
// a mensagem.
import { html, render } from "../lib/html.js";
import { t } from "../lib/strings.js";

let count = 0;

export function confirmAction({ title, message, confirmLabel = t("common.confirm"), cancelLabel = t("common.back"), danger = false }) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    const id = ++count;
    dialog.className = "dialog dialog--confirm";
    dialog.setAttribute("aria-labelledby", `confirm-title-${id}`);
    if (message) dialog.setAttribute("aria-describedby", `confirm-text-${id}`);
    document.body.append(dialog);
    let answer = false;
    const done = (value) => {
      answer = value;
      dialog.close();
    };
    render(
      html`<div class="dialog__body">
        <h2 id=${`confirm-title-${id}`}>${title}</h2>
        ${message ? html`<p id=${`confirm-text-${id}`}>${message}</p>` : null}
        <div class="dialog__actions">
          <button type="button" class="btn btn--outline btn--sm" data-safe @click=${() => done(false)}>${cancelLabel}</button>
          <button type="button" class=${`btn btn--sm${danger ? " btn--danger" : ""}`} @click=${() => done(true)}>
            ${confirmLabel}
          </button>
        </div>
      </div>`,
      dialog,
    );
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(answer);
    });
    dialog.showModal();
    if (danger) dialog.querySelector("[data-safe]").focus();
  });
}
