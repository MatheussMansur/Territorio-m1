// O que as visões de Reservas (Dia, Mesas, Semana, Mês) leem e as pequenas somas que compartilham: a
// noite com o seu layout, as suas reservas e as suas sessões de mesa; uma semana; um mês. A visão que a
// pessoa escolheu fica no endereço (?visao=) e é lembrada por pessoa neste aparelho.
import { addDays, daysBetween, houseParts, toMinutes, weekdayOf } from "../../../lib/dates.js";
import { local } from "../../../lib/storage.js";
import * as api from "../../../services/api/staff-reservas.js";

export const VIEWS = [
  { key: "lista", label: "Lista" },
  { key: "dia", label: "Dia" },
  { key: "mesas", label: "Mesas" },
  { key: "semana", label: "Semana" },
  { key: "mes", label: "Mês" },
];
/** A recepção só vê hoje à noite: a lista, o dia e as mesas. */
export const FLOOR_VIEWS = new Set(["lista", "dia", "mesas"]);

// o que uma visão desenha: quem tem lugar e quem já está na mesa, mais quem não veio
const SHOWN = ["pending", "confirmed", "waitlisted", "offered", "completed", "no_show"];
/** Quem ainda está sem lugar na noite: vai para a faixa acima da grade. */
export const unplaced = (r) =>
  r.status === "pending" || r.status === "waitlisted" || r.status === "offered" || (!r.table_codes?.length && !r.area_key);
export const COUNTS = new Set(["pending", "confirmed", "offered", "completed"]);

const storeKey = (user) => `territorio:reservas-visao:${user?.id || user?.role || "anon"}`;

export function viewsFor(floor) {
  return floor ? VIEWS.filter((v) => FLOOR_VIEWS.has(v.key)) : VIEWS;
}

/** A visão a abrir: primeiro o endereço, depois o que esta pessoa escolheu da última vez, depois a lista. */
export function readView(user, floor) {
  const allowed = new Set(viewsFor(floor).map((v) => v.key));
  const asked = new URLSearchParams(window.location.search).get("visao");
  if (asked && allowed.has(asked)) return asked;
  const saved = local.get(storeKey(user));
  return allowed.has(saved) ? saved : "lista";
}

export const rememberView = (user, view) => local.set(storeKey(user), view);

export const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || "") && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
export const weekStartOf = (date) => addDays(date, -weekdayOf(date));
export const monthOf = (date) => date.slice(0, 7);

/** Minutos desde a meia-noite da noite, então 00:30 depois de uma noite que começou às 19h vira 24:30. */
export function minutesOn(iso, date) {
  const p = houseParts(iso);
  return p.minutes + daysBetween(date, p.date) * 1440;
}

/** Todas as reservas de um período, seguindo as páginas da lista. */
export async function reservationsOf(from, to, signal) {
  const items = [];
  let cursor;
  for (let i = 0; i < 10; i++) {
    const page = await api.list({ from, to, status: SHOWN, cursor, limit: 100 }, { signal });
    items.push(...page.items);
    cursor = page.next_cursor;
    if (!cursor) break;
  }
  return items;
}

/**
 * Uma noite: o dia como ele funciona (horários, layout, fechado ou aberto), as suas reservas e, na
 * noite em que o salão está funcionando, as sessões de mesa e o relógio do salão para a linha do agora.
 */
export async function loadNight(date, { floor: floorRole, today, signal }) {
  const [reservations, live] = await Promise.all([
    reservationsOf(date, date, signal),
    date === today ? api.floor(date, { signal }) : null,
  ]);
  let day = live?.date === date ? live.day : null;
  if (!day && !floorRole) day = await api.day(date, { signal });
  const sessions = live?.date === date ? live.sessions || [] : [];
  const now = live?.date === date && live.server_time ? live.server_time : null;
  return { date, day: day || null, reservations, sessions, now };
}

/** Uma semana (sete noites a partir do domingo): o calendário dos seus meses e as suas reservas. */
export async function loadWeek(start, signal) {
  const end = addDays(start, 6);
  const months = [...new Set([monthOf(start), monthOf(end)])];
  const [reservations, ...calendars] = await Promise.all([reservationsOf(start, end, signal), ...months.map((m) => api.calendar(m, { signal }))]);
  const byDate = new Map(calendars.flat().map((d) => [d.date, d]));
  return {
    start,
    days: Array.from({ length: 7 }, (_, i) => {
      const date = addDays(start, i);
      return { date, info: byDate.get(date) || null, reservations: reservations.filter((r) => r.date === date) };
    }),
  };
}

/** Um mês: os dias como o calendário os soma. */
export async function loadMonth(month, signal) {
  return { month, days: await api.calendar(month, { signal }) };
}

/** As horas que as grades mostram: o horário de funcionamento, esticado para caber todo bloco, em horas cheias. */
export function nightSpan(night, blocks = []) {
  let from = night.day?.opens_at ? toMinutes(night.day.opens_at) : 19 * 60;
  let to = night.day?.closes_at ? toMinutes(night.day.closes_at) : 23 * 60 + 30;
  if (to <= from) to += 1440; // fecha depois da meia-noite
  for (const b of blocks) {
    from = Math.min(from, b.start);
    to = Math.max(to, b.end);
  }
  from = Math.floor(from / 60) * 60;
  to = Math.ceil(to / 60) * 60;
  return { from, to, hours: Array.from({ length: (to - from) / 60 }, (_, i) => from + i * 60) };
}

/** Quando uma reserva segura a sua mesa: da chegada (ou do horário) até o fim do seu tempo de mesa. */
export function reservationSpan(r, date) {
  const start = r.seated_at ? minutesOn(r.seated_at, date) : toMinutes(r.time);
  const booked = toMinutes(r.time);
  const end = r.left_at ? minutesOn(r.left_at, date) : Math.max(start, booked) + (r.duration_min || 120);
  return { start, end: Math.max(end, start + 15) };
}

/** Lado a lado: cada bloco ganha uma coluna dentro do seu grupo de blocos que se sobrepõem. */
export function packColumns(blocks) {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  let cluster = [];
  let columns = [];
  let clusterEnd = -Infinity;
  const close = () => {
    for (const item of cluster) item.cols = columns.length;
    cluster = [];
    columns = [];
  };
  for (const block of sorted) {
    if (cluster.length && block.start >= clusterEnd) {
      close();
      clusterEnd = -Infinity;
    }
    let col = columns.findIndex((end) => end <= block.start);
    if (col === -1) {
      col = columns.length;
      columns.push(block.end);
    } else columns[col] = block.end;
    const item = { ...block, col, cols: 1 };
    cluster.push(item);
    out.push(item);
    clusterEnd = Math.max(clusterEnd, block.end);
  }
  close();
  return out;
}

/** O primeiro nome; um grupo que sentou sem reserva e sem nome fica "Sem nome". */
export function firstName(name) {
  const full = String(name || "").trim();
  if (/^sem( nome\b.*)?$/i.test(full)) return "Sem nome";
  return full.split(/\s+/)[0] || "Cliente";
}
export const clockOf = (minutes) => {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h}h${String(mm).padStart(2, "0")}` : `${h}h`;
};
