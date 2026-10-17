// Os blocos de texto do site: o que cada um tem, os seus limites, como é editado e como o
// cliente o vê (a prévia). Só texto: as fotos são escolhidas na Galeria, endereço e
// horários vêm de Configurações.
import { addDays, houseParts, weekdayOf } from "../../../lib/dates.js";
import { html, nothing } from "../../../lib/html.js";
import { uuid } from "../../../lib/uuid.js";
import { dayMonth, LANGS, langTabs, missing, missingNote, textField } from "./comum.js";

export const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

const L = () => ({ pt: "", es: null, en: null });

/** Cada bloco: o seu endereço no painel, para que serve e os seus campos (traduzidos, a não ser os simples). */
export const BLOCKS = [
  {
    key: "cover",
    slug: "capa",
    label: "Capa",
    text: "A primeira coisa que o cliente lê: a frase de cima, a frase escrita à mão e o texto de apoio.",
    fields: [
      { name: "kicker", label: "Frase de cima", max: 60, required: true },
      { name: "hand", label: "Frase escrita à mão", max: 40, help: "Sai na letra de mão, grande, no meio da foto." },
      { name: "lede", label: "Texto de apoio", max: 200, multiline: true, required: true },
    ],
  },
  {
    key: "about",
    slug: "casa",
    label: "A casa",
    text: "Quem é o Território: o texto curto, a história em dois parágrafos e a assinatura.",
    fields: [
      { name: "text", label: "Texto curto", max: 200, multiline: true, required: true },
      { name: "story_1", label: "História · primeiro parágrafo", max: 420, multiline: true },
      { name: "story_2", label: "História · segundo parágrafo", max: 420, multiline: true },
      { name: "hand", label: "Assinatura à mão", max: 40 },
    ],
  },
  {
    key: "notices",
    slug: "avisos",
    label: "Avisos",
    text: "Recados com data para começar e terminar: feriado, casa fechada, horário diferente. Saem em “Hoje na casa”.",
  },
  {
    key: "today",
    slug: "frases",
    label: "Frases do dia",
    text: "O que aparece em “Hoje na casa” em cada dia da semana, quando não há aviso nem evento.",
  },
  {
    key: "links",
    slug: "links",
    label: "Links",
    text: "Instagram, lojinha e a mensagem que já vem escrita quando o cliente abre o WhatsApp.",
    plain: true,
    fields: [
      { name: "instagram", label: "Instagram", max: 30, required: true, help: "Só o nome, sem o @ e sem o endereço." },
      { name: "shop", label: "Lojinha", max: 40, help: "O nome da lojinha no Instagram." },
      { name: "whatsapp_text", label: "Mensagem pronta do WhatsApp", max: 120, multiline: true },
    ],
  },
  {
    key: "seo",
    slug: "busca",
    label: "Busca (SEO)",
    text: "Como o site aparece no Google e quando alguém compartilha o link no WhatsApp.",
    fields: [
      { name: "title", label: "Título na busca", max: 70, required: true, help: "Até uns 60 caracteres aparecem inteiros no Google." },
      { name: "description", label: "Descrição na busca", max: 160, multiline: true, required: true },
    ],
  },
];

export const blockBySlug = (slug) => BLOCKS.find((b) => b.slug === slug);
export const blockByKey = (key) => BLOCKS.find((b) => b.key === key);

/** Campos em branco para um bloco que nunca foi escrito (a demonstração "vazio"). */
export function blankFields(def) {
  if (def.key === "notices") return { items: [] };
  if (def.key === "today") return { rules: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, L()])), default: L() };
  if (def.plain) return Object.fromEntries(def.fields.map((f) => [f.name, ""]));
  return Object.fromEntries(def.fields.map((f) => [f.name, L()]));
}

/** Os idiomas que precisam de texto em algum lugar do bloco (pt quando um texto obrigatório está vazio). */
export function missingLangs(def, fields) {
  const out = new Set();
  const look = (value, required) => {
    const gaps = missing(value);
    if (gaps.includes("pt")) {
      if (required) out.add("pt");
      return; // nada em português: nada para traduzir também
    }
    for (const code of gaps) out.add(code);
  };
  if (!fields) return [];
  if (def.key === "notices") for (const n of fields.items || []) look(n.text, true);
  else if (def.key === "today") {
    look(fields.default, true);
    for (const v of Object.values(fields.rules || {})) look(v, false);
  } else if (!def.plain) for (const f of def.fields) look(fields[f.name], f.required);
  return LANGS.map((l) => l.code).filter((c) => out.has(c));
}

const tx = (value, lang) => value?.[lang] || value?.pt || "";

// ---- editores ------------------------------------------------------------------------------

/**
 * O formulário de um bloco. `ed` é o estado do editor: { def, fields, lang, errors }, e
 * `change()` redesenha depois que um campo muda.
 */
export function editor(ed, change, today) {
  const { def, fields, lang } = ed;
  if (def.plain) {
    return html`<div class="st-campos">
      ${def.fields.map((f) =>
        textField({
          id: `bloco-${f.name}`,
          name: f.name,
          label: f.label,
          value: fields[f.name],
          max: f.max,
          multiline: f.multiline,
          help: f.help,
          required: f.required,
          error: ed.errors[f.name],
          onInput: (v) => {
            fields[f.name] = f.name === "instagram" ? v.replace(/^@/, "") : v;
            change();
          },
        }),
      )}
      <div class="cs-somente-leitura">
        <p>O número do WhatsApp, o endereço e os horários vêm de <a href="/admin/configuracoes">Configurações</a>. Aqui eles só aparecem.</p>
      </div>
    </div>`;
  }
  const gaps = missingLangs(def, fields);
  const tabs = langTabs({ id: "bloco", lang, missingIn: gaps, onPick: (code) => ((ed.lang = code), change()) });
  const localized = (key, path, label, max, { multiline = false, required = false, help } = {}) =>
    textField({
      id: `bloco-${key}`,
      name: `${path}.${lang}`,
      label,
      value: path.split(".").reduce((o, k) => o?.[k], fields)?.[lang] || "",
      max,
      multiline,
      help,
      lang: lang === "pt" ? "pt-BR" : lang,
      required: required && lang === "pt",
      error: ed.errors[`${path}.${lang}`],
      placeholder: lang === "pt" ? "" : tx(path.split(".").reduce((o, k) => o?.[k], fields), "pt"),
      onInput: (v) => {
        const keys = path.split(".");
        let target = fields;
        for (const k of keys.slice(0, -1)) target = target[k] ||= {};
        const value = (target[keys.at(-1)] ||= L());
        value[lang] = v || (lang === "pt" ? "" : null);
        change();
      },
    });

  let body;
  if (def.key === "notices") {
    const items = fields.items || [];
    body = html`${items.length
        ? html`<ol class="st-avisos">
            ${items.map((n, i) => {
              const state = n.ends_on < today ? "terminou" : n.starts_on > today ? `começa em ${dayMonth(n.starts_on)}` : "no ar hoje";
              return html`<li class="st-aviso">
                <div class="st-aviso__topo">
                  <h3 class="st-aviso__titulo">Aviso ${i + 1}</h3>
                  <span class=${`badge ${state === "no ar hoje" ? "badge--confirmed" : state === "terminou" ? "badge--expired" : "badge--pending"}`}>${state}</span>
                </div>
                ${localized(`aviso-${i}`, `items.${i}.text`, "Texto do aviso", 140, { multiline: true, required: true })}
                <div class="st-datas">
                  <div class="field">
                    <label class="field__label" for=${`aviso-${i}-inicio`}>Começa em</label>
                    <input class="field__input" type="date" id=${`aviso-${i}-inicio`} name=${`items.${i}.starts_on`} .value=${n.starts_on || ""} @input=${(e) => ((n.starts_on = e.target.value), change())} />
                  </div>
                  <div class="field ${ed.errors[`items.${i}.dates`] ? "field--invalid" : ""}">
                    <label class="field__label" for=${`aviso-${i}-fim`}>Termina em</label>
                    <input
                      class="field__input"
                      type="date"
                      id=${`aviso-${i}-fim`}
                      name=${`items.${i}.dates`}
                      aria-describedby=${ed.errors[`items.${i}.dates`] ? `aviso-${i}-fim-erro` : nothing}
                      .value=${n.ends_on || ""}
                      @input=${(e) => ((n.ends_on = e.target.value), change())}
                    />
                    ${ed.errors[`items.${i}.dates`] ? html`<p class="field__error" id=${`aviso-${i}-fim-erro`}>${ed.errors[`items.${i}.dates`]}</p>` : nothing}
                  </div>
                </div>
                <button class="link-button st-aviso__tirar" type="button" @click=${() => (items.splice(i, 1), change())}>Tirar o aviso ${i + 1}</button>
              </li>`;
            })}
          </ol>`
        : html`<p class="cs-dica">Nenhum aviso. Quando tiver feriado ou horário diferente, ponha aqui com as datas: ele some sozinho no fim.</p>`}
      <div>
        <button
          class="btn btn--outline btn--sm"
          type="button"
          @click=${() => {
            items.push({ id: uuid(), text: L(), starts_on: today, ends_on: addDays(today, 7) });
            fields.items = items;
            change();
          }}
        >
          Novo aviso
        </button>
      </div>`;
  } else if (def.key === "today") {
    body = html`${localized("padrao", "default", "Frase de sempre", 90, { required: true, help: "Vale para os dias sem frase própria." })}
      <fieldset class="st-dias">
        <legend>Por dia da semana</legend>
        ${WEEKDAYS.map((name, d) => localized(`dia-${d}`, `rules.${d}`, name, 90))}
      </fieldset>`;
  } else {
    body = def.fields.map((f) => localized(f.name, f.name, f.label, f.max, f));
  }
  return html`${tabs}
    <div class="st-campos" role="tabpanel" id="bloco-painel" aria-labelledby=${`bloco-tab-${lang}`}>${missingNote(lang, gaps)} ${body}</div>`;
}

// ---- prévias: o bloco como o cliente o vê ------------------------------------------

export function preview(def, fields, lang, { today, house } = {}) {
  if (!fields) return nothing;
  const t = (v) => tx(v, lang);
  switch (def.key) {
    case "cover":
      return html`<div class="st-previa st-previa--capa" lang=${lang === "pt" ? "pt-BR" : lang}>
        <p class="st-previa__kicker">${t(fields.kicker)}</p>
        <p class="st-previa__mao">${t(fields.hand)}</p>
        <p class="st-previa__lede">${t(fields.lede)}</p>
        <span class="st-previa__botao">${{ pt: "Reservar mesa", es: "Reservar mesa", en: "Book a table" }[lang]}</span>
      </div>`;
    case "about":
      return html`<div class="st-previa st-previa--casa" lang=${lang === "pt" ? "pt-BR" : lang}>
        <p class="st-previa__titulo">${{ pt: "A casa", es: "La casa", en: "The house" }[lang]}</p>
        <p class="st-previa__destaque">${t(fields.text)}</p>
        ${t(fields.story_1) ? html`<p>${t(fields.story_1)}</p>` : nothing}
        ${t(fields.story_2) ? html`<p>${t(fields.story_2)}</p>` : nothing}
        <p class="st-previa__mao">${t(fields.hand)}</p>
      </div>`;
    case "notices": {
      const live = (fields.items || []).filter((n) => n.starts_on <= today && today <= n.ends_on);
      const next = (fields.items || []).filter((n) => n.starts_on > today).sort((a, b) => a.starts_on.localeCompare(b.starts_on));
      return html`<div class="st-previa st-previa--hoje" lang=${lang === "pt" ? "pt-BR" : lang}>
          <p class="st-previa__rotulo">${{ pt: "Hoje na casa", es: "Hoy en la casa", en: "Today at the house" }[lang]}</p>
          <p class="st-previa__frase">${live.length ? t(live[0].text) : html`<span class="st-previa__nada">Nenhum aviso no ar hoje: aparece a frase do dia.</span>`}</p>
        </div>
        ${next.length ? html`<p class="cs-dica">Próximo: de ${dayMonth(next[0].starts_on)} a ${dayMonth(next[0].ends_on)}, “${t(next[0].text)}”.</p>` : nothing}`;
    }
    case "today": {
      const wd = weekdayOf(today);
      const line = t(fields.rules?.[wd]) || t(fields.default);
      return html`<div class="st-previa st-previa--hoje" lang=${lang === "pt" ? "pt-BR" : lang}>
          <p class="st-previa__rotulo">${{ pt: "Hoje na casa", es: "Hoy en la casa", en: "Today at the house" }[lang]} · ${WEEKDAYS[wd].toLowerCase()}</p>
          <p class="st-previa__frase">${line}</p>
        </div>
        <p class="cs-dica">Em dia de evento ou com aviso no ar, eles aparecem no lugar da frase.</p>`;
    }
    case "links":
      return html`<div class="st-previa st-previa--links">
        <p><span class="st-previa__rotulo">Instagram</span> @${fields.instagram || "…"}</p>
        <p><span class="st-previa__rotulo">Lojinha</span> ${fields.shop ? `@${fields.shop}` : "sem lojinha"}</p>
        <p><span class="st-previa__rotulo">WhatsApp</span> ${house?.whatsapp ? house.whatsapp : "o número da casa"}</p>
        ${fields.whatsapp_text ? html`<p class="st-previa__balao">${fields.whatsapp_text}</p>` : nothing}
      </div>`;
    case "seo":
      return html`<div class="st-previa st-previa--busca" lang=${lang === "pt" ? "pt-BR" : lang}>
        <p class="st-previa__url">territoriofoz.com.br${lang === "pt" ? "" : ` › ${lang}`}</p>
        <p class="st-previa__link">${t(fields.title)}</p>
        <p class="st-previa__desc">${t(fields.description)}</p>
      </div>`;
    default:
      return nothing;
  }
}

/** Um resumo de uma linha de uma versão, para o histórico. */
export function summary(def, fields) {
  if (!fields) return "";
  if (def.key === "notices") return `${(fields.items || []).length} ${(fields.items || []).length === 1 ? "aviso" : "avisos"}`;
  if (def.key === "today") return tx(fields.default, "pt");
  if (def.plain) return `@${fields.instagram || ""}`;
  return tx(fields[def.fields[0].name], "pt");
}

export const houseToday = (now = new Date()) => houseParts(now).date;
