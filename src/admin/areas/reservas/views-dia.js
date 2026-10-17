// "Dia": as horas da noite de cima para baixo, cada reserva um bloco da chegada ao fim do
// tempo de mesa, as do mesmo horário lado a lado, e a linha de agora na noite em andamento.
// Pedidos pendentes, a lista de espera e quem está sem mesa ficam numa faixa acima da grade.
import { shortTime, toMinutes } from "../../../lib/dates.js";
import { html, nothing } from "../../../lib/html.js";
import { AREA, people, statusBadge } from "./labels.js";
import { clockOf, firstName, minutesOn, nightSpan, packColumns, reservationSpan, unplaced } from "./views-data.js";

/** Onde fica uma reserva, em palavras: as mesas, a área da lista ou nada ainda. */
export function placeOf(r) {
  if (r.table_codes?.length) return `mesa ${r.table_codes.join(" + ")}`;
  if (r.area_key) return `${AREA[r.area_key] || r.area_key}, na lista`;
  return "sem mesa";
}

/** A faixa de quem ainda não tem lugar na grade. */
export function waitingStrip(list, open) {
  if (!list.length) return nothing;
  return html`<section class="rv-faixa" aria-labelledby="rv-faixa-titulo">
    <h3 class="rv-faixa__titulo" id="rv-faixa-titulo">Pedidos, espera e sem mesa · ${list.length}</h3>
    <ul class="rv-faixa__lista">
      ${list.map(
        (r) => html`<li><button type="button" class="rv-cartao" @click=${() => open(r.id)}>
          <b>${shortTime(r.time)} · ${firstName(r.customer?.name)}</b>
          <span>${people(r.party_size)} · ${placeOf(r)}</span>
          ${statusBadge(r.status)}
        </button></li>`,
      )}
    </ul>
  </section>`;
}

/** A noite fechada, escrita acima da grade. */
export function closedNote(night) {
  if (!night.day || night.day.open) return nothing;
  return html`<p class="notice rv-fechado-aviso"><b>Fechado</b>${night.day.reason_label ? ` · ${night.day.reason_label}` : ""}. A casa não abre nessa noite.</p>`;
}

export function dayView(night, { open }) {
  const strip = night.reservations.filter(unplaced);
  const placed = night.reservations.filter((r) => !unplaced(r));
  const blocks = packColumns(placed.map((r) => ({ r, ...reservationSpan(r, night.date) })));
  const span = nightSpan(night, blocks);
  const cols = Math.max(1, ...blocks.map((b) => b.cols));
  const now = night.now ? minutesOn(night.now, night.date) : null;
  const showNow = now != null && now >= span.from && now <= span.to;
  const opensAt = night.day?.opens_at ? toMinutes(night.day.opens_at) : null;

  return html`<div class="rv-dia">
    ${closedNote(night)}
    ${waitingStrip(strip, open)}
    ${!placed.length
      ? html`<div class="empty rv-vazio"><span class="raiz" aria-hidden="true"></span>
          <b>Nenhuma reserva com mesa nessa noite</b>
          <p>${strip.length ? "Quem está acima ainda espera mesa ou resposta." : "Quando alguém reservar, o bloco aparece aqui no horário."}</p></div>`
      : nothing}
    <div class="rv-rolagem" role="region" aria-label="Horários da noite" tabindex="0">
      <div class="rv-dia__grade" style=${`--rv-span:${span.to - span.from};--rv-cols:${cols}`}>
        <ol class="rv-dia__horas" aria-hidden="true">
          ${span.hours.map((m) => html`<li style=${`--ini:${m - span.from}`}>${clockOf(m)}</li>`)}
        </ol>
        <div class="rv-dia__trilho">
          ${span.hours.map((m) => html`<span class="rv-dia__linha-hora" style=${`--ini:${m - span.from}`} aria-hidden="true"></span>`)}
          ${opensAt != null && opensAt > span.from
            ? html`<span class="rv-dia__antes" style=${`--dur:${opensAt - span.from}`} aria-hidden="true"></span>`
            : nothing}
          <ol class="rv-dia__blocos" aria-label="Reservas por horário">
            ${blocks.map(
              (b) => html`<li class="rv-dia__item" style=${`--ini:${b.start - span.from};--dur:${b.end - b.start};--col:${b.col};--cols:${b.cols}`}>
                <button type="button" class=${`rv-bloco rv-bloco--${b.r.status}`} @click=${() => open(b.r.id)}>
                  <span class="rv-bloco__hora">${clockOf(b.start)}<span class="sr-only"> às ${clockOf(b.end)}</span></span>
                  <b class="rv-bloco__nome">${firstName(b.r.customer?.name)}</b>
                  <span class="rv-bloco__info">${people(b.r.party_size)} · ${placeOf(b.r)}</span>
                  ${statusBadge(b.r.status)}
                </button>
              </li>`,
            )}
          </ol>
          ${showNow
            ? html`<span class="rv-agora" style=${`--ini:${now - span.from}`} role="img" aria-label=${`Agora, ${clockOf(now)}`}><span>${clockOf(now)}</span></span>`
            : nothing}
        </div>
      </div>
    </div>
  </div>`;
}
