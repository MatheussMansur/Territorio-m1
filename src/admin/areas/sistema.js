// Sistema (história 1.14), só do dono: num lugar só, se o WhatsApp, a fila de envio, os
// backups e o teste de restauração estão em dia, os erros recentes, e cada aparelho da casa com
// quando foi visto por último e o quanto o relógio dele está longe do servidor. Quando a própria
// checagem falha, todo item mostra "com problema" e a tela continua inteira.
import "./sistema.css";
import { html, nothing, render } from "../../lib/html.js";
import * as api from "../../services/api/staff-sistema.js";
import { staffErrorMessage } from "../../lib/errors.js";
import { since, when } from "./clientes/comum.js";

const ITEMS = [
  { key: "whatsapp", label: "WhatsApp" },
  { key: "queue", label: "Fila de envio" },
  { key: "backup", label: "Último backup" },
  { key: "restore", label: "Teste de restauração" },
  { key: "errors", label: "Erros recentes" },
  { key: "google", label: "Agenda do Google" },
];
const STATE = {
  ok: { label: "em dia", cls: "is-ok" },
  problem: { label: "com problema", cls: "is-problema" },
  not_connected: { label: "não ligado", cls: "is-desligado" },
};
const KIND = { desktop: "Computador", tablet: "Tablet", phone: "Celular" };
const DEVICE_STATUS = {
  approved: { label: "aprovado", cls: "badge--confirmed" },
  pending: { label: "esperando aprovação", cls: "badge--pending" },
  revoked: { label: "revogado", cls: "badge--canceled" },
  rejected: { label: "recusado", cls: "badge--canceled" },
  expired: { label: "vencido", cls: "badge--expired" },
};
const SKEW_LIMIT_S = 60;

function clock(skew) {
  if (skew === undefined || skew === null) return html`<span class="fraco">—</span>`;
  const abs = Math.abs(skew);
  if (abs <= SKEW_LIMIT_S) return html`<span class="relogio is-ok">certo${abs >= 2 ? html` <span class="fraco">(${skew > 0 ? "+" : "−"}${abs} s)</span>` : nothing}</span>`;
  const min = Math.round(abs / 60);
  return html`<span class="relogio is-problema"><span class="badge badge--pending">${skew > 0 ? "adiantado" : "atrasado"} ${min} min</span></span>`;
}

export async function mount(container) {
  const state = { status: "loading", data: null, error: null, devices: null, devicesError: null };
  const controller = new AbortController();
  let gone = false;
  const draw = () => !gone && render(view(), container);

  async function load() {
    state.status = "loading";
    draw();
    const [status, devices] = await Promise.allSettled([api.status({ signal: controller.signal }), api.devices({ signal: controller.signal })]);
    if (controller.signal.aborted) return;
    if (status.status === "fulfilled") {
      state.data = status.value;
      state.error = null;
    } else {
      state.data = null;
      state.error = status.reason;
    }
    state.devices = devices.status === "fulfilled" ? devices.value : null;
    state.devicesError = devices.status === "rejected" ? devices.reason : null;
    state.status = "ready";
    draw();
  }

  function items() {
    const now = state.data ? new Date(state.data.checked_at) : new Date();
    const byKey = Object.fromEntries((state.data?.items || []).map((i) => [i.key, i]));
    return html`<ul class="sistema__itens">
      ${ITEMS.map((meta) => {
        const item = state.data ? byKey[meta.key] : { state: "problem", detail: "Não deu para conferir agora.", checked_at: null };
        const s = STATE[item?.state] || STATE.problem;
        return html`<li class=${`sistema__item ${s.cls}`}>
          <h3 class="sistema__nome">${meta.label}</h3>
          <p class="sistema__estado"><span class="sistema__marca" aria-hidden="true"></span>${s.label}</p>
          <p class="sistema__detalhe">${item?.detail || "—"}</p>
          <p class="sistema__hora">${item?.checked_at ? `${meta.key === "backup" || meta.key === "restore" ? "Feito" : "Conferido"} ${when(item.checked_at, now)} · ${since(item.checked_at, now)}` : "Sem horário"}</p>
        </li>`;
      })}
    </ul>`;
  }

  function errors() {
    const list = state.data?.errors || [];
    if (!state.data) return nothing;
    const now = new Date(state.data.checked_at);
    return html`<section class="bloco" aria-labelledby="erros-titulo">
      <h2 class="bloco__titulo" id="erros-titulo">Erros recentes</h2>
      ${list.length
        ? html`<ol class="sistema__erros">
            ${list.map(
              (e) => html`<li>
                <span class="mono sistema__erro-hora">${when(e.at, now)}</span>
                <span><b>${e.where}.</b> ${e.message}</span>
                <span class="mono fraco sistema__erro-id">código ${e.request_id}</span>
              </li>`,
            )}
          </ol>`
        : html`<p class="fraco">Nenhum erro nos últimos dias.</p>`}
    </section>`;
  }

  function devices() {
    let content;
    if (state.devicesError) {
      content = html`<p class="notice notice--alert" role="alert">Não deu para conferir os aparelhos agora. ${staffErrorMessage(state.devicesError)}</p>`;
    } else if (!state.devices?.length) {
      content = html`<div class="area__vazio"><span class="raiz" aria-hidden="true"></span><p class="vazio__titulo">Nenhum aparelho da casa ainda</p><p>Abra o painel no computador da recepção e peça para ele ser aparelho da casa. Depois aprove por aqui.</p></div>`;
    } else {
      const now = state.data ? new Date(state.data.checked_at) : new Date();
      const skews = Object.fromEntries((state.data?.clock || []).map((c) => [c.device_id, c.clock_skew_s]));
      content = html`<div class="table-wrap">
        <table class="data-table data-table--stack">
          <caption class="sr-only">Aparelhos da casa</caption>
          <thead><tr><th scope="col">Aparelho</th><th scope="col">Situação</th><th scope="col">Última vez</th><th scope="col">Relógio</th></tr></thead>
          <tbody>
            ${state.devices.map((d) => {
              const st = DEVICE_STATUS[d.status] || { label: d.status, cls: "" };
              return html`<tr>
                <td data-label="Aparelho" class="is-wide"><b>${d.name}</b><br /><span class="fraco">${KIND[d.kind] || d.kind} · ${d.location || "—"}</span></td>
                <td data-label="Situação"><span class=${`badge ${st.cls}`}>${st.label}</span></td>
                <td data-label="Última vez" class="num">${d.last_seen_at ? since(d.last_seen_at, now) : "nunca"}</td>
                <td data-label="Relógio">${d.status === "approved" || d.status === "pending" ? clock(skews[d.id]) : html`<span class="fraco">—</span>`}</td>
              </tr>`;
            })}
          </tbody>
        </table>
      </div>
      <p class="bloco__nota">Relógio com mais de 1 minuto de diferença atrapalha os horários de chegada e de tolerância. Acerte a hora do aparelho para automática.</p>`;
    }
    return html`<section class="bloco" aria-labelledby="aparelhos-titulo">
      <h2 class="bloco__titulo" id="aparelhos-titulo">Aparelhos da casa</h2>
      ${content}
    </section>`;
  }

  function view() {
    if (state.status === "loading" && !state.data && !state.error)
      return html`<div class="area__vazio" role="status"><span class="raiz raiz--gira" aria-hidden="true"></span><p>Conferindo a casa…</p></div>`;
    const problems = state.data ? state.data.items.filter((i) => i.state === "problem").length : ITEMS.length;
    return html`<div class="ferramentas sistema__topo">
        <p class="sistema__conferido" role="status">
          ${state.status === "loading"
            ? "Conferindo de novo…"
            : state.data
              ? problems
                ? `${problems} ${problems === 1 ? "item com problema" : "itens com problema"} · conferido ${when(state.data.checked_at)}`
                : `Tudo em dia · conferido ${when(state.data.checked_at)}`
              : "Não deu para conferir agora"}
        </p>
        <div class="ferramentas__fim">
          <button class="btn btn--sm btn--outline" type="button" aria-busy=${state.status === "loading" ? "true" : "false"} @click=${load}>Conferir de novo</button>
        </div>
      </div>
      ${state.error
        ? html`<div class="notice notice--alert sistema__falha" role="alert">
            <p><b>A conferência não respondeu.</b> ${staffErrorMessage(state.error)} Enquanto isso, trate cada item como com problema.</p>
          </div>`
        : nothing}
      <section class="bloco" aria-labelledby="estado-titulo">
        <h2 class="bloco__titulo" id="estado-titulo">Como está a casa</h2>
        ${items()}
      </section>
      ${errors()} ${devices()}`;
  }

  load();
  return () => {
    gone = true;
    controller.abort();
  };
}
