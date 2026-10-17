// História 1.12: num aparelho aprovado da casa a pessoa toca no nome e digita os 4 últimos
// dígitos do telefone. 5 PINs errados travam aquela pessoa por 15 minutos (o dono é avisado);
// outra pessoa ainda pode entrar com o próprio nome. Sem ninguém cadastrado para o perfil do
// aparelho, a tela avisa, e a entrada pessoal fica a um toque.
import { describeError } from "../../lib/errors.js";
import { html, nothing, render } from "../../lib/html.js";
import * as auth from "../../services/api/staff-auth.js";
import { notice } from "./comum.js";

const hour = (iso) => new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const first = (name) => String(name || "").trim().split(/\s+/)[0];

/**
 * @param {HTMLElement} container
 * @param {{device: any, warning?: string, onEnter: (session: any) => void, onPersonal: () => void, overlay?: boolean}} options
 *   overlay: desenhada por cima do painel (inatividade, "Trocar de pessoa", no_active_person); o título é um h2.
 */
export function mountLock(container, { device, warning, onEnter, onPersonal, overlay = false }) {
  const s = { status: "loading", people: [], person: null, pin: "", error: "", problem: null, busy: false };
  let alive = true;

  const set = (patch) => {
    Object.assign(s, patch);
    draw();
  };
  const focus = (selector) => requestAnimationFrame(() => container.querySelector(selector)?.focus());

  async function load() {
    set({ status: "loading", problem: null });
    try {
      const people = await auth.devices.people();
      if (alive) set({ status: "ready", people });
    } catch (error) {
      if (alive) set({ status: "error", problem: error });
    }
    focus(".trava__titulo");
  }

  function choose(person) {
    set({ person, pin: "", error: "", problem: null });
    focus("#trava-pin");
  }

  async function enter() {
    if (s.busy || s.pin.length !== 4) return;
    set({ busy: true, error: "", problem: null });
    try {
      const session = await auth.pinLogin({ userId: s.person.user_id, pin: s.pin });
      if (!alive) return;
      set({ busy: false });
      onEnter(session);
    } catch (error) {
      if (!alive) return;
      if (error?.type === "pin_invalid") {
        set({ busy: false, pin: "", error: describeError(error).title + ". " + describeError(error).text });
        return focus("#trava-pin");
      }
      if (error?.type === "pin_locked") {
        const until = error.body?.locked_until;
        s.people = s.people.map((p) => (p.user_id === s.person.user_id ? { ...p, locked_until: until } : p));
        return set({ busy: false, pin: "", problem: { error, name: first(s.person.name) } });
      }
      set({ busy: false, pin: "", problem: { error } });
    }
  }

  const type = (digit) => {
    if (s.pin.length >= 4) return;
    set({ pin: s.pin + digit, error: "" });
    if (s.pin.length === 4) enter();
  };

  function names() {
    if (s.status === "loading") return html`<div class="trava__carregando" role="status"><span class="raiz raiz--gira" aria-hidden="true"></span><p>Abrindo…</p></div>`;
    if (s.status === "error") {
      const d = describeError(s.problem.error ?? s.problem);
      return notice({ title: d.title, text: d.text, action: "Tentar de novo", onAction: load });
    }
    if (!s.people.length) {
      return html`<div class="trava__vazio" role="status">
        <p><b>Ninguém cadastrado para este aparelho.</b> Peça ao dono para cadastrar em Equipe.</p>
      </div>`;
    }
    return html`<ul class="trava__nomes" aria-label="Pessoas da equipe">
      ${s.people.map(
        (p) => html`<li>
          <button class="trava__nome" type="button" @click=${() => choose(p)} aria-describedby=${p.locked_until ? `trava-travado-${p.user_id}` : nothing}>
            <span>${p.name}</span>
            ${p.locked_until ? html`<small id=${`trava-travado-${p.user_id}`}>travado até ${hour(p.locked_until)}</small>` : nothing}
          </button>
        </li>`,
      )}
    </ul>`;
  }

  function pinPad() {
    const locked = s.problem?.error?.type === "pin_locked";
    const d = s.problem && describeError(s.problem.error, { vars: { name: s.problem.name } });
    return html`<form class="trava__pin" novalidate @submit=${(e) => {
      e.preventDefault();
      enter();
    }}>
      <div class="field ${s.error ? "field--invalid" : ""}">
        <label class="field__label" for="trava-pin">PIN de ${first(s.person.name)}: os 4 últimos números do seu telefone</label>
        <input
          class="field__input trava__entrada"
          id="trava-pin"
          name="pin"
          type="password"
          inputmode="numeric"
          autocomplete="off"
          maxlength="4"
          .value=${s.pin}
          ?disabled=${locked}
          aria-invalid=${s.error ? "true" : "false"}
          aria-describedby=${s.error ? "trava-pin-erro" : nothing}
          @input=${(e) => {
            const clean = e.target.value.replace(/\D/g, "").slice(0, 4);
            e.target.value = clean;
            s.pin = clean;
            if (clean.length === 4) enter();
          }}
        />
        ${s.error ? html`<p class="field__error" id="trava-pin-erro">${s.error}</p>` : nothing}
      </div>
      ${d ? notice({ title: d.title, text: d.text }) : nothing}
      <div class="trava__teclado" role="group" aria-label="Teclado do PIN">
        ${["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((n) => html`<button type="button" class="trava__tecla" ?disabled=${locked || s.busy} @click=${() => type(n)}>${n}</button>`)}
        <button type="button" class="trava__tecla trava__tecla--apagar" ?disabled=${locked || s.busy} @click=${() => set({ pin: s.pin.slice(0, -1) })} aria-label="Apagar">⌫</button>
        <button type="button" class="trava__tecla" ?disabled=${locked || s.busy} @click=${() => type("0")}>0</button>
        <button type="submit" class="trava__tecla trava__tecla--entrar" ?disabled=${locked || s.busy || s.pin.length !== 4} aria-busy=${String(s.busy)}>Entrar</button>
      </div>
      <button class="link-button" type="button" @click=${() => {
        set({ person: null, pin: "", error: "", problem: null });
        focus(".trava__titulo");
      }}>Voltar aos nomes</button>
    </form>`;
  }

  function view() {
    const Title = s.person ? `Olá, ${first(s.person.name)}` : "Quem está usando?";
    return html`<section class="trava" aria-labelledby="trava-titulo">
      <p class="trava__aparelho">${device?.name || "Aparelho da casa"}</p>
      ${overlay ? html`<h2 class="trava__titulo" id="trava-titulo" tabindex="-1">${Title}</h2>` : html`<h1 class="trava__titulo" id="trava-titulo" tabindex="-1">${Title}</h1>`}
      ${warning ? html`<p class="aviso aviso--alerta" role="status">${warning}</p>` : nothing}
      ${s.person ? nothing : html`<p class="trava__texto">Toque no seu nome e digite o PIN. A tela continua onde estava.</p>`}
      ${s.person ? pinPad() : names()}
      <div class="entrada__links"><button class="link-button" type="button" @click=${onPersonal}>Entrar com e-mail e senha</button></div>
    </section>`;
  }

  function draw() {
    if (alive) render(view(), container);
  }

  load();
  return () => {
    alive = false;
  };
}
