// "Minhas sessões" (história 1.8, FR-75): onde a pessoa está conectada (aparelho, lugar aproximado,
// última atividade) e encerrar qualquer uma. Encerrar esta é o mesmo que "Sair". O dono encerra
// as sessões de outra pessoa em Equipe.
import { confirmAction } from "../../components/confirm.js";
import { toast } from "../../components/toast.js";
import { describeError } from "../../lib/errors.js";
import { html, nothing, render } from "../../lib/html.js";
import * as auth from "../../services/api/staff-auth.js";
import { notice } from "./comum.js";
import { canDo } from "../nav.js";

function since(iso) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 2) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return `há ${d} ${d === 1 ? "dia" : "dias"}`;
}

/**
 * @param {HTMLElement} container
 * @param {{user: any, onSignedOut: () => void}} options
 */
export function mountSessions(container, { user, onSignedOut }) {
  const s = { status: "loading", list: [], problem: null };
  let alive = true;

  async function load() {
    s.status = "loading";
    draw();
    try {
      s.list = await auth.sessions();
      s.status = "ready";
    } catch (error) {
      s.status = "error";
      s.problem = error;
    }
    draw();
  }

  async function end(item) {
    const ok = await confirmAction({
      title: item.current ? "Sair desta sessão?" : `Encerrar a sessão do ${item.device}?`,
      message: item.current ? "É o mesmo que tocar em Sair: o painel volta para a entrada." : "Quem estiver usando aquele aparelho sai do painel na próxima ação.",
      confirmLabel: item.current ? "Sair" : "Encerrar a sessão",
      cancelLabel: "Manter",
      danger: true,
    });
    if (!ok) return;
    try {
      await auth.endSession(item.id);
      if (item.current) return onSignedOut();
      s.list = s.list.filter((x) => x.id !== item.id);
      draw();
      toast({ title: "Sessão encerrada", message: `${item.device} sai do painel na próxima ação.` });
    } catch (error) {
      const d = describeError(error);
      toast({ kind: "error", title: d.title, message: d.text });
    }
  }

  function body() {
    if (s.status === "loading") return html`<div class="area__vazio" role="status"><span class="raiz raiz--gira" aria-hidden="true"></span><p>Abrindo as sessões…</p></div>`;
    if (s.status === "error") {
      const d = describeError(s.problem);
      return notice({ title: d.title, text: d.text, action: "Tentar de novo", onAction: load });
    }
    return html`<p class="sessoes__intro">Onde ${user?.name ? html`<b>${user.name}</b>` : "você"} está com o painel aberto. Não reconhece algum? Encerre e troque a senha em "Esqueci a senha".</p>
      <ul class="sessoes" aria-label="Sessões abertas">
        ${s.list.map(
          (item) => html`<li class="sessoes__item">
            <div class="sessoes__info">
              <b>${item.device}</b>
              ${item.current ? html`<span class="badge badge--confirmed">esta sessão</span>` : nothing}
              <span>${item.place || "Local desconhecido"} · última atividade ${since(item.last_seen_at)}${item.remember ? " · mantém conectado" : ""}</span>
            </div>
            <button class="btn btn--sm btn--outline" type="button" @click=${() => end(item)}>${item.current ? "Sair" : "Encerrar"}</button>
          </li>`,
        )}
      </ul>
      ${canDo(user?.role, "POST /staff/users/{id}/revoke-sessions", user?.areas ?? undefined) ? html`<p class="sessoes__nota">Para encerrar as sessões de outra pessoa da equipe, abra <a href="/admin/equipe">Equipe</a> e toque em "Encerrar sessões" na linha dela.</p>` : nothing}`;
  }

  function draw() {
    if (alive) render(body(), container);
  }

  load();
  return () => {
    alive = false;
  };
}
