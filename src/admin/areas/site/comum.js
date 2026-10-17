// Peças comuns às áreas Site, Cardápio e Galeria: estados, janelas, abas de idioma com
// o losango de "tradução faltando", contadores de caracteres, datas e as frases de erro da casa.
import "./comum.css";
import { openDialog } from "../../../components/dialog.js";
import { houseParts } from "../../../lib/dates.js";
import { staffErrorMessage } from "../../../lib/errors.js";
import { html, nothing, render } from "../../../lib/html.js";

export const LANGS = [
  { code: "pt", label: "Português", short: "PT", name: "português" },
  { code: "es", label: "Espanhol", short: "ES", name: "espanhol" },
  { code: "en", label: "Inglês", short: "EN", name: "inglês" },
];

export const raiz = (extra = "") => html`<span class="raiz ${extra}" aria-hidden="true"></span>`;

/** Carregando, dentro da área. */
export const loadingBox = (text = "Carregando…") => html`<div class="area__vazio" role="status">${raiz("raiz--gira")}<p>${text}</p></div>`;

/** Um estado vazio sempre diz o que fazer a seguir. */
export const emptyBox = ({ title, text, action }) => html`<div class="area__vazio cs-vazio">
  ${raiz()}
  <p class="cs-vazio__titulo">${title}</p>
  ${text ? html`<p>${text}</p>` : nothing}
  ${action || nothing}
</div>`;

/** Uma frase da casa para uma falha, do catálogo único (src/lib/errors.js), nunca o texto cru do servidor. */
export const sayError = (error, options) => staffErrorMessage(error, options);

/** O erro contido de uma parte da tela, com uma saída. */
export const errorBox = (error, retry, what = "Essa parte não abriu.") => html`<div class="area__vazio" role="alert">
  ${raiz("raiz--atencao")}
  <p><b>${what}</b> ${sayError(error)}</p>
  ${retry ? html`<button class="btn" type="button" @click=${retry}>Tentar de novo</button>` : nothing}
</div>`;

/** Os erros de campo de um 422 como { "kicker.pt": "…" }. */
export const fieldErrors = (error) => (error?.status === 422 && error.fieldErrors ? error.fieldErrors : {});

// ---- datas ---------------------------------------------------------------------------------

/** "15/10 às 20:41" no fuso da casa; "hoje às 20:41" e "ontem às …" quando perto. */
export function when(iso, now = new Date()) {
  if (!iso) return "";
  const p = houseParts(iso);
  const today = houseParts(now).date;
  const time = p.time;
  if (p.date === today) return `hoje às ${time}`;
  const yesterday = houseParts(new Date(new Date(now).getTime() - 86_400_000)).date;
  if (p.date === yesterday) return `ontem às ${time}`;
  return `${p.date.slice(8)}/${p.date.slice(5, 7)} às ${time}`;
}

/** "2026-10-25" → "25/10". */
export const dayMonth = (date) => (date ? `${date.slice(8)}/${date.slice(5, 7)}` : "");

/** Só o primeiro nome, do jeito que a casa fala. */
export const firstName = (name) => String(name || "").split(" ")[0];

// ---- dinheiro -------------------------------------------------------------------------------

export const money = (cents) =>
  cents == null ? "" : `R$ ${(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** "32", "32,50", "R$ 32,5" → 3200, 3250, 3250; "" → null; qualquer outra coisa → NaN. */
export function parseMoney(text) {
  const clean = String(text || "").replace(/r\$|\s/gi, "");
  if (!clean) return null;
  if (!/^\d{1,4}([.,]\d{1,2})?$/.test(clean)) return NaN;
  return Math.round(Number(clean.replace(",", ".")) * 100);
}

export const priceInput = (cents) => (cents == null ? "" : (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: cents % 100 ? 2 : 0 }));

// ---- três idiomas ------------------------------------------------------------------------

/** Os idiomas sem texto num valor traduzido (pt também conta como faltando). */
export const missing = (value) => LANGS.filter((l) => !String(value?.[l.code] || "").trim()).map((l) => l.code);

/** O losango de uma tradução pendente: forma mais palavras, nunca só a cor. */
export const losango = (label = "sem tradução") => html`<span class="losango" aria-hidden="true"></span><span class="sr-only">${label}</span>`;

/**
 * Abas pt / es / en. `missingIn` lista os idiomas com algo a traduzir; a aba
 * recebe o losango. As setas passam entre as abas (ARIA tabs), como em components/tabs.js.
 */
export function langTabs({ id, lang, missingIn = [], onPick, label = "Língua do texto" }) {
  const keydown = (event) => {
    const moves = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 1, ArrowUp: -1 };
    const index = LANGS.findIndex((l) => l.code === lang);
    let next;
    if (event.key in moves) next = LANGS[(index + moves[event.key] + LANGS.length) % LANGS.length];
    else if (event.key === "Home") next = LANGS[0];
    else if (event.key === "End") next = LANGS.at(-1);
    else return;
    event.preventDefault();
    onPick(next.code);
    requestAnimationFrame(() => document.getElementById(`${id}-tab-${next.code}`)?.focus());
  };
  return html`<div class="tabs tabs--row cs-linguas" role="tablist" aria-label=${label} @keydown=${keydown}>
    ${LANGS.map(
      (l) => html`<button
        class="tab"
        role="tab"
        type="button"
        id=${`${id}-tab-${l.code}`}
        aria-controls=${`${id}-painel`}
        aria-selected=${String(l.code === lang)}
        tabindex=${l.code === lang ? 0 : -1}
        @click=${() => onPick(l.code)}
      >
        ${l.label}${missingIn.includes(l.code) ? losango(l.code === "pt" ? "falta o texto" : "sem tradução") : nothing}
      </button>`,
    )}
  </div>`;
}

/** A linha embaixo das abas quando o idioma escolhido não tem texto: o site usa o português. */
export function missingNote(lang, missingIn) {
  if (!missingIn.includes(lang)) return nothing;
  const name = LANGS.find((l) => l.code === lang).name;
  return html`<p class="cs-pendente">
    ${losango("")}
    ${lang === "pt" ? "Falta o texto em português, que é a língua de base do site." : `Sem tradução em ${name}: o site usa o português até alguém traduzir.`}
  </p>`;
}

/**
 * Um campo de texto com o seu contador. `value` é uma string; `onInput(text)` a cada tecla.
 * Campos longos viram textarea. O erro, quando há, fica embaixo do campo.
 */
export function textField({ id, name, label, value = "", max, multiline = false, help, error, required = false, onInput, placeholder = "", lang }) {
  const length = String(value || "").length;
  const over = max && length > max;
  const describedBy = [help ? `${id}-ajuda` : "", max ? `${id}-conta` : "", error ? `${id}-erro` : ""].filter(Boolean).join(" ") || nothing;
  const input = (e) => onInput?.(e.target.value);
  return html`<div class="field ${error || over ? "field--invalid" : ""}">
    <label class="field__label" for=${id}>${label}${required ? nothing : html` <small>opcional</small>`}</label>
    ${multiline
      ? html`<textarea class="field__input" id=${id} name=${name} rows="3" lang=${lang || nothing} placeholder=${placeholder} aria-describedby=${describedBy} aria-invalid=${error || over ? "true" : "false"} .value=${value || ""} @input=${input}></textarea>`
      : html`<input class="field__input" id=${id} name=${name} lang=${lang || nothing} placeholder=${placeholder} aria-describedby=${describedBy} aria-invalid=${error || over ? "true" : "false"} .value=${value || ""} @input=${input} />`}
    ${help ? html`<p class="field__help" id=${`${id}-ajuda`}>${help}</p>` : nothing}
    ${max ? html`<span class="field__count ${over ? "is-over" : ""}" id=${`${id}-conta`}>${length}/${max}${over ? " · passou do limite" : ""}</span>` : nothing}
    ${error ? html`<p class="field__error" id=${`${id}-erro`}>${error}</p>` : nothing}
  </div>`;
}

// ---- janelas ------------------------------------------------------------------------------

let windows = 0;

/**
 * Uma janela desenhada com lit-html. `body(api)` devolve o template; api.redraw() desenha de novo
 * e api.close() fecha. Devolve a mesma api.
 */
export function openWindow({ title, body, size = "", isDirty, discard, onClose }) {
  const dialog = document.createElement("dialog");
  const id = `janela-${++windows}`;
  dialog.className = `dialog cs-janela ${size === "drawer" ? "dialog--drawer" : size === "small" ? "dialog--confirm cs-janela--pequena" : ""}`;
  dialog.setAttribute("aria-labelledby", `${id}-titulo`);
  document.body.append(dialog);
  const api = {
    id,
    dialog,
    redraw: () =>
      render(
        html`<div class="dialog__bar">
            <b class="dialog__title" id=${`${id}-titulo`}>${typeof title === "function" ? title() : title}</b>
            <button class="dialog__close" type="button" data-close aria-label="Fechar">×</button>
          </div>
          <div class="dialog__body">${body(api)}</div>`,
        dialog,
      ),
    close: () => handle.close(),
  };
  api.redraw();
  const handle = openDialog(dialog, {
    isDirty: isDirty || (() => false),
    discard,
    onClose: () => {
      onClose?.();
      dialog.remove();
    },
  });
  // o primeiro campo recebe o foco; sem nenhum, a própria janela
  requestAnimationFrame(() => (dialog.querySelector(".dialog__body :is(input, textarea, select)") || dialog.querySelector(".dialog__body button") || dialog).focus());
  return api;
}

/** Subpáginas de uma área como links (o roteador do painel as mantém no endereço). */
export function subnav(items, active, label) {
  return html`<nav class="cs-subnav" aria-label=${label}>
    <ul>
      ${items.map(
        (item) => html`<li><a class="cs-subnav__item" href=${item.path} aria-current=${item.key === active ? "page" : nothing}>${item.label}${item.count != null ? html` <small>${item.count}</small>` : nothing}</a></li>`,
      )}
    </ul>
  </nav>`;
}

/**
 * Pergunta antes de sair de uma tela com mudanças não salvas: links do painel e a saída do próprio navegador.
 * Devolve a limpeza.
 */
export function guardLeaving(isDirty, navigate, confirmLeave) {
  const onClick = async (event) => {
    const a = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!a || !isDirty() || a.target || a.origin !== window.location.origin || event.button !== 0 || event.metaKey || event.ctrlKey) return;
    if (a.closest("dialog")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (await confirmLeave()) navigate(a.pathname);
  };
  const onUnload = (event) => {
    if (!isDirty()) return;
    event.preventDefault();
    event.returnValue = "";
  };
  document.addEventListener("click", onClick, true);
  window.addEventListener("beforeunload", onUnload);
  return () => {
    document.removeEventListener("click", onClick, true);
    window.removeEventListener("beforeunload", onUnload);
  };
}

// ---- duas pessoas salvando a mesma coisa (412: "juntar ou descartar") ---------------------------

/** { "kicker.pt": "…" }: as folhas de um valor, para comparar as mudanças texto a texto. */
export function leaves(value, prefix = "", out = {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) leaves(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out[prefix] = value === undefined ? null : value;
  }
  return out;
}

function setLeaf(target, path, value) {
  const keys = path.split(".");
  let node = target;
  for (const k of keys.slice(0, -1)) node = node[k] && typeof node[k] === "object" ? node[k] : (node[k] = {});
  node[keys.at(-1)] = value;
}

/** As folhas que diferem entre dois valores. */
export const changedLeaves = (a, b) => {
  const x = leaves(a);
  const y = leaves(b);
  return [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((k) => JSON.stringify(x[k] ?? null) !== JSON.stringify(y[k] ?? null));
};

/**
 * Junta dois salvamentos: o que a outra pessoa salvou, mais o que eu mudei desde que li. Onde nós
 * dois mudamos o mesmo texto, fica o meu. Devolve { merged, theirs, mine, both }.
 */
export function joinChanges(base, mine, theirs) {
  const merged = structuredClone(theirs);
  const myChanges = changedLeaves(base, mine);
  const theirChanges = changedLeaves(base, theirs);
  const my = leaves(mine);
  for (const path of myChanges) setLeaf(merged, path, my[path]);
  return { merged, mine: myChanges, theirs: theirChanges, both: myChanges.filter((p) => theirChanges.includes(p)) };
}

/**
 * A janela de um 412: quem salvou, o que mudou, e "Juntar" ou "Descartar as minhas".
 * Resolve "join", "discard" ou null (continua editando, nada enviado).
 */
export function conflictWindow({ who, at, theirs = [], both = [], label = (path) => path, what = "este bloco" }) {
  return new Promise((resolve) => {
    let answer = null;
    const win = openWindow({
      title: "Outra pessoa gravou antes de você",
      size: "small",
      onClose: () => resolve(answer),
      body: () => html`<p><b>${firstName(who) || "Outra pessoa"}</b> gravou ${what} ${when(at)}, enquanto você editava. As suas mudanças continuam na tela.</p>
        ${theirs.length
          ? html`<p class="cs-dica">O que mudou do lado de lá:</p>
              <ul class="cs-conflito">${[...new Set(theirs.map(label))].map((l) => html`<li>${l}</li>`)}</ul>`
          : nothing}
        ${both.length ? html`<p class="cs-dica">Onde as duas pessoas mudaram o mesmo texto, ao juntar fica o seu.</p>` : nothing}
        <div class="dialog__actions cs-acoes">
          <button class="btn btn--sm" type="button" data-join @click=${() => ((answer = "join"), win.close())}>Juntar as mudanças</button>
          <button class="btn btn--outline btn--sm" type="button" @click=${() => ((answer = "discard"), win.close())}>Descartar as minhas</button>
          <button class="link-button" type="button" data-close>Continuar editando</button>
        </div>`,
    });
  });
}
