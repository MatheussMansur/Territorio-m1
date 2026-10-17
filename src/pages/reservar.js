// O fluxo de reserva na API da casa, como no app final, numa página que vai andando:
// pessoas e o primeiro dia aberto já vêm escolhidos, então os horários já estão lá; escolher um horário
// abre os detalhes logo abaixo; o código do WhatsApp (só na primeira vez neste celular) e
// o comprovante ocupam o mesmo lugar. Enquanto chega uma resposta nova, a última fica na tela,
// apagada, e a janela acende vidro por vidro quando muda, como no site aprovado.
// Um horário lotado oferece a lista de espera; "9 ou mais" vai para a casa (ou vira um pedido).
// Nada digitado se perde: o rascunho aguenta uma ida ao WhatsApp pelo código (até uma recarga),
// um horário que lota, uma sessão que venceu e uma conexão que caiu (histórias 7.1 a 7.7).
import "../styles/main.css";
import "../styles/site.css";
import "./cliente.css";
import { boot } from "../app/boot.js";
import { people } from "../components/booking-receipt.js";
import { choiceGroup, syncChoiceGroup } from "../components/choice-group.js";
import { confirmAction } from "../components/confirm.js";
import { readChoice, setCategory } from "../components/cookie-banner.js";
import { setFieldError } from "../components/field.js";
import { otpInput } from "../components/otp.js";
import { phoneField } from "../components/phone-field.js";
import { mountSeals } from "../components/seal.js";
import { inWindow, isInAppBrowser, nightOf, nightOfBooking, notesProblem, visibleLength, windowDates } from "../lib/cliente.js";
import { get as remembered, set as remember } from "../lib/cookies.js";
import { daysBetween, weekdayOf } from "../lib/dates.js";
import { html, nothing, render } from "../lib/html.js";
import { clearIdempotencyKey, idempotencyKeyFor, settleIdempotencyKey } from "../lib/idempotency.js";
import { track } from "../lib/measure.js";
import { COUNTRIES, countryOf, formatPhone } from "../lib/phone.js";
import { session } from "../lib/storage.js";
import { getLocale, setLocale, t } from "../lib/strings.js";
import { turnstileToken } from "../lib/turnstile.js";
import { rules } from "../lib/validate.js";
import * as api from "../services/api/index.js";
import {
  IS_MOCK,
  calendarView,
  catalog,
  copyText,
  catalogKey,
  dayName,
  hour,
  houseWhatsapp,
  isBookable,
  isClosedDay,
  localPath,
  noticeView,
  reasonOf,
  receiptBlock,
  sayView,
  varsOf,
  zoneNote,
} from "./cliente-ui.js";
import { cookies, themeToggle } from "./site-chrome.js";

const FLAGS = ["birthday", "high_chair", "accessibility", "dietary"];
const KEY = "reserva";
const DRAFT = `reserva:rascunho:${location.pathname}`;
const DRAFT_MIN = 30;
const REMEMBER = "trt:lembrar";
const NOTES_MAX = 280;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

const s = {
  phase: "escolha", // escolha (com os detalhes embaixo depois de escolher um horário), codigo, pronto
  house: null,
  me: null,
  party: 2,
  big: false, // "9 ou mais"
  bigCount: null,
  bigName: "",
  bigDate: "",
  bigTime: "",
  days: [],
  date: null,
  askedDay: null,
  day: null,
  time: null,
  waitlist: false,
  mode: "table", // mesa ou lista, numa noite de evento com lista
  loading: { days: false, slots: false },
  failed: null, // o que não deu para ler: casa, dias ou horários
  name: "",
  phone: null,
  phoneConfirmed: false,
  notes: "",
  flags: [],
  agree: false,
  keep: false,
  resendAt: 0,
  codeAt: 0,
  notArrived: false,
  notice: null,
  busy: false,
  receipt: null,
  alternatives: null,
  offline: typeof navigator !== "undefined" && navigator.onLine === false,
  loadedAt: 0,
  night: null,
  said: null,
  copied: null, // "Copiar o link" dentro do Instagram: copiado ou não
  expanded: {},
  startedAt: new Date().toISOString(),
};

const cache = { days: new Map(), slots: new Map() };
let flow;
let summary;
let whatsapp;
let field = null;
let lastLit = "";
let houseReady = Promise.resolve(); // os dias esperam a casa: o relógio dela diz que noite é hoje
const wired = new WeakSet();

const maxOnline = () => s.house?.booking?.party_max_online ?? 8;
/** Os combinados no idioma da página, como o dono escreveu em Combinados (português onde faltar). */
const localTerms = (terms) => terms?.locales?.[getLocale()] || terms?.locales?.pt || terms || null;
const acceptLabel = () => localTerms(s.house?.terms)?.accept_label || null;
const bigPath = () => s.house?.booking?.large_group_action || "whatsapp";
/** As pessoas para quem os horários são lidos: um grupo grande vê os horários da casa como para a maior mesa on-line. */
const partyForTimes = () => (s.big ? maxOnline() : s.party);
const bookingNight = () => nightOf(s.house?.server_time ? new Date(s.house.server_time) : new Date(), s.house?.night_cutoff);
const windowDays = () => s.house?.booking?.window_days ?? 30;

/** O WhatsApp da casa com o que já foi escolhido. */
const wa = (extra = {}) =>
  houseWhatsapp(s.house, whatsapp, { name: s.name || s.bigName, party: s.big ? s.bigCount : s.party, date: s.date || s.bigDate || null, time: s.time || s.bigTime || null, ...extra });

/** O aviso de um erro, com o próximo passo da casa (tentar de novo, WhatsApp). */
function noticeFor(error, { at = "form", context = "", retry = null } = {}) {
  const key = catalogKey(error, context);
  const offline = ["network", "timeout", "server", "bad_response", "unknown", "offline"].includes(key);
  return {
    at,
    key,
    vars: varsOf(error),
    retry: retry && (offline || key === "turnstile_failed" || key === "validation.idempotency") ? retry : null,
    retryLabel: key === "validation.idempotency" ? t("cliente.reload") : null,
    wa: offline || ["customer_blocked", "party_too_large", "rate_limited.otp", "rate_limited.otp_house", "validation.honeypot", "phone_country_unsupported", "outside_cancel_window"].includes(key) ? wa() : null,
  };
}

// ---- o rascunho: guardado nesta aba enquanto a pessoa vai ao WhatsApp pelo código ----

function saveDraft() {
  if (s.phase === "pronto") return;
  const keys = ["phase", "party", "big", "bigCount", "bigName", "bigDate", "bigTime", "date", "time", "waitlist", "mode", "name", "phone", "phoneConfirmed", "notes", "flags", "agree", "keep", "resendAt", "codeAt"];
  session.set(DRAFT, { ...Object.fromEntries(keys.map((k) => [k, s[k]])), savedAt: Date.now() });
}

function restoreDraft() {
  const d = session.get(DRAFT);
  if (!d || Date.now() - d.savedAt > DRAFT_MIN * 60_000) return false;
  // só vale trazer de volta um rascunho com algo digitado ou com o código a caminho
  if (d.phase !== "codigo" && !d.time && !d.bigName && !d.big) return false;
  Object.assign(s, d);
  if (s.phase !== "codigo") s.phase = "escolha";
  return true;
}

// ---- dados, guardados por pessoas e por dia para ir e voltar ser instantâneo ----

async function loadDays() {
  const party = partyForTimes();
  if (cache.days.has(party)) s.days = cache.days.get(party);
  s.loading.days = !cache.days.has(party);
  if (s.failed === "days") s.failed = null;
  draw();
  try {
    await houseReady;
    const today = bookingNight();
    s.night = today;
    const dates = windowDates(today, windowDays());
    // a janela inteira, em pedaços que a API aceita (FR-16: 30 noites por padrão, até 120)
    const parts = [];
    for (let i = 0; i < dates.length; i += 60) parts.push(dates.slice(i, i + 60));
    const answers = await Promise.all(parts.map((p) => api.availability.getDays({ from: p[0], to: p.at(-1), partySize: party })));
    const days = answers.flatMap((a) => a.days).filter((d) => dates.includes(d.date));
    cache.days.set(party, days);
    s.loadedAt = Date.now();
    if (partyForTimes() !== party) return; // a pessoa mudou isso nesse meio-tempo
    s.days = days;
    if (s.notice?.at === "top" && s.failed == null) s.notice = null;
  } catch (error) {
    s.failed = "days";
    s.notice = noticeFor(error, { at: "top", retry: () => loadDays() });
  }
  s.loading.days = false;
  pickStartingDay();
  draw();
  if (s.date && !s.big) await loadSlots();
  else if (s.date && bigPath() === "request") await loadSlots();
  prefetch();
}

/** ?dia= dentro da janela já vem escolhido; um dia fechado diz por quê; o resto é ignorado. */
function pickStartingDay() {
  const today = s.night;
  const still = s.days.find((d) => d.date === s.date && !isClosedDay(d) && d.state !== "no_booking");
  if (s.askedDay) {
    const asked = s.days.find((d) => d.date === s.askedDay);
    const valid = asked && inWindow(s.askedDay, today, windowDays());
    s.askedDay = null;
    if (valid && !isClosedDay(asked) && asked.state !== "no_booking") {
      s.date = asked.date;
      return;
    }
    if (valid && isClosedDay(asked)) s.notice = { at: "top", status: true, text: t("book.askedDayClosed", { day: dayName(asked.date), reason: reasonOf(asked) }) };
    s.date = null;
  } else if (still) {
    return;
  }
  s.date = s.days.find(isBookable)?.date || null;
}

async function fetchSlots(date, party) {
  const key = `${party}|${date}`;
  if (!cache.slots.has(key)) cache.slots.set(key, api.availability.getSlots({ date, partySize: party }));
  try {
    return await cache.slots.get(key);
  } catch (error) {
    cache.slots.delete(key);
    throw error;
  }
}

async function loadSlots({ fresh = false } = {}) {
  const { date } = s;
  const party = partyForTimes();
  if (!date) return;
  if (fresh) cache.slots.delete(`${party}|${date}`);
  s.loading.slots = true;
  if (s.failed === "slots") s.failed = null;
  draw();
  try {
    const day = await fetchSlots(date, party);
    if (s.date !== date || partyForTimes() !== party) return;
    s.day = day;
    if (!day.slots?.length && day.list) s.mode = "list";
    else if (!day.list) s.mode = "table";
    const times = timesOf(day);
    if (s.time && !times.some((x) => x.time === s.time && x.state !== "past")) s.time = null;
    if (s.notice?.at === "horas" && !s.alternatives) s.notice = null;
  } catch (error) {
    s.failed = "slots";
    s.notice = noticeFor(error, { at: "horas", retry: () => loadSlots({ fresh: true }) });
  }
  s.loading.slots = false;
  draw();
  lightUp();
}

/** Os horários dos próximos dias abertos, em silêncio, para um toque neles responder na hora. */
function prefetch() {
  for (const d of s.days.filter(isBookable).slice(0, 4)) fetchSlots(d.date, partyForTimes()).catch(() => {});
}

/** Os horários para escolher: os das mesas, ou os horários de entrada da lista numa noite de evento. */
function timesOf(day) {
  if (!day) return [];
  if (s.mode === "list" && day.list) {
    const state = day.list.state;
    return day.list.entry_times.map((time) => ({ time, state, waitlist_open: day.list.waitlist_open, remaining: day.list.remaining }));
  }
  return (day.slots || []).filter((x) => x.state !== "past");
}

// ---- escolhas ----

function pickParty(value) {
  if (value === "big") {
    if (s.big) return;
    s.big = true;
    s.bigCount = Math.max(s.bigCount || 0, maxOnline() + 1);
    s.party = s.bigCount;
    s.time = null;
    s.notice = null;
    track("book_party", { party: maxOnline() + 1, big: true });
    loadDays();
    requestAnimationFrame(() => flow.querySelector("#reserva-grupo-n")?.focus());
    return;
  }
  if (Number(value) === s.party && !s.big) return;
  s.big = false;
  s.party = Number(value);
  s.notice = null;
  track("book_party", { party: s.party });
  loadDays();
}

function pickDay(value) {
  if (value === s.date) return;
  s.date = value;
  s.day = null;
  s.alternatives = null;
  if (s.notice?.at !== "top" || !s.failed) s.notice = null;
  track("book_day", { weekday: weekdayOf(value), lead_days: daysBetween(s.night || value, value) });
  loadSlots();
}

function pickSlot(value) {
  const slot = timesOf(s.day).find((x) => x.time === value);
  const first = !s.time;
  s.time = value;
  s.waitlist = slot?.state === "full";
  s.alternatives = null;
  if (s.notice?.at === "horas") s.notice = null;
  track("book_time", { time: value, weekday: weekdayOf(s.date), full: s.waitlist });
  draw();
  if (first) reveal(".reserva__dados", "#reserva-nome");
}

function pickMode(mode) {
  if (s.mode === mode) return;
  s.mode = mode;
  s.time = null;
  draw();
}

/** Escolher um dos horários oferecidos depois de "lotou": o dia muda se preciso, os detalhes ficam. */
async function takeAlternative(alt) {
  s.alternatives = null;
  s.notice = null;
  if (alt.date !== s.date) {
    s.date = alt.date;
    s.day = null;
    await loadSlots();
  }
  pickSlot(alt.time);
}

/** Rola a parte nova até a vista (com suavidade) e põe o cursor onde a pessoa continua. */
function reveal(selector, focus) {
  requestAnimationFrame(() => {
    const block = flow.querySelector(selector);
    block?.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" });
    const target = focus && flow.querySelector(focus);
    if (target && !target.value) target.focus({ preventScroll: true });
  });
}

/** A janela do site aprovado: os vidros escurecem, depois acendem um a um, quando os horários mudam. */
function lightUp() {
  const key = `${s.party}|${s.date}|${s.mode}`;
  const grid = flow.querySelector(".slots");
  if (!grid || key === lastLit || reduced()) return;
  lastLit = key;
  const panes = [...grid.querySelectorAll(".slot:not(.is-full)")];
  grid.classList.add("is-dimming");
  panes.forEach((pane, i) => setTimeout(() => pane.classList.add("is-lit"), 90 + i * 85));
  setTimeout(() => {
    grid.classList.remove("is-dimming");
    panes.forEach((pane) => pane.classList.remove("is-lit"));
  }, 90 + panes.length * 85 + 500);
}

// ---- detalhes, código, reserva ----

/** O que o formulário tem, guardado no estado a cada tecla (e no rascunho). */
function readForm(form) {
  s.name = form.nome.value;
  s.notes = form.obs?.value ?? s.notes;
  s.flags = FLAGS.filter((f) => form[`flag-${f}`]?.checked);
  s.agree = form.combinado.checked;
  s.keep = form.lembrar?.checked ?? false;
}

function onFormInput(event) {
  const form = event.currentTarget;
  const before = s.flags.includes("dietary");
  readForm(form);
  saveDraft();
  if (event.target.name === "obs") updateCounter(form);
  if (before !== s.flags.includes("dietary")) draw();
}

/** O contador da observação: o que o olho vê, nunca cortado; passando do limite, uma mensagem no lugar. */
function updateCounter(form) {
  draw(); // o contador faz parte da vista: o que o olho vê, nunca cortado
  const problem = notesProblem(form.obs.value, NOTES_MAX);
  setFieldError(form.obs, problem ? (problem.kind === "long" ? t("book.notesOver", { count: problem.count, max: NOTES_MAX }) : t("validation.noLinks")) : null);
}

async function submitDetails(event) {
  event.preventDefault();
  const form = event.currentTarget;
  readForm(form);
  s.name = s.name.trim();
  const invalid = [];
  const nameError = rules.name(s.name);
  setFieldError(form.nome, nameError);
  if (nameError) invalid.push(form.nome);
  if (!s.me || s.me.phone_verified === false) {
    const e164 = field?.validate();
    if (!e164) invalid.push(form.tel);
    else {
      s.phone = e164;
      s.phoneConfirmed = true;
    }
  }
  const notes = notesProblem(s.notes, NOTES_MAX);
  if (notes) {
    form.querySelector(".reserva__mais").open = true;
    setFieldError(form.obs, notes.kind === "long" ? t("book.notesOver", { count: notes.count, max: NOTES_MAX }) : t("validation.noLinks"));
    invalid.push(form.obs);
  }
  if (!s.agree) invalid.push(form.combinado);
  if (invalid.length) {
    s.notice = { at: "form", key: "validation", vars: {}, body: !s.agree ? html`<span class="aviso__texto">${t("validation.agree")}</span>` : nothing };
    draw();
    const phoneWaits = invalid[0] === form.tel && field?.state.e164 && !field.state.confirmed;
    if (!phoneWaits) invalid[0].focus();
    return;
  }
  s.notice = null;
  track("book_details", { flags: s.flags.length, notes: Boolean(s.notes) });
  if (s.me && s.me.phone_verified !== false) return book();
  await sendCode();
}

async function sendCode() {
  s.busy = true;
  s.notice = null;
  draw();
  try {
    const sent = await api.auth.sendOtp(s.phone, { turnstileToken: await turnstileToken() });
    s.resendAt = Date.now() + (sent?.resend_after_s ?? 30) * 1000;
    s.codeAt = Date.now();
    s.notArrived = false;
    s.phase = "codigo";
    track("book_code_sent");
  } catch (error) {
    s.notice = noticeFor(error, { at: s.phase === "codigo" ? "codigo" : "form", context: "otp", retry: sendCode });
    if (s.notice.key === "phone_country_unsupported") s.notice.wa = wa();
  }
  s.busy = false;
  saveDraft();
  draw();
  if (s.phase === "codigo") reveal(".reserva__codigo", ".otp__input");
}

let otp = null;

async function verify(code) {
  s.busy = true;
  s.notice = null;
  draw();
  try {
    if (s.me && s.me.phone_verified === false) {
      s.me = await api.auth.changePhone({ phone: s.phone, code }); // uma conta Google confirma o seu WhatsApp
    } else {
      const session = await api.auth.verifyOtp({ phone: s.phone, code, name: s.name, rememberDevice: true, locale: getLocale() });
      s.me = session.customer;
    }
    await book();
    return;
  } catch (error) {
    const key = catalogKey(error, "otp");
    s.notice = { at: "codigo", key, vars: varsOf(error), retry: key === "gone.otp" ? sendCode : null, retryLabel: key === "gone.otp" ? t("book.resend") : null };
    otp?.clear();
    track("book_error", { type: error?.type || "unknown", step: "code" });
  }
  s.busy = false;
  draw();
  flow.querySelector(".reserva__codigo .aviso")?.focus();
}

/** "Lembrar de mim": a caixa é o sim para essa categoria; os detalhes ficam neste aparelho. */
function keepDetails() {
  if (s.keep && !readChoice()?.remember) setCategory("remember", true);
  if (!s.keep && readChoice()?.remember) setCategory("remember", false);
  if (s.keep) remember(REMEMBER, { name: s.name, phone: s.phone || remembered(REMEMBER)?.phone || null, party: s.big ? null : s.party });
}

/** Outra reserva ativa na mesma noite: pergunta antes de fazer uma segunda (same_day_reservation). */
async function sameNightOk() {
  try {
    const mine = await api.reservations.mine();
    const night = nightOfBooking(s.date, s.time);
    const other = (mine.upcoming || mine.items || []).find(
      (r) => ["pending", "confirmed"].includes(r.status) && nightOfBooking(r.date, r.time) === night && r.time !== s.time,
    );
    if (!other) return true;
    const entry = catalog("same_day_reservation", { time: hour(other.time) });
    return confirmAction({ title: entry.title, message: entry.text, confirmLabel: entry.action, cancelLabel: t("common.back") });
  } catch {
    return true; // a casa confere de novo; nada a perguntar aqui
  }
}

function requestBody() {
  const listArea = s.mode === "list" ? s.day?.areas?.find((a) => a.mode === "list")?.key : undefined;
  return {
    party_size: s.big ? s.bigCount : s.party,
    date: s.date,
    time: s.time,
    name: s.name.trim(),
    notes: s.notes.trim() || undefined,
    flags: s.flags,
    terms_version: s.house?.terms?.version,
    waitlist: s.waitlist || undefined,
    area_key: listArea,
    event_id: s.day?.event?.id ?? undefined,
    locale: getLocale(),
  };
}

async function book({ retried = false, asked = false } = {}) {
  if (!asked && !(await sameNightOk())) {
    s.busy = false;
    s.phase = "escolha";
    s.notice = { at: "form", status: true, text: t("book.sameNightKept"), links: [{ href: localPath("/minhas-reservas/"), label: t("cliente.receipt.mine") }] };
    draw();
    return;
  }
  s.busy = true;
  if (!retried) s.notice = null;
  draw();
  const body = requestBody();
  const key = idempotencyKeyFor(KEY, body);
  try {
    s.receipt = await api.reservations.create({ ...body, started_at: s.startedAt, turnstile_token: await turnstileToken() }, key);
    clearIdempotencyKey(KEY);
    keepDetails();
    session.remove(DRAFT);
    s.phase = "pronto";
    s.notice = null;
    cache.slots.clear();
    cache.days.clear();
    track("book_done", { status: s.receipt.status, party: body.party_size, weekday: weekdayOf(s.date), time: s.time, lead_days: daysBetween(s.night || s.date, s.date) });
  } catch (error) {
    settleIdempotencyKey(KEY, error);
    s.busy = false;
    track("book_error", { type: error?.type || "unknown", step: "book" });
    // uma resposta que se perdeu no caminho: o mesmo pedido vai de novo uma vez, com a mesma chave
    if (!retried && ["network", "timeout"].includes(error?.type) && navigator.onLine !== false) return book({ retried: true, asked: true });
    await bookFailed(error);
  }
  s.busy = false;
  draw();
  if (s.phase === "pronto") reveal(".reserva__pronto");
}

async function bookFailed(error) {
  const type = error?.type;
  const body = error?.body || {};
  if (type === "slot_full") {
    const key = catalogKey(error);
    const chosen = { date: s.date, time: s.time, waitlistOpen: false };
    if (body.reason === "day_closed" || body.reason === "event_mode") {
      cache.days.clear();
      await loadDays();
    } else {
      cache.slots.delete(`${partyForTimes()}|${s.date}`);
      await loadSlots({ fresh: true });
      chosen.waitlistOpen = Boolean(timesOf(s.day).find((x) => x.time === chosen.time && x.state === "full" && x.waitlist_open));
    }
    s.phase = "escolha";
    s.time = null;
    s.alternatives = (body.alternatives || []).filter((a) => a.date !== chosen.date || a.time !== chosen.time);
    s.notice = {
      at: "horas",
      key,
      vars: { reason: body.reason_label ? `${t("cliente.dayClosedBecause", { reason: body.reason_label })}` : "" },
      body: chosen.waitlistOpen
        ? html`<button class="btn btn--sm btn--outline" type="button" @click=${() => { s.waitlist = true; pickSlot(chosen.time); }}>${t("book.joinWaitlistAt", { time: hour(chosen.time) })}</button>`
        : nothing,
      wa: key !== "slot_full" ? wa({ time: chosen.time }) : null,
    };
    lastLit = "";
    draw();
    reveal(".reserva__horas");
    return;
  }
  if (type === "terms_outdated") {
    const terms = body.terms || (await api.house.getHouse().then((h) => h.terms).catch(() => null));
    if (terms) {
      s.house = { ...s.house, terms };
      showTerms(terms);
    }
    s.agree = false;
    const entry = catalog("terms_outdated");
    const items = localTerms(terms)?.items || [];
    const ok = await confirmAction({
      title: entry.title,
      message: `${entry.text} ${items.map((i, n) => `${n + 1}. ${[i.title, i.text].filter(Boolean).join(" ")}`).join(" ")}`,
      confirmLabel: acceptLabel() || t("book.agreeAgain"),
      cancelLabel: t("common.back"),
    });
    if (ok) {
      s.agree = true;
      return book({ asked: true });
    }
    s.notice = { at: "form", key: "terms_outdated", vars: {} };
    return;
  }
  if (type === "session_expired" || type === "unauthorized") {
    s.me = null;
    s.phase = "escolha";
    s.notice = { at: "form", key: "session_expired_draft", vars: {}, retry: s.phone ? sendCode : null, retryLabel: catalog("session_expired_draft").action };
    return;
  }
  if (type === "needs_whatsapp") {
    s.me = { ...s.me, phone_verified: false };
    s.phase = "escolha";
    s.notice = { at: "form", key: "google_needs_phone", vars: {} };
    return;
  }
  if (type === "duplicate_reservation" && body.existing) {
    s.phase = "escolha";
    const entry = catalog("duplicate_reservation");
    if (await confirmAction({ title: entry.title, message: entry.text, confirmLabel: entry.action, cancelLabel: t("common.back") })) location.assign(body.existing.receipt_url);
    s.notice = { at: "form", key: "duplicate_reservation", vars: {}, links: [{ href: body.existing.receipt_url, label: entry.action }] };
    return;
  }
  if (type === "active_limit") {
    s.phase = "escolha";
    const entry = catalog("active_limit", { max: body.max ?? 2 });
    if (await confirmAction({ title: entry.title, message: entry.text, confirmLabel: entry.action, cancelLabel: t("common.back") })) location.assign(localPath("/minhas-reservas/"));
    s.notice = { at: "form", key: "active_limit", vars: { max: body.max ?? 2 }, wa: wa(), links: [{ href: localPath("/minhas-reservas/"), label: entry.action }] };
    return;
  }
  if (type === "validation" && error.errors?.length && !body.reason) {
    const form = flow.querySelector("form.reserva__dados");
    for (const e of error.errors) {
      if (e.field === "notes" && form?.obs) {
        form.querySelector(".reserva__mais").open = true;
        setFieldError(form.obs, e.code === "too_long" ? t("book.notesOver", { count: e.count, max: e.max }) : t("validation.noLinks"));
      }
      if (e.field === "name" && form?.nome) setFieldError(form.nome, rules.name(s.name) || e.message);
      if (e.field === "date") s.notice = { at: "horas", status: false, text: t("book.outsideWindow") };
    }
    if (!s.notice) s.notice = { at: "form", key: "validation", vars: {} };
    return;
  }
  s.notice = noticeFor(error, { at: "form", context: "draft", retry: () => book({ asked: true }) });
}

/** Os combinados ao lado seguem a versão com que a casa responde. */
function showTerms(terms) {
  const list = document.querySelector(".reserva__combinados");
  const items = localTerms(terms)?.items;
  if (!list || !items) return;
  if (!wired.has(list)) {
    wired.add(list);
    list.replaceChildren(); // a cópia do build dá lugar ao que a casa publica agora
  }
  render(html`${items.map((i) => html`<li>${i.title ? html`<b>${i.title}</b> ` : nothing}${i.text}</li>`)}`, list);
}

// ---- vistas ----

function partyView() {
  const max = maxOnline();
  return html`<fieldset class="reserva__passo">
    <legend class="reserva__titulo"><span class="reserva__num">1</span>${t("book.howMany")}</legend>
    <div class="tiles" role="radiogroup" aria-label=${t("book.howMany")} data-group="party">
      ${Array.from({ length: max }, (_, i) => i + 1).map(
        (n) => html`<button type="button" class="tile" role="radio" data-value=${n} aria-checked=${String(!s.big && s.party === n)} aria-label=${people(n)}>${n}</button>`,
      )}
      <button type="button" class="tile tile--mais" role="radio" data-value="big" aria-checked=${String(s.big)}>${t("book.bigTile", { n: max + 1 })}</button>
    </div>
    ${s.big ? bigCountView(max) : nothing}
  </fieldset>`;
}

function bigCountView(max) {
  const onCount = (event) => {
    const n = Number(event.target.value);
    s.bigCount = Number.isInteger(n) && n > max ? n : max + 1;
    s.party = s.bigCount;
    saveDraft();
    if (bigPath() === "whatsapp") draw();
  };
  return html`<div class="field reserva__grupo-n">
    <label class="field__label" for="reserva-grupo-n">${t("book.bigCount")}</label>
    <input class="field__input" id="reserva-grupo-n" type="number" inputmode="numeric" min=${max + 1} max="200" .value=${String(s.bigCount ?? max + 1)} @input=${onCount}>
    <p class="field__help">${bigPath() === "request" ? t("book.bigRequestHelp") : t("book.bigWhatsappHelp", { max })}</p>
  </div>`;
}

/** "9 ou mais" com o WhatsApp da casa: a mensagem está pronta, com o que a pessoa preencheu. */
function bigView() {
  const open = s.days.filter((d) => d.open && d.state !== "closed");
  const weekday = s.bigDate ? weekdayOf(s.bigDate) : null;
  const times = weekday == null ? [] : s.house?.hours?.find((h) => h.weekday === weekday)?.slots || [];
  const set = (key) => (event) => {
    s[key] = event.target.value;
    if (key === "bigDate") s.bigTime = "";
    saveDraft();
    draw();
  };
  const link = houseWhatsapp(s.house, whatsapp, { name: s.bigName, party: s.bigCount, date: s.bigDate || null, time: s.bigTime || null });
  return html`<section class="reserva__passo reserva__grupo reserva__entra" aria-labelledby="grupo-titulo">
    <h2 class="reserva__titulo" id="grupo-titulo"><span class="reserva__num">2</span>${t("book.bigTitle")}</h2>
    <p class="prose">${t("book.bigLead", { n: s.bigCount })}</p>
    <div class="reserva__grupo-campos">
      <div class="field">
        <label class="field__label" for="grupo-nome">${t("book.bigName")}</label>
        <input class="field__input" id="grupo-nome" autocomplete="name" maxlength="60" .value=${s.bigName} @input=${set("bigName")}>
      </div>
      <div class="field">
        <label class="field__label" for="grupo-dia">${t("book.bigDay")}</label>
        <select class="field__input" id="grupo-dia" @change=${set("bigDate")}>
          <option value="" ?selected=${!s.bigDate}>${t("book.bigAnyDay")}</option>
          ${open.map((d) => html`<option value=${d.date} ?selected=${s.bigDate === d.date}>${dayName(d.date)}${d.event?.title ? ` · ${d.event.title}` : ""}</option>`)}
        </select>
      </div>
      <div class="field">
        <label class="field__label" for="grupo-hora">${t("book.bigTime")}</label>
        <select class="field__input" id="grupo-hora" ?disabled=${!times.length} @change=${set("bigTime")}>
          <option value="" ?selected=${!s.bigTime}>${t("book.bigAnyTime")}</option>
          ${times.map((time) => html`<option value=${time} ?selected=${s.bigTime === time}>${hour(time)}</option>`)}
        </select>
      </div>
    </div>
    <div class="reserva__acoes"><a class="btn btn--lg" href=${link} rel="noopener" data-grupo-whatsapp>${t("book.bigLink")}</a></div>
    <p class="reserva__dica">${t("book.bigAfter")}</p>
  </section>`;
}

function daysView() {
  const busy = s.loading.days;
  const today = s.night;
  const dates = today ? windowDates(today, windowDays()) : [];
  const zone = zoneNote(s.house?.server_time ? new Date(s.house.server_time) : new Date());
  const full = s.days.length && !s.days.some(isBookable) && !s.loading.days;
  return html`<fieldset class="reserva__passo" aria-busy=${String(busy)}>
    <legend class="reserva__titulo"><span class="reserva__num">2</span>${t("book.whichDay")}</legend>
    ${full ? noticeView({ key: "window_full", wa: wa(), links: [{ href: `https://www.instagram.com/${(s.house?.instagram || "_territorio_").replace(/^@/, "")}/`, label: t("book.instagram") }] }) : nothing}
    ${s.days.length && dates.length
      ? calendarView({ dates, days: s.days, chosen: s.date, today, label: t("book.whichDay"), busy })
      : html`<div class="skeleton skeleton--block" aria-label=${t("common.loading")}></div>`}
    ${zone ? html`<p class="reserva__dica zona">${t("book.zoneDays")}</p>` : nothing}
  </fieldset>`;
}

function nextDaysView() {
  const after = s.days.filter((d) => d.date > s.date && isBookable(d)).slice(0, 4);
  if (!after.length) return nothing;
  return html`<span class="aviso__acoes">${after.map((d) => html`<button class="btn btn--sm btn--outline" type="button" @click=${() => pickDay(d.date)}>${dayName(d.date)}</button>`)}</span>`;
}

function slotsView() {
  if (!s.date) return nothing;
  const day = s.day;
  const busy = s.loading.slots;
  const notice = s.notice?.at === "horas" ? s.notice : null;
  const head = html`<legend class="reserva__titulo"><span class="reserva__num">3</span>${t("book.whatTime")}</legend>`;
  if (!day) {
    return html`<fieldset class="reserva__passo reserva__horas" aria-busy="true">${head}${noticeView(notice)}
      ${s.failed === "slots" ? nothing : html`<div class="skeleton skeleton--block" aria-label=${t("common.loading")}></div>`}</fieldset>`;
  }
  if (day.state === "no_booking") {
    return html`<fieldset class="reserva__passo reserva__horas">${head}
      <p class="notice" role="status"><strong>${t("cliente.freeEntry")}</strong> ${day.event?.title ? t("book.freeEntryText", { event: day.event.title }) : t("book.freeEntryPlain")}</p></fieldset>`;
  }
  if (!day.open) {
    return html`<fieldset class="reserva__passo reserva__horas">${head}${noticeView(notice)}
      <p class="notice" role="status">${t("book.dayClosed", { reason: reasonOf(day) })}</p></fieldset>`;
  }
  const mixed = day.slots?.length && day.list;
  const times = timesOf(day);
  const bookable = times.filter((x) => x.state === "available" || x.state === "few_left");
  const dayFull = !bookable.length && !s.big;
  const zone = zoneNote(new Date(`${s.date}T20:00:00-03:00`));
  return html`<fieldset class="reserva__passo reserva__horas" aria-busy=${String(busy)}>
    ${head}
    ${day.event?.title ? html`<p class="reserva__evento"><b>${day.event.title}</b> ${t(`book.eventMode.${day.event.booking_mode}`, { n: day.list?.capacity ?? "" })}</p>` : nothing}
    ${noticeView(notice)}
    ${s.alternatives?.length
      ? html`<div class="reserva__alternativas" role="group" aria-label=${t("book.alternatives")}>
          <p class="reserva__dica">${t("book.alternatives")}</p>
          <div class="aviso__acoes">${s.alternatives.map((a) => html`<button class="btn btn--sm btn--outline" type="button" @click=${() => takeAlternative(a)}>${a.date === s.date ? hour(a.time) : `${dayName(a.date)} · ${hour(a.time)}`}</button>`)}</div>
        </div>`
      : nothing}
    ${dayFull && !notice ? noticeView({ key: "day_full", status: true, body: nextDaysView() }) : nothing}
    ${mixed
      ? html`<div class="reserva__modo" role="radiogroup" aria-label=${t("book.modeLabel")} data-group="mode">
          <button type="button" class="tile" role="radio" data-value="table" aria-checked=${String(s.mode === "table")}>${t("book.modeTable")}</button>
          <button type="button" class="tile" role="radio" data-value="list" aria-checked=${String(s.mode === "list")}>${t("book.modeList", { n: day.list.remaining })}</button>
        </div>`
      : nothing}
    ${times.length
      ? html`<div class=${`slots${busy ? " is-carregando" : ""}`} role="radiogroup" aria-label=${t("book.whatTime")} data-group="slot">
          ${times.map((x) => {
            // um horário lotado cuja fila também está cheia (ou sem lista de espera on-line) é só "lotado" (7.15)
            const closedQueue = x.state === "full" && !x.waitlist_open;
            const label = s.mode === "list"
              ? t(closedQueue ? "book.listState.fullNoList" : `book.listState.${x.state}`, { n: x.remaining })
              : t(closedQueue ? "book.fullNoList" : `slot.${x.state}`);
            return html`<button
              type="button"
              class=${["slot", x.state === "few_left" ? "is-few" : "", x.state === "full" ? "is-full" : ""].join(" ")}
              role="radio"
              data-value=${x.time}
              aria-checked=${String(s.time === x.time)}
              aria-disabled=${String(x.state === "full" && !x.waitlist_open && !s.big)}
              aria-label=${`${hour(x.time)}, ${label}`}
            ><b>${hour(x.time)}</b><span>${label}</span></button>`;
          })}
        </div>`
      : html`<p class="reserva__dica">${t("book.noSlots")}</p>`}
    ${zone ? html`<p class="reserva__dica zona">${t("book.zoneTimes")}</p>` : nothing}
    ${s.waitlist ? html`<p class="notice" role="status">${t("book.waitlistNote")}</p>` : nothing}
  </fieldset>`;
}

function detailsView() {
  if (!s.time) return nothing;
  const saved = remembered(REMEMBER);
  const phone = s.phone || saved?.phone;
  const keep = s.keep || Boolean(saved);
  const needsPhone = !s.me || s.me.phone_verified === false;
  const notice = s.notice?.at === "form" ? s.notice : null;
  const dietary = s.flags.includes("dietary");
  const notesCount = visibleLength(s.notes.trim());
  return html`<form class="reserva__form reserva__dados reserva__entra" novalidate @submit=${submitDetails} @input=${onFormInput} @change=${onFormInput}>
    <h2 class="reserva__titulo"><span class="reserva__num">4</span>${t("book.yourDetails")}</h2>
    ${noticeView(notice)}
    <div class="field">
      <label class="field__label" for="reserva-nome">${t("book.name")}</label>
      <input class="field__input" id="reserva-nome" name="nome" autocomplete="name" maxlength="80" .value=${s.name || s.me?.name || saved?.name || ""} required>
    </div>
    ${!needsPhone
      ? html`<p class="reserva__dica">${t("book.signedAs", { phone: s.me.phone_masked })}</p>`
      : html`<div class="field" data-phone>
          <label class="field__label" for="reserva-tel">${t("book.whatsapp")}</label>
          <div class="phone">
            <select class="field__input" aria-label=${t("book.country")} .value=${phone ? countryOf(phone) : "BR"}>${COUNTRIES.map((c) => html`<option value=${c.id}>${c.label}</option>`)}</select>
            <input class="field__input" id="reserva-tel" name="tel" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="(45) 99999-0000" aria-describedby="reserva-tel-ajuda" .value=${phone ? formatPhone(phone) : ""} required>
          </div>
          <p class="field__help" id="reserva-tel-ajuda">${t("book.whatsappHelp")}</p>
        </div>`}
    <details class="reserva__mais" ?open=${Boolean(s.notes || s.flags.length)}>
      <summary>${t("book.flagsTitle")}</summary>
      <fieldset class="reserva__flags">
        <legend class="sr-only">${t("book.flagsTitle")}</legend>
        ${FLAGS.map((f) =>
          f === "dietary"
            ? html`<div class="reserva__flag-dieta">
                <label class="check"><input type="checkbox" name="flag-dietary" .checked=${dietary} aria-describedby=${dietary ? "aviso-dieta" : nothing}> ${t("book.flag.dietary")}</label>
                ${dietary
                  ? html`<p class="reserva__sensivel" id="aviso-dieta">${t("book.dietaryNotice")} <a class="link" href=${localPath("/privacidade/")}>${t("book.dietaryPrivacy")}</a></p>`
                  : nothing}
              </div>`
            : html`<label class="check"><input type="checkbox" name=${`flag-${f}`} .checked=${s.flags.includes(f)}> ${t(`book.flag.${f}`)}</label>`,
        )}
      </fieldset>
      <div class="field">
        <label class="field__label" for="reserva-obs">${t("book.notes")}</label>
        <textarea class="field__input" id="reserva-obs" name="obs" rows="3" aria-describedby="reserva-obs-conta" .value=${s.notes}></textarea>
        <p class=${`field__help reserva__contador${notesCount > NOTES_MAX ? " is-over" : ""}`} id="reserva-obs-conta" aria-live="polite">${notesCount}/${NOTES_MAX}</p>
      </div>
    </details>
    <label class="check reserva__lembrar"><input type="checkbox" name="lembrar" .checked=${keep}> ${t("book.keep")}</label>
    <label class="agree"><input type="checkbox" name="combinado" .checked=${s.agree}> <span>${acceptLabel()
      ? html`<strong class="agree__marca">${acceptLabel()}</strong>`
      : html`${t("book.agreeLead")} <strong class="agree__marca">${t("book.agreeMark")}</strong>`}</span></label>
    ${s.phase === "escolha"
      ? html`<div class="reserva__acoes">
          <button class="btn btn--lg" type="submit" ?disabled=${s.busy}>${!needsPhone ? t(s.waitlist ? "book.joinWaitlist" : s.big ? "book.sendRequest" : "book.confirm") : t("book.sendCode")}</button>
        </div>`
      : nothing}
  </form>`;
}

function googleOption() {
  if (!s.house?.booking?.google_login) return nothing;
  if (isInAppBrowser()) {
    // o Google se recusa dentro do Instagram: a saída é o navegador, com o link copiado (7.9)
    const entry = catalog("google_in_app_browser");
    const copy = async () => {
      s.copied = (await copyText(location.href)) ? "copied" : "copyFailed";
      draw();
    };
    return html`<span class="reserva__inapp" data-aviso="google_in_app_browser">
      <span class="reserva__dica"><strong>${entry.title}</strong> ${entry.text}</span>
      <button class="btn btn--sm btn--outline" type="button" @click=${copy}>${t("cliente.receipt.copyLink")}</button>
      ${s.copied ? html`<span class="reserva__dica" role="status">${t(`cliente.receipt.${s.copied}`)}</span>` : nothing}
    </span>`;
  }
  return html`<a class="btn btn--sm btn--outline" href=${googleHref()}>${t("cliente.google")}</a>`;
}

/** Para onde "Entrar com o Google" vai: o início no servidor (ou, na demonstração, a volta de exemplo). */
function googleHref() {
  const back = `${location.pathname}${location.search.replace(/[?&](auth_error|needs_phone)=[^&]*/g, "")}`;
  return IS_MOCK ? `${localPath("/entrar/")}?google=exemplo&volta=${encodeURIComponent(back)}` : api.auth.googleStartUrl(back);
}

/**
 * Volta do Google para a reserva (7.9): uma recusa mostra google_failed com "Tentar de novo"
 * e o código ainda lá; uma conta nova sem WhatsApp confirma o número antes de reservar;
 * uma conta com WhatsApp reserva sem o código.
 */
function backFromGoogle() {
  const query = new URLSearchParams(location.search);
  const at = s.time ? "form" : "top";
  if (query.has("auth_error")) {
    s.notice = { at, key: "google_failed", vars: {}, retry: () => location.assign(googleHref()) };
  } else if (s.me && s.me.phone_verified === false) {
    s.notice = { at, key: "google_needs_phone", vars: {}, status: true };
  }
  // o código estava a caminho quando a pessoa escolheu o Google: com a sessão aberta, ele não é preciso
  if (s.phase === "codigo" && s.me && s.me.phone_verified !== false) s.phase = "escolha";
}

function codeView() {
  const wait = Math.max(0, Math.ceil((s.resendAt - Date.now()) / 1000));
  const notice = s.notice?.at === "codigo" ? s.notice : null;
  return html`<div class="reserva__codigo reserva__entra">
    <h2 class="reserva__titulo"><span class="reserva__num">5</span>${t("book.codeTitle")}</h2>
    ${noticeView(notice)}
    <p class="prose">${t("book.codeSentTo", { phone: s.phone ? formatPhone(s.phone) : "" })}</p>
    <div class="field">
      <label class="field__label" for="reserva-codigo">${t("book.codeLabel")}</label>
      <div class="otp" data-otp>
        <input class="otp__input" id="reserva-codigo" inputmode="numeric" autocomplete="one-time-code" ?disabled=${s.busy} @input=${() => (s.codeAt = Date.now())}>
        <div class="otp__boxes" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span></div>
      </div>
      ${wait > 0 ? html`<p class="field__help">${catalog("otp_resend_wait", { seconds: wait }).title}. ${catalog("otp_resend_wait", { seconds: wait }).text}</p>` : nothing}
    </div>
    ${s.notArrived && !notice
      ? noticeView({
          key: "otp_not_arrived",
          status: true,
          body: html`<span class="aviso__acoes">
              <button class="btn btn--sm" type="button" ?disabled=${wait > 0 || s.busy} @click=${sendCode}>${t("book.resend")}</button>
              ${isInAppBrowser() ? nothing : googleOption()}
            </span>
            ${isInAppBrowser() ? googleOption() : nothing}`,
          wa: wa(),
        })
      : nothing}
    <div class="reserva__acoes">
      <button class="btn btn--outline" type="button" @click=${() => back()}>${t("book.changeNumber")}</button>
      <button class="btn btn--outline" type="button" ?disabled=${wait > 0 || s.busy} @click=${sendCode}>${wait > 0 ? t("book.resendIn", { s: wait }) : t("book.resend")}</button>
    </div>
  </div>`;
}

function back() {
  s.phase = "escolha";
  s.notice = null;
  saveDraft();
  draw();
  reveal(".reserva__dados", "#reserva-tel");
}

function toggle(name) {
  s.expanded = { ...s.expanded, [name]: !s.expanded[name] };
  draw();
}

function receiptView() {
  const r = s.receipt;
  const kind = r.status === "waitlisted" || r.status === "offered" ? "waitlist" : r.status === "pending" ? "pending" : "ok";
  return html`<div class="reserva__pronto reserva__entra">
    ${receiptBlock(r, { house: s.house, name: s.name, say: (key) => ((s.said = key), draw()), expanded: s.expanded, toggle })}
    ${sayView(s.said)}
    <p class="prose">${t(`book.after.${kind}`, { prazo: s.house?.booking?.cancel_until_hours ?? 2 })}</p>
    <div class="reserva__acoes">
      <a class="btn" href=${r.receipt_url}>${t("book.keepReceipt")}</a>
      <a class="btn btn--outline" href=${whatsapp} rel="noopener">${t("common.whatsappHouse")}</a>
    </div>
  </div>`;
}

function summaryView() {
  const b = s.house?.booking;
  const tolerance = b?.tolerance_min ?? 20;
  const party = s.big ? s.bigCount : s.party;
  const rows = [
    [t("book.sumPeople"), party ? people(party) : "—"],
    [t("book.sumDay"), s.date ? dayName(s.date) : "—"],
    [t("book.sumTime"), s.time ? (s.waitlist ? `${hour(s.time)} · ${t("status.waitlisted")}` : hour(s.time)) : "—"],
    [t("book.sumTolerance"), b?.late_notice_enabled && b.extra_tolerance_min > 0 ? t("book.toleranceRow", { n: tolerance, extra: b.extra_tolerance_min }) : t("book.minutes", { n: tolerance })],
  ];
  const done = s.phase === "pronto" ? 4 : s.phase === "codigo" ? 3 : s.time ? 2 : s.date ? 1 : 0;
  return html`<ol class="steps" style="--steps: 4" aria-label=${t("book.progress", { n: Math.min(done + 1, 4), total: 4 })}>
      ${[0, 1, 2, 3].map((i) => html`<li class=${i < done ? "is-done" : ""}></li>`)}
    </ol>
    <dl class="summary">${rows.map(([dt, dd]) => html`<div><dt>${dt}</dt><dd>${dd}</dd></div>`)}</dl>`;
}

function offlineView() {
  return s.offline ? noticeView({ key: "offline", status: true }) : nothing;
}

function draw() {
  const top = s.notice?.at === "top" ? s.notice : null;
  let body;
  if (s.phase === "pronto" && s.receipt) {
    try {
      body = receiptView();
      render(body, flow);
    } catch {
      // a reserva está feita: nunca mostrar como falha (receipt_render_failed)
      render(noticeView({ key: "receipt_render_failed", links: [{ href: localPath("/minhas-reservas/"), label: t("cliente.receipt.mine"), outline: false }] }), flow);
    }
  } else {
    const whatsappBig = s.big && bigPath() !== "request";
    body = html`${offlineView()}${noticeView(top)}${partyView()}${whatsappBig ? bigView() : html`${daysView()}${slotsView()}${detailsView()}${s.phase === "codigo" ? codeView() : nothing}`}`;
    render(body, flow);
  }
  render(summaryView(), summary);
  mountSeals(flow);
  wire();
}

/** Teclado e clique nos grupos de escolha, no campo de telefone e nas caixas do código (uma vez por elemento). */
function wire() {
  const handlers = { party: pickParty, day: pickDay, slot: pickSlot, mode: pickMode };
  for (const group of flow.querySelectorAll("[data-group]")) {
    if (!wired.has(group)) {
      wired.add(group);
      choiceGroup(group, handlers[group.dataset.group]);
    }
    syncChoiceGroup(group);
  }
  const phone = flow.querySelector("[data-phone]");
  if (phone && !wired.has(phone)) {
    wired.add(phone);
    field = phoneField(phone, {
      whatsappFor: () => wa(),
      onChange: (state) => {
        if (state.e164) s.phone = state.e164;
        s.phoneConfirmed = state.confirmed;
        saveDraft();
      },
    });
    if (s.phone && s.phoneConfirmed) field.trust(s.phone);
  }
  const box = flow.querySelector("[data-otp]");
  if (box && !wired.has(box)) {
    wired.add(box);
    otp = otpInput(box, { onComplete: verify });
  }
}

/** ?pessoas=4&dia=AAAA-MM-DD (FR-7) ou o que este aparelho lembra; senão 2 pessoas. */
function startingPoint() {
  const query = new URLSearchParams(location.search);
  const max = maxOnline();
  const asked = Number(query.get("pessoas"));
  const usual = Number(remembered(REMEMBER)?.party);
  if (Number.isInteger(asked) && asked > max) {
    s.big = true;
    s.bigCount = asked;
    s.party = asked;
  } else {
    s.party = [asked, usual, 2].find((n) => Number.isInteger(n) && n >= 1 && n <= max);
  }
  const day = query.get("dia");
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) s.askedDay = day;
}

/** De volta do WhatsApp depois de um tempo, ou depois da virada da noite: os horários são lidos de novo. */
function onVisible() {
  if (document.visibilityState === "hidden") return saveDraft();
  const stale = Date.now() - s.loadedAt > 5 * 60_000;
  const turned = s.night && bookingNight() !== s.night;
  if ((stale || turned) && s.phase !== "pronto") {
    cache.days.clear();
    cache.slots.clear();
    houseReady = api.house.getHouse().then(
      (value) => {
        s.house = value;
        showTerms(value?.terms);
      },
      () => s.house,
    );
    loadDays();
  }
}

boot(async () => {
  setLocale(document.documentElement.lang);
  themeToggle();
  cookies();
  const root = document.querySelector("[data-reserva]");
  if (!root) return;
  flow = root.querySelector("[data-reserva-fluxo]");
  summary = root.querySelector("[data-reserva-resumo]");
  whatsapp = root.dataset.whatsapp;
  root.classList.add("is-ligado");
  flow.replaceChildren(); // o aviso impresso dá lugar ao fluxo
  if (!api.capabilities.booking) {
    // o site sem a API (história 4.1, AR-13): o WhatsApp da casa com o que foi pedido
    const asked = new URLSearchParams(location.search);
    const party = Number(asked.get("pessoas")) || null;
    const day = /^\d{4}-\d{2}-\d{2}$/.test(asked.get("dia") || "") ? asked.get("dia") : null;
    const time = /^\d{2}:\d{2}$/.test(asked.get("hora") || "") ? asked.get("hora") : null;
    const house = await api.house.getHouse().catch(() => null);
    const link = houseWhatsapp(house, whatsapp, { party, date: day, time });
    render(noticeView({ key: "static_mode", vars: {}, status: true, wa: link, waLabel: catalog("static_mode").action }), flow);
    return;
  }
  const restored = restoreDraft();
  const query = new URLSearchParams(location.search);
  if (!restored || query.has("pessoas") || query.has("dia")) startingPoint();
  draw();
  houseReady = api.house.getHouse().then(
    (value) => {
      s.house = value;
      showTerms(value?.terms);
    },
    () => (s.house = null),
  );
  const [, me] = await Promise.allSettled([houseReady, api.auth.me(), loadDays()]);
  s.me = me.status === "fulfilled" ? me.value : null;
  if (!s.house) {
    s.failed = "house";
    s.notice = { at: "top", key: "network", vars: {}, retry: () => location.reload(), wa: wa() };
  }
  backFromGoogle();
  if (restored && s.phase === "codigo") reveal(".reserva__codigo", ".otp__input");
  draw();
  addEventListener("visibilitychange", onVisible);
  addEventListener("pagehide", saveDraft);
  addEventListener("offline", () => ((s.offline = true), draw()));
  addEventListener("online", () => {
    s.offline = false;
    if (s.failed === "days" || s.failed === "house") loadDays();
    else if (s.failed === "slots") loadSlots({ fresh: true });
    else draw();
  });
  setInterval(() => {
    if (s.phase !== "codigo") return;
    if (!s.notArrived && Date.now() - s.codeAt > 60_000 && !flow.querySelector(".otp__input")?.value) s.notArrived = true;
    draw();
  }, 1000);
});

