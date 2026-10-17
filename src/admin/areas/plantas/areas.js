// As áreas da casa: o formulário que cria ou renomeia uma (página da lista e editor), os tamanhos de uma
// área dentro de uma planta (metros, um quadrado da grade = 0,5 m) e as palavras de como uma área funciona.
import { showFormErrors } from "../../../components/field.js";
import { toast } from "../../../components/toast.js";
import { html, nothing } from "../../../lib/html.js";
import { errorText, openSheet } from "../agenda/ui.js";

export const SIZE_MIN = 2;
export const SIZE_MAX = 100;
export const DEFAULT_WIDTH = 32;
export const DEFAULT_DEPTH = 13;
/** Quadrados da grade por metro (um quadrado = 0,5 m). */
export const PER_METER = 2;

export const MODES = [
  ["tables", "Mesas"],
  ["list", "Lista"],
  ["closed", "Fechada"],
];
export const MODE_LONG = { tables: "com mesas", list: "lista com capacidade", closed: "fechada" };

/** Um tamanho em metros mantido entre os limites, em meios metros. */
export const meters = (value, fallback) => {
  const n = Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(n * PER_METER) / PER_METER));
};

/** "32 m", "12,5 m". */
export const metersLabel = (n) => `${String(n).replace(".", ",")} m`;

/** A grade de uma área de uma planta, em quadrados. */
export const gridOf = (conf) => ({
  cols: Math.round((conf?.width_m ?? DEFAULT_WIDTH) * PER_METER),
  rows: Math.round((conf?.depth_m ?? DEFAULT_DEPTH) * PER_METER),
});

/** "Padrão, Casa cheia (arquivada)": as plantas que usam uma área. */
export const usedByLabel = (area) =>
  (area.used_by || []).map((l) => `${l.name}${l.archived ? " (arquivada)" : ""}`).join(", ");

/**
 * O formulário de uma área: nome e como ela funciona por padrão (com as pessoas da lista), e, no
 * editor, o tamanho nesta planta. `send` recebe o corpo e responde a área gravada.
 */
export function areaSheet({ title, area = null, withSize = false, send }) {
  const form = {
    name: area?.name || "",
    default_mode: area?.default_mode || "tables",
    default_list_capacity: area?.default_list_capacity ?? "",
    width_m: String(DEFAULT_WIDTH),
    depth_m: String(DEFAULT_DEPTH),
  };
  const start = JSON.stringify(form);
  const renaming = Boolean(area);
  let busy = false;
  const sheet = openSheet({
    title,
    size: "narrow",
    isDirty: () => JSON.stringify(form) !== start,
    view: (close, refresh) => {
      const submit = async (event) => {
        event.preventDefault();
        const el = event.currentTarget;
        const errors = {};
        if (!form.name.trim()) errors.name = "Dê um nome à área.";
        const capacity = Number.parseInt(form.default_list_capacity, 10);
        if (!renaming && form.default_mode === "list" && !(capacity > 0)) errors.default_list_capacity = "Em lista, diga quantas pessoas cabem.";
        if (Object.keys(errors).length) return showFormErrors(el, errors);
        const body = renaming
          ? { name: form.name.trim() }
          : {
              name: form.name.trim(),
              default_mode: form.default_mode,
              default_list_capacity: form.default_mode === "list" ? capacity : null,
            };
        busy = true;
        refresh();
        try {
          const saved = await send(body);
          close(withSize ? { area: saved, width_m: meters(form.width_m, DEFAULT_WIDTH), depth_m: meters(form.depth_m, DEFAULT_DEPTH) } : saved);
        } catch (e) {
          busy = false;
          refresh();
          if (e?.status === 422) showFormErrors(el, e.fieldErrors);
          else toast({ title: "Não deu para gravar", message: errorText(e), kind: "error" });
        }
      };
      const set = (key) => (e) => {
        form[key] = e.target.value;
        refresh();
      };
      return html`<form class="ag-form" novalidate @submit=${submit}>
        <label class="field">
          <span class="field__label">Nome da área</span>
          <input class="field__input" name="name" autocomplete="off" .value=${form.name} placeholder="Ex.: Tenda do evento" @input=${(e) => (form.name = e.target.value)} />
        </label>
        ${renaming
          ? nothing
          : html`<label class="field">
                <span class="field__label">Como funciona de começo</span>
                <select class="field__input" name="default_mode" @change=${set("default_mode")}>
                  ${MODES.map(([v]) => html`<option value=${v} ?selected=${form.default_mode === v}>${MODE_LONG[v][0].toUpperCase()}${MODE_LONG[v].slice(1)}</option>`)}
                </select>
              </label>
              ${form.default_mode === "list"
                ? html`<label class="field">
                    <span class="field__label">Pessoas na lista</span>
                    <input class="field__input" name="default_list_capacity" type="number" min="1" inputmode="numeric" .value=${String(form.default_list_capacity)} @input=${(e) => (form.default_list_capacity = e.target.value)} />
                  </label>`
                : nothing}
              <p class="ag-ajuda">Cada planta pode mudar isso depois.</p>`}
        ${withSize
          ? html`<fieldset class="ag-campo-grupo pl-tamanho-campos">
              <legend class="field__label">Tamanho nesta planta <small>de ${SIZE_MIN} a ${SIZE_MAX} m</small></legend>
              <label class="field">
                <span class="field__label">Largura (m)</span>
                <input class="field__input" name="width_m" type="number" min=${SIZE_MIN} max=${SIZE_MAX} step="0.5" inputmode="decimal" .value=${form.width_m} @input=${(e) => (form.width_m = e.target.value)} />
              </label>
              <label class="field">
                <span class="field__label">Fundo (m)</span>
                <input class="field__input" name="depth_m" type="number" min=${SIZE_MIN} max=${SIZE_MAX} step="0.5" inputmode="decimal" .value=${form.depth_m} @input=${(e) => (form.depth_m = e.target.value)} />
              </label>
            </fieldset>`
          : nothing}
        <div class="dialog__actions">
          <button class="btn btn--outline" type="button" data-close>Voltar</button>
          <button class="btn" type="submit" aria-busy=${busy ? "true" : "false"} ?disabled=${busy}>${renaming ? "Gravar" : "Criar área"}</button>
        </div>
      </form>`;
    },
  });
  return sheet.done;
}

/** conflict.area_in_use: as plantas que ainda usam a área, cada uma um caminho para mudá-la. */
export function areaInUseSheet(area) {
  openSheet({
    title: "Essa área está em uso",
    size: "narrow",
    view: () => html`<p>${area.name} está em ${(area.used_by || []).length === 1 ? "uma planta" : "algumas plantas"}. Tire a área dessas plantas antes de apagar.</p>
      <ul class="ag-lista">
        ${(area.used_by || []).map((l) => html`<li><a href=${`/admin/plantas/${l.id}`} data-close>${l.name}</a>${l.archived ? " (arquivada)" : ""}</li>`)}
      </ul>
      <div class="dialog__actions">
        <button class="btn btn--outline" type="button" data-close>Voltar</button>
      </div>`,
  });
}
