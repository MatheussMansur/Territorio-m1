// "Números" da área Site: visitas, de onde vêm e o que abrem. O contador próprio do site
// (próprio, sem terceiros) ainda não está no ar, então o mock responde números de exemplo
// e a tela avisa.
import { formatDay } from "../../../lib/dates.js";
import { html, nothing } from "../../../lib/html.js";

const n = (value) => Number(value || 0).toLocaleString("pt-BR");
const pct = (share) => `${Math.round(share * 100)}%`;
const LANG = { pt: "Português", es: "Espanhol", en: "Inglês" };

function compare(now, before) {
  if (!before) return "";
  const diff = Math.round(((now - before) / before) * 100);
  if (diff === 0) return "igual à semana anterior";
  return `${diff > 0 ? "+" : "−"}${Math.abs(diff)}% sobre a semana anterior`;
}

function shares(title, rows, label) {
  return html`<section class="st-numeros__bloco" aria-labelledby=${`num-${label}`}>
    <h2 class="st-h2" id=${`num-${label}`}>${title}</h2>
    <ul class="st-barras">
      ${rows.map(
        (r) => html`<li class="st-barra">
          <span class="st-barra__nome">${r.name}</span>
          <span class="st-barra__trilho" aria-hidden="true"><span class="st-barra__valor" style=${`inline-size:${Math.max(2, r.share * 100)}%`}></span></span>
          <b class="st-barra__num">${r.value}</b>
        </li>`,
      )}
    </ul>
  </section>`;
}

export function numbersView(stats) {
  const days = (stats.days || []).slice(-14);
  const top = Math.max(1, ...days.map((d) => d.visits));
  return html`<p class="notice st-exemplo"><b>Números de exemplo.</b> O contador de visitas do próprio site entra no ar junto com o site novo. Até lá, estes números só mostram como a tela vai ficar.</p>
    <div class="stats st-numeros__stats">
      <div class="stat"><b>${n(stats.visits)}</b><small>visitas nos últimos 7 dias · ${compare(stats.visits, stats.visits_before)}</small></div>
      <div class="stat"><b>${n(stats.visitors)}</b><small>pessoas diferentes</small></div>
      <div class="stat"><b>${n(stats.reservations)}</b><small>reservas feitas pelo site · ${compare(stats.reservations, stats.reservations_before)}</small></div>
      <div class="stat stat--kraft"><b>${n(stats.menu_views)}</b><small>vezes que abriram o cardápio</small></div>
    </div>
    <div class="st-numeros">
      <section class="st-numeros__bloco st-numeros__bloco--largo" aria-labelledby="num-dias">
        <h2 class="st-h2" id="num-dias">Visitas por dia</h2>
        <p class="cs-dica">Quarta a sábado, com a casa aberta, o site recebe mais gente.</p>
        <ul class="st-barras">
          ${days.map(
            (d) => html`<li class="st-barra">
              <span class="st-barra__nome">${formatDay(d.date)}</span>
              <span class="st-barra__trilho" aria-hidden="true"><span class="st-barra__valor" style=${`inline-size:${(d.visits / top) * 100}%`}></span></span>
              <b class="st-barra__num">${n(d.visits)}</b>
            </li>`,
          )}
        </ul>
      </section>
      ${shares("De onde vêm", (stats.sources || []).map((s) => ({ name: s.source, share: s.share, value: pct(s.share) })), "origem")}
      ${shares("Língua do site", (stats.languages || []).map((s) => ({ name: LANG[s.lang] || s.lang, share: s.share, value: pct(s.share) })), "lingua")}
      ${stats.pages?.length
        ? html`<section class="st-numeros__bloco st-numeros__bloco--largo" aria-labelledby="num-paginas">
            <h2 class="st-h2" id="num-paginas">Páginas mais vistas</h2>
            <div class="table-wrap">
              <table class="data-table">
                <thead><tr><th scope="col">Página</th><th scope="col">Endereço</th><th scope="col">Vezes</th></tr></thead>
                <tbody>
                  ${stats.pages.map(
                    (p) => html`<tr>
                      <td data-label="Página" class="strong">${p.label}</td>
                      <td data-label="Endereço" class="num">${p.path}</td>
                      <td data-label="Vezes" class="num">${n(p.views)}</td>
                    </tr>`,
                  )}
                </tbody>
              </table>
            </div>
          </section>`
        : nothing}
    </div>`;
}
