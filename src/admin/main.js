// O painel da equipe: página e roteador próprios, o trilho de ferro no computador e a barra de baixo
// no celular. GET /staff/me diz quem entrou; o menu mostra só o que esse perfil abre, e um
// endereço fora disso mostra a tela de "proibido". O servidor decide, a tela só esconde.
//
// Sem sessão o painel mostra a entrada (src/admin/auth/): e-mail, senha e código; os
// links de uso único; num aparelho da casa pareado, os nomes e o PIN, ou o que impede o aparelho
// de seguir. Uma sessão que acaba no meio é recuperada por cima da tela (identity.js), e no
// aparelho da casa a pessoa é chamada de novo depois da inatividade do aparelho, mantendo a tela.
import "../styles/main.css";
import { loadAreaNames } from "./area-names.js";
import "./admin.css";
import { boot } from "../app/boot.js";
import { confirmAction } from "../components/confirm.js";
import { openDialog } from "../components/dialog.js";
import { describeError } from "../lib/errors.js";
import { $, html, nothing, render } from "../lib/html.js";
import { session as tabStorage } from "../lib/storage.js";
import { setCsrfToken, setRecovery } from "../services/api/client.js";
import { staff } from "../services/api/index.js";
import * as authApi from "../services/api/staff-auth.js";
import { IS_MOCK, marca, raiz } from "./auth/comum.js";
import * as device from "./auth/device.js";
import { mountLogin } from "./auth/entrada.js";
import { mountForgot, mountLink, mountReset } from "./auth/links.js";
import { deviceProblem, mountPairing } from "./auth/pareamento.js";
import { mountLock } from "./auth/pin.js";
import { mountSessions } from "./auth/sessoes.js";
import { mountTotp } from "./auth/totp.js";
import { bell, criticalBar, drawer, startCentral, stopCentral } from "./avisos/central.js";
import { mountPreferences } from "./avisos/preferencias.js";
import { forgetIdentity, signInAgain } from "./identity.js";
import { ENTRY, GROUPS, HOME, PAIRING, PERSONAL, areaFor, canDo, canOpen, entryFor, itemsFor, normalizePath, personalFor, subpathOf } from "./nav.js";

// Cada área mora no seu próprio módulo, src/admin/areas/<key>.js, carregado quando ela abre:
// export async function mount(container, { user, path, sub, navigate }) → limpeza opcional.
const MODULES = import.meta.glob("./areas/*.js");

const root = document.getElementById("painel");
const TITLE = "Território · Painel";
const ROLE = { owner: "dono", manager: "gerente", floor: "recepção" };
const IDLE_KEY = "territorio:demo-inatividade";
const ASSISTANT = "/admin/primeiro-acesso";

/**
 * loading · out (a entrada) · lock (aparelho da casa, ninguém dentro) · device (o aparelho não pode seguir)
 * · mfa (entrou, os dois passos ainda desligados) · in · error
 * @type {{status: string, user?: any, error?: any, device?: any, problem?: any, warning?: string, lost?: string|null}}
 */
let state = { status: "loading" };
let moreMenu = null;
// o evento desta noite com lista na porta (história 6.8): { id, title } ou null; lido junto com o salão
let door = { event: null, at: 0 };
let focusAfterMore = false; // uma navegação fechou o "Mais": o título dela recebe o foco quando a janela some

const focusTitle = () => $(".area__titulo", root)?.focus();
const first = (name) => String(name || "").trim().split(/\s+/)[0];

// ---- telas ---------------------------------------------------------------------------------

function loadingScreen() {
  return html`<main id="conteudo" class="estado" aria-busy="true">
    <div class="estado__caixa" role="status">
      ${raiz("raiz--gira")}
      <p>Abrindo o painel…</p>
    </div>
  </main>`;
}

/** A moldura da entrada: a placa no ferro e a tela do momento embaixo dela. */
function entryFrame() {
  return html`<main id="conteudo" class="entrada ${state.status === "lock" ? "entrada--trava" : ""}">
    <div class="entrada__marca">${marca()}</div>
    <div class="entrada__tela" id="tela"></div>
  </main>`;
}

function errorScreen(error) {
  // uma frase da casa, nunca o texto cru do servidor
  const d = describeError(error);
  return html`<main id="conteudo" class="estado">
    <div class="estado__caixa" role="alert">
      ${raiz("raiz--atencao")}
      <h1 class="estado__titulo">Não deu para abrir o painel</h1>
      <p><b>${d.title}.</b> ${d.text}</p>
      <button class="btn" type="button" @click=${retry}>Tentar de novo</button>
    </div>
  </main>`;
}

// O título da área, depois o corpo, que o próprio módulo da área preenche (mountArea abaixo).
function areaScreen(area) {
  return html`<header class="area__cabeca">
      <h1 class="area__titulo" tabindex="-1">${area.label}</h1>
    </header>
    <div class="area__corpo" id="area-corpo"></div>`;
}

const placeholder = () => html`<div class="area__vazio">
  ${raiz()}
  <p>Esta parte chega nas próximas etapas.</p>
</div>`;

const areaLoading = () => html`<div class="area__vazio" role="status">${raiz("raiz--gira")}<p>Carregando…</p></div>`;

// Uma área que falha mostra isso só no seu lugar, com uma saída; o resto do painel funciona.
const areaError = (again) => html`<div class="area__vazio" role="alert">
  ${raiz("raiz--atencao")}
  <p><b>Essa parte não abriu.</b> O resto do painel continua funcionando.</p>
  <button class="btn" type="button" @click=${again}>Tentar de novo</button>
</div>`;

/** @type {{path: string, el: Element, host: Element, cleanup: (null|(() => void))} | null} */
let mounted = null;

function unmountArea() {
  try {
    mounted?.cleanup?.();
  } catch (error) {
    console.error(error);
  }
  // um módulo ainda terminando a primeira carga desenha num lugar que já não está na página
  mounted?.host.remove();
  mounted = null;
}

/** Preenche o corpo da área pelo seu módulo, uma vez por endereço; um módulo que dá erro fica contido. */
async function mountArea() {
  const corpo = $("#area-corpo", root);
  const path = normalizePath(window.location.pathname);
  if (!corpo) return unmountArea();
  if (mounted && mounted.path === path && mounted.el === corpo) return;
  unmountArea();
  // cada abertura ganha o seu próprio lugar dentro do corpo da área
  const host = document.createElement("div");
  host.className = "area__modulo";
  corpo.replaceChildren(host);
  const token = (mounted = { path, el: corpo, host, cleanup: null });
  const own = personalFor(path);
  if (own) {
    token.cleanup = own.key === "avisos" ? mountPreferences(host, { user: state.user }) : mountSessions(host, { user: state.user, onSignedOut: signedOut });
    return;
  }
  const area = areaFor(path);
  const loader = MODULES[`./areas/${area.key}.js`];
  if (!loader) return render(placeholder(), host);
  render(areaLoading(), host);
  try {
    const module = await loader();
    if (mounted !== token) return;
    const cleanup = await module.mount(host, { user: state.user, path, sub: subpathOf(path), navigate });
    if (mounted === token) token.cleanup = typeof cleanup === "function" ? cleanup : null;
    else if (typeof cleanup === "function") cleanup();
  } catch (error) {
    if (mounted !== token) return;
    console.error(error);
    render(areaError(() => {
      mounted = null;
      mountArea();
    }), host);
  }
}

function forbiddenScreen() {
  return html`<div class="area__vazio area__vazio--proibido">
    ${raiz("raiz--atencao")}
    <h1 class="area__titulo" tabindex="-1">Essa parte é de outro perfil da equipe</h1>
    <p>Se precisar, peça ao dono ou ao gerente.</p>
    <a class="btn" href=${HOME}>Voltar ao Hoje</a>
  </div>`;
}

// ---- a entrada: uma tela montada por vez ----------------------------------------------------

/** @type {{key: string, el: Element, cleanup: (null|(() => void))} | null} */
let screen = null;

function unmountScreen() {
  try {
    screen?.cleanup?.();
  } catch (error) {
    console.error(error);
  }
  screen = null;
}

/** Qual tela da entrada este endereço e este estado mostram. */
function entryScreen() {
  if (state.status === "lock") return { screen: "lock" };
  if (state.status === "device") return { screen: "device" };
  if (state.status === "mfa") return { screen: "mfa" };
  if (state.lost) return { screen: "pairing" };
  const route = entryFor(window.location.pathname);
  if (route) return route;
  // um aparelho esperando o dono continua mostrando o seu código
  return device.mark()?.status === "pending" ? { screen: "pairing", token: null } : { screen: "login", token: null };
}

function mountScreen() {
  const el = $("#tela", root);
  if (!el) return unmountScreen();
  const route = entryScreen();
  const key = `${state.status}:${route.screen}:${route.token ?? ""}`;
  if (screen && screen.key === key && screen.el === el) return;
  unmountScreen();
  const paired = device.mark()?.status === "approved";
  const mounts = {
    login: () => mountLogin(el, { onSignedIn: signedIn, paired, onPin: () => load() }),
    forgot: () => mountForgot(el),
    reset: () => mountReset(el, { token: route.token }),
    setup: () => mountLink(el, { kind: "setup", token: route.token, onDone: signedIn }),
    invite: () => mountLink(el, { kind: "invite", token: route.token, onDone: signedIn }),
    // aprovado: o aparelho abre a sua própria sessão (uma nova, mesmo depois de perder a chave), depois os nomes
    pairing: () =>
      mountPairing(el, {
        onApproved: async () => {
          state = await openDevice();
          draw();
        },
        replaces: state.lost || null,
      }),
    lock: () => mountLock(el, { device: state.device, warning: state.warning, onEnter: () => load(), onPersonal: () => navigate(ENTRY) }),
    device: () => render(deviceProblem(state.problem, { onRetry: () => load(), onRepair: repair }), el),
    mfa: () =>
      mountTotp(el, {
        title: "Ligue a verificação em duas etapas",
        intro: `${first(state.user?.name)}, antes de abrir o painel, ligue a verificação com o aplicativo de códigos do celular. Ela protege a casa mesmo se alguém descobrir a sua senha.`,
        onDone: () => load(),
      }),
  };
  const cleanup = mounts[route.screen]?.();
  screen = { key, el, cleanup: typeof cleanup === "function" ? cleanup : null };
  requestAnimationFrame(() => el.querySelector(".entrada__titulo, .trava__titulo")?.focus());
}

// ---- a moldura -----------------------------------------------------------------------------

const link = (item, active, cls) =>
  html`<a class=${cls} href=${item.path} aria-current=${active?.key === item.key ? "page" : nothing}>${item.label}</a>`;

/** Quem entrou, com "Minhas sessões" e "Sair" (ou "Trocar de pessoa" no aparelho da casa). */
function person(user, cls) {
  const onDevice = user.session_kind === "device";
  const here = normalizePath(window.location.pathname);
  return html`<div class=${cls}>
    <p class=${`${cls}-quem`}>
      <b>${user.name || user.email}</b>
      <span>${ROLE[user.role] || ""}${onDevice && user.device ? ` · ${user.device.name}` : ""}</span>
    </p>
    <ul class=${`${cls}-acoes`}>
      ${onDevice
        ? html`<li><button class=${`${cls}-item`} type="button" @click=${switchPerson}>Trocar de pessoa</button></li>`
        : html`${PERSONAL.map((p) => html`<li><a class=${`${cls}-item`} href=${p.path} aria-current=${here === p.path ? "page" : nothing}>${p.label}</a></li>`)}
            <li><button class=${`${cls}-item`} type="button" @click=${signOut}>Sair</button></li>`}
    </ul>
  </div>`;
}

function rail(items, active, user) {
  return html`<nav class="trilho" aria-label="Painel">
    <a class="trilho__marca" href=${HOME} aria-label="Território · Hoje">${marca()}</a>
    ${bell("trilho")}
    ${GROUPS.map((group) => {
      const inGroup = items.filter((i) => i.group === group.key);
      if (!inGroup.length) return nothing;
      return html`<ul class="trilho__grupo" aria-label=${group.label}>
        ${inGroup.map((item) => html`<li>${link(item, active, "trilho__item")}</li>`)}
      </ul>`;
    })}
    ${person(user, "trilho__pessoa")}
  </nav>`;
}

function bar(items, active, user) {
  const inBar = items.filter((i) => i.bar);
  const rest = items.filter((i) => !i.bar);
  const restActive = rest.some((i) => i.key === active?.key) || Boolean(personalFor(window.location.pathname));
  return html`<nav class="barra" aria-label="Atalhos do painel">
      <ul class="barra__lista">
        ${inBar.map((item) => html`<li>${link(item, active, "barra__item")}</li>`)}
        <li>
          <button class="barra__item barra__mais ${restActive ? "is-dentro" : ""}" type="button" aria-haspopup="dialog" aria-controls="mais" @click=${openMore}>
            Mais
          </button>
        </li>
      </ul>
    </nav>
    <dialog class="mais" id="mais" aria-labelledby="mais-titulo" @keydown=${trapFocus}>
      <div class="mais__caixa">
        <div class="mais__topo">
          <h2 class="mais__titulo" id="mais-titulo">Mais</h2>
          <button class="mais__fechar" type="button" data-close aria-label="Fechar">×</button>
        </div>
        ${rest.length || door.event
          ? html`<ul class="mais__lista">
              ${doorLink(items)} ${rest.map((item) => html`<li>${link(item, active, "mais__item")}</li>`)}
            </ul>`
          : nothing}
        ${person(user, "mais__pessoa")}
      </div>
    </dialog>`;
}

/** Numa noite de evento com lista na porta, "Porta do evento" fica a um toque no "Mais" (história 6.8). */
function doorLink(items) {
  if (!door.event || !items.some((i) => i.key === "salao")) return nothing;
  const href = `/admin/salao/porta?evento=${encodeURIComponent(door.event.id)}`;
  const here = normalizePath(window.location.pathname) === "/admin/salao/porta";
  return html`<li>
    <a class="mais__item mais__porta" href=${href} aria-current=${here ? "page" : nothing}>Porta do evento</a>
  </li>`;
}

/** Lê o evento desta noite pelo salão, no máximo a cada 5 minutos; uma falha deixa o menu como estava. */
async function refreshDoor() {
  if (state.status !== "in" || Date.now() - door.at < 5 * 60_000) return;
  door.at = Date.now();
  try {
    const { floor } = await import("../services/api/staff-salao.js");
    const night = await floor();
    const event = night?.day?.event;
    const next = event && ["list", "mixed"].includes(event.booking_mode) ? { id: event.id, title: event.title || event.name || "" } : null;
    if (JSON.stringify(next) === JSON.stringify(door.event)) return;
    door.event = next;
    if (state.status === "in") draw();
  } catch {
    // sem salão para este perfil ou sem conexão: sem atalho
  }
}

/** Tab e Shift+Tab dão a volta dentro do "Mais" em vez de sair para o navegador. */
function trapFocus(event) {
  if (event.key !== "Tab") return;
  const focusable = [...event.currentTarget.querySelectorAll("a[href], button:not(:disabled)")];
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

function openMore() {
  const dialog = $("#mais", root);
  if (!dialog) return;
  moreMenu = openDialog(dialog, {
    onClose: () => {
      moreMenu = null;
      if (focusAfterMore) focusTitle(); // depois que openDialog devolveu o foco ao "Mais"
      focusAfterMore = false;
    },
  });
  dialog.querySelector(".mais__item, .mais__pessoa-item")?.focus();
}

function shell(user) {
  const path = normalizePath(window.location.pathname);
  const own = personalFor(path);
  const area = own || areaFor(path);
  // as áreas que o dono escolheu para este perfil vêm com a sessão; sem elas, o padrão
  const allowed = own ? user.session_kind !== "device" : canOpen(user.role, path, user.areas ?? undefined);
  const items = itemsFor(user.role, user.areas ?? undefined);
  const active = allowed && !own ? area : null; // em "proibido" nenhum item fica aceso
  document.title = allowed ? `${area.label} · ${TITLE}` : TITLE;
  return html`<a class="skip-link" href="#conteudo">Pular para o conteúdo</a>
    <div class="painel">
      ${rail(items, active, user)}
      <header class="topo">${marca()}${bell("topo")}</header>
      <main id="conteudo" class="area">
        ${criticalBar()}
        ${state.warning ? html`<p class="aviso aviso--alerta painel__aviso" role="status">${state.warning}</p>` : nothing}
        ${allowed ? areaScreen(area) : forbiddenScreen()}
      </main>
      ${bar(items, active, user)}
      ${drawer()}
    </div>`;
}

// ---- estado e rotas ------------------------------------------------------------------------

function draw() {
  if (state.status !== "in") document.title = TITLE;
  const screens = { loading: loadingScreen, error: () => errorScreen(state.error), in: () => shell(state.user) };
  render((screens[state.status] || entryFrame)(), root);
  // a central de avisos vive enquanto alguém está dentro (FR-87)
  if (state.status === "in") startCentral({ user: state.user, onChange: redrawFrame, navigate });
  else stopCentral();
  if (state.status === "in") {
    unmountScreen();
    mountArea();
  } else {
    unmountArea();
    if (state.status === "loading" || state.status === "error") unmountScreen();
    else mountScreen();
  }
  watchIdle();
}

/**
 * Só a moldura de novo (o sino, a faixa crítica, a gaveta de avisos), quando a central de avisos
 * muda: a área mantém o que tem na tela, mesmo quando mudou o próprio endereço (uma gaveta
 * aberta em /admin/reservas/<id>), porque o módulo dela não é montado de novo aqui.
 */
function redrawFrame() {
  if (state.status === "in") render(shell(state.user), root);
}

const clockWarning = (skew) =>
  `O relógio deste aparelho está ${Math.round(Math.abs(skew))} min ${skew > 0 ? "adiantado" : "atrasado"}. Acerte a data e a hora antes que ele pare de entrar.`;

function deviceState(error) {
  if (error?.type === "device_key_lost") return { status: "out", lost: device.mark()?.device_id || "perdido" };
  if (["webcrypto_unavailable", "device_signature_invalid", "device_not_approved"].includes(error?.type)) return { status: "device", problem: error };
  return { status: "error", error };
}

/** O aparelho da casa sozinho: a sessão dele, assinada; depois os nomes e o PIN. */
async function openDevice() {
  try {
    const opened = await device.openSession();
    return { status: "lock", device: opened.device, warning: Math.abs(opened.skew) > 2 ? clockWarning(opened.skew) : "" };
  } catch (error) {
    return deviceState(error);
  }
}

/** No aparelho da casa sem ninguém dentro: a tela de bloqueio, com os dados do próprio aparelho. */
async function lockState() {
  try {
    const current = await authApi.session();
    const skew = device.skewMinutes(current.server_time);
    return { status: "lock", device: current.device, warning: Math.abs(skew) > 2 ? clockWarning(skew) : "" };
  } catch (error) {
    return deviceState(error);
  }
}

/** A pessoa pediu a entrada pessoal neste endereço (não os nomes do aparelho da casa). */
const wantsPersonal = () => ["login", "forgot", "reset", "setup", "invite"].includes(entryFor(window.location.pathname)?.screen);

async function load() {
  const warning = state.warning || "";
  state = { status: "loading" };
  draw();
  const signing = await device.startSigning();
  try {
    const user = await staff.me();
    state = user.mfa_required ? { status: "mfa", user } : { status: "in", user, warning: user.session_kind === "device" ? warning : "" };
    if (state.status === "in") await loadAreaNames();
    if (state.status === "in" && entryFor(window.location.pathname)) window.history.replaceState(null, "", HOME + window.location.search);
    if (state.status === "in") await toAssistant(user);
    door = { event: null, at: 0 };
  } catch (error) {
    if (error?.type === "no_active_person") state = await lockState();
    // um aparelho pareado sem a sua chave não consegue assinar: as checagens do próprio aparelho dizem por quê, em ordem
    else if (String(error?.type).startsWith("device_")) state = !signing && device.mark()?.status === "approved" ? await openDevice() : deviceState(error);
    else if (error?.status === 401) state = device.mark()?.status === "approved" && !wantsPersonal() ? await openDevice() : { status: "out" };
    else state = { status: "error", error };
  }
  draw();
  refreshDoor();
}

/**
 * Depois do primeiro acesso do dono, entrar no painel abre o passo a passo do primeiro uso até ele
 * ser terminado ou deixado de lado (história 3.12). Só na entrada (Hoje), nunca por cima de outro endereço.
 */
async function toAssistant(user) {
  if (!canDo(user.role, "PUT /staff/onboarding", user.areas ?? undefined) || !user.onboarding_pending || normalizePath(window.location.pathname) !== HOME) return;
  try {
    const { onboarding } = await import("../services/api/staff-configuracoes.js");
    const progress = await onboarding.get();
    if (!progress.done) window.history.replaceState(null, "", ASSISTANT + window.location.search);
  } catch {
    // o Hoje lista o que falta de qualquer jeito (história 5.2)
  }
}

/** Depois de entrar, o painel abre onde a pessoa ia (a partir do próprio endereço da entrada: Hoje). */
function signedIn() {
  if (entryFor(window.location.pathname)) window.history.replaceState(null, "", HOME + window.location.search);
  load();
}

/** Um endereço desconhecido dentro do painel volta para o Hoje (mantendo ?papel= e ?mock= para o mock). */
function settleAddress() {
  const path = window.location.pathname;
  if (!areaFor(path) && !entryFor(path) && !personalFor(path)) window.history.replaceState(null, "", HOME + window.location.search);
}

/** Depois de um "Tentar de novo" que deu certo o botão some: o título da área recebe o foco. */
async function retry() {
  await load();
  if (state.status === "in") focusTitle();
}

/** Redesenha a área e leva o foco ao título dela (depois que o "Mais" fecha, quando estava aberto). */
function showArea() {
  focusAfterMore = Boolean(moreMenu);
  moreMenu?.close();
  settleAddress();
  // nas telas do aparelho, um link para a entrada pessoal abre ela
  if (["lock", "device"].includes(state.status) && entryFor(window.location.pathname)) state = { status: "out" };
  draft = false;
  draw();
  // o título da nova tela recebe o foco, para o leitor de tela ouvir onde chegou
  if (state.status === "in" && !focusAfterMore) focusTitle();
  refreshPerson();
}

function navigate(path) {
  if (normalizePath(path) !== normalizePath(window.location.pathname)) window.history.pushState(null, "", path);
  showArea();
}

/**
 * O perfil e as áreas da pessoa valem na próxima requisição (histórias 1.9 e 1.15): cada passo no
 * painel pergunta de novo, e o menu (ou uma área "proibida") acompanha o que mudou.
 */
async function refreshPerson() {
  if (state.status !== "in") return;
  refreshDoor();
  try {
    const user = await staff.me();
    if (state.status !== "in") return;
    const sig = (u) => JSON.stringify([u.id, u.name, u.role, u.areas, u.session_kind]);
    if (sig(user) === sig(state.user)) return;
    if (user.id !== state.user.id) return load();
    state = { ...state, user };
    draw();
  } catch {
    // uma sessão perdida é recuperada pela recuperação da API abaixo; o resto espera o próximo passo
  }
}

// ---- sair ----------------------------------------------------------------------------------

/** De volta à entrada, sem ?papel= no endereço (ele faria o mock entrar de novo). */
function toEntry() {
  const url = new URL(window.location.href);
  url.searchParams.delete("papel");
  window.history.replaceState(null, "", ENTRY + url.search);
}

/** "Sair": a sessão acaba no servidor e o painel volta para a entrada. */
async function signOut() {
  moreMenu?.close();
  try {
    await authApi.logout();
  } catch {
    // já está fora
  }
  await signedOut();
}

async function signedOut() {
  forgetIdentity();
  setCsrfToken(null);
  toEntry();
  await load();
}

/** Parear de novo (um aparelho revogado). */
async function repair() {
  await device.unpair();
  window.history.pushState(null, "", PAIRING);
  state = { status: "out" };
  draw();
}

// ---- o aparelho da casa: inatividade e "Trocar de pessoa" ---------------------------------

let lastActivity = Date.now();
let idleTimer = null;
let draft = false; // algo digitado nesta tela desde que ela abriu ou foi enviada
let asking = null;

const idleLimit = () => {
  const demo = Number(tabStorage.get(IDLE_KEY));
  return demo > 0 ? demo * 1000 : (state.user?.device?.idle_min ?? 15) * 60_000;
};

function watchIdle() {
  const on = state.status === "in" && state.user?.session_kind === "device";
  if (on && !idleTimer) {
    lastActivity = Date.now();
    idleTimer = setInterval(() => {
      if (!asking && Date.now() - lastActivity > idleLimit()) lockNow();
    }, 1000);
  } else if (!on && idleTimer) {
    clearInterval(idleTimer);
    idleTimer = null;
  }
}

async function lockNow() {
  const who = askWho();
  try {
    await authApi.pinLogout();
  } catch {
    // o servidor derruba a pessoa sozinho depois do mesmo tempo
  }
  return who;
}

function switchPerson() {
  moreMenu?.close();
  lockNow();
}

/**
 * "Quem está usando?" por cima da tela, que fica onde estava. Resolve true quando alguém
 * entrou e a tela segue (a chamada que falhou é enviada de novo no nome dela), false quando
 * o que estava na tela foi descartado ou a pessoa foi para a entrada pessoal.
 */
function askWho() {
  if (asking) return asking;
  const before = state.user;
  asking = new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "trava-janela";
    dialog.setAttribute("aria-labelledby", "trava-titulo");
    document.body.append(dialog);
    // o PIN não pode ser pulado com Esc
    dialog.addEventListener("cancel", (event) => event.preventDefault());
    let done = false;
    let cleanup = null;
    const finish = (value) => {
      if (done) return;
      done = true;
      cleanup?.();
      dialog.close();
      dialog.remove();
      if (!document.querySelector("dialog[open]")) document.documentElement.classList.remove("is-locked");
      asking = null;
      lastActivity = Date.now();
      resolve(value);
    };
    cleanup = mountLock(dialog, {
      device: before?.device,
      overlay: true,
      onEnter: async (opened) => {
        let keep = true;
        if (before && opened.user && opened.user.id !== before.id && draft) {
          keep = await confirmAction({
            title: `Continuar o que ${first(before.name)} deixou?`,
            message: `Se continuar, o que está na tela é gravado em nome de ${first(opened.user.name)}. Se não, a tela volta ao começo.`,
            confirmLabel: "Continuar",
            cancelLabel: "Descartar",
          });
        }
        try {
          state = { ...state, user: await staff.me() };
        } catch {
          // o próximo passo pergunta de novo
        }
        if (!keep) {
          draft = false;
          unmountArea();
        }
        finish(keep);
        draw();
      },
      onPersonal: () => {
        finish(false);
        state = { status: "out" };
        navigate(ENTRY);
      },
    });
    dialog.showModal();
    document.documentElement.classList.add("is-locked");
  });
  return asking;
}

for (const type of ["pointerdown", "keydown", "wheel", "touchstart"]) {
  document.addEventListener(type, () => (lastActivity = Date.now()), { capture: true, passive: true });
}
document.addEventListener(
  "input",
  (event) => {
    if (state.status === "in" && event.target instanceof Element && !event.target.closest(".trava-janela, .entrar-de-novo, .identidade")) draft = true;
  },
  { capture: true },
);
document.addEventListener("submit", () => (draft = false));

// ---- uma sessão que acaba no meio ---------------------------------------------------------

setRecovery(async (error) => {
  if (state.status !== "in") return false;
  if (error.type === "no_active_person") return askWho();
  if (error.type === "device_not_approved" || error.type === "device_signature_invalid") {
    state = deviceState(error);
    draw();
    return false;
  }
  if (error.status !== 401) return false;
  // a entrada abre por cima da tela; a chamada vai de novo depois dela, com o que foi digitado
  const opened = await signInAgain({ email: state.user?.email || "" });
  if (!opened) {
    await signedOut();
    return false;
  }
  if (opened.user?.id !== state.user?.id) {
    await load();
    return false;
  }
  return true;
});

document.addEventListener("click", (event) => {
  const a = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (!a || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (a.target || a.hasAttribute("download") || a.origin !== window.location.origin) return;
  if (!/^\/admin(\/|$)/.test(a.pathname) || a.hash) return;
  // um endereço com consulta (o ?papel= da demonstração, ?relogio=…) abre a página de novo
  if (a.search || a.closest(".demo-bar")) return;
  event.preventDefault();
  navigate(a.pathname);
});

window.addEventListener("popstate", showArea);

boot(async () => {
  if (IS_MOCK) {
    const idle = new URLSearchParams(window.location.search).get("inatividade");
    if (idle !== null) tabStorage.set(IDLE_KEY, Number(idle) || 0);
  }
  settleAddress();
  await load();
  // o perfil e as áreas também acompanham uma mudança feita enquanto ninguém se mexe (a cada minuto)
  setInterval(refreshPerson, 60_000);
});
