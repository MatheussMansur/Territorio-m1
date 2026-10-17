// Cardápio (histórias 4.11 a 4.13). O dono e o gerente editam categorias e pratos num
// rascunho, veem a prévia como o cliente verá e publicam; "acabou" vai para o site na hora,
// sem publicar. A recepção vê só as chaves de "acabou", e só enquanto
// Configurações › Salão deixa ("recepção marca acabou").
// Ordem: as setas movem um (PATCH sort); arrastar, uma ou várias linhas escolhidas juntas,
// manda a nova ordem inteira (PUT /staff/menu/order). Publicar confere antes as palavras da casa
// (NFR-34) e diz qual prato corrigir; uma publicação que falhou oferece "Publicar de novo".
import "./cardapio.css";
import { confirmAction } from "../../components/confirm.js";
import { toast } from "../../components/toast.js";
import { html, nothing, render } from "../../lib/html.js";
import * as api from "../../services/api/staff-cardapio.js";
import { lintFields } from "../../site/lint.js";
import { canDo } from "../nav.js";
import { categoryWindow, itemWindow, STYLES } from "./cardapio/janelas.js";
import { emptyCategories, previewBody } from "./cardapio/previa.js";
import { emptyBox, errorBox, firstName, loadingBox, money, openWindow, sayError, when } from "./site/comum.js";
import { publication } from "./site/publicacao.js";

const BADGE = { vegetarian: "vegetariano", gluten_free: "sem glúten", spicy: "picante" };

export async function mount(container, { user }) {
  // quem edita o cardápio (os outros só marcam um prato como acabado, 4.13): o arquivo de permissões (história 1.3)
  const floor = !canDo(user?.role, "POST /staff/menu/items", user?.areas ?? undefined);
  let state = { status: "loading" };
  let selected = null; // o id da categoria aberta
  let search = "";
  let picked = new Set(); // pratos escolhidos para arrastar juntos
  let dragging = null; // { kind: "item" | "category", ids }
  let lintProblems = []; // o que impede a publicação, campo por campo
  const pub = floor ? null : publication({ onChange: () => draw(), filter: (b) => b.reason === "menu:publish" });

  const categories = () => state.menu?.categories || [];
  const current = () => categories().find((c) => c.id === selected) || categories()[0] || null;

  async function load({ quiet = false } = {}) {
    if (!quiet) {
      state = { status: "loading" };
      draw();
    }
    try {
      const [menu] = await Promise.all([api.menu(), pub?.load()]);
      state = { status: "ready", menu };
      if (!categories().some((c) => c.id === selected)) selected = categories()[0]?.id || null;
      // um problema de palavra mostrado antes some assim que o prato é corrigido
      if (lintProblems.length && !floor) lintProblems = lintDraft();
    } catch (error) {
      if (!quiet) state = { status: "error", error };
      else toast({ kind: "error", title: "Não deu para atualizar o cardápio", message: sayError(error) });
    }
    draw();
  }

  // ---- "acabou": direto para o site ----------------------------------------------------

  async function toggleSoldOut(item, soldOut) {
    if (!navigator.onLine) {
      draw();
      return toast({ kind: "error", title: "Sem conexão, não dá para gravar", message: "Anote na folha da noite e marque aqui quando a internet voltar." });
    }
    item.available = !soldOut;
    draw();
    try {
      await api.setAvailable(item.id, !soldOut);
      toast({
        title: soldOut ? `${item.name}: acabou` : `${item.name} voltou`,
        message: soldOut ? "O site já mostra que acabou." : "O site já mostra o prato de novo.",
        action: { label: "Desfazer", onClick: () => toggleSoldOut(item, !soldOut) },
      });
    } catch (error) {
      item.available = soldOut;
      draw();
      toast({ kind: "error", title: "Não deu para marcar", message: sayError(error) });
    }
  }

  const soldOutSwitch = (item) => html`<label class="cd-acabou ${item.available ? "" : "is-on"}">
    <input type="checkbox" .checked=${!item.available} aria-labelledby=${`prato-${item.id} acabou-${item.id}`} @change=${(e) => toggleSoldOut(item, e.target.checked)} />
    <span id=${`acabou-${item.id}`}>Acabou</span>
  </label>`;

  // ---- a recepção ------------------------------------------------------------------------

  function floorView() {
    if (state.menu.settings?.reception_can_finish === false) {
      return html`<div class="notice cd-aviso" role="status">
        <p><b>Por enquanto, quem marca o acabou é o gerente.</b> O dono deixou isso fechado para a recepção em Configurações › Salão. Se um prato acabar, avise o gerente ou a cozinha.</p>
      </div>`;
    }
    const term = search.trim().toLowerCase();
    const groups = categories()
      .map((c) => ({ ...c, items: c.items.filter((i) => !i.archived && (!term || i.name.toLowerCase().includes(term))) }))
      .filter((c) => c.items.length);
    const out = categories().flatMap((c) => c.items).filter((i) => !i.archived && !i.available);
    return html`<p class="cs-dica cd-dica">Marque o que acabou hoje. O site mostra na hora, sem precisar publicar.</p>
      <div class="cd-busca field">
        <label class="field__label" for="cd-busca">Procurar prato</label>
        <input class="field__input" id="cd-busca" type="search" .value=${search} @input=${(e) => ((search = e.target.value), draw())} />
      </div>
      <p class="cd-resumo" role="status">${out.length ? `Acabou hoje: ${out.map((i) => i.name).join(", ")}.` : "Tudo tem hoje."}</p>
      ${groups.length
        ? groups.map(
            (c) => html`<section class="cd-grupo" aria-labelledby=${`grupo-${c.id}`}>
              <h2 class="cd-grupo__titulo" id=${`grupo-${c.id}`}>${c.name}</h2>
              <ul class="cd-lista">
                ${c.items.map(
                  (i) => html`<li class="cd-lista__item ${i.available ? "" : "is-acabou"}">
                    <span class="cd-lista__nome" id=${`prato-${i.id}`}>${i.name}</span>
                    ${soldOutSwitch(i)}
                  </li>`,
                )}
              </ul>
            </section>`,
          )
        : html`<p class="cs-dica">Nenhum prato com “${search}”.</p>`}`;
  }

  // ---- dono e gerente --------------------------------------------------------------------

  const CHANGE = { new: "novo", changed: "mudou", price: "preço", removed: "sai do site" };
  const changeLine = (c) =>
    html`<li><b>${c.label}</b> · ${CHANGE[c.kind]}${c.kind === "price" ? html` de ${c.from == null ? "sem preço" : money(c.from)} para ${c.to == null ? "sem preço" : money(c.to)}` : nothing}${c.what === "category" ? " (categoria)" : ""}</li>`;

  function topBar() {
    const { menu } = state;
    const changes = menu.changes || [];
    return html`<section class="cd-topo" aria-labelledby="cd-topo-titulo">
      <div class="cd-topo__texto">
        <h2 class="cd-h3" id="cd-topo-titulo">No site</h2>
        <p>${menu.published_at ? html`Publicado ${when(menu.published_at)}${menu.published_by ? ` por ${firstName(menu.published_by)}` : ""}.` : "O cardápio ainda não foi publicado."}</p>
        ${changes.length
          ? html`<details class="cd-mudancas">
              <summary><span class="badge badge--pending">rascunho</span> ${changes.length} ${changes.length === 1 ? "mudança espera" : "mudanças esperam"} a publicação</summary>
              <ul>${changes.map(changeLine)}</ul>
            </details>`
          : html`<p><span class="badge badge--confirmed">em dia</span> O rascunho está igual ao site.</p>`}
      </div>
      <div class="cs-acoes">
        <button class="btn btn--outline" type="button" @click=${openPreview}>Ver prévia</button>
        <button class="btn" type="button" ?disabled=${!changes.length || pub.running} @click=${publish}>Publicar</button>
      </div>
      <div class="cd-topo__pub">${pub.view(publish)}</div>
      ${lintProblems.length
        ? html`<div class="notice notice--alert cd-palavras" role="alert">
            <p><b>Falta ajeitar antes de publicar.</b> Estes textos têm palavras que não vão ao site:</p>
            <ul>
              ${lintProblems.map(
                (p) => html`<li>
                  ${p.message}
                  ${p.item ? html`<button class="link-button" type="button" @click=${() => editItem(p.item)}>Editar ${p.item.name}</button>` : nothing}
                </li>`,
              )}
            </ul>
          </div>`
        : nothing}
    </section>`;
  }

  /** Abre a janela de um prato de qualquer lugar (a checagem de palavras da publicação, por exemplo). */
  function editItem(item) {
    const c = categories().find((x) => x.id === item.category_id) || current();
    itemWindow({ item, category: c, categories: categories(), onSaved: () => load({ quiet: true }) });
  }

  /** As palavras da casa sobre o rascunho, antes de a API conferir de novo. */
  function lintDraft() {
    const fields = [];
    for (const c of categories()) {
      fields.push({ field: `c:${c.id}`, label: `Categoria ${c.name}`, text: `${c.name} ${c.subtitle || ""} ${c.footer || ""} ${c.i18n?.es?.subtitle || ""} ${c.i18n?.en?.subtitle || ""}` });
      for (const i of c.items.filter((x) => !x.archived)) {
        fields.push({ field: `i:${i.id}`, label: i.name, text: `${i.name} ${i.description || ""} ${i.i18n?.es?.description || ""} ${i.i18n?.en?.description || ""}` });
      }
    }
    const items = new Map(categories().flatMap((c) => c.items).map((i) => [`i:${i.id}`, i]));
    return lintFields(fields).map((p) => ({ message: `${p.label}: ${p.message}`, item: items.get(p.field) || null }));
  }

  function categoryNav() {
    const list = categories();
    return html`<nav class="cd-categorias" aria-label="Categorias do cardápio">
      <ol>
        ${list.map(
          (c, i) => html`<li
            class="cd-categoria ${c.id === current()?.id ? "is-aberta" : ""}"
            draggable="true"
            data-drag-id=${c.id}
            @dragstart=${(e) => dragStart(e, "category", [c.id])}
            @dragover=${(e) => dragOver(e, "category")}
            @drop=${(e) => drop(e, "category", c.id)}
            @dragend=${dragEnd}
          >
            <button class="cd-categoria__nome" type="button" aria-current=${c.id === current()?.id ? "true" : nothing} @click=${() => ((selected = c.id), draw())}>
              ${c.name} <small>${c.items.filter((x) => !x.archived).length}</small>
            </button>
            <span class="cd-ordem">
              <button class="cd-ordem__btn" type="button" aria-label=${`Subir ${c.name}`} ?disabled=${i === 0} @click=${() => moveCategory(c, i - 1)}>↑</button>
              <button class="cd-ordem__btn" type="button" aria-label=${`Descer ${c.name}`} ?disabled=${i === list.length - 1} @click=${() => moveCategory(c, i + 1)}>↓</button>
            </span>
          </li>`,
        )}
      </ol>
      <button class="btn btn--outline btn--sm cd-categorias__nova" type="button" @click=${() => categoryWindow({ category: null, onSaved: (c) => ((selected = c.id), load({ quiet: true })) })}>
        Nova categoria
      </button>
    </nav>`;
  }

  function itemsTable(c) {
    const items = c.items.filter((i) => !i.archived);
    const archived = c.items.filter((i) => i.archived);
    const style = STYLES.find((s) => s.value === c.sheet_style);
    return html`<section class="cd-categoria-aberta" aria-labelledby="cd-cat-titulo">
      <div class="cd-cat-topo">
        <div>
          <h2 class="cd-h2" id="cd-cat-titulo">${c.name}</h2>
          ${c.subtitle ? html`<p class="cs-dica">${c.subtitle}</p>` : nothing}
          <p class="cs-dica">${style ? `${style.label}, ${style.help}` : ""}${c.footer ? ` · pé da folha: “${c.footer}”` : ""}</p>
        </div>
        <div class="cs-acoes">
          <button class="btn btn--sm" type="button" @click=${() => itemWindow({ item: null, category: c, categories: categories(), onSaved: () => load({ quiet: true }) })}>Novo prato</button>
          <button class="btn btn--outline btn--sm" type="button" @click=${() => categoryWindow({ category: c, count: items.length, onSaved: () => load({ quiet: true }) })}>Editar categoria</button>
          ${c.items.length ? nothing : html`<button class="link-button" type="button" @click=${() => removeCategory(c)}>Tirar a categoria</button>`}
        </div>
      </div>
      ${items.length
        ? html`<div class="table-wrap">
            <table class="data-table cd-tabela">
              <thead>
                <tr><th scope="col"><span class="sr-only">Arrastar juntos</span></th><th scope="col">Prato</th><th scope="col">Preço</th><th scope="col">Selos</th><th scope="col">Hoje</th><th scope="col">Ordem</th><th scope="col"><span class="sr-only">Ações</span></th></tr>
              </thead>
              <tbody>
                ${items.map(
                  (i, index) => html`<tr
                    class="${i.available ? "" : "is-acabou"} ${picked.has(i.id) ? "is-escolhido" : ""}"
                    draggable="true"
                    data-drag-id=${i.id}
                    @dragstart=${(e) => dragStart(e, "item", picked.has(i.id) ? items.filter((x) => picked.has(x.id)).map((x) => x.id) : [i.id])}
                    @dragover=${(e) => dragOver(e, "item")}
                    @drop=${(e) => drop(e, "item", i.id, c)}
                    @dragend=${dragEnd}
                  >
                    <td data-label="Arrastar" class="cd-tabela__pegar">
                      <span class="cd-pegador" aria-hidden="true">⠿</span>
                      <input type="checkbox" class="cd-escolher" aria-label=${`Escolher ${i.name} para arrastar junto`} .checked=${picked.has(i.id)} @change=${(e) => pick(i.id, e.target.checked)} />
                    </td>
                    <td data-label="Prato" class="cd-tabela__prato">
                      <b id=${`prato-${i.id}`}>${i.name}</b>
                      ${i.group ? html`<small class="cd-tabela__grupo">${i.group}</small>` : nothing}
                      ${i.featured ? html`<span class="badge badge--said-yes">prato do dia</span>` : nothing}
                      ${i.description ? html`<small class="cd-tabela__desc">${i.description}</small>` : nothing}
                      ${i.image_id ? html`<small class="cd-tabela__foto">com foto</small>` : nothing}
                    </td>
                    <td data-label="Preço" class="num">${i.price_cents == null ? html`<span class="cd-sem-preco">${state.menu.settings?.unpriced_item === "ask" ? "sem preço · “consulte” no site" : "sem preço · no site, sem preço"}</span>` : money(i.price_cents)}</td>
                    <td data-label="Selos">${i.badges?.length ? i.badges.map((b) => html`<span class="badge cd-selo">${BADGE[b]}</span>`) : "—"}</td>
                    <td data-label="Hoje">${soldOutSwitch(i)}</td>
                    <td data-label="Ordem">
                      <span class="cd-ordem">
                        <button class="cd-ordem__btn" type="button" aria-label=${`Subir ${i.name}`} ?disabled=${index === 0} @click=${() => moveItem(i, index - 1)}>↑</button>
                        <button class="cd-ordem__btn" type="button" aria-label=${`Descer ${i.name}`} ?disabled=${index === items.length - 1} @click=${() => moveItem(i, index + 1)}>↓</button>
                      </span>
                    </td>
                    <td data-label="Ações" class="cd-tabela__acoes">
                      <button class="action" type="button" aria-label=${`Editar ${i.name}`} @click=${() => editItem(i)}>Editar</button>
                      <button class="action" type="button" aria-label=${`Arquivar ${i.name}`} @click=${() => archive(i, true)}>Arquivar</button>
                    </td>
                  </tr>`,
                )}
              </tbody>
            </table>
          </div>
          <p class="cs-dica cd-dica-ordem" role="status">
            ${picked.size
              ? html`${picked.size} ${picked.size === 1 ? "prato escolhido" : "pratos escolhidos"}: arraste um deles e os outros vão junto.
                  <button class="link-button" type="button" @click=${() => ((picked = new Set()), draw())}>Desfazer a escolha</button>`
              : "Arraste a linha pelo ⠿ para mudar a ordem, ou use as setas. Para mover vários, marque as caixinhas e arraste um deles."}
          </p>`
        : html`<div class="cd-vazia">
            <p><b>${c.name} está vazia e não vai aparecer no site.</b> Ponha o primeiro prato.</p>
          </div>`}
      ${archived.length
        ? html`<details class="cd-arquivados">
            <summary>Arquivados (${archived.length}): saem do site e podem voltar</summary>
            <ul>
              ${archived.map(
                (i) => html`<li>
                  <span>${i.name}</span>
                  <button class="action" type="button" aria-label=${`Trazer ${i.name} de volta`} @click=${() => archive(i, false)}>Trazer de volta</button>
                </li>`,
              )}
            </ul>
          </details>`
        : nothing}
    </section>`;
  }

  function editorView() {
    const c = current();
    return html`${topBar()}
      <div class="cd-corpo">
        ${categoryNav()}
        ${c ? itemsTable(c) : nothing}
      </div>`;
  }

  // ---- ações ----------------------------------------------------------------------------

  /** Faz, recarrega o rascunho e diz se deu certo; um conflito oferece "Atualizar". */
  async function run(action, failTitle) {
    let ok = true;
    try {
      await action();
    } catch (error) {
      ok = false;
      if (error?.status === 409) {
        toast({ kind: "error", title: failTitle, message: sayError(error), action: { label: "Atualizar", onClick: () => load() } });
        return ok;
      }
      toast({ kind: "error", title: failTitle, message: sayError(error) });
    }
    await load({ quiet: true });
    return ok;
  }

  // ---- arrastar: uma linha, ou várias escolhidas juntas -------------------------------------

  function pick(id, on) {
    if (on) picked.add(id);
    else picked.delete(id);
    draw();
  }

  function dragStart(event, kind, ids) {
    dragging = { kind, ids };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", ids.join(","));
    event.currentTarget.classList.add("is-arrastando");
  }

  function dragOver(event, kind) {
    if (dragging?.kind !== kind) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function dragEnd(event) {
    event.currentTarget.classList.remove("is-arrastando");
    dragging = null;
  }

  /** Os arrastados vão logo antes da linha onde foram soltos (depois dela quando arrastados para baixo). */
  async function drop(event, kind, targetId, category) {
    if (dragging?.kind !== kind) return;
    event.preventDefault();
    const moving = dragging.ids;
    dragging = null;
    if (moving.includes(targetId)) return;
    const list = kind === "category" ? categories().map((c) => c.id) : category.items.filter((i) => !i.archived).map((i) => i.id);
    const archived = kind === "item" ? category.items.filter((i) => i.archived).map((i) => i.id) : [];
    const down = list.indexOf(moving[0]) < list.indexOf(targetId);
    const rest = list.filter((id) => !moving.includes(id));
    const at = rest.indexOf(targetId) + (down ? 1 : 0);
    rest.splice(at, 0, ...moving);
    const body = kind === "category" ? { categories: rest } : { category_id: category.id, items: [...rest, ...archived] };
    if (await run(() => api.order(body), "Não deu para mudar a ordem")) {
      picked = new Set();
      toast({ title: "Ordem mudada no rascunho", message: "O site muda quando você publicar." });
    }
  }

  const moveCategory = (c, to) => run(() => api.updateCategory(c.id, { sort: to }), "Não deu para mudar a ordem");
  const moveItem = (i, to) => run(() => api.updateItem(i.id, { sort: to }), "Não deu para mudar a ordem");

  async function archive(item, archived) {
    if (!(await run(() => api.updateItem(item.id, { archived }), archived ? "Não deu para arquivar" : "Não deu para trazer de volta"))) return;
    toast({
      title: archived ? `${item.name} arquivado` : `${item.name} voltou para o rascunho`,
      message: "O site muda quando você publicar.",
      action: { label: "Desfazer", onClick: () => archive(item, !archived) },
    });
  }

  async function removeCategory(c) {
    const ok = await confirmAction({ title: `Tirar ${c.name}?`, message: "A categoria está vazia. Ela sai do rascunho agora e do site na próxima publicação.", confirmLabel: "Tirar categoria", cancelLabel: "Manter", danger: true });
    if (!ok) return;
    if (await run(() => api.removeCategory(c.id), "Não deu para tirar a categoria")) toast({ title: `${c.name} saiu do rascunho` });
  }

  function openPreview() {
    const view = { lang: "pt", unpriced: state.menu.settings?.unpriced_item || "hide" };
    const win = openWindow({ title: "Prévia do cardápio", body: () => previewBody(categories(), view, () => win.redraw()) });
  }

  async function publish() {
    lintProblems = lintDraft();
    if (lintProblems.length) {
      draw();
      return toast({ kind: "error", title: "Falta ajeitar antes de publicar", message: lintProblems[0].message });
    }
    const shown = categories().filter((c) => !emptyCategories(categories()).includes(c));
    if (!shown.length) {
      const ok = await confirmAction({ title: "Publicar o cardápio vazio?", message: "O site e o QR das mesas ficam sem nenhum prato.", confirmLabel: "Publicar cardápio vazio", cancelLabel: "Voltar", danger: true });
      if (!ok) return;
    }
    try {
      state.menu = await api.publish();
      lintProblems = [];
      pub.started();
      toast({ title: "Cardápio publicado", message: "O site e o QR das mesas mudam em até 2 minutos." });
    } catch (error) {
      if (error?.status === 422) {
        const items = new Map(categories().flatMap((c) => c.items).map((i) => [i.id, i]));
        lintProblems = (error.errors || []).map((e) => ({ message: e.message, item: items.get(String(e.field).split(".")[1]) || null }));
        toast({ kind: "error", title: "Falta ajeitar antes de publicar", message: lintProblems[0]?.message || sayError(error) });
      } else {
        toast({ kind: "error", title: "Não deu para publicar", message: `${sayError(error)} O rascunho continua guardado.` });
      }
    }
    draw();
  }

  // ---- desenho ------------------------------------------------------------------------------

  function draw() {
    let body;
    if (state.status === "loading") body = loadingBox();
    else if (state.status === "error") body = errorBox(state.error, () => load(), "O cardápio não abriu.");
    else if (!categories().length)
      body = floor
        ? emptyBox({ title: "Nenhum prato no cardápio", text: "Quando o gerente montar o cardápio, os pratos aparecem aqui para marcar o que acabou.", action: html`<a class="btn btn--outline" href="/admin/">Voltar ao Hoje</a>` })
        : emptyBox({
            title: "O cardápio está vazio",
            text: "Comece por uma categoria, como “Pra compartilhar” ou “Ramen”. Os pratos entram dentro dela.",
            action: html`<button class="btn" type="button" @click=${() => categoryWindow({ category: null, onSaved: (c) => ((selected = c.id), load({ quiet: true })) })}>Criar a primeira categoria</button>`,
          });
    else body = floor ? floorView() : editorView();
    render(body, container);
  }

  load();
  return () => pub?.stop();
}
