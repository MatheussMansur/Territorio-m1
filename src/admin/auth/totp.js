// Ligar a verificação em duas etapas (histórias 1.6 e 1.9): o QR que o app autenticador lê (ou
// a chave digitada à mão), o primeiro código para confirmar, depois os 10 códigos de recuperação,
// cada um vale uma vez, para guardar num lugar seguro. Dono e gerente nunca entram no painel sem ela.
import { otpInput } from "../../components/otp.js";
import { describeError } from "../../lib/errors.js";
import { html, nothing, render, svg } from "../../lib/html.js";
import * as auth from "../../services/api/staff-auth.js";
import { saveText } from "./arquivo.js";
import { demoHint, notice } from "./comum.js";
import { qrPath } from "./qr.js";

/**
 * @param {HTMLElement} container
 * @param {{title?: string, intro?: string, onDone: () => void}} options
 */
export function mountTotp(container, { title = "Ligue a verificação em duas etapas", intro = "Ela protege o painel mesmo se alguém descobrir a sua senha.", onDone }) {
  const s = { step: "loading", url: "", secret: "", error: null, codeError: "", busy: false, codes: [], kept: false, copied: false };
  let alive = true;
  let otp = null;

  const set = (patch) => {
    Object.assign(s, patch);
    draw();
  };

  async function start() {
    set({ step: "loading", error: null });
    try {
      const answer = await auth.startMfa();
      if (alive) set({ step: "scan", url: answer.otpauth_url, secret: answer.secret });
    } catch (error) {
      if (alive) set({ step: "error", error });
    }
  }

  async function confirm(event) {
    event.preventDefault();
    if (s.busy) return;
    const code = otp?.value || "";
    if (!/^\d{6}$/.test(code)) {
      set({ codeError: "Digite os 6 números que o aplicativo mostra agora." });
      return container.querySelector(".otp__input")?.focus();
    }
    set({ busy: true, codeError: "" });
    try {
      const answer = await auth.confirmMfa(code);
      if (!alive) return;
      set({ busy: false, step: "codes", codes: answer.recovery_codes || [] });
      requestAnimationFrame(() => container.querySelector("#totp-codigos-titulo")?.focus());
    } catch (error) {
      if (!alive) return;
      const message = error?.errors?.[0]?.message || `${describeError(error, { variant: "mfa" }).title}.`;
      set({ busy: false, codeError: message });
      otp?.clear();
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(s.codes.join("\n"));
      set({ copied: true });
    } catch {
      set({ copied: false });
    }
  }

  const qr = () => {
    const { size, d } = qrPath(s.url);
    return html`<svg class="totp__qr" viewBox=${`0 0 ${size} ${size}`} role="img" aria-label="Código QR para o aplicativo de códigos" shape-rendering="crispEdges">
      ${svg`<rect class="totp__qr-fundo" width=${size} height=${size}></rect><path class="totp__qr-modulos" d=${d}></path>`}
    </svg>`;
  };

  function scan() {
    return html`<ol class="totp__passos">
        <li>Abra um aplicativo de códigos no celular (Google Authenticator, Microsoft Authenticator ou outro).</li>
        <li>Toque em adicionar e leia o QR abaixo.</li>
        <li>Digite os 6 números que aparecem no aplicativo.</li>
      </ol>
      <div class="totp__leitura">
        ${qr()}
        <p class="totp__chave">Não dá para ler? Digite esta chave no aplicativo:<br /><code>${s.secret.replace(/(.{4})/g, "$1 ").trim()}</code></p>
      </div>
      <form class="entrada__form" novalidate @submit=${confirm}>
        <div class="field ${s.codeError ? "field--invalid" : ""}">
          <label class="field__label" for="totp-codigo">Código do aplicativo</label>
          <div class="otp ${s.codeError ? "otp--invalid" : ""}">
            <input class="otp__input" id="totp-codigo" name="code" inputmode="numeric" autocomplete="one-time-code" aria-invalid=${s.codeError ? "true" : "false"} aria-describedby=${s.codeError ? "totp-codigo-erro" : nothing} />
            <div class="otp__boxes" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span></div>
          </div>
          ${s.codeError ? html`<p class="field__error" id="totp-codigo-erro">${s.codeError}</p>` : nothing}
        </div>
        <button class="btn entrada__enviar" type="submit" aria-busy=${String(s.busy)} ?disabled=${s.busy}>${s.busy ? "Conferindo…" : "Ligar a verificação"}</button>
      </form>
      ${demoHint(html`o QR funciona num aplicativo de verdade; o código <b>123456</b> também serve.`)}`;
  }

  function codes() {
    return html`<h2 class="entrada__subtitulo" id="totp-codigos-titulo" tabindex="-1">Guarde os códigos de recuperação</h2>
      <p class="entrada__texto">Se perder o celular, cada código abre o painel uma vez no lugar do aplicativo. Guarde fora do celular: impresso, ou num gerenciador de senhas.</p>
      <ol class="totp__codigos" aria-label="Códigos de recuperação">
        ${s.codes.map((c) => html`<li><code>${c}</code></li>`)}
      </ol>
      <div class="entrada__links">
        <button class="btn btn--sm btn--outline" type="button" @click=${() => saveText(`Território · códigos de recuperação\nCada código vale uma vez.\n\n${s.codes.join("\n")}\n`, "territorio-codigos-de-recuperacao.txt")}>Baixar os códigos</button>
        <button class="btn btn--sm btn--outline" type="button" @click=${copy}>${s.copied ? "Copiados" : "Copiar"}</button>
      </div>
      <label class="check entrada__manter">
        <input type="checkbox" .checked=${s.kept} @change=${(e) => set({ kept: e.target.checked })} />
        <span>Guardei os códigos num lugar seguro</span>
      </label>
      <button class="btn entrada__enviar" type="button" ?disabled=${!s.kept} @click=${() => onDone()}>Entrar no painel</button>`;
  }

  function view() {
    let body;
    if (s.step === "loading") body = html`<div class="entrada__carregando" role="status"><span class="raiz raiz--gira" aria-hidden="true"></span><p>Preparando o QR…</p></div>`;
    else if (s.step === "error") {
      const d = describeError(s.error);
      body = notice({ title: d.title, text: d.text, action: "Tentar de novo", onAction: start });
    } else body = s.step === "codes" ? codes() : scan();
    return html`<section class="entrada__caixa entrada__caixa--largo" aria-labelledby="totp-titulo">
      <h1 class="entrada__titulo" id="totp-titulo" tabindex="-1">${title}</h1>
      ${s.step === "codes" ? nothing : html`<p class="entrada__texto">${intro}</p>`}
      ${body}
    </section>`;
  }

  function draw() {
    if (!alive) return;
    render(view(), container);
    const box = container.querySelector(".otp");
    if (box && !box.dataset.on) {
      box.dataset.on = "1";
      otp = otpInput(box);
    }
  }

  start();
  return () => {
    alive = false;
  };
}
