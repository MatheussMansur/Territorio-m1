// Os turnos de um dia e o horário da semana em texto (história 2.8): cada dia aberto tem o turno
// principal e, quando o dono liga "2 turnos por dia", o outro turno (`second_shift`). Funções puras,
// usadas pelo build (rodapé, "Onde fica", a semana, o JSON-LD) e pela parte viva das páginas
// ("Aberto agora", "Hoje na casa"), para o mesmo horário sair igual em todo lugar.
import { toMinutes } from "../lib/dates.js";
import { formatTime } from "./time.js";

const HHMM = /^\d\d:\d\d$/;

/** Os turnos de um dia aberto, do mais cedo ao mais tarde: [{ opens_at, closes_at }]. */
export function shiftsOf(day) {
  if (!day?.open) return [];
  const all = [day, day.second_shift].filter((s) => s && HHMM.test(s.opens_at || "") && HHMM.test(s.closes_at || ""));
  return all.map(({ opens_at, closes_at }) => ({ opens_at, closes_at })).sort((a, b) => toMinutes(a.opens_at) - toMinutes(b.opens_at));
}

/**
 * Os turnos em minutos do dia: { opens, closes, closes_at }. O fechamento depois da meia-noite
 * passa de 1440 (a madrugada pertence à noite da abertura, NFR-27).
 */
export function spansOf(day) {
  return shiftsOf(day).map(({ opens_at, closes_at }) => {
    const opens = toMinutes(opens_at);
    let closes = toMinutes(closes_at);
    if (closes <= opens) closes += 1440;
    return { opens, closes, opens_at, closes_at };
  });
}

/** "19h–23h30", ou "12h–15h e 19h–23h30" com dois turnos, no formato da língua. */
export function shiftsText(shifts, t) {
  return shifts.map((s) => `${formatTime(s.opens_at, t)}–${formatTime(s.closes_at, t)}`).join(t("site.shiftsJoin"));
}

/**
 * A semana em uma linha: os dias seguidos com o mesmo horário ficam juntos.
 * "quarta – sábado · 19h–23h30"; com turnos diferentes, "quarta – sexta · 19h–23h30; sábado · 12h–15h e 19h–23h30".
 */
export function hoursSummary(hours, t) {
  const long = t("site.weekdaysLong").split(",");
  const groups = [];
  for (const wd of [1, 2, 3, 4, 5, 6, 0]) {
    const day = hours.find((d) => d.weekday === wd);
    const text = shiftsText(shiftsOf(day), t);
    const last = groups[groups.length - 1];
    if (!text) groups.push(null);
    else if (last && last.text === text) last.to = wd;
    else groups.push({ from: wd, to: wd, text });
  }
  return groups
    .filter(Boolean)
    .map((g) => `${g.from === g.to ? long[g.from] : `${long[g.from]} – ${long[g.to]}`} · ${g.text}`)
    .join("; ");
}
