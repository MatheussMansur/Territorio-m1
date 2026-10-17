// Peças pequenas comuns a Salão e Espera: o contador de pessoas, o seletor de mesas, a frase
// de erro e os blocos "carregando / erro / vazio" da área.
import { toast } from "../../../components/toast.js";
import { html, nothing } from "../../../lib/html.js";
import { staffErrorMessage, staffProblem } from "../../../lib/errors.js";
import { uuid } from "../../../lib/uuid.js";
import { STATE_WORD } from "./model.js";

export const newKey = () => uuid();

const raiz = (extra = "") => html`<span class="raiz ${extra}" aria-hidden="true"></span>`;

export const loadingBlock = () => html`<div class="area__vazio" role="status">${raiz("raiz--gira")}<p>Carregando…</p></div>`;

/** Uma carga que falhou, no lugar da própria área, com a frase da casa e um jeito de tentar de novo. */
export function errorBlock(error, again) {
  const message = staffErrorMessage(error);
  return html`<div class="area__vazio" role="alert">
    ${raiz("raiz--atencao")}
    <p><b>Não deu para abrir agora.</b> ${message}</p>
    <button class="btn" type="button" @click=${again}>Tentar de novo</button>
  </div>`;
}

/** O título e a frase de uma ação que falhou, do catálogo único da casa (história 1.5). */
export const problemText = (error, variant) => staffProblem(error, { variant });

export const toastError = (error) => toast({ ...problemText(error), kind: "error" });

/** − 2 + : o contador de pessoas, alvos de 44 px, o número lido em voz alta quando muda. */
export function stepper({ id, label, value, min = 1, max = 30, onChange }) {
  return html`<div class="contador" role="group" aria-labelledby=${`${id}-rotulo`}>
    <span class="contador__rotulo" id=${`${id}-rotulo`}>${label}</span>
    <div class="contador__linha">
      <button class="contador__botao" type="button" aria-label="Menos uma pessoa" ?disabled=${value <= min} @click=${() => onChange(value - 1)}>−</button>
      <output class="contador__valor" id=${id} aria-live="polite">${value}</output>
      <button class="contador__botao" type="button" aria-label="Mais uma pessoa" ?disabled=${value >= max} @click=${() => onChange(value + 1)}>+</button>
    </div>
  </div>`;
}

/**
 * As mesas para escolher, como botões de alternar com a palavra do estado e os lugares.
 * `picked` é a lista de códigos escolhidos; `single` escolhe uma por vez.
 */
export function tablePicker({ label, tables, picked, single = false, onPick, empty = "Nenhuma mesa livre agora." }) {
  if (!tables.length) return html`<p class="escolha-vazia">${empty}</p>`;
  return html`<fieldset class="escolha-mesas">
    <legend>${label}</legend>
    <div class="escolha-mesas__lista">
      ${tables.map(
        (t) => html`<button
          type="button"
          class="escolha-mesa"
          aria-pressed=${picked.includes(t.code) ? "true" : "false"}
          @click=${() => onPick(single ? [t.code] : picked.includes(t.code) ? picked.filter((c) => c !== t.code) : [...picked, t.code])}
        >
          <b>${t.code}</b><span>${t.max_seats} lug. · ${t.pickWord || STATE_WORD[t.state]}</span>
        </button>`,
      )}
    </div>
  </fieldset>`;
}

export const seatsOf = (tables, codes) => tables.filter((t) => codes.includes(t.code)).reduce((n, t) => n + t.max_seats, 0);

export const maybe = (cond, tpl) => (cond ? tpl : nothing);
