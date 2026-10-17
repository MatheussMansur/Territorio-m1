// Avisos que confirmam uma ação ou contam uma falha. Os de sucesso saem depois de 4 s (7 s com uma
// ação), e o tempo para enquanto o ponteiro ou o foco está no aviso; os de erro ficam
// até serem fechados. No máximo três de cada vez, e um erro nunca é empurrado para fora.
// Os avisos são desenhados num lugar só e lidos em voz alta por duas regiões ao vivo que existem antes
// da primeira mensagem, para os leitores de tela não perderem nada.
import { html, render } from "../lib/html.js";
import { t } from "../lib/strings.js";
import { sealTemplate } from "./seal.js";

let region;
let polite;
let assertive;

function liveRegion(level) {
  const el = document.createElement("div");
  el.className = "sr-only";
  el.setAttribute("aria-live", level);
  el.setAttribute("aria-atomic", "true");
  return el;
}

function ensureRegion() {
  if (region?.isConnected) return region;
  region = document.createElement("div");
  region.className = "toasts";
  polite = liveRegion("polite");
  assertive = liveRegion("assertive");
  document.body.append(region, polite, assertive);
  return region;
}

if (typeof document !== "undefined" && document.body) ensureRegion();

export function toast({ title, message = "", kind = "success", action, duration } = {}) {
  const host = ensureRegion();
  const isError = kind === "error";
  const items = () => [...host.children];
  while (items().length >= 3) {
    const oldest = items().find((el) => !el.classList.contains("toast--error"));
    if (!oldest) break;
    oldest.remove();
  }
  const opener = document.activeElement;
  const item = document.createElement("div");
  item.className = isError ? "toast toast--error" : "toast";
  host.append(item);

  let timer = null;
  let remaining = duration ?? (isError ? null : action ? 7000 : 4000);
  let startedAt = 0;
  const leave = () => {
    clearTimeout(timer);
    // o foco que estava dentro do aviso volta para onde veio
    if (item.contains(document.activeElement) && opener instanceof HTMLElement && opener.isConnected) opener.focus();
    item.classList.add("is-leaving");
    setTimeout(() => item.remove(), 200);
  };
  const start = () => {
    if (!remaining || timer) return;
    startedAt = Date.now();
    timer = setTimeout(leave, remaining);
  };
  const pause = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    remaining = Math.max(1000, remaining - (Date.now() - startedAt));
  };
  item.addEventListener("mouseenter", pause);
  item.addEventListener("mouseleave", start);
  item.addEventListener("focusin", pause);
  item.addEventListener("focusout", (event) => !item.contains(event.relatedTarget) && start());

  const onAction = () => {
    action?.onClick?.();
    leave();
  };
  let button = null;
  if (action) button = html`<button type="button" class="toast__action" @click=${onAction}>${action.label}</button>`;
  else if (isError) button = html`<button type="button" class="toast__action" @click=${leave}>${t("common.close")}</button>`;

  render(
    html`<span class="seal">${sealTemplate()}</span>
      <div><b>${title}</b>${message ? html`<p>${message}</p>` : null}</div>
      ${button}`,
    item,
  );
  const voice = isError ? assertive : polite;
  voice.textContent = "";
  setTimeout(() => (voice.textContent = [title, message].filter(Boolean).join(". ")), 50);
  start();
  return { close: leave };
}
