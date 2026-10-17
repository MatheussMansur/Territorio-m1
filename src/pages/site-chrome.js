// O que toda página pública faz em cima do HTML impresso: a troca de tema, a escolha de cookies
// e, depois de um sim, a medição de como o site é usado. Configurações › Cookies chega
// com GET /house: um texto mais novo do aviso pergunta de novo, e a medição desligada a para.
import { cookieBanner, readChoice, setBannerText } from "../components/cookie-banner.js";
import { allowed, applySettings, remove, set } from "../lib/cookies.js";
import { startMeasuring, track } from "../lib/measure.js";

const THEMES = ["auto", "escuro", "claro"];

export function themeToggle() {
  const button = document.querySelector("[data-theme-toggle]");
  if (!button) return;
  const label = (mode) => button.dataset[`label${mode === "auto" ? "Auto" : mode === "escuro" ? "Dark" : "Light"}`];
  let mode = document.documentElement.dataset.theme || "auto";
  const apply = () => {
    if (mode === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = mode;
    button.setAttribute("aria-label", label(mode));
    button.title = label(mode);
    if (mode === "auto") remove("trt_tema");
    else set("trt_tema", mode); // uma escolha que a pessoa fez: necessary, 12 meses
  };
  button.hidden = false;
  apply();
  button.addEventListener("click", () => {
    mode = THEMES[(THEMES.indexOf(mode) + 1) % THEMES.length];
    apply();
    track("theme_change", { theme: mode });
  });
}

const mark = (choice) => {
  document.documentElement.dataset.measurement = choice?.measurement ? "on" : "off";
  document.documentElement.dataset.remember = choice?.remember ? "on" : "off";
};

export function cookies() {
  mark(readChoice());
  startMeasuring();
  cookieBanner({ onChoice: mark });
  const reopen = document.querySelector("[data-cookies-open]");
  if (!reopen) return;
  reopen.hidden = false;
  reopen.addEventListener("click", () => cookieBanner({ force: true, onChoice: mark }));
}

/** As configurações de cookies da casa, ao vivo: o aviso volta quando o texto dele tem versão mais nova. */
export function cookieSettings(settings) {
  setBannerText(settings.banner_text);
  const askAgain = applySettings(settings);
  mark(readChoice());
  if (!allowed("measurement")) document.documentElement.dataset.measurement = "off";
  if (askAgain) cookieBanner({ onChoice: mark });
}
