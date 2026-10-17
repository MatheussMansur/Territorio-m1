// /entrar: entra em "Minhas reservas" com um código no WhatsApp, sem senha (história 7.8), ou com o
// Google (7.9). O número segue as regras da reserva ("Confere?", outros países recusados),
// o código vai depois da checagem contra robôs, e "Lembrar este aparelho" mantém a sessão por 90
// dias (senão ela acaba quando o navegador fecha). Uma conta Google sem WhatsApp confirma o
// número aqui antes de reservar. Dentro do Instagram, o Google se recusa a entrar: a página diz como
// abrir no navegador em vez disso.
import "../styles/main.css";
import "../styles/site.css";
import "./cliente.css";
import { boot } from "../app/boot.js";
import { otpInput } from "../components/otp.js";
import { phoneField } from "../components/phone-field.js";
import { isInAppBrowser, whatsappUrl } from "../lib/cliente.js";
import { html, nothing, render } from "../lib/html.js";
import { COUNTRIES, formatPhone } from "../lib/phone.js";
import { getLocale, setLocale, t } from "../lib/strings.js";
import { turnstileToken } from "../lib/turnstile.js";
import * as api from "../services/api/index.js";
import { IS_MOCK, catalog, catalogKey, copyText, localPath, noticeView, staticModeView, varsOf } from "./cliente-ui.js";
import { cookies, themeToggle } from "./site-chrome.js";

const query = new URLSearchParams(location.search);
const safePath = (p) => (p && p.startsWith("/") && !p.startsWith("//") && !p.includes("\\") ? p : null);
const back = safePath(query.get("volta") || query.get("return_to")) || localPath("/minhas-reservas/");

const s = {
  house: null,
  me: null,
  phase: "numero", // numero, codigo
  phone: null,
  remember: true,
  resendAt: 0,
  codeAt: 0,
  notArrived: false,
  busy: false,
  notice: null,
  copied: false,
};
let root;
let whatsapp;
let field = null;
let otp = null;
const wired = new WeakSet();

const needsPhone = () => Boolean(s.me && s.me.phone_verified === false);
const wa = () => (s.house?.whatsapp ? whatsappUrl(s.house.whatsapp, t("cliente.wa.signin")) : whatsapp);
const googleOn = () => Boolean(s.house?.booking?.google_login);

function googleHref() {
  if (IS_MOCK) return `${localPath("/entrar/")}?google=exemplo&volta=${encodeURIComponent(back)}`;
  return api.auth.googleStartUrl(back);
}

async function sendCode(event) {
  event?.preventDefault();
  const form = root.querySelector("form.conta__form");
  if (s.phase === "numero") {
    const e164 = field?.validate();
    if (!e164) return;
    s.phone = e164;
    s.remember = form?.lembrar ? form.lembrar.checked : s.remember;
  }
  s.busy = true;
  s.notice = null;
  draw();
  try {
    const sent = await api.auth.sendOtp(s.phone, { turnstileToken: await turnstileToken() });
    s.resendAt = Date.now() + (sent?.resend_after_s ?? 30) * 1000;
    s.codeAt = Date.now();
    s.notArrived = false;
    s.phase = "codigo";
  } catch (error) {
    const key = catalogKey(error, "otp");
    s.notice = { key, vars: varsOf(error), retry: key === "turnstile_failed" ? sendCode : null, wa: ["rate_limited.otp", "rate_limited.otp_house", "phone_country_unsupported", "server", "network", "timeout"].includes(key) ? wa() : null };
  }
  s.busy = false;
  draw();
  if (s.phase === "codigo") requestAnimationFrame(() => root.querySelector(".otp__input")?.focus());
}

async function verify(code) {
  s.busy = true;
  s.notice = null;
  draw();
  try {
    if (needsPhone()) await api.auth.changePhone({ phone: s.phone, code });
    else await api.auth.verifyOtp({ phone: s.phone, code, rememberDevice: s.remember, locale: getLocale() });
    // o cookie precisa ficar: um navegador que bloqueia cookies perde a sessão na hora
    const me = await api.auth.me().catch(() => null);
    if (!me || navigator.cookieEnabled === false) {
      s.notice = { key: "cookies_blocked", wa: wa() };
      s.busy = false;
      return draw();
    }
    location.assign(back);
    return;
  } catch (error) {
    const key = catalogKey(error, "otp");
    s.notice = { key, vars: varsOf(error), retry: key === "gone.otp" ? sendCode : null, retryLabel: key === "gone.otp" ? t("book.resend") : null, wa: key === "phone_in_use" ? wa() : null };
    otp?.clear();
  }
  s.busy = false;
  draw();
}

async function googleSample(choice) {
  s.busy = true;
  draw();
  try {
    const answer = await api.auth.googleSampleReturn({ choice, returnTo: back });
    const to = new URL(answer.location, location.origin);
    // uma recusa volta para a entrada, onde o código ainda está; a página de reserva
    // trata isso ela mesma (google_failed ao lado do código que ela estava esperando)
    if (to.searchParams.has("auth_error") && !/\/reservar\//.test(to.pathname)) location.assign(`${localPath("/entrar/")}?auth_error=${encodeURIComponent(to.searchParams.get("auth_error"))}&volta=${encodeURIComponent(back)}`);
    else location.assign(answer.location);
  } catch (error) {
    s.busy = false;
    s.notice = { key: catalogKey(error), wa: wa() };
    draw();
  }
}

function googleView() {
  if (!googleOn()) return nothing;
  if (isInAppBrowser()) {
    const entry = catalog("google_in_app_browser");
    return html`<div class="notice aviso" role="status" data-aviso="google_in_app_browser">
      <strong class="aviso__titulo">${entry.title}</strong>
      <span class="aviso__texto">${entry.text}</span>
      <span class="aviso__acoes">
        <button class="btn btn--sm btn--outline" type="button" @click=${async () => ((s.copied = await copyText(location.href)), draw())}>${t("cliente.receipt.copyLink")}</button>
      </span>
      ${s.copied ? html`<span role="status">${t("cliente.receipt.copied")}</span>` : nothing}
    </div>`;
  }
  return html`<div class="conta__divisa">${t("cliente.signin.or")}</div>
    <a class="btn btn--outline btn--lg" href=${googleHref()} data-google>${t("cliente.google")}</a>`;
}

function sampleView() {
  return html`<div class="google-demo" role="group" aria-labelledby="google-demo-titulo">
    <p id="google-demo-titulo"><b>${t("cliente.demo.title")}</b> ${t("cliente.signin.sample")}</p>
    <div class="aviso__acoes">
      <button class="btn btn--sm" type="button" ?disabled=${s.busy} @click=${() => googleSample("conta")}>${t("cliente.signin.sampleLinked")}</button>
      <button class="btn btn--sm btn--outline" type="button" ?disabled=${s.busy} @click=${() => googleSample("nova")}>${t("cliente.signin.sampleNew")}</button>
      <button class="btn btn--sm btn--outline" type="button" ?disabled=${s.busy} @click=${() => googleSample("cancelou")}>${t("cliente.signin.sampleCancel")}</button>
    </div>
  </div>`;
}

function numberView() {
  return html`<form class="conta__form" novalidate @submit=${sendCode}>
    <div class="field" data-phone>
      <label class="field__label" for="entrar-tel">${t("book.whatsapp")}</label>
      <div class="phone">
        <select class="field__input" aria-label=${t("book.country")}>${COUNTRIES.map((c) => html`<option value=${c.id}>${c.label}</option>`)}</select>
        <input class="field__input" id="entrar-tel" name="tel" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="(45) 99999-0000" aria-describedby="entrar-tel-ajuda" required>
      </div>
      <p class="field__help" id="entrar-tel-ajuda">${t("cliente.signin.phoneHelp")}</p>
    </div>
    ${needsPhone() ? nothing : html`<label class="check"><input type="checkbox" name="lembrar" .checked=${s.remember}> ${t("cliente.signin.remember")}</label>`}
    <div class="reserva__acoes"><button class="btn btn--lg" type="submit" ?disabled=${s.busy}>${t("book.sendCode")}</button></div>
  </form>`;
}

function codeView() {
  const wait = Math.max(0, Math.ceil((s.resendAt - Date.now()) / 1000));
  return html`<div class="conta__form">
    <p class="prose">${t("book.codeSentTo", { phone: formatPhone(s.phone) })}</p>
    <div class="field">
      <label class="field__label" for="entrar-codigo">${t("book.codeLabel")}</label>
      <div class="otp" data-otp>
        <input class="otp__input" id="entrar-codigo" inputmode="numeric" autocomplete="one-time-code" ?disabled=${s.busy} @input=${() => (s.codeAt = Date.now())}>
        <div class="otp__boxes" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span></div>
      </div>
      ${wait > 0 ? html`<p class="field__help">${catalog("otp_resend_wait", { seconds: wait }).title}. ${catalog("otp_resend_wait", { seconds: wait }).text}</p>` : nothing}
    </div>
    ${s.notArrived && !s.notice ? noticeView({ key: "otp_not_arrived", status: true, wa: wa() }) : nothing}
    <div class="reserva__acoes">
      <button class="btn btn--outline" type="button" @click=${() => ((s.phase = "numero"), (s.notice = null), draw())}>${t("book.changeNumber")}</button>
      <button class="btn btn--outline" type="button" ?disabled=${wait > 0 || s.busy} @click=${() => sendCode()}>${wait > 0 ? t("book.resendIn", { s: wait }) : t("book.resend")}</button>
    </div>
  </div>`;
}

function draw() {
  const sample = IS_MOCK && query.get("google") === "exemplo";
  render(
    html`${noticeView(s.notice)}
      ${sample ? sampleView() : nothing}
      <section class="conta__secao" aria-labelledby="entrar-titulo">
        <h2 id="entrar-titulo">${needsPhone() ? t("cliente.signin.phoneTitle") : t("cliente.signin.title")}</h2>
        <p class="prose">${needsPhone() ? t("cliente.signin.phoneLead") : t("cliente.signin.lead")}</p>
        ${s.phase === "codigo" ? codeView() : numberView()}
        ${needsPhone() || s.phase === "codigo" ? (s.notArrived ? googleView() : nothing) : googleView()}
      </section>
      <p class="reserva__dica">${t("cliente.signin.noAccount")} <a class="link" href=${localPath("/reservar/")}>${t("receipt.bookAgain")}</a> · <a class="link" href=${wa()} rel="noopener">${t("common.whatsappHouse")}</a></p>`,
    root,
  );
  const phone = root.querySelector("[data-phone]");
  if (phone && !wired.has(phone)) {
    wired.add(phone);
    field = phoneField(phone, { whatsappFor: wa });
  }
  const box = root.querySelector("[data-otp]");
  if (box && !wired.has(box)) {
    wired.add(box);
    otp = otpInput(box, { onComplete: verify });
  }
}

boot(async () => {
  setLocale(document.documentElement.lang);
  themeToggle();
  cookies();
  const host = document.querySelector("[data-cliente]");
  if (!host) return;
  root = host.querySelector("[data-cliente-corpo]");
  whatsapp = host.dataset.whatsapp;
  root.replaceChildren();
  const off = staticModeView(whatsapp);
  if (off) return render(off, root);
  const [house, me] = await Promise.allSettled([api.house.getHouse(), api.auth.me()]);
  s.house = house.status === "fulfilled" ? house.value : null;
  s.me = me.status === "fulfilled" ? me.value : null;
  if (s.me && !needsPhone() && !query.has("auth_error")) {
    location.replace(back);
    return;
  }
  if (query.has("auth_error")) s.notice = { key: "google_failed", retry: () => location.assign(googleHref()) };
  else if (needsPhone() || query.has("needs_phone")) s.notice = { key: "google_needs_phone", status: true };
  else if (query.get("motivo") === "sessao") s.notice = { key: "session_expired", status: true };
  else if (navigator.cookieEnabled === false) s.notice = { key: "cookies_blocked", wa: wa() };
  draw();
  setInterval(() => {
    if (s.phase !== "codigo") return;
    if (!s.notArrived && Date.now() - s.codeAt > 60_000 && !root.querySelector(".otp__input")?.value) s.notArrived = true;
    draw();
  }, 1000);
});
