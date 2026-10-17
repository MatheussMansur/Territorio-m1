// Rotas públicas: a casa, o conteúdo, o cardápio e a disponibilidade.
import { http, HttpResponse } from "msw";
import images from "../../content/images.json";
import { addDays, houseParts } from "../../lib/dates.js";
import { dayAvailability, daysAvailability, localized, resolveDay } from "../availability.js";
import { fillTerms } from "../../lib/terms.js";
import { slugify } from "../../site/slug.js";
import { getState, save } from "../db.js";
import { mockNow, problem, respond } from "../scenario.js";

const API = "/api/v1";
const PARTY_MAX = 20;

/** Uma data de calendário real em YYYY-MM-DD (2026-02-31 não é). */
function isDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
const isParty = (n) => Number.isInteger(n) && n >= 1 && n <= PARTY_MAX;
const invalid = (errors) => problem(422, "validation", "Parâmetros inválidos", { errors });

/** Uma foto do site no formato que a API vai mandar (ImageRef). */
function imageRef(key, alt) {
  const img = images[key];
  if (!img) return null;
  const sources = ["avif", "webp", "jpeg"].flatMap((format) =>
    img.widths.map((width) => ({ format, width, url: `/img/fotos/${key}-${width}.${format === "jpeg" ? "jpg" : format}` })),
  );
  return { id: null, alt: alt || "", width: img.width, height: img.height, placeholder: img.placeholder, focal_x: 0.5, focal_y: 0.5, sources };
}

/** O dia como o site mostra: aberto ou não, horários, e o motivo quando não está. */
function dayStatus(state, date) {
  const day = resolveDay(state, date);
  return {
    date,
    open: day.open,
    opens_at: day.open ? day.opens_at : null,
    closes_at: day.open ? day.closes_at : null,
    // o outro turno do dia, quando o dono liga os dois turnos (história 2.8)
    second_shift: day.open ? (day.second_shift ?? null) : null,
    reason_label: day.open ? null : day.reason_label,
    // o motivo público nas três línguas ("produção", o nome do feriado, a frase da festa fechada)
    reason_labels: day.open ? null : (day.reason_labels ?? null),
    reason: day.open ? null : (day.reason ?? null),
    event_title: day.event?.title ?? null,
    exception: day.source !== "week",
  };
}

function housePublic(state, now) {
  const b = state.booking;
  const today = houseParts(now).date;
  return {
    server_time: now.toISOString(),
    name: state.house.name,
    tagline: state.house.tagline,
    address: state.house.address,
    whatsapp: state.house.whatsapp,
    instagram: state.house.instagram,
    timezone: state.house.timezone,
    hours: state.hours.map(({ weekday, open, label, opens_at, closes_at, slots, second_shift }) => ({ weekday, open, label, opens_at, closes_at, slots, second_shift: open ? (second_shift ?? null) : null })),
    hours_confirmed: state.hours_confirmed,
    booking: {
      window_days: b.window_days,
      min_lead_min: b.min_lead_min,
      party_max_online: b.party_max_online,
      large_group_action: b.large_group_action,
      tolerance_min: b.tolerance_min,
      extra_tolerance_min: b.extra_tolerance_min,
      after_tolerance: b.after_tolerance,
      late_notice_enabled: b.late_notice_enabled,
      customer_can_cancel_late: b.customer_can_cancel_late,
      no_shows_for_confirmation: b.approval_rules?.customer_no_shows_at_least ?? 1,
      duration_min: b.duration_rules[0]?.minutes ?? 120,
      cancel_until_hours: b.cancel_until_hours,
      waitlist_enabled: b.waitlist_enabled,
      google_login: b.google_login,
    },
    terms: termsPublic(state),
    areas: state.areas.map(({ key, name }) => ({ key, name })),
    // ontem (uma noite que fecha depois da meia-noite), hoje e toda a janela de reservas
    days: Array.from({ length: Math.max(14, b.window_days || 30) + 2 }, (_, i) => dayStatus(state, addDays(today, i - 1))),
    // o que o site lê de Configurações (Cardápio, Cookies, Eventos), para as páginas obedecerem
    settings: publicSettings(state),
  };
}

// os espelhos que Configurações grava a cada salvamento (menu_settings, cookies_settings…), senão o próprio grupo
const setting = (state, group) => ({ ...(state.settings?.[group]?.data || {}), ...(state[`${group}_settings`] || {}) });

/** As poucas configurações que as páginas públicas obedecem, ao vivo. */
export function publicSettings(state) {
  const menu = setting(state, "menu");
  const cookies = setting(state, "cookies");
  const events = setting(state, "events");
  return {
    menu: { unpriced_item: menu.unpriced_item === "ask" ? "ask" : "hide", show_sold_out: menu.show_sold_out !== false },
    cookies: { banner_version: cookies.banner_version || null, banner_text: localized(cookies.banner_text), measurement_enabled: cookies.measurement_enabled !== false },
    events: { site_agenda: events.site_agenda === "always" ? "always" : "only_with_event" },
  };
}

/** As configurações com os nomes que os modelos de combinados usam. */
const rulesOf = (b) => ({ ...b, no_shows_for_confirmation: b.approval_rules?.customer_no_shows_at_least ?? 1 });

// Os combinados como Configurações › Combinados mostra em "Como o cliente vê": os
// itens do dono em cada língua (português onde falta tradução), o item do tempo de
// mesa quando está ligado (com "sem limite" num dia livre), a frase firme com tolerância 0, e
// as palavras do botão de aceitar. As mesmas regras de src/admin/areas/configuracoes/preview.js.
const TERMS_LANGS = ["pt", "es", "en"];
const DURATION = { pt: "A mesa é de vocês por {tempo}.", es: "La mesa es de ustedes por {tempo}.", en: "The table is yours for {tempo}." };
const NO_LIMIT = { pt: "sem limite de tempo de mesa", es: "sin límite de tiempo de mesa", en: "no time limit on the table" };
const NO_LIMIT_LINE = { pt: "A mesa é de vocês, sem limite de tempo.", es: "La mesa es de ustedes, sin límite de tiempo.", en: "The table is yours, with no time limit." };
const NO_LIMIT_DAY = { pt: "{dia}: sem limite de tempo de mesa.", es: "{dia}: sin límite de tiempo de mesa.", en: "{dia}: no time limit on the table." };
const ON_OTHER_DAYS = { pt: "Nos outros dias: ", es: "Los otros días: ", en: "On the other days: " };
const WEEKDAYS = {
  pt: ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"],
  es: ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
};
const SHARP = {
  pt: "A mesa te espera no horário marcado, em ponto. Se precisar atrasar, avise a casa.",
  es: "La mesa te espera a la hora marcada, en punto. Si vas a llegar tarde, avisá a la casa.",
  en: "Your table waits for you at your time, sharp. If you'll be late, let the house know.",
};
const textIn = (value, lang) => (value == null ? "" : typeof value === "string" ? value : String(value[lang] ?? "").trim() || String(value.pt ?? ""));
const tableTime = (min) => (min < 60 ? `${min} min` : min % 60 ? `${Math.floor(min / 60)} h ${min % 60}` : `${min / 60} h`);

/** As linhas de tempo de mesa de uma língua: uma linha, ou os dias com tempo mais cada dia livre. */
function durationLines(booking, lang) {
  const days = booking.duration_by_weekday || [];
  const free = days.filter((d) => d.minutes == null);
  const timed = days.filter((d) => d.minutes != null);
  const line = (tempo) => DURATION[lang].replace("{tempo}", tempo);
  if (!free.length || !timed.length) {
    const minutes = timed.length ? (booking.duration_min ?? timed[0].minutes) : free.length ? null : booking.duration_min;
    return [minutes == null ? NO_LIMIT_LINE[lang] : line(tableTime(minutes))];
  }
  return [`${ON_OTHER_DAYS[lang]}${line(tableTime(timed[0].minutes))}`, ...free.map((d) => NO_LIMIT_DAY[lang].replace("{dia}", WEEKDAYS[lang][d.weekday]))];
}

/** Os combinados que o cliente lê, nas três línguas (histórias 2.9 e 7.5). */
export function termsPublic(state) {
  const b = state.booking;
  const doc = state.settings?.terms?.data || null;
  const booking = state.settings?.booking?.data || { duration_min: b.duration_rules?.[0]?.minutes ?? null };
  const items = doc?.items?.length ? doc.items : state.terms.items;
  const rules = rulesOf(b);
  const tempo = (lang) => (booking.duration_min == null ? NO_LIMIT[lang] : tableTime(booking.duration_min));
  const fill = (text, lang) => fillTerms(text, rules).replace(/\{tempo\}/g, tempo(lang));
  const locales = Object.fromEntries(
    TERMS_LANGS.map((lang) => {
      const list = items.map((item, i) => ({
        title: fill(textIn(item.title, lang), lang),
        text: i === 0 && b.tolerance_min === 0 ? SHARP[lang] : fill(textIn(item.text, lang), lang),
      }));
      if (doc?.show_duration_item) list.push(...durationLines(booking, lang).map((text) => ({ title: "", text })));
      return [lang, { items: list, accept_label: textIn(doc?.accept_label, lang).trim() || null }];
    }),
  );
  return { version: state.terms.version, items: locales.pt.items, locales };
}

/**
 * Guarda o que cada versão dos combinados dizia em cada língua, na primeira vez que é mostrada
 * ou aceita, para uma reserva sempre poder dizer o que a pessoa leu (guardado por língua).
 */
export function archiveTerms(state, terms = termsPublic(state)) {
  state.terms_archive ??= {};
  if (state.terms_archive[terms.version]) return false;
  state.terms_archive[terms.version] = { at: mockNow().toISOString(), locales: terms.locales };
  return true;
}

const published = (state, key) => state.site_blocks?.[key]?.published || null;

/** Avisos que ainda não acabaram, com a validade: a página compara as datas sozinha (história 4.4). */
function notices(state, now) {
  const items = published(state, "notices")?.items;
  const list = items
    ? items
        .filter((n) => n.starts_on && n.ends_on && localized(n.text))
        .map((n) => ({ id: n.id ?? null, text: localized(n.text), starts_at: `${n.starts_on}T00:00:00-03:00`, ends_at: `${addDays(n.ends_on, 1)}T00:00:00-03:00` }))
    : (state.content.notices || []).map((n) => ({ id: null, text: localized(n.text), starts_at: n.starts_at, ends_at: n.ends_at }));
  return list.filter((n) => now < new Date(n.ends_at)).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

/** A frase de cada dia da semana e a frase de sempre, nas três línguas. */
function phrases(state) {
  const today = published(state, "today");
  if (!today) {
    return {
      rules: Object.fromEntries((state.content.today_rules || []).map((r) => [r.weekday, localized(r.text)])),
      fallback: localized(state.content.today_default),
    };
  }
  const rules = {};
  for (const [weekday, text] of Object.entries(today.rules || {})) {
    const value = localized(text);
    if (value) rules[weekday] = value;
  }
  return { rules, fallback: localized(today.default) };
}

/** Os textos do próprio site como publicados na área Site (a capa e a casa), em três línguas. */
function texts(state) {
  const cover = published(state, "cover") || {};
  const about = published(state, "about") || {};
  const pick = (block, keys) => Object.fromEntries(keys.map((k) => [k, localized(block[k])]).filter(([, v]) => v));
  return { cover: pick(cover, ["kicker", "hand", "lede"]), about: pick(about, ["text", "hand", "story_1", "story_2"]) };
}

/** "Hoje na casa" para este instante, para clientes que não montam isso sozinhos. */
function todayLine(state, now) {
  const { date, weekday } = houseParts(now);
  const notice = notices(state, now).find((n) => new Date(n.starts_at) <= now);
  if (notice) return { kind: "notice", text: notice.text };
  const today = resolveDay(state, date);
  if (!today.open) return { kind: "closed", text: today.reason_labels || localized(today.reason_label) };
  if (today.event) return { kind: "event", text: localized(`${today.event.title} · ${today.event.starts_at}`) };
  const dish = state.menu.flatMap((c) => c.items).find((item) => item.featured && item.available);
  if (dish) return { kind: "dish", text: localized(dish.name) };
  const { rules, fallback } = phrases(state);
  return { kind: "rule", text: rules[weekday] || fallback };
}

/** A noite a que um instante pertence: uma festa que passa da meia-noite é "hoje" até as 05:00. */
const nightOf = (now) => houseParts(new Date(now.getTime() - 5 * 3_600_000)).date;

/** Uma foto da galeria como o site usa (ImageRef mais o crédito). */
function photo(state, imageId, fallbackAlt = "") {
  const img = imageId ? (state.images || []).find((i) => i.id === imageId) : null;
  if (!img) return null;
  const ref = img.key ? imageRef(img.key, img.alt || fallbackAlt) : null;
  const sources = ref?.sources || img.variants.map((v) => ({ format: v.format === "jpg" ? "jpeg" : v.format, width: v.width, url: v.url }));
  return { id: img.id, key: img.key || null, alt: img.alt || fallbackAlt, credit: img.credit || null, width: img.width, height: img.height, placeholder: img.placeholder, sources };
}

/** O que o site pode mostrar de um evento: nunca a nota interna, contagens ou planta. */
function eventPublic(state, event, night) {
  const { id, title, date, starts_at, ends_at, description, booking_mode, party_max, requires_approval } = event;
  const tr = event.translations || {};
  let noBooking = null;
  // por que não há botão de reserva: a frase da própria festa fechada, ou entrada livre
  if (booking_mode === "private") noBooking = localized(event.private_label, { pt: "Evento fechado", es: "Evento privado", en: "Private event" });
  else if (booking_mode === "none") noBooking = localized(event.free_label, { pt: "Entrada livre, sem reserva", es: "Entrada libre, sin reserva", en: "Free entry, no booking" });
  return {
    id,
    slug: slugify(title),
    title,
    title_i18n: localized({ pt: title, es: tr.es?.title, en: tr.en?.title }),
    date,
    starts_at,
    ends_at: ends_at ?? null,
    description,
    description_i18n: localized({ pt: description, es: tr.es?.description, en: tr.en?.description }),
    image: photo(state, event.image_id, title),
    booking_mode,
    no_booking_label: noBooking,
    party_max: party_max ?? null,
    requires_approval: Boolean(requires_approval),
    past: date < night,
    tonight: date === night,
  };
}

/** As fotos de "Ambiente" na ordem da galeria, com os créditos (história 3.8). */
function gallery(state) {
  return (state.images || [])
    .filter((img) => img.status === "ready" && (img.site_usages || []).includes("site:ambiente"))
    .sort((a, b) => a.sort - b.sort)
    .map((img) => ({ key: img.key, alt: img.alt, area: img.area || null, credit: img.credit || null }));
}

// cenário "vazio": toda noite aberta está lotada, mesas e lista.
function allFull(day) {
  if (!day.open || day.state === "no_booking") return day;
  return {
    ...day,
    state: "full",
    slots: day.slots.map((s) => (s.state === "past" ? s : { ...s, state: "full", waitlist_open: true })),
    list: day.list ? { ...day.list, remaining: 0, state: "full", waitlist_open: true } : day.list,
  };
}

export const publicHandlers = [
  http.get(`${API}/house`, () =>
    respond(() => {
      const state = getState(mockNow());
      const house = housePublic(state, mockNow());
      if (archiveTerms(state, house.terms)) save();
      return HttpResponse.json(house);
    }),
  ),

  http.get(`${API}/content`, () =>
    respond((scenario) => {
      const now = mockNow();
      const state = getState(now);
      const night = nightOf(now);
      const { cover, about, experience, links, seo, testimonials } = state.content;
      // eventos publicados da noite atual em diante (uma festa depois da meia-noite ainda é desta noite)
      const events = state.events.filter((e) => e.published && e.date >= night).sort((a, b) => `${a.date}${a.starts_at}`.localeCompare(`${b.date}${b.starts_at}`));
      const { rules, fallback } = phrases(state);
      return HttpResponse.json({
        server_time: now.toISOString(),
        blocks: { cover, about, experience, links, seo, testimonials },
        texts: texts(state),
        today: scenario === "vazio" ? null : todayLine(state, now),
        notices: scenario === "vazio" ? [] : notices(state, now),
        today_rules: rules,
        today_default: fallback,
        events: scenario === "vazio" ? [] : events.map((e) => eventPublic(state, e, night)),
        gallery: gallery(state),
        settings: publicSettings(state),
      });
    }),
  ),

  http.get(`${API}/menu`, () =>
    respond((scenario) => {
      const state = getState(mockNow());
      const settings = publicSettings(state).menu;
      const categories =
        scenario === "vazio"
          ? []
          : state.menu.map(({ photo: key, photo_alt, ...c }) => ({
              ...c,
              image: photo(state, c.image_id) || imageRef(key, photo_alt),
              items: c.items.map((item) => ({ ...item, image: photo(state, item.image_id, item.name) })),
            }));
      return HttpResponse.json({
        published_at: state.menu_meta?.published_at ?? new Date().toISOString(),
        unpriced_item: settings.unpriced_item,
        show_sold_out: settings.show_sold_out,
        categories,
      });
    }),
  ),

  http.get(`${API}/availability/days`, ({ request }) =>
    respond((scenario) => {
      const url = new URL(request.url);
      const now = mockNow();
      const from = url.searchParams.get("from") || houseParts(now).date;
      // sem "to", toda a janela de reservas (Configurações › Reservas)
      const windowDays = getState(now).booking.window_days || 30;
      const to = url.searchParams.get("to") || (isDate(from) ? addDays(from, windowDays - 1) : null);
      const party = Number(url.searchParams.get("party_size"));
      const errors = [];
      if (!isDate(from)) errors.push({ field: "from", message: "Informe a data inicial." });
      if (!isDate(to)) errors.push({ field: "to", message: "Informe a data final." });
      else if (isDate(from) && to < from) errors.push({ field: "to", message: "A data final vem depois da inicial." });
      if (!isParty(party)) errors.push({ field: "party_size", message: `Informe de 1 a ${PARTY_MAX} pessoas.` });
      if (errors.length) return invalid(errors);
      let days = daysAvailability(getState(now), from, to, party, now);
      if (scenario === "vazio") days = days.map(allFull);
      return HttpResponse.json({ server_time: now.toISOString(), party_size: party, days });
    }),
  ),

  http.get(`${API}/availability/slots`, ({ request }) =>
    respond((scenario) => {
      const url = new URL(request.url);
      const date = url.searchParams.get("date");
      const party = Number(url.searchParams.get("party_size"));
      const errors = [];
      if (!isDate(date)) errors.push({ field: "date", message: "Informe o dia." });
      if (!isParty(party)) errors.push({ field: "party_size", message: `Informe de 1 a ${PARTY_MAX} pessoas.` });
      if (errors.length) return invalid(errors);
      const now = mockNow();
      let day = dayAvailability(getState(now), date, party, now);
      if (scenario === "vazio") day = allFull(day);
      return HttpResponse.json({ ...day, server_time: now.toISOString() });
    }),
  ),

  // a escolha de cookies: nada pessoal é guardado, então a simulação só confere o formato
  http.post(`${API}/consents`, async ({ request }) =>
    respond(async () => {
      const body = await request.json().catch(() => null);
      if (!body || typeof body.measurement !== "boolean" || !body.banner_version) {
        return invalid([{ field: "measurement", message: "Escolha inválida." }]);
      }
      if (body.remember != null && typeof body.remember !== "boolean") return invalid([{ field: "remember", message: "Escolha inválida." }]);
      return new HttpResponse(null, { status: 204 });
    }),
  ),

  // eventos de medição: conferidos como o servidor vai conferir (sem texto livre), guardados nos dados da demonstração
  http.post(`${API}/measure`, async ({ request }) =>
    respond(async () => {
      const body = await request.json().catch(() => null);
      const SAFE = /^[\w:./+-]{0,40}$/;
      const ok =
        body &&
        typeof body.visitor === "string" &&
        typeof body.visit === "string" &&
        Array.isArray(body.events) &&
        body.events.length > 0 &&
        body.events.length <= 50 &&
        body.events.every((e) => typeof e.name === "string" && Object.values(e.data || {}).every((v) => typeof v !== "string" || SAFE.test(v)));
      if (!ok) return invalid([{ field: "events", message: "Medição inválida." }]);
      const state = getState(mockNow());
      // Configurações › Cookies com medição desligada: nada é guardado, mande a página o que mandar
      if (!publicSettings(state).cookies.measurement_enabled) return new HttpResponse(null, { status: 204 });
      state.measure =[...(state.measure || []), ...body.events.map((e) => ({ ...e, visitor: body.visitor, visit: body.visit }))].slice(-1000);
      save();
      return new HttpResponse(null, { status: 202 });
    }),
  ),
];
