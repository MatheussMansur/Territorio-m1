// Site (histórias 4.14 e 4.15): os blocos de texto do site em três idiomas, com a prévia
// como o cliente vê, rascunho, publicação, histórico e "Voltar a esta versão"; e a
// aba "Números" com as visitas do site.
//   /admin/site           os blocos
//   /admin/site/numeros   os números
//   /admin/site/<bloco>   um bloco (capa, casa, avisos, frases, links, busca)
// Salvar manda a versão lida; quando alguém salvou no meio (412) a tela oferece juntar
// as duas ou largar a sua. Uma sessão que acaba no meio é aberta de novo sobre a tela pelo
// painel (src/admin/identity.js) e o salvamento vai de novo com a mesma versão, então nada
// do que foi digitado se perde. Publicar roda antes a checagem de palavras da casa (NFR-34) e diz qual campo.
import "./site.css";
import { confirmAction } from "../../components/confirm.js";
import { toast } from "../../components/toast.js";
import { html, nothing, render } from "../../lib/html.js";
import * as house from "../../services/api/house.js";
import * as api from "../../services/api/staff-site.js";
import { lintFields, localizedFields } from "../../site/lint.js";
import { blankFields, BLOCKS, blockBySlug, editor, houseToday, missingLangs, preview, summary, WEEKDAYS } from "./site/blocos.js";
import { conflictWindow, emptyBox, errorBox, fieldErrors, firstName, guardLeaving, joinChanges, LANGS, loadingBox, openWindow, sayError, subnav, when } from "./site/comum.js";
import { numbersView } from "./site/numeros.js";
import { publication } from "./site/publicacao.js";

const TABS = [
  { key: "blocos", path: "/admin/site", label: "Blocos" },
  { key: "numeros", path: "/admin/site/numeros", label: "Números" },
];

const langNames = (codes) => {
  const names = codes.map((c) => LANGS.find((l) => l.code === c).name);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} e ${names.at(-1)}` : names[0];
};

export async function mount(container, { sub, navigate }) {
  if (sub === "numeros") return mountNumbers(container);
  if (sub) {
    const def = blockBySlug(sub);
    if (def) return mountEditor(container, def, navigate);
    render(
      emptyBox({ title: "Esse bloco não existe", text: "Os blocos do site são capa, a casa, avisos, frases do dia, links e busca.", action: html`<a class="btn" href="/admin/site">Ver os blocos</a>` }),
      container,
    );
    return;
  }
  return mountIndex(container);
}

// ---- os blocos -----------------------------------------------------------------------------

function mountIndex(container) {
  let state = { status: "loading" };
  let houseInfo = null;
  const pub = publication({ onChange: () => draw() });

  const draw = () => {
    let body;
    if (state.status === "loading") body = loadingBox();
    else if (state.status === "error") body = errorBox(state.error, load, "Os blocos do site não abriram.");
    else if (!state.blocks.length)
      body = emptyBox({
        title: "O site ainda não tem textos",
        text: "Comece pela capa: é a primeira coisa que o cliente lê. Depois vêm a casa, os avisos e as frases do dia.",
        action: html`<a class="btn" href="/admin/site/capa">Escrever a capa</a>`,
      });
    else body = blocksList(state.blocks);
    render(
      html`${subnav(TABS, "blocos", "Partes do site")}
        <div class="st-topo">
          <p class="cs-dica">Aqui se muda só texto, nas três línguas. As fotos ficam na <a href="/admin/galeria">Galeria</a> e o cardápio no <a href="/admin/cardapio">Cardápio</a>.</p>
          ${state.status === "ready" ? pub.view() : nothing}
        </div>
        ${body}
        ${state.status === "ready" && houseInfo ? houseBox(houseInfo) : nothing}`,
      container,
    );
  };

  async function load() {
    state = { status: "loading" };
    draw();
    try {
      const [blocks] = await Promise.all([api.blocks(), pub.load()]);
      state = { status: "ready", blocks };
    } catch (error) {
      state = { status: "error", error };
    }
    draw();
    house
      .getHouse()
      .then((h) => ((houseInfo = h), draw()))
      .catch(() => {});
  }

  load();
  return () => pub.stop();
}

function blocksList(blocks) {
  const byKey = Object.fromEntries(blocks.map((b) => [b.block, b]));
  return html`<ul class="st-blocos">
    ${BLOCKS.map((def) => {
      const b = byKey[def.key];
      const gaps = b ? missingLangs(def, b.fields) : [];
      return html`<li class="st-bloco">
        <div class="st-bloco__texto">
          <h2 class="st-bloco__nome">${def.label}</h2>
          <p>${def.text}</p>
          <p class="st-bloco__estado">
            ${!b
              ? html`<span class="badge badge--expired">sem texto</span>`
              : b.status === "draft"
                ? html`<span class="badge badge--pending">rascunho</span> guardado ${when(b.draft_saved_at)}${b.draft_saved_by ? ` por ${firstName(b.draft_saved_by)}` : ""}, ainda fora do site`
                : html`<span class="badge badge--confirmed">no ar</span> versão ${b.version}, ${when(b.published_at)}${b.published_by ? ` por ${firstName(b.published_by)}` : ""}`}
          </p>
          ${gaps.length ? html`<p class="cs-pendente"><span class="losango" aria-hidden="true"></span>${gaps.includes("pt") ? "Falta texto em português" : `Sem tradução em ${langNames(gaps)}`}</p>` : nothing}
        </div>
        <a class="btn btn--outline btn--sm st-bloco__editar" href=${`/admin/site/${def.slug}`} aria-label=${`Editar ${def.label}`}>Editar</a>
      </li>`;
    })}
  </ul>`;
}

function houseBox(h) {
  const a = h.address || {};
  return html`<section class="cs-somente-leitura st-casa" aria-labelledby="st-casa-titulo">
    <h2 class="st-h3" id="st-casa-titulo">Vem de Configurações</h2>
    <p>${a.street}, ${a.number} · ${a.district} · ${a.city}</p>
    <p>Endereço, horários e WhatsApp aparecem no site como estão em <a href="/admin/configuracoes">Configurações</a>. Aqui eles não se digitam.</p>
  </section>`;
}

// ---- os números ----------------------------------------------------------------------------

function mountNumbers(container) {
  let state = { status: "loading" };
  const draw = () => {
    let body;
    if (state.status === "loading") body = loadingBox();
    else if (state.status === "error") body = errorBox(state.error, load, "Os números não abriram.");
    else if (!state.stats.visits)
      body = emptyBox({
        title: "Ainda sem visitas contadas",
        text: "Os números aparecem aqui depois que o site novo entrar no ar e as primeiras pessoas visitarem.",
        action: html`<a class="btn btn--outline" href="/admin/site">Cuidar dos textos do site</a>`,
      });
    else body = numbersView(state.stats);
    render(html`${subnav(TABS, "numeros", "Partes do site")}${body}`, container);
  };
  async function load() {
    state = { status: "loading" };
    draw();
    try {
      state = { status: "ready", stats: await api.stats() };
    } catch (error) {
      state = { status: "error", error };
    }
    draw();
  }
  load();
}

// ---- um bloco ------------------------------------------------------------------------------

function mountEditor(container, def, navigate) {
  const today = houseToday();
  let status = "loading";
  let loadError = null;
  let block = null; // a visão do servidor
  let saved = ""; // os campos como foram salvos por último, para saber o que mudou
  let busy = ""; // "save" | "publish" | "discard"
  let houseInfo = null;
  const ed = { def, fields: null, lang: "pt", errors: {} };
  const pub = publication({ onChange: () => draw(), filter: (b) => b.reason === `content:${def.key}` });

  const dirty = () => status === "ready" && JSON.stringify(ed.fields) !== saved;
  const confirmLeave = () =>
    confirmAction({
      title: "Descartar as mudanças?",
      message: "O que você mudou neste bloco e não salvou vai se perder.",
      confirmLabel: "Descartar mudanças",
      cancelLabel: "Continuar editando",
      danger: true,
    });
  const unguard = guardLeaving(dirty, navigate, confirmLeave);

  const take = (view) => {
    block = view;
    ed.fields = structuredClone(view?.fields ?? blankFields(def));
    saved = JSON.stringify(ed.fields);
  };

  function statusLine() {
    if (!block) return html`<p class="st-estado"><span class="badge badge--expired">sem texto</span> Esse bloco ainda não foi escrito.</p>`;
    return html`<p class="st-estado">
      <span class="badge badge--confirmed">no ar</span> Versão ${block.version}, publicada ${when(block.published_at)}${block.published_by ? ` por ${firstName(block.published_by)}` : ""}.
      ${block.status === "draft" ? html`<br /><span class="badge badge--pending">rascunho</span> Guardado ${when(block.draft_saved_at)}${block.draft_saved_by ? ` por ${firstName(block.draft_saved_by)}` : ""}; só vai ao site ao publicar.` : nothing}
      ${dirty() ? html`<br /><span class="badge badge--no-reply">não salvo</span> Há mudanças nesta tela que ainda não foram guardadas.` : nothing}
    </p>`;
  }

  const draw = () => {
    if (status === "loading") return render(loadingBox(), container);
    if (status === "error") return render(errorBox(loadError, load, `O bloco ${def.label} não abriu.`), container);
    const lang = LANGS.find((l) => l.code === ed.lang);
    const canPublish = dirty() || block?.status === "draft";
    render(
      html`<a class="cs-voltar" href="/admin/site">← Blocos do site</a>
        <div class="st-editor">
          <section class="st-editor__form" aria-labelledby="ed-titulo">
            <h2 class="st-h2" id="ed-titulo">${def.label}</h2>
            <p class="cs-dica">${def.text}</p>
            ${statusLine()}
            <form class="st-form" novalidate @submit=${(e) => (e.preventDefault(), save())}>
              ${editor(ed, () => draw(), today)}
              <div class="cs-acoes st-form__acoes">
                <button class="btn btn--outline" type="submit" ?disabled=${!dirty() || Boolean(busy)} aria-busy=${busy === "save" ? "true" : "false"}>
                  ${busy === "save" ? "Salvando…" : "Salvar rascunho"}
                </button>
                <button class="btn" type="button" ?disabled=${!canPublish || Boolean(busy) || pub.running} aria-busy=${busy === "publish" ? "true" : "false"} @click=${publish}>
                  ${busy === "publish" ? "Publicando…" : "Publicar"}
                </button>
                <button class="link-button" type="button" @click=${history}>Histórico</button>
                ${block?.status === "draft" ? html`<button class="link-button" type="button" ?disabled=${Boolean(busy)} @click=${discardDraft}>Descartar rascunho</button>` : nothing}
              </div>
            </form>
            ${pub.view(publish)}
          </section>
          <aside class="st-editor__previa" aria-labelledby="previa-titulo">
            <h2 class="st-h3" id="previa-titulo">Prévia${def.plain ? "" : ` · ${lang.label.toLowerCase()}`}</h2>
            <p class="cs-dica">Como o cliente vê, com o que está nesta tela agora.</p>
            ${preview(def, ed.fields, ed.lang, { today, house: houseInfo })}
          </aside>
        </div>`,
      container,
    );
  };

  async function load() {
    status = "loading";
    draw();
    try {
      const [blocks] = await Promise.all([api.blocks(), pub.load()]);
      take(blocks.find((b) => b.block === def.key) || null);
      status = "ready";
    } catch (error) {
      loadError = error;
      status = "error";
    }
    draw();
    if (def.key === "links") house.getHouse().then((h) => ((houseInfo = h), draw())).catch(() => {});
  }

  /** Mostra o 422 nos campos: a aba do primeiro erro abre e o campo dele recebe o foco. */
  function showErrors(errors) {
    ed.errors = errors;
    const first = Object.keys(errors)[0];
    const code = first?.split(".").at(-1);
    if (LANGS.some((l) => l.code === code)) ed.lang = code;
    draw();
    requestAnimationFrame(() => container.querySelector('.field--invalid :is(input, textarea), [aria-invalid="true"]')?.focus());
  }

  async function save({ quiet = false } = {}) {
    if (!dirty()) return true;
    busy = "save";
    draw();
    try {
      const view = await api.saveBlock(def.key, ed.fields, block?.etag);
      take(view);
      ed.errors = {};
      busy = "";
      draw();
      if (!quiet) toast({ title: "Rascunho guardado", message: "O site só muda quando você publicar." });
      return true;
    } catch (error) {
      busy = "";
      if (error?.status === 422) showErrors(fieldErrors(error));
      else if (error?.status === 412 && error.body?.current) return resolveConflict(error.body.current, { quiet });
      else {
        draw();
        toast({ kind: "error", title: "Não deu para salvar", message: `${sayError(error)} O que você escreveu continua na tela.` });
      }
      return false;
    }
  }

  /** Alguém salvou este bloco enquanto ele estava aberto: juntar os dois, ou ficar só com o dele. */
  async function resolveConflict(current, { quiet }) {
    draw();
    const base = JSON.parse(saved);
    const join = joinChanges(base, ed.fields, current.fields);
    const answer = await conflictWindow({
      who: current.draft_saved_by || current.published_by,
      at: current.draft_saved_at || current.published_at,
      theirs: join.theirs,
      both: join.both,
      label: fieldLabel,
    });
    if (answer === "discard") {
      take(current);
      draw();
      toast({ title: "Ficou o que a outra pessoa gravou", message: "As suas mudanças foram descartadas." });
      return false;
    }
    if (answer !== "join") return false;
    // a versão da outra pessoa vira a lida, com as minhas mudanças por cima
    block = current;
    saved = JSON.stringify(current.fields);
    ed.fields = join.merged;
    draw();
    return save({ quiet });
  }

  /** "Capa · Frase de cima (espanhol)" para um caminho de campo como "kicker.es". */
  function fieldLabel(path) {
    const [first, second, third] = path.split(".");
    const lang = LANGS.find((l) => l.code === path.split(".").at(-1));
    const suffix = lang ? ` (${lang.name})` : "";
    if (def.key === "notices") return `Aviso ${Number(second) + 1 || ""}`.trim() + suffix;
    if (def.key === "today") return (first === "rules" ? WEEKDAYS[Number(second)] || "Frase do dia" : "Frase de sempre") + suffix;
    const field = def.fields?.find((f) => f.name === first);
    return `${field?.label || first}${third ? "" : suffix}`;
  }

  /** As palavras da casa, conferidas antes de publicar (a API confere de novo). */
  function lintDraft() {
    const fields = ed.fields || {};
    const list = [];
    if (def.key === "notices") (fields.items || []).forEach((n, i) => list.push(...localizedFields(`items.${i}.text`, `Aviso ${i + 1}`, n.text)));
    else if (def.key === "today") {
      list.push(...localizedFields("default", "Frase de sempre", fields.default));
      for (const [d, text] of Object.entries(fields.rules || {})) list.push(...localizedFields(`rules.${d}`, WEEKDAYS[d], text));
    } else if (def.plain) list.push({ field: "whatsapp_text", label: "Mensagem pronta", text: fields.whatsapp_text });
    else for (const f of def.fields) list.push(...localizedFields(f.name, f.label, fields[f.name]));
    return lintFields(list);
  }

  async function publish() {
    const problems = lintDraft();
    if (problems.length) {
      showErrors(Object.fromEntries(problems.map((p) => [p.field, p.message])));
      toast({ kind: "error", title: "Falta ajeitar antes de publicar", message: `${problems[0].label}: ${problems[0].message}` });
      return;
    }
    if (dirty() && !(await save({ quiet: true }))) return;
    busy = "publish";
    draw();
    try {
      const view = await api.publishBlock(def.key);
      take(view);
      busy = "";
      pub.started();
      toast({ title: `Publicado: ${def.label}`, message: "O site muda em até 2 minutos." });
    } catch (error) {
      busy = "";
      if (error?.status === 422) {
        showErrors(fieldErrors(error));
        toast({ kind: "error", title: "Falta ajeitar antes de publicar", message: "O campo marcado tem uma palavra que não vai ao site." });
        return;
      }
      draw();
      toast({ kind: "error", title: "Não deu para publicar", message: `${sayError(error)} O rascunho continua guardado.` });
    }
  }

  async function discardDraft() {
    const ok = await confirmAction({
      title: "Descartar o rascunho?",
      message: "O bloco volta a ficar igual ao que está no site agora.",
      confirmLabel: "Descartar rascunho",
      cancelLabel: "Manter rascunho",
      danger: true,
    });
    if (!ok) return;
    busy = "discard";
    draw();
    try {
      take(await api.saveBlock(def.key, block.published_fields, block.etag));
      toast({ title: "Rascunho descartado", message: "O bloco está igual ao site." });
    } catch (error) {
      toast({ kind: "error", title: "Não deu para descartar", message: sayError(error) });
    }
    busy = "";
    draw();
  }

  function history() {
    let list = null;
    let failed = null;
    const win = openWindow({
      title: `Histórico · ${def.label}`,
      size: "drawer",
      body: () => {
        if (failed) return errorBox(failed, () => ((failed = null), win.redraw(), fetchVersions()), "O histórico não abriu.");
        if (!list) return loadingBox();
        if (!list.length) return html`<p class="cs-dica">Nada publicado ainda neste bloco.</p>`;
        return html`<p class="cs-dica">Escolha uma versão para trazer de volta. Ela volta como rascunho, com prévia, e só vai ao site quando você publicar.</p>
          <ol class="st-versoes">
            ${list.map(
              (v) => html`<li class="st-versao">
                <p class="st-versao__nome"><b>Versão ${v.version}</b> ${v.version === block?.version ? html`<span class="badge badge--confirmed">no ar</span>` : nothing}</p>
                <p class="st-versao__quando">Publicada ${when(v.published_at)}${v.published_by ? ` por ${firstName(v.published_by)}` : ""}</p>
                <p class="st-versao__resumo">“${summary(def, v.fields)}”</p>
                ${v.version === block?.version
                  ? nothing
                  : html`<button class="btn btn--outline btn--sm" type="button" @click=${() => restore(v, win)}>Voltar à versão ${v.version}</button>`}
              </li>`,
            )}
          </ol>`;
      },
    });
    const fetchVersions = async () => {
      try {
        list = await api.versions(def.key);
      } catch (error) {
        failed = error;
      }
      win.redraw();
    };
    fetchVersions();
  }

  async function restore(version, win) {
    if (dirty() && !(await confirmLeave())) return;
    try {
      take(await api.restore(def.key, version.version));
      win.close();
      draw();
      toast({ title: `A versão ${version.version} voltou como rascunho`, message: "Confira a prévia. Ela só vai ao site quando você publicar." });
    } catch (error) {
      toast({ kind: "error", title: "Não deu para voltar a essa versão", message: sayError(error) });
    }
  }

  load();
  return () => {
    unguard();
    pub.stop();
  };
}

