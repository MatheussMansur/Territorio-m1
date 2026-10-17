// O lado do aparelho da casa (histórias 1.10 e 1.11): pedir o pareamento (a própria chave, o aviso quando
// o navegador pode apagá-la, o código de 8 caracteres, esperar o dono), e as telas de um
// aparelho que não pode seguir: sem WebCrypto, relógio errado, assinatura recusada, chave perdida,
// aparelho não mais aprovado. Nunca "parear de novo" por causa do relógio.
import { describeError } from "../../lib/errors.js";
import { html, nothing, render } from "../../lib/html.js";
import * as auth from "../../services/api/staff-auth.js";
import { ENTRY } from "../nav.js";
import { IS_MOCK, field, notice, raiz } from "./comum.js";
import { canHoldKey, keepStorage, mark, requestPairing, setMark } from "./device.js";

const suggested = () => (/Android|iPad|Tablet/i.test(navigator.userAgent) ? "Tablet do salão" : "Computador da recepção");
const spaced = (code) => String(code || "").replace(/(.{4})(?=.)/, "$1 ");
const hour = (iso) => new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/**
 * @param {HTMLElement} container
 * @param {{onApproved: () => void, replaces?: string|null}} options
 *   replaces: o id deste aparelho antes de perder a chave (o dono revoga ao aprovar)
 */
export function mountPairing(container, { onApproved, replaces = null }) {
  const pending = mark()?.status === "pending" ? mark() : null;
  const s = {
    step: !canHoldKey() ? "nocrypto" : pending ? "waiting" : replaces ? "lost" : "intro",
    label: suggested(),
    error: "",
    busy: false,
    code: pending?.code || "",
    id: pending?.device_id || null,
    expires: pending?.expires_at || null,
    status: "pending",
    problem: null,
  };
  let alive = true;
  let timer = null;

  const set = (patch) => {
    Object.assign(s, patch);
    draw();
  };
  const focusTitle = () => requestAnimationFrame(() => container.querySelector(".entrada__titulo")?.focus());

  async function ask() {
    if (s.busy) return;
    if (!s.label.trim()) {
      set({ error: "Dê um nome ao aparelho, como ele é chamado na casa." });
      return container.querySelector("#aparelho-nome")?.focus();
    }
    set({ busy: true, error: "", problem: null });
    // a chave fica no armazenamento deste navegador: pede para mantê-la, e avisa antes do código quando ela pode sumir
    const kept = await keepStorage();
    if (!alive) return;
    if (!kept && s.step !== "warned") {
      set({ busy: false, step: "warning" });
      return focusTitle();
    }
    await pair();
  }

  async function pair() {
    set({ busy: true, problem: null });
    try {
      const pairing = await requestPairing({ label: s.label.trim(), replaces });
      if (!alive) return;
      set({ busy: false, step: "waiting", code: pairing.code, id: pairing.id, expires: pairing.expires_at, status: "pending" });
      focusTitle();
      poll(pairing.poll_after_s);
    } catch (error) {
      if (!alive) return;
      if (error?.type === "webcrypto_unavailable") return set({ busy: false, step: "nocrypto" });
      set({ busy: false, problem: error });
    }
  }

  function poll(seconds = 3) {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!alive || !s.id) return;
      try {
        const answer = await auth.devices.pairing(s.id);
        if (!alive) return;
        if (answer.status === "approved") {
          setMark({ device_id: s.id, status: "approved" });
          return onApproved();
        }
        if (answer.status === "pending") return poll(answer.poll_after_s);
        set({ step: "ended", status: answer.status });
        focusTitle();
      } catch {
        // sem conexão: continua perguntando, a tela segue sozinha
        poll(Math.max(seconds, 5));
      }
    }, seconds * 1000);
  }

  function intro(lost) {
    return html`<section class="entrada__caixa" aria-labelledby="aparelho-titulo">
      ${lost ? raiz("raiz--atencao") : nothing}
      <h1 class="entrada__titulo" id="aparelho-titulo" tabindex="-1">${lost ? describeError("device_key_lost").title : "Usar este aparelho na casa"}</h1>
      <p class="entrada__texto">
        ${lost
          ? describeError("device_key_lost").text
          : "O computador da recepção ou o tablet do salão vira um aparelho da casa: a equipe entra nele tocando o nome e digitando o PIN. O dono aprova o pedido no painel dele."}
      </p>
      <form class="entrada__form" novalidate @submit=${(e) => {
        e.preventDefault();
        ask();
      }}>
        ${field({ id: "aparelho-nome", label: "Nome do aparelho", name: "label", value: s.label, error: s.error, maxlength: 60, help: "Como a equipe chama este aparelho. O dono pode mudar ao aprovar.", onInput: (v) => (s.label = v) })}
        ${s.problem ? notice({ title: describeError(s.problem).title, text: describeError(s.problem).text }) : nothing}
        <button class="btn entrada__enviar" type="submit" aria-busy=${String(s.busy)} ?disabled=${s.busy}>${s.busy ? "Preparando a chave…" : lost ? "Pedir pareamento de novo" : "Pedir pareamento"}</button>
      </form>
      <div class="entrada__links"><a class="link-button" href=${ENTRY}>Entrar com e-mail e senha</a></div>
    </section>`;
  }

  function warning() {
    return html`<section class="entrada__caixa" aria-labelledby="aparelho-titulo">
      ${raiz("raiz--atencao")}
      <h1 class="entrada__titulo" id="aparelho-titulo" tabindex="-1">Este navegador pode apagar a chave da casa</h1>
      <p class="entrada__texto">Use um perfil fixo do Chrome ou do Edge, fora da janela anônima e do modo convidado. Se a chave sumir, o aparelho precisa pedir o pareamento de novo.</p>
      <div class="entrada__acoes">
        <button class="btn" type="button" ?disabled=${s.busy} aria-busy=${String(s.busy)} @click=${() => {
          s.step = "warned";
          pair();
        }}>Mostrar o código mesmo assim</button>
        <a class="link-button" href=${ENTRY}>Voltar</a>
      </div>
    </section>`;
  }

  function waiting() {
    const d = describeError("device_pending", { vars: { code: spaced(s.code) } });
    return html`<section class="entrada__caixa entrada__caixa--estado" aria-labelledby="aparelho-titulo">
      <h1 class="entrada__titulo" id="aparelho-titulo" tabindex="-1">${d.title}</h1>
      <p class="aparelho-codigo" aria-label=${`Código: ${s.code.split("").join(" ")}`}>${spaced(s.code)}</p>
      <p class="entrada__texto">${d.text}</p>
      <p class="entrada__espera" role="status"><span class="raiz raiz--gira" aria-hidden="true"></span> Esperando a aprovação${s.expires ? ` · o código vale até ${hour(s.expires)}` : ""}</p>
      ${IS_MOCK
        ? html`<p class="entrada__demo" role="note">
            <b>Demonstração:</b> aprove em outra aba deste navegador:
            <a href="/admin/configuracoes/aparelhos-e-impressoras?papel=dono" target="_blank" rel="noopener">Aparelhos e impressoras, como dono</a>.
          </p>`
        : nothing}
    </section>`;
  }

  function ended() {
    const refused = s.status === "rejected";
    return html`<section class="entrada__caixa entrada__caixa--estado" aria-labelledby="aparelho-titulo">
      ${raiz("raiz--atencao")}
      <h1 class="entrada__titulo" id="aparelho-titulo" tabindex="-1">${refused ? "O dono recusou este pedido" : "O código venceu"}</h1>
      <p class="entrada__texto">${refused ? "Se este aparelho é mesmo da casa, peça de novo e combine com o dono." : "O código vale 10 minutos. Peça outro e mostre ao dono."}</p>
      <button class="btn" type="button" @click=${() => set({ step: "intro", code: "", id: null })}>Pedir outro código</button>
    </section>`;
  }

  function draw() {
    if (!alive) return;
    const views = {
      intro: () => intro(false),
      lost: () => intro(true),
      warning,
      warned: () => (s.code ? waiting() : warning()),
      waiting,
      ended,
      nocrypto: () => deviceProblem({ type: "webcrypto_unavailable" }, { onRetry: () => window.location.reload() }),
    };
    render(views[s.step](), container);
  }

  draw();
  if (s.step === "waiting") poll(1);
  return () => {
    alive = false;
    clearTimeout(timer);
  };
}

/**
 * A tela de um aparelho que não pode seguir. `error` é o problema (webcrypto_unavailable,
 * device_signature_invalid com motivo "clock" ou não, device_key_lost, device_not_approved).
 */
export function deviceProblem(error, { onRetry, onRepair } = {}) {
  const d = describeError(error);
  const actions = {
    webcrypto_unavailable: html`<button class="btn" type="button" @click=${onRetry}>Tentar de novo</button>`,
    device_clock_skew: html`<button class="btn" type="button" @click=${onRetry}>Tentar de novo</button>`,
    device_signature_invalid: html`<p class="entrada__texto"><b>Confira a data e a hora</b> nas configurações do aparelho.</p>
      <button class="btn" type="button" @click=${onRetry}>Tentar de novo</button>`,
    device_key_lost: html`<button class="btn" type="button" @click=${onRepair}>Pedir pareamento de novo</button>`,
    device_not_approved: html`<button class="btn" type="button" @click=${onRepair}>Parear de novo</button>`,
  }[d.code];
  return html`<section class="entrada__caixa entrada__caixa--estado" aria-labelledby="aparelho-titulo">
    ${raiz("raiz--atencao")}
    <h1 class="entrada__titulo" id="aparelho-titulo" tabindex="-1">${d.title}</h1>
    <p class="entrada__texto">${d.text}</p>
    <div class="entrada__acoes">${actions || nothing}</div>
    <div class="entrada__links"><a class="link-button" href=${ENTRY}>Entrar com e-mail e senha</a></div>
  </section>`;
}
