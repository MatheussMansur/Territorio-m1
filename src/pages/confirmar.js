// /confirmar/<token> (ou ?t=): o link de ação da mensagem do WhatsApp (história 7.14). Abrir
// só lê (GET /links/{token}); "Confirmo", "Vou atrasar um pouco" e "Não vou mais" são
// POSTs, podem mudar até o horário, e o aviso de atraso aplica os minutos extras uma vez só.
// "Mudar" leva a Minhas reservas na reserva certa. A página fala o idioma da reserva.
import "../styles/main.css";
import "../styles/site.css";
import "./cliente.css";
import { boot } from "../app/boot.js";
import { confirmAction } from "../components/confirm.js";
import { mountSeals } from "../components/seal.js";
import { pastDeadline, whatsappUrl } from "../lib/cliente.js";
import { html, nothing, render } from "../lib/html.js";
import { getLocale, setLocale, t } from "../lib/strings.js";
import * as api from "../services/api/index.js";
import { catalog, catalogKey, localPath, noticeView, receiptBlock, sayView, staticModeView, varsOf } from "./cliente-ui.js";
import { linkToken } from "./link-token.js";
import { cookies, themeToggle } from "./site-chrome.js";

const s = { token: null, view: null, house: null, page: null, notice: null, busy: false, said: null, expanded: {} };
let root;
let whatsapp;

const wa = (text = "") => (s.house?.whatsapp ? whatsappUrl(s.house.whatsapp, text) : whatsapp);
const now = () => new Date(s.view?.server_time || Date.now());

async function answer(value) {
  const r = s.view.reservation;
  if (value === "no") {
    const late = pastDeadline(now(), r.can_cancel_until); // o próprio prazo ainda está no horário
    if (late && s.house?.booking?.customer_can_cancel_late === false) {
      s.notice = { key: "outside_cancel_window", wa: wa(t("cliente.mine.waCancel", { code: r.code })) };
      return draw();
    }
    const ok = await confirmAction({
      title: t("receipt.cancelTitle"),
      message: [t("receipt.cancelMessage", { code: r.code }), late ? t("cliente.mine.cancelLate") : ""].filter(Boolean).join(" "),
      confirmLabel: t("cliente.link.no"),
      danger: true,
    });
    if (!ok) return;
  }
  s.busy = true;
  s.notice = null;
  draw();
  try {
    s.view = await api.links.answer(s.token, value);
    const done = s.view.reservation;
    s.notice = { status: true, text: value === "no" ? (done.canceled_late ? t("cliente.mine.canceledLate") : t("cliente.link.doneNo")) : value === "late" ? t("cliente.link.doneLate") : t("cliente.link.doneYes") };
  } catch (error) {
    const key = catalogKey(error, "link");
    const look = { href: s.view.reservation.receipt_url, label: t("cliente.link.see") };
    s.notice = {
      key,
      vars: varsOf(error),
      links: ["invalid_transition", "conflict.link_used"].includes(key) ? [look] : key === "read_only_link" ? [{ href: localPath("/minhas-reservas/"), label: t("cliente.receipt.mine") }] : [],
      wa: ["outside_cancel_window", "invalid_transition.late", "invalid_transition.late_off", "invalid_transition", "server", "network", "timeout"].includes(key) ? wa() : null,
      retry: ["server", "network", "timeout"].includes(key) ? () => answer(value) : null,
    };
    // a reserva pode ter mudado: lê de novo (ler nunca muda nada)
    s.view = await api.links.view(s.token).catch(() => s.view);
  }
  s.busy = false;
  draw();
  root.querySelector(".aviso")?.focus();
}

function pageView() {
  const entry = catalog(s.page.key);
  return html`<div class="conta__secao">
    <h2>${entry.title}</h2>
    <p class="prose">${entry.text}</p>
    <div class="reserva__acoes">
      ${s.page.key === "gone.link" ? html`<a class="btn" href=${localPath("/reservar/")}>${t("receipt.bookAgain")}</a>` : nothing}
      <a class=${`btn${s.page.key === "gone.link" ? " btn--outline" : ""}`} href=${wa()} rel="noopener">${t("common.whatsappHouse")}</a>
    </div>
  </div>`;
}

function draw() {
  if (s.page) return render(pageView(), root);
  if (!s.view) return render(s.notice ? noticeView(s.notice) : html`<div class="skeleton skeleton--block" aria-label=${t("common.loading")}></div>`, root);
  const r = s.view.reservation;
  const rules = s.house?.booking || {};
  const active = ["pending", "confirmed"].includes(r.status);
  const beforeTime = now() < new Date(`${r.date}T${r.time}:00-03:00`);
  // "Vou atrasar" fica até o fim da espera; o relógio da casa decide o último segundo
  const lateWindow = now() <= new Date(`${r.date}T${r.tolerance_until || r.time}:00-03:00`);
  const open = active && (beforeTime || lateWindow);
  const lateOn = rules.late_notice_enabled !== false && (rules.extra_tolerance_min ?? 10) > 0;
  const chosen = s.view.answered;
  render(
    html`${noticeView(s.notice)}
      ${receiptBlock(r, { house: s.house, say: (key) => ((s.said = key), draw()), expanded: s.expanded, toggle: (k) => ((s.expanded = { ...s.expanded, [k]: !s.expanded[k] }), draw()) })}
      ${sayView(s.said)}
      ${open
        ? html`<section class="conta__secao" aria-labelledby="resposta-titulo">
            <h2 id="resposta-titulo">${t("cliente.link.question")}</h2>
            ${chosen ? html`<p class="prose">${t("cliente.link.yourAnswer", { answer: t(`cliente.link.${chosen}`) })} ${t("cliente.link.canChange")}</p>` : nothing}
            <div class="resposta">
              ${beforeTime ? html`<button class="btn" type="button" aria-pressed=${String(chosen === "yes")} ?disabled=${s.busy} @click=${() => answer("yes")}>${t("cliente.link.yes")}</button>` : nothing}
              ${lateOn ? html`<button class="btn btn--outline" type="button" aria-pressed=${String(chosen === "late")} ?disabled=${s.busy} @click=${() => answer("late")}>${t("cliente.link.late")}</button>` : nothing}
              ${beforeTime ? html`<button class="btn btn--outline" type="button" ?disabled=${s.busy} @click=${() => answer("no")}>${t("cliente.link.no")}</button>` : nothing}
              <a class="btn btn--outline" href=${`${localPath("/minhas-reservas/")}?reserva=${encodeURIComponent(r.code)}&mudar=1`}>${t("cliente.link.change")}</a>
            </div>
          </section>`
        : html`<p class="prose">${["canceled", "no_show", "completed", "declined", "expired"].includes(r.status) ? t(`cliente.link.closed.${r.status}`) : t("cliente.link.past")}</p>`}
      <p class="reserva__dica"><a class="link" href=${wa()} rel="noopener">${t("common.whatsappHouse")}</a></p>`,
    root,
  );
  mountSeals(root);
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
  draw();
  s.token = linkToken();
  if (!s.token) {
    s.page = { key: "not_found.link" };
    return draw();
  }
  try {
    const [view, house] = await Promise.all([api.links.view(s.token), api.house.getHouse().catch(() => null)]);
    // a página fala o idioma da reserva
    const want = view.reservation.locale || "pt";
    if (want !== getLocale() && !new URLSearchParams(location.search).has("lingua")) {
      const path = location.pathname.replace(/^\/(es|en)(?=\/)/, "");
      location.replace(`${localPath(path, want)}${location.search}${location.search ? "&" : "?"}lingua=${want}`);
      return;
    }
    s.view = view;
    s.house = house;
  } catch (error) {
    const key = catalogKey(error, "link");
    if (["gone.link", "not_found.link"].includes(key)) s.page = { key };
    else s.notice = { key, retry: () => location.reload(), wa: wa() };
  }
  draw();
});
