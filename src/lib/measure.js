// "Medição": como o site é usado, só depois de um sim no aviso (FR-68). Própria da casa: os
// eventos vão para a API da própria casa (POST /measure), que os guarda no Brasil; sem terceiros,
// sem nome, sem telefone, sem texto livre. Cada evento leva os números de visitante e de visita dos
// cookies trt_vis / trt_visita (aleatórios, veja cookie-registry.js), a página, o idioma e
// poucos valores pequenos: os passos da reserva, o dia da semana e o horário escolhidos, de onde a visita veio.
// Recusar ou retirar o consentimento para na hora e apaga os números e a fila não enviada.
import { allowed, get, onConsent, remove, set } from "./cookies.js";
import * as api from "../services/api/index.js";
import { uuid } from "./uuid.js";

export const EVENTS = [
  "page_view",
  "menu_tab",
  "book_party",
  "book_day",
  "book_time",
  "book_details",
  "book_code_sent",
  "book_done",
  "book_error",
  "click_whatsapp",
  "click_maps",
  "click_waze",
  "theme_change",
];

const QUEUE = "trt:medida";
const SAFE = /^[\w:./+-]{0,40}$/; // códigos, nunca frases: nada digitado pela pessoa passa
let queue = [];
let timer = null;
let started = false;

/** Fica só com números, booleanos e códigos curtos; o resto é descartado, não enviado. */
export function clean(data = {}) {
  const out = {};
  for (const [key, value] of Object.entries(data).slice(0, 8)) {
    if (!/^[a-z_]{1,24}$/.test(key)) continue;
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "boolean") out[key] = value;
    else if (typeof value === "string" && SAFE.test(value)) out[key] = value;
  }
  return out;
}

/** De onde a visita veio: a marca ?de= dos links da própria casa, ou o host do referrer. */
export function origin(location = globalThis.location, referrer = globalThis.document?.referrer) {
  const mark = new URLSearchParams(location?.search || "").get("de");
  if (mark && /^[a-z0-9-]{1,20}$/.test(mark)) return mark;
  try {
    const host = referrer ? new URL(referrer).hostname : "";
    if (!host || host === location?.hostname) return "direto";
    return host.replace(/^www\./, "").slice(0, 40);
  } catch {
    return "direto";
  }
}

function ids() {
  let visitor = get("trt_vis");
  if (!visitor) {
    visitor = uuid();
    set("trt_vis", visitor);
  }
  let visit = get("trt_visita");
  if (!visit) visit = uuid();
  set("trt_visita", visit); // renovável: mais 30 minutos a cada evento
  return { visitor, visit };
}

function persist() {
  set(QUEUE, queue.slice(-50));
}

export function flush({ leaving = false } = {}) {
  clearTimeout(timer);
  timer = null;
  if (!allowed("measurement")) {
    queue = []; // recusada, retirada ou desligada pela casa: nada fica esperando para ser enviado
    return;
  }
  if (!queue.length) return;
  const body = { ...ids(), events: queue };
  queue = [];
  remove(QUEUE);
  api.measure.send(body, { leaving }).catch(() => {}); // perdido: a medição nunca atrapalha
}

/** Registra um evento quando a medição é permitida; senão não faz nada. */
export function track(name, data = {}) {
  if (!allowed("measurement") || !EVENTS.includes(name)) return false;
  queue.push({
    name,
    at: new Date().toISOString(),
    page: location.pathname,
    locale: document.documentElement.dataset.locale || "pt",
    data: clean(data),
  });
  persist();
  if (!timer) timer = setTimeout(flush, 4000);
  return true;
}

function pageView() {
  const dark = document.documentElement.dataset.theme === "escuro" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  track("page_view", { origin: origin(), theme: dark ? "escuro" : "claro", width: innerWidth < 861 ? "celular" : "computador" });
}

/** Começa nas páginas que o carregam; liga (ou para) assim que o visitante decide. */
export function startMeasuring() {
  if (started) return;
  started = true;
  queue = get(QUEUE) || [];
  if (allowed("measurement")) pageView();
  onConsent((choice) => {
    if (choice.measurement) pageView();
    else queue = [];
  });
  addEventListener("pagehide", () => flush({ leaving: true }));
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush({ leaving: true }));
  // os links externos que importam para a casa
  document.addEventListener("click", (event) => {
    const link = event.target.closest?.("a[href]");
    if (!link) return;
    const href = link.getAttribute("href");
    if (href.startsWith("https://wa.me/")) track("click_whatsapp", { place: link.closest("[id]")?.id || "pagina" });
    else if (href.includes("google.com/maps")) track("click_maps");
    else if (href.includes("waze.com")) track("click_waze");
  });
}
