// "Semana" e "Mês": a semana em sete colunas, uma por noite, com as reservas por horário, as
// pessoas e o quanto cada noite está cheia; o mês como calendário com reservas, pessoas e
// eventos por dia. Noites fechadas ficam hachuradas e escritas. O cabeçalho de uma noite, ou um dia do
// mês, abre o "Dia" daquela noite.
import { formatDay, shortTime, weekdayOf } from "../../../lib/dates.js";
import { html, nothing } from "../../../lib/html.js";
import { people, statusBadge, tables } from "./labels.js";
import { COUNTS, firstName } from "./views-data.js";

const WEEK = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const closedWords = (info) => html`<b>Fechado</b>${info?.reason_label && info.reason_label !== "fechado" ? ` · ${info.reason_label}` : ""}`;

function fill(pct) {
  return html`<span class="rv-ocupa">
    <span class="rv-ocupa__barra" style=${`--pct:${pct}%`} aria-hidden="true"></span>
    <span class="rv-ocupa__num">${pct}% ocupada</span>
  </span>`;
}

export function weekView(week, { open, goDay, today }) {
  return html`<ol class="rv-semana" aria-label=${`Semana de ${formatDay(week.start, "dm")}`}>
    ${week.days.map(({ date, info, reservations }) => {
      const closed = info ? !info.open : false;
      const counted = reservations.filter((r) => COUNTS.has(r.status));
      const total = counted.reduce((n, r) => n + r.party_size, 0);
      const isToday = date === today;
      return html`<li class=${`rv-semana__noite${closed ? " is-fechado" : ""}${isToday ? " is-hoje" : ""}`}>
        <button type="button" class="rv-semana__cab" @click=${() => goDay(date)}>
          <span class="rv-semana__dia">${formatDay(date, "weekday-short")}</span>
          <b class="rv-semana__num">${formatDay(date, "dm")}</b>
          ${isToday ? html`<span class="badge">hoje</span>` : nothing}
          <span class="sr-only">: abrir o dia</span>
        </button>
        <p class="rv-semana__soma">
          ${closed ? closedWords(info) : html`${people(total)}${info ? html` · ${fill(info.occupancy_pct)}` : nothing}`}
        </p>
        ${(info?.events || []).map((e) => html`<p class="rv-evento">${e.published ? "Evento" : "Rascunho"}: ${e.title}</p>`)}
        ${reservations.length
          ? html`<ul class="rv-semana__lista">
              ${reservations.map(
                (r) => html`<li><button type="button" class=${`rv-cartao rv-cartao--${r.status}`} @click=${() => open(r.id)}>
                  <b>${shortTime(r.time)} ${firstName(r.customer?.name)}</b>
                  <span>${r.party_size} · ${tables(r)}</span>
                  ${statusBadge(r.status)}
                </button></li>`,
              )}
            </ul>`
          : html`<p class="rv-semana__nada">${closed ? "" : "Sem reservas"}</p>`}
      </li>`;
    })}
  </ol>`;
}

export function monthView(month, { goDay, today }) {
  const list = month.days;
  const offset = list.length ? weekdayOf(list[0].date) : 0;
  return html`<div class="rv-mes">
    <div class="rv-mes__semana" aria-hidden="true">${WEEK.map((w) => html`<span>${w}</span>`)}</div>
    <ol class="rv-mes__dias" aria-label="Dias do mês">
      ${Array.from({ length: offset }, () => html`<li class="rv-mes__vago" aria-hidden="true"></li>`)}
      ${list.map((d) => {
        const isToday = d.date === today || d.is_today;
        const closed = !d.open;
        return html`<li>
          <button type="button" class=${`rv-mes__dia${closed ? " is-fechado" : ""}${isToday ? " is-hoje" : ""}${d.date < today ? " is-passado" : ""}`}
            @click=${() => goDay(d.date)}>
            <span class="sr-only">${formatDay(d.date, "long")}: </span>
            <span class="rv-mes__topo">
              <span class="rv-mes__num" aria-hidden="true">${Number(d.date.slice(8))}</span>
              <span class="rv-mes__semana-dia" aria-hidden="true">${formatDay(d.date, "weekday-short")}</span>
              ${isToday ? html`<span class="badge">hoje</span>` : nothing}
            </span>
            ${closed
              ? html`<span class="rv-mes__linha">${closedWords(d)}</span>`
              : html`<span class="rv-mes__linha">${d.reservations ? `${plural(d.reservations, "reserva", "reservas")} · ${d.people} pess.` : "Sem reservas"}</span>
                  ${d.reservations ? fill(d.occupancy_pct) : nothing}`}
            ${d.waitlist ? html`<span class="rv-mes__linha">${d.waitlist} na espera</span>` : nothing}
            ${(d.events || []).map((e) => html`<span class="rv-evento">${e.published ? "Evento" : "Rascunho"}: ${e.title}</span>`)}
            <span class="sr-only">. Abrir o dia</span>
          </button>
        </li>`;
      })}
    </ol>
  </div>`;
}
