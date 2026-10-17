// /espera/<token> (ou ?t=): o link da lista de espera (histórias 7.15 e 7.16). Mostra o dia, o
// horário, as pessoas e o lugar na fila, e nada muda ao abrir. Quando uma mesa
// abre, a oferta mostra o tempo que falta (mudando a cada minuto, contado pelo relógio do servidor
// e mostrado no da casa) com "Quero a mesa" e "Pode passar a vez". Um leitor de tela ouve
// o prazo uma vez e um alerta aos 2 minutos, nunca segundo a segundo.
import "../styles/main.css";
import "../styles/site.css";
import "./cliente.css";
import { boot } from "../app/boot.js";
import { confirmAction } from "../components/confirm.js";
import { mountSeals } from "../components/seal.js";
import { houseClock, minutesLeft, whatsappUrl } from "../lib/cliente.js";
import { html, nothing, render } from "../lib/html.js";
import { getLocale, setLocale, t } from "../lib/strings.js";
import * as api from "../services/api/index.js";
import { catalog, catalogKey, hour, localPath, noticeView, receiptBlock, sayView, staticModeView, varsOf } from "./cliente-ui.js";
import { linkToken } from "./link-token.js";
import { cookies, themeToggle } from "./site-chrome.js";

const s = { token: null, view: null, house: null, page: null, notice: null, busy: false, said: null, expanded: {}, skew: 0, announced: "" };
let root;
let whatsapp;
let live;

const wa = (text = "") => (s.house?.whatsapp ? whatsappUrl(s.house.whatsapp, text) : whatsapp);
/** O relógio do servidor: a hora do próprio celular pode estar errada; a diferença vem com cada resposta. */
const serverNow = () => new Date(Date.now() + s.skew);

function take(view) {
  s.view = view;
  if (view?.server_time) s.skew = new Date(view.server_time).getTime() - Date.now();
}

async function reload() {
  try {
    take(await api.links.view(s.token));
  } catch {
    // mantém o que está na tela
  }
}

async function accept(swapCode) {
  s.busy = true;
  s.notice = null;
  draw();
  try {
    take(await api.links.acceptOffer(s.token, swapCode));
    s.notice = { status: true, text: s.view.swapped ? t("cliente.wait.swapped", { code: s.view.reservation.code }) : t("cliente.wait.accepted") };
  } catch (error) {
    const body = error.body || {};
    if (error.type === "conflict" && body.existing && ["same_night", "active_limit", "duplicate_reservation"].includes(body.reason)) {
      s.busy = false;
      const swap = await confirmAction({
        title: t("cliente.wait.swapTitle", { time: hour(body.existing.time) }),
        message: t("cliente.wait.swapText", { code: body.existing.code }),
        confirmLabel: t("cliente.wait.swap"),
        cancelLabel: t("cliente.wait.decline"),
      });
      return swap ? accept(body.existing.code) : decline({ asked: true });
    }
    const key = error.type === "offer_expired" && body.reason === "night_closed" ? "night_over" : catalogKey(error, "link");
    s.notice = key === "night_over"
      ? { status: true, text: t("cliente.wait.nightOver") }
      : { key, vars: varsOf(error, { minutes: body.minutes ?? s.house?.booking?.waitlist_offer_min ?? 10 }), wa: wa(), links: key === "conflict.link_used" ? [{ href: s.view.reservation.receipt_url, label: t("cliente.link.see") }] : [] };
    await reload();
  }
  s.busy = false;
  draw();
  root.querySelector(".aviso, .receipt")?.focus();
}

async function decline({ asked = false } = {}) {
  if (!asked) {
    const ok = await confirmAction({ title: t("cliente.wait.declineTitle"), message: t("cliente.wait.declineText"), confirmLabel: t("cliente.wait.decline"), danger: true });
    if (!ok) return;
  }
  s.busy = true;
  draw();
  try {
    take(await api.links.declineOffer(s.token));
    s.notice = { status: true, text: t("cliente.wait.declined") };
  } catch (error) {
    s.notice = { key: catalogKey(error, "link"), vars: varsOf(error), wa: wa() };
    await reload();
  }
  s.busy = false;
  draw();
}

function offerView(r) {
  const left = minutesLeft(r.offer_expires_at, serverNow());
  const until = houseClock(r.offer_expires_at, getLocale());
  return html`<section class="conta__secao" aria-labelledby="oferta-titulo">
    <h2 id="oferta-titulo">${t("cliente.wait.offerTitle")}</h2>
    <p class="contagem" aria-hidden="true">${t("cliente.wait.left", { n: left })}</p>
    <p class="prose">${t("cliente.wait.until", { time: until })}</p>
    <div class="resposta">
      <button class="btn btn--lg" type="button" ?disabled=${s.busy} @click=${() => accept()}>${t("cliente.wait.accept")}</button>
      <button class="btn btn--outline btn--lg" type="button" ?disabled=${s.busy} @click=${() => decline()}>${t("cliente.wait.decline")}</button>
    </div>
  </section>`;
}

/** O que o leitor de tela ouve: o prazo uma vez, e um alerta aos 2 minutos. */
function announce(r) {
  if (r?.status !== "offered" || !r.offer_expires_at) return;
  const left = minutesLeft(r.offer_expires_at, serverNow());
  const until = houseClock(r.offer_expires_at, getLocale());
  const say = left <= 2 ? t("cliente.wait.twoMinutes", { time: until }) : t("cliente.wait.until", { time: until });
  if (say !== s.announced) {
    s.announced = say;
    live.textContent = say;
  }
}

function draw() {
  if (s.page) {
    const entry = catalog(s.page.key);
    render(html`<div class="conta__secao"><h2>${entry.title}</h2><p class="prose">${entry.text}</p>
      <div class="reserva__acoes"><a class="btn" href=${localPath("/reservar/")}>${t("receipt.bookAgain")}</a><a class="btn btn--outline" href=${wa()} rel="noopener">${t("common.whatsappHouse")}</a></div></div>`, root);
    return;
  }
  if (!s.view) {
    render(s.notice ? noticeView(s.notice) : html`<div class="skeleton skeleton--block" aria-label=${t("common.loading")}></div>`, root);
    return;
  }
  const r = s.view.reservation;
  const expired = r.status === "waitlisted" && r.offer_expired_at;
  render(
    html`${noticeView(s.notice)}
      ${expired && !s.notice ? noticeView({ key: "offer_expired", vars: { minutes: s.house?.booking?.waitlist_offer_min ?? 10 }, status: true, links: [{ href: localPath("/reservar/"), label: t("cliente.wait.otherTimes") }], wa: wa() }) : nothing}
      ${r.status === "offered" && r.offer_expires_at ? offerView(r) : nothing}
      ${receiptBlock(r, { house: s.house, say: (key) => ((s.said = key), draw()), expanded: s.expanded, toggle: (k) => ((s.expanded = { ...s.expanded, [k]: !s.expanded[k] }), draw()) })}
      ${sayView(s.said)}
      ${r.status === "waitlisted" ? html`<p class="prose">${t("book.after.waitlist")} ${t("cliente.wait.leaveHow")} <a class="link" href=${`${localPath("/minhas-reservas/")}?reserva=${encodeURIComponent(r.code)}`}>${t("cliente.receipt.mine")}</a>.</p>` : nothing}
      ${r.status === "expired" ? html`<p class="notice" role="status">${t("cliente.wait.nightOver")}</p>` : nothing}
      ${r.status === "canceled" ? html`<p class="prose">${t("cliente.wait.out")}</p>` : nothing}`,
    root,
  );
  announce(r);
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
  live = document.createElement("p");
  live.className = "sr-only";
  live.setAttribute("aria-live", "polite");
  host.append(live);
  draw();
  s.token = linkToken();
  if (!s.token) {
    s.page = { key: "not_found.link" };
    return draw();
  }
  try {
    const [view, house] = await Promise.all([api.links.view(s.token), api.house.getHouse().catch(() => null)]);
    take(view);
    s.house = house;
  } catch (error) {
    const key = catalogKey(error, "link");
    if (["gone.link", "not_found.link"].includes(key)) s.page = { key };
    else s.notice = { key, retry: () => location.reload(), wa: wa() };
  }
  draw();
  // a hora visível muda a cada minuto; quando a oferta acaba, a página lê de novo; um
  // lugar na fila é lido de novo a cada minuto, para uma oferta aparecer sem recarregar
  let ticks = 0;
  setInterval(async () => {
    const r = s.view?.reservation;
    ticks += 1;
    if (r?.status === "offered" && r.offer_expires_at && serverNow() >= new Date(r.offer_expires_at)) await reload();
    else if (r?.status === "waitlisted" && ticks % 4 === 0 && document.visibilityState === "visible") await reload();
    draw();
  }, 15_000);
});
