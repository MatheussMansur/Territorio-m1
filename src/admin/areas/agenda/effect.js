// "Quem perde mesa": o único componente que mostra o que uma mudança faz com as reservas
// já feitas (quem fica com a mesa, quem muda, quem fica sem) e pede à equipe para
// decidir cada caso antes de salvar. Agenda, Plantas e Eventos passam todos por ele.
import { html, nothing } from "../../../lib/html.js";
import { formatDay, shortTime } from "../../../lib/dates.js";
import { toast } from "../../../components/toast.js";
import { errorText, openSheet, plural } from "./ui.js";

const where = (codes, list) => (codes?.length ? codes.join(" + ") : list ? `lista do ${list === "salao" ? "salão" : list === "balcao" ? "balcão" : list}` : "sem mesa");

/** Os resultados de qualquer simulação como uma lista de DayPlanResult. */
export function asResults(answer) {
  if (!answer) return [];
  if (Array.isArray(answer)) return answer;
  if (Array.isArray(answer.by_date)) return answer.by_date;
  if (Array.isArray(answer.items)) return answer.items;
  return [answer];
}

const touches = (r) => r.moved?.length || r.without_table?.length || r.blocked || r.seated?.length;
const totals = (results) => ({
  kept: results.reduce((n, r) => n + (r.kept?.length || 0), 0),
  moved: results.reduce((n, r) => n + (r.moved?.length || 0), 0),
  without: results.reduce((n, r) => n + (r.without_table?.length || 0), 0),
});

function caseRow(row, result, decisions, refresh) {
  const d = decisions.get(row.reservation_id) || {};
  const set = (patch) => {
    decisions.set(row.reservation_id, { ...d, ...patch });
    refresh();
  };
  const name = `caso-${row.reservation_id}`;
  const closed = result.blocked === "day_has_reservations";
  // outro horário, ou o mesmo horário em outra mesa: as mesas livres de cada horário vêm com
  // a simulação (row.options); sem elas, só outro horário
  const options = row.options || {};
  const slots = (result.day?.slots || []).filter((t) => t !== row.time || options[t]?.length);
  const time = d.time || "";
  const tables = options[time] || [];
  const option = (value, label, disabled = false) => html`<label class="ag-escolha ${d.action === value ? "is-on" : ""}">
    <input type="radio" name=${name} value=${value} .checked=${d.action === value} ?disabled=${disabled} @change=${() => set({ action: value })} />
    <span>${label}</span>
  </label>`;
  return html`<li class="ag-caso">
    <fieldset class="ag-caso__campos">
      <legend class="ag-caso__quem">
        <b>${row.name || row.code}</b>
        <span>${shortTime(row.time)} · ${plural(row.party_size, "pessoa", "pessoas")} · estava em ${where(row.from, row.from_list)}</span>
      </legend>
      <div class="ag-escolhas">
        ${closed ? nothing : option("reschedule", "Remarcar", !slots.length)}
        ${option("cancel", "Cancelar avisando")}
        ${closed ? nothing : option("keep", "Manter com observação")}
      </div>
      ${d.action === "reschedule"
        ? html`<div class="ag-remarca">
            <label class="field">
              <span class="field__label">Horário</span>
              <select class="field__input" @change=${(e) => set({ time: e.target.value, table: "" })}>
                <option value="" ?selected=${!time}>Escolha</option>
                ${slots.map((t) => html`<option value=${t} ?selected=${time === t}>${t === row.time ? `${t} (o mesmo, outra mesa)` : t}</option>`)}
              </select>
            </label>
            ${time && tables.length
              ? html`<label class="field">
                  <span class="field__label">Mesa</span>
                  <select class="field__input" @change=${(e) => set({ table: e.target.value })}>
                    <option value="" ?selected=${!d.table}>${time === row.time ? "Escolha a mesa" : "A casa escolhe a menor livre"}</option>
                    ${tables.map((o) => {
                      const key = o.codes.join("+");
                      return html`<option value=${key} ?selected=${d.table === key}>${o.codes.join(" + ")} · ${plural(o.seats, "lugar", "lugares")}${o.seats < row.party_size ? " (aperta)" : ""}</option>`;
                    })}
                  </select>
                </label>`
              : nothing}
          </div>`
        : nothing}
      ${d.action === "cancel"
        ? html`<label class="field">
            <span class="field__label">Motivo <small>vai na mensagem ao cliente</small></span>
            <input class="field__input" .value=${d.note ?? "Mudança no plano da casa para esse dia"} @input=${(e) => decisions.set(row.reservation_id, { ...decisions.get(row.reservation_id), note: e.target.value })} />
          </label>`
        : nothing}
      ${d.action === "keep"
        ? html`<label class="field">
            <span class="field__label">Observação <small>só a equipe vê</small></span>
            <input class="field__input" .value=${d.note ?? ""} placeholder="Ex.: encaixar no balcão" @input=${(e) => decisions.set(row.reservation_id, { ...decisions.get(row.reservation_id), note: e.target.value })} />
          </label>`
        : nothing}
    </fieldset>
  </li>`;
}

function dateSection(result, many, decisions, refresh) {
  const moved = result.moved || [];
  const without = result.without_table || [];
  const kept = result.kept || [];
  const closed = result.blocked === "day_has_reservations";
  return html`<section class="ag-efeito__dia" aria-label=${formatDay(result.date, "long")}>
    ${many ? html`<h3 class="ag-efeito__data">${formatDay(result.date, "long")}</h3>` : nothing}
    ${closed
      ? html`<div class="notice notice--alert" role="alert">
          <b>Esse dia tem ${plural(without.length + kept.length + moved.length, "reserva ativa", "reservas ativas")}.</b>
          Antes de fechar, cancele avisando cada uma, ou remarque em <a href="/admin/reservas" data-close>Reservas</a>.
        </div>`
      : nothing}
    ${result.seated?.length
      ? html`<h4 class="ag-efeito__grupo ag-efeito__grupo--sem">Mesas sentadas que saem · ${result.seated.length}</h4>
          <div class="notice notice--alert" role="alert">
            Quem já está sentado não muda de mesa por aqui. Espere a mesa liberar ou troque o grupo de mesa no
            <a href="/admin/salao" data-close>Salão</a>; depois veja o efeito de novo.
          </div>
          <ul class="ag-lista">
            ${result.seated.map((x) => html`<li><b>${x.name}</b> · ${plural(x.people, "pessoa", "pessoas")} · mesa ${x.table_codes.join(" + ")}</li>`)}
          </ul>`
      : nothing}
    ${without.length
      ? html`<h4 class="ag-efeito__grupo ag-efeito__grupo--sem">Sem mesa · ${without.length}</h4>
          <ul class="ag-casos">${without.map((row) => caseRow(row, result, decisions, refresh))}</ul>`
      : nothing}
    ${moved.length
      ? html`<h4 class="ag-efeito__grupo">Mudam · ${moved.length}</h4>
          <ul class="ag-lista">
            ${moved.map(
              (row) => html`<li>
                <b>${row.name || row.code}</b> · ${shortTime(row.time)} · ${plural(row.party_size, "pessoa", "pessoas")}
                <span class="ag-troca">${where(row.from, row.from_list)} <span aria-hidden="true">→</span><span class="sr-only">passa para</span> ${where(row.to, row.to_list)}</span>
              </li>`,
            )}
          </ul>`
      : nothing}
    ${kept.length
      ? html`<details class="ag-ficam">
          <summary>Mantêm a mesa · ${kept.length}</summary>
          <ul class="ag-lista">
            ${kept.map((row) => html`<li><b>${row.name || row.code}</b> · ${shortTime(row.time)} · ${where(row.to, row.to_list)}</li>`)}
          </ul>
        </details>`
      : nothing}
  </section>`;
}

/** O efeito como um resumo mais cada data; as decisões ficam em `decisions`. */
export function effectView(results, decisions, refresh) {
  const t = totals(results);
  const seatsBefore = results.length === 1 ? results[0].seats_before : null;
  const seatsAfter = results.length === 1 ? results[0].seats_after : null;
  const ordered = [...results].sort((a, b) => (b.without_table?.length || 0) - (a.without_table?.length || 0) || a.date.localeCompare(b.date));
  return html`<div class="ag-efeito">
    <dl class="ag-efeito__resumo">
      <div><dt>Mantêm a mesa</dt><dd>${t.kept}</dd></div>
      <div><dt>Mudam</dt><dd>${t.moved}</dd></div>
      <div class=${t.without ? "is-alerta" : ""}><dt>Sem mesa</dt><dd>${t.without}</dd></div>
      ${seatsBefore != null ? html`<div><dt>Lugares</dt><dd>${seatsBefore} <span aria-hidden="true">→</span><span class="sr-only">passam a</span> ${seatsAfter}</dd></div>` : nothing}
    </dl>
    ${ordered.map((r) => dateSection(r, results.length > 1, decisions, refresh))}
  </div>`;
}

const rowOf = (results, id) => results.flatMap((r) => r.without_table || []).find((x) => x.reservation_id === id);

const pending = (results, decisions) =>
  results.flatMap((r) => r.without_table || []).filter((row) => {
    const d = decisions.get(row.reservation_id);
    if (!d?.action) return true;
    if (d.action !== "reschedule") return false;
    // manter o mesmo horário só faz sentido com outra mesa
    return !d.time || (d.time === row.time && !d.table);
  });

const asResolutions = (decisions, results) =>
  [...decisions.entries()]
    .filter(([, d]) => d.action)
    .map(([id, d]) => {
      const row = rowOf(results, id);
      const moving = d.action === "reschedule";
      return {
        reservation_id: id,
        action: d.action,
        time: moving && d.time && d.time !== row?.time ? d.time : null,
        table_codes: moving && d.table ? d.table.split("+") : null,
        note: d.note ?? (d.action === "cancel" ? "Mudança no plano da casa para esse dia" : ""),
      };
    });

const seatedIn = (results) => results.flatMap((r) => r.seated || []);

/**
 * Simula, mostra o efeito quando alguém é atingido, e salva uma vez quando cada caso sem
 * mesa tem uma decisão. Resolve com a resposta do commit, ou null quando a pessoa desistiu.
 * `simulate()` e `commit({ resolutions, notify, confirm })` chamam a API.
 */
export async function withEffect({ title = "O efeito da mudança", simulate, commit, saveLabel = "Gravar" }) {
  let results = asResults(await simulate());
  if (!results.some(touches)) return commit({ resolutions: [], notify: false, confirm: false });

  const decisions = new Map();
  let notify = true;
  let busy = false;
  let problem = null;
  let stale = false; // plan_changed: a pessoa olha o efeito de novo antes de salvar
  let answer = null;
  let fatal = null; // um 412 ou uma sessão perdida: a tela de trás guarda as mudanças e decide

  const sheet = openSheet({
    title,
    isDirty: () => decisions.size > 0 && !answer,
    view: (close, refresh) => {
      const open = pending(results, decisions);
      const seated = seatedIn(results);
      const again = async () => {
        busy = true;
        refresh();
        try {
          results = asResults(await simulate());
          problem = null;
          stale = false;
        } catch (e) {
          problem = errorText(e);
        }
        busy = false;
        refresh();
      };
      const save = async () => {
        if (seated.length) {
          problem = `${plural(seated.length, "mesa sentada sai", "mesas sentadas saem")} da planta. Espere liberar ou troque o grupo de mesa no Salão.`;
          refresh();
          return;
        }
        if (open.length) {
          problem = `${plural(open.length, "reserva ainda está", "reservas ainda estão")} sem decisão. Escolha o que fazer com cada uma.`;
          refresh();
          sheet.dialog.querySelector(".ag-caso input:not(:checked)")?.focus();
          return;
        }
        busy = true;
        problem = null;
        refresh();
        try {
          answer = await commit({ resolutions: asResolutions(decisions, results), notify, confirm: true });
          close(answer);
        } catch (error) {
          busy = false;
          if (error?.status === 412 || error?.status === 401) {
            fatal = error;
            close(null);
            return;
          }
          if (error?.status === 409) {
            // plan_changed: uma reserva entrou ou saiu desde a prévia
            stale = true;
            problem = "O efeito mudou desde a prévia. Entrou ou saiu reserva enquanto você olhava. Veja o efeito de novo antes de gravar.";
          } else problem = errorText(error);
          refresh();
          sheet.dialog.querySelector(".ag-sheet__aviso")?.focus();
        }
      };
      return html`
        <p class="ag-sheet__lead">Veja quem mantém a mesa, quem muda e quem fica sem mesa. Nada foi gravado ainda.</p>
        ${problem ? html`<div class="notice notice--alert ag-sheet__aviso" role="alert" tabindex="-1">${problem}</div>` : nothing}
        ${effectView(results, decisions, refresh)}
        <label class="ag-check">
          <input type="checkbox" .checked=${notify} @change=${(e) => (notify = e.target.checked)} />
          <span>Avisar pelo WhatsApp quem mudou de mesa ou de horário</span>
        </label>
        <div class="dialog__actions ag-sheet__acoes">
          <button class="btn btn--outline" type="button" data-close>Voltar</button>
          ${stale
            ? html`<button class="btn" type="button" aria-busy=${busy ? "true" : "false"} ?disabled=${busy} @click=${again}>Ver o efeito de novo</button>`
            : html`<button class="btn" type="button" aria-busy=${busy ? "true" : "false"} ?disabled=${busy || seated.length > 0} @click=${save}>${saveLabel}</button>`}
        </div>
      `;
    },
  });
  const value = await sheet.done;
  if (fatal) throw fatal;
  if (value) {
    const t = totals(results);
    if (t.moved || t.without) toast({ title: "Gravado", message: notify ? "Quem mudou recebe o aviso pelo WhatsApp." : "Ninguém foi avisado." });
  }
  return value ?? null;
}
