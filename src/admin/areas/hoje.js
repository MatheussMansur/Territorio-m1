// Hoje: a noite num relance. Os números, quem está chegando agora (com "Chegou", "Desfazer" enquanto
// vale e as mensagens prontas), as colunas de horário com quanto cada uma enche, o que precisa
// de atenção (os alertas: os mesmos avisos da central de avisos, FR-87), as ligações para clientes
// sem WhatsApp, os pedidos pendentes, os passos do primeiro uso, o movimento do dia, o
// evento da noite com a sua porta e a semana à frente. Ela se atualiza pelo fluxo ao vivo (5.3),
// diz "Atualização ao vivo pausada" quando o fluxo cai, e com a conexão fora ela
// mostra o retrato da noite guardado no aparelho, só para leitura (6.11, 6.12). Todo mundo abre
// ela; a recepção vê primeiros nomes e nenhum detalhe de dieta, e o dono também vê o que
// falta da configuração inicial.
import "./hoje.css";
import { toast } from "../../components/toast.js";
import { formatDay, houseParts, houseTime, shortTime, toMinutes } from "../../lib/dates.js";
import { formatPhone } from "../../lib/phone.js";
import { html, nothing, render } from "../../lib/html.js";
import { uuid } from "../../lib/uuid.js";
import * as clientes from "../../services/api/staff-clientes.js";
import * as avisosApi from "../../services/api/staff-avisos.js";
import * as dashboardApi from "../../services/api/staff-hoje.js";
import { levelOf } from "../avisos/catalogo.js";
import { refreshNotices } from "../avisos/central.js";
import * as api from "../../services/api/staff-reservas.js";
import * as salao from "../../services/api/staff-salao.js";
import { withIdentity } from "../identity.js";
import { canCheckIn, checkIn, undoButton } from "./reservas/chegada.js";
import { closeReservation, openReservation, refreshReservation } from "./reservas/drawer.js";
import { problemText } from "./reservas/errors.js";
import { formDialog } from "./reservas/form-dialog.js";
import { canDo } from "../nav.js";
import { AREA, canAct, canRevealPhone, confirmationBadge, flagList, people, statusBadge } from "./reservas/labels.js";
import { openNewReservation } from "./reservas/new-reservation.js";
import { arrivingNote, notifiedNote, readyButtons } from "./reservas/prontas.js";
import {
  backlogBand, canInstall, connection, guardWrite, installPanel, keepPicture, noPicture, offlineBand, onConnection, onInstallable, readPicture, report, setHealthCheck, setUpPanelApp,
} from "./salao/retrato.js";
import { changeSummary, countChanges, realtimeLostNotice, startLive } from "./salao/vivo.js";
import { withCorrection } from "./salao/correcao.js";

const ARRIVING = new Set(["pending", "confirmed", "offered"]);
const MIN = 60_000;
const PICTURE_MS = 5 * MIN;

const ALERT_WORD = {
  message_failed: "mensagem", no_reply: "sem resposta", large_group: "grupo grande", birthday: "aniversário",
  dietary: "restrição", without_table: "sem mesa", onboarding: "primeiro uso", privacy_request_due: "pedido de dados",
  print_sheet: "folha da noite", no_show_review: "não veio", night_not_closed: "noite sem fechar", outage_review: "queda",
  night_closing: "fechamento", pin_locked: "PIN travado", device_key_lost: "aparelho", reminder_failed: "lembrete",
  paper_correction: "do papel", pending_request: "pedido", late_request: "em cima da hora", message_held: "mensagem segurada",
};
const FEED_WORD = {
  new: "nova reserva", confirmed: "confirmada", customer_yes: "confirmou", customer_no: "não vem", customer_late: "vai atrasar",
  customer_arriving: "estou chegando", canceled: "cancelou", waitlisted: "lista de espera", offered: "mesa oferecida", declined: "recusada",
};
const FEED_CLASS = { new: "new", confirmed: "confirmed", customer_yes: "confirmed", customer_arriving: "confirmed", canceled: "canceled", declined: "canceled", waitlisted: "waitlisted", offered: "waitlisted" };
// o nível vem do catálogo de avisos: crítico e importante se destacam, info não
const urgent = (a) => levelOf(a.kind) !== "info";

export async function mount(container, { user, navigate }) {
  // o que este perfil vê e faz aqui vem do arquivo de permissões (história 1.3)
  const runsOnboarding = canDo(user?.role, "GET /staff/onboarding", user?.areas ?? undefined);
  const approves = canAct(user, "approve");
  const revealsPhone = canRevealPhone(user);
  const answersCalls = canAct(user, "call_answer");
  const closesNight = canDo(user?.role, "POST /staff/night/close", user?.areas ?? undefined);
  const s = {
    date: houseParts(new Date()).date, today: null, data: null, list: null, error: null, approving: null, etag: null,
    lost: false, announce: "", mode: connection(), picture: null, pictureRead: false, installable: canInstall(), offset: 0, phones: {},
  };
  let alive = true;
  let controller = null;
  let lastPicture = 0;
  setUpPanelApp();

  /** O relógio da casa para a noite (a demonstração simula ele fora do horário de serviço). */
  const nightNow = () => new Date(Date.now() + s.offset);

  async function load({ quiet = false } = {}) {
    if (connection() === "offline") return showPicture();
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    if (!quiet) {
      Object.assign(s, { data: null, list: null, error: null, etag: null });
      draw();
    }
    try {
      const answer = await dashboardApi.readFresh("/staff/dashboard", { query: { date: s.date }, etag: quiet ? s.etag : null, signal });
      let data = answer.changed ? answer.data : s.data;
      // o ETag fica só junto dos dados a que pertence (uma leitura cortada no meio não guarda nenhum)
      let etag = answer.etag;
      // o relógio da casa vale mais que o do aparelho: "hoje" é o do servidor
      const serverToday = houseParts(data.server_time).date;
      if (!s.today && serverToday !== s.date) {
        s.date = serverToday;
        data = await dashboardApi.dashboard(s.date, { signal });
        etag = null;
      }
      s.today ??= serverToday;
      // a lista é lida toda vez: uma chegada muda ela sem mudar os números
      {
        const page = data.open ? await api.list({ from: s.date, to: s.date, status: [...ARRIVING, "completed"], limit: 100 }, { signal }) : { items: [] };
        if (quiet && s.list) {
          const n = countChanges(s.list, page.items, (r) => `${r.status}|${r.table_codes.join("+")}|${r.customer_confirmation}|${r.version}`);
          s.announce = changeSummary(n, "reserva", "reservas");
        }
        Object.assign(s, { data, list: page.items, etag });
      }
      if (data.night_time) s.offset = Date.parse(data.night_time) - Date.now();
      s.error = null;
      report(true);
      // offline.server só sai depois de duas leituras boas seguidas
      if (connection() !== "online") return showPicture();
      s.mode = "online";
      if (s.date === s.today) keepNight();
    } catch (error) {
      if (error?.name === "AbortError") return;
      console.error(error);
      report(false, error);
      if (connection() !== "online") return showPicture();
      if (!quiet || !s.data) s.error = error;
    }
    if (alive) draw();
  }

  // o retrato da noite no aparelho: a cada mudança, no máximo uma vez por minuto, e a cada 5 min
  async function keepNight(force = false) {
    if (!force && Date.now() - lastPicture < PICTURE_MS) return;
    lastPicture = Date.now();
    try {
      await keepPicture(await salao.floor(), { force });
    } catch {
      /* o retrato espera a próxima leitura */
    }
  }

  async function showPicture() {
    s.mode = connection();
    s.picture = await readPicture();
    s.pictureRead = true;
    if (alive) draw();
  }

  const goTo = (date) => {
    s.date = date;
    s.etag = null;
    load();
  };

  const refresh = () => load({ quiet: true });
  const open = (id) => openReservation(id, { user, onChange: refresh });

  const create = guardWrite(async () => {
    const r = await openNewReservation({ user, date: s.date });
    if (r && alive) refresh();
  });

  const approve = guardWrite(async (r) => {
    if (s.approving) return;
    s.approving = r.id;
    draw();
    try {
      await withCorrection((extra) => api.action(r.id, { action: "approve", table_codes: r.table_codes, ...extra }, uuid()));
      toast({ title: `${r.customer.name}: reserva aprovada`, message: "O cliente recebe a confirmação pelo WhatsApp." });
    } catch (error) {
      toast({ kind: "error", ...problemText(error) });
    }
    s.approving = null;
    if (alive) refresh();
  });

  const resend = guardWrite(async (alert) => {
    try {
      await withCorrection((extra) => api.action(alert.reservation_id, { action: "resend_confirmation", ...extra }, uuid()));
      toast({ title: "Mensagem reenviada", message: "Se falhar de novo, o dono ou o gerente liga para o cliente." });
      refresh();
    } catch (error) {
      toast({ kind: "error", ...problemText(error) });
    }
  });

  // um aviso info é dispensado só para esta pessoa; o que não some sozinho é marcado
  // como resolvido para todos (a central de avisos lê a mesma lista)
  const dismiss = guardWrite(async (alert) => {
    try {
      if (alert.can_dismiss) await avisosApi.dismiss(alert.id);
      else await avisosApi.resolve(alert.id);
      toast({ title: alert.can_dismiss ? "Dispensado só para você" : "Marcado como resolvido" });
      refreshNotices();
      refresh();
    } catch (error) {
      toast({ kind: "error", ...problemText(error) });
    }
  });

  const postpone = guardWrite(async () => {
    try {
      const answer = await salao.postponeClose();
      toast({ title: "Fechamento adiado", message: `A noite fecha às ${houseTime(answer.close_at)}. Fica no registro de ações.` });
      refresh();
    } catch (error) {
      toast({ kind: "error", ...problemText(error) });
    }
  });

  const closeLast = guardWrite(async (alert) => {
    try {
      await salao.closeNight(alert.date);
      toast({ title: "Noite fechada", message: "Toda reserva daquela noite tem estado final agora." });
      refresh();
    } catch (error) {
      toast({ kind: "error", ...problemText(error) });
    }
  });

  const correction = guardWrite(async (alert, verb) => {
    try {
      await (verb === "apply" ? salao.applyCorrection(alert.correction_id) : salao.dismissCorrection(alert.correction_id));
      toast({ title: verb === "apply" ? "Correção aplicada" : "Correção dispensada", message: verb === "apply" ? "O \"Não veio\" daquela reserva saiu, sem contar falta." : "" });
      refresh();
    } catch (error) {
      toast({ kind: "error", ...problemText(error) });
    }
  });

  /** "Desfazer" um "Não veio" da noite passada, com o motivo (5.10 e 6.14). */
  const undoNoShow = guardWrite(async (r) => {
    const ok = await formDialog({
      title: `Desfazer o "Não veio" de ${r.customer.name}?`,
      submitLabel: "Desfazer",
      view: () => html`<p>A falta sai do histórico do cliente.</p>
        <div class="field">
          <label class="field__label" for="hoje-motivo">Motivo</label>
          <textarea class="field__input" id="hoje-motivo" name="reason" maxlength="280" rows="2" required></textarea>
        </div>`,
      onSubmit: (data, ctx) => {
        const reason = String(data.get("reason") || "").trim();
        if (!reason) {
          ctx.error = { title: "Falta o motivo", message: "Escreva por que a falta sai." };
          return false;
        }
        return withCorrection((extra) => api.action(r.id, { action: "undo_no_show", reason, ...extra }, uuid()));
      },
    });
    if (ok) {
      toast({ title: "\"Não veio\" desfeito" });
      refresh();
    }
  });

  // ---- a ligação para clientes sem WhatsApp (5.19) ----
  async function revealPhone(r) {
    if (!r.customer?.id) return;
    try {
      const answer = await withIdentity(() => clientes.revealPhone(r.customer.id), { message: "Ver o telefone completo pede a senha e o código de novo. Vale por 5 minutos, e fica no registro de ações." });
      if (!answer) return;
      s.phones[r.id] = answer.phone_e164;
      draw();
    } catch (error) {
      toast({ kind: "error", ...problemText(error) });
    }
  }

  const answerCall = guardWrite(async (r, answer) => {
    try {
      await withCorrection((extra) => api.action(r.id, { action: "call_answer", answer, ...extra }, uuid()));
      const said = { yes: "confirmou por ligação", late: "vai atrasar: a tolerância foi estendida uma vez", no: "não vai mais: a reserva foi cancelada" }[answer];
      toast({ title: `${r.customer.name} ${said}` });
      refresh();
    } catch (error) {
      toast({ kind: "error", ...problemText(error) });
    }
  });

  function draw() {
    if (alive) render(screen(), container);
  }

  function liveNotices() {
    return html`${s.lost && s.mode === "online" ? html`<p class="notice hoje-aviso" role="status" data-estado="realtime_lost">${realtimeLostNotice}</p>` : nothing}
      ${backlogBand(draw)}
      <p class="sr-only" aria-live="polite">${s.announce}</p>`;
  }

  function screen() {
    if (s.mode !== "online") return offlineScreen();
    if (s.error) {
      const { title, message } = problemText(s.error);
      return html`<div class="hoje-estado empty error-state" role="alert">
        <span class="raiz raiz--atencao" aria-hidden="true"></span>
        <b>Não deu para carregar a noite</b>
        <p>${title}. ${message}</p>
        <button class="btn btn--sm" type="button" @click=${() => load()}>Tentar de novo</button>
      </div>`;
    }
    const d = s.data;
    if (!d) {
      return html`<div class="hoje" aria-busy="true">
        <span class="sr-only" role="status">Carregando a noite…</span>
        <div class="stats">${[1, 2, 3, 4].map(() => html`<div class="stat"><span class="skeleton skeleton--title"></span></div>`)}</div>
        <span class="skeleton skeleton--block"></span><span class="skeleton skeleton--block"></span>
      </div>`;
    }
    const isToday = d.date === s.today;
    const nothingBooked = d.open && d.counts.reservations === 0 && d.counts.waitlist === 0;
    return html`<div class="hoje">
      ${liveNotices()}
      <div class="hoje-topo">
        <p class="hoje-data">
          <b>${isToday ? "Hoje, " : ""}${formatDay(d.date, "long")}</b>
          <span>${d.open ? `Casa aberta das ${shortTime(d.opens_at || "19:00")} às ${shortTime(d.closes_at || "23:30")}` : `Fechada${d.reason_label ? ` · ${d.reason_label}` : ""}`}</span>
        </p>
        <div class="hoje-topo__acoes">
          ${s.installable ? html`<button class="btn btn--outline btn--sm" type="button" @click=${installPanel}>Instalar o painel</button>` : nothing}
          <a class="btn btn--outline btn--sm" href="/admin/salao/folha">Folha da noite</a>
          <a class="btn btn--outline btn--sm" href="/admin/reservas" @click=${(e) => (e.preventDefault(), navigate("/admin/reservas"))}>Ver todas as reservas</a>
          <button class="btn btn--sm" type="button" @click=${create}>Nova reserva</button>
        </div>
      </div>

      ${!isToday
        ? html`<p class="notice hoje-aviso">Você está vendo ${formatDay(d.date, "long")}.
            <button class="action" type="button" @click=${() => goTo(s.today)}>Voltar para hoje</button></p>`
        : nothing}
      ${!d.open ? closedNotice(d) : nothing}
      ${isToday && d.night?.changes_since_sheet ? sheetChanges(d) : nothing}

      ${d.open
        ? html`<section aria-labelledby="hoje-numeros">
            <h2 class="sr-only" id="hoje-numeros">Números da noite</h2>
            <div class="stats hoje-stats">
              <div class="stat"><b>${d.counts.reservations}</b><small>reservas</small></div>
              <div class="stat"><b>${d.counts.people}</b><small>pessoas esperadas</small></div>
              <div class="stat"><b>${d.counts.confirmed_by_customer}</b><small>confirmaram pelo WhatsApp</small></div>
              <div class="stat stat--kraft"><b>${d.counts.pending}</b><small>${d.counts.pending === 1 ? "pendente" : "pendentes"}</small></div>
              <div class="stat stat--kraft"><b>${d.counts.waitlist}</b><small>na lista de espera</small></div>
            </div>
          </section>`
        : nothing}

      ${nothingBooked ? emptyNight() : nothing}

      <div class="hoje-grade">
        <div class="hoje-col">
          ${d.open && !nothingBooked ? arriving(d) : nothing}
          ${d.calls?.length ? calls(d) : nothing}
          ${d.open && !nothingBooked ? slots(d) : nothing}
        </div>
        <div class="hoje-col">
          ${alerts(d)}
          ${runsOnboarding ? onboarding(d) : nothing}
          ${approves ? pending(d) : nothing}
          ${d.event ? eventCard(d.event) : nothing}
          ${d.feed.length ? feed(d) : nothing}
        </div>
      </div>
      ${week(d)}
    </div>`;
  }

  // ---- o retrato da noite, sem conexão ----
  function offlineScreen() {
    if (!s.pictureRead) return html`<div class="area__vazio" role="status"><span class="raiz raiz--gira" aria-hidden="true"></span><p>Abrindo o retrato da noite…</p></div>`;
    if (!s.picture) return noPicture(s.mode);
    const f = s.picture.floor;
    const list = (f.reservations || []).filter((r) => ["confirmed", "pending", "completed"].includes(r.status) && r.source !== "walk_in").sort((a, b) => a.time.localeCompare(b.time));
    const waiting = (f.reservations || []).filter((r) => ["waitlisted", "offered"].includes(r.status));
    return html`<div class="hoje">
      ${offlineBand(s.mode, s.picture)}
      <p class="hoje-data"><b>Hoje, ${formatDay(s.picture.date, "long")}</b><span>Só leitura</span></p>
      <div class="stats hoje-stats">
        <div class="stat"><b>${list.length}</b><small>reservas</small></div>
        <div class="stat"><b>${list.reduce((n, r) => n + r.party_size, 0)}</b><small>pessoas esperadas</small></div>
        <div class="stat"><b>${list.filter((r) => r.status === "completed").length}</b><small>já chegaram</small></div>
        <div class="stat stat--kraft"><b>${list.filter((r) => r.status === "pending").length}</b><small>pendentes</small></div>
        <div class="stat stat--kraft"><b>${waiting.length}</b><small>na lista de espera</small></div>
      </div>
      <section class="hoje-bloco" aria-labelledby="hoje-retrato">
        <h2 class="hoje-titulo" id="hoje-retrato">Reservas da noite</h2>
        <ul class="hoje-chegando">
          ${list.map(
            (r) => html`<li class="hoje-chegada-linha">
              <div class="hoje-chegada">
                <span class="hoje-chegada__hora">${shortTime(r.time)}</span>
                <span class="hoje-chegada__quem"><b>${String(r.customer?.name || "").split(" ")[0]}</b>
                  <small>${people(r.party_size)} · ${r.table_codes?.length ? `mesa ${r.table_codes.join(" + ")}` : "sem mesa"} · ${r.customer?.phone_masked || "sem telefone"}</small></span>
                <span class="hoje-chegada__selos">${statusBadge(r.status)}</span>
              </div>
              ${r.status === "confirmed" ? html`<div class="hoje-chegada__acoes"><button class="action" type="button" @click=${guardWrite(() => {})}>Chegou</button></div>` : nothing}
            </li>`,
          )}
        </ul>
      </section>
    </div>`;
  }

  function closedNotice(d) {
    const next = d.next_open;
    return html`<div class="notice notice--alert hoje-fechado" role="status">
      <p><b>${d.date === s.today ? "Hoje a casa não abre" : "A casa não abre nesse dia"}${d.reason_label ? ` (${d.reason_label})` : ""}.</b>
        ${next ? `Próxima abertura: ${next.label}.` : ""}</p>
      ${next ? html`<button class="btn btn--sm btn--outline" type="button" @click=${() => goTo(next.date)}>Ver a noite de ${formatDay(next.date, "weekday")}</button>` : nothing}
    </div>`;
  }

  function sheetChanges(d) {
    const n = d.night.changes_since_sheet;
    return html`<div class="notice hoje-aviso hoje-folha" role="status">
      <p><b>${n} ${n === 1 ? "mudança" : "mudanças"} desde a folha das ${houseTime(d.night.sheet_printed_at)}.</b> Reservas novas, canceladas ou com mesa trocada.</p>
      <a class="btn btn--sm btn--outline" href="/admin/salao/folha?mudancas=1">Imprimir só as mudanças</a>
    </div>`;
  }

  function emptyNight() {
    return html`<div class="empty hoje-vazio">
      <span class="raiz" aria-hidden="true"></span>
      <b>Nenhuma reserva para ${s.data?.date === s.today ? "hoje" : "essa noite"} ainda</b>
      <p>Poste o link de reservas no Instagram e no WhatsApp da casa: <a href="/reservar/">territoriofoz.com.br/reservar</a></p>
      <button class="btn btn--sm" type="button" @click=${create}>Lançar uma reserva</button>
    </div>`;
  }

  // ---- quem está chegando agora ----
  function lateText(r, d, now) {
    if (r.status !== "confirmed" || !r.starts_at || new Date(r.starts_at) > now) return "";
    const tolerance = d.rules?.tolerance_min ?? 0;
    if (!tolerance && !r.extra_tolerance_min) return `atrasada · a mesa esperava às ${r.time} em ponto`;
    const until = r.tolerance_until ? houseTime(r.tolerance_until) : "";
    return new Date(r.tolerance_until) > now ? `atrasada · espera até ${until}` : `atrasada · a tolerância acabou às ${until}`;
  }

  function arriving(d) {
    const now = nightNow();
    const nowMin = houseParts(now).minutes;
    const isToday = d.date === s.today;
    const recent = (s.list || []).filter((r) => r.status === "completed" && r.arrived_at && r.source !== "walk_in" && now - new Date(r.arrived_at) <= (d.rules?.undo_check_in_min ?? 15) * MIN);
    const next = (s.list || [])
      .filter((r) => ARRIVING.has(r.status) && !r.arrived_at)
      .filter((r) => !isToday || toMinutes(r.time) >= nowMin - 60)
      .slice(0, 6);
    const rows = [...recent, ...next];
    return html`<section class="hoje-bloco" aria-labelledby="hoje-chegando">
      <h2 class="hoje-titulo" id="hoje-chegando">${isToday ? "Chegando agora" : "Primeiras chegadas"}</h2>
      ${isToday && d.rules ? html`<p class="hoje-regra">${d.rules.tolerance_min ? `A mesa espera ${d.rules.tolerance_min} min depois do horário.` : "A mesa espera no horário, em ponto."}</p>` : nothing}
      ${rows.length
        ? html`<ul class="hoje-chegando">
            ${rows.map((r) => {
              const late = isToday ? lateText(r, d, now) : "";
              return html`<li class="hoje-chegada-linha">
                <button class="hoje-chegada" type="button" @click=${() => open(r.id)}>
                  <span class="hoje-chegada__hora">${shortTime(r.time)}</span>
                  <span class="hoje-chegada__quem">
                    <b>${r.customer.name}</b>
                    <small>${people(r.party_size)} · ${r.table_codes.length ? `mesa ${r.table_codes.join(" + ")}` : "sem mesa"}${r.area_key ? ` · ${AREA[r.area_key]}` : ""}${flagList(r) ? ` · ${flagList(r)}` : ""}${r.no_whatsapp ? " · sem WhatsApp" : ""}</small>
                    ${late ? html`<small class="hoje-atraso">${late}</small>` : nothing}
                  </span>
                  <span class="hoje-chegada__selos">${statusBadge(r.status)} ${confirmationBadge(r.customer_confirmation)} ${arrivingNote(r)} ${notifiedNote(r)}</span>
                </button>
                ${isToday
                  ? html`<div class="hoje-chegada__acoes">
                      ${canCheckIn(r, s.today) && r.status === "confirmed" ? html`<button class="action action--solid" type="button" aria-label=${`Chegou: ${r.customer.name}`} @click=${() => checkIn(r, { onDone: refresh })}>Chegou</button>` : nothing}
                      ${undoButton(r, d.rules, refresh, now)}
                      ${r.status === "confirmed" ? readyMenu(r, d) : nothing}
                    </div>`
                  : nothing}
              </li>`;
            })}
          </ul>`
        : html`<p class="hoje-calmo">Ninguém mais para chegar agora.</p>`}
    </section>`;
  }

  function readyMenu(r, d) {
    return html`<details class="hoje-prontas">
      <summary class="action">Mensagens</summary>
      ${readyButtons(r, { whatsapp: d.whatsapp, onSent: refresh, compact: true })}
    </details>`;
  }

  // ---- "Ligar para confirmar" (5.19) ----
  function calls(d) {
    return html`<section class="hoje-bloco" aria-labelledby="hoje-ligar">
      <h2 class="hoje-titulo" id="hoje-ligar">Ligar para confirmar <span class="count">${d.calls.length}</span></h2>
      <p class="hoje-calmo">Clientes sem WhatsApp: a casa liga e marca a resposta, como nos botões do lembrete.</p>
      <ul class="hoje-pendentes">
        ${d.calls.map(
          (r) => html`<li class="hoje-pendente hoje-ligacao">
            <div>
              <b>${r.customer.name}</b>
              <small>${people(r.party_size)} · ${shortTime(r.time)} · ${r.code} · sem WhatsApp · confirmar por ligação</small>
              ${revealsPhone
                ? s.phones[r.id]
                  ? html`<a class="mono hoje-telefone" href=${`tel:${s.phones[r.id]}`}>${formatPhone(s.phones[r.id])}</a>`
                  : html`<small>${r.customer.phone_masked || "sem telefone"}</small>`
                : html`<small>O número fica com o dono e a gerência. Pedir ao dono ou à gerente.</small>`}
            </div>
            ${answersCalls
              ? html`<div class="hoje-pendente__acoes">
                  ${revealsPhone && !s.phones[r.id] && r.customer.phone_masked ? html`<button class="action" type="button" @click=${() => revealPhone(r)}>Ver telefone</button>` : nothing}
                  <button class="action action--solid" type="button" @click=${() => answerCall(r, "yes")}>Confirmou</button>
                  <button class="action" type="button" ?disabled=${r.customer_late} @click=${() => answerCall(r, "late")}>Vai atrasar</button>
                  <button class="action action--alert" type="button" @click=${() => answerCall(r, "no")}>Não vai mais</button>
                </div>`
              : nothing}
          </li>`,
        )}
      </ul>
    </section>`;
  }

  // ---- as colunas de horário ----
  function slots(d) {
    const byTime = new Map(d.slots.map((x) => [x.time, []]));
    for (const r of s.list || []) byTime.get(r.time)?.push(r);
    return html`<section class="hoje-bloco" aria-labelledby="hoje-horarios">
      <h2 class="hoje-titulo" id="hoje-horarios">Horários</h2>
      <ol class="hoje-horarios">
        ${d.slots.map(
          (slot) => html`<li class="hoje-horario">
            <div class="hoje-horario__cabeca">
              <b>${shortTime(slot.time)}</b>
              <small>${slot.arriving_people ? `${people(slot.arriving_people)} chegam` : "ninguém chega"}</small>
            </div>
            <div class="hoje-barra" role="img" aria-label=${`Casa ${slot.occupancy_pct}% ocupada às ${shortTime(slot.time)}`}>
              <span style=${`inline-size: ${slot.occupancy_pct}%`}></span>
            </div>
            <small class="hoje-horario__pct">${slot.occupancy_pct}% ocupada</small>
            <div class="hoje-horario__fichas">
              ${(byTime.get(slot.time) || []).map(
                (r) => html`<button type="button" class=${`ticket hoje-ficha${r.status === "pending" ? " is-new" : ""}`} @click=${() => open(r.id)}>
                  ${r.table_codes.length ? html`<span class="ticket__table">${r.table_codes.join("+")}</span>` : nothing}
                  <strong>${r.customer.name}</strong>
                  <small>${people(r.party_size)}${r.status === "pending" ? " · pendente" : r.status === "completed" ? " · chegou" : ""}</small>
                  ${flagList(r) ? html`<span class="ticket__note">${flagList(r)}</span>` : nothing}
                </button>`,
              )}
            </div>
          </li>`,
        )}
      </ol>
    </section>`;
  }

  // ---- o que precisa de atenção ----
  function alertActions(a) {
    const list = [];
    if (a.kind === "message_failed") list.push(html`<button class="action action--alert" type="button" @click=${() => resend(a)}>Reenviar</button>`);
    if (a.kind === "print_sheet") list.push(html`<a class="action hoje-link" href="/admin/salao/folha">Imprimir a folha</a>`);
    if (a.kind === "night_closing" && a.can_postpone) list.push(html`<button class="action" type="button" @click=${postpone}>Adiar 1 h</button>`);
    if (a.kind === "night_not_closed" && closesNight) list.push(html`<button class="action action--solid" type="button" @click=${() => closeLast(a)}>Fechar a noite agora</button>`);
    if (a.kind === "paper_correction") {
      list.push(html`<button class="action action--solid" type="button" @click=${() => correction(a, "apply")}>Aplicar</button>`);
      list.push(html`<button class="action" type="button" @click=${() => correction(a, "dismiss")}>Dispensar</button>`);
    }
    if (a.reservation_id && a.kind !== "paper_correction") list.push(html`<button class="action" type="button" @click=${() => open(a.reservation_id)}>Abrir</button>`);
    if (a.path && a.kind !== "print_sheet") list.push(html`<a class="action hoje-link" href=${a.path}>${a.path_label || "Resolver"}</a>`);
    if (a.can_dismiss) list.push(html`<button class="action" type="button" aria-label=${`Dispensar só para mim: ${a.text}`} @click=${() => dismiss(a)}>Dispensar</button>`);
    else if (a.can_resolve) list.push(html`<button class="action" type="button" aria-label=${`Marcar como resolvido: ${a.text}`} @click=${() => dismiss(a)}>Resolvido</button>`);
    return list;
  }

  function alertItems(a) {
    if (!a.items?.length) return nothing;
    const closed = a.undo_until && nightNow() > new Date(a.undo_until);
    return html`<ul class="hoje-itens">
      ${a.items.map(
        (r) => html`<li>
          <span><b>${r.customer.name}</b> · ${people(r.party_size)} · ${shortTime(r.time)} · ${r.code}</span>
          ${a.kind === "no_show_review"
            ? closed
              ? html`<small>Passou o prazo de desfazer: perdoe a falta na ficha do cliente.</small>`
              : html`<button class="action" type="button" aria-label=${`Desfazer o "Não veio" de ${r.customer.name}`} @click=${() => undoNoShow(r)}>Desfazer</button>`
            : html`<button class="action" type="button" @click=${() => open(r.id)}>Abrir</button>`}
        </li>`,
      )}
    </ul>`;
  }

  function alerts(d) {
    const list = d.alerts.filter((a) => a.kind !== "onboarding");
    return html`<section class="hoje-bloco" aria-labelledby="hoje-alertas">
      <h2 class="hoje-titulo" id="hoje-alertas">Precisa de atenção</h2>
      ${list.length
        ? html`<ul class="hoje-alertas">
            ${list.map(
              (a) => html`<li class=${`hoje-alerta hoje-alerta--${a.kind}${urgent(a) ? " is-urgente" : ""}`} data-nivel=${levelOf(a.kind)}>
                <span class="feed-item__kind">${levelOf(a.kind) === "critical" ? "crítico · " : ""}${ALERT_WORD[a.kind] || "aviso"}${a.at ? html` · <time datetime=${a.at}>${houseTime(a.at)}</time>` : nothing}</span>
                <p>${a.text}</p>
                <div class="hoje-alerta__acoes">${alertActions(a)}</div>
                ${alertItems(a)}
              </li>`,
            )}
          </ul>`
        : html`<p class="hoje-calmo">Tudo em ordem por aqui.</p>`}
    </section>`;
  }

  // ---- o que falta da configuração inicial: os 5 passos visíveis do passo a passo (5.2, FR-63) ----
  function onboarding(d) {
    const steps = d.onboarding || [];
    const left = steps.filter((x) => !x.done);
    if (!left.length) return nothing;
    return html`<section class="hoje-bloco" aria-labelledby="hoje-primeiro">
      <h2 class="hoje-titulo" id="hoje-primeiro">Primeiro uso · ${steps.length - left.length} de ${steps.length} prontos</h2>
      <ol class="hoje-alertas hoje-passos">
        ${steps.map(
          (st, i) => html`<li class=${`hoje-alerta hoje-alerta--onboarding${st.done ? " is-feito" : ""}`}>
            <span class="feed-item__kind">passo ${i + 1} · ${st.done ? "pronto" : "falta"}</span>
            <p><b>${st.label}</b>${st.done ? "" : `: falta ${st.missing.join(" e ")}.`}</p>
            <div class="hoje-alerta__acoes">${st.done ? nothing : html`<a class="action hoje-link" href=${st.path} aria-label=${`Resolver: ${st.label}`}>Resolver</a>`}</div>
          </li>`,
        )}
      </ol>
    </section>`;
  }

  function pending(d) {
    if (!d.pending.length) return nothing;
    return html`<section class="hoje-bloco" aria-labelledby="hoje-pendentes">
      <h2 class="hoje-titulo" id="hoje-pendentes">Pedidos esperando a casa <span class="count">${d.pending.length}</span></h2>
      <ul class="hoje-pendentes">
        ${d.pending.map(
          (r) => html`<li class="hoje-pendente">
            <div>
              <b>${r.customer.name}</b>
              <small>${people(r.party_size)} · ${r.date === s.today ? "hoje" : formatDay(r.date)} às ${shortTime(r.time)}${r.pending_until ? ` · vence às ${houseParts(r.pending_until).time}` : ""}</small>
              ${r.notes ? html`<small>${r.notes}</small>` : nothing}
            </div>
            <div class="hoje-pendente__acoes">
              ${r.table_codes.length
                ? html`<button class="action action--solid" type="button" ?disabled=${Boolean(s.approving)} @click=${() => approve(r)}>
                    ${s.approving === r.id ? "Aprovando…" : `Aprovar com ${r.table_codes.join(" + ")}`}
                  </button>`
                : nothing}
              <button class="action" type="button" @click=${() => open(r.id)}>Ver o pedido</button>
            </div>
          </li>`,
        )}
      </ul>
    </section>`;
  }

  function eventCard(ev) {
    const door = ["list", "mixed"].includes(ev.booking_mode);
    return html`<section class="hoje-bloco hoje-evento" aria-labelledby="hoje-evento">
      <h2 class="hoje-titulo" id="hoje-evento">Evento da noite</h2>
      <p><b>${ev.title}</b></p>
      <p>${ev.expected_people} esperados · ${ev.arrived_people} já chegaram${ev.capacity ? ` · lista para ${ev.capacity}` : ""}</p>
      ${door ? html`<a class="btn btn--sm" href=${`/admin/salao/porta?evento=${encodeURIComponent(ev.id)}`}>Porta do evento</a>` : nothing}
    </section>`;
  }

  function feed(d) {
    return html`<section class="hoje-bloco" aria-labelledby="hoje-movimento">
      <h2 class="hoje-titulo" id="hoje-movimento">Movimento</h2>
      <ul class="feed">
        ${d.feed.map(
          (f) => html`<li class=${`feed-item ${FEED_CLASS[f.kind] ? `feed-item--${FEED_CLASS[f.kind]}` : ""}`}>
            <span class="feed-item__kind">${FEED_WORD[f.kind] || f.kind}</span>
            <span class="feed-item__when">${houseParts(f.at).date === houseParts(d.server_time).date ? houseParts(f.at).time : formatDay(houseParts(f.at).date, "dm")}</span>
            <strong>${f.summary}</strong>
          </li>`,
        )}
      </ul>
    </section>`;
  }

  // ---- a semana ----
  function week(d) {
    return html`<section class="hoje-bloco" aria-labelledby="hoje-semana">
      <h2 class="hoje-titulo" id="hoje-semana">A semana</h2>
      <ol class="hoje-semana">
        ${d.week.map(
          (w) => html`<li>
            <button type="button" class=${`hoje-dia${w.open ? "" : " is-fechado"}`} aria-current=${w.date === d.date ? "date" : nothing}
              @click=${() => goTo(w.date)} aria-label=${dayLabel(w)}>
              <small>${formatDay(w.date, "weekday-short")}</small>
              <b>${formatDay(w.date, "dm")}</b>
              ${w.open
                ? html`<span>${w.reservations} ${w.reservations === 1 ? "reserva" : "reservas"}</span>
                    <span class="hoje-barra hoje-barra--fina" aria-hidden="true"><span style=${`inline-size: ${w.occupancy_pct}%`}></span></span>
                    <span>${w.occupancy_pct}% no pico</span>`
                : html`<span>fechado${w.reason_label && w.reason_label !== "fechado" ? ` · ${w.reason_label}` : ""}</span>`}
            </button>
          </li>`,
        )}
      </ol>
    </section>`;
  }

  const dayLabel = (w) =>
    `${formatDay(w.date, "long")}: ${w.open ? `${w.reservations} reservas, ${w.occupancy_pct}% no pico` : `fechado${w.reason_label && w.reason_label !== "fechado" ? `, ${w.reason_label}` : ""}`}`;

  // ---- ciclo de vida ----
  const live = startLive({
    refresh: ({ reason, topics = [] }) => {
      // uma mudança só nos avisos não mexe no retrato da noite nem na gaveta aberta
      if (reason === "live" && topics.some((t) => t !== "alerts")) {
        keepNight(true);
        refreshReservation();
      }
      return s.data || s.mode !== "online" ? load({ quiet: true }) : undefined;
    },
    onState: ({ lost }) => {
      s.lost = lost;
      draw();
    },
  });
  setHealthCheck(() => load({ quiet: true }));
  const stopConnection = onConnection((mode) => {
    s.mode = mode;
    if (mode === "online") load({ quiet: Boolean(s.data) });
    else showPicture();
  });
  const stopInstall = onInstallable((on) => {
    s.installable = on;
    draw();
  });
  // as contagens regressivas e a janela do "Desfazer" andam com o relógio
  const tick = setInterval(() => s.data && draw(), 30_000);

  await load();

  return () => {
    alive = false;
    live.stop();
    stopConnection();
    stopInstall();
    clearInterval(tick);
    setHealthCheck(null);
    controller?.abort();
    closeReservation();
  };
}
