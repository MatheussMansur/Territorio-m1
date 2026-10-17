// /minhas-reservas: as reservas e os dados do próprio cliente (histórias 7.10 a 7.13). As próximas
// com o status por extenso e "Cancelar sem custo até {hora}" (o prazo que a reserva
// copiou), as passadas com o comprovante; cancelar, mudar pessoas, dia ou horário pela mesma
// disponibilidade da reserva, sair da lista de espera; "Meus dados": nome, e-mail, idioma, novidades
// (com consentimento próprio), um número novo com o seu código, baixar os dados e pedir para apagá-los.
import "../styles/main.css";
import "../styles/site.css";
import "./cliente.css";
import { boot } from "../app/boot.js";
import { people } from "../components/booking-receipt.js";
import { choiceGroup, syncChoiceGroup } from "../components/choice-group.js";
import { confirmAction } from "../components/confirm.js";
import { showFormErrors } from "../components/field.js";
import { otpInput } from "../components/otp.js";
import { phoneField } from "../components/phone-field.js";
import { houseClock, nightOf, pastDeadline, whatsappUrl, windowDates } from "../lib/cliente.js";
import { houseParts } from "../lib/dates.js";
import { html, nothing, render } from "../lib/html.js";
import { idempotencyKeyFor, settleIdempotencyKey } from "../lib/idempotency.js";
import { COUNTRIES, formatPhone } from "../lib/phone.js";
import { getLocale, setLocale, t } from "../lib/strings.js";
import { turnstileToken } from "../lib/turnstile.js";
import { rules } from "../lib/validate.js";
import * as api from "../services/api/index.js";
import { calendarView, catalog, catalogKey, dayName, hour, localPath, noticeView, staticModeView, varsOf, whenLabel } from "./cliente-ui.js";
import { cookies, themeToggle } from "./site-chrome.js";

const ACTIVE = new Set(["pending", "confirmed", "waitlisted", "offered"]);
const query = new URLSearchParams(location.search);

const s = {
  house: null,
  me: null,
  list: null,
  serverTime: null,
  skew: 0,
  tab: location.hash === "#dados" ? "dados" : "reservas",
  page: null, // unauthorized, session_expired: a tela inteira pede para entrar
  notice: null,
  busy: false,
  edit: null, // a reserva sendo mudada
  profileNotice: null,
  phone: { open: false, phase: "numero", e164: null, notice: null, resendAt: 0 },
  forgotten: null,
};
let root;
let whatsapp;
let phoneCtl = null;
const wired = new WeakSet();

const wa = (text = "") => (s.house?.whatsapp ? whatsappUrl(s.house.whatsapp, text) : whatsapp);
/** O relógio do servidor: a diferença vem com a lista, então o prazo nunca é o do celular. */
const now = () => new Date(Date.now() + (s.skew || 0));
const signIn = () => `${localPath("/entrar/")}?volta=${encodeURIComponent(location.pathname + location.search)}`;

function goSignIn(error) {
  const key = error?.type === "session_expired" ? "session_expired" : "unauthorized";
  s.page = { key };
  draw();
}

async function load() {
  try {
    const mine = await api.reservations.mine();
    s.list = mine;
    s.serverTime = mine.server_time;
    s.skew = mine.server_time ? new Date(mine.server_time).getTime() - Date.now() : 0;
  } catch (error) {
    if (error.status === 401) return goSignIn(error);
    s.notice = { key: catalogKey(error), vars: varsOf(error), retry: load, wa: wa() };
  }
  draw();
}

/** "Cancelar sem custo até 18:00" (ou "até sexta, 16/10, às 18:00" quando é outro dia). */
function deadlineLine(r) {
  const until = new Date(r.can_cancel_until);
  const at = houseParts(until);
  const time = houseClock(r.can_cancel_until, getLocale());
  // o próprio prazo ainda está no horário ("até 18:00" inclui 18:00:00)
  if (pastDeadline(now(), until)) return t("cliente.mine.deadlinePassed");
  return at.date === r.date ? t("cliente.mine.freeUntil", { time }) : t("cliente.mine.freeUntilDay", { day: dayName(at.date), time });
}

// ---- cancelar ----

async function cancel(r) {
  const rules = s.house?.booking || {};
  const waiting = r.status === "waitlisted" || r.status === "offered";
  const late = !waiting && pastDeadline(now(), r.can_cancel_until);
  if (late && rules.customer_can_cancel_late === false) {
    s.notice = { key: "outside_cancel_window", wa: wa(t("cliente.mine.waCancel", { code: r.code })) };
    return draw();
  }
  const ok = await confirmAction({
    title: waiting ? t("cliente.mine.leaveTitle") : t("receipt.cancelTitle"),
    message: waiting ? t("cliente.mine.leaveText") : late ? `${t("receipt.cancelMessage", { code: r.code })} ${t("cliente.mine.cancelLate")}` : t("receipt.cancelMessage", { code: r.code }),
    confirmLabel: waiting ? t("cliente.mine.leave") : t("receipt.cancel"),
    danger: true,
  });
  if (!ok) return;
  s.busy = true;
  draw();
  try {
    const done = await api.reservations.cancel(r.code);
    // o prazo pode ter passado com o diálogo aberto: a resposta diz como contou
    s.notice = { status: true, text: done.canceled_late ? t("cliente.mine.canceledLate") : waiting ? t("cliente.mine.left") : t("cliente.mine.canceled", { code: r.code }) };
  } catch (error) {
    if (error.status === 401) return goSignIn(error);
    s.notice = { key: catalogKey(error), vars: varsOf(error), wa: wa(t("cliente.mine.waCancel", { code: r.code })) };
  }
  s.busy = false;
  await load();
}

// ---- mudar pessoas, dia ou horário ----

function startEdit(r) {
  s.edit = { code: r.code, party: r.party_size, big: false, date: r.date, time: r.time, days: [], day: null, notice: null, alternatives: null, loading: true, original: r };
  draw();
  loadEditDays();
}

async function loadEditDays() {
  const e = s.edit;
  if (!e) return;
  e.loading = true;
  draw();
  try {
    const today = nightOf(now());
    const dates = windowDates(today, s.house?.booking?.window_days ?? 30);
    e.dates = dates;
    e.today = today;
    const parts = [];
    for (let i = 0; i < dates.length; i += 60) parts.push(dates.slice(i, i + 60));
    const answers = await Promise.all(parts.map((p) => api.availability.getDays({ from: p[0], to: p.at(-1), partySize: e.party })));
    e.days = answers.flatMap((a) => a.days);
    await loadEditSlots();
  } catch (error) {
    e.notice = { key: catalogKey(error), retry: loadEditDays, wa: wa() };
  }
  e.loading = false;
  draw();
}

async function loadEditSlots() {
  const e = s.edit;
  if (!e?.date) return;
  try {
    e.day = await api.availability.getSlots({ date: e.date, partySize: e.party });
  } catch (error) {
    e.notice = { key: catalogKey(error), retry: loadEditSlots, wa: wa() };
  }
  draw();
}

const editTimes = (e) => {
  const own = e.original.date === e.date && e.original.party_size >= e.party ? e.original.time : null;
  return (e.day?.slots || []).filter((x) => x.state !== "past").map((x) => (x.time === own ? { ...x, state: "available" } : x));
};

async function saveEdit() {
  const e = s.edit;
  if (!e.time) {
    e.notice = { status: true, text: t("cliente.mine.pickTime") };
    return draw();
  }
  const body = { date: e.date, time: e.time, party_size: e.party };
  const scope = `mudar:${e.code}`;
  s.busy = true;
  e.notice = null;
  draw();
  try {
    await api.reservations.reschedule(e.code, body, idempotencyKeyFor(scope, body));
    settleIdempotencyKey(scope);
    s.notice = { status: true, text: t("cliente.mine.changed", { code: e.code, when: whenLabel(e.date, e.time) }) };
    s.edit = null;
    s.busy = false;
    return load();
  } catch (error) {
    settleIdempotencyKey(scope, error);
    if (error.status === 401) return goSignIn(error);
    const key = catalogKey(error);
    const max = s.house?.booking?.party_max_online ?? 8;
    e.notice = {
      key: error.type === "party_too_large" ? "party_too_large" : key,
      vars: varsOf(error, { max }),
      retry: ["network", "timeout", "server"].includes(key) ? saveEdit : null,
      wa: ["conflict.reschedule", "customer_blocked", "party_too_large", "slot_full.cutoff", "slot_full.day_closed", "network", "timeout", "server"].includes(key) || error.type === "party_too_large"
        ? wa(t("cliente.mine.waChange", { code: e.code, n: e.party }))
        : null,
    };
    e.alternatives = error.body?.alternatives || null;
    if (error.type === "slot_full") {
      e.time = null;
      await loadEditSlots();
    }
  }
  s.busy = false;
  draw();
}

function editView(e) {
  const max = s.house?.booking?.party_max_online ?? 8;
  const times = editTimes(e);
  return html`<div class="mudar" data-mudar>
    <h3 class="reserva__titulo">${t("cliente.mine.changeTitle")}</h3>
    ${noticeView(e.notice)}
    <div class="tiles" role="radiogroup" aria-label=${t("book.howMany")} data-group="m-party">
      ${Array.from({ length: max }, (_, i) => i + 1).map((n) => html`<button type="button" class="tile" role="radio" data-value=${n} aria-checked=${String(e.party === n)} aria-label=${people(n)}>${n}</button>`)}
      <button type="button" class="tile tile--mais" role="radio" data-value="big" aria-checked="false">${t("book.bigTile", { n: max + 1 })}</button>
    </div>
    ${e.dates?.length && e.days.length
      ? calendarView({ dates: e.dates, days: e.days, chosen: e.date, today: e.today, label: t("book.whichDay"), busy: e.loading })
      : html`<div class="skeleton skeleton--block" aria-label=${t("common.loading")}></div>`}
    ${e.alternatives?.length
      ? html`<div class="aviso__acoes">${e.alternatives.map((a) => html`<button class="btn btn--sm btn--outline" type="button" @click=${() => { e.date = a.date; e.time = a.time; e.alternatives = null; e.notice = null; loadEditSlots(); }}>${a.date === e.date ? hour(a.time) : `${dayName(a.date)} · ${hour(a.time)}`}</button>`)}</div>`
      : nothing}
    ${times.length
      ? html`<div class="slots" role="radiogroup" aria-label=${t("book.whatTime")} data-group="m-slot">
          ${times.map((x) => html`<button type="button" class=${["slot", x.state === "few_left" ? "is-few" : "", x.state === "full" ? "is-full" : ""].join(" ")} role="radio" data-value=${x.time} aria-checked=${String(e.time === x.time)} aria-disabled=${String(x.state === "full")} aria-label=${`${hour(x.time)}, ${t(x.state === "full" ? "book.fullNoList" : `slot.${x.state}`)}`}><b>${hour(x.time)}</b><span>${t(x.state === "full" ? "book.fullNoList" : `slot.${x.state}`)}</span></button>`)}
        </div>`
      : e.day ? html`<p class="reserva__dica">${t("book.noSlots")}</p>` : nothing}
    <div class="reserva__acoes">
      <button class="btn" type="button" ?disabled=${s.busy} @click=${saveEdit}>${t("cliente.mine.saveChange")}</button>
      <button class="btn btn--outline" type="button" @click=${() => ((s.edit = null), draw())}>${t("common.back")}</button>
    </div>
  </div>`;
}

function onEditPick(kind, value) {
  const e = s.edit;
  if (!e) return;
  if (kind === "m-party") {
    if (value === "big") {
      const max = s.house?.booking?.party_max_online ?? 8;
      e.notice = { key: "party_too_large", vars: { max }, wa: wa(t("cliente.mine.waChange", { code: e.code, n: max + 1 })) };
      return draw();
    }
    e.party = Number(value);
    e.time = null;
    e.notice = null;
    loadEditDays();
  } else if (kind === "m-day") {
    e.date = value;
    e.time = null;
    e.day = null;
    loadEditSlots();
  } else {
    e.time = value;
    draw();
  }
}

// ---- meus dados ----

async function saveProfile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const name = form.nome.value.trim();
  const email = form.email.value.trim();
  const errors = { nome: rules.name(name), email: email ? rules.email(email) : null };
  if (showFormErrors(form, errors)) return;
  s.busy = true;
  draw();
  try {
    s.me = await api.auth.updateMe({ name, email: email || null, locale: form.lingua.value, marketing_opt_in: form.novidades.checked });
    s.profileNotice = { status: true, text: t("cliente.data.saved") };
  } catch (error) {
    if (error.status === 401) return goSignIn(error);
    const map = { name: "nome", email: "email", locale: "lingua" };
    if (error.errors?.length) showFormErrors(form, Object.fromEntries(error.errors.map((e) => [map[e.field] || e.field, e.message])));
    s.profileNotice = { key: catalogKey(error), vars: varsOf(error) };
  }
  s.busy = false;
  draw();
}

async function phoneSend() {
  const p = s.phone;
  if (p.phase === "numero") {
    const e164 = phoneCtl?.validate();
    if (!e164) return;
    p.e164 = e164;
  }
  s.busy = true;
  p.notice = null;
  draw();
  try {
    await api.auth.sendOtp(p.e164, { turnstileToken: await turnstileToken() });
    p.phase = "codigo";
    p.resendAt = Date.now() + 30_000;
  } catch (error) {
    p.notice = { key: catalogKey(error, "otp"), vars: varsOf(error), wa: wa() };
  }
  s.busy = false;
  draw();
  if (p.phase === "codigo") requestAnimationFrame(() => root.querySelector("#novo-codigo")?.focus());
}

async function phoneVerify(code) {
  const p = s.phone;
  s.busy = true;
  draw();
  try {
    s.me = await api.auth.changePhone({ phone: p.e164, code });
    s.phone = { open: false, phase: "numero", e164: null, notice: null, resendAt: 0 };
    s.profileNotice = { status: true, text: t("cliente.data.phoneChanged", { phone: s.me.phone_masked || formatPhone(p.e164) }) };
  } catch (error) {
    p.notice = { key: catalogKey(error, "otp"), vars: varsOf(error), wa: error.type === "phone_in_use" ? wa() : null };
  }
  s.busy = false;
  draw();
}

function saveFile(name, type, text) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Os dados como uma pessoa lê: perfil, reservas e consentimentos, no idioma da página. */
function readable(data) {
  const p = data.profile;
  const lines = [
    t("cliente.data.fileTitle", { house: data.house || "Território" }),
    t("cliente.data.fileDate", { when: `${dayName(houseParts(data.exported_at).date)} ${houseClock(data.exported_at, getLocale())}` }),
    "",
    `${t("cliente.data.name")}: ${p.name || "—"}`,
    `${t("book.whatsapp")}: ${p.phone ? formatPhone(p.phone) : "—"}`,
    `${t("cliente.data.email")}: ${p.email || "—"}`,
    `${t("cliente.data.language")}: ${p.locale}`,
    `${t("cliente.data.news")}: ${p.marketing_opt_in ? t("cliente.data.yes") : t("cliente.data.no")}`,
    "",
    `${t("cliente.data.fileBookings")}:`,
    ...data.reservations.map((r) => `- ${r.code} · ${whenLabel(r.date, r.time)} · ${people(r.party_size)} · ${t(`status.${r.status}`)}${r.notes ? ` · ${r.notes}` : ""}`),
    "",
    `${t("cliente.data.fileConsents")}:`,
    ...data.consents.map((c) => `- ${c.kind}${c.version ? ` ${c.version}` : ""}${c.value != null ? `: ${c.value ? t("cliente.data.yes") : t("cliente.data.no")}` : ""}`),
  ];
  return lines.join("\r\n");
}

async function download() {
  s.busy = true;
  draw();
  try {
    const data = await api.auth.myData();
    const stamp = houseParts(data.exported_at).date;
    saveFile(`territorio-meus-dados-${stamp}.json`, "application/json", JSON.stringify(data, null, 2));
    saveFile(`territorio-meus-dados-${stamp}.txt`, "text/plain;charset=utf-8", readable(data));
    s.profileNotice = { status: true, text: t("cliente.data.downloaded") };
  } catch (error) {
    if (error.status === 401) return goSignIn(error);
    s.profileNotice = { key: "download_failed", retry: download, wa: wa(t("cliente.data.waData")) };
  }
  s.busy = false;
  draw();
}

async function forget() {
  const coming = (s.list?.upcoming || []).filter((r) => ACTIVE.has(r.status));
  const queue = coming.filter((r) => r.status === "waitlisted" || r.status === "offered");
  const tables = coming.length - queue.length;
  const message = [
    t("cliente.data.forgetText"),
    tables ? t("cliente.data.forgetBookings", { n: tables }) : "",
    queue.length ? t("cliente.data.forgetQueue") : "",
  ].filter(Boolean).join(" ");
  const ok = await confirmAction({ title: t("cliente.data.forgetTitle"), message, confirmLabel: t("cliente.data.forgetConfirm"), danger: true });
  if (!ok) return;
  s.busy = true;
  draw();
  try {
    const answer = await api.auth.forgetMe();
    s.forgotten = answer?.due_at || new Date(Date.now() + 15 * 86_400_000).toISOString();
  } catch (error) {
    if (error.status === 401) return goSignIn(error);
    s.profileNotice = { key: catalogKey(error), retry: forget, wa: wa() };
  }
  s.busy = false;
  draw();
}

function dataView() {
  const me = s.me || {};
  const p = s.phone;
  return html`<section class="conta__secao" aria-labelledby="dados-titulo">
    <h2 id="dados-titulo">${t("cliente.data.title")}</h2>
    ${noticeView(s.profileNotice)}
    <form class="conta__form" novalidate @submit=${saveProfile}>
      <div class="field">
        <label class="field__label" for="dados-nome">${t("cliente.data.name")}</label>
        <input class="field__input" id="dados-nome" name="nome" autocomplete="name" .value=${me.name || ""}>
      </div>
      <div class="field">
        <label class="field__label" for="dados-email">${t("cliente.data.emailOptional")}</label>
        <input class="field__input" id="dados-email" name="email" type="email" autocomplete="email" aria-describedby="dados-email-ajuda" .value=${me.email || ""}>
        <p class="field__help" id="dados-email-ajuda">${t("cliente.data.emailHelp")}</p>
      </div>
      <div class="field">
        <label class="field__label" for="dados-lingua">${t("cliente.data.languageLabel")}</label>
        <select class="field__input" id="dados-lingua" name="lingua">
          ${[["pt", "Português"], ["es", "Español"], ["en", "English"]].map(([v, l]) => html`<option value=${v} ?selected=${(me.locale || "pt") === v}>${l}</option>`)}
        </select>
      </div>
      <label class="check"><input type="checkbox" name="novidades" .checked=${Boolean(me.marketing_opt_in)} aria-describedby="dados-novidades-ajuda"> ${t("cliente.data.newsLabel")}</label>
      <p class="field__help" id="dados-novidades-ajuda">${t("cliente.data.newsHelp")}</p>
      <div class="reserva__acoes"><button class="btn" type="submit" ?disabled=${s.busy}>${t("common.save")}</button></div>
    </form>

    <div class="conta__secao">
      <h3 class="reserva__titulo">${t("book.whatsapp")}</h3>
      <p class="prose">${me.phone_masked ? t("cliente.data.phoneNow", { phone: me.phone_masked }) : t("cliente.data.phoneNone")}</p>
      ${p.open
        ? html`<div class="conta__form">
            ${noticeView(p.notice)}
            ${p.phase === "numero"
              ? html`<div class="field" data-phone>
                    <label class="field__label" for="novo-tel">${t("cliente.data.newPhone")}</label>
                    <div class="phone">
                      <select class="field__input" aria-label=${t("book.country")}>${COUNTRIES.map((c) => html`<option value=${c.id}>${c.label}</option>`)}</select>
                      <input class="field__input" id="novo-tel" type="tel" inputmode="tel" autocomplete="tel-national">
                    </div>
                  </div>
                  <div class="reserva__acoes"><button class="btn" type="button" ?disabled=${s.busy} @click=${phoneSend}>${t("book.sendCode")}</button></div>`
              : html`<p class="prose">${t("book.codeSentTo", { phone: formatPhone(p.e164) })}</p>
                  <div class="field">
                    <label class="field__label" for="novo-codigo">${t("book.codeLabel")}</label>
                    <div class="otp" data-otp>
                      <input class="otp__input" id="novo-codigo" inputmode="numeric" autocomplete="one-time-code" ?disabled=${s.busy}>
                      <div class="otp__boxes" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span></div>
                    </div>
                  </div>
                  <div class="reserva__acoes"><button class="btn btn--outline" type="button" @click=${() => ((p.phase = "numero"), draw())}>${t("book.changeNumber")}</button></div>`}
          </div>`
        : html`<div class="reserva__acoes"><button class="btn btn--outline" type="button" @click=${() => ((s.phone = { ...p, open: true }), draw())}>${t("cliente.data.changePhone")}</button></div>`}
    </div>

    <div class="conta__secao">
      <h3 class="reserva__titulo">${t("cliente.data.yoursTitle")}</h3>
      <p class="prose">${t("cliente.data.yoursLead")}</p>
      <div class="reserva__acoes">
        <button class="btn btn--outline" type="button" ?disabled=${s.busy} @click=${download}>${t("cliente.data.download")}</button>
        <button class="btn btn--outline btn--danger" type="button" ?disabled=${s.busy} @click=${forget}>${t("cliente.data.forget")}</button>
      </div>
      <p class="reserva__dica"><a class="link" href=${localPath("/privacidade/")}>${t("book.dietaryPrivacy")}</a></p>
    </div>
  </section>`;
}

// ---- a lista ----

function statusTag(r) {
  return html`<span class=${`status-texto ${ACTIVE.has(r.status) ? "status-texto--ativo" : "status-texto--fim"}`}>${t(`status.${r.status}`)}</span>`;
}

function itemView(r, upcoming) {
  const editing = s.edit?.code === r.code;
  const waiting = r.status === "waitlisted" || r.status === "offered";
  const highlight = query.get("reserva") === r.code;
  return html`<li id=${`reserva-${r.code}`} class=${highlight ? "is-destaque" : ""}>
    <div class="lista-reservas__topo">
      <span class="lista-reservas__quando">${whenLabel(r.date, r.time)}</span>
      ${statusTag(r)}
    </div>
    <p class="lista-reservas__linha">${people(r.party_size)} · <span class="lista-reservas__codigo">${r.code}</span>${r.event_title ? ` · ${r.event_title}` : ""}${r.place === "list" ? ` · ${t("book.placeList")}` : ""}</p>
    ${upcoming && r.status === "waitlisted" ? html`<p class="lista-reservas__linha">${t("book.waitlistPosition", { n: r.waitlist_position ?? 1 })}</p>` : nothing}
    ${upcoming && r.status === "offered" && r.offer_expires_at ? html`<p class="lista-reservas__linha">${t("cliente.mine.offerUntil", { time: houseClock(r.offer_expires_at, getLocale()) })}</p>` : nothing}
    ${upcoming && r.status === "pending" && r.pending_until ? html`<p class="lista-reservas__linha">${t("book.houseConfirmsUntil", { time: houseClock(r.pending_until, getLocale()) })}</p>` : nothing}
    ${upcoming && !waiting ? html`<p class="lista-reservas__linha">${deadlineLine(r)}</p>` : nothing}
    <div class="reserva__acoes">
      <a class="btn btn--sm btn--outline" href=${r.receipt_url}>${t("book.keepReceipt")}</a>
      ${upcoming && r.can_reschedule && !editing ? html`<button class="btn btn--sm btn--outline" type="button" @click=${() => startEdit(r)}>${t("cliente.mine.change")}</button>` : nothing}
      ${upcoming && ["pending", "confirmed"].includes(r.status) && !r.can_reschedule && !editing
        ? html`<a class="btn btn--sm btn--outline" href=${wa(t("cliente.mine.waChange", { code: r.code, n: r.party_size }))} rel="noopener">${t("cliente.mine.changeWhatsapp")}</a>`
        : nothing}
      ${upcoming && ACTIVE.has(r.status) ? html`<button class="btn btn--sm btn--outline" type="button" ?disabled=${s.busy} @click=${() => cancel(r)}>${waiting ? t("cliente.mine.leave") : t("receipt.cancel")}</button>` : nothing}
    </div>
    ${editing ? editView(s.edit) : nothing}
  </li>`;
}

function listView() {
  if (!s.list) return html`<div class="skeleton skeleton--block" aria-label=${t("common.loading")}></div>`;
  const { upcoming = [], past = [] } = s.list;
  return html`<section class="conta__secao" aria-labelledby="proximas-titulo">
      <h2 id="proximas-titulo">${t("cliente.mine.upcoming")}</h2>
      ${upcoming.length
        ? html`<ul class="lista-reservas">${upcoming.map((r) => itemView(r, true))}</ul>`
        : html`<div class="empty"><p>${t("cliente.mine.empty")}</p><p><a class="btn" href=${localPath("/reservar/")}>${t("receipt.bookAgain")}</a></p></div>`}
    </section>
    ${past.length
      ? html`<section class="conta__secao" aria-labelledby="passadas-titulo">
          <h2 id="passadas-titulo">${t("cliente.mine.past")}</h2>
          <ul class="lista-reservas">${past.map((r) => itemView(r, false))}</ul>
        </section>`
      : nothing}`;
}

async function logout() {
  try {
    await api.auth.logout();
  } catch {
    // a página sai mesmo assim; a sessão acaba no servidor ou quando vence
  }
  location.assign(localPath("/entrar/"));
}

function draw() {
  if (s.page) {
    const entry = catalog(s.page.key);
    render(
      html`<div class="conta__secao">
        <h2>${entry.title}</h2>
        <p class="prose">${entry.text}</p>
        <div class="reserva__acoes"><a class="btn btn--lg" href=${signIn()}>${entry.action || t("cliente.signin.enter")}</a></div>
      </div>`,
      root,
    );
    return;
  }
  if (s.forgotten) {
    const at = houseParts(s.forgotten).date;
    render(
      html`<div class="conta__secao" role="status">
        <h2>${t("cliente.data.forgottenTitle")}</h2>
        <p class="prose">${t("cliente.data.forgottenText", { day: dayName(at) })}</p>
        <div class="reserva__acoes"><a class="btn" href=${localPath("/")}>${t("cliente.data.home")}</a></div>
      </div>`,
      root,
    );
    return;
  }
  render(
    html`<div class="conta__barra">
        <div class="conta__abas" role="tablist" aria-label=${t("cliente.page.mine")}>
          <button class="tile" type="button" role="tab" id="aba-reservas" aria-controls="painel-conta" aria-selected=${String(s.tab === "reservas")} @click=${() => ((s.tab = "reservas"), history.replaceState(null, "", "#reservas"), draw())}>${t("cliente.mine.tab")}</button>
          <button class="tile" type="button" role="tab" id="aba-dados" aria-controls="painel-conta" aria-selected=${String(s.tab === "dados")} @click=${() => ((s.tab = "dados"), history.replaceState(null, "", "#dados"), draw())}>${t("cliente.data.title")}</button>
        </div>
        <button class="btn btn--sm btn--outline" type="button" @click=${logout}>${t("cliente.mine.logout")}</button>
      </div>
      ${s.me?.name ? html`<p class="prose">${t("cliente.mine.hello", { name: s.me.name.split(" ")[0] })}</p>` : nothing}
      ${s.me && s.me.phone_verified === false ? noticeView({ key: "google_needs_phone", status: true, links: [{ href: `${localPath("/entrar/")}?needs_phone=1`, label: catalog("google_needs_phone").action, outline: false }] }) : nothing}
      ${noticeView(s.notice)}
      <div id="painel-conta" role="tabpanel" aria-labelledby=${s.tab === "dados" ? "aba-dados" : "aba-reservas"}>
        ${s.tab === "dados" ? dataView() : listView()}
      </div>
      <p class="reserva__dica"><a class="link" href=${localPath("/reservar/")}>${t("receipt.bookAgain")}</a> · <a class="link" href=${wa()} rel="noopener">${t("common.whatsappHouse")}</a></p>`,
    root,
  );
  wire();
}

function wire() {
  for (const group of root.querySelectorAll("[data-group]")) {
    if (!wired.has(group)) {
      wired.add(group);
      const kind = group.dataset.group === "day" ? "m-day" : group.dataset.group;
      choiceGroup(group, (value) => onEditPick(kind, value));
    }
    syncChoiceGroup(group);
  }
  const phone = root.querySelector("[data-phone]");
  if (phone && !wired.has(phone)) {
    wired.add(phone);
    phoneCtl = phoneField(phone, { whatsappFor: () => wa() });
  }
  const box = root.querySelector("[data-otp]");
  if (box && !wired.has(box)) {
    wired.add(box);
    otpInput(box, { onComplete: phoneVerify });
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
  render(html`<div class="skeleton skeleton--block" aria-label=${t("common.loading")}></div>`, root);
  const [house, me] = await Promise.allSettled([api.house.getHouse(), api.auth.me()]);
  s.house = house.status === "fulfilled" ? house.value : null;
  if (me.status === "rejected") {
    if (me.reason?.status === 401) return goSignIn(me.reason);
    s.notice = { key: catalogKey(me.reason), retry: () => location.reload(), wa: wa() };
    return draw();
  }
  s.me = me.value;
  await load();
  const asked = query.get("reserva");
  if (asked) {
    const r = s.list?.upcoming?.find((x) => x.code === asked);
    if (r?.can_reschedule && query.get("mudar") === "1") startEdit(r);
    requestAnimationFrame(() => document.getElementById(`reserva-${asked}`)?.scrollIntoView({ block: "center" }));
  }
});

