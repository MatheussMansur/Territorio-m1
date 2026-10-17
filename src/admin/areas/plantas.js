// Plantas (histórias 3.1 a 3.3): as plantas da casa (criar, duplicar, arquivar), as áreas
// da casa (criar, renomear, remover uma que nenhuma planta usa), e o editor onde cada planta escolhe
// as áreas e o tamanho delas, e as mesas são arrastadas numa grade de quadrados de 0,5 m, juntadas e
// editadas. Uma planta em uso é gravada passando por "quem perde mesa" (./agenda/effect.js).
import "./plantas.css";
import { confirmAction } from "../../components/confirm.js";
import { showFormErrors } from "../../components/field.js";
import { toast } from "../../components/toast.js";
import { formatDay } from "../../lib/dates.js";
import { html, nothing, render } from "../../lib/html.js";
import * as api from "../../services/api/staff-plantas.js";
import { withEffect } from "./agenda/effect.js";
import { can, emptyBlock, errorBlock, errorText, isOffline, loadingBlock, offlineNotice, openSheet, plural, recall, remember } from "./agenda/ui.js";
import { MODE_LONG, areaInUseSheet, areaSheet, usedByLabel } from "./plantas/areas.js";
import { mountEditor } from "./plantas/editor.js";

const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** Estilo "qua a sáb": os dias da semana de que uma planta é o padrão. */
export function weekdaysLabel(list) {
  if (!list?.length) return "";
  const sorted = [...list].sort();
  const consecutive = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  if (consecutive && sorted.length > 2) return `${WEEKDAYS[sorted[0]]} a ${WEEKDAYS[sorted.at(-1)]}`;
  return sorted.map((d) => WEEKDAYS[d]).join(", ");
}

const usage = (l) => {
  const parts = [];
  if (l.used_by?.weekdays?.length) parts.push(`Padrão de ${weekdaysLabel(l.used_by.weekdays)}`);
  if (l.used_by?.dates?.length) parts.push(plural(l.used_by.dates.length, "data que vem", "datas que vêm"));
  return parts.join(" · ");
};
const inUse = (l) => Boolean(l.used_by?.weekdays?.length || l.used_by?.dates?.length);

export async function mount(container, { user, sub, navigate }) {
  if (sub) return mountEditor(container, { id: sub, user, navigate, save: saveLayout });
  return mountList(container, { user, navigate });
}

/** Grava passando pela simulação das noites que usam a planta, com a versão lida. */
async function saveLayout(id, body, version) {
  return withEffect({
    title: "O efeito nas noites com reserva",
    simulate: () => api.updateLayout(id, body, { dryRun: true }),
    commit: ({ resolutions, notify, confirm }) => api.updateLayout(id, { ...body, resolutions, notify_affected: notify, confirm_conflicts: confirm || undefined }, { version }),
  });
}

// ---- a lista --------------------------------------------------------------------------------

function mountList(container, { user, navigate }) {
  let status = "loading";
  let error = null;
  let layouts = [];
  let areas = [];
  let alive = true;
  let offline = false; // sem conexão: a última lista vista, só para ler
  const controller = new AbortController();

  async function load() {
    status = "loading";
    draw();
    try {
      [layouts, areas] = await Promise.all([api.layouts({ signal: controller.signal }), api.areas({ signal: controller.signal })]);
      remember("plantas", { layouts, areas });
      offline = false;
      status = "ready";
    } catch (e) {
      if (!alive || e?.name === "AbortError") return;
      const copy = isOffline(e) ? recall("plantas") : null;
      if (copy) {
        ({ layouts, areas } = copy);
        offline = true;
        status = "ready";
      } else {
        status = "error";
        error = e;
      }
    }
    draw();
  }

  async function create() {
    const created = await nameSheet({
      title: "Criar planta",
      label: "Nome da planta",
      placeholder: "Ex.: Noite de jogo",
      withDescription: true,
      areas,
      send: (body) => api.createLayout({ ...body, areas: body.areas.map((key) => ({ key })), tables: [], combos: [] }),
    });
    if (created) {
      toast({ title: "Planta criada", message: "Agora ponha as mesas." });
      navigate(`/admin/plantas/${created.id}`);
    }
  }

  async function duplicate(layout) {
    try {
      const copy = await api.duplicateLayout(layout.id);
      toast({ title: "Cópia criada", message: `${copy.name}: nenhuma noite mudou.`, action: { label: "Editar", onClick: () => navigate(`/admin/plantas/${copy.id}`) } });
      load();
    } catch (e) {
      toast({ title: "Não deu para duplicar", message: errorText(e), kind: "error" });
    }
  }

  async function archive(layout) {
    if (inUse(layout)) return inUseSheet(layout);
    const ok = await confirmAction({ title: `Arquivar ${layout.name}?`, message: "Ela sai da lista e das escolhas da Agenda. O histórico fica guardado.", confirmLabel: "Arquivar", danger: true });
    if (!ok) return;
    try {
      await api.archiveLayout(layout.id);
      toast({ title: "Planta arquivada", message: layout.name });
      load();
    } catch (e) {
      if (e?.status === 409) return inUseSheet({ ...layout, used_by: e.body?.used_by || layout.used_by });
      toast({ title: "Não deu para arquivar", message: errorText(e), kind: "error" });
    }
  }

  async function restore(layout) {
    try {
      await api.updateLayout(layout.id, { archived: false });
      toast({ title: "Planta de volta à lista", message: layout.name });
      load();
    } catch (e) {
      toast({ title: "Não deu para desarquivar", message: errorText(e), kind: "error" });
    }
  }

  async function renameArea(area) {
    const saved = await areaSheet({ title: `Renomear ${area.name}`, area, send: (body) => api.updateArea(area.id, body) });
    if (saved) {
      toast({ title: "Área renomeada", message: saved.name });
      load();
    }
  }

  async function createArea() {
    const saved = await areaSheet({ title: "Nova área", send: (body) => api.createArea(body) });
    if (saved) {
      toast({ title: "Área criada", message: `${saved.name}: ponha ela nas plantas que a usam.` });
      load();
    }
  }

  async function removeArea(area) {
    if (area.used_by?.length) return areaInUseSheet(area);
    const ok = await confirmAction({ title: `Apagar a área ${area.name}?`, message: "Nenhuma planta usa esta área. Ela sai da casa.", confirmLabel: "Apagar área", danger: true });
    if (!ok) return;
    try {
      await api.deleteArea(area.id);
      toast({ title: "Área apagada", message: area.name });
      load();
    } catch (e) {
      if (e?.status === 409) return areaInUseSheet({ ...area, used_by: e.body?.used_by || area.used_by });
      toast({ title: "Não deu para apagar", message: errorText(e), kind: "error" });
    }
  }

  const row = (l) => html`<tr>
    <td data-label="Planta" class="is-wide">
      <a class="pl-nome" href=${`/admin/plantas/${l.id}`}>${l.name}</a>
      ${l.description ? html`<small class="pl-desc">${l.description}</small>` : nothing}
    </td>
    <td data-label="Em uso">${usage(l) || "Nenhuma noite"}</td>
    <td data-label="Mesas" class="num">${plural(l.tables.length, "mesa", "mesas")} · ${l.seats_total} lug.</td>
    <td data-label="Situação">
      ${l.archived ? html`<span class="badge badge--expired">arquivada</span>` : inUse(l) ? html`<span class="badge badge--confirmed">em uso</span>` : html`<span class="badge">livre</span>`}
    </td>
    <td data-label="Ações" class="is-wide">
      <div class="pl-acoes">
        ${offline
          ? html`<a class="action pl-link" href=${`/admin/plantas/${l.id}`}>Ver</a>`
          : l.archived
          ? html`<button class="action" type="button" @click=${() => restore(l)}>Desarquivar</button>`
          : html`<a class="action pl-link" href=${`/admin/plantas/${l.id}`}>Editar</a>
              <button class="action" type="button" @click=${() => duplicate(l)} aria-label=${`Duplicar ${l.name}`}>Duplicar</button>
              ${can(user, "DELETE /staff/layouts/{id}") ? html`<button class="action action--alert" type="button" @click=${() => archive(l)} aria-label=${`Arquivar ${l.name}`}>Arquivar</button>` : nothing}`}
      </div>
    </td>
  </tr>`;

  const table = (list, label) => html`<div class="table-wrap">
    <table class="data-table data-table--stack" aria-label=${label}>
      <thead><tr><th>Planta</th><th>Em uso</th><th>Mesas</th><th>Situação</th><th><span class="sr-only">Ações</span></th></tr></thead>
      <tbody>${list.map(row)}</tbody>
    </table>
  </div>`;

  function draw() {
    if (!alive) return;
    const active = layouts.filter((l) => !l.archived);
    const archived = layouts.filter((l) => l.archived);
    render(
      html`<div class="ag pl">
        <div class="ag-barra">
          <p class="ag-legenda pl-intro">Cada planta é um jeito de montar a casa: a noite normal, a de chuva, a de evento. A Agenda escolhe qual vale em cada dia.</p>
          ${offline ? nothing : html`<button class="btn" type="button" @click=${create}>Criar planta</button>`}
        </div>
        ${offline ? offlineNotice() : nothing}
        ${status === "loading" ? loadingBlock("Abrindo as plantas…") : nothing}
        ${status === "error" ? errorBlock(error, load) : nothing}
        ${status === "ready" && !active.length
          ? emptyBlock("Nenhuma planta ainda", "Crie a primeira planta e ponha as mesas do salão, do quintal e do balcão.", html`<button class="btn" type="button" @click=${create}>Criar planta</button>`)
          : nothing}
        ${status === "ready" && active.length ? table(active, "Plantas") : nothing}
        ${status === "ready" && archived.length
          ? html`<details class="pl-arquivadas">
              <summary>Arquivadas · ${archived.length}</summary>
              ${table(archived, "Plantas arquivadas")}
            </details>`
          : nothing}
        ${status === "ready" && areas.length
          ? html`<section class="pl-areas" aria-labelledby="pl-areas-titulo">
              <div class="pl-areas__topo">
                <h2 class="ag-secao" id="pl-areas-titulo">Áreas da casa</h2>
                ${offline ? nothing : html`<button class="btn btn--outline" type="button" @click=${createArea}>Nova área</button>`}
              </div>
              <p class="ag-ajuda">Cada planta escolhe as áreas que usa, o tamanho de cada uma e como ela funciona: com mesas, com lista por pessoa ou fechada. Um evento pode ter a própria área, como uma tenda.</p>
              <ul class="pl-areas__lista">
                ${areas.map(
                  (a) => html`<li>
                    <div class="pl-areas__texto">
                      <b>${a.name}</b>
                      <small class="pl-desc">De começo, ${MODE_LONG[a.default_mode || "tables"]}${a.default_mode === "list" && a.default_list_capacity ? ` de ${a.default_list_capacity}` : ""}. ${a.used_by?.length ? `Em uso: ${usedByLabel(a)}.` : "Nenhuma planta usa."}</small>
                    </div>
                    ${offline
                      ? nothing
                      : html`<div class="pl-acoes">
                          <button class="action" type="button" @click=${() => renameArea(a)} aria-label=${`Renomear ${a.name}`}>Renomear</button>
                          ${can(user, "DELETE /staff/areas/{id}") ? html`<button class="action action--alert" type="button" @click=${() => removeArea(a)} aria-label=${`Apagar ${a.name}`}>Apagar</button>` : nothing}
                        </div>`}
                  </li>`,
                )}
              </ul>
            </section>`
          : nothing}
      </div>`,
      container,
    );
  }

  load();
  return () => {
    alive = false;
    controller.abort();
    render(nothing, container);
  };
}

/** Um formulário pequeno com um nome (e uma descrição, e as áreas iniciais), enviado por `send`. */
async function nameSheet({ title, label, value = "", placeholder = "", withDescription = false, areas = null, send }) {
  const form = { name: value, description: "", areas: (areas || []).map((a) => a.key) };
  let busy = false;
  const sheet = openSheet({
    title,
    size: "narrow",
    isDirty: () => form.name !== value,
    view: (close, refresh) => {
      const submit = async (event) => {
        event.preventDefault();
        const el = event.currentTarget;
        if (!form.name.trim()) return showFormErrors(el, { name: "Escreva um nome." });
        if (areas && !form.areas.length) return toast({ title: "Escolha pelo menos uma área", message: "A planta precisa de uma área para as mesas.", kind: "error" });
        busy = true;
        refresh();
        try {
          close(await send({ name: form.name.trim(), description: form.description.trim(), areas: form.areas }));
        } catch (e) {
          busy = false;
          refresh();
          if (e?.status === 422) showFormErrors(el, e.fieldErrors);
          else toast({ title: "Não deu para gravar", message: errorText(e), kind: "error" });
        }
      };
      return html`<form class="ag-form" novalidate @submit=${submit}>
        <label class="field">
          <span class="field__label">${label}</span>
          <input class="field__input" name="name" autocomplete="off" .value=${form.name} placeholder=${placeholder} @input=${(e) => (form.name = e.target.value)} />
        </label>
        ${withDescription
          ? html`<label class="field">
              <span class="field__label">Para quando <small>opcional</small></span>
              <input class="field__input" name="description" autocomplete="off" .value=${form.description} placeholder="Ex.: quando tem jogo no telão" @input=${(e) => (form.description = e.target.value)} />
            </label>`
          : nothing}
        ${areas?.length
          ? html`<fieldset class="ag-campo-grupo field">
              <legend class="field__label">Áreas desta planta</legend>
              <div class="ag-chips">
                ${areas.map(
                  (a) => html`<label class="ag-chip"
                    ><input
                      type="checkbox"
                      .checked=${form.areas.includes(a.key)}
                      @change=${(e) => (form.areas = e.target.checked ? [...form.areas, a.key] : form.areas.filter((k) => k !== a.key))}
                    /><span>${a.name}</span></label
                  >`,
                )}
              </div>
              <small class="ag-ajuda">Dá para pôr e tirar áreas depois, no desenho.</small>
            </fieldset>`
          : nothing}
        <div class="dialog__actions">
          <button class="btn btn--outline" type="button" data-close>Voltar</button>
          <button class="btn" type="submit" aria-busy=${busy ? "true" : "false"} ?disabled=${busy}>Gravar</button>
        </div>
      </form>`;
    },
  });
  return sheet.done;
}

/** conflict.layout_in_use: os dias que ainda usam a planta, cada um um caminho para mudá-la. */
function inUseSheet(layout) {
  openSheet({
    title: "Essa planta está em uso",
    size: "narrow",
    view: () => html`<p>Ela é a planta de algum dia que vem aí. Troque a planta desses dias antes de arquivar.</p>
      <ul class="ag-lista">
        ${layout.used_by?.weekdays?.length ? html`<li>Padrão de ${weekdaysLabel(layout.used_by.weekdays)} <small class="ag-ajuda">(muda em Configurações · Horários)</small></li>` : nothing}
        ${(layout.used_by?.dates || []).map((d) => html`<li><a href=${`/admin/agenda/${d}`} data-close>${formatDay(d, "long")}</a></li>`)}
      </ul>
      <div class="dialog__actions">
        <button class="btn btn--outline" type="button" data-close>Voltar</button>
        <a class="btn" href="/admin/agenda" data-close>Ver os dias</a>
      </div>`,
  });
}
