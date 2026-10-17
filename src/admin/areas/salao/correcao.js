// Uma mudança numa noite que já fechou (história 6.14): dono e gerente corrigem só com
// um motivo, que vai para o registro de ações. A API responde a validação com o motivo
// "correction_reason_required"; a tela pede o motivo uma vez e manda a mesma mudança
// de novo com ele (mesma Idempotency-Key: uma recusa nunca fica guardada como resposta).
import { showFormErrors } from "../../../components/field.js";
import { html } from "../../../lib/html.js";
import { formDialog } from "../reservas/form-dialog.js";

export const needsCorrectionReason = (error) => error?.body?.reason === "correction_reason_required";

/** O motivo, ou null quando a pessoa desistiu. */
export function askCorrectionReason() {
  return formDialog({
    title: "A noite já fechou",
    submitLabel: "Corrigir com motivo",
    cancelLabel: "Voltar",
    view: () => html`<p>Depois do fechamento, toda correção leva um motivo. Ele fica no registro de ações com o seu nome.</p>
      <div class="field">
        <label class="field__label" for="correcao-motivo">Motivo da correção</label>
        <textarea class="field__input" id="correcao-motivo" name="correction_reason" rows="2" maxlength="280"></textarea>
        <p class="field__help">Por exemplo: “Chegou às 21:40, a recepção esqueceu de marcar”.</p>
      </div>`,
    onSubmit: async (data, ctx) => {
      const reason = String(data.get("correction_reason") || "").trim();
      if (!reason) {
        showFormErrors(ctx.dialog.querySelector("form"), { correction_reason: "Escreva o motivo da correção." });
        return false;
      }
      return reason;
    },
  });
}

/**
 * Faz uma mudança; quando a noite já fechou, pede o motivo e faz de novo com ele.
 * `run(extra)` faz a chamada com `extra` ({} ou { correction_reason }) juntado ao corpo.
 * Desistir relança a recusa, para quem chamou dizer como qualquer outra falha.
 */
export async function withCorrection(run) {
  try {
    return await run({});
  } catch (error) {
    if (!needsCorrectionReason(error)) throw error;
    const reason = await askCorrectionReason();
    if (!reason) throw error;
    return run({ correction_reason: reason });
  }
}
