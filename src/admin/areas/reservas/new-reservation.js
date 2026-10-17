// "Nova reserva": uma reserva pedida por telefone, WhatsApp ou no balcão. A mesma disponibilidade do
// site (a API decide), o canal registrado, o comprovante no WhatsApp do cliente.
// O botão trava no primeiro toque e a criação leva uma Idempotency-Key por janela.
// Um número que o WhatsApp lê diferente (+54 com o "15" ou sem o "9", +595 com o
// "0") pergunta "Confere?" antes de criar; o idioma das mensagens segue o país, ou
// o idioma que o cliente já usa com a casa (GET /staff/customers/language).
// "Não tem WhatsApp" reserva por telefone: a reserva é confirmada com a marca "sem
// WhatsApp · confirmar por ligação", nenhuma mensagem sai, e a janela então mostra "Ler para
// o cliente", as frases curtas para ler no telefone (história 5.19).
import "../reservas.css";
import { showFormErrors } from "../../../components/field.js";
import { phoneField } from "../../../components/phone-field.js";
import { openDialog } from "../../../components/dialog.js";
import { toast } from "../../../components/toast.js";
import { formatDay, houseParts, houseTime } from "../../../lib/dates.js";
import { html, nothing, render } from "../../../lib/html.js";
import { COUNTRIES, countryOf, formatPhone } from "../../../lib/phone.js";
import { rules } from "../../../lib/validate.js";
import { uuid } from "../../../lib/uuid.js";
import * as house from "../../../services/api/availability.js";
import * as api from "../../../services/api/staff-reservas.js";
import { tableChoice } from "./drawer.js";
import { problemText } from "./errors.js";
import { formDialog } from "./form-dialog.js";
import { FLAG, canOverride } from "./labels.js";

const CHANNELS = [
  { value: "phone", label: "Telefone" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "walk_in", label: "Balcão" },
];
const LOCALES = [
  { value: "pt", label: "Português" },
  { value: "es", label: "Espanhol" },
  { value: "en", label: "Inglês" },
];
const PARTY_MAX = 40;

/**
 * @param {{user: any, date?: string}} options
 * @returns {Promise<any>} a nova reserva (ReservationStaff), ou null quando fechada sem ela
 */
export async function openNewReservation({ user, date } = {}) {
  const key = uuid();
  // passar do limite do horário, com um motivo: o arquivo de permissões diz quem (história 1.3)
  const overrides = canOverride(user);
  const today = houseParts(new Date()).date;
  let phone = null;
  let created = null;
  let dirty = false;
  let slotsRun = 0;
  let tablesRun = 0;
  // o idioma: sugerido pelo país, depois pelo guardado do cliente; uma escolha à mão vence
  let localeByHand = false;
  let lookedUp = null;

  async function loadSlots(ctx) {
    const run = ++slotsRun;
    const { date: day, party } = ctx.state;
    ctx.update({ slots: null, closed: null, time: null, options: null });
    try {
      const answer = await house.getSlots({ date: day, partySize: Math.min(party, 8) });
      if (run !== slotsRun) return;
      if (!answer.open) return ctx.update({ slots: [], closed: answer.reason_label || "fechado" });
      const times = answer.slots.map((s) => s.time);
      ctx.update({ slots: times.map((time) => ({ time, free: null })) });
      const counts = await Promise.all(
        times.map((time) => api.availability({ date: day, time, partySize: party }).then((o) => o.length, () => null)),
      );
      if (run !== slotsRun) return;
      ctx.update({ slots: times.map((time, i) => ({ time, free: counts[i] })) });
    } catch {
      if (run === slotsRun) ctx.update({ slots: [], closed: null, slotsFailed: true });
    }
  }

  async function loadTables(ctx, time) {
    const run = ++tablesRun;
    ctx.update({ time, options: null, pick: null, waitlist: false, override: false });
    try {
      const options = await api.availability({ date: ctx.state.date, time, partySize: ctx.state.party });
      if (run !== tablesRun) return;
      ctx.update({ options, pick: options[0]?.table_codes.join("+") || null });
    } catch {
      if (run === tablesRun) ctx.update({ options: [] });
    }
  }

  /** "Ver horários" (5.6): volta aos horários do dia, atualizados, com o primeiro que tem mesa em foco. */
  async function showSlots(ctx) {
    ctx.error = null;
    ctx.update({ time: null, options: null, pick: null, waitlist: false, override: false });
    await loadSlots(ctx);
    const free = ctx.dialog.querySelector(".res-hora:not(.is-cheio) input") || ctx.dialog.querySelector(".res-hora input");
    free?.focus();
  }

  const setParty = (ctx, n) => {
    const party = Math.max(1, Math.min(PARTY_MAX, Number(n) || 1));
    if (party === ctx.state.party) return;
    ctx.update({ party });
    loadSlots(ctx);
  };

  const view = (ctx) => {
    const st = ctx.state;
    const full = st.options && !st.options.length;
    return html`<div class="res-nova">
      <fieldset class="res-segmento">
        <legend class="field__label">O pedido chegou por</legend>
        ${CHANNELS.map(
          (c) => html`<label class="res-segmento__opcao"><input type="radio" name="source" value=${c.value} ?checked=${st.source === c.value}
            @change=${() => ctx.update({ source: c.value })}><span>${c.label}</span></label>`,
        )}
      </fieldset>

      <div class="res-nova__linha">
        <div class="field res-pessoas">
          <label class="field__label" for="nova-pessoas">Pessoas</label>
          <div class="res-passo">
            <button type="button" class="action" aria-label="Uma pessoa a menos" @click=${() => setParty(ctx, st.party - 1)}>−</button>
            <input class="field__input" id="nova-pessoas" name="party_size" type="number" inputmode="numeric" min="1" max=${PARTY_MAX}
              .value=${String(st.party)} @change=${(e) => setParty(ctx, e.target.value)}>
            <button type="button" class="action" aria-label="Uma pessoa a mais" @click=${() => setParty(ctx, st.party + 1)}>+</button>
          </div>
        </div>
        <div class="field">
          <label class="field__label" for="nova-dia">Dia</label>
          <input class="field__input" id="nova-dia" name="date" type="date" min=${today} .value=${st.date}
            @change=${(e) => e.target.value && (ctx.update({ date: e.target.value }), loadSlots(ctx))}>
          <p class="field__help">${formatDay(st.date, "long")}</p>
        </div>
      </div>

      <div class="field">
        <span class="field__label" id="nova-hora">Horário</span>
        ${slotsView(ctx, loadTables)}
      </div>

      ${st.time
        ? html`<div class="field">
            ${full
              ? html`<p class="notice notice--alert"><b>Esse horário está cheio.</b> ${overrides ? "Escolha outro horário, ponha na espera ou passe do limite com motivo." : "Escolha outro horário ou ponha na lista de espera."}
                    <button type="button" class="btn btn--outline btn--sm" @click=${() => showSlots(ctx)}>Ver horários</button></p>
                  <label class="res-opcao"><input type="checkbox" name="waitlist" .checked=${st.waitlist} @change=${(e) => ctx.update({ waitlist: e.target.checked, override: false })}> Pôr na lista de espera das ${st.time}</label>
                  ${overrides
                    ? html`<label class="res-opcao"><input type="checkbox" name="override" .checked=${st.override} @change=${(e) => ctx.update({ override: e.target.checked, waitlist: false })}> Passar do limite</label>
                        ${st.override
                          ? html`<div class="field"><label class="field__label" for="nova-motivo">Motivo para passar do limite</label>
                              <textarea class="field__input" id="nova-motivo" name="override_reason" rows="2" maxlength="280"></textarea>
                              <p class="field__help">Fica no registro de ações.</p></div>`
                          : nothing}`
                    : nothing}`
              : html`<div @change=${(e) => e.target.name === "mesa" && ctx.update({ pick: e.target.value })}>${tableChoiceChecked(st)}</div>`}
          </div>`
        : nothing}

      ${confere(ctx)}
      <div class="res-nova__linha">
        <div class="field">
          <label class="field__label" for="nova-nome">Nome</label>
          <input class="field__input" id="nova-nome" name="name" autocomplete="off" maxlength="60" @input=${() => (dirty = true)}>
        </div>
        <div class="field" id="nova-telefone">
          <label class="field__label" for="nova-fone">${st.noWhatsapp ? html`Telefone <small>para ligar</small>` : html`WhatsApp <small>para o comprovante</small>`}</label>
          <div class="phone">
            <select class="field__input" aria-label="País" @change=${(e) => localeByHand || ctx.update({ locale: e.target.value === "BR" ? "pt" : "es", localeFrom: null })}>
              ${COUNTRIES.map((c) => html`<option value=${c.id}>${c.label}</option>`)}
            </select>
            <input class="field__input" id="nova-fone" name="phone" type="tel" inputmode="tel" autocomplete="off" placeholder="(45) 99999-0000">
          </div>
          <p class="field__help">${st.noWhatsapp ? "A casa liga para confirmar no dia." : "Sem número, a reserva vale, mas o comprovante não sai."}</p>
        </div>
      </div>
      <label class="res-opcao"><input type="checkbox" name="no_whatsapp" .checked=${st.noWhatsapp} @change=${(e) => ctx.update({ noWhatsapp: e.target.checked })}>
        O cliente não tem WhatsApp: confirmar por ligação</label>

      <div class="field">
        <label class="field__label" for="nova-lingua">Língua das mensagens</label>
        <select class="field__input" id="nova-lingua" name="locale" .value=${st.locale} @change=${(e) => ((localeByHand = true), ctx.update({ locale: e.target.value, localeFrom: null }))}>
          ${LOCALES.map((l) => html`<option value=${l.value} ?selected=${st.locale === l.value}>${l.label}</option>`)}
        </select>
        <p class="field__help">${st.localeFrom === "customer" ? "A língua que o cliente já usa com a casa; mude se ele preferir." : "Sugerida pelo país do número; mude se o cliente preferir."}</p>
      </div>

      <fieldset class="res-marcadores">
        <legend class="field__label">Marcadores</legend>
        ${Object.entries(FLAG).map(([value, label]) => html`<label class="res-opcao"><input type="checkbox" name="flags" value=${value}> ${label}</label>`)}
      </fieldset>

      <div class="field">
        <label class="field__label" for="nova-obs">Observação <small>opcional</small></label>
        <textarea class="field__input" id="nova-obs" name="notes" rows="2" maxlength="280" @input=${() => (dirty = true)}></textarea>
      </div>
      <div class="field">
        <label class="field__label" for="nova-interna">Nota interna <small>só a equipe vê</small></label>
        <textarea class="field__input" id="nova-interna" name="internal_notes" rows="2" maxlength="500"></textarea>
      </div>
    </div>`;
  };

  /** O idioma guardado do cliente para este telefone (5.6), quando a casa já o conhece. */
  async function storedLanguage(ctx, e164) {
    lookedUp = e164;
    try {
      const { locale } = await api.customerLanguage(e164);
      if (lookedUp !== e164 || localeByHand || !locale) return;
      ctx.update({ locale, localeFrom: "customer" });
    } catch {
      // sem a resposta fica a sugestão do país
    }
  }

  /** "Confere?": o número como o WhatsApp lê, para conferir com o cliente antes de criar. */
  function confere(ctx) {
    const st = { e164: ctx.state.confere };
    if (!st.e164 || ctx.state.confirmedPhone === st.e164) return nothing;
    return html`<div class="notice res-confere" role="group" aria-labelledby="nova-confere">
      <p id="nova-confere"><b>Confere? ${formatPhone(st.e164)}</b> É assim que o WhatsApp lê esse número. Confira com o cliente antes de lançar.</p>
      <div class="cluster">
        <button class="btn btn--sm" type="button" @click=${() => (phone.trust(st.e164), ctx.update({ confirmedPhone: st.e164 }))}>Sim, confere</button>
        <button class="btn btn--sm btn--outline" type="button" @click=${() => ctx.dialog.querySelector("#nova-fone")?.focus()}>Corrigir</button>
      </div>
    </div>`;
  }

  const result = await formDialog({
    title: "Nova reserva",
    submitLabel: "Lançar reserva",
    cancelLabel: "Fechar",
    wide: true,
    isDirty: () => dirty,
    state: { source: "phone", party: 2, date: date && date >= today ? date : today, locale: "pt", slots: null, noWhatsapp: false, confere: null, confirmedPhone: null },
    init: (ctx) => {
      phone = phoneField(ctx.dialog.querySelector("#nova-telefone"), {
        onChange: (st) => {
          // +595 e +54 sugerem espanhol; a pessoa ainda pode mudar
          const byCountry = st.e164 ? (countryOf(st.e164) === "BR" ? "pt" : "es") : ctx.state.locale;
          const locale = localeByHand || (st.e164 && st.e164 === lookedUp && ctx.state.localeFrom === "customer") ? ctx.state.locale : byCountry;
          if (st.e164 && st.e164 !== lookedUp) storedLanguage(ctx, st.e164);
          // um número que o WhatsApp lê diferente espera o "Sim, confere" (guardado até o número mudar)
          const confere = st.corrected ? st.e164 : st.e164 === ctx.state.confere ? ctx.state.confere : null;
          // nada a desenhar quando nada mudou: redesenhar no blur moveria o botão debaixo do ponteiro
          if (confere !== ctx.state.confere || locale !== ctx.state.locale) ctx.update({ confere, locale });
        },
      });
      loadSlots(ctx);
    },
    view,
    onSubmit: async (data, ctx) => {
      const form = ctx.dialog.querySelector("form");
      const st = ctx.state;
      const errors = {};
      errors.name = rules.name(data.get("name"));
      const typed = String(data.get("phone") || "").trim();
      if (typed) phone.validate();
      const e164 = typed ? phone.value : null;
      const waiting = typed && st.confere && st.confirmedPhone !== st.confere;
      if (waiting) errors.phone = "Confira o número com o cliente e toque em \"Sim, confere\".";
      else if (typed && !e164) errors.phone = "Confira o número: tem que ser um celular com WhatsApp.";
      if (!st.time) errors.time = "Escolha o horário.";
      const overrideReason = String(data.get("override_reason") || "").trim();
      if (st.override && !overrideReason) errors.override_reason = "Escreva o motivo para passar do limite.";
      if (Object.values(errors).some(Boolean)) {
        showFormErrors(form, errors);
        ctx.error = { title: "Falta ajeitar alguns campos", message: errors.time && !errors.name ? errors.time : "Confira o que está marcado." };
        return false;
      }
      const body = {
        source: st.source,
        party_size: st.party,
        date: st.date,
        time: st.time,
        name: String(data.get("name")).trim(),
        phone: e164 || undefined,
        locale: st.locale,
        flags: data.getAll("flags"),
        notes: String(data.get("notes") || "").trim(),
        internal_notes: String(data.get("internal_notes") || "").trim(),
      };
      if (st.noWhatsapp) body.no_whatsapp = true;
      if (st.waitlist) body.waitlist = true;
      else if (st.override) body.override_reason = overrideReason;
      else if (st.pick) body.table_codes = st.pick.split("+");
      try {
        created = await api.create(body, key);
      } catch (error) {
        if (error?.type === "validation") showFormErrors(form, error.fieldErrors);
        if (error?.type === "slot_full") {
          // slot_full.staff com "Ver horários": a recepção nunca passa do limite (5.6)
          ctx.error = { ...problemText(error), action: { label: "Ver horários", onClick: () => showSlots(ctx) } };
          loadTables(ctx, st.time);
          return false;
        }
        if (error?.body?.reason === "table_taken") loadTables(ctx, st.time);
        // a reserva que já existe, dita pelo código, dia e horário
        if ((error?.type === "duplicate_reservation" || error?.type === "active_limit") && error.body?.existing?.length) {
          const known = problemText(error);
          const list = error.body.existing.map((x) => `${x.code} (${formatDay(x.date)}, ${x.time})`).join(", ");
          ctx.error = { title: known.title, message: `${known.message} Já existe: ${list}.` };
          return false;
        }
        throw error;
      }
      return created;
    },
  });
  if (!result) return null;
  const noMessage = (created.warnings || []).includes("needs_whatsapp");
  // needs_whatsapp aqui é um aviso, não um erro: a reserva está feita
  toast({
    title: created.status === "waitlisted" ? `${created.code} na lista de espera` : `Reserva ${created.code} lançada`,
    message: noMessage ? "Sem WhatsApp: o comprovante não sai. Leia os dados para o cliente." : "O comprovante saiu para o WhatsApp do cliente.",
  });
  if (created.no_whatsapp) await readToCustomer(created);
  return created;
}

/** "Ler para o cliente": a reserva em frases curtas, para ler em voz alta no telefone (5.19). */
function readToCustomer(r) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "dialog dialog--confirm res-ler";
    dialog.setAttribute("aria-labelledby", "ler-titulo");
    document.body.append(dialog);
    const tolerance = r.tolerance_min ? `A mesa espera até ${houseTime(r.tolerance_until)}.` : `A mesa espera às ${r.time} em ponto.`;
    render(
      html`<div class="dialog__body">
        <h2 id="ler-titulo">Ler para o cliente</h2>
        <ol class="res-ler__frases">
          <li>Sua reserva está confirmada.</li>
          <li>Dia: ${formatDay(r.date, "long")}.</li>
          <li>Hora: ${r.time}.</li>
          <li>${r.party_size} ${r.party_size === 1 ? "pessoa" : "pessoas"}.</li>
          <li>No nome de ${r.customer?.name}.</li>
          <li>Código: ${r.code.replace("-", " ")}.</li>
          <li>${tolerance}</li>
          <li>No dia, a casa liga para confirmar.</li>
        </ol>
        <p class="field__help">Sem WhatsApp, nenhuma mensagem sai. A reserva aparece no Hoje em "Ligar para confirmar".</p>
        <div class="dialog__actions"><button class="btn btn--sm" type="button" data-close>Pronto, li</button></div>
      </div>`,
      dialog,
    );
    openDialog(dialog, {
      onClose: () => {
        dialog.remove();
        resolve();
      },
    });
    dialog.querySelector("[data-close]")?.focus();
  });
}

function slotsView(ctx, loadTables) {
  const st = ctx.state;
  if (st.slots == null) return html`<p class="field__help" role="status">Buscando os horários…</p>`;
  if (st.closed) return html`<p class="notice">A casa não abre nesse dia (${st.closed}). Escolha outro dia.</p>`;
  if (!st.slots.length) return html`<p class="notice">Não deu para buscar os horários. Mude o dia para tentar de novo.</p>`;
  return html`<div class="res-horas" role="radiogroup" aria-labelledby="nova-hora">
    ${st.slots.map(
      (s) => html`<label class=${`res-hora${s.free === 0 ? " is-cheio" : ""}`}>
        <input type="radio" name="time" value=${s.time} ?checked=${st.time === s.time} @change=${() => loadTables(ctx, s.time)}>
        ${s.time}
        <small>${s.free == null ? "…" : s.free === 0 ? "cheio" : s.free === 1 ? "1 mesa" : `${s.free} mesas`}</small>
      </label>`,
    )}
  </div>`;
}

/** As mesas livres com a sugerida já escolhida. */
function tableChoiceChecked(st) {
  const tpl = tableChoice(st.options, null);
  queueMicrotask(() => {
    const input = document.querySelector(`.res-janela input[name="mesa"][value="${st.pick}"]`);
    if (input && !document.querySelector('.res-janela input[name="mesa"]:checked')) input.checked = true;
  });
  return tpl;
}

