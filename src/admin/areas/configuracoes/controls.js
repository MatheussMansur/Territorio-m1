// Os controles de uma linha de configuração: passo (−/valor/+), chave, segmentado, hora, texto, texto em
// três idiomas, marcações, fixo e travado. Cada um recebe a linha, o valor atual, o seu `meta`
// (limites e opções do servidor) e `set(value)`. Eles só desenham; a tela guarda o estado.
import { html, nothing } from "../../../lib/html.js";
import { LANGS, minutes } from "./catalog.js";

/** As opções de uma linha segmentada: a lista do servidor, ou booleanos, ou a faixa de inteiros. */
export function optionsOf(row, meta = {}) {
  if (meta.options) return meta.options;
  if (meta.type === "boolean") return [true, false];
  if (meta.type === "integer" && meta.max - meta.min <= 5) return Array.from({ length: meta.max - meta.min + 1 }, (_, i) => meta.min + i);
  return Object.keys(row.labels || {});
}

/** Como um valor se lê numa frase ("20 min", "Ligada", "livre"). */
export function formatValue(row, value) {
  if (value === undefined) return "";
  switch (row.type) {
    case "stepper":
      if (value === null) return row.nullLabel || "vazio";
      return row.format ? row.format(value) : `${row.prefix || ""}${value}${row.unit ? ` ${row.unit}` : ""}`;
    case "toggle":
      return value ? row.on : row.off;
    case "segmented":
      return row.labels?.[String(value)] ?? String(value);
    case "time":
      return value || row.nullLabel || "desligado";
    case "text":
      return String(value ?? "").trim() || row.empty || "vazio";
    case "localized":
      return value?.pt ?? "";
    case "locales":
      return (value || []).map((l) => LANGS.find((x) => x.key === l)?.name ?? l).join(", ");
    case "areas":
    case "people":
      return `${(value || []).length} escolhidas`;
    case "weekdayMinutes":
      return (value || []).map((d) => (d.minutes == null ? "livre" : minutes(d.minutes))).join(" · ");
    default:
      return "";
  }
}

const ids = (row, uid) => ({ label: `${uid}-rotulo`, help: `${uid}-ajuda`, error: `${uid}-erro` });
export const describedBy = (row, uid, error) => [row.help ? ids(row, uid).help : null, error ? ids(row, uid).error : null].filter(Boolean).join(" ") || nothing;

// ---- passo -----------------------------------------------------------------------------

function stepper(row, c) {
  const { meta = {}, value, set, disabled, uid, error } = c;
  const step = meta.step || 1;
  const min = meta.min ?? 0;
  const max = meta.max ?? 9999;
  const isNull = value === null;
  const atMin = !isNull && value <= min;
  const atMax = !isNull && value >= max;
  const clamp = (v) => Math.min(max, Math.max(min, v));
  const move = (dir) => {
    if (disabled || isNull) return;
    const next = clamp((Number(value) || 0) + dir * step);
    if (next !== value) set(next);
  };
  const onInput = (e) => {
    const raw = e.target.value.trim();
    if (raw === "") return;
    const n = Math.round(Number(raw));
    if (Number.isFinite(n)) set(clamp(n));
  };
  const onKey = (e) => {
    if (e.key === "PageUp") {
      e.preventDefault();
      move(5);
    } else if (e.key === "PageDown") {
      e.preventDefault();
      move(-5);
    }
  };
  const unit = row.unit ? html`<span class="cfg-passo__unidade" aria-hidden="true">${row.unit}</span>` : nothing;
  const readable = row.format && !isNull ? html`<span class="cfg-passo__leitura">${row.format(value)}</span>` : nothing;
  const limit = atMax ? `vai até ${row.format ? row.format(max) : max}` : atMin ? `começa em ${row.format ? row.format(min) : min}` : "";
  return html`<div class="cfg-passo-caixa">
    <div class="cfg-passo ${isNull ? "is-vazio" : ""}">
      <button type="button" class="cfg-passo__botao" aria-label=${`Menos ${step} ${row.unit || ""}`.trim()} aria-disabled=${String(disabled || isNull || atMin)} @click=${() => !atMin && move(-1)}>−</button>
      <label class="cfg-passo__valor">
        <span class="sr-only">${row.label}${row.unit ? ` (${row.unit})` : ""}</span>
        ${row.prefix && !isNull ? html`<span aria-hidden="true">${row.prefix}</span>` : nothing}
        <input
          id=${`${uid}-controle`}
          class="cfg-passo__input"
          type="number"
          inputmode="numeric"
          min=${min}
          max=${max}
          step=${step}
          .value=${isNull ? "" : String(value)}
          placeholder=${isNull ? row.nullLabel || "" : ""}
          ?disabled=${disabled || isNull}
          aria-describedby=${describedBy(row, uid, error)}
          aria-invalid=${error ? "true" : "false"}
          @change=${onInput}
          @keydown=${onKey}
        />
        ${unit}
      </label>
      <button type="button" class="cfg-passo__botao" aria-label=${`Mais ${step} ${row.unit || ""}`.trim()} aria-disabled=${String(disabled || isNull || atMax)} @click=${() => !atMax && move(1)}>+</button>
    </div>
    ${readable}
    ${row.nullLabel
      ? html`<label class="check cfg-vazio">
          <input type="checkbox" .checked=${isNull} ?disabled=${disabled} @change=${(e) => set(e.target.checked ? null : (c.old ?? meta.default ?? min) || min)} />
          <span>${row.nullLabel}</span>
        </label>`
      : nothing}
    ${limit ? html`<span class="cfg-limite" aria-live="polite">${limit}</span>` : nothing}
  </div>`;
}

// ---- chave ------------------------------------------------------------------------------

function toggle(row, c) {
  const { value, disabled, uid, error } = c;
  return html`<button
    type="button"
    role="switch"
    id=${`${uid}-controle`}
    class="cfg-chave"
    aria-checked=${String(Boolean(value))}
    aria-labelledby=${ids(row, uid).label}
    aria-describedby=${describedBy(row, uid, error)}
    aria-disabled=${String(Boolean(disabled))}
    @click=${() => !disabled && c.confirmToggle(!value)}
  >
    <span class="cfg-chave__trilho" aria-hidden="true"><span class="cfg-chave__pino"></span></span>
    <span class="cfg-chave__palavra">${value ? row.on : row.off}</span>
  </button>`;
}

// ---- segmentado ---------------------------------------------------------------------------

function segmented(row, c) {
  const { value, set, disabled, uid, meta, error } = c;
  const options = optionsOf(row, meta);
  const pickAt = (i) => !disabled && set(options[(i + options.length) % options.length]);
  const onKey = (e) => {
    const i = options.findIndex((o) => String(o) === String(value));
    const moves = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(e.key in moves)) return;
    e.preventDefault();
    const group = e.currentTarget;
    pickAt(i + moves[e.key]);
    requestAnimationFrame(() => group.querySelector('[aria-checked="true"]')?.focus());
  };
  return html`<div
    class="cfg-seg"
    role="radiogroup"
    id=${`${uid}-controle`}
    aria-labelledby=${ids(row, uid).label}
    aria-describedby=${describedBy(row, uid, error)}
    @keydown=${onKey}
  >
    ${options.map((option) => {
      const on = String(option) === String(value);
      return html`<button
        type="button"
        role="radio"
        class="cfg-seg__opcao"
        aria-checked=${String(on)}
        aria-disabled=${String(Boolean(disabled))}
        tabindex=${on ? "0" : "-1"}
        @click=${() => !disabled && set(option)}
      >
        ${row.labels?.[String(option)] ?? String(option)}
      </button>`;
    })}
  </div>`;
}

// ---- hora e texto -------------------------------------------------------------------------

function time(row, c) {
  const { value, set, disabled, uid, meta, error } = c;
  const nullable = meta?.nullable || row.nullable;
  return html`<div class="cfg-hora">
    <input
      id=${`${uid}-controle`}
      class="field__input cfg-hora__input"
      type="time"
      .value=${value || ""}
      ?disabled=${disabled || (nullable && value === null)}
      aria-labelledby=${ids(row, uid).label}
      aria-describedby=${describedBy(row, uid, error)}
      aria-invalid=${error ? "true" : "false"}
      @change=${(e) => e.target.value && set(e.target.value)}
    />
    ${nullable
      ? html`<label class="check cfg-vazio">
          <input type="checkbox" .checked=${value === null} ?disabled=${disabled} @change=${(e) => set(e.target.checked ? null : c.old || "19:00")} />
          <span>${row.nullLabel || "desligado"}</span>
        </label>`
      : nothing}
  </div>`;
}

const INPUTS = { tel: ["tel", "tel"], url: ["url", "url"], numeric: ["text", "numeric"] };

function text(row, c) {
  const { value, set, disabled, uid, meta, error } = c;
  const [type, mode] = INPUTS[row.input] || ["text", "text"];
  return html`<input
    id=${`${uid}-controle`}
    class="field__input"
    type=${type}
    inputmode=${mode}
    maxlength=${meta?.max_length || nothing}
    .value=${value ?? ""}
    placeholder=${row.empty || ""}
    ?disabled=${disabled}
    aria-labelledby=${ids(row, uid).label}
    aria-describedby=${describedBy(row, uid, error)}
    aria-invalid=${error ? "true" : "false"}
    @input=${(e) => set(row.nullable && !e.target.value.trim() ? null : e.target.value)}
  />`;
}

// ---- texto em três idiomas ----------------------------------------------------------------

/**
 * Abas pt, es e en; um idioma que falta mostra o losango e a palavra na sua aba.
 * `lang`/`setLang` guardam a aba aberta; `labelId` dá nome ao campo para leitores de tela.
 */
export function localized({ value, set, disabled, uid, max, multiline, lang = "pt", setLang, labelId, describedby, error }) {
  const v = value || {};
  const missing = (l) => l !== "pt" && !String(v[l] ?? "").trim();
  const onKey = (e) => {
    const i = LANGS.findIndex((l) => l.key === lang);
    const moves = { ArrowRight: 1, ArrowLeft: -1 };
    if (!(e.key in moves)) return;
    e.preventDefault();
    const next = LANGS[(i + moves[e.key] + LANGS.length) % LANGS.length].key;
    setLang(next);
    requestAnimationFrame(() => document.getElementById(`${uid}-aba-${next}`)?.focus());
  };
  const input = (l) => {
    const props = {
      id: `${uid}-texto-${l}`,
      value: v[l] ?? "",
      onInput: (e) => set({ ...v, [l]: l === "pt" ? e.target.value : e.target.value || "" }),
    };
    const placeholder = l === "pt" ? "" : `Vazio, usa o português: ${v.pt ?? ""}`.slice(0, 80);
    return multiline
      ? html`<textarea
          id=${props.id}
          class="field__input cfg-texto"
          rows="3"
          maxlength=${max || nothing}
          .value=${props.value}
          placeholder=${placeholder}
          ?disabled=${disabled}
          aria-labelledby=${`${labelId} ${uid}-aba-${l}`}
          aria-describedby=${describedby}
          aria-invalid=${error && l === "pt" ? "true" : "false"}
          @input=${props.onInput}
        ></textarea>`
      : html`<input
          id=${props.id}
          class="field__input cfg-texto"
          maxlength=${max || nothing}
          .value=${props.value}
          placeholder=${placeholder}
          ?disabled=${disabled}
          aria-labelledby=${`${labelId} ${uid}-aba-${l}`}
          aria-describedby=${describedby}
          aria-invalid=${error && l === "pt" ? "true" : "false"}
          @input=${props.onInput}
        />`;
  };
  return html`<div class="cfg-linguas">
    <div class="cfg-linguas__abas" role="tablist" aria-label="Língua" @keydown=${onKey}>
      ${LANGS.map(
        (l) => html`<button
          type="button"
          role="tab"
          id=${`${uid}-aba-${l.key}`}
          class="cfg-linguas__aba"
          aria-selected=${String(lang === l.key)}
          aria-controls=${`${uid}-painel-${l.key}`}
          tabindex=${lang === l.key ? "0" : "-1"}
          @click=${() => setLang(l.key)}
        >
          ${l.label}${missing(l.key) ? html`<span class="losango" aria-hidden="true"></span><span class="sr-only">, sem tradução</span>` : nothing}
        </button>`,
      )}
    </div>
    ${LANGS.map(
      (l) => html`<div role="tabpanel" id=${`${uid}-painel-${l.key}`} aria-labelledby=${`${uid}-aba-${l.key}`} ?hidden=${lang !== l.key}>
        ${lang === l.key ? input(l.key) : nothing}
        ${missing(l.key) && lang === l.key ? html`<p class="cfg-pendente"><span class="losango" aria-hidden="true"></span>Sem tradução em ${l.name}: o site usa o português.</p>` : nothing}
      </div>`,
    )}
  </div>`;
}

// ---- marcações --------------------------------------------------------------------------------

export function checks({ options, value, set, disabled, labelId, describedby, error, uid }) {
  const chosen = new Set(value || []);
  return html`<div class="cfg-checks" role="group" aria-labelledby=${labelId} aria-describedby=${describedby || nothing}>
    ${options.map(
      (o, i) => html`<label class="check cfg-check">
        <input
          type="checkbox"
          id=${i === 0 ? `${uid}-controle` : nothing}
          .checked=${chosen.has(o.value)}
          ?disabled=${disabled || o.disabled}
          aria-invalid=${error ? "true" : "false"}
          @change=${(e) => {
            const next = new Set(chosen);
            if (e.target.checked) next.add(o.value);
            else next.delete(o.value);
            set(options.map((x) => x.value).filter((v) => next.has(v)));
          }}
        />
        <span>${o.label}${o.note ? html` <small>${o.note}</small>` : nothing}</span>
      </label>`,
    )}
  </div>`;
}

// ---- o despachante --------------------------------------------------------------------------

export function control(row, c) {
  switch (row.type) {
    case "stepper":
      return stepper(row, c);
    case "toggle":
      return toggle(row, c);
    case "segmented":
      return segmented(row, c);
    case "time":
      return time(row, c);
    case "text":
      return text(row, c);
    case "localized":
      return localized({
        value: c.value,
        set: c.set,
        disabled: c.disabled,
        uid: c.uid,
        max: c.meta?.max_length,
        multiline: row.multiline,
        lang: c.lang,
        setLang: c.setLang,
        labelId: ids(row, c.uid).label,
        describedby: describedBy(row, c.uid, c.error),
        error: c.error,
      });
    default:
      return nothing;
  }
}
