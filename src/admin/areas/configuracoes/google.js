// A conta Google da casa dentro de Integrações (história 2.22, FR-84, FR-85), só o dono:
// "Ligar conta Google" passa por uma autorização simulada do Google (escolher a conta, liberar a
// agenda e os arquivos do próprio app), depois o dono escolhe ou cria a agenda e a
// pasta do Drive, liga ou desliga cada parte, vê o que vai em cada evento (e o que nunca
// vai) e os próximos eventos. Desligar uma parte pede a checagem de identidade, se apaga os
// eventos já criados, e vai para o registro de ações.
import { openDialog } from "../../../components/dialog.js";
import { toast } from "../../../components/toast.js";
import { formatDay } from "../../../lib/dates.js";
import { staffErrorMessage } from "../../../lib/errors.js";
import { html, nothing, render } from "../../../lib/html.js";
import * as api from "../../../services/api/staff-google.js";
import { ensureIdentity, withIdentity } from "../../identity.js";
import { when } from "./group.js";

const DEFAULT_CALENDAR = "Reservas · Território";
const DEFAULT_FOLDER = "Território · Sistema";
const SCOPE_CALENDAR = "calendar.events";
const SCOPE_DRIVE = "drive.file";
// a demonstração faz as vezes do seletor de contas do próprio Google: nada sai para o Google
const DEMO_ACCOUNTS = [
  { name: "Território Izakaya", email: "territorio.foz@gmail.com" },
  { name: "Marcus Norberto", email: "marcus.norberto@gmail.com" },
];
const SYNC = {
  ok: ["ligada", "badge--confirmed"],
  problem: ["com problema", "badge--no-show"],
  not_connected: ["não ligada", "badge--expired"],
};
const SHOWN_EVENTS = 6;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const range = (e) => `${formatDay(e.date)} · ${e.time}${e.ends_at ? `–${when(e.ends_at).split(" ").at(-1)}` : ""}`;

// ---- uma janelinha desenhada no body, como a confirmação e a checagem de identidade -----------

let seq = 0;

/** Abre uma janela cujo conteúdo `view(close)` desenha; resolve com o que close() recebeu (null no Esc). */
function modal(view, { className = "", labelledby } = {}) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = `dialog dialog--confirm cfg-gdialogo ${className}`;
    if (labelledby) dialog.setAttribute("aria-labelledby", labelledby);
    document.body.append(dialog);
    let answer = null;
    const close = (value) => {
      answer = value ?? null;
      dialog.close();
    };
    const draw = () => render(view(close, draw), dialog);
    draw();
    openDialog(dialog, {
      onClose: () => {
        dialog.remove();
        resolve(answer);
      },
    });
    (dialog.querySelector("[data-foco]") || dialog.querySelector("button, input"))?.focus();
  });
}

/** A autorização simulada do Google: a conta, depois as duas permissões. */
function googleAuthorization() {
  const id = `gauth-${++seq}`;
  const s = { step: "account", account: null, other: "", otherError: "", calendar: true, drive: true };
  return modal(
    (close, draw) => {
      if (s.step === "account") {
        const useOther = (e) => {
          e.preventDefault();
          const email = s.other.trim().toLowerCase();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            s.otherError = "Digite um e-mail do Google, como casa@gmail.com.";
            draw();
            document.getElementById(`${id}-outra`)?.focus();
            return;
          }
          s.account = { name: "", email };
          s.step = "scopes";
          draw();
          document.querySelector(`#${id}-titulo`)?.focus();
        };
        return html`<div class="dialog__body cfg-gauth">
          <p class="cfg-gauth__marca">Google · simulação</p>
          <h2 id=${`${id}-titulo`} tabindex="-1">Escolha uma conta</h2>
          <p>para continuar no sistema do Território</p>
          <ul class="cfg-gauth__contas">
            ${DEMO_ACCOUNTS.map(
              (a, i) => html`<li>
                <button
                  type="button"
                  class="cfg-gauth__conta"
                  ?data-foco=${i === 0}
                  @click=${() => {
                    s.account = a;
                    s.step = "scopes";
                    draw();
                    document.querySelector(`#${id}-titulo`)?.focus();
                  }}
                >
                  <span class="cfg-gauth__inicial" aria-hidden="true">${a.name[0]}</span>
                  <span><b>${a.name}</b><span class="cfg-gauth__email">${a.email}</span></span>
                </button>
              </li>`,
            )}
          </ul>
          <form class="cfg-gauth__outra" novalidate @submit=${useOther}>
            <div class="field ${s.otherError ? "field--invalid" : ""}">
              <label class="field__label" for=${`${id}-outra`}>Usar outra conta</label>
              <input
                id=${`${id}-outra`}
                class="field__input"
                type="email"
                autocomplete="email"
                placeholder="casa@gmail.com"
                .value=${s.other}
                aria-invalid=${s.otherError ? "true" : "false"}
                aria-describedby=${s.otherError ? `${id}-outra-erro` : nothing}
                @input=${(e) => (s.other = e.target.value)}
              />
              ${s.otherError ? html`<p class="field__error" id=${`${id}-outra-erro`}>${s.otherError}</p>` : nothing}
            </div>
            <button type="submit" class="btn btn--outline btn--sm">Usar esta conta</button>
          </form>
          <p class="cfg-ajuda">Na demonstração nada sai para o Google: a conta e as permissões são de mentira.</p>
          <div class="dialog__actions">
            <button type="button" class="btn btn--outline btn--sm" data-close>Cancelar</button>
          </div>
        </div>`;
      }
      const none = !s.calendar && !s.drive;
      return html`<div class="dialog__body cfg-gauth">
        <p class="cfg-gauth__marca">Google · simulação</p>
        <h2 id=${`${id}-titulo`} tabindex="-1">O sistema do Território quer acessar sua conta</h2>
        <p class="cfg-gauth__quem"><span class="cfg-gauth__inicial" aria-hidden="true">${(s.account.name || s.account.email)[0].toUpperCase()}</span>${s.account.email}</p>
        <fieldset class="cfg-gauth__permissoes">
          <legend>Escolha o que o sistema pode fazer</legend>
          <label class="check">
            <input type="checkbox" .checked=${s.calendar} @change=${(e) => ((s.calendar = e.target.checked), draw())} />
            <span><b>Ver e editar eventos da agenda</b><br /><span class="cfg-ajuda">Para cada reserva virar um evento na agenda que você escolher.</span></span>
          </label>
          <label class="check">
            <input type="checkbox" .checked=${s.drive} @change=${(e) => ((s.drive = e.target.checked), draw())} />
            <span><b>Ver, criar e apagar só os arquivos do Drive criados por este app</b><br /><span class="cfg-ajuda">O sistema não enxerga mais nada do seu Drive.</span></span>
          </label>
        </fieldset>
        ${none ? html`<p class="cfg-erro" role="alert">Marque ao menos uma permissão para continuar.</p>` : nothing}
        <p class="cfg-ajuda">Você pode tirar o acesso quando quiser, aqui ou na sua conta do Google.</p>
        <div class="dialog__actions">
          <button type="button" class="btn btn--outline btn--sm" @click=${() => ((s.step = "account"), draw())}>Voltar</button>
          <button
            type="button"
            class="btn btn--sm"
            data-foco
            ?disabled=${none}
            @click=${() =>
              close({
                account_email: s.account.email,
                account_name: s.account.name || null,
                scopes: [s.calendar && SCOPE_CALENDAR, s.drive && SCOPE_DRIVE].filter(Boolean),
              })}
          >
            Permitir
          </button>
        </div>
      </div>`;
    },
    { className: "cfg-gdialogo--google", labelledby: `${id}-titulo` },
  );
}

/** Pergunta como desligar algo: resolve { deleteEvents } ou null quando desistiu. */
function askTurnOff({ title, message, events, confirmLabel }) {
  const id = `gdesliga-${++seq}`;
  const s = { deleteEvents: true };
  return modal(
    (close, draw) => html`<div class="dialog__body">
      <h2 id=${`${id}-titulo`}>${title}</h2>
      <p>${message}</p>
      ${events
        ? html`<fieldset class="cfg-gdesliga">
            <legend>${plural(events, "evento já criado", "eventos já criados")} na agenda</legend>
            <label class="check">
              <input type="radio" name=${`${id}-eventos`} .checked=${s.deleteEvents} @change=${() => ((s.deleteEvents = true), draw())} />
              <span>Apagar da agenda</span>
            </label>
            <label class="check">
              <input type="radio" name=${`${id}-eventos`} .checked=${!s.deleteEvents} @change=${() => ((s.deleteEvents = false), draw())} />
              <span>Deixar na agenda (param de ser atualizados)</span>
            </label>
          </fieldset>`
        : nothing}
      <p class="cfg-ajuda">Para de enviar na hora. Pede a sua senha e o código, e fica no registro de ações.</p>
      <div class="dialog__actions">
        <button type="button" class="btn btn--outline btn--sm" data-foco data-close>Voltar</button>
        <button type="button" class="btn btn--sm btn--danger" @click=${() => close({ deleteEvents: Boolean(events) && s.deleteEvents })}>${confirmLabel}</button>
      </div>
    </div>`,
    { labelledby: `${id}-titulo` },
  );
}

// ---- o bloco --------------------------------------------------------------------------

/**
 * @param {HTMLElement} host
 * @param {{user: any}} options
 */
export function mountGoogle(host, { user }) {
  const s = {
    status: "loading",
    data: null,
    error: null,
    events: [],
    allEvents: false,
    lists: { calendars: null, folders: null },
    choose: { calendar: false, folder: false },
    calChoice: { mode: "create", id: "", name: DEFAULT_CALENDAR },
    folderChoice: { mode: "create", id: "", name: DEFAULT_FOLDER },
    busy: "",
  };
  let alive = true;
  const controller = new AbortController();

  async function load() {
    try {
      s.data = await api.status({ signal: controller.signal });
      s.status = "ready";
      s.error = null;
      await afterData();
    } catch (error) {
      if (!alive || error?.name === "AbortError") return;
      s.status = "error";
      s.error = error;
    }
    draw();
  }

  async function afterData() {
    const d = s.data;
    if (!d?.connected) return;
    s.choose.calendar = s.choose.calendar || (!d.calendar && d.scopes.includes(SCOPE_CALENDAR));
    s.choose.folder = s.choose.folder || (!d.folder && d.scopes.includes(SCOPE_DRIVE));
    const [events, calendars, folders] = await Promise.all([
      d.calendar_sync ? api.events({ signal: controller.signal }).catch(() => []) : [],
      s.choose.calendar && !s.lists.calendars ? api.calendars({ signal: controller.signal }).catch(() => []) : s.lists.calendars,
      s.choose.folder && !s.lists.folders ? api.folders({ signal: controller.signal }).catch(() => []) : s.lists.folders,
    ]);
    s.events = events;
    s.lists = { calendars, folders };
  }

  async function run(key, call, done) {
    if (s.busy) return;
    s.busy = key;
    draw();
    try {
      const result = await call();
      if (!alive) return;
      if (result) s.data = result;
      else s.data = await api.status();
      await afterData();
      if (done) toast({ title: done });
    } catch (error) {
      if (!alive) return;
      toast({ kind: "error", title: "Não deu para mudar agora", message: staffErrorMessage(error) });
    } finally {
      s.busy = "";
      draw();
    }
  }

  /**
   * Uma mudança que precisa da checagem de identidade do painel (senha e código, conferidos pela API, uma vez
   * a cada 5 minutos); quando os 5 minutos do servidor acabaram, pede de novo e repete a chamada.
   */
  async function sensitive(key, call, done, message) {
    if (!(await ensureIdentity({ message }))) return;
    await run(key, () => withIdentity(call, { message }), done);
  }

  // ---- ações ----
  async function connect() {
    const grant = await googleAuthorization();
    if (!grant) return;
    s.choose = { calendar: false, folder: false };
    s.lists = { calendars: null, folders: null };
    await run("connect", () => api.update(grant), `Conta ${grant.account_email} ligada. Agora escolha a agenda e a pasta.`);
    host.querySelector(".cfg-google__escolha input, .cfg-google__escolha select")?.focus();
  }

  async function startChoosing(part) {
    s.choose[part] = true;
    s.busy = "lists";
    draw();
    try {
      if (part === "calendar") s.lists.calendars = await api.calendars();
      else s.lists.folders = await api.folders();
    } catch (error) {
      toast({ kind: "error", title: "Não deu para ver o que a conta tem", message: staffErrorMessage(error) });
    }
    s.busy = "";
    draw();
  }

  function chosen(part) {
    const c = part === "calendar" ? s.calChoice : s.folderChoice;
    if (c.mode === "create") return { create: true, name: c.name.trim() || (part === "calendar" ? DEFAULT_CALENDAR : DEFAULT_FOLDER) };
    const list = part === "calendar" ? s.lists.calendars : s.lists.folders;
    return { id: c.id || list?.[0]?.id };
  }

  async function saveChoice(part) {
    const body = { [part]: chosen(part) };
    await run(part, () => api.update(body), part === "calendar" ? "Agenda escolhida. As reservas vão para lá." : "Pasta escolhida. A folha da noite vai para lá.");
    if (s.data?.[part]) s.choose[part] = false;
    draw();
  }

  async function toggleCalendar() {
    const d = s.data;
    if (!d.calendar_sync) {
      await run("calendar_sync", () => api.update({ calendar_sync: true }), "Reservas na Agenda ligadas.");
      return;
    }
    const answer = await askTurnOff({
      title: "Desligar as reservas na Agenda?",
      message: `As reservas param de ir para "${d.calendar.name}".`,
      events: d.sync.events_count,
      confirmLabel: "Desligar a Agenda",
    });
    if (!answer) return;
    await sensitive(
      "calendar_sync",
      () => api.update({ calendar_sync: false, delete_events: answer.deleteEvents }),
      answer.deleteEvents ? "Agenda desligada e eventos apagados." : "Agenda desligada. Os eventos ficaram lá, sem atualização.",
      "Desligar a Agenda pede a senha e o código de novo. Vale por 5 minutos.",
    );
  }

  async function toggleDrive() {
    const d = s.data;
    if (!d.drive_sync) {
      await run("drive_sync", () => api.update({ drive_sync: true }), "Drive ligado.");
      return;
    }
    const answer = await askTurnOff({
      title: "Desligar o Drive?",
      message: `A folha da noite e as cópias das exportações param de ir para "${d.folder.name}". Os arquivos que já estão lá continuam.`,
      events: 0,
      confirmLabel: "Desligar o Drive",
    });
    if (!answer) return;
    await sensitive("drive_sync", () => api.update({ drive_sync: false }), "Drive desligado.", "Desligar o Drive pede a senha e o código de novo. Vale por 5 minutos.");
  }

  async function disconnectAll() {
    const d = s.data;
    const answer = await askTurnOff({
      title: "Desligar a conta Google?",
      message: `O sistema para de usar ${d.account_email}: nada mais vai para a Agenda nem para o Drive. Os arquivos do Drive continuam lá.`,
      events: d.calendar_sync ? d.sync.events_count : 0,
      confirmLabel: "Desligar a conta",
    });
    if (!answer) return;
    s.events = [];
    await sensitive(
      "account",
      async () => {
        await api.disconnect(answer.deleteEvents);
        return api.status();
      },
      "Conta Google desligada.",
      "Desligar a conta Google pede a senha e o código de novo. Vale por 5 minutos.",
    );
  }

  // ---- telas ----
  function toggle(label, on, onClick, key) {
    const busy = s.busy === key;
    return html`<button type="button" role="switch" class="cfg-chave" aria-checked=${String(on)} aria-label=${label} aria-busy=${String(busy)} ?disabled=${Boolean(s.busy)} @click=${onClick}>
      <span class="cfg-chave__trilho" aria-hidden="true"><span class="cfg-chave__pino"></span></span>
      <span class="cfg-chave__palavra">${on ? "Ligada" : "Desligada"}</span>
    </button>`;
  }

  function chooser(part) {
    const isCal = part === "calendar";
    const c = isCal ? s.calChoice : s.folderChoice;
    const list = (isCal ? s.lists.calendars : s.lists.folders) || [];
    const id = `cfg-google-${part}`;
    const label = isCal ? "agenda" : "pasta";
    const current = isCal ? s.data.calendar : s.data.folder;
    return html`<fieldset class="cfg-google__escolha">
      <legend class="sr-only">Qual ${label} usar</legend>
      <label class="check">
        <input type="radio" name=${`${id}-modo`} .checked=${c.mode === "create"} @change=${() => ((c.mode = "create"), draw())} />
        <span>Criar uma ${label} nova</span>
      </label>
      ${c.mode === "create"
        ? html`<div class="field cfg-google__nome">
            <label class="field__label" for=${`${id}-nome`}>Nome da ${label}</label>
            <input id=${`${id}-nome`} class="field__input" maxlength="80" .value=${c.name} @input=${(e) => (c.name = e.target.value)} />
          </div>`
        : nothing}
      <label class="check">
        <input type="radio" name=${`${id}-modo`} .checked=${c.mode === "existing"} ?disabled=${!list.length} @change=${() => ((c.mode = "existing"), (c.id = c.id || list[0]?.id || ""), draw())} />
        <span>Usar uma ${label} que a conta já tem</span>
      </label>
      ${c.mode === "existing"
        ? html`<div class="field cfg-google__nome">
            <label class="field__label" for=${`${id}-lista`}>${isCal ? "Agenda" : "Pasta"}</label>
            <select id=${`${id}-lista`} class="field__input" @change=${(e) => (c.id = e.target.value)}>
              ${list.map((x) => html`<option value=${x.id} ?selected=${x.id === c.id}>${x.name}${x.primary ? " (principal)" : ""}</option>`)}
            </select>
          </div>`
        : nothing}
      <span class="cfg-google__botoes">
        ${current ? html`<button type="button" class="btn btn--outline btn--sm" @click=${() => ((s.choose[part] = false), draw())}>Voltar</button>` : nothing}
        <button type="button" class="btn btn--sm" aria-busy=${String(s.busy === part)} ?disabled=${Boolean(s.busy)} @click=${() => saveChoice(part)}>
          ${s.busy === part ? "Gravando…" : `Usar esta ${label}`}
        </button>
      </span>
    </fieldset>`;
  }

  function eventCard(e) {
    return html`<figure class="cfg-gevento">
      <figcaption class="sr-only">Prévia de um evento na agenda</figcaption>
      <p class="cfg-gevento__quando">${range(e)}${e.status === "tentative" ? html` · <span class="cfg-gevento__talvez">a confirmar</span>` : nothing}</p>
      <p class="cfg-gevento__titulo">${e.title}</p>
      <p class="cfg-gevento__desc">Código ${e.code}</p>
      <p class="cfg-gevento__desc">Abrir no painel: <span class="cfg-gevento__link">${e.link}</span></p>
    </figure>`;
  }

  function calendarRow(d) {
    const can = d.scopes.includes(SCOPE_CALENDAR);
    let ctl;
    if (!can) ctl = html`<p class="cfg-ajuda">Sem a permissão da agenda. Para ligar, desligue a conta e ligue de novo marcando a agenda.</p>`;
    else if (s.choose.calendar || !d.calendar) ctl = chooser("calendar");
    else
      ctl = html`<span class="cfg-google__atual">
        <b>${d.calendar.name}</b>
        <button type="button" class="link-button" ?disabled=${Boolean(s.busy)} @click=${() => startChoosing("calendar")}>Trocar a agenda</button>
      </span>
      ${toggle("Reservas na Agenda", d.calendar_sync, toggleCalendar, "calendar_sync")}`;
    return html`<div class="cfg-linha cfg-linha--larga cfg-google__linha" id="linha-google-agenda">
      <div class="cfg-linha__rot">
        <span class="cfg-linha__rotulo">Reservas na Agenda</span>
        <p class="cfg-ajuda">Cada reserva confirmada ou pendente vira um evento. Remarcar, trocar a mesa ou mudar as pessoas atualiza o evento; cancelar ou "Não veio" apaga. Só vai do sistema para a agenda.</p>
      </div>
      <div class="cfg-google__ctl">${ctl}</div>
    </div>`;
  }

  function driveRow(d) {
    const can = d.scopes.includes(SCOPE_DRIVE);
    let ctl;
    if (!can) ctl = html`<p class="cfg-ajuda">Sem a permissão dos arquivos. Para ligar, desligue a conta e ligue de novo marcando os arquivos.</p>`;
    else if (s.choose.folder || !d.folder) ctl = chooser("folder");
    else
      ctl = html`<span class="cfg-google__atual">
          <b>${d.folder.name}</b>
          <button type="button" class="link-button" ?disabled=${Boolean(s.busy)} @click=${() => startChoosing("folder")}>Trocar a pasta</button>
        </span>
        ${toggle("Folha da noite e exportações no Drive", d.drive_sync, toggleDrive, "drive_sync")}
        ${d.files?.length
          ? html`<ul class="cfg-google__arquivos" aria-label="Últimos arquivos na pasta">
              ${d.files.map((f) => html`<li><span class="mono">${f.name}</span> <span class="cfg-ajuda">${f.folder} · ${when(f.created_at)}</span></li>`)}
            </ul>`
          : nothing}`;
    return html`<div class="cfg-linha cfg-linha--larga cfg-google__linha" id="linha-google-drive">
      <div class="cfg-linha__rot">
        <span class="cfg-linha__rotulo">Folha da noite e exportações no Drive</span>
        <p class="cfg-ajuda">A folha da noite em PDF vai para a pasta todo dia antes de abrir, numa subpasta por mês, e cada exportação de reservas, clientes e registro ganha uma cópia. O sistema só enxerga os arquivos que ele mesmo criou.</p>
      </div>
      <div class="cfg-google__ctl">${ctl}</div>
    </div>`;
  }

  function syncRow(d) {
    const [label, cls] = SYNC[d.sync.state] || SYNC.not_connected;
    const ch = d.sync.last_change;
    const bits = ch ? [ch.created && plural(ch.created, "criado", "criados"), ch.updated && plural(ch.updated, "mudado", "mudados"), ch.removed && plural(ch.removed, "apagado", "apagados")].filter(Boolean) : [];
    return html`<div class="cfg-linha cfg-google__linha" id="linha-google-sincronizacao">
      <div class="cfg-linha__rot">
        <span class="cfg-linha__rotulo">Sincronização</span>
        <p class="cfg-ajuda">
          ${d.sync.last_sync_at ? html`Última: ${when(d.sync.last_sync_at)}${bits.length ? ` · ${bits.join(", ")}` : ""}.` : "Ainda não sincronizou."}
          ${d.calendar_sync ? html` ${plural(d.sync.events_count, "reserva", "reservas")} na agenda nos próximos ${d.sync.window_days} dias.` : nothing}
        </p>
        ${d.sync.detail ? html`<p class="cfg-erro" role="status">${d.sync.detail}</p>` : nothing}
        ${d.sync.kept_events ? html`<p class="cfg-ajuda">${plural(d.sync.kept_events, "evento antigo ficou", "eventos antigos ficaram")} na agenda e não ${d.sync.kept_events === 1 ? "é mais atualizado" : "são mais atualizados"}.</p>` : nothing}
      </div>
      <div class="cfg-linha__ctl"><span class="badge ${cls}">${label}</span></div>
    </div>`;
  }

  function whatGoes(d) {
    return html`<div class="cfg-google__oquevai">
      <div>
        <h4 class="cfg-google__sub">Vai para cada evento</h4>
        <ul class="cfg-google__itens">${d.sent.map((x) => html`<li><span class="cfg-google__sim" aria-hidden="true">+</span>${x}</li>`)}</ul>
        <h4 class="cfg-google__sub">Nunca vai</h4>
        <ul class="cfg-google__itens cfg-google__itens--nunca">${d.never_sent.map((x) => html`<li><span class="cfg-google__nao" aria-hidden="true">×</span>${x}</li>`)}</ul>
      </div>
      <div>
        <h4 class="cfg-google__sub">Prévia de um evento</h4>
        ${d.preview ? eventCard(d.preview) : html`<p class="cfg-ajuda">Nenhuma reserva nos próximos dias para mostrar.</p>`}
      </div>
    </div>`;
  }

  function nextEvents(d) {
    if (!d.calendar_sync || !d.calendar) return nothing;
    const list = s.allEvents ? s.events : s.events.slice(0, SHOWN_EVENTS);
    return html`<div class="cfg-google__proximos">
      <h4 class="cfg-google__sub" id="cfg-google-proximos">Próximos eventos na agenda</h4>
      ${s.events.length
        ? html`<ul class="cfg-google__eventos" aria-labelledby="cfg-google-proximos">
              ${list.map((e) => html`<li><span class="mono">${range(e)}</span><span>${e.title}</span></li>`)}
            </ul>
            ${s.events.length > SHOWN_EVENTS
              ? html`<button type="button" class="link-button" aria-expanded=${String(s.allEvents)} @click=${() => ((s.allEvents = !s.allEvents), draw())}>
                  ${s.allEvents ? "Mostrar menos" : `Ver todos (${s.events.length})`}
                </button>`
              : nothing}`
        : html`<p class="cfg-ajuda">Nenhuma reserva nos próximos ${d.sync.window_days} dias. Quando entrar uma, o evento aparece aqui.</p>`}
    </div>`;
  }

  function content() {
    if (s.status === "loading") return html`<p class="cfg-google__msg" role="status"><span class="raiz raiz--gira" aria-hidden="true"></span> Conferindo a conta Google…</p>`;
    if (s.status === "error") {
      return html`<div class="cfg-google__msg" role="alert">
        <p><b>Não deu para conferir a conta Google.</b> ${staffErrorMessage(s.error)}</p>
        <button type="button" class="btn btn--sm btn--outline" @click=${() => ((s.status = "loading"), draw(), load())}>Tentar de novo</button>
      </div>`;
    }
    const d = s.data;
    if (!d.connected) {
      return html`<div class="cfg-linha cfg-linha--larga cfg-google__linha">
        <div class="cfg-linha__rot">
          <span class="cfg-linha__rotulo">Nenhuma conta ligada</span>
          <p class="cfg-ajuda">Ligue uma conta Google da casa: as reservas aparecem na Agenda do Google e a folha da noite fica no Drive, sem ninguém copiar nada. O sistema só mexe na agenda escolhida e só enxerga os arquivos que ele mesmo criou.</p>
        </div>
        <div class="cfg-linha__ctl">
          <button type="button" class="btn btn--sm" aria-busy=${String(s.busy === "connect")} ?disabled=${Boolean(s.busy)} @click=${connect}>
            ${s.busy === "connect" ? "Ligando…" : "Ligar conta Google"}
          </button>
        </div>
      </div>`;
    }
    return html`<div class="cfg-linha cfg-google__linha" id="linha-google-conta">
        <div class="cfg-linha__rot">
          <span class="cfg-linha__rotulo">Conta</span>
          <p class="cfg-google__email">${d.account_email}</p>
          <p class="cfg-ajuda">Ligada por ${d.connected_by || user.name}, ${when(d.connected_at)}.</p>
        </div>
        <div class="cfg-linha__ctl">
          <button type="button" class="btn btn--sm btn--outline" ?disabled=${Boolean(s.busy)} @click=${disconnectAll}>Desligar a conta</button>
        </div>
      </div>
      ${calendarRow(d)} ${driveRow(d)} ${syncRow(d)}
      ${d.scopes.includes(SCOPE_CALENDAR) ? html`<div class="cfg-linha cfg-linha--larga cfg-google__linha">${whatGoes(d)} ${nextEvents(d)}</div>` : nothing}`;
  }

  function draw() {
    if (!alive) return;
    render(
      html`<section class="cfg-bloco cfg-google" aria-labelledby="cfg-google-titulo">
        <h3 class="cfg-bloco__titulo" id="cfg-google-titulo">Conta Google da casa</h3>
        ${content()}
      </section>`,
      host,
    );
  }

  draw();
  load();
  return () => {
    alive = false;
    controller.abort();
  };
}
