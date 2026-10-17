// As mensagens prontas da recepção (história 6.9): "Sua mesa está te esperando", "Sua mesa está
// pronta" e "Estamos com atraso", com um toque, sem nunca mostrar o telefone. A linha da
// reserva passa a dizer "avisado às 21:12"; a mesma mensagem de novo em menos de 10 minutos pergunta
// antes; sem WhatsApp confirmado diz needs_whatsapp; com o WhatsApp da casa fora do ar
// os botões ficam desligados, com o motivo.
import { toast } from "../../../components/toast.js";
import { houseTime } from "../../../lib/dates.js";
import { html, nothing } from "../../../lib/html.js";
import { uuid } from "../../../lib/uuid.js";
import * as api from "../../../services/api/staff-reservas.js";
import { guardWrite } from "../salao/retrato.js";
import { askAgain } from "./chegada.js";
import { problemText } from "./errors.js";

export const READY = {
  table_waiting: "Sua mesa está te esperando",
  table_ready: "Sua mesa está pronta",
  running_late: "Estamos com atraso",
};

/** "avisado às 21:12" para uma linha, ou nada. */
export const notifiedNote = (r) => (r?.last_notified?.at ? html`<span class="badge badge--said-yes">avisado às ${houseTime(r.last_notified.at)}</span>` : nothing);

/** "chegando · 21:08" quando o cliente respondeu "Estou chegando". */
export const arrivingNote = (r) => (r?.customer_arriving_at ? html`<span class="badge badge--offered">chegando · ${houseTime(r.customer_arriving_at)}</span>` : nothing);

/** Manda uma mensagem pronta; pergunta antes de repetir uma enviada nos últimos 10 minutos. */
export const sendReady = guardWrite(async (r, template, { onSent, notify = api.notify } = {}) => {
  const go = (repeat) => notify(r.id, template, uuid(), { repeat });
  try {
    await go(false);
  } catch (error) {
    if (error?.body?.reason === "recently_sent") {
      const at = error.body.sent_at ? houseTime(error.body.sent_at) : "";
      const again = await askAgain(`Mandar de novo?`, `Você já mandou essa às ${at}. Mandar de novo?`, "Mandar de novo");
      if (!again) return false;
      try {
        await go(true);
      } catch (second) {
        toast({ kind: "error", ...messageProblem(second) });
        return false;
      }
    } else {
      toast({ kind: "error", ...messageProblem(error) });
      return false;
    }
  }
  toast({ title: "Mensagem enviada", message: `"${READY[template]}" saiu pelo WhatsApp.` });
  await onSent?.();
  return true;
});

/** As palavras do catálogo; com o WhatsApp da casa fora do ar, a dica da porta em vez da fila. */
function messageProblem(error) {
  const said = problemText(error);
  return error?.type === "whatsapp_down" ? { ...said, message: "Fale com o cliente na porta." } : said;
}

/**
 * Os três botões, ou por que estão desligados.
 * @param {any} r  a reserva desta noite
 * @param {{whatsapp?: string, busy?: boolean, onSent?: () => any, compact?: boolean}} options
 */
export function readyButtons(r, { whatsapp = "ok", busy = false, onSent, compact = false } = {}) {
  const down = whatsapp === "down";
  const without = r.no_whatsapp || r.phone_verified === false;
  return html`<div class=${`prontas${compact ? " prontas--compacta" : ""}`}>
    ${down
      ? html`<p class="field__help prontas__motivo">O WhatsApp da casa está fora. Fale com o cliente na porta.</p>`
      : without
        ? html`<p class="field__help prontas__motivo">Sem WhatsApp confirmado: a mensagem não sai. Chame o dono ou o gerente para ligar.</p>`
        : nothing}
    <div class="cluster">
      ${Object.entries(READY).map(
        ([key, label]) => html`<button class="action" type="button" ?disabled=${busy || down || without} @click=${() => sendReady(r, key, { onSent })}>${label}</button>`,
      )}
    </div>
    ${r.last_notified?.at ? html`<p class="field__help">Último aviso: "${READY[r.last_notified.template] || "mensagem"}", às ${houseTime(r.last_notified.at)}.</p>` : nothing}
  </div>`;
}
