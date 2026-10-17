// Agenda (histórias 3.4 a 3.6): o mês e a semana com cada noite aberta ou fechada, o seu
// layout, quão cheia está e o seu evento; o plano de uma data; o mesmo plano em várias datas.
// Toda mudança passa por "quem perde mesa" (./agenda/effect.js) antes de ser salva.
import "./agenda.css";
import { showFormErrors } from "../../components/field.js";
import { toast } from "../../components/toast.js";
import { addDays, formatDay, houseParts, shortTime, weekdayOf } from "../../lib/dates.js";
import { html, nothing, render } from "../../lib/html.js";
import * as api from "../../services/api/staff-agenda.js";
import { layouts as fetchLayouts } from "../../services/api/staff-plantas.js";
import { withEffect } from "./agenda/effect.js";
import { askConflict } from "./agenda/conflict.js";
import { asWords, localizedField } from "./agenda/words.js";
import { dayLabel, emptyBlock, errorBlock, errorText, intOrNull, isOffline, loadingBlock, offlineNotice, openSheet, parseTimes, plural, recall, remember } from "./agenda/ui.js";

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const WEEK = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const AREA_NAME = { salao: "Salão", quintal: "Quintal", balcao: "Balcão" };
/** O nome de uma área: os layouts lidos de Plantas trazem ele (a casa cria as suas próprias áreas). */
const areaName = (key, layouts = []) => layouts.flatMap((l) => l.areas || []).find((a) => a.key === key && a.name)?.name || AREA_NAME[key] || key;
const REASONS = [
  ["holiday", "Feriado"],
  ["maintenance", "Manutenção"],
  ["closed", "Outro motivo"],
];

// o que a pessoa estava olhando, guardado enquanto o painel está aberto (voltando de um dia)
const memory = { month: null, view: "mes", weekStart: null, cache: new Map() };

const nightToday = () => houseParts(new Date(Date.now() - 5 * 3_600_000)).date;
const monthOf = (date) => date.slice(0, 7);
const monthLabel = (month) => `${MONTHS[Number(month.slice(5)) - 1]} de ${month.slice(0, 4)}`;
const shiftMonth = (month, n) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const weekStartOf = (date) => addDays(date, -weekdayOf(date));
const hours = (d) => (d.opens_at && d.closes_at ? `${shortTime(d.opens_at)}–${shortTime(d.closes_at)}` : "");

export async function mount(container, { sub, navigate }) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(sub)) return mountDay(container, { date: sub });
  if (sub) return navigate("/admin/agenda");
  return mountMonth(container);
}

// ---- o mês e a semana ------------------------------------------------------------------

function mountMonth(container) {
  const today = nightToday();
  memory.month ||= monthOf(today);
  memory.weekStart ||= weekStartOf(today);
  let status = "loading";
  let error = null;
  let offline = false;
  let selecting = false;
  const selected = new Set();
  let alive = true;
  const controller = new AbortController();

  const monthsNeeded = () => (memory.view === "mes" ? [memory.month] : [...new Set([monthOf(memory.weekStart), monthOf(addDays(memory.weekStart, 6))])]);

  async function load() {
    status = "loading";
    draw();
    try {
      for (const month of monthsNeeded()) {
        const days = await api.calendar(month, { signal: controller.signal });
        memory.cache.set(month, days);
        remember(`mes:${month}`, days);
      }
      offline = false;
      status = "ready";
    } catch (e) {
      if (!alive || e?.name === "AbortError") return;
      // sem conexão, o último mês visto fica na tela, só para ler (também depois de recarregar)
      for (const m of monthsNeeded()) if (!memory.cache.has(m) && recall(`mes:${m}`)) memory.cache.set(m, recall(`mes:${m}`));
      offline = isOffline(e) && monthsNeeded().every((m) => memory.cache.has(m));
      status = offline ? "ready" : "error";
      error = e;
    }
    if (alive) draw();
  }

  const days = () => monthsNeeded().flatMap((m) => memory.cache.get(m) || []);

  const go = (patch) => {
    Object.assign(memory, patch);
    load();
  };

  function toggle(date) {
    if (selected.has(date)) selected.delete(date);
    else selected.add(date);
    draw();
  }

  async function bulk() {
    const dates = [...selected].sort();
    const saved = await bulkPlanSheet(dates);
    if (saved) {
      selected.clear();
      selecting = false;
      memory.cache.clear();
      load();
    }
  }

  const dayCell = (d) => {
    const closed = !d.open;
    const classes = ["ag-dia", closed ? "is-fechado" : "", d.is_today ? "is-hoje" : "", d.is_past ? "is-passado" : "", d.has_day_plan ? "is-especial" : "", selected.has(d.date) ? "is-escolhido" : ""].join(" ");
    const body = html`
      <span class="ag-dia__topo">
        <span class="ag-dia__num">${Number(d.date.slice(8))}</span>
        <span class="ag-dia__semana">${formatDay(d.date, "weekday")}</span>
        ${d.is_today ? html`<span class="badge ag-dia__hoje">hoje</span>` : nothing}
      </span>
      ${closed
        ? html`<span class="ag-dia__fechado"><b>Fechado</b>${d.reason_label && d.reason_label !== "fechado" ? html` · ${d.reason_label}` : nothing}</span>`
        : html`<span class="ag-dia__linha">${hours(d)} · ${d.layout_name}</span>
            <span class="ag-dia__linha">${d.reservations ? `${plural(d.reservations, "reserva", "reservas")} · ${d.people} pess.` : "Sem reservas"}</span>
            <span class="ag-ocupa" title=${`${d.occupancy_pct}% dos lugares`}>
              <span class="ag-ocupa__barra" style=${`--pct:${d.occupancy_pct}%`} aria-hidden="true"></span>
              <span class="ag-ocupa__num">${d.occupancy_pct}%</span>
            </span>`}
      ${d.waitlist ? html`<span class="ag-dia__linha">${d.waitlist} na espera</span>` : nothing}
      ${d.events.map((e) => html`<span class="ag-dia__evento">${e.published ? "Evento" : "Rascunho"}: ${e.title}</span>`)}
      ${d.has_day_plan ? html`<span class="badge ag-dia__marca">Fora do padrão</span>` : nothing}
    `;
    const label = `${formatDay(d.date, "long")}${d.is_today ? ", hoje" : ""}`;
    if (selecting) {
      return html`<button type="button" class=${classes} aria-pressed=${selected.has(d.date) ? "true" : "false"} ?disabled=${d.is_past} aria-label=${label} @click=${() => toggle(d.date)}>${body}</button>`;
    }
    return html`<a class=${classes} href=${`/admin/agenda/${d.date}`} aria-label=${`${label}: abrir o plano`}>${body}</a>`;
  };

  const monthGrid = () => {
    const list = days();
    const offset = list.length ? weekdayOf(list[0].date) : 0;
    return html`<div class="ag-mes">
      <div class="ag-mes__semana" aria-hidden="true">${WEEK.map((w) => html`<span>${w}</span>`)}</div>
      <ol class="ag-mes__dias" aria-label=${monthLabel(memory.month)}>
        ${Array.from({ length: offset }, () => html`<li class="ag-mes__vago" aria-hidden="true"></li>`)}
        ${list.map((d) => html`<li>${dayCell(d)}</li>`)}
      </ol>
    </div>`;
  };

  const weekGrid = () => {
    const byDate = new Map(days().map((d) => [d.date, d]));
    const week = Array.from({ length: 7 }, (_, i) => byDate.get(addDays(memory.weekStart, i))).filter(Boolean);
    return html`<ol class="ag-semana" aria-label=${`Semana de ${formatDay(memory.weekStart, "dm")}`}>
      ${week.map(
        (d) => html`<li class="ag-semana__dia ${d.open ? "" : "is-fechado"} ${d.is_today ? "is-hoje" : ""}">
          <h3 class="ag-semana__titulo">${dayLabel(d.date, today)}${d.has_day_plan ? html` <span class="badge">Fora do padrão</span>` : nothing}</h3>
          ${d.open
            ? html`<p class="ag-semana__linha">${hours(d)} · planta ${d.layout_name}</p>
                <ul class="ag-semana__horarios">
                  ${d.slots.map((t) => html`<li><b>${shortTime(t)}</b> <span>${d.people_by_slot[t] ? plural(d.people_by_slot[t], "pessoa", "pessoas") : "—"}</span></li>`)}
                </ul>
                ${d.held_tables?.length ? html`<p class="ag-semana__linha">Guardadas para quem chega: ${d.held_tables.join(", ")}</p>` : nothing}`
            : html`<p class="ag-semana__fechado"><b>Fechado</b>${d.reason_label ? ` · ${d.reason_label}` : ""}</p>`}
          ${d.events.map((e) => html`<p class="ag-dia__evento">${e.published ? "Evento" : "Rascunho"}: ${e.title}</p>`)}
          <a class="btn btn--outline btn--sm" href=${`/admin/agenda/${d.date}`}>Abrir o plano</a>
        </li>`,
      )}
    </ol>`;
  };

  function draw() {
    if (!alive) return;
    const isMonth = memory.view === "mes";
    const title = isMonth ? monthLabel(memory.month) : `Semana de ${formatDay(memory.weekStart, "dm")} a ${formatDay(addDays(memory.weekStart, 6), "dm")}`;
    const step = (n) => (isMonth ? go({ month: shiftMonth(memory.month, n) }) : go({ weekStart: addDays(memory.weekStart, 7 * n) }));
    const list = status === "ready" ? days() : [];
    const quiet = status === "ready" && list.every((d) => !d.reservations && !d.has_day_plan && !d.events.length);
    render(
      html`<div class="ag">
        <div class="ag-barra">
          <div class="ag-nav">
            <button class="action" type="button" aria-label=${isMonth ? "Mês anterior" : "Semana anterior"} @click=${() => step(-1)}>‹</button>
            <h2 class="ag-nav__titulo" aria-live="polite">${title}</h2>
            <button class="action" type="button" aria-label=${isMonth ? "Próximo mês" : "Próxima semana"} @click=${() => step(1)}>›</button>
          </div>
          <div class="ag-modos" role="group" aria-label="Ver por">
            <button class="action ${isMonth ? "action--solid" : ""}" type="button" aria-pressed=${isMonth ? "true" : "false"} @click=${() => go({ view: "mes", month: monthOf(memory.weekStart) })}>Mês</button>
            <button class="action ${isMonth ? "" : "action--solid"}" type="button" aria-pressed=${isMonth ? "false" : "true"} @click=${() => go({ view: "semana", weekStart: memory.month === monthOf(today) ? weekStartOf(today) : weekStartOf(`${memory.month}-01`) })}>Semana</button>
          </div>
          <button class="action" type="button" @click=${() => go({ month: monthOf(today), weekStart: weekStartOf(today) })}>Hoje</button>
          ${isMonth && !offline
            ? html`<button class="action ${selecting ? "action--solid" : ""}" type="button" aria-pressed=${selecting ? "true" : "false"} @click=${() => {
                selecting = !selecting;
                selected.clear();
                draw();
              }}>Várias datas</button>`
            : nothing}
        </div>
        ${offline ? offlineNotice() : nothing}
        ${selecting ? html`<p class="ag-ajuda">Toque nas datas que vão ter o mesmo plano (férias, uma sequência de feriados) e depois em "Definir o plano".</p>` : nothing}
        ${status === "loading" ? loadingBlock("Abrindo a agenda…") : nothing}
        ${status === "error" ? errorBlock(error, load) : nothing}
        ${status === "ready"
          ? html`${quiet ? html`<div class="notice ag-quieto">Nenhuma reserva nem dia especial neste período. Toque num dia para mudar o plano dele.</div>` : nothing}
              <p class="ag-legenda">Cada dia mostra o horário, a planta, as reservas e quanto dos lugares já está ocupado. <span class="badge">Fora do padrão</span> marca a data que foge da semana padrão.</p>
              ${isMonth ? monthGrid() : weekGrid()}`
          : nothing}
        ${selecting && selected.size
          ? html`<div class="ag-selecao" role="region" aria-label="Datas escolhidas">
              <span>${plural(selected.size, "data escolhida", "datas escolhidas")}</span>
              <button class="btn btn--outline btn--sm" type="button" @click=${() => {
                selected.clear();
                draw();
              }}>Limpar</button>
              <button class="btn btn--sm" type="button" @click=${bulk}>Definir o plano</button>
            </div>`
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

// ---- o formulário do plano (uma data ou várias) -------------------------------------------------------

function planFields({ plan, day, layouts, form, onChange, bulk = false }) {
  const open = form.open;
  const layout = layouts.find((l) => l.id === form.layout_id) || day?.layout || layouts[0];
  const tableAreas = (layout?.areas || []).filter((a) => a.mode !== "closed");
  const bookable = (layout?.tables || []).filter((t) => (layout.areas.find((a) => a.key === t.area)?.mode || "tables") === "tables");
  const set = (key) => (e) => onChange({ [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const toggleIn = (key, value) => (e) => {
    const list = new Set(form[key]);
    if (e.target.checked) list.add(value);
    else list.delete(value);
    onChange({ [key]: [...list] });
  };
  return html`
    <fieldset class="ag-campo-grupo">
      <legend class="field__label">Nesse ${bulk ? "período" : "dia"} a casa</legend>
      <div class="ag-escolhas">
        <label class="ag-escolha ${open ? "is-on" : ""}"><input type="radio" name="open" value="true" .checked=${open} @change=${() => onChange({ open: true })} /><span>Abre</span></label>
        <label class="ag-escolha ${open ? "" : "is-on"}"><input type="radio" name="open" value="false" .checked=${!open} @change=${() => onChange({ open: false })} /><span>Fecha</span></label>
      </div>
    </fieldset>
    ${open
      ? html`<div class="ag-grade">
            <label class="field"><span class="field__label">Abre às</span><input class="field__input" name="opens_at" type="time" .value=${form.opens_at || ""} @input=${set("opens_at")} /></label>
            <label class="field"><span class="field__label">Fecha às</span><input class="field__input" name="closes_at" type="time" .value=${form.closes_at || ""} @input=${set("closes_at")} /></label>
            <label class="field ag-grade__largo"><span class="field__label">Horários de chegada <small>separados por vírgula</small></span><input class="field__input" name="slots" .value=${form.slots} @input=${set("slots")} /></label>
            <label class="field ag-grade__largo">
              <span class="field__label">Planta</span>
              <select class="field__input" name="layout_id" @change=${set("layout_id")}>
                ${layouts.map((l) => html`<option value=${l.id} ?selected=${l.id === form.layout_id}>${l.name}</option>`)}
              </select>
            </label>
            <label class="field"><span class="field__label">Tempo de mesa <small>min</small></span><input class="field__input" name="duration_min" type="number" min="30" step="15" inputmode="numeric" placeholder="regra da casa" .value=${form.duration_min ?? ""} @input=${set("duration_min")} /></label>
            <label class="field"><span class="field__label">Pessoas por horário</span><input class="field__input" name="max_covers_per_slot" type="number" min="1" inputmode="numeric" placeholder="sem limite" .value=${form.max_covers_per_slot ?? ""} @input=${set("max_covers_per_slot")} /></label>
            <label class="field"><span class="field__label">Pessoas na noite</span><input class="field__input" name="max_covers_night" type="number" min="1" inputmode="numeric" placeholder="sem limite" .value=${form.max_covers_night ?? ""} @input=${set("max_covers_night")} /></label>
            <label class="field"><span class="field__label">Grupo máximo no site</span><input class="field__input" name="party_max_online" type="number" min="1" inputmode="numeric" placeholder="regra da casa" .value=${form.party_max_online ?? ""} @input=${set("party_max_online")} /></label>
          </div>
          ${tableAreas.length > 1
            ? html`<fieldset class="ag-campo-grupo">
                <legend class="field__label">Fechar uma área só nesse dia</legend>
                <div class="ag-chips">
                  ${tableAreas.map((a) => html`<label class="ag-chip"><input type="checkbox" .checked=${form.closed_areas.includes(a.key)} @change=${toggleIn("closed_areas", a.key)} /><span>${a.name || areaName(a.key, layouts)}</span></label>`)}
                </div>
              </fieldset>`
            : nothing}
          ${!bulk && bookable.length
            ? html`<fieldset class="ag-campo-grupo">
                <legend class="field__label">Mesas guardadas para quem chega sem reserva <small>saem do site</small></legend>
                <div class="ag-chips">
                  ${bookable.map((t) => html`<label class="ag-chip"><input type="checkbox" .checked=${form.held_tables.includes(t.code)} @change=${toggleIn("held_tables", t.code)} /><span>${t.code} · ${t.max_seats}</span></label>`)}
                </div>
              </fieldset>`
            : nothing}`
      : html`<div class="ag-grade">
          <label class="field">
            <span class="field__label">Motivo</span>
            <select class="field__input" name="closed_reason" @change=${set("closed_reason")}>
              ${REASONS.map(([value, label]) => html`<option value=${value} ?selected=${form.closed_reason === value}>${label}</option>`)}
            </select>
          </label>
          <div class="ag-grade__largo">
            ${localizedField({
              id: bulk ? "ag-motivo-varias" : "ag-motivo",
              label: "O que o cliente lê no calendário do site",
              name: "public_label",
              value: form.public_label,
              lang: form._lang || "pt",
              setLang: (l) => onChange({ _lang: l }),
              onInput: (value) => onChange({ public_label: value }),
              placeholder: "Ex.: Feriado",
            })}
          </div>
        </div>`}
    <label class="field">
      <span class="field__label">Nota da equipe <small>o cliente não vê</small></span>
      <textarea class="field__input" name="internal_note" rows="2" .value=${form.internal_note || ""} @input=${set("internal_note")}></textarea>
    </label>
    ${plan?.updated_by ? html`<p class="ag-ajuda">Gravado por ${plan.updated_by}, ${new Date(plan.updated_at).toLocaleDateString("pt-BR")}.</p>` : nothing}
  `;
}

/** Os valores iniciais do formulário: o plano guardado, senão a noite como ela funciona. */
function startForm(day, plan) {
  return {
    open: plan?.open ?? day?.open ?? true,
    closed_reason: plan?.closed_reason || "holiday",
    public_label: asWords(plan?.public_label),
    _lang: "pt",
    opens_at: plan?.opens_at ?? day?.opens_at ?? "19:00",
    closes_at: plan?.closes_at ?? day?.closes_at ?? "23:30",
    slots: (plan?.slots ?? day?.slots ?? []).join(", ") || "19:00, 19:30, 20:00, 20:30, 21:00, 21:30",
    layout_id: plan?.layout_id ?? day?.layout?.id ?? null,
    duration_min: plan?.duration_min ?? null,
    max_covers_per_slot: plan?.max_covers_per_slot ?? null,
    max_covers_night: plan?.max_covers_night ?? null,
    party_max_online: plan?.party_max_online ?? null,
    held_tables: [...(plan?.held_tables ?? day?.held_tables ?? [])],
    closed_areas: [...(plan?.closed_areas ?? [])],
    internal_note: plan?.internal_note || "",
  };
}

function planBody(form) {
  if (!form.open) {
    const label = asWords(form.public_label);
    const public_label = { pt: label.pt.trim(), es: label.es.trim(), en: label.en.trim() };
    return { open: false, closed_reason: form.closed_reason, public_label, internal_note: form.internal_note, held_tables: [], closed_areas: [] };
  }
  return {
    open: true,
    closed_reason: null,
    public_label: null,
    opens_at: form.opens_at || null,
    closes_at: form.closes_at || null,
    slots: parseTimes(form.slots),
    layout_id: form.layout_id,
    duration_min: intOrNull(form.duration_min),
    max_covers_per_slot: intOrNull(form.max_covers_per_slot),
    max_covers_night: intOrNull(form.max_covers_night),
    party_max_online: intOrNull(form.party_max_online),
    held_tables: form.held_tables,
    closed_areas: form.closed_areas,
    internal_note: form.internal_note,
  };
}

async function bulkPlanSheet(dates) {
  let layouts;
  try {
    layouts = (await fetchLayouts()).filter((l) => !l.archived);
  } catch (e) {
    toast({ title: "Não deu para abrir", message: errorText(e), kind: "error" });
    return false;
  }
  const form = startForm(null, null);
  form.layout_id = layouts[0]?.id ?? null;
  let errorBox = null;
  let busy = false;
  const sheet = openSheet({
    title: `Plano de ${plural(dates.length, "data", "datas")}`,
    isDirty: () => true,
    view: (close, refresh) => {
      const submit = async (event) => {
        event.preventDefault();
        const formEl = event.currentTarget;
        busy = true;
        refresh();
        const body = planBody(form);
        try {
          const saved = await withEffect({
            title: "O efeito em cada data",
            simulate: () => api.setPlans(dates, body, { dryRun: true }),
            commit: ({ resolutions, notify, confirm }) => api.setPlans(dates, { ...body, notify_affected: notify }, { confirm, resolutions }),
          });
          busy = false;
          if (saved) {
            toast({ title: "Plano gravado", message: `${plural(dates.length, "data segue", "datas seguem")} o novo plano.` });
            close(true);
          } else refresh();
        } catch (e) {
          busy = false;
          refresh();
          if (e?.status === 422) showFormErrors(formEl, e.fieldErrors, errorBox);
          else toast({ title: "Não deu para gravar", message: errorText(e), kind: "error" });
        }
      };
      return html`<form class="ag-form" novalidate @submit=${submit}>
        <p class="ag-sheet__lead">${dates.map((d) => formatDay(d)).join(" · ")}</p>
        <div class="ag-erros"></div>
        ${planFields({ plan: null, day: null, layouts, form, bulk: true, onChange: (patch) => (Object.assign(form, patch), refresh()) })}
        <div class="dialog__actions">
          <button class="btn btn--outline" type="button" data-close>Voltar</button>
          <button class="btn" type="submit" aria-busy=${busy ? "true" : "false"} ?disabled=${busy}>Ver o efeito e gravar</button>
        </div>
      </form>`;
    },
  });
  errorBox = sheet.dialog.querySelector(".ag-erros");
  return Boolean(await sheet.done);
}

// ---- uma data ----------------------------------------------------------------------------------

function mountDay(container, { date }) {
  let status = "loading";
  let error = null;
  let day = null;
  let layouts = [];
  let form = null;
  let busy = false;
  let alive = true;
  let offline = false;
  // a versão da data que a tela leu: a do seu plano, ou "semana" quando segue a semana
  let version = "semana";
  const controller = new AbortController();
  const today = nightToday();
  const COPY = `dia:${date}`;

  async function load() {
    status = "loading";
    draw();
    try {
      const [d, l] = await Promise.all([api.day(date, { signal: controller.signal }), fetchLayouts({ signal: controller.signal })]);
      day = d;
      layouts = l.filter((x) => !x.archived || x.id === d.layout?.id);
      form = startForm(day, day.plan);
      version = day.plan?.version ?? "semana";
      remember(COPY, { day, layouts });
      offline = false;
      status = "ready";
    } catch (e) {
      if (!alive || e?.name === "AbortError") return;
      const copy = isOffline(e) ? recall(COPY) : null;
      if (copy) {
        // sem conexão: a última versão vista, só para ler
        ({ day, layouts } = copy);
        form = startForm(day, day.plan);
        offline = true;
        status = "ready";
      } else {
        status = "error";
        error = e;
      }
    }
    draw();
  }

  /** "Fulano gravou antes de você": juntar (manter o formulário por cima da nova versão) ou descartar. */
  async function conflict(e) {
    const current = e.body?.current || {};
    const choice = await askConflict({ error: e, read: day.plan || {}, current: current.plan || {}, labels: PLAN_LABELS });
    if (choice === "join") {
      version = current.version ?? version;
      day = { ...day, plan: current.plan };
      toast({ title: "Juntamos", message: "As suas mudanças continuam no formulário. Grave de novo para valer." });
      draw();
    } else if (choice === "discard") {
      await load();
    }
  }

  // uma sessão que acaba ao salvar: client.js abre a entrada sobre a tela (identity.js)
  // e envia o mesmo pedido de novo, com a mesma versão lida; o formulário fica como estava
  async function save(body, formEl) {
    busy = true;
    draw();
    try {
      const done = await withEffect({
        title: `O efeito em ${formatDay(date)}`,
        simulate: () => api.setPlan(date, body, { dryRun: true }),
        commit: ({ resolutions, notify, confirm }) => api.setPlan(date, { ...body, resolutions, notify_affected: notify, confirm_conflicts: confirm || undefined }, { version }),
      });
      if (done) {
        toast({ title: "Plano do dia gravado", message: done.waitlist_offers ? `${plural(done.waitlist_offers, "pessoa da espera recebeu", "pessoas da espera receberam")} a vaga.` : formatDay(date, "long") });
        memory.cache.clear();
        busy = false;
        await load();
        return;
      }
    } catch (e) {
      busy = false;
      draw();
      if (e?.status === 422 && formEl) {
        showFormErrors(formEl, e.fieldErrors, container.querySelector(".ag-erros"));
        return;
      }
      if (e?.status === 412) return conflict(e);
      toast({ title: "Não deu para gravar", message: `${errorText(e)} O que você mudou continua na tela.`, kind: "error" });
      return;
    }
    busy = false;
    draw();
  }

  async function reset() {
    busy = true;
    draw();
    try {
      // a decisão sobre cada reserva que ficou sem mesa vai junto com o pedido (bug 10)
      const done = await withEffect({
        title: "Voltar à semana padrão",
        simulate: () => api.resetPlan(date, { dryRun: true }),
        commit: ({ confirm, resolutions }) => api.resetPlan(date, { confirm, resolutions, version }),
        saveLabel: "Voltar ao padrão",
      });
      if (done) {
        toast({ title: "O dia voltou à semana padrão" });
        memory.cache.clear();
        busy = false;
        await load();
        return;
      }
    } catch (e) {
      if (e?.status === 412) {
        busy = false;
        draw();
        return conflict(e);
      }
      toast({ title: "Não deu para voltar ao padrão", message: errorText(e), kind: "error" });
    }
    busy = false;
    draw();
  }

  let choice = null;
  const quickLayout = () => {
    choice ||= day.layout?.id;
    return html`<section class="ag-rapido" aria-labelledby="ag-rapido-titulo">
      <h3 id="ag-rapido-titulo" class="ag-secao">Trocar a planta do dia</h3>
      <div class="ag-rapido__linha">
        <label class="field">
          <span class="field__label">Planta</span>
          <select class="field__input" @change=${(e) => (choice = e.target.value)}>
            ${layouts.map((l) => html`<option value=${l.id} ?selected=${l.id === day.layout?.id}>${l.name}</option>`)}
          </select>
        </label>
        <button class="btn btn--outline" type="button" ?disabled=${busy} @click=${() => {
          if (choice === day.layout?.id) return toast({ title: "Essa já é a planta do dia" });
          save({ ...planBody(form), layout_id: choice });
        }}>Ver o efeito</button>
      </div>
    </section>`;
  };

  function draw() {
    if (!alive) return;
    const back = html`<a class="ag-voltar" href="/admin/agenda">‹ Voltar à agenda</a>`;
    if (status !== "ready") {
      render(html`<div class="ag">${back}${status === "loading" ? loadingBlock("Abrindo o dia…") : errorBlock(error, load)}</div>`, container);
      return;
    }
    const source = day.source === "event" ? `Evento: ${day.event?.title}` : day.source === "day_plan" ? "Fora do padrão" : "Semana padrão";
    const submit = (event) => {
      event.preventDefault();
      save(planBody(form), event.currentTarget);
    };
    render(
      html`<div class="ag ag-dia-plano">
        ${back}
        <header class="ag-dia-plano__cabeca">
          <h2 class="ag-dia-plano__titulo">${formatDay(date, "long")}${date === today ? " · hoje" : ""}</h2>
          <span class="badge">${source}</span>
        </header>
        <dl class="ag-resumo">
          <div><dt>Situação</dt><dd>${day.open ? `Aberto · ${hours(day)}` : `Fechado · ${day.reason_label || "fechado"}`}</dd></div>
          <div><dt>Planta</dt><dd>${day.layout?.name}</dd></div>
          <div><dt>Lugares</dt><dd>${day.seats}</dd></div>
          <div><dt>Reservas</dt><dd>${plural(day.reservations.filter((r) => r.status !== "waitlisted").length, "reserva", "reservas")}</dd></div>
        </dl>
        ${offline ? offlineNotice() : nothing}
        ${day.is_past
          ? html`<div class="notice" role="status">Uma data passada não pode ser editada. Aqui fica o que aconteceu.</div>`
          : html`${day.open && layouts.length > 1 && !offline ? quickLayout() : nothing}
              <form class="ag-form ag-plano" novalidate @submit=${submit} aria-labelledby="ag-plano-titulo">
                <h3 class="ag-secao" id="ag-plano-titulo">Plano do dia</h3>
                <div class="ag-erros"></div>
                <fieldset class="ag-ler" ?disabled=${offline}>
                  <legend class="sr-only">${offline ? "Só para leitura, sem conexão" : "Campos do plano"}</legend>
                  ${planFields({ plan: day.plan, day, layouts, form, onChange: (patch) => (Object.assign(form, patch), draw()) })}
                  <div class="ag-acoes">
                    <button class="btn" type="submit" aria-busy=${busy ? "true" : "false"} ?disabled=${busy}>Ver o efeito e gravar</button>
                    ${day.plan && !day.plan.event_id ? html`<button class="btn btn--outline" type="button" ?disabled=${busy} @click=${reset}>Voltar à semana padrão</button>` : nothing}
                  </div>
                </fieldset>
              </form>`}
        <section aria-labelledby="ag-noite-titulo">
          <h3 class="ag-secao" id="ag-noite-titulo">Reservas desse dia</h3>
          ${day.reservations.length
            ? html`<div class="table-wrap">
                <table class="data-table data-table--stack">
                  <thead><tr><th>Hora</th><th>Nome</th><th>Pessoas</th><th>Mesa</th><th>Situação</th></tr></thead>
                  <tbody>
                    ${day.reservations.map(
                      (r) => html`<tr>
                        <td data-label="Hora" class="num">${r.time}</td>
                        <td data-label="Nome" class="strong">${r.name}</td>
                        <td data-label="Pessoas" class="num">${r.party_size}</td>
                        <td data-label="Mesa">${r.table_codes?.length ? r.table_codes.join(" + ") : r.area_key ? `lista · ${areaName(r.area_key, layouts)}` : "sem mesa"}</td>
                        <td data-label="Situação"><span class=${`badge badge--${r.status === "no_show" ? "no-show" : r.status}`}>${STATUS[r.status] || r.status}</span></td>
                      </tr>`,
                    )}
                  </tbody>
                </table>
              </div>`
            : emptyBlock("Nenhuma reserva nesse dia", "Quando alguém reservar, aparece aqui.", html`<a class="btn btn--outline btn--sm" href="/admin/reservas">Ir para Reservas</a>`)}
        </section>
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

/** Os campos do plano que vale nomear quando outra pessoa salvou a data antes. */
const PLAN_LABELS = {
  open: "Abre",
  public_label: "O que o cliente lê",
  opens_at: "Abre às",
  closes_at: "Fecha às",
  slots: "Horários de chegada",
  layout_id: "Planta",
  duration_min: "Tempo de mesa",
  max_covers_per_slot: "Pessoas por horário",
  max_covers_night: "Pessoas na noite",
  held_tables: "Mesas guardadas",
  closed_areas: "Áreas fechadas",
  internal_note: "Nota da equipe",
};

const STATUS = { pending: "pedido", confirmed: "confirmada", offered: "vaga oferecida", completed: "chegou", waitlisted: "na espera", canceled: "cancelada", no_show: "não veio" };
