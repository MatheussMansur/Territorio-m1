// O idioma do navegador sugerido na primeira visita (história 4.2): uma página em português aberta por
// um navegador em espanhol ou inglês ganha uma barra no pé da tela, nesse idioma,
// oferecendo a mesma página em /es/ ou /en/. Nunca um redirecionamento forçado; no máximo 56 px de altura, fixa
// (não empurra nada, CLS 0) e acima da barra de cookies quando as duas aparecem. A escolha (aceitar,
// dispensar, ou um idioma escolhido no cabeçalho) vai para o cookie necessário trt_lingua, para a
// barra não voltar; com o armazenamento bloqueado ela só aparece de novo, sem erro.
import { get, set } from "../../lib/cookies.js";
import { LOCALES } from "../../lib/strings.js";

const OFFERED = ["es", "en"];

/** O idioma do site que o navegador prefere: o primeiro da lista dele que o site tem, ou null. */
export function browserLocale(languages = navigator.languages || [navigator.language]) {
  for (const tag of languages) {
    const base = String(tag || "").slice(0, 2).toLowerCase();
    if (base === "pt" || OFFERED.includes(base)) return base;
  }
  return null;
}

const text = (locale, key) => LOCALES[locale]?.site?.[key] || LOCALES.pt.site[key];

function remember(locale) {
  try {
    set("trt_lingua", locale);
  } catch {
    /* armazenamento bloqueado: a sugestão só não é lembrada */
  }
}

/** A mesma página em outro idioma: / → /es/, /cardapio/ → /es/cardapio/. */
export function samePageIn(locale, path = location.pathname) {
  const route = path.replace(/^\/(es|en)(?=\/|$)/, "") || "/";
  return locale === "pt" ? route : `/${locale}${route}`;
}

/** Mantém a barra acima da barra de cookies enquanto as duas estão na tela. */
function stackOverCookies(bar) {
  const place = () => {
    const cookies = document.querySelector(".cookies");
    bar.style.bottom = cookies ? `${cookies.getBoundingClientRect().height}px` : "0px";
  };
  const resize = new ResizeObserver(place);
  const watch = () => {
    const cookies = document.querySelector(".cookies");
    if (cookies) resize.observe(cookies);
    place();
  };
  watch();
  // a barra de cookies vem e vai como filha do <body>
  const observer = new MutationObserver(watch);
  observer.observe(document.body, { childList: true });
  return () => {
    observer.disconnect();
    resize.disconnect();
  };
}

export function languageSuggestion() {
  const page = document.documentElement.dataset.locale || "pt";
  // um idioma escolhido no cabeçalho também é lembrado
  document.addEventListener("click", (event) => {
    const link = event.target.closest?.(".langs a[hreflang]");
    if (link) remember(link.getAttribute("hreflang").slice(0, 2));
  });
  if (page !== "pt") return null;
  let chosen;
  try {
    chosen = get("trt_lingua");
  } catch {
    chosen = null; // armazenamento bloqueado: sugere, sem lembrar
  }
  if (chosen) return null;
  const offer = browserLocale();
  if (!offer || !OFFERED.includes(offer)) return null;

  const bar = document.createElement("div");
  bar.className = "lingua";
  bar.setAttribute("role", "region");
  bar.setAttribute("aria-label", text(offer, "langSuggestLabel"));
  bar.lang = offer;
  const message = document.createElement("p");
  message.className = "lingua__texto";
  message.textContent = text(offer, "langSuggest");
  const go = document.createElement("a");
  go.className = "btn btn--sm lingua__ir";
  go.href = samePageIn(offer);
  go.hreflang = offer;
  go.textContent = text(offer, "langSuggestGo");
  const stay = document.createElement("button");
  stay.type = "button";
  stay.className = "lingua__ficar";
  stay.setAttribute("aria-label", text(offer, "langSuggestStay"));
  stay.title = text(offer, "langSuggestStay");
  stay.textContent = "×";
  bar.append(message, go, stay);
  document.body.append(bar);
  const unstack = stackOverCookies(bar);

  const close = () => {
    unstack();
    bar.remove();
  };
  go.addEventListener("click", () => remember(offer));
  stay.addEventListener("click", () => {
    remember("pt");
    close();
  });
  return bar;
}
