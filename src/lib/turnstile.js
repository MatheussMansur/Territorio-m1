// A checagem contra robôs (Cloudflare Turnstile, AR-43) antes do código do WhatsApp e da reserva.
// Invisível: a pessoa nunca resolve um desafio. Com a API simulada (testes e demonstração) a página
// usa o token da chave de teste gratuita do Turnstile, que o segredo de teste do servidor aceita; com a
// API de verdade carrega o Turnstile com VITE_TURNSTILE_SITEKEY (a chave de teste enquanto não houver uma).
const TEST_SITEKEY = "1x00000000000000000000BB"; // invisível, sempre passa
export const TEST_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let loading = null;

function load() {
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => resolve(window.turnstile);
    script.onerror = () => {
      loading = null;
      reject(new Error("turnstile"));
    };
    document.head.append(script);
  });
  return loading;
}

/** Um token novo para um pedido; string vazia quando a checagem não pôde rodar (aí a API recusa com turnstile_failed). */
export async function turnstileToken() {
  if (import.meta.env?.VITE_API_MODE === "mock") return TEST_TOKEN;
  try {
    const turnstile = await load();
    const host = document.createElement("div");
    host.hidden = true;
    document.body.append(host);
    return await new Promise((resolve) => {
      const done = (token) => {
        host.remove();
        resolve(token || "");
      };
      turnstile.render(host, {
        sitekey: import.meta.env?.VITE_TURNSTILE_SITEKEY || TEST_SITEKEY,
        size: "invisible",
        callback: done,
        "error-callback": () => done(""),
        "timeout-callback": () => done(""),
      });
    });
  } catch {
    return "";
  }
}
