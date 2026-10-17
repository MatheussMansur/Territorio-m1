// Uma janela pequena com formulário, por cima da gaveta ou da área: o verbo no botão, a
// escolha segura ao lado, uma recusa da API mostrada dentro sem fechar, e o botão
// travado desde o primeiro toque até a resposta voltar.
import { openDialog } from "../../../components/dialog.js";
import { html, nothing, render } from "../../../lib/html.js";
import { problemText } from "./errors.js";

let count = 0;

/**
 * @param {{title: string, view: (ctx: any) => any, submitLabel: string, cancelLabel?: string,
 *   danger?: boolean, wide?: boolean, onSubmit: (data: FormData, ctx: any) => Promise<any>,
 *   state?: object, init?: (ctx: any) => void, isDirty?: () => boolean}} options
 * @returns {Promise<any>} o que onSubmit devolveu, ou null quando a janela fechou sem ele
 */
export function formDialog({ title, view, state = {}, submitLabel, cancelLabel = "Voltar", danger = false, wide = false, onSubmit, init, isDirty }) {
  return new Promise((resolve) => {
    const id = `janela-${++count}`;
    const dialog = document.createElement("dialog");
    dialog.className = `dialog dialog--confirm res-janela${wide ? " res-janela--larga" : ""}`;
    dialog.setAttribute("aria-labelledby", `${id}-titulo`);
    document.body.append(dialog);
    let result = null;

    const ctx = {
      state: { ...state },
      error: null,
      busy: false,
      dialog,
      update(patch = {}) {
        Object.assign(ctx.state, patch);
        draw();
      },
    };

    async function submit(event) {
      event.preventDefault();
      if (ctx.busy) return;
      ctx.busy = true;
      ctx.error = null;
      draw();
      try {
        const answer = await onSubmit(new FormData(event.target), ctx);
        if (answer === false) {
          ctx.busy = false;
          draw();
          return;
        }
        result = answer ?? true;
        dialog.close();
      } catch (error) {
        console.error(error);
        ctx.busy = false;
        ctx.error = problemText(error);
        draw();
        dialog.querySelector(".res-janela__erro")?.focus();
      }
    }

    function draw() {
      render(
        html`<form class="dialog__body" @submit=${submit} novalidate>
          <h2 id=${`${id}-titulo`}>${title}</h2>
          ${view(ctx)}
          <div class="res-janela__erro" tabindex="-1" role="alert">
            ${ctx.error
              ? html`<p class="notice notice--alert"><b>${ctx.error.title}.</b> ${ctx.error.message}
                  ${ctx.error.action ? html`<button type="button" class="btn btn--outline btn--sm" @click=${ctx.error.action.onClick}>${ctx.error.action.label}</button>` : nothing}</p>`
              : nothing}
          </div>
          <div class="dialog__actions">
            <button type="button" class="btn btn--outline btn--sm" data-close data-safe>${cancelLabel}</button>
            <button type="submit" class=${`btn btn--sm${danger ? " btn--danger" : ""}`} ?disabled=${ctx.busy} aria-busy=${String(ctx.busy)}>
              ${ctx.busy ? "Gravando…" : submitLabel}
            </button>
          </div>
        </form>`,
        dialog,
      );
    }

    draw();
    openDialog(dialog, {
      isDirty: () => !ctx.busy && Boolean(isDirty?.()),
      onClose: () => {
        dialog.remove();
        resolve(result);
      },
    });
    init?.(ctx);
    const first = danger ? dialog.querySelector("[data-safe]") : dialog.querySelector("input:not([type=hidden]), select, textarea");
    (first || dialog.querySelector("[data-safe]"))?.focus();
  });
}
