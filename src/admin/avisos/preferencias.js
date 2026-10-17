// "Meus avisos" (FR-87): cada pessoa escolhe quais avisos importantes e informativos segue na
// central. Os críticos chegam sempre, para todos que recebem: aparecem marcados e travados.
// Quem recebe cada aviso continua sendo do catálogo e de Configurações › Avisos, do dono.
import { toast } from "../../components/toast.js";
import { describeError } from "../../lib/errors.js";
import { html, nothing, render } from "../../lib/html.js";
import * as api from "../../services/api/staff-avisos.js";
import { notice } from "../auth/comum.js";
import { LEVELS } from "./catalogo.js";
import { refreshNotices } from "./central.js";

const GROUP = {
  critical: { title: "Críticos", text: "Chegam sempre e furam o silêncio da noite. Não dá para desligar." },
  important: { title: "Importantes", text: "Contam no sino e somem quando alguém resolve. Esperam o fim do silêncio da noite." },
  info: { title: "Informativos", text: "Ficam na central e no Hoje, sem contar como urgente. Somem no fim da noite." },
};

/**
 * @param {HTMLElement} container
 * @param {{user: any}} options
 */
export function mountPreferences(container) {
  const s = { status: "loading", items: [], following: new Set(), busy: false, problem: null, dirty: false };
  let alive = true;

  async function load() {
    s.status = "loading";
    draw();
    try {
      const data = await api.preferences();
      s.items = data.items || [];
      s.following = new Set(s.items.filter((i) => i.following).map((i) => i.code));
      s.status = "ready";
      s.dirty = false;
    } catch (error) {
      s.status = "error";
      s.problem = error;
    }
    draw();
  }

  function toggle(code, on) {
    if (on) s.following.add(code);
    else s.following.delete(code);
    s.dirty = true;
    draw();
  }

  async function save(event) {
    event.preventDefault();
    if (s.busy) return;
    s.busy = true;
    draw();
    try {
      const muted = s.items.filter((i) => i.can_mute && !s.following.has(i.code)).map((i) => i.code);
      const data = await api.savePreferences(muted);
      s.items = data.items || s.items;
      s.following = new Set(s.items.filter((i) => i.following).map((i) => i.code));
      s.dirty = false;
      toast({ title: "Gravado", message: "A central já segue a sua escolha." });
      refreshNotices();
    } catch (error) {
      const d = describeError(error);
      toast({ kind: "error", title: d.title, message: d.text });
    }
    s.busy = false;
    draw();
  }

  function group(level) {
    const items = s.items.filter((i) => i.level === level);
    if (!items.length) return nothing;
    return html`<fieldset class="meus-avisos__grupo">
      <legend>${GROUP[level].title}</legend>
      <p class="meus-avisos__explica">${GROUP[level].text}</p>
      ${items.map(
        (i) => html`<label class="meus-avisos__linha">
          <input type="checkbox" name="seguir" value=${i.code} .checked=${!i.can_mute || s.following.has(i.code)} ?disabled=${!i.can_mute || s.busy}
            aria-describedby=${`aviso-some-${i.code}`} @change=${(e) => toggle(i.code, e.target.checked)} />
          <span><b>${i.title}</b><small id=${`aviso-some-${i.code}`}>Some ${i.clears}.${i.can_mute ? "" : " Sempre ligado."}</small></span>
        </label>`,
      )}
    </fieldset>`;
  }

  function body() {
    if (s.status === "loading") return html`<div class="area__vazio" role="status"><span class="raiz raiz--gira" aria-hidden="true"></span><p>Abrindo os seus avisos…</p></div>`;
    if (s.status === "error") {
      const d = describeError(s.problem);
      return notice({ title: d.title, text: d.text, action: "Tentar de novo", onAction: load });
    }
    return html`<p class="sessoes__intro">Os avisos da equipe aparecem só aqui no painel, no sino e no Hoje. Escolha o que você quer seguir: o que não seguir continua na aba "Tudo" da central, sem contar no sino.</p>
      <form class="meus-avisos" @submit=${save} aria-label="Avisos que você segue">
        ${Object.keys(LEVELS).map(group)}
        <div class="meus-avisos__acoes">
          <button class="btn" type="submit" ?disabled=${s.busy || !s.dirty}>${s.busy ? "Gravando…" : "Gravar"}</button>
        </div>
      </form>`;
  }

  function draw() {
    if (alive) render(body(), container);
  }

  load();
  return () => {
    alive = false;
  };
}
