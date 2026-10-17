// Escolha de cookies (FR-66, FR-67): "Aceitar" e "Recusar" do mesmo tamanho, nada marcado antes,
// "Escolher" abre as categorias de cookie-registry.js. A escolha fica no cookie trt_consent
// e vai para a API sem dados pessoais. "Lembrar de mim" e "Medição" só
// começam depois de um sim explícito; dizer não depois apaga o que eles guardaram.
import { html, nothing, render } from "../lib/html.js";
import { consent, currentVersion, measurementOffered, readCookie, saveConsent } from "../lib/cookies.js";
import { t } from "../lib/strings.js";
import { uuid } from "../lib/uuid.js";
import * as api from "../services/api/index.js";

/** A versão em que a escolha é registrada: a da política, ou a do texto mais novo do aviso (configurações). */
export const bannerVersion = () => currentVersion();
// a medição só é oferecida enquanto a casa a mantém ligada (Configurações › Cookies)
const optional = () => (measurementOffered() ? ["remember", "measurement"] : ["remember"]);
let liveText = null;

/** O texto do aviso como a casa escreveu em Configurações › Cookies ({pt, es, en}), quando a API manda. */
export function setBannerText(text) {
  liveText = text && typeof text === "object" ? text : null;
}

export const readChoice = () => consent();

/** O id aleatório de uma escolha anterior (mesmo de uma política antiga): um navegador, um registro. */
function previousId() {
  try {
    return JSON.parse(readCookie("trt_consent") || "null")?.id || null;
  } catch {
    return null;
  }
}

function store(picked) {
  const choice = saveConsent({ ...picked, id: previousId() || uuid() });
  api.consents
    .send({
      consent_id: choice.id,
      banner_version: bannerVersion(),
      remember: choice.remember,
      measurement: choice.measurement,
      locale: document.documentElement.dataset.locale || "pt",
    })
    .catch(() => {});
  return choice;
}

/**
 * Liga ou desliga uma categoria opcional a partir de outro ponto da página (a caixa "lembrar
 * de mim neste aparelho" da reserva), mantendo o resto da escolha; registrada como no aviso.
 */
export function setCategory(category, value) {
  const current = consent() || { remember: false, measurement: false };
  return store({ remember: current.remember, measurement: current.measurement, [category]: value });
}

/**
 * Mostra o aviso quando não há escolha para esta versão da política (ou quando pedido pelo
 * rodapé, já aberto nas categorias). onChoice(choice) roda depois de cada decisão.
 */
export function cookieBanner({ force = false, onChoice = () => {} } = {}) {
  if (!force && consent()) return;
  let host = document.querySelector(".cookies");
  if (!host) {
    host = document.createElement("div");
    host.className = "cookies";
    document.body.append(host);
  }
  let choosing = force;
  const picked = { remember: consent()?.remember ?? false, measurement: consent()?.measurement ?? false };
  const locale = document.documentElement.dataset.locale || "pt";
  const policy = `${locale === "pt" ? "" : `/${locale}`}/privacidade/#cookies`;
  const all = (value) => Object.fromEntries(optional().map((c) => [c, value]));
  const text = liveText?.[locale] || liveText?.pt || t("site.cookiesText");

  const close = (choice) => {
    const saved = store(choice);
    render(nothing, host);
    host.remove();
    onChoice(saved);
  };

  const draw = () =>
    render(
      html`<section class="cookies__panel" role="region" aria-labelledby="cookies-title">
        <h2 class="cookies__title" id="cookies-title">${t("site.cookiesTitle")}</h2>
        <p class="cookies__text">${text} <a href=${policy}>${t("site.cookiesPolicy")}</a></p>
        ${choosing
          ? html`<fieldset class="cookies__choices">
              <legend class="sr-only">${t("site.cookiesChoose")}</legend>
              <label class="cookies__choice"><input type="checkbox" checked disabled /><span><b>${t("site.cookiesNecessary")}</b> ${t("site.cookiesNecessaryText")}</span></label>
              ${optional().map(
                (c) => html`<label class="cookies__choice"
                  ><input type="checkbox" name=${c} .checked=${picked[c]} @change=${(e) => (picked[c] = e.target.checked)} /><span
                    ><b>${t(`site.cookies_${c}`)}</b> ${t(`site.cookies_${c}Text`)}</span
                  ></label
                >`,
              )}
            </fieldset>`
          : nothing}
        <div class="cookies__actions">
          <button class="btn btn--sm" type="button" @click=${() => close(all(true))}>${t("site.cookiesAccept")}</button>
          <button class="btn btn--sm" type="button" @click=${() => close(all(false))}>${t("site.cookiesReject")}</button>
          ${choosing
            ? html`<button class="btn btn--sm btn--outline" type="button" @click=${() => close({ ...picked })}>${t("site.cookiesSave")}</button>`
            : html`<button
                class="btn btn--sm btn--outline"
                type="button"
                @click=${() => {
                  choosing = true;
                  draw();
                }}
              >
                ${t("site.cookiesChoose")}
              </button>`}
        </div>
      </section>`,
      host,
    );
  draw();
}
