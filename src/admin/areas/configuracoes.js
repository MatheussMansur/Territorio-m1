// Configurações (épico 2): o índice em /admin/configuracoes e uma tela por grupo em
// /admin/configuracoes/<grupo>. O dono muda as regras da casa; a gerente só lê
// os grupos abertos a ela; a recepção nunca chega aqui (a moldura do painel decide).
import "./configuracoes.css";
import { html, render } from "../../lib/html.js";
import * as api from "../../services/api/staff-configuracoes.js";
import { GROUPS } from "./configuracoes/catalog.js";
import { mountDevices } from "./configuracoes/devices.js";
import { mountGroup } from "./configuracoes/group.js";
import { mountHome } from "./configuracoes/home.js";
import { staffErrorMessage } from "../../lib/errors.js";
import { canDo } from "../nav.js";
import { visibleSlugs } from "./configuracoes/side-nav.js";

// a linha para onde aponta um resultado da busca, lida pela tela do grupo que abre em seguida
let highlight = null;

const loading = () => html`<div class="area__vazio" role="status"><span class="raiz raiz--gira" aria-hidden="true"></span><p>Abrindo as configurações…</p></div>`;

const failure = (error, again) => html`<div class="area__vazio" role="alert">
  <span class="raiz raiz--atencao" aria-hidden="true"></span>
  <p>
    <b>Não deu para abrir as configurações.</b>
    ${staffErrorMessage(error)}
  </p>
  <button class="btn" type="button" @click=${again}>Tentar de novo</button>
</div>`;

const missing = (owner) => html`<div class="area__vazio" role="alert">
  <span class="raiz raiz--atencao" aria-hidden="true"></span>
  <p><b>Esse grupo não está aqui.</b> ${owner ? "Ele pode ter mudado de nome." : "Ele pode ser só do dono."}</p>
  <a class="btn" href="/admin/configuracoes">Voltar às configurações</a>
</div>`;

export async function mount(container, { user, sub, navigate }) {
  let cleanup = null;
  let alive = true;
  const slug = sub.split("/")[0];
  const go = (path, row) => {
    highlight = row || null;
    navigate(path);
  };

  async function start() {
    render(loading(), container);
    let index;
    try {
      index = await api.index();
    } catch (error) {
      if (alive) render(failure(error, start), container);
      return;
    }
    if (!alive) return;
    const onSaved = () => api.index().then((fresh) => Object.assign(index, fresh)).catch(() => {});
    if (!slug) {
      cleanup = mountHome(container, { index, user, navigate: go });
      return;
    }
    if (!GROUPS[slug] || !visibleSlugs(index, user).includes(slug)) {
      render(missing(canDo(user.role, "PATCH /staff/settings/{group}", user.areas ?? undefined)), container);
      return;
    }
    if (GROUPS[slug].devices) {
      cleanup = mountDevices(container, { user, index });
      return;
    }
    const row = highlight;
    highlight = null;
    cleanup = mountGroup(container, { slug, user, navigate, index, highlight: row, onSaved });
  }

  await start();
  return () => {
    alive = false;
    cleanup?.();
  };
}
