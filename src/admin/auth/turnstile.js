// Cloudflare Turnstile na entrada da equipe (AD-14): a chave de teste grátis até existir a chave
// da casa (VITE_TURNSTILE_SITE_KEY). O token vai junto com o login; o servidor confere.
// Quando o script não carrega, o formulário vai mesmo assim e o servidor decide (P-turnstile).
const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
// chave de teste da Cloudflare que sempre passa, visível
export const TEST_SITE_KEY = "1x00000000000000000000AA";
const SITE_KEY = import.meta.env?.VITE_TURNSTILE_SITE_KEY || TEST_SITE_KEY;

let loading = null;

function loadScript() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile")));
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error("turnstile"));
    };
    document.head.append(script);
  });
  return loading;
}

/**
 * Desenha a verificação dentro de `host`. `onToken(token|null)` recebe cada token novo (null quando
 * venceu ou falhou). Devolve { reset(), remove() }.
 */
export function mountTurnstile(host, { onToken, onUnavailable } = {}) {
  let widget = null;
  let gone = false;
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  loadScript()
    .then((turnstile) => {
      if (gone || !host.isConnected) return;
      widget = turnstile.render(host, {
        sitekey: SITE_KEY,
        theme: dark ? "dark" : "light",
        language: "pt-br",
        callback: (token) => onToken?.(token),
        "expired-callback": () => onToken?.(null),
        "error-callback": () => onToken?.(null),
      });
    })
    .catch(() => {
      if (!gone) onUnavailable?.();
    });
  return {
    /** Um token vale uma vez: depois de uma tentativa que falhou a verificação roda de novo. */
    reset() {
      onToken?.(null);
      if (widget != null) window.turnstile?.reset(widget);
    },
    remove() {
      gone = true;
      if (widget != null) window.turnstile?.remove(widget);
    },
  };
}
