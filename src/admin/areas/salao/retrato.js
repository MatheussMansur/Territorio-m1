// A noite quando a conexão cai (histórias 6.11, 6.12 e 6.13). O aparelho da casa guarda
// nele mesmo um retrato da noite (reservas, lista de espera, salão e sessões de mesa, telefones
// mascarados e nenhum dado de saúde) no IndexedDB, gravado no máximo uma vez por minuto. Com a rede
// fora (offline.panel) ou o sistema da casa fora com a internet no ar (offline.server:
// 2 leituras seguidas falhando por rede, tempo esgotado, 502, 503 ou 504), as telas mostram esse
// retrato, só para leitura, com a hora em que foi tirado; todo botão que grava abre offline_action.
// O retrato de outra noite nunca aparece (offline_no_snapshot), e um navegador que não guarda
// nada diz storage_blocked. Quando a linha volta, o painel pede para lançar o que foi
// anotado no papel (offline_backlog). O service worker do próprio painel (public/sw-painel.js, escopo
// /admin/) só guarda esse retrato, nunca os arquivos do app.
import { levelOf } from "../../avisos/catalogo.js";
import { openDialog } from "../../../components/dialog.js";
import { houseParts, houseTime } from "../../../lib/dates.js";
import { html, nothing, render } from "../../../lib/html.js";
import { session } from "../../../lib/storage.js";

const DB = "territorio-painel";
const STORE = "retrato";
const KEY = "noite";
const MIN = 60_000;
const BACKLOG_KEY = "territorio:painel-papel";
const HEALTH_MS = 15_000;

// ---- o retrato ---------------------------------------------------------------------------

let blocked = false;
let lastSaved = 0;

function openDb(version) {
  return new Promise((resolve, reject) => {
    let request;
    try {
      request = version ? indexedDB.open(DB, version) : indexedDB.open(DB);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("blocked"));
  });
}

/** A base do painel no aparelho, com o seu depósito (criado numa versão mais nova quando falta). */
async function db() {
  const base = await openDb();
  if (base.objectStoreNames.contains(STORE)) return base;
  const next = base.version + 1;
  base.close();
  return openDb(next);
}

async function put(value) {
  const base = await db();
  await new Promise((resolve, reject) => {
    const tx = base.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  base.close();
}

async function get() {
  const base = await db();
  const value = await new Promise((resolve, reject) => {
    const tx = base.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  base.close();
  return value;
}

const clean = (r) => ({ ...r, notes: "", internal_notes: "", customer: r.customer ? { ...r.customer, phone_masked: r.customer.phone_masked || "" } : r.customer });

/**
 * Guarda o salão da noite no aparelho: no máximo uma vez por minuto (ou na hora com force), as
 * reservas, a lista de espera, o salão e as sessões, com a data da noite e a hora
 * da leitura; o retrato de outra noite é substituído.
 */
export async function keepPicture(floor, { force = false } = {}) {
  if (!floor?.date || !floor?.day) return;
  if (!force && Date.now() - lastSaved < MIN) return;
  lastSaved = Date.now();
  const picture = {
    date: floor.date,
    saved_at: floor.server_time || new Date().toISOString(),
    floor: { ...floor, reservations: (floor.reservations || []).map(clean) },
  };
  try {
    const worker = navigator.serviceWorker?.controller;
    if (worker && worker.scriptURL.endsWith("/sw-painel.js")) worker.postMessage({ type: "retrato", picture });
    else await put(picture);
    blocked = false;
  } catch {
    blocked = true;
  }
}

/** O retrato desta noite, ou null (nenhum, ou de outra noite pelo relógio do aparelho). */
export async function readPicture() {
  try {
    const picture = await get();
    blocked = false;
    if (!picture) return null;
    if (picture.date !== houseParts(new Date()).date && picture.date !== houseParts(new Date(Date.now() - 6 * 60 * MIN)).date) return null;
    return picture;
  } catch {
    blocked = true;
    return null;
  }
}

export const storageBlocked = () => blocked;

// ---- a conexão ---------------------------------------------------------------------------

const listeners = new Set();
let serverDown = false;
let failures = 0;
let goods = 0;
let healthTimer = null;
let healthCheck = null;

const DOWN = new Set([502, 503, 504]);

/** "online", "offline" (offline.panel) ou "server" (offline.server). */
export function connection() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
  return serverDown ? "server" : "online";
}

function emit() {
  for (const fn of listeners) fn(connection());
}

/** Escuta a conexão; devolve o jeito de parar. */
export function onConnection(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function markBacklog() {
  session.set(BACKLOG_KEY, Date.now());
}

/**
 * Toda leitura de uma tela da noite diz como foi. Duas falhas seguidas por rede, tempo esgotado,
 * 502, 503 ou 504 com o navegador dizendo que está online põem o painel em offline.server; lá uma
 * leitura leve a cada 15 s, e duas boas seguidas tiram ele de lá.
 */
export function report(ok, error = null) {
  if (ok) {
    failures = 0;
    if (!serverDown) return;
    goods += 1;
    if (goods >= 2) {
      serverDown = false;
      goods = 0;
      clearInterval(healthTimer);
      markBacklog();
      emit();
    }
    return;
  }
  const counts = error?.type === "network" || error?.type === "timeout" || DOWN.has(error?.status);
  if (!counts || connection() === "offline") return;
  failures += 1;
  goods = 0;
  if (failures >= 2 && !serverDown) {
    serverDown = true;
    clearInterval(healthTimer);
    healthTimer = setInterval(() => healthCheck?.(), HEALTH_MS);
    emit();
  }
}

/** A leitura leve usada em offline.server (a tela passa a sua). */
export function setHealthCheck(fn) {
  healthCheck = fn;
}

if (typeof window !== "undefined") {
  window.addEventListener("offline", emit);
  window.addEventListener("online", () => {
    markBacklog();
    emit();
  });
}

// ---- o que as telas mostram --------------------------------------------------------------

/** "A conexão voltou · Lance agora o que foi anotado no papel", até lançar ou dispensar. */
export const backlogPending = () => Boolean(session.get(BACKLOG_KEY, 0));
export const clearBacklog = () => session.remove(BACKLOG_KEY);

/** A faixa no alto de uma tela da noite quando ela mostra o retrato. */
export function offlineBand(mode, picture) {
  if (mode === "online") return nothing;
  const at = picture ? houseTime(picture.saved_at) : null;
  const old = picture && Date.now() - new Date(picture.saved_at).getTime() > 30 * MIN;
  const lead = mode === "server" ? "O sistema da casa está fora." : "Sem conexão.";
  // o nível é o do catálogo de avisos (offline_server e offline_panel são críticos, FR-87)
  return html`<div class="notice notice--alert retrato-faixa" role="status" data-modo=${mode === "server" ? "offline.server" : "offline.panel"} data-nivel=${levelOf(mode === "server" ? "offline_server" : "offline_panel")}>
    <p><b>${lead}</b> ${at ? `Você vê a noite como estava às ${at}.` : "Não há retrato desta noite neste aparelho."}
      ${old ? ` Reservas feitas depois das ${at} não aparecem aqui.` : ""} Nada grava até a conexão voltar.</p>
    <a class="btn btn--sm btn--outline" href="/admin/salao/folha">Imprimir a folha</a>
  </div>`;
}

/** offline_no_snapshot e storage_blocked: a noite não está neste aparelho. */
export function noPicture(mode) {
  const lead = mode === "server" ? "O sistema da casa está fora" : "Sem conexão";
  return html`<div class="area__vazio" role="alert">
    <span class="raiz raiz--atencao" aria-hidden="true"></span>
    <p><b>${lead}, e este aparelho não tem o retrato desta noite.</b>
      ${blocked ? "Este navegador não guarda nada no aparelho (modo privado ou dados bloqueados)." : ""} Use a folha impressa e anote as chegadas com a hora.</p>
  </div>`;
}

/** offline_action: um botão que grava, sem a linha. */
export function offlineAction(mode = connection()) {
  const dialog = document.createElement("dialog");
  dialog.className = "dialog dialog--confirm";
  dialog.setAttribute("aria-labelledby", "offline-acao-titulo");
  document.body.append(dialog);
  render(
    html`<div class="dialog__body">
      <h2 id="offline-acao-titulo">${mode === "server" ? "O sistema da casa está fora" : "Sem conexão agora"}</h2>
      <p>Isso não grava enquanto a conexão não voltar. Anote no papel o que aconteceu, com a hora, e lance depois em "Lançar do papel".</p>
      <div class="dialog__actions">
        <a class="btn btn--outline btn--sm" href="/admin/salao/folha">Imprimir a folha</a>
        <button class="btn btn--sm" type="button" data-close>Entendi</button>
      </div>
    </div>`,
    dialog,
  );
  openDialog(dialog, { onClose: () => dialog.remove() });
  dialog.querySelector("[data-close]")?.focus();
}

/** Roda uma gravação só com a linha no ar; senão diz por que não. */
export function guardWrite(work) {
  return (...args) => {
    const mode = connection();
    if (mode !== "online") {
      offlineAction(mode);
      return undefined;
    }
    return work(...args);
  };
}

/** A faixa depois que a linha voltou: lançar o que foi anotado no papel. */
export function backlogBand(onDismiss) {
  if (!backlogPending() || connection() !== "online") return nothing;
  return html`<div class="notice retrato-faixa" role="status" data-modo="offline_backlog" data-nivel=${levelOf("offline_backlog")}>
    <p><b>A conexão voltou.</b> Lance agora o que foi anotado no papel, com a hora real.</p>
    <div class="cluster">
      <a class="btn btn--sm" href="/admin/salao/papel">Lançar do papel</a>
      <button class="btn btn--sm btn--outline" type="button" @click=${() => (clearBacklog(), onDismiss?.())}>Dispensar</button>
    </div>
  </div>`;
}

// ---- o painel como app -------------------------------------------------------------------

let deferredInstall = null;
const installListeners = new Set();

/** O manifesto, o service worker e a oferta do navegador para instalar o painel (UX-DR-138). */
export function setUpPanelApp() {
  if (typeof document === "undefined" || document.querySelector('link[rel="manifest"][data-painel]')) return;
  const link = document.createElement("link");
  link.rel = "manifest";
  link.href = "/manifest-painel.webmanifest";
  link.dataset.painel = "";
  document.head.append(link);
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstall = event;
    installListeners.forEach((fn) => fn(true));
  });
  window.addEventListener("appinstalled", () => {
    deferredInstall = null;
    installListeners.forEach((fn) => fn(false));
  });
  // a demonstração roda no service worker do próprio mock (escopo /): o do painel tomaria o lugar dele
  if (import.meta.env?.VITE_API_MODE !== "mock" && "serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw-painel.js", { scope: "/admin/" }).catch(() => {});
  }
}

export const canInstall = () => Boolean(deferredInstall);
export function onInstallable(fn) {
  installListeners.add(fn);
  return () => installListeners.delete(fn);
}
export async function installPanel() {
  if (!deferredInstall) return false;
  deferredInstall.prompt();
  const choice = await deferredInstall.userChoice.catch(() => null);
  deferredInstall = null;
  installListeners.forEach((fn) => fn(false));
  return choice?.outcome === "accepted";
}
