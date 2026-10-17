// "Chegou" fora da planta (história 6.2): a partir de Hoje, de Reservas e da gaveta.
// A pessoa confirma quantos vieram (já preenchido com o número da reserva), a ação leva a
// hora do aparelho e a sua própria Idempotency-Key, o aviso "Chegou · Desfazer" fica 7 s e a
// linha mantém "Desfazer" enquanto durar o prazo configurado para desfazer (Configurações › Salão).
import { confirmAction } from "../../../components/confirm.js";
import { toast } from "../../../components/toast.js";
import { houseTime } from "../../../lib/dates.js";
import { html, nothing } from "../../../lib/html.js";
import { uuid } from "../../../lib/uuid.js";
import * as api from "../../../services/api/staff-reservas.js";
import { guardWrite } from "../salao/retrato.js";
import { problemText } from "./errors.js";
import { formDialog } from "./form-dialog.js";
import { people } from "./labels.js";
import { withCorrection } from "../salao/correcao.js";

const MIN = 60_000;
const firstName = (r) => String(r.customer?.name || "").split(" ")[0] || "Cliente";

/** Se esta reserva ainda pode receber "Chegou" hoje à noite. */
export const canCheckIn = (r, today) => r.date === today && ["confirmed", "pending"].includes(r.status) && !r.arrived_at;

/** Se "Desfazer" ainda vale numa reserva que chegou (pelo relógio da casa). */
export function canUndo(r, rules, now = new Date()) {
  if (r.status !== "completed" || !r.arrived_at || r.source === "walk_in") return false;
  return now - new Date(r.arrived_at) <= (rules?.undo_check_in_min ?? 15) * MIN;
}

/**
 * Pergunta quantos vieram e marca "Chegou". Resolve com a reserva atualizada, ou null.
 * @param {any} r  ReservationStaff
 * @param {{onDone?: () => any}} [options]
 */
export const checkIn = guardWrite(async (r, { onDone } = {}) => {
  const tables = r.table_codes?.length ? r.table_codes : r.lost_table_codes || [];
  if (!tables.length) {
    toast({ kind: "error", title: "Essa reserva está sem mesa", message: "Faça o \"Chegou\" pelo Salão, escolhendo a mesa." });
    return null;
  }
  const key = uuid();
  let done = null;
  const ok = await formDialog({
    title: `Chegou: ${firstName(r)}`,
    submitLabel: `Confirmar chegada na ${tables.join("+")}`,
    state: { count: r.party_size },
    view: (ctx) => html`<p>${people(r.party_size)} na reserva das ${r.time} · mesa ${tables.join("+")}.</p>
      <div class="field">
        <label class="field__label" for="chegou-quantos">Quantas pessoas entraram?</label>
        <div class="res-passo">
          <button type="button" class="action" aria-label="Uma pessoa a menos" ?disabled=${ctx.state.count <= 1} @click=${() => ctx.update({ count: Math.max(1, ctx.state.count - 1) })}>−</button>
          <input class="field__input" id="chegou-quantos" name="people" type="number" inputmode="numeric" min="1" max="60" .value=${String(ctx.state.count)}
            @change=${(e) => ctx.update({ count: Number(e.target.value) || 0 })}>
          <button type="button" class="action" aria-label="Uma pessoa a mais" @click=${() => ctx.update({ count: ctx.state.count + 1 })}>+</button>
        </div>
        <p class="field__help">Se entrou mais gente do que cabe na mesa, faça o "Chegou" pelo Salão para trocar ou juntar mesas.</p>
      </div>`,
    onSubmit: async (data, ctx) => {
      const count = Number(data.get("people"));
      if (!Number.isInteger(count) || count < 1) {
        ctx.error = { title: "Confira o número", message: "Pelo menos 1 pessoa." };
        return false;
      }
      done = await withCorrection((extra) => api.action(r.id, { action: "check_in", people: count, table_codes: tables, occurred_at: new Date().toISOString(), ...extra }, key));
      return done;
    },
  });
  if (!ok) return null;
  toast({
    title: "Chegou",
    message: `${firstName(r)} · ${people(done.arrived_people || r.party_size)} na ${tables.join("+")}`,
    action: { label: "Desfazer", onClick: () => undoCheckIn(done, { onDone }) },
  });
  await onDone?.();
  return done;
});

/** Desfaz um "Chegou" feito por engano, enquanto durar o prazo. */
export const undoCheckIn = guardWrite(async (r, { onDone } = {}) => {
  try {
    await withCorrection((extra) => api.action(r.id, { action: "undo_check_in", occurred_at: new Date().toISOString(), ...extra }, uuid()));
    toast({ title: "Chegada desfeita", message: `${firstName(r)} voltou a esperar a mesa.` });
  } catch (error) {
    const text = problemText(error);
    toast({ kind: "error", ...text, message: error?.type === "undo_window_closed" ? `${text.message} O dono ou o gerente corrige com motivo.` : text.message });
  }
  await onDone?.();
});

/** "Desfazer" mantido na linha de uma reserva que chegou há pouco. */
export function undoButton(r, rules, onDone, now = new Date()) {
  if (!canUndo(r, rules, now)) return nothing;
  const until = new Date(new Date(r.arrived_at).getTime() + (rules?.undo_check_in_min ?? 15) * MIN);
  return html`<button class="action" type="button" aria-label=${`Desfazer a chegada de ${firstName(r)} (até ${houseTime(until.toISOString())})`}
    @click=${(e) => (e.stopPropagation(), undoCheckIn(r, { onDone }))}>Desfazer</button>`;
}

/** A tolerância como a casa diz: "até 20:20", ou "às 20:00 em ponto" com 0 minutos. */
export function toleranceText(r, rules) {
  const tolerance = rules?.tolerance_min ?? r.tolerance_min ?? 0;
  if (!tolerance && !r.extra_tolerance_min) return `A mesa espera às ${r.time} em ponto`;
  const until = r.tolerance_until ? houseTime(r.tolerance_until) : null;
  return until ? `A mesa espera até ${until}` : "";
}

/** Pergunta antes de refazer algo que já foi feito nos últimos minutos. */
export const askAgain = (title, message, confirmLabel) => confirmAction({ title, message, confirmLabel, cancelLabel: "Voltar" });
