// A central de avisos do painel (FR-87, mudança de 16/10): o sino com o número de não lidos no
// alto do trilho (computador) e na barra de cima (celular), a gaveta com "Para agir", "Tudo" e
// "Resolvidos", e a faixa dos críticos no topo de toda tela até resolver. Lê a mesma lista do
// Hoje (GET /staff/alerts) e se atualiza pelo mesmo fluxo ao vivo das telas da noite.
//
// Os avisos à equipe saem só pelo painel: se ninguém estiver com ele aberto, ninguém vê. A faixa
// crítica aparece em qualquer tela assim que alguém abre. O silêncio da noite vale para o que
// não é crítico: o aviso fica em "Tudo", mas não conta no sino nem é anunciado até o fim dele.
//
// main.js chama startCentral() quando a pessoa entra e desenha bell(), drawer() e criticalBar()
// na moldura; a cada mudança daqui, onChange() redesenha.
import "./central.css";
import { openDialog } from "../../components/dialog.js";
import { toast } from "../../components/toast.js";
import { houseTime } from "../../lib/dates.js";
import { describeError } from "../../lib/errors.js";
import { html, nothing, svg } from "../../lib/html.js";
import * as api from "../../services/api/staff-avisos.js";
import { startLive } from "../areas/salao/vivo.js";
import { LEVELS, TABS, countsInBell, inTab, levelOf, noticeOf } from "./catalogo.js";

const DIALOG_ID = "avisos";

/** @type {{user: any, items: any[], unread: number, quiet: any, tab: string, open: boolean, loaded: boolean, announce: string, urgent: string, shown: Set<string>, known: Set<string>|null}} */
let s = fresh();
let live = null;
let onChange = () => {};
let handle = null;
let navigate = (path) => window.location.assign(path);

function fresh(user = null) {
  return { user, items: [], unread: 0, quiet: null, tab: "agir", open: false, loaded: false, announce: "", urgent: "", shown: new Set(), known: null };
}

const changed = () => onChange();

/** Começa a central para quem entrou (no máximo uma por vez). */
export function startCentral({ user, onChange: redraw, navigate: go }) {
  if (s.user?.id === user?.id && live) {
    s.user = user;
    return;
  }
  stopCentral();
  s = fresh(user);
  onChange = redraw || (() => {});
  if (go) navigate = go;
  live = startLive({ refresh: () => load() });
  load();
}

export function stopCentral() {
  live?.stop();
  live = null;
  handle?.close();
  handle = null;
  s = fresh();
}

/** Lê de novo agora (o Hoje chama depois de dispensar ou resolver). */
export function refreshNotices() {
  if (live) return load();
  return undefined;
}

let reading = null;
async function load() {
  if (reading) return reading;
  reading = (async () => {
    try {
      const data = await api.list();
      const before = s.known;
      s.items = data.items || [];
      s.unread = data.unread ?? s.items.filter(countsInBell).length;
      s.quiet = data.quiet || null;
      s.loaded = true;
      // o que chegou desde a última leitura e conta no sino é anunciado uma vez, sem roubar o foco
      const counted = s.items.filter(countsInBell);
      if (before) {
        const fresh = counted.filter((n) => !before.has(n.id));
        const critical = fresh.filter((n) => n.level === "critical");
        s.urgent = critical.length ? `Aviso crítico: ${critical.map((n) => n.title).join("; ")}.` : "";
        s.announce = !critical.length && fresh.length ? (fresh.length === 1 ? `Novo aviso: ${fresh[0].title}.` : `${fresh.length} avisos novos.`) : "";
      }
      s.known = new Set(s.items.filter((n) => !n.resolved_at).map((n) => n.id));
    } catch {
      // sem conexão ou sem sessão: fica a última lista; a moldura já diz o que houve
    } finally {
      reading = null;
    }
    changed();
  })();
  return reading;
}

// ---- o sino ----------------------------------------------------------------------------------

const bellIcon = svg`<svg class="sino__icone" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3a1.5 1.5 0 0 0-3 0v1.16A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z"/></svg>`;

/**
 * O botão do sino. `place` é "trilho" (computador) ou "topo" (celular).
 */
export function bell(place) {
  if (!s.user) return nothing;
  const n = s.unread;
  const label = n ? `Avisos: ${n} ${n === 1 ? "não lido" : "não lidos"}` : "Avisos: nenhum não lido";
  const critical = activeCritical().length;
  return html`<button class=${`sino sino--${place}${critical ? " is-critico" : ""}`} type="button" aria-haspopup="dialog" aria-controls=${DIALOG_ID} aria-label=${label} data-sino=${place} @click=${openDrawer}>
    ${bellIcon}<span class="sino__rotulo" aria-hidden="true">Avisos</span>
    ${n ? html`<span class="sino__conta" aria-hidden="true">${n > 99 ? "99+" : n}</span>` : nothing}
  </button>`;
}

// ---- a faixa dos críticos --------------------------------------------------------------------

const activeCritical = () => s.items.filter((n) => n.level === "critical" && !n.resolved_at);

/** No topo de toda tela, até resolver. Ninguém fecha: some quando o problema acaba. */
export function criticalBar() {
  const list = activeCritical();
  const live = html`<p class="sr-only" aria-live="polite" data-avisos-anuncio>${s.announce}</p>
    <p class="sr-only" aria-live="assertive" data-avisos-urgente>${s.urgent}</p>`;
  if (!list.length) return live;
  return html`${live}<section class="avisos-faixa" aria-label="Avisos críticos">
    <ul class="avisos-faixa__lista">
      ${list.map(
        (n) => html`<li class="avisos-faixa__item" data-aviso=${n.kind}>
          <span class="avisos-faixa__nivel">crítico</span>
          <b>${n.title}</b>
          ${n.at ? html`<span class="avisos-faixa__hora">desde <time datetime=${n.at}>${houseTime(n.at)}</time></span>` : nothing}
          <span class="avisos-faixa__acoes">${primaryAction(n, "avisos-faixa__acao")}</span>
        </li>`,
      )}
    </ul>
  </section>`;
}

// ---- a gaveta --------------------------------------------------------------------------------

function openDrawer() {
  const dialog = document.getElementById(DIALOG_ID);
  if (!(dialog instanceof HTMLDialogElement)) return;
  s.open = true;
  s.shown = new Set();
  changed();
  handle = openDialog(dialog, { onClose: closed });
  load();
  requestAnimationFrame(() => dialog.querySelector('[role="tab"][aria-selected="true"]')?.focus());
}

/** Ao fechar, o que a pessoa viu na gaveta passa a lido. */
async function closed() {
  handle = null;
  s.open = false;
  const seen = [...s.shown].filter((id) => s.items.some((n) => n.id === id && !n.read_at));
  s.shown = new Set();
  changed();
  if (!seen.length) return;
  try {
    const data = await api.markRead(seen);
    s.items = data.items || s.items;
    s.unread = data.unread ?? s.unread;
  } catch {
    // fica não lido; na próxima abertura tenta de novo
  }
  changed();
}

function close() {
  handle?.close();
}

function selectTab(key, focus = false) {
  s.tab = key;
  changed();
  if (focus) requestAnimationFrame(() => document.getElementById(`avisos-aba-${key}`)?.focus());
}

function tabKeys(event) {
  const keys = TABS.map((t) => t.key);
  const at = keys.indexOf(s.tab);
  const moves = { ArrowRight: 1, ArrowLeft: -1 };
  let next = null;
  if (event.key in moves) next = keys[(at + moves[event.key] + keys.length) % keys.length];
  else if (event.key === "Home") next = keys[0];
  else if (event.key === "End") next = keys.at(-1);
  if (!next) return;
  event.preventDefault();
  selectTab(next, true);
}

/** Tab e Shift+Tab giram dentro da gaveta. */
function trapFocus(event) {
  if (event.key !== "Tab") return;
  const focusable = [...event.currentTarget.querySelectorAll('a[href], button:not(:disabled), [tabindex="0"]')].filter((el) => el.offsetParent !== null || el === document.activeElement);
  if (!focusable.length) return;
  const head = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === head) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    head.focus();
  }
}

async function act(fn, done) {
  try {
    await fn();
    if (done) toast({ title: done });
  } catch (error) {
    const d = describeError(error);
    toast({ kind: "error", title: d.title, message: d.text });
  }
  load();
}

async function openReservationOf(n) {
  close();
  try {
    const { openReservation } = await import("../areas/reservas/drawer.js");
    openReservation(n.reservation_id, { user: s.user, onChange: () => load() });
  } catch (error) {
    console.error(error);
    navigate("/admin/reservas");
  }
}

function go(path) {
  close();
  navigate(path);
}

/** O botão que leva a resolver: a reserva, a tela certa, ou nada. */
function primaryAction(n, cls = "action") {
  const label = n.path_label || noticeOf(n.kind)?.action || "Ver";
  if (n.reservation_id) return html`<button class=${cls} type="button" @click=${() => openReservationOf(n)}>${label}</button>`;
  if (n.path) return html`<a class=${cls} href=${n.path} @click=${(e) => { e.preventDefault(); go(n.path); }}>${label}</a>`;
  return nothing;
}

function item(n) {
  if (s.open) s.shown.add(n.id);
  const level = levelOf(n.kind);
  const unread = !n.read_at && !n.resolved_at && !n.dismissed_at;
  return html`<li class=${`avisos-item avisos-item--${level}${unread ? " is-novo" : ""}`} data-aviso=${n.kind} data-id=${n.id}>
    <p class="avisos-item__cabeca">
      <span class="avisos-item__nivel">${LEVELS[level].label}</span>
      ${unread ? html`<span class="avisos-item__novo">novo</span>` : nothing}
      ${n.at ? html`<time datetime=${n.at}>${houseTime(n.at)}</time>` : nothing}
    </p>
    <h3 class="avisos-item__titulo">${n.title}</h3>
    ${n.text ? html`<p class="avisos-item__texto">${n.text}</p>` : nothing}
    ${n.silenced ? html`<p class="avisos-item__nota">Chegou no silêncio da noite: conta no sino a partir das ${s.quiet?.to || "09:00"}.</p>` : nothing}
    ${n.muted && level !== "critical" ? html`<p class="avisos-item__nota">Você não segue este aviso. Mude em "Meus avisos".</p>` : nothing}
    ${n.resolved_at ? html`<p class="avisos-item__nota">Resolvido às <time datetime=${n.resolved_at}>${houseTime(n.resolved_at)}</time>${n.resolved_by ? ` por ${n.resolved_by}` : ""}.</p>` : nothing}
    ${n.dismissed_at && !n.resolved_at ? html`<p class="avisos-item__nota">Dispensado só para você.</p>` : nothing}
    ${n.resolved_at || n.dismissed_at
      ? nothing
      : html`<div class="avisos-item__acoes">
          ${primaryAction(n, "action action--solid")}
          ${n.can_resolve ? html`<button class="action" type="button" aria-label=${`Marcar como resolvido: ${n.title}`} @click=${() => act(() => api.resolve(n.id), "Marcado como resolvido para todos")}>Marcar como resolvido</button>` : nothing}
          ${n.can_dismiss ? html`<button class="action" type="button" aria-label=${`Dispensar só para mim: ${n.title}`} @click=${() => act(() => api.dismiss(n.id), "Dispensado só para você")}>Dispensar só para mim</button>` : nothing}
        </div>`}
  </li>`;
}

const EMPTY = {
  agir: "Nada esperando você agora.",
  tudo: "Nenhum aviso de pé.",
  resolvidos: "Nada resolvido nos últimos 7 dias.",
};

function panel() {
  const list = inTab(s.items, s.tab);
  return html`<div class="avisos__painel" role="tabpanel" id="avisos-painel" aria-labelledby=${`avisos-aba-${s.tab}`} tabindex="0">
    ${!s.loaded
      ? html`<p class="avisos__vazio" role="status">Carregando os avisos…</p>`
      : list.length
        ? html`<ul class="avisos__lista">${list.map(item)}</ul>`
        : html`<p class="avisos__vazio">${EMPTY[s.tab]}</p>`}
  </div>`;
}

/** A gaveta (um <dialog> da moldura); o conteúdo só existe aberta. */
export function drawer() {
  if (!s.user) return nothing;
  const counts = Object.fromEntries(TABS.map((t) => [t.key, inTab(s.items, t.key).length]));
  return html`<dialog class="dialog dialog--drawer avisos" id=${DIALOG_ID} aria-labelledby="avisos-titulo" @keydown=${trapFocus}>
    ${s.open
      ? html`<div class="dialog__bar">
            <h2 class="dialog__title" id="avisos-titulo">Avisos</h2>
            <button class="dialog__close" type="button" data-close aria-label="Fechar os avisos">×</button>
          </div>
          <div class="avisos__corpo">
            ${s.quiet?.active ? html`<p class="avisos__silencio">Silêncio da noite até ${s.quiet.to}: só os avisos críticos contam no sino.</p>` : nothing}
            <div class="avisos__abas" role="tablist" aria-label="Avisos" @keydown=${tabKeys}>
              ${TABS.map(
                (t) => html`<button class="avisos__aba" role="tab" type="button" id=${`avisos-aba-${t.key}`} aria-selected=${String(s.tab === t.key)} aria-controls="avisos-painel" tabindex=${s.tab === t.key ? "0" : "-1"} @click=${() => selectTab(t.key)}>
                  ${t.label} <span class="avisos__aba-conta">${counts[t.key]}</span>
                </button>`,
              )}
            </div>
            ${panel()}
            <div class="avisos__pe">
              ${s.unread ? html`<button class="action" type="button" @click=${() => act(() => api.markRead([]), "Tudo marcado como lido")}>Marcar tudo como lido</button>` : nothing}
              ${s.user.session_kind === "device" ? nothing : html`<a class="avisos__prefs" href="/admin/conta/avisos" @click=${(e) => { e.preventDefault(); go("/admin/conta/avisos"); }}>Escolher o que seguir</a>`}
            </div>
          </div>`
      : nothing}
  </dialog>`;
}

/** Para os testes e o console da demonstração. */
export const centralState = () => ({ ...s, shown: [...s.shown], known: s.known ? [...s.known] : null });
