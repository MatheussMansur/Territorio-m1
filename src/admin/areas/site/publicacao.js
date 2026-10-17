// "Situação da publicação": a última execução da tarefa site_render, acompanhada enquanto roda.
// Usada pelas áreas Site e Cardápio depois de "Publicar".
import { html, nothing } from "../../../lib/html.js";
import { builds } from "../../../services/api/staff-site.js";
import { firstName, raiz, when } from "./comum.js";

const REASONS = {
  "menu:publish": "cardápio",
  "content:cover": "capa",
  "content:about": "a casa",
  "content:notices": "avisos",
  "content:today": "frases do dia",
  "content:links": "links",
  "content:seo": "busca (SEO)",
};

export const reasonLabel = (reason) => REASONS[reason] || "site";

/**
 * Acompanha a última publicação. `onChange()` redesenha a tela; `filter(build)` escolhe os
 * builds que interessam a esta tela (o cardápio, ou os blocos).
 */
export function publication({ onChange, filter = () => true }) {
  let last = null;
  let timer = null;
  let stopped = false;
  let failedToLoad = false;

  const poll = async () => {
    clearTimeout(timer);
    try {
      const list = await builds(10);
      last = list.find(filter) || null;
      failedToLoad = false;
    } catch {
      failedToLoad = true;
    }
    if (stopped) return;
    onChange();
    if (last && (last.status === "pending" || last.status === "running")) timer = setTimeout(poll, 1200);
  };

  return {
    load: poll,
    /** Logo depois de publicar: mostra "publicando" na hora e acompanha. */
    started() {
      last = { status: "pending", requested_at: new Date().toISOString(), reason: "" };
      onChange();
      timer = setTimeout(poll, 600);
    },
    get running() {
      return Boolean(last && (last.status === "pending" || last.status === "running"));
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
    /** A linha de situação; `retry` publica de novo depois de uma falha. */
    view(retry) {
      if (failedToLoad && !last) return nothing;
      if (!last) return nothing;
      if (last.status === "pending" || last.status === "running") {
        return html`<div class="cs-pub cs-pub--andando" role="status">
          ${raiz("raiz--gira")}
          <p><b>Publicando…</b> O site muda em até 2 minutos. Pode seguir trabalhando.</p>
        </div>`;
      }
      if (last.status === "failed") {
        return html`<div class="notice notice--alert cs-pub cs-pub--falhou" role="alert">
          <p><b>O site não atualizou.</b> O que você publicou está guardado, mas o site ainda mostra a versão anterior. Tente publicar de novo; quem cuida do sistema já recebeu o aviso.</p>
          ${retry ? html`<button class="btn btn--sm" type="button" @click=${retry}>Publicar de novo</button>` : nothing}
        </div>`;
      }
      return html`<p class="cs-pub cs-pub--feito" role="status">
        <span class="badge badge--confirmed">no ar</span>
        Última publicação ${when(last.finished_at || last.requested_at)}${last.requested_by ? html`, por ${firstName(last.requested_by)}` : nothing} · ${reasonLabel(last.reason)}
      </p>`;
    },
  };
}
