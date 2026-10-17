// Pequenas peças que Agenda, Plantas e Eventos compartilham: os estados da área (carregando, vazio, erro),
// uma folha sobre a página feita com o diálogo do painel, e a frase de erro da casa.
import "./shared.css";
import { openDialog } from "../../../components/dialog.js";
import { html, nothing, render } from "../../../lib/html.js";
import { addDays, formatDay } from "../../../lib/dates.js";
import { staffErrorMessage } from "../../../lib/errors.js";
import { session } from "../../../lib/storage.js";
import { canDo } from "../../nav.js";

/** Uma frase que a pessoa consegue ler, do catálogo único da casa (história 1.5), nunca o texto cru do servidor. */
export const errorText = (error, variant) => staffErrorMessage(error, { variant });

const raiz = (extra = "") => html`<span class="raiz ${extra}" aria-hidden="true"></span>`;

export const loadingBlock = (text = "Carregando…") => html`<div class="area__vazio" role="status">${raiz("raiz--gira")}<p>${text}</p></div>`;

/** O erro contido de uma parte da tela, com um jeito de tentar de novo. */
export const errorBlock = (error, again) => html`<div class="area__vazio" role="alert">
  ${raiz("raiz--atencao")}
  <p><b>Não deu para carregar.</b> ${errorText(error)}</p>
  ${again ? html`<button class="btn" type="button" @click=${again}>Tentar de novo</button>` : nothing}
</div>`;

/** O estado vazio: a raiz, uma frase curta e o próximo passo. */
export const emptyBlock = (title, text, action) => html`<div class="area__vazio ag-vazio">
  ${raiz()}
  <p><b>${title}</b></p>
  ${text ? html`<p>${text}</p>` : nothing}
  ${action || nothing}
</div>`;

let sheetSeq = 0;

/**
 * Uma janela sobre a página com a barra de ferro em cima. `view(close)` devolve o corpo; chame
 * `refresh()` depois de uma mudança. Resolve `done` com o que foi passado para close(value).
 */
export function openSheet({ title, view, size = "wide", isDirty, label }) {
  const dialog = document.createElement("dialog");
  const id = `ag-sheet-${++sheetSeq}`;
  dialog.className = `dialog ag-sheet ag-sheet--${size}`;
  dialog.setAttribute("aria-labelledby", `${id}-title`);
  document.body.append(dialog);
  let result;
  let resolveDone;
  const done = new Promise((resolve) => (resolveDone = resolve));
  const handle = openDialog(dialog, {
    isDirty,
    onClose: () => {
      render(nothing, dialog);
      dialog.remove();
      resolveDone(result);
    },
  });
  const close = (value) => {
    result = value;
    handle.close();
  };
  const refresh = () =>
    render(
      html`<div class="dialog__bar">
          <h2 class="dialog__title ag-sheet__title" id=${`${id}-title`}>${title}</h2>
          <button class="dialog__close" type="button" data-close aria-label=${label || "Fechar"}>×</button>
        </div>
        <div class="dialog__body ag-sheet__body">${view(close, refresh)}</div>`,
      dialog,
    );
  refresh();
  dialog.querySelector(".dialog__body [autofocus], .dialog__body input, .dialog__body select, .dialog__body button")?.focus();
  return { close, refresh, done, dialog };
}

/** "qua 22/10" mais "hoje"/"amanhã" quando for um deles. */
export function dayLabel(date, today) {
  if (date === today) return `hoje, ${formatDay(date, "dm")}`;
  if (date === addDays(today, 1)) return `amanhã, ${formatDay(date, "dm")}`;
  return formatDay(date);
}

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Se esta pessoa pode fazer uma operação ("DELETE /staff/layouts/{id}"): o arquivo de permissões
 * decide, com as áreas que o dono liberou (história 1.3); as telas não guardam lista de perfis.
 */
export const can = (user, operation) => canDo(user?.role, operation, user?.areas ?? undefined);

/** Lê "19:00, 19:30 20:00" como ["19:00", "19:30", "20:00"]. */
export const parseTimes = (text) =>
  String(text || "")
    .split(/[\s,;]+/)
    .map((t) => t.trim().replace(/h$/i, ":00").replace(/^(\d)(:|h)/, "0$1$2").replace("h", ":"))
    .filter(Boolean)
    .map((t) => (/^\d{2}$/.test(t) ? `${t}:00` : t));

/** O valor de um campo numérico, ou null quando vazio. */
export const intOrNull = (value) => (value === "" || value == null ? null : Number.parseInt(value, 10));

// ---- a última cópia vista, para as telas sem conexão ----------------------------------

const COPY = (key) => `territorio:ag-ultima:${key}`;

/** Guarda o que a tela carregou, para ainda poder ser lido sem conexão. */
export const remember = (key, value) => session.set(COPY(key), value);

/** A última cópia carregada de `key`, ou null. */
export const recall = (key) => session.get(COPY(key), null);

/** Uma falha porque a conexão caiu (ou o navegador já sabe que está offline). */
export const isOffline = (error) => error?.type === "network" || error?.type === "timeout" || (typeof navigator !== "undefined" && navigator.onLine === false);

/** A linha de só leitura no topo de uma tela mostrada a partir da última cópia. */
export const offlineNotice = () => html`<div class="notice notice--alert ag-sem-conexao" role="status">Sem conexão. Você vê a última versão.</div>`;

