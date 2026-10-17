// "Enviar fotos": um lote em que cada foto ganha a descrição antes de subir, o próprio
// progresso e o próprio erro (grande demais, tipo errado, conexão caída) sem parar as
// outras.
import { html, nothing } from "../../../lib/html.js";
import * as api from "../../../services/api/staff-galeria.js";
import { openWindow, sayError, textField } from "../site/comum.js";

export const MAX_MB = 15;
const TYPES = ["image/jpeg", "image/png", "image/webp"];
export const ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";
export const AREAS = ["Fachada", "Salão", "Quintal", "Balcão", "Cozinha", "Pratos", "Cardápio", "Eventos"];

const isHeic = (file) => /\.hei[cf]$/i.test(file.name) || /hei[cf]/i.test(file.type);
const sizeLabel = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** A checagem do próprio front, a mesma que o servidor faz (413 e 415). */
export function checkFile(file) {
  if (isHeic(file)) return { code: "upload_type", text: `${file.name} não é uma foto aceita. Fotos do iPhone: em Ajustes > Câmera > Formatos, escolha Mais compatível.` };
  if (!TYPES.includes(file.type)) return { code: "upload_type", text: sayError("upload_type", { vars: { name: file.name } }) };
  if (file.size > MAX_MB * 1024 * 1024) return { code: "upload_too_large", text: sayError("upload_too_large", { vars: { name: file.name, max: MAX_MB } }) };
  return null;
}

/** A frase do catálogo para uma foto que não subiu (upload_too_large, upload_type, upload_failed…). */
function messageFor(error, file) {
  const vars = { name: file.name, max: MAX_MB };
  if (error?.status === 413) return sayError("upload_too_large", { vars });
  if (error?.status === 415) return sayError("upload_type", { vars });
  if (error?.status === 422) return sayError("validation.alt_text");
  if (error?.type === "network" || error?.type === "timeout") return sayError("upload_failed", { vars });
  return sayError(error, { vars });
}

/** Abre a janela do lote para os arquivos escolhidos; `onDone()` recarrega a galeria. */
export function uploadWindow(files, { onDone }) {
  let sent = 0;
  const rows = [...files].map((file, i) => {
    const problem = checkFile(file);
    return {
      id: `envio-${i}`,
      file,
      url: problem ? null : URL.createObjectURL(file),
      alt: "",
      credit: "",
      area: "",
      state: problem ? "refused" : "ready", // pronta | enviando | feita | falhou | recusada
      message: problem?.text || "",
      altError: "",
    };
  });
  let started = false;

  const pending = () => rows.filter((r) => r.state === "ready" || r.state === "failed");
  const sending = () => rows.some((r) => r.state === "sending");

  async function send(row) {
    row.state = "sending";
    row.message = "";
    win.redraw();
    try {
      await api.upload(row.file, { alt: row.alt.trim(), credit: row.credit.trim(), area: row.area });
      row.state = "done";
      sent += 1;
    } catch (error) {
      row.state = "failed";
      if (error?.status === 422) row.altError = "Falta descrever a foto. Escreva em poucas palavras o que aparece. Quem usa leitor de tela depende disso.";
      row.message = messageFor(error, row.file);
    }
    win.redraw();
  }

  async function sendAll(event) {
    event.preventDefault();
    const list = pending();
    let firstMissing = null;
    for (const row of list) {
      row.altError = row.alt.trim() ? "" : "Falta descrever a foto. Escreva em poucas palavras o que aparece. Quem usa leitor de tela depende disso.";
      if (row.altError && !firstMissing) firstMissing = row;
    }
    if (firstMissing) {
      win.redraw();
      return requestAnimationFrame(() => document.getElementById(`${firstMissing.id}-alt`)?.focus());
    }
    started = true;
    // duas por vez: um celular no 4G não engasga, e uma falha não para o resto
    const queue = [...list];
    const worker = async () => {
      while (queue.length) await send(queue.shift());
    };
    await Promise.all([worker(), worker()]);
  }

  const stateLine = (row) => {
    if (row.state === "sending")
      return html`<div class="gl-envio__estado" role="status"><progress aria-label=${`Enviando ${row.file.name}`}></progress> Enviando…</div>`;
    if (row.state === "done") return html`<div class="gl-envio__estado" role="status"><progress value="100" max="100" aria-label=${`${row.file.name} enviada`}></progress> <span class="badge badge--confirmed">enviada</span></div>`;
    if (row.state === "failed" || row.state === "refused")
      return html`<div class="gl-envio__estado gl-envio__estado--erro" role="alert">
        <p>${row.message}</p>
        ${row.state === "failed" ? html`<button class="btn btn--sm btn--outline" type="button" @click=${() => send(row)}>Tentar de novo</button>` : nothing}
      </div>`;
    return nothing;
  };

  const win = openWindow({
    title: "Enviar fotos",
    size: "drawer",
    isDirty: () => !started && rows.some((r) => r.alt || r.credit),
    discard: { title: "Desistir do envio?", message: "As descrições que você escreveu vão se perder.", confirmLabel: "Desistir", cancelLabel: "Continuar" },
    onClose: () => {
      for (const r of rows) if (r.url) URL.revokeObjectURL(r.url);
      if (sent) onDone();
    },
    body: () => {
      const left = pending().length;
      const allDone = started && !sending() && !left;
      return html`<form class="gl-envio" novalidate @submit=${sendAll}>
        <p class="cs-dica">Descreva cada foto em poucas palavras: quem usa leitor de tela depende disso. JPG, PNG ou WebP, até ${MAX_MB} MB cada.</p>
        <ol class="gl-envio__lista">
          ${rows.map(
            (row) => html`<li class="gl-envio__item gl-envio__item--${row.state}">
              ${row.url ? html`<img class="gl-envio__foto" src=${row.url} alt="" width="96" height="96" />` : html`<span class="gl-envio__foto gl-envio__foto--vazia" aria-hidden="true"></span>`}
              <div class="gl-envio__campos">
                <p class="gl-envio__nome"><b>${row.file.name}</b> · ${sizeLabel(row.file.size)}</p>
                ${row.state === "refused"
                  ? nothing
                  : html`${textField({
                        id: `${row.id}-alt`,
                        name: "alt",
                        label: "O que aparece na foto",
                        value: row.alt,
                        max: 160,
                        multiline: true,
                        required: true,
                        error: row.altError,
                        onInput: (v) => {
                          row.alt = v;
                          if (v.trim()) row.altError = "";
                          win.redraw();
                        },
                      })}
                      <div class="gl-envio__linha">
                        ${textField({ id: `${row.id}-credito`, name: "credit", label: "Crédito", value: row.credit, max: 60, onInput: (v) => ((row.credit = v), win.redraw()) })}
                        <div class="field">
                          <label class="field__label" for=${`${row.id}-area`}>Área <small>opcional</small></label>
                          <select class="field__input" id=${`${row.id}-area`} @change=${(e) => (row.area = e.target.value)}>
                            <option value="">—</option>
                            ${AREAS.map((a) => html`<option value=${a} ?selected=${row.area === a}>${a}</option>`)}
                          </select>
                        </div>
                      </div>`}
                ${stateLine(row)}
              </div>
            </li>`,
          )}
        </ol>
        <div class="cs-acoes cs-acoes--fim">
          ${allDone
            ? html`<button class="btn" type="button" data-close>Ver na galeria</button>`
            : html`<button class="btn btn--outline" type="button" data-close>${started ? "Fechar" : "Cancelar"}</button>
                <button class="btn" type="submit" ?disabled=${!left || sending()} aria-busy=${sending() ? "true" : "false"}>
                  ${sending() ? "Enviando…" : left === 1 ? "Enviar 1 foto" : `Enviar ${left} fotos`}
                </button>`}
        </div>
      </form>`;
    },
  });
  return win;
}
