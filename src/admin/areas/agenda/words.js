// Um texto público nos três idiomas do site: uma aba por idioma, os que faltam marcados
// "falta" (o português é obrigatório; o site usa ele onde falta tradução). O motivo do plano
// do dia e o motivo do evento privado usam isto.
import { html, nothing } from "../../../lib/html.js";

export const LANGS = [
  ["pt", "Português"],
  ["es", "Español"],
  ["en", "English"],
];

/** { pt, es, en } a partir de um texto simples (dados antigos) ou de um objeto incompleto. */
export const asWords = (value) => (value && typeof value === "object" ? { pt: "", es: "", en: "", ...value } : { pt: value || "", es: "", en: "" });

/** Idiomas fora o português que ainda estão vazios. */
export const missingLangs = (value) => LANGS.slice(1).filter(([l]) => !String(asWords(value)[l]).trim()).map(([, name]) => name);

/**
 * @param {{id: string, label: string, name: string, value: object, lang: string, setLang: (l: string) => void,
 *   onInput: (value: object) => void, placeholder?: string, disabled?: boolean}} options
 */
export function localizedField({ id, label, name, value, lang, setLang, onInput, placeholder = "", disabled = false }) {
  const words = asWords(value);
  const missing = (l) => l !== "pt" && !String(words[l]).trim();
  const move = (e) => {
    if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    e.preventDefault();
    const i = LANGS.findIndex(([l]) => l === lang);
    const next = LANGS[(i + (e.key === "ArrowRight" ? 1 : LANGS.length - 1)) % LANGS.length][0];
    setLang(next);
    requestAnimationFrame(() => document.getElementById(`${id}-aba-${next}`)?.focus());
  };
  const langName = LANGS.find(([l]) => l === lang)[1];
  return html`<div class="ag-palavras">
    <div class="tabs tabs--row ag-palavras__abas" role="tablist" aria-label="Língua do texto" @keydown=${move}>
      ${LANGS.map(
        ([l, n]) => html`<button type="button" role="tab" class="tab" id=${`${id}-aba-${l}`} aria-controls=${`${id}-painel`} aria-selected=${lang === l ? "true" : "false"} tabindex=${lang === l ? "0" : "-1"} @click=${() => setLang(l)}>
          ${n}${missing(l) ? html` <span class="ag-falta">falta<span class="sr-only">, sem tradução</span></span>` : nothing}
        </button>`,
      )}
    </div>
    <div id=${`${id}-painel`} role="tabpanel" aria-labelledby=${`${id}-aba-${lang}`}>
      <label class="field">
        <span class="field__label">${label}${lang === "pt" ? "" : ` (${langName})`}</span>
        <input
          class="field__input"
          name=${lang === "pt" ? name : nothing}
          .value=${words[lang]}
          placeholder=${lang === "pt" ? placeholder : words.pt}
          ?disabled=${disabled}
          @input=${(e) => onInput({ ...words, [lang]: e.target.value })}
        />
        <span class="field__help">${lang === "pt" ? "O português é obrigatório." : "Sem tradução, o site mostra o texto em português."}</span>
      </label>
    </div>
  </div>`;
}
