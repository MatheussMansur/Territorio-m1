// Peças comuns às áreas Clientes, Equipe, Registro e Sistema: os estados de carregando, vazio e
// erro com a raiz, o submenu de uma área, datas do jeito da casa, a
// checagem de identidade antes de uma ação sensível e salvar um arquivo.
import "./comum.css";
import { openDialog } from "../../../components/dialog.js";
import { showFormErrors } from "../../../components/field.js";
import { formatDay, houseParts, relativeDay } from "../../../lib/dates.js";
import { html, nothing, render } from "../../../lib/html.js";
import { staffErrorMessage } from "../../../lib/errors.js";
import { t } from "../../../lib/strings.js";

export const raiz = (extra = "") => html`<span class="raiz ${extra}" aria-hidden="true"></span>`;

/** Uma frase para a pessoa, do catálogo da casa (história 1.5), nunca o texto cru do servidor. */
export const messageOf = (error, variant) => staffErrorMessage(error, { variant });

export const loadingState = (text = "Carregando…") =>
  html`<div class="area__vazio" role="status">${raiz("raiz--gira")}<p>${text}</p></div>`;

/** Um lugar vazio sempre diz o que fazer a seguir. */
export const emptyState = ({ title, text, action }) =>
  html`<div class="area__vazio vazio">
    ${raiz()}
    ${title ? html`<p class="vazio__titulo">${title}</p>` : nothing}
    ${text ? html`<p>${text}</p>` : nothing}
    ${action ? html`<button class="btn btn--sm btn--outline vazio__acao" type="button" @click=${action.onClick}>${action.label}</button>` : nothing}
  </div>`;

/** Falha contida: só este lugar avisa, com um jeito de tentar de novo. */
export const errorState = (error, retry, title = "Essa parte não abriu") =>
  html`<div class="area__vazio" role="alert">
    ${raiz("raiz--atencao")}
    <p><b>${title}.</b> ${messageOf(error)}</p>
    ${retry ? html`<button class="btn btn--sm" type="button" @click=${retry}>${t("common.retry")}</button>` : nothing}
  </div>`;

/** As páginas de uma área como links (o roteador do painel passa entre elas). */
export const subnav = (label, links, current) =>
  html`<nav class="subnav" aria-label=${label}>
    ${links.map(
      (l) => html`<a class="subnav__item" href=${l.href} aria-current=${l.key === current ? "page" : nothing}>${l.label}${l.count ? html` <span class="count">${l.count}</span>` : nothing}</a>`,
    )}
  </nav>`;

// ---- datas ------------------------------------------------------------------------------

/** "hoje, 20:31", "ontem, 19:02", "qua 08/10, 21:15". */
export function when(iso, now = new Date()) {
  if (!iso) return "—";
  const at = houseParts(iso);
  const today = houseParts(now).date;
  const diff = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${at.date}T00:00:00Z`)) / 86_400_000);
  const day = diff === 0 ? "hoje" : diff === 1 ? "ontem" : formatDay(at.date);
  return `${day}, ${at.time}`;
}

/** "qua 08/10" ou "hoje". */
export function dayOf(iso, now = new Date()) {
  if (!iso) return "—";
  const date = houseParts(iso).date;
  const today = houseParts(now).date;
  if (date === today) return "hoje";
  return formatDay(date);
}

export const longDay = (date, now = new Date()) => {
  const rel = relativeDay(date, houseParts(now).date);
  return rel === "hoje" || rel === "amanhã" ? `${rel}, ${formatDay(date, "long")}` : formatDay(date, "long");
};

/** "agora", "há 5 min", "há 3 h", "há 2 dias". */
export function since(iso, now = new Date()) {
  if (!iso) return "nunca";
  const min = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return `há ${d} ${d === 1 ? "dia" : "dias"}`;
}

/** Dias inteiros de agora até `iso` (negativo quando já passou). */
export const daysUntil = (iso, now = new Date()) => Math.ceil((new Date(iso).getTime() - now.getTime()) / 86_400_000);

// ---- checagem de identidade ----------------------------------------------------------------------

// A única checagem de identidade do painel (senha e código, conferidos pela API, valem 5 minutos)
// fica em src/admin/identity.js; estes nomes ficam para as áreas que já os usam.
export { confirmIdentity, identityFresh as recentlyConfirmed } from "../../identity.js";

let seq = 0;

/** Oferece um arquivo para salvar, feito na própria página (exportar). */
export function saveFile(content, filename, type = "application/json") {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** "joao-pedro-almeida" para nomes de arquivo. */
export const slug = (s) =>
  String(s || "arquivo")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "arquivo";

/**
 * Uma janela pequena com um formulário. `onSubmit(form)` devolve o que a janela resolve; quando
 * dá erro, os erros de campo vão embaixo de cada campo e o resto aparece dentro da janela.
 * Resolve null quando a pessoa desiste.
 */
export function formDialog({ title, intro, body, submitLabel = "Gravar", danger = false, onSubmit }) {
  return new Promise((resolve) => {
    const id = `janela-${++seq}`;
    const dialog = document.createElement("dialog");
    dialog.className = "dialog dialog--confirm janela";
    dialog.setAttribute("aria-labelledby", `${id}-titulo`);
    document.body.append(dialog);
    let answer = null;
    let busy = false;
    let dirty = false;

    const submit = async (event) => {
      event.preventDefault();
      if (busy) return;
      const form = event.currentTarget;
      const button = form.querySelector("[type=submit]");
      const problemHost = form.querySelector(".janela__problema");
      busy = true;
      button.setAttribute("aria-busy", "true");
      render(nothing, problemHost);
      try {
        answer = (await onSubmit(form)) ?? true;
        dialog.close();
      } catch (error) {
        const fields = error?.fieldErrors || error?.fields || {};
        const known = Object.keys(fields).filter((name) => form.elements.namedItem(name));
        if (known.length) showFormErrors(form, fields);
        else render(html`<p class="notice notice--alert" role="alert">${error?.message && !error.status && !error.type ? error.message : messageOf(error)}</p>`, problemHost);
      } finally {
        busy = false;
        button.removeAttribute("aria-busy");
      }
    };

    render(
      html`<form class="dialog__body" novalidate @submit=${submit} @input=${() => (dirty = true)}>
        <h2 id=${`${id}-titulo`}>${title}</h2>
        ${intro ? html`<p>${intro}</p>` : nothing}
        ${body}
        <div class="janela__problema"></div>
        <div class="dialog__actions">
          <button type="button" class="btn btn--outline btn--sm" data-close>${t("common.back")}</button>
          <button type="submit" class=${`btn btn--sm${danger ? " btn--danger" : ""}`}>${submitLabel}</button>
        </div>
      </form>`,
      dialog,
    );
    openDialog(dialog, {
      isDirty: () => dirty && !answer,
      onClose: () => {
        dialog.remove();
        resolve(answer);
      },
    });
    dialog.querySelector("input:not([type=hidden]), select, textarea")?.focus();
  });
}

/** Um erro que a própria tela levanta para um campo de uma janela de formulário. */
export function fieldError(name, message) {
  const error = new Error(message);
  error.fields = { [name]: message };
  return error;
}
