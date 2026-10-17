// "Como o cliente vê": o lado do cliente de uma mudança, no canhoto serrilhado, em pt, es ou en.
// Números que mudaram e ainda não foram gravados vêm marcados com a lâmpada.
import { html, nothing } from "../../../lib/html.js";
import { LANGS, minutes } from "./catalog.js";

const ACCEPT = { pt: "Li e tá combinado", es: "Leí y está combinado", en: "I've read it, deal" };
const DURATION = {
  pt: "A mesa é de vocês por {tempo}.",
  es: "La mesa es de ustedes por {tempo}.",
  en: "The table is yours for {tempo}.",
};
const FREE = { pt: "sem limite de tempo de mesa", es: "sin límite de tiempo de mesa", en: "no time limit on the table" };
// a frase da página de reserva quando a mesa não tem limite de tempo (nunca "por sem limite")
const DURATION_FREE = {
  pt: "A mesa é de vocês, sem limite de tempo.",
  es: "La mesa es de ustedes, sin límite de tiempo.",
  en: "The table is yours, with no time limit.",
};
const NO_LIMIT = { pt: ", sem limite de tempo", es: ", sin límite de tiempo", en: ", with no time limit" };
const SHARP = {
  pt: "A mesa te espera às 20:00 em ponto. Se precisar atrasar, avise a casa.",
  es: "La mesa te espera a las 20:00 en punto. Si vas a llegar tarde, avisá a la casa.",
  en: "Your table waits for you at 20:00 sharp. If you'll be late, let the house know.",
};

/** Os números dos combinados: {tolerancia}, {extra}, {prazo}, {faltas}, {tempo}. */
export function numbersOf(booking = {}, lang = "pt") {
  return {
    tolerancia: booking.tolerance_min,
    extra: booking.extra_tolerance_min == null ? null : `${booking.extra_tolerance_min} min`,
    prazo: booking.cancel_until_hours,
    faltas: booking.no_shows ?? 1,
    tempo: booking.duration_min == null ? FREE[lang] : minutes(booking.duration_min),
  };
}

/** Um texto com os {marcadores} preenchidos, os que mudaram marcados. */
function filled(text, now, before) {
  const parts = String(text ?? "").split(/(\{\w+\})/g);
  return parts.map((part) => {
    const key = part.match(/^\{(\w+)\}$/)?.[1];
    if (!key || !(key in now)) return part;
    const value = now[key] ?? part;
    return before && String(before[key]) !== String(now[key]) ? html`<mark>${value}</mark>` : value;
  });
}

const pick = (localized, lang) => (localized?.[lang] && String(localized[lang]).trim() ? localized[lang] : localized?.pt ?? "");
const missing = (localized, lang) => lang !== "pt" && !String(localized?.[lang] ?? "").trim();

function langTabs(lang, setLang, uid, pendingOf = () => false) {
  const onKey = (e) => {
    const i = LANGS.findIndex((l) => l.key === lang);
    const moves = { ArrowRight: 1, ArrowLeft: -1 };
    if (!(e.key in moves)) return;
    e.preventDefault();
    const next = LANGS[(i + moves[e.key] + LANGS.length) % LANGS.length].key;
    setLang(next);
    requestAnimationFrame(() => document.getElementById(`${uid}-${next}`)?.focus());
  };
  return html`<div class="cfg-linguas__abas" role="tablist" aria-label="Língua da prévia" @keydown=${onKey}>
    ${LANGS.map(
      (l) => html`<button
        type="button"
        role="tab"
        id=${`${uid}-${l.key}`}
        class="cfg-linguas__aba"
        aria-selected=${String(lang === l.key)}
        aria-controls=${`${uid}-canhoto`}
        tabindex=${lang === l.key ? "0" : "-1"}
        @click=${() => setLang(l.key)}
      >
        ${l.label}${pendingOf(l.key) ? html`<span class="losango" aria-hidden="true"></span><span class="sr-only">, sem tradução</span>` : nothing}
      </button>`,
    )}
  </div>`;
}

function stub(uid, lang, body) {
  return html`<div class="cfg-canhoto" id=${`${uid}-canhoto`} role="tabpanel" aria-labelledby=${`${uid}-${lang}`} lang=${lang === "pt" ? "pt-BR" : lang}>${body}</div>`;
}

const DAYS = {
  pt: ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"],
  es: ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
};
const FREE_DAY = {
  pt: "{dia}: sem limite de tempo de mesa.",
  es: "{dia}: sin límite de tiempo de mesa.",
  en: "{dia}: no time limit on the table.",
};
const capital = (word) => word.charAt(0).toUpperCase() + word.slice(1);
const ON_DAYS = { pt: "Nos outros dias: ", es: "Los otros días: ", en: "On the other days: " };

/**
 * Item 4, o tempo de mesa. Com "livre" em algum dia o cliente lê a variante livre para
 * aquele dia ("sem limite de tempo de mesa", nunca "até livre"), e a prévia mostra os dois casos.
 */
function durationLines(booking = {}, lang, now, before) {
  const days = booking.duration_by_weekday || [];
  const free = days.filter((d) => d.minutes == null);
  const timed = days.filter((d) => d.minutes != null);
  const allFree = free.length ? !timed.length : booking.duration_min === null;
  if (allFree) return html`<li>${DURATION_FREE[lang]}</li>`;
  if (!free.length || !timed.length) return html`<li>${filled(DURATION[lang], now, before)}</li>`;
  const timedNow = { ...now, tempo: minutes(timed[0].minutes) };
  return html`<li>${ON_DAYS[lang]}${filled(DURATION[lang], timedNow, before)}</li>
    ${free.map((d) => html`<li><mark>${FREE_DAY[lang].replace("{dia}", capital(DAYS[lang][d.weekday]))}</mark></li>`)}`;
}

/** Os combinados como o cliente lê, com os números de Reservas. */
export function termsPreview({ terms, booking, bookingBefore, lang, setLang, uid = "previa" }) {
  if (!terms) return nothing;
  const now = numbersOf(booking, lang);
  const before = bookingBefore ? numbersOf(bookingBefore, lang) : null;
  const items = [...(terms.items || [])];
  const pendingOf = (l) => items.some((i) => missing(i.text, l)) || missing(terms.accept_label, l);
  const zero = booking?.tolerance_min === 0;
  const toleranceItem = items.findIndex((i) => /\{tolerancia\}|\{extra\}/.test(pick(i.text, "pt")));
  return html`<div class="cfg-previa">
    <h3 class="cfg-previa__titulo">Como o cliente vê</h3>
    <p class="cfg-ajuda">Os combinados no passo “Sua mesa”, já com os números de agora.</p>
    ${langTabs(lang, setLang, uid, pendingOf)}
    ${stub(
      uid,
      lang,
      html`<p class="cfg-canhoto__mao">Combinados da casa</p>
        <ol class="cfg-canhoto__lista">
          ${items.map((item, i) => {
            const text = pick(item.text, lang);
            // com tolerância 0, o item da tolerância usa a linha de horário exato, como a página de reserva faz
            const sharp = zero && (toleranceItem === -1 ? i === 0 : i === toleranceItem);
            // sem limite de tempo de mesa: "por {tempo}" vira ", sem limite de tempo"
            const said = booking?.duration_min === null ? text.replace(/\s*(por|for)\s+\{tempo\}/g, NO_LIMIT[lang]) : text;
            return html`<li>
              <b>${filled(pick(item.title, lang), now, before)}</b>
              ${sharp ? html`<mark>${SHARP[lang]}</mark>` : filled(said, now, before)}
            </li>`;
          })}
          ${terms.show_duration_item ? durationLines(booking, lang, now, before) : nothing}
        </ol>
        <p class="cfg-canhoto__aceite"><span aria-hidden="true"></span>${pick(terms.accept_label, lang) || ACCEPT[lang]}</p>`,
    )}
    ${pendingOf(lang) ? html`<p class="cfg-pendente"><span class="losango" aria-hidden="true"></span>Falta tradução: onde falta, o cliente lê em português.</p>` : nothing}
  </div>`;
}

export function pendingPreview({ message, lang, setLang, uid = "previa" }) {
  const text = pick(message, lang).replace("{hora}", "18:00");
  return html`<div class="cfg-previa">
    <h3 class="cfg-previa__titulo">Como o cliente vê</h3>
    <p class="cfg-ajuda">A mensagem de qualquer pendente. Nunca cita a falta.</p>
    ${langTabs(lang, setLang, uid, (l) => missing(message, l))}
    ${stub(uid, lang, html`<p class="cfg-canhoto__mao">WhatsApp da casa</p><p class="cfg-balao">${text}</p>`)}
  </div>`;
}

export function messagesPreview({ data, booking, lang, setLang, uid = "previa" }) {
  const late = booking?.late_notice_enabled !== false && booking?.extra_tolerance_min !== 0;
  const buttons = (data.reminder_buttons || []).filter((_, i) => i < 2 || late);
  const when = data.reminder_mode === "fixed_time" ? data.reminder_at : `${Math.round((data.reminder_offset_min ?? 180) / 60)} h antes da abertura`;
  return html`<div class="cfg-previa">
    <h3 class="cfg-previa__titulo">Como o cliente vê</h3>
    <p class="cfg-ajuda">${data.reminder_enabled ? `O lembrete sai ${when}.` : "Lembrete desligado: nada sai no dia."}</p>
    ${langTabs(lang, setLang, uid, (l) => (data.ready_messages || []).some((m) => missing(m.text, l)))}
    ${stub(
      uid,
      lang,
      html`<p class="cfg-canhoto__mao">WhatsApp da casa</p>
        ${data.reminder_enabled
          ? html`<p class="cfg-balao">
                ${{ pt: "Oi, Carla! Hoje às 20:00 tem mesa pra 4 no Território. Tudo certo?", es: "¡Hola, Carla! Hoy a las 20:00 hay mesa para 4 en Território. ¿Todo bien?", en: "Hi Carla! Tonight at 20:00 there's a table for 4 at Território. All good?" }[lang]}
              </p>
              <div class="cfg-botoes-msg">${buttons.map((b) => html`<span>${pick(b, lang)}</span>`)}</div>`
          : nothing}
        ${(data.ready_messages || []).map((m) => html`<p class="cfg-balao cfg-balao--pronta">${pick(m.text, lang).replace("{hora}", "20:20")}</p>`)}`,
    )}
  </div>`;
}

export function cookiesPreview({ text, lang, setLang, uid = "previa" }) {
  return html`<div class="cfg-previa">
    <h3 class="cfg-previa__titulo">Como o visitante vê</h3>
    <p class="cfg-ajuda">O aviso no pé do site, na primeira visita.</p>
    ${langTabs(lang, setLang, uid, (l) => missing(text, l))}
    ${stub(
      uid,
      lang,
      html`<p class="cfg-balao">${pick(text, lang)}</p>
        <div class="cfg-botoes-msg">
          <span>${{ pt: "Só o necessário", es: "Solo lo necesario", en: "Only what's needed" }[lang]}</span>
          <span>${{ pt: "Aceitar tudo", es: "Aceptar todo", en: "Accept all" }[lang]}</span>
        </div>`,
    )}
  </div>`;
}
