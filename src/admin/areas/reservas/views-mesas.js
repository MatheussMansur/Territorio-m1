// "Mesas": uma linha por mesa da planta da noite, agrupada por área, e o horário na horizontal. Cada
// reserva e cada ocupação de mesa toma o seu trecho da linha; os trechos livres vêm
// escritos; mesas juntas mostram a junção em cada mesa dela. No celular a grade rola
// para o lado com a coluna das mesas parada.
import { toMinutes } from "../../../lib/dates.js";
import { html, nothing } from "../../../lib/html.js";
import { AREA, statusBadge } from "./labels.js";
import { clockOf, firstName, minutesOn, nightSpan, packColumns, reservationSpan, unplaced } from "./views-data.js";
import { closedNote, waitingStrip } from "./views-dia.js";

const MIN_FREE = 30; // um trecho livre menor que isto não vale uma palavra

/** As barras da noite: a ocupação quando o grupo sentou, senão a reserva. */
function barsOf(night) {
  const bars = [];
  const byReservation = new Map(night.sessions.map((s) => [s.reservation_id, s]));
  for (const r of night.reservations) {
    if (unplaced(r)) continue;
    const session = byReservation.get(r.id);
    if (session && session.table_codes?.length) {
      const start = minutesOn(session.seated_at, night.date);
      const endIso = session.released_at || session.ends_at;
      const end = endIso ? minutesOn(endIso, night.date) : start + (r.duration_min || 120);
      bars.push({ r, codes: session.table_codes, start, end: Math.max(end, start + 15), seated: session.status === "open", released: Boolean(session.released_at) });
    } else if (r.table_codes?.length) {
      bars.push({ r, codes: r.table_codes, ...reservationSpan(r, night.date), seated: Boolean(r.seated_at && !r.left_at), released: Boolean(r.left_at) });
    }
  }
  return bars;
}

const sessionWord = (bar) => (bar.seated ? "na mesa" : bar.released ? "mesa liberada" : null);

export function tablesView(night, { open }) {
  const layout = night.day?.layout;
  const strip = night.reservations.filter(unplaced);
  if (!layout?.tables?.length) {
    return html`<div class="rv-mesas">
      ${closedNote(night)}
      ${waitingStrip(strip, open)}
      <div class="empty rv-vazio"><span class="raiz" aria-hidden="true"></span>
        <b>Sem planta para essa noite</b>
        <p>Escolha a planta da noite na Agenda e as mesas aparecem aqui.</p></div>
    </div>`;
  }
  const bars = barsOf(night);
  const span = nightSpan(night, bars);
  const opens = night.day?.opens_at ? toMinutes(night.day.opens_at) : span.from;
  let closes = night.day?.closes_at ? toMinutes(night.day.closes_at) : span.to;
  if (closes <= opens) closes += 1440;
  const now = night.now ? minutesOn(night.now, night.date) : null;
  const showNow = now != null && now >= span.from && now <= span.to;
  const modeOf = (key) => night.day.areas?.find((a) => a.key === key)?.mode || "tables";
  const areaKeys = [...new Set(layout.tables.map((t) => t.area))].filter((key) => modeOf(key) !== "closed");

  const row = (table) => {
    const mine = packColumns(bars.filter((b) => b.codes.includes(table.code)));
    const lanes = Math.max(1, ...mine.map((b) => b.cols));
    const free = freeStretches(mine, opens, closes);
    return html`<li class="rv-mesas__linha" style=${`--lanes:${lanes}`}>
      <span class="rv-mesas__mesa"><b>${table.code}</b><small>${table.max_seats} lug.</small></span>
      <div class="rv-mesas__tempo">
        ${free.map(
          (f) => html`<span class="rv-mesas__livre" style=${`--ini:${f.start - span.from};--dur:${f.end - f.start}`}>
            <span aria-hidden="true">${f.end - f.start >= 60 ? "livre" : ""}</span>
            <span class="sr-only">${table.code} livre das ${clockOf(f.start)} às ${clockOf(f.end)}</span>
          </span>`,
        )}
        ${mine.map((b) => {
          const joined = b.codes.length > 1;
          const word = sessionWord(b);
          return html`<button type="button"
            class=${`rv-barra rv-barra--${b.r.status}${joined ? " is-junta" : ""}${b.seated ? " is-sentada" : ""}`}
            style=${`--ini:${b.start - span.from};--dur:${b.end - b.start};--col:${b.col};--cols:${b.cols}`}
            @click=${() => open(b.r.id)}>
            <span class="rv-barra__texto"><b>${clockOf(b.start)} ${firstName(b.r.customer?.name)}</b> · ${b.r.party_size}</span>
            ${joined ? html`<span class="rv-barra__junta">junta ${b.codes.join(" + ")}</span>` : nothing}
            <span class="sr-only">, ${table.code}, das ${clockOf(b.start)} às ${clockOf(b.end)}${word ? `, ${word}` : ""}, </span>
            ${word ? html`<span class="badge rv-barra__sessao" aria-hidden="true">${word}</span>` : statusBadge(b.r.status)}
          </button>`;
        })}
      </div>
    </li>`;
  };

  return html`<div class="rv-mesas">
    ${closedNote(night)}
    ${waitingStrip(strip, open)}
    <p class="rv-legenda">Cada linha é uma mesa da planta <b>${layout.name}</b>. As barras vão da chegada ao fim do tempo de mesa; o tracejado é tempo livre.</p>
    <div class="rv-rolagem rv-mesas__rolagem" role="region" aria-label="Mesas por horário" tabindex="0">
      <div class="rv-mesas__grade" style=${`--rv-span:${span.to - span.from}`}>
        <div class="rv-mesas__regua" aria-hidden="true">
          <span class="rv-mesas__mesa rv-mesas__canto">Mesa</span>
          <div class="rv-mesas__tempo">
            ${span.hours.map((m) => html`<span class="rv-mesas__hora" style=${`--ini:${m - span.from}`}>${clockOf(m)}</span>`)}
          </div>
        </div>
        ${areaKeys.map((key) => {
          const tables = layout.tables.filter((t) => t.area === key);
          const list = modeOf(key) === "list";
          return html`<section class="rv-mesas__area" aria-label=${AREA[key] || key}>
            <h3 class="rv-mesas__area-nome"><span>${AREA[key] || key}${list ? " · lista por pessoa" : ""}</span></h3>
            <ol class="rv-mesas__linhas">${tables.map(row)}</ol>
          </section>`;
        })}
        ${showNow
          ? html`<span class="rv-agora rv-agora--deitada" style=${`--ini:${now - span.from}`} role="img" aria-label=${`Agora, ${clockOf(now)}`}><span>${clockOf(now)}</span></span>`
          : nothing}
      </div>
    </div>
  </div>`;
}

/** Os trechos do horário de funcionamento que nenhuma barra cobre. */
function freeStretches(bars, opens, closes) {
  const busy = bars.map((b) => [Math.max(b.start, opens), Math.min(b.end, closes)]).filter(([a, z]) => z > a).sort((a, b) => a[0] - b[0]);
  const out = [];
  let cursor = opens;
  for (const [a, z] of busy) {
    if (a - cursor >= MIN_FREE) out.push({ start: cursor, end: a });
    cursor = Math.max(cursor, z);
  }
  if (closes - cursor >= MIN_FREE) out.push({ start: cursor, end: closes });
  return out;
}
