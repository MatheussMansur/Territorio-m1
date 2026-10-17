// As linhas que precisam de mais de um controle: a semana, o endereço, quem recebe cada alerta,
// tempo de mesa por dia, os itens dos combinados, as mensagens prontas e as listas só de leitura.
// Cada uma recebe o mesmo contexto de um controle simples: `value`, `data`, `setField(key, value)`.
import { ref } from "lit-html/directives/ref.js";
import { phoneField } from "../../../components/phone-field.js";
import { html, nothing } from "../../../lib/html.js";
import { COUNTRIES, countryOf, formatPhone } from "../../../lib/phone.js";
import { LANGS, WEEKDAYS, minutes } from "./catalog.js";
import { checks, localized } from "./controls.js";

/** Os minutos que um select oferece: a lista do servidor, ou a faixa do meta nos seus passos. */
function minuteOptions(meta = {}, fallback = []) {
  if (Array.isArray(meta.options) && meta.options.length) return meta.options;
  if (meta.min != null && meta.max != null) {
    const step = meta.step || 15;
    return Array.from({ length: Math.floor((meta.max - meta.min) / step) + 1 }, (_, i) => meta.min + i * step);
  }
  return fallback;
}

const fmtDate = (iso) =>
  iso ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)).replace(",", " às") : "—";

function inputErr(c, path) {
  return c.errors?.[path] ? html`<p class="cfg-erro" id=${`${c.uid}-${path.replace(/[^a-z0-9]/gi, "")}-erro`}>${c.errors[path]}</p>` : nothing;
}

// ---- a semana padrão ---------------------------------------------------------------------

function closingNote(day) {
  if (!day.open || !day.opens_at || !day.closes_at || day.closes_at > day.opens_at) return "";
  return `fecha à ${day.closes_at} de ${WEEKDAYS[(day.weekday + 1) % 7].toLowerCase()}; conta como a noite de ${WEEKDAYS[day.weekday].toLowerCase()}`;
}

function week(c) {
  const days = c.data.week || [];
  const labels = c.data.closed_labels || [];
  const layouts = c.context?.layouts || [];
  const setDay = (weekday, patch) => c.setField("week", days.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)));
  const setLabel = (weekday, label) => {
    const exists = labels.some((l) => l.weekday === weekday);
    c.setField("closed_labels", exists ? labels.map((l) => (l.weekday === weekday ? { ...l, label } : l)) : [...labels, { weekday, label }]);
  };
  // "Dois turnos" em Mais deixa cada dia aberto ter outro turno (almoço, por exemplo)
  const twoShifts = Number(c.data.max_shifts_per_day) === 2;
  // a semana da casa começa na segunda
  const order = [1, 2, 3, 4, 5, 6, 0].map((w) => days.find((d) => d.weekday === w)).filter(Boolean);
  return html`<div class="cfg-semana">
    ${order.map((day) => {
      const i = days.indexOf(day);
      const id = `${c.uid}-dia-${day.weekday}`;
      const label = labels.find((l) => l.weekday === day.weekday)?.label || { pt: day.label || "", es: "", en: "" };
      const note = closingNote(day);
      const err = c.errors?.[`week[${i}].closes_at`];
      return html`<div class="cfg-dia ${day.open ? "" : "is-fechado"}" role="group" aria-labelledby=${`${id}-nome`}>
        <div class="cfg-dia__topo">
          <b class="cfg-dia__nome" id=${`${id}-nome`}>${WEEKDAYS[day.weekday]}</b>
          <button
            type="button"
            role="switch"
            class="cfg-chave"
            aria-checked=${String(day.open)}
            aria-label=${`${WEEKDAYS[day.weekday]} aberto`}
            aria-disabled=${String(Boolean(c.disabled))}
            @click=${() => !c.disabled && setDay(day.weekday, day.open ? { open: false } : { open: true, opens_at: day.opens_at || "19:00", closes_at: day.closes_at || "23:30" })}
          >
            <span class="cfg-chave__trilho" aria-hidden="true"><span class="cfg-chave__pino"></span></span>
            <span class="cfg-chave__palavra">${day.open ? "Aberto" : "Fechado"}</span>
          </button>
        </div>
        ${day.open
          ? html`<div class="cfg-dia__horas">
                <label class="cfg-mini">
                  <span>Abre</span>
                  <input class="field__input" type="time" .value=${day.opens_at || ""} ?disabled=${c.disabled} @change=${(e) => e.target.value && setDay(day.weekday, { opens_at: e.target.value })} />
                </label>
                <label class="cfg-mini">
                  <span>Fecha</span>
                  <input
                    class="field__input"
                    type="time"
                    .value=${day.closes_at || ""}
                    ?disabled=${c.disabled}
                    aria-invalid=${err ? "true" : "false"}
                    aria-describedby=${err ? `${id}-erro` : note ? `${id}-nota` : nothing}
                    @change=${(e) => e.target.value && setDay(day.weekday, { closes_at: e.target.value })}
                  />
                </label>
                <label class="cfg-mini cfg-mini--largo">
                  <span>Planta</span>
                  <select class="field__input" ?disabled=${c.disabled} @change=${(e) => setDay(day.weekday, { layout_id: e.target.value })}>
                    ${layouts.map((l) => html`<option value=${l.id} ?selected=${l.id === day.layout_id}>${l.name}</option>`)}
                  </select>
                </label>
              </div>
              ${note ? html`<p class="cfg-dia__nota" id=${`${id}-nota`}>${note}</p>` : nothing}
              ${err ? html`<p class="cfg-erro" id=${`${id}-erro`}>${err}</p>` : nothing}
              ${twoShifts ? secondShift(c, day, i, id, setDay) : nothing}`
          : html`<div class="cfg-dia__motivo">
              <span class="cfg-mini__rotulo" id=${`${id}-motivo`}>Motivo no site</span>
              ${localized({
                value: label,
                set: (v) => setLabel(day.weekday, v),
                disabled: c.disabled,
                uid: `${id}-m`,
                max: 30,
                lang: c.langOf(`motivo-${day.weekday}`),
                setLang: (l) => c.setLang(`motivo-${day.weekday}`, l),
                labelId: `${id}-nome ${id}-motivo`,
              })}
            </div>`}
      </div>`;
    })}
  </div>`;
}

/** O outro turno de um dia aberto, quando a casa trabalha em dois turnos (história 2.8). */
function secondShift(c, day, i, id, setDay) {
  const shift = day.second_shift;
  const err = c.errors?.[`week[${i}].second_shift`];
  if (!shift) {
    return html`<button type="button" class="link-button cfg-dia__turno" ?disabled=${c.disabled} @click=${() => setDay(day.weekday, { second_shift: { opens_at: "12:00", closes_at: "15:00" } })}>
      Abrir outro turno em ${WEEKDAYS[day.weekday].toLowerCase()}
    </button>`;
  }
  const set = (patch) => setDay(day.weekday, { second_shift: { ...shift, ...patch } });
  return html`<div class="cfg-dia__horas cfg-dia__turno2" role="group" aria-label=${`Outro turno de ${WEEKDAYS[day.weekday].toLowerCase()}`}>
      <label class="cfg-mini">
        <span>Outro turno abre</span>
        <input class="field__input" type="time" .value=${shift.opens_at || ""} ?disabled=${c.disabled} aria-invalid=${err ? "true" : "false"} @change=${(e) => e.target.value && set({ opens_at: e.target.value })} />
      </label>
      <label class="cfg-mini">
        <span>Fecha</span>
        <input class="field__input" type="time" .value=${shift.closes_at || ""} ?disabled=${c.disabled} aria-invalid=${err ? "true" : "false"} aria-describedby=${err ? `${id}-erro2` : nothing} @change=${(e) => e.target.value && set({ closes_at: e.target.value })} />
      </label>
      <button type="button" class="link-button" ?disabled=${c.disabled} @click=${() => setDay(day.weekday, { second_shift: null })}>Tirar o outro turno</button>
    </div>
    ${err ? html`<p class="cfg-erro" id=${`${id}-erro2`}>${err}</p>` : nothing}`;
}

// ---- endereço -------------------------------------------------------------------------------

function address(c) {
  const a = c.value || {};
  const set = (key, value) => c.setField("address", { ...a, [key]: value });
  const part = (key, label, extra = {}) => html`<label class="cfg-mini ${extra.wide ? "cfg-mini--largo" : ""}">
    <span>${label}</span>
    <input
      class="field__input"
      type=${extra.number ? "text" : "text"}
      inputmode=${extra.number ? "decimal" : extra.mode || "text"}
      .value=${a[key] ?? ""}
      ?disabled=${c.disabled}
      aria-invalid=${c.errors?.[`address.${key}`] ? "true" : "false"}
      @change=${(e) => set(key, extra.number ? Number(e.target.value.replace(",", ".")) : e.target.value)}
    />
    ${inputErr(c, `address.${key}`)}
  </label>`;
  const maps = `https://www.google.com/maps/search/?api=1&query=${a.lat},${a.lng}`;
  return html`<div class="cfg-endereco">
    ${part("street", "Rua", { wide: true })} ${part("number", "Número", { mode: "numeric" })} ${part("district", "Bairro")} ${part("city", "Cidade")}
    ${part("state", "UF")} ${part("zip", "CEP", { mode: "numeric" })} ${part("lat", "Latitude", { number: true })} ${part("lng", "Longitude", { number: true })}
    <a class="link-button cfg-endereco__mapa" href=${maps} target="_blank" rel="noopener">Conferir no Maps</a>
  </div>`;
}

// ---- pessoas -------------------------------------------------------------------------------

const ROLE = { owner: "dono", manager: "gerente", floor: "recepção" };

function people(c) {
  const users = (c.context?.users || []).filter((u) => u.role !== "floor");
  return checks({
    options: users.map((u) => ({ value: u.id, label: u.name, note: ROLE[u.role] })),
    value: c.value,
    set: c.set,
    disabled: c.disabled,
    labelId: `${c.uid}-rotulo`,
    describedby: c.describedby,
    error: c.error,
    uid: c.uid,
  });
}

// ---- tempo de mesa por dia e por tamanho do grupo ----------------------------------------------------

function weekdayMinutes(c) {
  const list = c.value || [];
  const set = (weekday, minutesValue) => c.set(list.map((d) => (d.weekday === weekday ? { ...d, minutes: minutesValue } : d)));
  return html`<div class="cfg-dias">
    ${list.map((d, i) => {
      const free = d.minutes == null;
      return html`<div class="cfg-dias__dia" role="group" aria-label=${`Tempo de mesa de ${WEEKDAYS[d.weekday].toLowerCase()}`}>
        <b>${WEEKDAYS[d.weekday].slice(0, 3).toLowerCase()}</b>
        <select
          class="field__input"
          aria-label=${`Tempo de mesa de ${WEEKDAYS[d.weekday].toLowerCase()}`}
          ?disabled=${c.disabled}
          aria-invalid=${c.errors?.[`duration_by_weekday[${i}]`] ? "true" : "false"}
          @change=${(e) => set(d.weekday, e.target.value === "livre" ? null : Number(e.target.value))}
        >
          ${c.meta?.nullable === false ? nothing : html`<option value="livre" ?selected=${free}>livre</option>`}
          ${minuteOptions(c.meta).map((m) => html`<option value=${m} ?selected=${d.minutes === m}>${minutes(m)}</option>`)}
        </select>
      </div>`;
    })}
  </div>`;
}

function durationRules(c) {
  const rules = c.value || [];
  const meta = c.meta || {};
  const partyMin = meta.party_min ?? 1;
  const partyMax = meta.party_max ?? 20;
  const most = meta.max_items ?? 4;
  const options = minuteOptions(meta);
  const set = (i, patch) => c.set(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return html`<div class="cfg-regras">
    ${rules.map(
      (r, i) => html`<div class="cfg-regra" role="group" aria-label=${`Regra ${i + 1}`}>
        <label class="cfg-mini">
          <span>Até</span>
          <input class="field__input" type="number" inputmode="numeric" min=${partyMin} max=${partyMax} .value=${String(r.party_max)} ?disabled=${c.disabled} aria-invalid=${c.errors?.[`duration_rules[${i}]`] ? "true" : "false"} @change=${(e) => set(i, { party_max: Math.min(partyMax, Math.max(partyMin, Number(e.target.value) || partyMin)) })} />
        </label>
        <span class="cfg-regra__meio">pessoas →</span>
        <label class="cfg-mini">
          <span>Tempo</span>
          <select class="field__input" ?disabled=${c.disabled} @change=${(e) => set(i, { minutes: Number(e.target.value) })}>
            ${options.map((m) => html`<option value=${m} ?selected=${r.minutes === m}>${minutes(m)}</option>`)}
          </select>
        </label>
        ${rules.length > 1
          ? html`<button type="button" class="link-button" ?disabled=${c.disabled} @click=${() => c.set(rules.filter((_, j) => j !== i))}>Tirar</button>`
          : nothing}
      </div>`,
    )}
    ${rules.length < most
      ? html`<button type="button" class="btn btn--outline btn--sm" ?disabled=${c.disabled} @click=${() => c.set([...rules, { party_max: Math.min(partyMax, (rules.at(-1)?.party_max ?? 4) + 4), minutes: options.find((m) => m >= 150) ?? options.at(-1) ?? 150 }])}>
          Acrescentar uma regra
        </button>`
      : nothing}
  </div>`;
}

// ---- os combinados ---------------------------------------------------------------------------

function terms(c) {
  const items = c.value || [];
  const set = (i, patch) => c.set(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const move = (i, dir) => {
    const next = [...items];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    c.set(next);
  };
  return html`<ol class="cfg-itens">
    ${items.map((item, i) => {
      const id = `${c.uid}-item-${i}`;
      const err = Object.entries(c.errors || {}).find(([k]) => k.startsWith(`items[${i}]`))?.[1];
      return html`<li class="cfg-item ${err ? "is-erro" : ""}" id=${id}>
        <div class="cfg-item__topo">
          <b id=${`${id}-nome`}>Item ${i + 1}</b>
          <span class="cfg-item__acoes">
            ${i > 0 ? html`<button type="button" class="link-button" ?disabled=${c.disabled} aria-label=${`Subir o item ${i + 1}`} @click=${() => move(i, -1)}>Subir</button>` : nothing}
            ${i < items.length - 1 ? html`<button type="button" class="link-button" ?disabled=${c.disabled} aria-label=${`Descer o item ${i + 1}`} @click=${() => move(i, 1)}>Descer</button>` : nothing}
            ${items.length > 1 ? html`<button type="button" class="link-button" ?disabled=${c.disabled} aria-label=${`Tirar o item ${i + 1}`} @click=${() => c.set(items.filter((_, j) => j !== i))}>Tirar</button>` : nothing}
          </span>
        </div>
        <span class="cfg-mini__rotulo" id=${`${id}-titulo`}>Título</span>
        ${localized({ value: item.title, set: (v) => set(i, { title: v }), disabled: c.disabled, uid: `${id}-t`, max: 60, lang: c.langOf(`item-${i}`), setLang: (l) => c.setLang(`item-${i}`, l), labelId: `${id}-nome ${id}-titulo` })}
        <span class="cfg-mini__rotulo" id=${`${id}-texto`}>Texto</span>
        ${localized({ value: item.text, set: (v) => set(i, { text: v }), disabled: c.disabled, uid: `${id}-x`, max: 240, multiline: true, lang: c.langOf(`item-${i}`), setLang: (l) => c.setLang(`item-${i}`, l), labelId: `${id}-nome ${id}-texto`, error: err })}
        ${err ? html`<p class="cfg-erro">${err}</p>` : nothing}
      </li>`;
    })}
    ${items.length < 6
      ? html`<li class="cfg-itens__mais">
          <button type="button" class="btn btn--outline btn--sm" ?disabled=${c.disabled} @click=${() => c.set([...items, { title: { pt: "", es: "", en: "" }, text: { pt: "", es: "", en: "" } }])}>
            Acrescentar um item
          </button>
        </li>`
      : nothing}
  </ol>`;
}

function versions(c) {
  const list = [...(c.context?.terms_versions || [])].reverse();
  return html`<ul class="cfg-versoes">
    ${list.map(
      (v, i) => html`<li>
        <b>Versão ${v.number}</b>${i === 0 ? html` <span class="badge badge--confirmed">atual</span>` : nothing}
        <span>${fmtDate(v.published_at)} · ${v.future_reservations} ${v.future_reservations === 1 ? "reserva futura" : "reservas futuras"}</span>
      </li>`,
    )}
  </ul>`;
}

// ---- mensagens prontas ----------------------------------------------------------------------------

const TEMPLATES = { table_waiting: "Mesa esperando", table_ready: "Mesa pronta", running_late: "Atraso da casa" };
const META_STATUS = {
  approved: ["Aprovada na Meta", "badge--confirmed"],
  pending: ["Aguardando aprovação · vale o texto anterior", "badge--pending"],
  rejected: ["Recusada pela Meta", "badge--no-show"],
};

function ready(c) {
  const list = c.value || [];
  const original = c.old || [];
  return html`<ul class="cfg-prontas">
    ${list.map((m, i) => {
      const [status, cls] = META_STATUS[m.status || (m.approved ? "approved" : "pending")];
      const id = `${c.uid}-pronta-${i}`;
      const edited = JSON.stringify(m.text) !== JSON.stringify(original[i]?.text);
      const err = Object.entries(c.errors || {}).find(([k]) => k.startsWith(`ready_messages[${i}]`))?.[1];
      return html`<li class="cfg-pronta">
        <div class="cfg-item__topo">
          <b id=${`${id}-nome`}>${TEMPLATES[m.template] || m.template}</b>
          <span class="badge ${cls}">${edited ? "Vai para a Meta ao gravar" : status}</span>
        </div>
        ${m.reason ? html`<p class="cfg-ajuda">Motivo: ${m.reason}</p>` : nothing}
        ${localized({
          value: m.text,
          set: (v) => c.set(list.map((x, j) => (j === i ? { ...x, text: v } : x))),
          disabled: c.disabled,
          uid: id,
          max: 160,
          lang: c.langOf(`pronta-${i}`),
          setLang: (l) => c.setLang(`pronta-${i}`, l),
          labelId: `${id}-nome`,
          error: err,
        })}
        ${err ? html`<p class="cfg-erro">${err}</p>` : nothing}
      </li>`;
    })}
  </ul>`;
}

// ---- áreas e idiomas -------------------------------------------------------------------------

function areas(c) {
  return checks({
    options: (c.context?.areas || []).map((a) => ({ value: a.key, label: a.name })),
    value: c.value,
    set: c.set,
    disabled: c.disabled,
    labelId: `${c.uid}-rotulo`,
    describedby: c.describedby,
    error: c.error,
    uid: c.uid,
  });
}

function locales(c) {
  return checks({
    options: LANGS.map((l) => ({ value: l.key, label: l.name[0].toUpperCase() + l.name.slice(1), disabled: l.key === "pt", note: l.key === "pt" ? "sempre" : "" })),
    value: c.value,
    set: c.set,
    disabled: c.disabled,
    labelId: `${c.uid}-rotulo`,
    describedby: c.describedby,
    error: c.error,
    uid: c.uid,
  });
}

// ---- só leitura: aparência e integrações ------------------------------------------------------

const SWATCHES = [
  ["papel", "Papel"],
  ["papel-claro", "Papel claro"],
  ["kraft", "Kraft"],
  ["ferro", "Ferro"],
  ["tinta-2", "Tinta 2"],
  ["tinta-3", "Tinta 3"],
  ["terracota", "Terracota"],
  ["tijolo", "Tijolo"],
  ["lampada", "Lâmpada"],
  ["noite", "Noite"],
];
const FONTS = [
  ["Oferta do Dia", "títulos", "autorização do autor pendente; plano B Londrina Solid (OFL)", "cfg-fonte--letreiro"],
  ["Familjen Grotesk", "botões, abas, menus e números", "OFL", "cfg-fonte--grotesca"],
  ["Archivo", "texto", "OFL", "cfg-fonte--corpo"],
  ["IBM Plex Mono", "rótulos", "OFL", "cfg-fonte--mono"],
  ["Nanum Pen Script", "a frase da casa", "OFL", "cfg-fonte--mao"],
];

function appearance() {
  return html`<div class="cfg-aparencia">
    <ul class="cfg-amostras" aria-label="Paleta papel e ferro">
      ${SWATCHES.map(([key, label]) => html`<li><span class="cfg-amostra cfg-amostra--${key}" aria-hidden="true"></span>${label}</li>`)}
    </ul>
    <p class="cfg-ajuda">Tema escuro: ferro quente com terracota clara. O tema do visitante segue o aparelho dele.</p>
    <ul class="cfg-fontes">
      ${FONTS.map(([name, use, license, cls]) => html`<li><b class=${cls}>${name}</b><span>${use} · ${license}</span></li>`)}
    </ul>
    <p class="cfg-fixo">fixo · fale com o suporte</p>
    <a class="link-button" href="/_ds/" target="_blank" rel="noopener">Abrir o catálogo de componentes</a>
  </div>`;
}

const INTEGRATIONS = {
  whatsapp: "WhatsApp", google: "Google (entrar com Google)", turnstile: "Turnstile (anti-robô)", email: "E-mail",
  database: "Banco de dados", measurement: "Medição (Umami)", monitor: "Monitor externo", errors: "Erros",
};
const STATE = { ok: ["ligada", "badge--confirmed"], problem: ["com problema", "badge--no-show"], unused: ["não usada", "badge--expired"] };

const clock = (iso) => (iso ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "");

/** O resultado de "Testar agora": como foi e quando, nunca a resposta do próprio serviço. */
function checkResult(check) {
  if (!check) return nothing;
  if (check.busy) return html`<span class="cfg-teste" role="status">Testando…</span>`;
  if (check.error) return html`<span class="cfg-teste cfg-teste--erro" role="status">Não deu para testar agora</span>`;
  return html`<span class="cfg-teste ${check.ok ? "" : "cfg-teste--erro"}" role="status">${check.ok ? "respondeu agora" : "com problema"} · ${clock(check.checked_at)}</span>`;
}

function integrations(c) {
  const results = c.context?.checks || {};
  return html`<table class="data-table data-table--stack cfg-integracoes">
    <caption class="sr-only">Integrações da casa</caption>
    <thead>
      <tr>
        <th scope="col">Serviço</th><th scope="col">Situação</th><th scope="col">Ambiente</th><th scope="col">Última resposta boa</th><th scope="col">Troca de chave</th>
        <th scope="col"><span class="sr-only">Testar</span></th>
      </tr>
    </thead>
    <tbody>
      ${(c.value || []).map((i) => {
        const [label, cls] = STATE[i.state] || STATE.unused;
        const name = INTEGRATIONS[i.key] || i.key;
        return html`<tr>
          <th scope="row">${name}${i.note ? html`<small>${i.note}</small>` : nothing}</th>
          <td data-label="Situação"><span class="badge ${cls}">${label}</span></td>
          <td data-label="Ambiente">${i.environment}</td>
          <td data-label="Última resposta boa">${fmtDate(i.last_ok_at)}</td>
          <td data-label="Troca de chave">${fmtDate(i.key_rotated_at)}</td>
          <td data-label="Teste" class="cfg-integracoes__teste">
            ${c.context?.test
              ? html`<button type="button" class="action" aria-label=${`Testar ${name} agora`} ?disabled=${results[i.key]?.busy} @click=${() => c.context.test(i.key)}>Testar agora</button>`
              : nothing}
            ${checkResult(results[i.key])}
          </td>
        </tr>`;
      })}
    </tbody>
  </table>`;
}

// ---- o WhatsApp da casa, no campo com o país ------------------------------------

const wired = new WeakSet();

/** O mesmo campo de telefone da reserva: o país ao lado, o valor guardado em E.164. */
function phone(c) {
  const value = c.value || "";
  const country = countryOf(value) || "BR";
  const wire = (root) => {
    if (!root || wired.has(root)) return;
    wired.add(root);
    const field = phoneField(root);
    const input = root.querySelector("input");
    // o campo reescreve o número ao sair; a tela guarda E.164, ou o que foi digitado quando ainda não é um número
    const keep = () => !c.disabled && c.set(field.value || input.value.trim());
    input.addEventListener("blur", keep);
    root.querySelector("select").addEventListener("change", () => input.value && keep());
  };
  return html`<div class="field cfg-telefone ${c.error ? "field--invalid" : ""}">
    <div class="phone" ${ref(wire)}>
      <select class="field__input" aria-label="País do WhatsApp" ?disabled=${c.disabled}>
        ${COUNTRIES.map((x) => html`<option value=${x.id} ?selected=${country === x.id}>${x.label}</option>`)}
      </select>
      <input
        id=${`${c.uid}-controle`}
        class="field__input"
        type="tel"
        inputmode="tel"
        autocomplete="off"
        placeholder="(45) 99999-0000"
        .value=${value.startsWith("+") ? formatPhone(value) || value : value}
        ?disabled=${c.disabled}
        aria-labelledby=${`${c.uid}-rotulo`}
        aria-describedby=${c.describedby}
        aria-invalid=${c.error ? "true" : "false"}
      />
    </div>
  </div>`;
}

// ---- as datas que saem da semana padrão (história 3.6) ------------------------------------

const dayName = (date) => {
  const [y, m, d] = date.split("-").map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()].slice(0, 3).toLowerCase()}, ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
};

const labelOf = (value) => (value && typeof value === "object" ? value.pt : value) || "";

function exceptions(c) {
  const list = c.context?.exceptions;
  if (list === undefined) return html`<p class="cfg-ajuda" role="status">Buscando os dias especiais…</p>`;
  const layouts = new Map((c.context?.layouts || []).map((l) => [l.id, l.name]));
  return html`<div class="cfg-excecoes">
    ${list === null
      ? html`<p class="cfg-ajuda">Não deu para ler a Agenda agora.</p>`
      : list.length
        ? html`<ul class="cfg-excecoes__lista">
            ${list.map((p) => {
              const hoursText = p.opens_at && p.closes_at ? `${p.opens_at}–${p.closes_at}` : "";
              const what =
                p.open === false
                  ? `fechado${labelOf(p.public_label) ? ` · ${labelOf(p.public_label)}` : ""}`
                  : [p.event_id ? "noite de evento" : "", hoursText, layouts.get(p.layout_id) || ""].filter(Boolean).join(" · ") || "plano próprio";
              return html`<li><a href=${`/admin/agenda/${p.date}`}>${dayName(p.date)}</a><span>${what}</span></li>`;
            })}
          </ul>`
        : html`<p class="cfg-ajuda">Nenhum dia especial gravado nos próximos dois meses.</p>`}
    <a class="link-button" href="/admin/agenda">Feriados e dias especiais na Agenda</a>
  </div>`;
}

// ---- os modelos de WhatsApp na Meta (história 2.14) ------------------------------------------------

const META_STATE = {
  approved: ["aprovado", "badge--confirmed"],
  pending: ["aguardando aprovação", "badge--pending"],
  rejected: ["recusado", "badge--no-show"],
};

function templates(c) {
  const list = c.context?.templates;
  if (list === undefined) return html`<p class="cfg-ajuda" role="status">Buscando os modelos…</p>`;
  if (list === null) return html`<p class="cfg-ajuda">Não deu para ler os modelos agora.</p>`;
  return html`<ul class="cfg-modelos">
    ${list.map((t) => {
      const [label, cls] = META_STATE[t.status] || META_STATE.pending;
      return html`<li class="cfg-modelo">
        <div class="cfg-item__topo"><b>${t.name}</b><span class="badge ${cls}">${label}</span></div>
        <p class="cfg-modelo__texto">${t.text?.pt}</p>
        ${t.status === "pending" ? html`<p class="cfg-ajuda">Enquanto a Meta não aprova, vale o texto anterior${t.previous_text?.pt ? html`: “${t.previous_text.pt}”` : nothing}.</p>` : nothing}
        ${t.status === "rejected" && t.reason ? html`<p class="cfg-ajuda">Motivo da Meta: ${t.reason}</p>` : nothing}
      </li>`;
    })}
  </ul>`;
}

export const CUSTOM = { week, address, people, weekdayMinutes, durationRules, terms, versions, ready, areas, locales, appearance, integrations, phone, exceptions, templates };
