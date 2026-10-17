// A tabela única da casa sobre o fim da tolerância (história 2.12), repetida com as mesmas palavras
// onde a regra é usada: Configurações (grupos Reservas e Salão) e o próprio Salão.
// Quem decide a prioridade (Reservas › "Depois da tolerância"), quem age (Salão › "Ao fim da
// tolerância"), a única combinação aceita, e o extra para quem avisou que vai atrasar.
import { html, nothing } from "../../../lib/html.js";

const AFTER = [
  ["lose_priority", "Perde a prioridade", "Padrão. A reserva continua; a mesa deixa de ser só dela."],
  ["release", "Libera a mesa", "A reserva continua, sem a mesa guardada."],
];
const END = [
  ["suggest_no_show", "Sugerir “Não veio”", "Padrão. Nada muda sozinho: a recepção decide."],
  ["auto_release", "Soltar a mesa sozinho", "O sistema solta a mesa. Só vale com “Libera a mesa”."],
];

const mark = (on) => (on ? html`<span class="badge badge--said-yes">em uso</span>` : nothing);

/**
 * @param {{tolerance_min?: number, extra_tolerance_min?: number, after_tolerance?: string, on_tolerance_end?: string}} rules
 * @param {{caption?: string}} [options]
 */
export function toleranceTable(rules = {}, { caption = "Como funciona o fim da tolerância" } = {}) {
  const tolerance = rules.tolerance_min ?? 20;
  const extra = rules.extra_tolerance_min ?? 10;
  const after = rules.after_tolerance ?? "lose_priority";
  const end = rules.on_tolerance_end ?? "suggest_no_show";
  return html`<table class="data-table data-table--stack tolerancia">
    <caption class="tolerancia__titulo">${caption}</caption>
    <thead><tr><th scope="col">Onde</th><th scope="col">Opção</th><th scope="col">O que acontece</th></tr></thead>
    <tbody>
      ${AFTER.map(
        ([key, label, text]) => html`<tr data-opcao=${key}>
          <th scope="row" data-label="Onde">Reservas › Depois da tolerância</th>
          <td data-label="Opção">${label} ${mark(after === key)}</td>
          <td data-label="O que acontece">${text}</td>
        </tr>`,
      )}
      ${END.map(
        ([key, label, text]) => html`<tr data-opcao=${key}>
          <th scope="row" data-label="Onde">Salão › Ao fim da tolerância</th>
          <td data-label="Opção">${label} ${mark(end === key)}</td>
          <td data-label="O que acontece">${text}</td>
        </tr>`,
      )}
    </tbody>
    <tfoot>
      <tr><td colspan="3">
        ${tolerance ? `A tolerância é de ${tolerance} min` : "A mesa espera no horário, em ponto"}${extra
          ? `, mais ${extra} min uma vez só para quem avisou que atrasa (o extra não soma).`
          : "."}
        “Soltar a mesa sozinho” com “Perde a prioridade” não é aceito.
      </td></tr>
    </tfoot>
  </table>`;
}
