// Reservas: a lista com filtros de período, status e canal e a busca (nome, código TR ou
// o fim do telefone), a gaveta de cada reserva no seu próprio endereço
// (/admin/reservas/{id}), a nova reserva por telefone e a exportação. A recepção vê só
// esta noite, sem período nem exportação (FR-40). Os filtros ficam no endereço, para voltar
// e para mandar ao gerente. Além da lista, as mesmas reservas são vistas por "Dia" (as
// horas da noite), "Mesas" (mesas por horário), "Semana" e "Mês" (FR-83); a visão fica no
// endereço (?visao=) e é lembrada por pessoa. A recepção tem a lista, Dia e Mesas desta noite.
// As linhas desta noite recebem "Chegou" e mantêm "Desfazer" enquanto dura a janela de desfazer; a lista e a
// gaveta aberta se atualizam sozinhas pelo fluxo ao vivo (história 5.3).
import "./reservas.css";
import { toast } from "../../components/toast.js";
import { addDays, formatDay, houseParts, relativeDay, shortTime } from "../../lib/dates.js";
import { html, nothing, render } from "../../lib/html.js";
import * as api from "../../services/api/staff-reservas.js";
import { withIdentity } from "../identity.js";
import { canDo } from "../nav.js";
import { canCheckIn, checkIn, undoButton } from "./reservas/chegada.js";
import { closeReservation, openReservation, refreshReservation } from "./reservas/drawer.js";
import { problemText } from "./reservas/errors.js";
import { SOURCE, canAct, confirmationBadge, flagList, people, seesAnyDay, statusBadge, tables } from "./reservas/labels.js";
import { openNewReservation } from "./reservas/new-reservation.js";
import { arrivingNote, notifiedNote } from "./reservas/prontas.js";
import { monthView, weekView } from "./reservas/views-calendario.js";
import { isDate, loadMonth, loadNight, loadWeek, monthOf, readView, rememberView, viewsFor, weekStartOf } from "./reservas/views-data.js";
import { dayView } from "./reservas/views-dia.js";
import { tablesView } from "./reservas/views-mesas.js";
import { uuid } from "../../lib/uuid.js";
import { changeSummary, countChanges, realtimeLostNotice, startLive } from "./salao/vivo.js";

const PERIODS = [
  { key: "hoje", label: "Hoje" },
  { key: "amanha", label: "Amanhã" },
  { key: "semana", label: "Esta semana" },
  { key: "periodo", label: "Escolher período" },
];
const STATUS = [
  { key: "ativas", label: "Ativas", values: ["pending", "confirmed", "waitlisted", "offered", "completed"] },
  { key: "pendentes", label: "Pendentes", values: ["pending"] },
  { key: "confirmadas", label: "Confirmadas", values: ["confirmed"] },
  { key: "espera", label: "Espera", values: ["waitlisted", "offered"] },
  { key: "canceladas", label: "Canceladas", values: ["canceled", "declined", "expired"] },
  { key: "faltas", label: "Não vieram", values: ["no_show"] },
  { key: "todas", label: "Todas", values: [] },
];
const CHANNELS = [["", "Todos os canais"], ...Object.entries(SOURCE)];
const DEFAULTS = { periodo: "semana", de: "", ate: "", status: "ativas", canal: "", q: "" };
const PARAMS = Object.keys(DEFAULTS);

const today = () => houseParts(new Date()).date;

function readFilters(floor) {
  const url = new URLSearchParams(window.location.search);
  const f = Object.fromEntries(PARAMS.map((k) => [k, url.get(k) ?? DEFAULTS[k]]));
  if (!PERIODS.some((p) => p.key === f.periodo)) f.periodo = DEFAULTS.periodo;
  if (!STATUS.some((s) => s.key === f.status)) f.status = DEFAULTS.status;
  if (floor) Object.assign(f, { periodo: "hoje", de: "", ate: "", canal: "" });
  return f;
}

function range(f) {
  const t = today();
  switch (f.periodo) {
    case "hoje":
      return { from: t, to: t };
    case "amanha":
      return { from: addDays(t, 1), to: addDays(t, 1) };
    case "periodo":
      return { from: f.de || t, to: f.ate || f.de || addDays(t, 6) };
    default:
      return { from: t, to: addDays(t, 6) };
  }
}

const isFiltered = (f) => f.status !== DEFAULTS.status || f.canal || f.q || (f.periodo !== DEFAULTS.periodo && f.periodo !== "hoje");

export async function mount(container, { user, sub }) {
  // o arquivo de permissões diz quem vê outros dias, aprova e exporta (história 1.3)
  const floor = !seesAnyDay(user);
  const approves = canAct(user, "approve");
  const exports = canDo(user?.role, "POST /staff/reservations/export", user?.areas ?? undefined);
  const s = { filters: readFilters(floor), items: null, next: null, error: null, loadingMore: false, approving: null, rules: null, offset: 0, lost: false, announce: "" };
  // as visões além da lista: qual, a data que ela olha e o que carregou
  const askedDate = new URLSearchParams(window.location.search).get("data");
  const v = { view: readView(user, floor), date: !floor && isDate(askedDate) ? askedDate : today(), data: null, error: null };
  let controller = null;
  let typing = null;
  let alive = true;

  // ---- o endereço ----
  function listPath() {
    const url = new URLSearchParams(window.location.search);
    for (const k of PARAMS) {
      const v = s.filters[k];
      if (v && v !== DEFAULTS[k] && !(floor && k !== "q" && k !== "status")) url.set(k, v);
      else url.delete(k);
    }
    if (v.view !== "lista") url.set("visao", v.view);
    else url.delete("visao");
    if (v.view !== "lista" && v.date !== today()) url.set("data", v.date);
    else url.delete("data");
    const query = url.toString();
    return `/admin/reservas${query ? `?${query}` : ""}`;
  }
  const keepAddress = (path = listPath()) => window.history.replaceState(null, "", path);

  // ---- dados ----
  async function load({ more = false, quiet = false } = {}) {
    controller?.abort();
    controller = new AbortController();
    const { from, to } = range(s.filters);
    const status = STATUS.find((x) => x.key === s.filters.status)?.values || [];
    if (more) s.loadingMore = true;
    else if (!quiet) Object.assign(s, { items: null, next: null, error: null });
    draw();
    try {
      const shown = quiet && s.items ? Math.max(s.items.length, 50) : undefined;
      const page = await api.list(
        { from, to, status, source: s.filters.canal || undefined, q: s.filters.q.trim() || undefined, cursor: more ? s.next : undefined, limit: shown },
        { signal: controller.signal },
      );
      if (quiet && s.items) {
        const n = countChanges(s.items, page.items, (r) => `${r.status}|${r.table_codes.join("+")}|${r.version}`);
        s.announce = changeSummary(n, "reserva", "reservas");
      }
      s.items = more ? [...(s.items || []), ...page.items] : page.items;
      s.next = page.next_cursor;
      if (page.rules) s.rules = page.rules;
      if (page.night_time) s.offset = Date.parse(page.night_time) - Date.now();
      s.error = null;
    } catch (error) {
      if (error?.name === "AbortError") return;
      console.error(error);
      if (more) toast({ kind: "error", ...problemText(error) });
      else s.error = error;
    }
    s.loadingMore = false;
    if (alive) draw();
  }

  function setFilters(patch, { debounce = false } = {}) {
    Object.assign(s.filters, patch);
    keepAddress();
    clearTimeout(typing);
    if (debounce) typing = setTimeout(() => load(), 280);
    else load();
  }

  function clearFilters() {
    s.filters = { ...DEFAULTS, ...(floor ? { periodo: "hoje" } : {}) };
    const input = container.querySelector("#res-busca");
    if (input) input.value = "";
    keepAddress();
    load();
  }

  // ---- a gaveta no seu próprio endereço ----
  function open(id, event) {
    event?.preventDefault();
    keepAddress(`/admin/reservas/${encodeURIComponent(id)}${window.location.search}`);
    openReservation(id, {
      user,
      onChange: () => reload(),
      onClose: () => alive && keepAddress(),
    });
  }

  async function approve(r) {
    if (s.approving) return;
    s.approving = r.id;
    draw();
    try {
      await api.action(r.id, { action: "approve", table_codes: r.table_codes }, uuid());
      toast({ title: `${r.customer.name}: reserva aprovada`, message: "O cliente recebe a confirmação pelo WhatsApp." });
    } catch (error) {
      toast({ kind: "error", ...problemText(error) });
    }
    s.approving = null;
    if (alive) load();
  }

  async function create() {
    const date = v.view === "dia" || v.view === "mesas" ? v.date : range(s.filters).from;
    const r = await openNewReservation({ user, date: date < today() ? today() : date });
    if (r && alive) reload();
  }

  // ---- as visões: Dia, Mesas, Semana, Mês ----
  const reload = () => (v.view === "lista" ? load() : loadView());
  const quietReload = () => (v.view === "lista" ? load({ quiet: true }) : loadView());

  async function loadView() {
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    Object.assign(v, { data: null, error: null });
    draw();
    try {
      if (v.view === "dia" || v.view === "mesas") v.data = await loadNight(v.date, { floor, today: today(), signal });
      else if (v.view === "semana") v.data = await loadWeek(weekStartOf(v.date), signal);
      else v.data = await loadMonth(monthOf(v.date), signal);
    } catch (error) {
      if (error?.name === "AbortError") return;
      console.error(error);
      v.error = error;
    }
    if (alive) draw();
  }

  function setView(view) {
    if (view === v.view) return;
    v.view = view;
    rememberView(user, view);
    keepAddress();
    reload();
  }

  function goDate(date, view = v.view) {
    v.date = date;
    if (view !== v.view) {
      v.view = view;
      rememberView(user, view);
    }
    keepAddress();
    reload();
  }

  function step(n) {
    if (v.view === "semana") return goDate(addDays(weekStartOf(v.date), 7 * n));
    if (v.view === "mes") {
      const [y, m] = v.date.split("-").map(Number);
      return goDate(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10));
    }
    return goDate(addDays(v.date, n));
  }

  /** O arquivo do filtro atual, depois da checagem de identidade dos últimos 5 minutos (5.11). */
  async function exportList() {
    const { from, to } = range(s.filters);
    const status = STATUS.find((x) => x.key === s.filters.status)?.values || [];
    const source = s.filters.canal || undefined;
    const q = s.filters.q.trim() || undefined;
    const filters = [
      s.filters.status !== DEFAULTS.status && STATUS.find((x) => x.key === s.filters.status)?.label.toLowerCase(),
      source && `canal ${SOURCE[source] || source}`,
      q && `busca “${q}”`,
    ].filter(Boolean);
    let file;
    try {
      file = await withIdentity(() => api.exportFiltered({ from, to, status, source, q }), {
        title: "Exportar as reservas",
        message: `De ${formatDay(from)} a ${formatDay(to)}${filters.length ? `, só ${filters.join(", ")}` : ""}, em planilha (CSV), sem observações nem dados de saúde. Exportar pede a senha e o código de novo, e fica no registro de ações.`,
        confirmLabel: "Confirmar e baixar",
      });
    } catch (error) {
      const { title, message } = problemText(error);
      toast({ kind: "error", title, message, action: error?.type === "network" || error?.type === "timeout" ? { label: "Tentar de novo", onClick: exportList } : undefined });
      return;
    }
    if (!file) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([file.text], { type: "text/csv;charset=utf-8" }));
    link.download = file.filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    toast({ title: "Arquivo baixado", message: file.filename });
  }

  // ---- tela ----
  function draw() {
    if (!alive) return;
    render(screen(), container);
  }

  function switcher() {
    return html`<div class="rv-visoes" role="group" aria-label="Ver as reservas por">
      ${viewsFor(floor).map(
        (x) => html`<button type="button" class="rv-visao" aria-pressed=${String(v.view === x.key)} @click=${() => setView(x.key)}>${x.label}</button>`,
      )}
    </div>`;
  }

  function screen() {
    return v.view === "lista" ? listScreen() : viewScreen();
  }

  function viewTitle() {
    if (v.view === "semana") {
      const start = weekStartOf(v.date);
      return `Semana de ${formatDay(start, "dm")} a ${formatDay(addDays(start, 6), "dm")}`;
    }
    if (v.view === "mes") return monthName(v.date);
    const rel = relativeDay(v.date, today());
    return `${formatDay(v.date, "long")}${rel === "hoje" ? " · hoje" : rel === "amanhã" ? " · amanhã" : ""}`;
  }

  function viewScreen() {
    const ctx = { open, today: today(), goDay: (date) => goDate(date, "dia") };
    const label = v.view === "semana" ? ["Semana anterior", "Próxima semana"] : v.view === "mes" ? ["Mês anterior", "Próximo mês"] : ["Noite anterior", "Próxima noite"];
    let body;
    if (v.error) {
      const { title, message } = problemText(v.error);
      body = html`<div class="empty error-state" role="alert"><span class="raiz raiz--atencao" aria-hidden="true"></span>
        <b>${title}</b><p>${message}</p><button class="btn btn--sm" type="button" @click=${() => loadView()}>Tentar de novo</button></div>`;
    } else if (!v.data) {
      body = html`<div class="rv-carregando" aria-hidden="true">${[1, 2, 3].map(() => html`<span class="skeleton skeleton--text"></span>`)}</div>`;
    } else if (v.view === "dia") body = dayView(v.data, ctx);
    else if (v.view === "mesas") body = tablesView(v.data, ctx);
    else if (v.view === "semana") body = weekView(v.data, ctx);
    else body = monthView(v.data, ctx);
    return html`<div class="res">
      <div class="res-topo">
        ${switcher()}
        <div class="res-topo__acoes">
          <button class="btn btn--sm" type="button" @click=${create}>Nova reserva</button>
        </div>
      </div>
      <div class="rv-nav">
        ${floor
          ? html`<h2 class="rv-nav__titulo">Hoje · ${formatDay(today(), "long")}</h2>`
          : html`<button class="action" type="button" aria-label=${label[0]} @click=${() => step(-1)}>‹</button>
              <h2 class="rv-nav__titulo" aria-live="polite">${viewTitle()}</h2>
              <button class="action" type="button" aria-label=${label[1]} @click=${() => step(1)}>›</button>
              <button class="action" type="button" @click=${() => goDate(today())}>Hoje</button>`}
      </div>
      <p class="res-contagem" role="status">${v.error ? "" : !v.data ? "Carregando…" : summary()}</p>
      ${body}
    </div>`;
  }

  function summary() {
    const counted = (list) => list.filter((r) => r.status !== "no_show" && r.status !== "waitlisted");
    const line = (list, where) => `${list.length} ${list.length === 1 ? "reserva" : "reservas"}${where} · ${people(list.reduce((n, r) => n + r.party_size, 0))}`;
    if (v.view === "dia" || v.view === "mesas") return line(counted(v.data.reservations), "");
    if (v.view === "semana") return line(counted(v.data.days.flatMap((d) => d.reservations)), " na semana");
    const n = v.data.days.reduce((t, d) => t + (d.reservations || 0), 0);
    return `${n} ${n === 1 ? "reserva" : "reservas"} no mês · ${people(v.data.days.reduce((t, d) => t + (d.people || 0), 0))}`;
  }

  function listScreen() {
    const f = s.filters;
    const { from, to } = range(f);
    const items = s.items || [];
    const total = items.reduce((n, r) => n + (r.status === "canceled" || r.status === "declined" ? 0 : r.party_size), 0);
    return html`<div class="res">
      ${s.lost ? html`<p class="notice" role="status" data-estado="realtime_lost">${realtimeLostNotice}</p>` : nothing}
      <p class="sr-only" aria-live="polite">${s.announce}</p>
      ${switcher()}
      <div class="res-topo">
        ${floor
          ? html`<p class="res-dia">Reservas de hoje · <b>${formatDay(today(), "long")}</b></p>`
          : html`<div class="res-chips" role="group" aria-label="Período">
              ${PERIODS.map(
                (p) => html`<button type="button" class="res-chip" aria-pressed=${String(f.periodo === p.key)} @click=${() => setFilters({ periodo: p.key })}>${p.label}</button>`,
              )}
            </div>`}
        <div class="res-topo__acoes">
          ${exports
            ? html`<button class="btn btn--outline btn--sm" type="button" ?disabled=${!s.items?.length} @click=${exportList}>
                ${s.items && !s.items.length ? "Nenhuma reserva para exportar" : "Exportar"}
              </button>`
            : nothing}
          <button class="btn btn--sm" type="button" @click=${create}>Nova reserva</button>
        </div>
      </div>

      ${!floor && f.periodo === "periodo"
        ? html`<div class="res-periodo">
            <div class="field"><label class="field__label" for="res-de">De</label>
              <input class="field__input" type="date" id="res-de" .value=${from} @change=${(e) => setFilters({ de: e.target.value })}></div>
            <div class="field"><label class="field__label" for="res-ate">Até</label>
              <input class="field__input" type="date" id="res-ate" .value=${to} min=${from} @change=${(e) => setFilters({ ate: e.target.value })}></div>
          </div>`
        : nothing}

      <div class="res-filtros" role="search">
        <div class="field res-busca">
          <label class="field__label" for="res-busca">Buscar</label>
          <input class="field__input" id="res-busca" type="search" placeholder="Nome, código TR ou final do telefone" .value=${f.q}
            autocomplete="off" @input=${(e) => setFilters({ q: e.target.value }, { debounce: true })}>
        </div>
        ${floor
          ? nothing
          : html`<div class="field res-canal">
              <label class="field__label" for="res-canal">Canal</label>
              <select class="field__input" id="res-canal" @change=${(e) => setFilters({ canal: e.target.value })}>
                ${CHANNELS.map(([value, label]) => html`<option value=${value} ?selected=${f.canal === value}>${label}</option>`)}
              </select>
            </div>`}
      </div>
      <div class="res-chips res-chips--status" role="group" aria-label="Status">
        ${STATUS.map(
          (x) => html`<button type="button" class="res-chip" aria-pressed=${String(f.status === x.key)} @click=${() => setFilters({ status: x.key })}>${x.label}</button>`,
        )}
      </div>

      <p class="res-contagem" role="status">
        ${s.items == null && !s.error
          ? "Carregando…"
          : s.error
            ? ""
            : `${items.length}${s.next ? "+" : ""} ${items.length === 1 ? "reserva" : "reservas"} · ${people(total)}${floor ? "" : ` · ${periodLabel(f, from, to)}`}`}
      </p>

      <div class="table-wrap">
        <table class="data-table data-table--stack res-tabela">
          <caption class="sr-only">Reservas</caption>
          <thead>
            <tr>
              ${floor ? nothing : html`<th scope="col">Dia</th>`}
              <th scope="col">Hora</th><th scope="col">Nome</th><th scope="col">Pessoas</th><th scope="col">Mesa</th>
              <th scope="col">Canal</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Ações</span></th>
            </tr>
          </thead>
          <tbody>${body(floor ? 7 : 8)}</tbody>
        </table>
      </div>
      ${s.next
        ? html`<div class="data-table__more"><button class="btn btn--outline btn--sm" type="button" ?disabled=${s.loadingMore} @click=${() => load({ more: true })}>
            ${s.loadingMore ? "Carregando…" : "Mostrar mais"}</button></div>`
        : nothing}
    </div>`;
  }

  function body(cols) {
    const state = (content) => html`<tr class="data-table__state"><td colspan=${cols}>${content}</td></tr>`;
    if (s.error) {
      const { title, message } = problemText(s.error);
      return state(html`<div class="empty error-state" role="alert"><span class="raiz raiz--atencao" aria-hidden="true"></span>
        <b>${title}</b><p>${message}</p><button class="btn btn--sm" type="button" @click=${() => load()}>Tentar de novo</button></div>`);
    }
    if (s.items == null) {
      return [1, 2, 3, 4].map(() => html`<tr aria-hidden="true">${Array.from({ length: cols }, () => html`<td><span class="skeleton skeleton--text"></span></td>`)}</tr>`);
    }
    if (!s.items.length) {
      const filtered = isFiltered(s.filters);
      return state(html`<div class="empty"><span class="raiz" aria-hidden="true"></span>
        <b>${filtered ? "Nada por aqui" : floor ? "Nenhuma reserva para hoje ainda" : "Nenhuma reserva no período"}</b>
        <p>${filtered ? "Nenhuma reserva com esses filtros." : "Quando alguém reservar pelo site ou pela equipe, aparece aqui."}</p>
        ${filtered
          ? html`<button class="btn btn--sm btn--outline" type="button" @click=${clearFilters}>Limpar filtros</button>`
          : html`<button class="btn btn--sm" type="button" @click=${create}>Lançar uma reserva</button>`}
      </div>`);
    }
    const t = today();
    return s.items.map((r) => row(r, t, floor, approves));
  }

  function row(r, t, floorView, canApprove) {
    const rel = relativeDay(r.date, t);
    const note = flagList(r);
    return html`<tr class=${r.status === "pending" ? "res-linha--pendente" : ""} @click=${(e) => !e.target.closest("a, button") && open(r.id)}>
      ${floorView ? nothing : html`<td data-label="Dia" class="num">${rel === "hoje" || rel === "amanhã" ? rel : formatDay(r.date)}</td>`}
      <td data-label="Hora" class="time">${shortTime(r.time)}</td>
      <td data-label="Nome" class="strong is-wide">
        <a class="res-nome" href=${`/admin/reservas/${r.id}`} @click=${(e) => open(r.id, e)}>${r.customer.name}</a>
        <small class="res-sub">${r.code}${note ? ` · ${note}` : ""}${r.status === "pending" && r.pending_until ? ` · vence às ${houseParts(r.pending_until).time}` : ""}</small>
      </td>
      <td data-label="Pessoas" class="num">${r.party_size}</td>
      <td data-label="Mesa" class="num">${tables(r)}</td>
      <td data-label="Canal">${SOURCE[r.source] || r.source}</td>
      <td data-label="Status"><span class="res-selos">${statusBadge(r.status)} ${confirmationBadge(r.customer_confirmation)} ${arrivingNote(r)} ${notifiedNote(r)}
        ${r.no_whatsapp ? html`<span class="badge badge--no-reply">sem WhatsApp</span>` : nothing}</span></td>
      <td data-label="Ações" class="res-acao-linha">
        ${r.status === "pending" && canApprove && r.table_codes.length
          ? html`<button class="action action--solid" type="button" ?disabled=${Boolean(s.approving)} @click=${() => approve(r)}>
              ${s.approving === r.id ? "Aprovando…" : `Aprovar com ${r.table_codes.join(" + ")}`}
            </button>`
          : canCheckIn(r, t) && r.status === "confirmed"
            ? html`<button class="action action--solid" type="button" aria-label=${`Chegou: ${r.customer.name}`} @click=${(e) => (e.stopPropagation(), checkIn(r, { onDone: () => load({ quiet: true }) }))}>Chegou</button>`
            : html`<button class="action" type="button" @click=${() => open(r.id)} aria-label=${`Abrir a reserva de ${r.customer.name}`}>Abrir</button>`}
        ${r.date === t ? undoButton(r, s.rules, () => load({ quiet: true }), new Date(Date.now() + s.offset)) : nothing}
      </td>
    </tr>`;
  }

  rememberView(user, v.view);
  if (!sub) keepAddress();
  draw();
  await reload();
  if (sub && alive) open(decodeURIComponent(sub.split("/")[0]));

  // uma mudança feita em outro lugar (outro aparelho, o cliente) chega à lista e à gaveta
  const live = startLive({
    skip: ["alerts"],
    refresh: ({ reason }) => {
      if (reason === "live") refreshReservation();
      if (s.items || v.data) quietReload();
    },
    onState: ({ lost }) => {
      s.lost = lost;
      draw();
    },
  });
  // a janela do "Desfazer" anda com o relógio
  const tick = setInterval(() => v.view === "lista" && s.items && draw(), 30_000);

  return () => {
    alive = false;
    live.stop();
    clearInterval(tick);
    controller?.abort();
    clearTimeout(typing);
    closeReservation();
  };
}

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const monthName = (date) => `${MONTHS[Number(date.slice(5, 7)) - 1]} de ${date.slice(0, 4)}`;

function periodLabel(f, from, to) {
  if (f.periodo === "hoje") return "hoje";
  if (f.periodo === "amanha") return "amanhã";
  return from === to ? formatDay(from) : `${formatDay(from)} a ${formatDay(to)}`;
}
