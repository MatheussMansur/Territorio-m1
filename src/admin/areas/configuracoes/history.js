// "Histórico" de um grupo de configurações (história 2.21): cada gravação com quem, quando, a versão e o
// antes e depois de cada campo, lido do registro de ações. "Voltar a esta versão" refaz os
// valores daquela versão e entrega à tela do grupo como mudanças marcadas comuns, para elas
// passarem pela barra de impacto e pelo "O que muda" como qualquer outra mudança. Segredos só dizem "trocado".
import { houseParts } from "../../../lib/dates.js";
import { html, nothing } from "../../../lib/html.js";
import * as api from "../../../services/api/staff-configuracoes.js";
import { rowForField } from "./catalog.js";
import { formatValue } from "./controls.js";

const top = (field) => String(field).split(/[.[]/)[0];

/** As gravações do grupo, a mais nova primeiro. */
export async function loadHistory(groupKey) {
  const page = await api.history(groupKey);
  return (page.items || [])
    .filter((e) => e.entity_type === "settings" && e.entity_id === groupKey && e.action === "settings.update")
    .sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)));
}

/**
 * Os valores da versão que uma entrada gravou: os valores atuais, com cada campo mudado por uma
 * gravação mais nova voltado ao que era antes dela.
 */
export function versionData(current, entries, entry) {
  const at = entries.indexOf(entry);
  const out = {};
  for (const newer of entries.slice(0, Math.max(at, 0))) {
    for (const [field, change] of Object.entries(newer.changes || {})) {
      if (change?.secret || !(top(field) in current)) continue;
      out[top(field)] = structuredClone(change.from);
    }
  }
  return out;
}

function stamp(iso) {
  if (!iso) return "";
  const at = houseParts(iso);
  const [, m, d] = at.date.split("-");
  return `${d}/${m} às ${at.time}`;
}

function changeView(group, field, change) {
  const row = rowForField(group, field);
  const label = row?.label || field;
  if (change?.secret) return html`<li><b>${label}</b> <span>trocado</span></li>`;
  const show = (v) => (row ? formatValue(row, v) : "") || (v == null || v === "" ? "vazio" : typeof v === "object" ? "texto" : String(v));
  return html`<li><b>${label}</b> <span class="cfg-muda__de">${show(change?.from)} → ${show(change?.to)}</span></li>`;
}

/**
 * O corpo do diálogo. `canGoBack` esconde "Voltar a esta versão" para quem só lê.
 * @param {{loading: boolean, entries: any[], error: string}} d
 */
export function historyDialog(d, { group, canGoBack, onBack }) {
  return html`<div class="dialog__body cfg-dialogo__corpo">
    <h2 id="cfg-dialogo-titulo">Histórico de ${group.label}</h2>
    ${d.loading ? html`<p role="status"><span class="raiz raiz--gira" aria-hidden="true"></span> Abrindo o histórico…</p>` : nothing}
    ${d.error ? html`<p class="cfg-erro" role="alert">${d.error}</p>` : nothing}
    ${!d.loading && !d.error && !d.entries.length ? html`<p>Nenhuma mudança gravada ainda. O grupo está no padrão da casa.</p>` : nothing}
    ${d.entries.length
      ? html`<ol class="cfg-historico">
          ${d.entries.map(
            (e, i) => html`<li class="cfg-historico__item">
              <p class="cfg-historico__quem">
                <b>${e.version ? `Versão ${e.version}` : "Gravação"}</b>${i === 0 ? html` <span class="badge badge--confirmed">atual</span>` : nothing}
                <span>${e.actor_label}, ${stamp(e.occurred_at)}</span>
              </p>
              <ul class="cfg-historico__campos">
                ${Object.entries(e.changes || {}).map(([field, change]) => changeView(group, field, change))}
              </ul>
              ${canGoBack && i > 0
                ? html`<button type="button" class="btn btn--outline btn--sm" aria-label=${`Voltar à versão ${e.version ?? ""} de ${stamp(e.occurred_at)}`} @click=${() => onBack(e)}>
                    Voltar a esta versão
                  </button>`
                : nothing}
            </li>`,
          )}
        </ol>`
      : nothing}
    <div class="dialog__actions">
      <button type="button" class="btn btn--sm" data-close data-foco>Fechar</button>
    </div>
  </div>`;
}
