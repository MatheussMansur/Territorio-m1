// Datas no fuso da casa. Dias do calendário viajam como strings "YYYY-MM-DD" e
// nunca são lidos como objetos Date locais (é assim que nascem os erros de "um dia a menos" a oeste de
// Greenwich). O "agora" deve vir do server_time da API sempre que houver.
export const HOUSE_TZ = import.meta.env?.VITE_HOUSE_TIMEZONE || "America/Sao_Paulo";

const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const WEEKDAYS_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

const partsFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: HOUSE_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** O dia do calendário, a hora e o dia da semana da casa num instante. */
export function houseParts(instant = new Date()) {
  const p = Object.fromEntries(partsFormat.formatToParts(new Date(instant)).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  const time = `${p.hour}:${p.minute}`;
  return { date, time, minutes: toMinutes(time), weekday: weekdayOf(date) };
}

export const todayInHouse = (instant) => houseParts(instant).date;

function toUTC(date) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUTC(dt) {
  return dt.toISOString().slice(0, 10);
}

export function addDays(date, n) {
  const dt = toUTC(date);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fromUTC(dt);
}

/** Dias entre duas datas do calendário (b − a). */
export function daysBetween(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / 86_400_000);
}

export const weekdayOf = (date) => toUTC(date).getUTCDay();

export function toMinutes(time) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function fromMinutes(total) {
  const m = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** "19:00" → "19h"; "19:30" → "19h30". */
export const shortTime = (time) => (time.endsWith(":00") ? `${Number(time.slice(0, 2))}h` : time.replace(":", "h"));

/**
 * Nomes de dia em português:
 * short "qua 30/09" · long "quarta, 30 de setembro" · weekday "quarta" · dm "30/09"
 */
export function formatDay(date, style = "short") {
  const dt = toUTC(date);
  const wd = dt.getUTCDay();
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  switch (style) {
    case "long":
      return `${WEEKDAYS[wd]}, ${dt.getUTCDate()} de ${MONTHS[dt.getUTCMonth()]}`;
    case "weekday":
      return WEEKDAYS[wd];
    case "weekday-short":
      return WEEKDAYS_SHORT[wd];
    case "dm":
      return `${dd}/${mm}`;
    default:
      return `${WEEKDAYS_SHORT[wd]} ${dd}/${mm}`;
  }
}

/** "hoje", "amanhã" ou o dia da semana, em relação ao hoje da casa. */
export function relativeDay(date, today) {
  const diff = daysBetween(today, date);
  if (diff === 0) return "hoje";
  if (diff === 1) return "amanhã";
  return formatDay(date, "weekday");
}

/** Hora na casa de um instante ISO. */
export const houseTime = (iso) => houseParts(iso).time;

/**
 * Se a casa está aberta num instante, e a linha a mostrar. `days` são os dias já resolvidos
 * da API (`HousePublic.days`: ontem, hoje e os próximos), então um feriado, um
 * evento ou uma noite que fecha depois da meia-noite já estão neles.
 */
export function openStatus(days, instant = new Date()) {
  const now = houseParts(instant);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const span = (d) => {
    if (!d?.open || !d.opens_at || !d.closes_at) return null;
    const opens = toMinutes(d.opens_at);
    let closes = toMinutes(d.closes_at);
    if (closes <= opens) closes += 1440; // fecha depois da meia-noite
    return { opens, closes };
  };
  const openUntil = (d) => ({ open: true, label: `Aberta agora · até ${shortTime(d.closes_at)}` });

  const yesterday = byDate.get(addDays(now.date, -1));
  const lateNight = span(yesterday);
  if (lateNight && now.minutes + 1440 < lateNight.closes) return openUntil(yesterday);

  const today = byDate.get(now.date);
  const tonight = span(today);
  if (tonight) {
    if (now.minutes >= tonight.opens && now.minutes < tonight.closes) return openUntil(today);
    if (now.minutes < tonight.opens) return { open: false, label: `Abre hoje às ${shortTime(today.opens_at)}` };
  }
  const reason = today && !today.open ? today.reason_label || null : null;
  for (let i = 1; i <= 14; i++) {
    const date = addDays(now.date, i);
    const d = byDate.get(date);
    if (d?.open && d.opens_at) {
      const when = i === 1 ? "amanhã" : formatDay(date, "weekday");
      return { open: false, label: `Abre ${when} às ${shortTime(d.opens_at)}`, reason };
    }
  }
  return { open: false, label: "Fechada", reason };
}
