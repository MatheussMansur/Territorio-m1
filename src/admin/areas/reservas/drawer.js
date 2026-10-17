// A gaveta da reserva: tudo sobre uma reserva e o que aconteceu com ela, e as
// ações que cada perfil pode fazer (aprovar, recusar, remarcar, trocar de mesa, "Chegou" e o seu
// desfazer, cancelar, não veio, reenviar, a ligação para um cliente sem WhatsApp, mensagens prontas, o
// telefone completo depois da checagem de identidade). Comum a Hoje e Reservas; ela fica fora do
// corpo da área, então é fechada quando a área sai. Uma mudança feita em outro lugar chega a ela pelas
// atualizações ao vivo da área: a gaveta lê de novo, mantém o foco e diz "Isso mudou agora
// há pouco"; uma reserva que sumiu avisa (not_found.staff).
import "../reservas.css";
import { openDialog } from "../../../components/dialog.js";
import { confirmAction } from "../../../components/confirm.js";
import { toast } from "../../../components/toast.js";
import { formatDay, houseParts, shortTime } from "../../../lib/dates.js";
import { html, nothing, render } from "../../../lib/html.js";
import { uuid } from "../../../lib/uuid.js";
import { formatPhone } from "../../../lib/phone.js";
import * as house from "../../../services/api/availability.js";
import * as clientes from "../../../services/api/staff-clientes.js";
import * as api from "../../../services/api/staff-reservas.js";
import { withIdentity } from "../../identity.js";
import { guardWrite } from "../salao/retrato.js";
import { checkIn, undoCheckIn } from "./chegada.js";
import { problemText } from "./errors.js";
import { formDialog } from "./form-dialog.js";
import {
  ACTIVE, AREA, FLAG, SOURCE_LONG, canAct, canRevealPhone, clock, confirmationBadge, correctsClosedNight, movesToAnyDay, people, seesPrivateNotes, statusBadge,
} from "./labels.js";
import { arrivingNote, notifiedNote, readyButtons } from "./prontas.js";
import { withCorrection } from "../salao/correcao.js";

const TEMPLATE = {
  booking_receipt: "Comprovante da reserva",
  reminder: "Lembrete do dia",
  approved: "Confirmação do pedido",
  declined: "Recusa do pedido",
  canceled: "Aviso de cancelamento",
  rescheduled: "Aviso de remarcação",
  table_waiting: "Sua mesa está te esperando",
  table_ready: "Sua mesa está pronta",
  running_late: "Estamos com atraso de alguns minutos",
  waitlist_offer: "Oferta de mesa da espera",
};
const MESSAGE_STATUS = {
  pending: "na fila", held: "segurada", sending: "saindo", sent: "enviada", delivered: "entregue", read: "lida", failed: "não chegou", expired: "perdeu a hora",
};
const HISTORY_KIND = {
  created: "new", approved: "confirmed", confirmed: "confirmed", customer_yes: "confirmed", check_in: "confirmed",
  cancel: "canceled", declined: "canceled", release: "canceled", no_show: "canceled", waitlisted: "waitlisted",
};
const HISTORY_WORD = {
  created: "nova reserva", approved: "aprovada", confirmed: "virou reserva", customer_yes: "cliente", check_in: "salão", left: "salão",
  cancel: "cancelada", declined: "recusada", rescheduled: "remarcada", move_tables: "mesa", no_show: "não veio", undo_no_show: "correção",
  forgive_no_show: "correção", resend_confirmation: "mensagem", notify: "mensagem", note: "nota", override: "acima do limite",
  message_failed: "mensagem", extra_tolerance: "tolerância", release: "mesa liberada", undo_check_in: "correção",
  customer_late: "cliente", customer_arriving: "cliente", release_table: "mesa", call_answer: "ligação",
};
const REASONS = ["Casa cheia", "Evento fechado", "Imprevisto da casa"];
const CANCEL_REASONS = ["Pedido do cliente", ...REASONS];
const LOCALE = { pt: "português", es: "espanhol", en: "inglês" };

let current = null;

const today = () => houseParts(new Date()).date;

/** Fecha a gaveta aberta (a área saiu). */
export function closeReservation() {
  current?.close();
}

/** A área recebeu um aviso ao vivo: a gaveta aberta lê de novo, em silêncio. */
export function refreshReservation() {
  return current?.reload({ live: true });
}

/**
 * Abre a gaveta de uma reserva.
 * @param {string} id
 * @param {{user: any, onChange?: () => void, onClose?: () => void}} options
 */
export function openReservation(id, { user, onChange, onClose } = {}) {
  current?.close();
  const dialog = document.createElement("dialog");
  dialog.className = "dialog dialog--drawer res-gaveta";
  dialog.setAttribute("aria-labelledby", "gaveta-titulo");
  document.body.append(dialog);

  const s = { r: null, error: null, suggestion: null, busy: null, changed: false, gone: false, phone: null, offset: 0 };
  let alive = true;

  const draw = () => render(view(s, user, act), dialog);

  async function load({ quiet = false, live = false } = {}) {
    if (!quiet) {
      s.error = null;
      draw();
    }
    try {
      const before = s.r;
      const fresh = await api.detail(id);
      // uma mudança feita em outro lugar com a gaveta aberta: avisar, manter o foco
      if (live && before && fresh.version !== before.version) s.changed = true;
      s.r = fresh;
      if (fresh.night_time) s.offset = Date.parse(fresh.night_time) - Date.now();
      s.error = null;
      s.gone = false;
      if (s.r.status === "pending" && canAct(user, "approve")) suggest();
    } catch (error) {
      console.error(error);
      if (error?.status === 404 && s.r) s.gone = true;
      else s.error = error;
    }
    if (alive) draw();
  }

  // a mesa que "Aprovar" usa: a segura pelo pedido, ou a menor livre
  async function suggest() {
    const r = s.r;
    if (r.table_codes?.length) return (s.suggestion = r.table_codes);
    try {
      const options = await api.availability({ date: r.date, time: r.time, partySize: r.party_size, ignore: r.id });
      s.suggestion = options[0]?.table_codes || [];
    } catch {
      s.suggestion = [];
    }
    if (alive) draw();
  }

  /** Roda uma ação com a sua própria chave, trava o botão e diz como foi. */
  async function act(name, body = {}, done = "Pronto") {
    if (s.busy) return;
    s.changed = false;
    s.busy = name;
    draw();
    try {
      await withCorrection((extra) => api.action(id, { action: name, ...body, ...extra }, uuid()));
      toast({ title: done });
      onChange?.();
      await load({ quiet: true });
    } catch (error) {
      console.error(error);
      const { title, message } = problemText(error);
      toast({ kind: "error", title, message });
      if (error?.type === "invalid_transition" || error?.status === 404) {
        onChange?.();
        await load({ quiet: true });
      }
    } finally {
      s.busy = null;
      if (alive) draw();
    }
  }

  act.load = load;
  act.offset = () => s.offset;
  act.revealPhone = async () => {
    const cid = s.r?.customer?.id;
    if (!cid) return;
    try {
      const answer = await withIdentity(() => clientes.revealPhone(cid), { message: "Ver o telefone completo pede a senha e o código de novo. Vale por 5 minutos, e fica no registro de ações." });
      if (!answer) return;
      s.phone = answer.phone_e164;
      draw();
      dialog.querySelector(".res-telefone")?.focus();
    } catch (error) {
      toast({ kind: "error", ...problemText(error) });
    }
  };
  act.hidePhone = () => {
    s.phone = null;
    draw();
  };
  const afterArrival = async () => {
    onChange?.();
    await load({ quiet: true });
  };
  act.checkIn = () => checkIn(s.r, { onDone: afterArrival });
  act.undoCheckIn = () => undoCheckIn(s.r, { onDone: afterArrival });
  act.call = (answer) => act("call_answer", { answer }, { yes: "Confirmou por ligação", late: "Vai atrasar: a mesa espera mais um pouco", no: "Não vai mais: reserva cancelada" }[answer]);
  act.dialogs = dialogsFor(() => s.r, user, act, () => {
    onChange?.();
    return load({ quiet: true });
  });
  act.afterNotify = () => load({ quiet: true }).then(() => onChange?.());

  draw();
  const handle = openDialog(dialog, {
    onClose: () => {
      alive = false;
      dialog.remove();
      if (current === api_) current = null;
      onClose?.();
    },
  });
  const api_ = { close: handle.close, reload: ({ live = false } = {}) => load({ quiet: true, live }) };
  current = api_;
  dialog.querySelector(".dialog__close")?.focus();
  load();
  return api_;
}

// ---- o conteúdo da gaveta ---------------------------------------------------------------------------

function view(s, user, act) {
  const r = s.r;
  const bar = html`<div class="dialog__bar">
    <b class="dialog__title" id="gaveta-titulo">${r ? r.code : "Reserva"}</b>
    <button class="dialog__close" type="button" data-close aria-label="Fechar">×</button>
  </div>`;
  if (s.error && !r) {
    const { title, message } = problemText(s.error);
    return html`${bar}<div class="dialog__body">
      <div class="empty error-state" role="alert"><b>${title}</b><p>${message}</p>
        <button class="btn btn--sm" type="button" @click=${() => act.load()}>Tentar de novo</button>
      </div>
    </div>`;
  }
  if (!r) {
    return html`${bar}<div class="dialog__body res-gaveta__corpo" aria-busy="true">
      <span class="skeleton skeleton--title"></span><span class="skeleton skeleton--text"></span><span class="skeleton skeleton--block"></span>
      <span class="sr-only" role="status">Carregando a reserva…</span>
    </div>`;
  }
  if (s.gone) {
    return html`${bar}<div class="dialog__body">
      <div class="empty" role="alert"><b>Essa reserva não está mais aqui</b>
        <p>Pode ter sido apagada agora há pouco por outra pessoa. A lista já foi atualizada.</p>
        <button class="btn btn--sm btn--outline" type="button" data-close>Fechar</button>
      </div>
    </div>`;
  }
  const privateNotes = seesPrivateNotes(user);
  const area = r.area_key ? AREA[r.area_key] : r.area_preference ? `prefere ${AREA[r.area_preference]}` : "";
  const dietaryHidden = !privateNotes && r.flags.includes("dietary");
  const flags = r.flags.filter((f) => f !== "no_whatsapp");
  return html`${bar}
    <div class="dialog__body res-gaveta__corpo">
      ${s.changed ? html`<p class="notice" role="status"><b>Isso mudou agora há pouco.</b> A reserva já mostra o que vale agora.</p>` : nothing}
      <div class="cluster res-gaveta__selos">${statusBadge(r.status)} ${confirmationBadge(r.customer_confirmation)} ${arrivingNote(r)} ${notifiedNote(r)}
        ${r.no_whatsapp ? html`<span class="badge badge--no-reply">sem WhatsApp · confirmar por ligação</span>` : nothing}</div>
      <h2 class="res-gaveta__nome">${r.customer.name}</h2>
      <p class="res-gaveta__quando">
        <b>${formatDay(r.date, "long")}, ${shortTime(r.time)}</b>
        <span>${people(r.party_size)}${r.arrived_people && r.arrived_people !== r.party_size ? ` (entraram ${r.arrived_people})` : ""}</span>
        <span>${r.table_codes.length ? `mesa ${r.table_codes.join(" + ")}` : "sem mesa"}${area ? ` · ${area}` : ""}</span>
      </p>
      ${pendingNote(r, s)}
      ${r.status === "canceled" && r.cancel_reason ? html`<p class="notice">Motivo do cancelamento: ${r.cancel_reason}</p>` : nothing}
      ${r.status === "declined" && r.decline_reason ? html`<p class="notice">Motivo da recusa: ${r.decline_reason}</p>` : nothing}
      ${actions(r, s, user, act)}
      <dl class="res-dados">
        <div><dt>${r.no_whatsapp ? "Telefone" : "WhatsApp"}</dt><dd>${phoneLine(r, s, user, act)}</dd></div>
        <div><dt>Histórico</dt><dd>${visits(r)}</dd></div>
        <div><dt>Veio</dt><dd>${SOURCE_LONG[r.source] || r.source}</dd></div>
        <div><dt>Língua</dt><dd>${LOCALE[r.locale] || "português"}</dd></div>
        ${flags.length ? html`<div class="is-wide"><dt>Marcadores</dt><dd>${flags.map((f) => html`<span class="res-marcador">${FLAG[f] || f}</span>`)}</dd></div>` : nothing}
        ${r.notes ? html`<div class="is-wide"><dt>Observação do cliente</dt><dd>${r.notes}</dd></div>` : nothing}
        ${dietaryHidden ? html`<div class="is-wide"><dt>Observação do cliente</dt><dd>Tem restrição alimentar. O detalhe fica com a gerência.</dd></div>` : nothing}
        ${privateNotes && r.internal_notes ? html`<div class="is-wide"><dt>Nota interna</dt><dd>${r.internal_notes}</dd></div>` : nothing}
        <div class="is-wide"><dt>Combinados</dt><dd>${r.terms_version ? `aceitos na versão de ${formatDay(r.terms_version, "dm")}` : "lançada pela equipe, sem aceite no site"}</dd></div>
      </dl>
      ${callBlock(r, s, user, act)}
      ${readyMessages(r, s, act)}
      <section class="res-linha" aria-labelledby="linha-titulo">
        <h3 class="rotulo" id="linha-titulo">Linha do tempo</h3>
        ${timeline(r, act)}
      </section>
    </div>`;
}

/** O telefone mascarado, e "Ver telefone" para o dono e o gerente depois da checagem de identidade (5.16). */
function phoneLine(r, s, user, act) {
  if (!r.customer.phone_masked) return "sem telefone";
  if (s.phone) {
    return html`<a class="res-telefone mono" href=${`tel:${s.phone}`}>${formatPhone(s.phone)}</a>
      <button class="link-button" type="button" @click=${() => act.hidePhone()}>Esconder</button>`;
  }
  return html`<span class="mono">${r.customer.phone_masked}</span>${!r.phone_verified && !r.no_whatsapp ? html` <small>(ainda não confirmado)</small>` : nothing}
    ${canRevealPhone(user) && r.customer.id ? html`<button class="action res-ver-telefone" type="button" @click=${() => act.revealPhone()}>Ver telefone</button>` : nothing}`;
}

/** "Ligar para confirmar" dentro da gaveta, para uma reserva confirmada sem WhatsApp (5.19). */
function callBlock(r, s, user, act) {
  if (!r.no_whatsapp || r.status !== "confirmed" || r.call_answer) return nothing;
  if (!canAct(user, "call_answer")) {
    return html`<p class="notice">Sem WhatsApp: a casa liga para confirmar. O número fica com o dono e a gerência; peça ao dono ou à gerente.</p>`;
  }
  const busy = Boolean(s.busy);
  return html`<section class="res-ligacao" aria-labelledby="ligacao-titulo">
    <h3 class="rotulo" id="ligacao-titulo">Ligar para confirmar</h3>
    <p class="field__help">Depois da ligação, marque o que o cliente disse. Fica na linha do tempo como "por ligação".</p>
    <div class="cluster">
      <button class="action action--solid" type="button" ?disabled=${busy} @click=${() => act.call("yes")}>Confirmou</button>
      <button class="action" type="button" ?disabled=${busy || r.customer_late} @click=${() => act.call("late")}>Vai atrasar</button>
      <button class="action action--alert" type="button" ?disabled=${busy} @click=${() => act.call("no")}>Não vai mais</button>
    </div>
  </section>`;
}

function visits(r) {
  const v = r.customer.visits || 0;
  const parts = [v ? `${v} ${v === 1 ? "visita" : "visitas"} antes` : "primeira vez"];
  if (r.customer.no_shows) parts.push(`${r.customer.no_shows} ${r.customer.no_shows === 1 ? "falta" : "faltas"}`);
  return parts.join(" · ");
}

function pendingNote(r, s) {
  if (r.status !== "pending") return nothing;
  const until = r.pending_until ? `Vence às ${clock(r.pending_until)}${r.pending_until.slice(0, 10) !== r.date ? ` de ${formatDay(houseParts(r.pending_until).date, "dm")}` : ""}.` : "";
  const held = r.table_codes.length ? ` A mesa ${r.table_codes.join(" + ")} fica presa até lá.` : s.suggestion?.length ? ` Mesa sugerida: ${s.suggestion.join(" + ")}.` : "";
  return html`<p class="notice notice--alert">Pedido esperando a casa. ${until}${held}</p>`;
}

/** Se "Não veio" faz sentido agora: passou da tolerância, pelo relógio da casa na noite. */
function pastTolerance(r, offset = 0) {
  const limit = r.tolerance_until ? new Date(r.tolerance_until).getTime() : new Date(r.starts_at).getTime() + ((r.tolerance_min ?? 15) + (r.extra_tolerance_min ?? 0)) * 60_000;
  return Date.now() + offset >= limit;
}

function actions(r, s, user, act) {
  // o arquivo de permissões diz quem trabalha em outros dias e numa noite fechada (história 1.3)
  const anyDay = movesToAnyDay(user);
  const fixesClosed = correctsClosedNight(user);
  const busy = Boolean(s.busy);
  const btn = (key, label, onClick, cls = "btn--outline") =>
    html`<button class=${`btn btn--sm ${cls}`} type="button" ?disabled=${busy} aria-busy=${String(s.busy === key)} @click=${onClick}>${s.busy === key ? "Gravando…" : label}</button>`;
  const list = [];
  const pastNight = r.date < today() || (!fixesClosed && r.night_closed);
  // a recepção só trabalha na noite aberta de hoje
  const frozen = (!anyDay && r.date < today()) || (!fixesClosed && r.night_closed);
  const now = Date.now() + (act.offset?.() || 0);
  // cada ação só para os perfis que o arquivo de permissões dá a ela (5.5)
  const may = (action) => canAct(user, action);
  if (r.status === "confirmed" && r.date === today() && !r.night_closed && may("check_in")) {
    list.push(btn("check_in", "Chegou", guardWrite(() => act.checkIn()), ""));
  }
  if (r.undo_check_in_until && now <= new Date(r.undo_check_in_until).getTime() && may("undo_check_in")) {
    list.push(btn("undo_check_in", "Desfazer a chegada", guardWrite(() => act.undoCheckIn())));
  }

  if (r.status === "pending") {
    const codes = s.suggestion;
    const label = codes == null ? "Aprovar" : codes.length ? `Aprovar com a mesa ${codes.join(" + ")}` : "Aprovar sem mesa";
    if (may("approve")) list.push(btn("approve", label, () => act("approve", codes?.length ? { table_codes: codes } : {}, "Reserva aprovada. O cliente recebe a confirmação."), "res-aprovar"));
    if (may("decline")) list.push(btn("decline", "Recusar", () => act.dialogs.decline()));
  }
  if (ACTIVE.has(r.status) && !frozen) {
    if (may("reschedule")) list.push(btn("reschedule", "Remarcar", () => act.dialogs.reschedule()));
    if (r.status !== "waitlisted" && may("move_tables")) list.push(btn("move_tables", "Trocar mesa", () => act.dialogs.moveTables()));
  }
  if ((r.status === "confirmed" || r.status === "pending") && !pastNight && may("resend_confirmation")) {
    list.push(btn("resend_confirmation", "Reenviar a confirmação", () => act("resend_confirmation", {}, "Confirmação reenviada pelo WhatsApp")));
  }
  if (r.status === "confirmed" && pastTolerance(r, act.offset?.() || 0) && !frozen && may("no_show")) {
    list.push(btn("no_show", "Não veio", () => act.dialogs.noShow()));
  }
  if (r.status === "no_show" && may("undo_no_show")) {
    if (!r.undo_no_show_until || now <= new Date(r.undo_no_show_until).getTime()) list.push(btn("undo_no_show", "Desfazer \"Não veio\"", () => act.dialogs.undoNoShow()));
    else list.push(html`<p class="field__help res-prazo">Passou o prazo de desfazer o "Não veio". Para tirar a falta da conta, perdoe a falta na ficha do cliente.</p>`);
  }
  if (ACTIVE.has(r.status) && !frozen && may("cancel")) list.push(btn("cancel", "Cancelar reserva", () => act.dialogs.cancel(), "btn--danger"));
  if (!fixesClosed && r.night_closed && r.date === today()) list.push(html`<p class="field__help res-prazo">A noite já fechou. Só o dono ou o gerente corrigem, com motivo.</p>`);
  if (!list.length) return nothing;
  return html`<div class="res-acoes" role="group" aria-label="Ações da reserva">${list}</div>`;
}

function readyMessages(r, s, act) {
  if (r.date !== today() || !["confirmed", "completed"].includes(r.status)) return nothing;
  return html`<section class="res-prontas" aria-labelledby="prontas-titulo">
    <h3 class="rotulo" id="prontas-titulo">Mensagens prontas</h3>
    ${readyButtons(r, { whatsapp: r.whatsapp, busy: Boolean(s.busy), onSent: act.afterNotify })}
  </section>`;
}

function timeline(r, act) {
  const entries = [
    ...r.history.map((h) => ({ at: h.at, kind: HISTORY_KIND[h.action] || "", word: HISTORY_WORD[h.action] || "mudança", title: h.summary, who: h.actor_label })),
    ...r.messages.map((m) => ({
      at: m.sent_at,
      kind: m.status === "failed" ? "new" : "",
      word: "whatsapp",
      title: `${TEMPLATE[m.template] || m.template}: ${MESSAGE_STATUS[m.status] || m.status}`,
      who: "Mensagem",
      message: m,
    })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  if (!entries.length) return html`<p class="res-vazio-linha">Nada registrado ainda.</p>`;
  return html`<ul class="feed">
    ${entries.map(
      (e) => html`<li class=${`feed-item ${e.kind ? `feed-item--${e.kind}` : ""}`}>
        <span class="feed-item__kind">${e.word}</span>
        <span class="feed-item__when">${formatDay(houseParts(e.at).date, "dm")} ${clock(e.at)}</span>
        <strong>${e.title}</strong>
        <small>${e.who}</small>
        ${e.message ? messageNote(e.message, r, act) : nothing}
      </li>`,
    )}
  </ul>`;
}

function messageNote(m, r, act) {
  if (m.status === "failed" && ["confirmed", "pending"].includes(r.status)) {
    return html`<small class="res-msg-nota">O WhatsApp não entregou. Toque em reenviar; se falhar de novo, o dono ou o gerente liga para o cliente.
      <button class="action action--alert" type="button" @click=${() => act("resend_confirmation", {}, "Confirmação reenviada pelo WhatsApp")}>Reenviar</button></small>`;
  }
  if (m.status === "held") return html`<small class="res-msg-nota">Segurada: o limite de mensagens do dia chegou. O aviso está na central do painel.</small>`;
  if (m.status === "expired") return html`<small class="res-msg-nota">Ficou parada na fila e não vale mais mandar.</small>`;
  return nothing;
}

// ---- as janelas pequenas de cada ação ------------------------------------------------------------------

function reasonFields(name, reasons, locale) {
  return html`<fieldset class="res-motivos">
      <legend class="field__label">Motivo</legend>
      ${reasons.map(
        (reason, i) => html`<label class="res-opcao"><input type="radio" name=${name} value=${reason} ?checked=${i === 0}> ${reason}</label>`,
      )}
    </fieldset>
    <div class="field">
      <label class="field__label" for="motivo-extra">Explique melhor <small>opcional</small></label>
      <textarea class="field__input" id="motivo-extra" name="extra" maxlength="280" rows="2"></textarea>
      ${locale && locale !== "pt"
        ? html`<p class="field__help">Este cliente recebe em ${LOCALE[locale]}; o motivo vai traduzido, e o texto livre vai como você escrever.</p>`
        : nothing}
    </div>`;
}

const reasonOf = (data, name) => [data.get(name), String(data.get("extra") || "").trim()].filter(Boolean).join(": ");

function notifyField(r, label = "Avisar o cliente pelo WhatsApp") {
  if (!r.phone_verified) return html`<p class="field__help">Sem WhatsApp confirmado: o cliente não recebe aviso. Se precisar, ligue para ele.</p>`;
  return html`<label class="res-opcao"><input type="checkbox" name="notify" checked> ${label}</label>`;
}

function dialogsFor(get, user, act, refresh) {
  const send = async (body) => {
    await withCorrection((extra) => api.action(get().id, { ...body, ...extra }, uuid()));
    await refresh();
  };
  return {
    async decline() {
      const r = get();
      const ok = await formDialog({
        title: `Recusar o pedido de ${r.customer.name}?`,
        submitLabel: "Recusar pedido",
        cancelLabel: "Voltar",
        danger: true,
        view: () => html`<p>O cliente recebe o motivo e um link para escolher outro horário.</p>${reasonFields("reason", REASONS, r.locale)}`,
        onSubmit: (data) => send({ action: "decline", reason: reasonOf(data, "reason") }),
      });
      if (ok) toast({ title: "Pedido recusado", message: "O cliente recebe o motivo pelo WhatsApp." });
    },

    async cancel() {
      const r = get();
      const ok = await formDialog({
        title: `Cancelar a reserva de ${r.customer.name}?`,
        submitLabel: "Cancelar reserva",
        cancelLabel: "Manter reserva",
        danger: true,
        view: () => html`<p>A mesa volta a ficar livre e a lista de espera do horário é avisada.</p>
          ${reasonFields("reason", CANCEL_REASONS, r.locale)} ${notifyField(r)}`,
        onSubmit: (data) => send({ action: "cancel", reason: reasonOf(data, "reason"), notify_customer: data.get("notify") === "on" }),
      });
      if (ok) toast({ title: "Reserva cancelada", message: "A vaga ficou para a espera do horário." });
    },

    async noShow() {
      const r = get();
      const ok = await confirmAction({
        title: `${r.customer.name} não veio?`,
        message: `Passou a tolerância das ${shortTime(r.time)}. A falta conta no histórico do cliente; o dono ou o gerente podem desfazer em até ${r.undo_no_show_hours ?? 24} h.`,
        confirmLabel: "Marcar que não veio",
        cancelLabel: "Voltar",
        danger: true,
      });
      if (ok) act("no_show", {}, "Marcada como não veio");
    },

    async undoNoShow() {
      const r = get();
      const ok = await formDialog({
        title: `Desfazer o "Não veio" de ${r.customer.name}?`,
        submitLabel: "Desfazer",
        view: () => html`<p>A reserva volta a confirmada e a falta sai do histórico do cliente.</p>
          <div class="field">
            <label class="field__label" for="motivo-desfazer">Motivo</label>
            <textarea class="field__input" id="motivo-desfazer" name="reason" maxlength="280" rows="2" required></textarea>
          </div>`,
        onSubmit: (data, ctx) => {
          const reason = String(data.get("reason") || "").trim();
          if (!reason) {
            ctx.error = { title: "Falta o motivo", message: "Escreva por que a falta sai." };
            return false;
          }
          return send({ action: "undo_no_show", reason });
        },
      });
      if (ok) toast({ title: "\"Não veio\" desfeito" });
    },

    async moveTables() {
      const r = get();
      const ok = await formDialog({
        title: "Trocar a mesa",
        submitLabel: "Trocar mesa",
        wide: true,
        init: async (ctx) => {
          try {
            ctx.update({ options: await api.availability({ date: r.date, time: r.time, partySize: r.party_size, ignore: r.id }) });
          } catch (error) {
            ctx.update({ options: [], failed: problemText(error) });
          }
        },
        view: (ctx) => html`<p>${r.customer.name} · ${people(r.party_size)} · ${shortTime(r.time)} · agora ${r.table_codes.length ? `na mesa ${r.table_codes.join(" + ")}` : "sem mesa"}.</p>
          ${tableChoice(ctx.state.options, ctx.state.failed)}`,
        onSubmit: (data, ctx) => {
          const pick = data.get("mesa");
          if (!pick) {
            ctx.error = { title: "Escolha uma mesa", message: "Só aparecem as mesas livres que servem ao grupo nesse horário." };
            return false;
          }
          return send({ action: "move_tables", table_codes: String(pick).split("+") });
        },
      });
      if (ok) toast({ title: "Mesa trocada" });
    },

    async reschedule() {
      const r = get();
      const sameDay = !movesToAnyDay(user);
      const loadDay = async (ctx, date) => {
        ctx.update({ date, slots: null, time: null, options: null });
        try {
          const day = await house.getSlots({ date, partySize: Math.min(r.party_size, 8) });
          ctx.update({ slots: day.open ? day.slots.map((x) => x.time) : [], closed: day.open ? null : day.reason_label || "fechado" });
        } catch {
          ctx.update({ slots: [], closed: null });
        }
      };
      const loadTime = async (ctx, time) => {
        ctx.update({ time, options: null });
        try {
          ctx.update({ options: await api.availability({ date: ctx.state.date, time, partySize: r.party_size, ignore: r.id }) });
        } catch {
          ctx.update({ options: [] });
        }
      };
      const ok = await formDialog({
        title: "Remarcar a reserva",
        submitLabel: "Remarcar",
        wide: true,
        init: (ctx) => loadDay(ctx, r.date),
        view: (ctx) => {
          const st = ctx.state;
          return html`<p>${r.customer.name} · ${people(r.party_size)} · hoje marcada para ${formatDay(r.date)} às ${shortTime(r.time)}.</p>
            ${sameDay
              ? html`<p class="field__help">A recepção remarca só no mesmo dia.</p>`
              : html`<div class="field">
                  <label class="field__label" for="remarcar-dia">Dia</label>
                  <input class="field__input" type="date" id="remarcar-dia" name="date" min=${today()} .value=${st.date || r.date}
                    @change=${(e) => e.target.value && loadDay(ctx, e.target.value)}>
                </div>`}
            <div class="field">
              <span class="field__label" id="remarcar-hora">Horário</span>
              ${st.slots == null
                ? html`<p class="field__help" role="status">Buscando os horários…</p>`
                : st.closed
                  ? html`<p class="notice">A casa não abre nesse dia (${st.closed}).</p>`
                  : html`<div class="res-horas" role="radiogroup" aria-labelledby="remarcar-hora">
                      ${st.slots.map(
                        (time) => html`<label class="res-hora"><input type="radio" name="time" value=${time} ?checked=${st.time === time} @change=${() => loadTime(ctx, time)}> ${time}</label>`,
                      )}
                    </div>`}
            </div>
            ${st.time
              ? st.options == null
                ? html`<p class="field__help" role="status">Conferindo as mesas…</p>`
                : st.options.length
                  ? html`<p class="notice">Tem mesa: ${st.options[0].table_codes.join(" + ")} (${AREA[st.options[0].area_key] || ""}).</p>`
                  : html`<p class="notice notice--alert">Esse horário está cheio para ${people(r.party_size)}. Escolha outro.</p>`
              : nothing}
            ${notifyField(r)}`;
        },
        onSubmit: (data, ctx) => {
          const time = data.get("time");
          if (!time) {
            ctx.error = { title: "Escolha o horário", message: "Toque num dos horários do dia." };
            return false;
          }
          return send({ action: "reschedule", date: sameDay ? r.date : ctx.state.date, time, notify_customer: data.get("notify") === "on" });
        },
      });
      if (ok) toast({ title: "Reserva remarcada" });
    },
  };
}

/** As mesas livres como lista para escolher uma (StaffTableOption[]). */
export function tableChoice(options, failed, name = "mesa") {
  if (failed) return html`<p class="notice notice--alert">${failed.title}. ${failed.message}</p>`;
  if (options == null) return html`<p class="field__help" role="status">Buscando as mesas livres…</p>`;
  if (!options.length) return html`<p class="notice notice--alert">Nenhuma mesa livre serve ao grupo nesse horário.</p>`;
  return html`<fieldset class="res-mesas">
    <legend class="field__label">Mesas livres que servem ao grupo</legend>
    ${options.map((o) => {
      const value = o.table_codes.join("+");
      return html`<label class="res-mesa">
        <input type="radio" name=${name} value=${value}>
        <b>${o.table_codes.join(" + ")}</b>
        <small>${AREA[o.area_key] || ""} · até ${o.seats}${o.held ? " · guardada para quem chega" : ""}</small>
      </label>`;
    })}
  </fieldset>`;
}
