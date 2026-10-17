// A página do comprovante: o token no link mostra a reserva (ler nunca muda nada).
// Ela diz até quando a mesa espera (ou até quando a casa responde, ou o lugar na
// fila), com o dia e a hora da casa mesmo num celular em outro fuso, e as ações:
// arquivo de calendário, compartilhar, como chegar e minhas reservas (história 7.6). Quem reservou, com a sessão
// aberta neste celular, também pode dizer "vou atrasar um pouco" e cancelar, pelas regras da casa.
import "../styles/main.css";
import "../styles/site.css";
import "./cliente.css";
import { boot } from "../app/boot.js";
import { receiptKind } from "../components/booking-receipt.js";
import { confirmAction } from "../components/confirm.js";
import { mountSeals } from "../components/seal.js";
import { pastDeadline } from "../lib/cliente.js";
import { html, nothing, render } from "../lib/html.js";
import { setLocale, t } from "../lib/strings.js";
import * as api from "../services/api/index.js";
import { catalog, catalogKey, localPath, noticeView, receiptBlock, sayView, staticModeView, varsOf } from "./cliente-ui.js";
import { linkToken } from "./link-token.js";
import { cookies, themeToggle } from "./site-chrome.js";

const ACTIVE = new Set(["pending", "confirmed", "waitlisted", "offered"]);
const s = { view: null, house: null, mine: false, page: null, notice: null, busy: false, said: null, expanded: {} };
let root;
let whatsapp;

const now = () => new Date(s.view?.server_time || Date.now());

async function cancel() {
  const r = s.view.reservation;
  const late = pastDeadline(now(), r.can_cancel_until);
  const rules = s.house?.booking || {};
  const message = [t("receipt.cancelMessage", { code: r.code }), late ? t("cliente.mine.cancelLate") : ""].filter(Boolean).join(" ");
  const ok = await confirmAction({ title: t("receipt.cancelTitle"), message, confirmLabel: t("receipt.cancel"), danger: true });
  if (!ok) return;
  await act(() => api.reservations.cancel(r.code));
  if (s.view.reservation.canceled_late && rules.customer_can_cancel_late !== false) s.notice = { status: true, text: t("cliente.mine.canceledLate") };
  draw();
}

async function act(call) {
  s.busy = true;
  s.notice = null;
  draw();
  try {
    s.view = { ...s.view, reservation: await call() };
  } catch (error) {
    const key = catalogKey(error);
    s.notice = { key, vars: varsOf(error), wa: whatsapp };
  }
  s.busy = false;
  draw();
}

function pageView() {
  const entry = catalog(s.page.key, s.page.vars);
  return html`<div class="conta__secao">
    <h2>${entry.title}</h2>
    <p class="prose">${entry.text}</p>
    <div class="reserva__acoes">
      <a class="btn" href=${localPath("/reservar/")}>${t("receipt.bookAgain")}</a>
      <a class="btn btn--outline" href=${whatsapp} rel="noopener">${t("common.whatsappHouse")}</a>
    </div>
  </div>`;
}

function draw() {
  if (s.page) {
    render(pageView(), root);
    return;
  }
  if (!s.view) {
    render(html`<div class="skeleton skeleton--block" aria-label=${t("common.loading")}></div>`, root);
    return;
  }
  const r = s.view.reservation;
  const kind = receiptKind(r);
  const rules = s.house?.booking || {};
  const active = s.mine && ACTIVE.has(r.status);
  const late = pastDeadline(now(), r.can_cancel_until);
  const canCancel = active && (!late || rules.customer_can_cancel_late !== false);
  const toleranceEnd = new Date(`${r.date}T${r.tolerance_until || r.time}:00-03:00`);
  const canLate = active && rules.late_notice_enabled && rules.extra_tolerance_min > 0 && !r.late_notice_at && ["confirmed", "pending"].includes(r.status) && now() < toleranceEnd;
  render(
    html`${noticeView(s.notice)}
      ${receiptBlock(r, { house: s.house, say: (key) => ((s.said = key), draw()), expanded: s.expanded, toggle: (k) => ((s.expanded = { ...s.expanded, [k]: !s.expanded[k] }), draw()) })}
      ${sayView(s.said)}
      <p class="prose">${kind === "closed" ? t("receipt.closed") : t(`book.after.${kind}`, { prazo: rules.cancel_until_hours ?? 2 })}</p>
      ${active && late && !canCancel ? noticeView({ key: "outside_cancel_window", status: true, wa: whatsapp }) : nothing}
      <div class="reserva__acoes">
        ${canLate ? html`<button class="btn" type="button" ?disabled=${s.busy} @click=${() => act(() => api.reservations.late(r.code))}>${t("receipt.lateButton")}</button>` : nothing}
        ${canCancel ? html`<button class="btn btn--outline" type="button" ?disabled=${s.busy} @click=${cancel}>${t("receipt.cancel")}</button>` : nothing}
        ${kind === "closed" ? html`<a class="btn" href=${localPath("/reservar/")}>${t("receipt.bookAgain")}</a>` : nothing}
        <a class="btn btn--outline" href=${whatsapp} rel="noopener">${t("common.whatsappHouse")}</a>
      </div>`,
    root,
  );
  mountSeals(root);
}

boot(async () => {
  setLocale(document.documentElement.lang);
  themeToggle();
  cookies();
  const host = document.querySelector("[data-comprovante]");
  if (!host) return;
  root = host.querySelector("[data-comprovante-corpo]");
  whatsapp = host.dataset.whatsapp;
  root.replaceChildren();
  const off = staticModeView(whatsapp);
  if (off) return render(off, root);
  draw();
  const token = linkToken();
  if (!token) {
    s.page = { key: "not_found.link" };
    return draw();
  }
  try {
    const [view, house] = await Promise.all([api.links.view(token), api.house.getHouse().catch(() => null)]);
    s.view = view;
    s.house = house;
    const mine = await api.reservations.mine().catch(() => null);
    s.mine = Boolean((mine?.items || mine?.upcoming || []).some((x) => x.code === s.view.reservation.code));
  } catch (error) {
    const key = catalogKey(error, "link");
    if (["gone.link", "not_found.link", "not_found"].includes(key)) s.page = { key: key === "not_found" ? "not_found.link" : key };
    else s.notice = { key, vars: varsOf(error), retry: () => location.reload(), wa: whatsapp };
  }
  draw();
  if (!s.view && !s.page) render(noticeView(s.notice), root);
});
