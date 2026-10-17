// Galeria (histórias 3.7 e 3.8): as fotos da casa com texto alternativo obrigatório, crédito, área e
// ponto de foco; onde cada uma aparece; enviar em lotes, substituir mantendo todos os lugares, mudar
// a ordem, e apagar só o que não está em uso.
import "./galeria.css";
import { confirmAction } from "../../components/confirm.js";
import { toast } from "../../components/toast.js";
import { html, nothing, render } from "../../lib/html.js";
import * as api from "../../services/api/staff-galeria.js";
import { ACCEPT, AREAS, checkFile, uploadWindow } from "./galeria/envio.js";
import { emptyBox, errorBox, fieldErrors, firstName, loadingBox, losango, openWindow, sayError, textField, when } from "./site/comum.js";

const PLACES = {
  "site:capa": "Capa do site",
  "site:capa-celular": "Capa no celular",
  "site:casa": "A casa",
  "site:destaques": "Destaques",
  "site:ambiente": "Ambiente",
};

/** "menu:Ramen" → "Cardápio · Ramen". */
export function placeLabel(code) {
  if (PLACES[code]) return PLACES[code];
  const [kind, ...rest] = code.split(":");
  const name = rest.join(":");
  if (kind === "menu") return `Cardápio · ${name}`;
  if (kind === "event") return `Evento · ${name}`;
  return name || code;
}

const FILTERS = [
  { key: "todas", label: "Todas" },
  { key: "sem-texto", label: "Sem descrição" },
  { key: "sem-uso", label: "Sem uso" },
];

const thumb = (img, width = 480) => img.variants?.find((v) => v.format === "jpg" && v.width >= width)?.url || img.variants?.find((v) => v.format === "jpg")?.url || img.variants?.[0]?.url || "";
const focus = (img) => `${Math.round((img.focal_x ?? 0.5) * 100)}% ${Math.round((img.focal_y ?? 0.5) * 100)}%`;
const preparing = (img) => img.status === "processing" || !img.variants?.length;
const kb = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB` : `${Math.round(bytes / 1024)} KB`);

export async function mount(container) {
  let state = { status: "loading" };
  let filter = "todas";
  let dragging = false;
  let poll = null;

  async function load({ quiet = false } = {}) {
    if (!quiet) {
      state = { status: "loading" };
      draw();
    }
    try {
      state = { status: "ready", images: await api.images() };
    } catch (error) {
      if (!quiet) state = { status: "error", error };
      else toast({ kind: "error", title: "Não deu para atualizar a galeria", message: sayError(error) });
    }
    draw();
    // uma foto ainda sendo preparada é olhada de novo até as versões dela existirem (história 3.7)
    clearTimeout(poll);
    if (state.images?.some(preparing)) poll = setTimeout(() => load({ quiet: true }), 5000);
  }

  // ---- escolher arquivos ------------------------------------------------------------------------

  /** Um campo de arquivo escondido, aberto de qualquer botão; `onPick(files)` recebe a escolha. */
  function pickFiles({ multiple = true, onPick }) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ACCEPT;
    input.multiple = multiple;
    input.hidden = true;
    input.className = "gl-arquivo";
    input.addEventListener("change", () => {
      if (input.files?.length) onPick([...input.files]);
      input.remove();
    });
    document.body.append(input);
    input.click();
  }

  const startUpload = (files) => uploadWindow(files, { onDone: () => load({ quiet: true }) });

  const onDrop = (event) => {
    event.preventDefault();
    dragging = false;
    const files = [...(event.dataTransfer?.files || [])];
    draw();
    if (files.length) startUpload(files);
  };
  const onDrag = (event, on) => {
    event.preventDefault();
    if (dragging !== on) {
      dragging = on;
      draw();
    }
  };

  // ---- uma foto ---------------------------------------------------------------------------

  async function replace(img, after) {
    pickFiles({
      multiple: false,
      onPick: async ([file]) => {
        const problem = checkFile(file);
        if (problem) return toast({ kind: "error", title: "Essa foto não serve", message: problem.text });
        try {
          await api.replaceFile(img.id, file);
          toast({ title: "Foto substituída", message: img.usages.length ? `Os ${img.usages.length} lugares onde ela aparece já usam a nova.` : "O texto e o crédito continuam os mesmos." });
          after?.();
          load({ quiet: true });
        } catch (error) {
          toast({ kind: "error", title: `${file.name} não subiu`, message: sayError(error) });
        }
      },
    });
  }

  function inUse(img, usages, onReplace) {
    const win = openWindow({
      title: "Essa foto está em uso",
      size: "small",
      body: () => html`<p>Ela aparece em ${usages.length} ${usages.length === 1 ? "lugar" : "lugares"} do site. Troque nesses lugares ou use “Substituir” para manter os usos.</p>
        <ul class="gl-usos">${usages.map((u) => html`<li>${placeLabel(u)}</li>`)}</ul>
        <div class="dialog__actions">
          <button class="btn btn--outline btn--sm" type="button" data-close>Fechar</button>
          <button class="btn btn--sm" type="button" @click=${() => (win.close(), onReplace())}>Substituir</button>
        </div>`,
    });
  }

  async function remove(img, after) {
    if (img.usages.length) return inUse(img, img.usages, () => replace(img, after));
    const ok = await confirmAction({ title: "Apagar a foto?", message: `“${img.alt || img.original_name}” sai da galeria. Ela não aparece em nenhum lugar do site.`, confirmLabel: "Apagar foto", cancelLabel: "Manter", danger: true });
    if (!ok) return;
    try {
      await api.remove(img.id);
      after?.();
      toast({ title: "Foto apagada" });
      load({ quiet: true });
    } catch (error) {
      if (error?.status === 409) {
        after?.();
        inUse(img, error.body?.usages || img.usages, () => replace(img));
        return load({ quiet: true });
      }
      toast({ kind: "error", title: "Não deu para apagar", message: sayError(error) });
    }
  }

  async function move(img, to) {
    try {
      await api.update(img.id, { sort: to });
    } catch (error) {
      toast({ kind: "error", title: "Não deu para mudar a ordem", message: sayError(error) });
    }
    await load({ quiet: true });
    requestAnimationFrame(() => container.querySelector(`[data-ordem="${img.id}"][data-dir="${to < img.sort ? "up" : "down"}"]`)?.focus());
  }

  function editWindow(img) {
    const form = { alt: img.alt || "", credit: img.credit || "", area: img.area || "", focal_x: img.focal_x ?? 0.5, focal_y: img.focal_y ?? 0.5 };
    const start = JSON.stringify(form);
    let errors = {};
    let busy = false;

    const setFocus = (x, y) => {
      form.focal_x = Math.min(1, Math.max(0, Math.round(x * 100) / 100));
      form.focal_y = Math.min(1, Math.max(0, Math.round(y * 100) / 100));
      win.redraw();
    };
    const onPoint = (event) => {
      const box = event.currentTarget.getBoundingClientRect();
      setFocus((event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height);
    };
    const onKey = (event) => {
      const step = event.shiftKey ? 0.1 : 0.05;
      const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (!(event.key in moves)) return;
      event.preventDefault();
      setFocus(form.focal_x + moves[event.key][0], form.focal_y + moves[event.key][1]);
    };

    async function save(event) {
      event.preventDefault();
      errors = {};
      if (!form.alt.trim()) {
        errors.alt = "Falta descrever a foto. Escreva em poucas palavras o que aparece. Quem usa leitor de tela depende disso.";
        win.redraw();
        return requestAnimationFrame(() => document.getElementById("foto-alt")?.focus());
      }
      busy = true;
      win.redraw();
      try {
        await api.update(img.id, { alt: form.alt.trim(), credit: form.credit.trim(), area: form.area, focal_x: form.focal_x, focal_y: form.focal_y });
        win.close();
        toast({ title: "Foto salva", message: img.usages.length ? "Os lugares do site que usam a foto mudam na próxima publicação." : "" });
        load({ quiet: true });
      } catch (error) {
        busy = false;
        errors = fieldErrors(error);
        if (!Object.keys(errors).length) errors._ = sayError(error);
        win.redraw();
      }
    }

    const win = openWindow({
      title: "Foto",
      size: "drawer",
      isDirty: () => JSON.stringify(form) !== start,
      discard: { title: "Descartar as mudanças?", message: "O que você mudou nesta foto vai se perder.", confirmLabel: "Descartar mudanças", cancelLabel: "Continuar editando" },
      body: () => html`<form class="gl-form" novalidate @submit=${save}>
        ${errors._ ? html`<p class="notice notice--alert" role="alert">${errors._}</p>` : nothing}
        <div class="gl-foco">
          <div
            class="gl-foco__area"
            role="slider"
            tabindex="0"
            aria-label="Ponto de foco"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow=${Math.round(form.focal_x * 100)}
            aria-valuetext=${`${Math.round(form.focal_x * 100)}% da esquerda, ${Math.round(form.focal_y * 100)}% do alto`}
            @click=${onPoint}
            @keydown=${onKey}
          >
            ${preparing(img)
              ? html`<span class="gl-foto__preparo" style=${`background:${img.placeholder || "transparent"}`}><span class="badge badge--pending">preparando</span></span>`
              : html`<img src=${thumb(img, 900)} alt=${form.alt} width=${img.width} height=${img.height} />`}
            <span class="gl-foco__ponto" style=${`left:${form.focal_x * 100}%;top:${form.focal_y * 100}%`} aria-hidden="true"></span>
          </div>
          <p class="cs-dica">Toque na foto (ou use as setas) para marcar o que não pode ser cortado. Ficou em ${Math.round(form.focal_x * 100)}% da esquerda e ${Math.round(form.focal_y * 100)}% do alto.</p>
          <div class="gl-foco__cortes" aria-hidden="true">
            <span class="gl-foco__corte gl-foco__corte--largo" style=${`background-image:url("${thumb(img)}");background-position:${form.focal_x * 100}% ${form.focal_y * 100}%`}></span>
            <span class="gl-foco__corte gl-foco__corte--alto" style=${`background-image:url("${thumb(img)}");background-position:${form.focal_x * 100}% ${form.focal_y * 100}%`}></span>
          </div>
        </div>
        ${textField({ id: "foto-alt", name: "alt", label: "O que aparece na foto", value: form.alt, max: 160, multiline: true, required: true, error: errors.alt, help: "Em poucas palavras, para quem usa leitor de tela.", onInput: (v) => ((form.alt = v), win.redraw()) })}
        <div class="gl-form__linha">
          ${textField({ id: "foto-credito", name: "credit", label: "Crédito", value: form.credit, max: 60, onInput: (v) => ((form.credit = v), win.redraw()) })}
          <div class="field">
            <label class="field__label" for="foto-area">Área <small>opcional</small></label>
            <select class="field__input" id="foto-area" @change=${(e) => ((form.area = e.target.value), win.redraw())}>
              <option value="">—</option>
              ${AREAS.map((a) => html`<option value=${a} ?selected=${form.area === a}>${a}</option>`)}
            </select>
          </div>
        </div>
        <section class="gl-form__usos" aria-labelledby="foto-usos">
          <h3 class="gl-h3" id="foto-usos">Onde aparece</h3>
          ${img.usages.length ? html`<ul class="gl-usos">${img.usages.map((u) => html`<li>${placeLabel(u)}</li>`)}</ul>` : html`<p class="cs-dica">Em nenhum lugar do site ainda.</p>`}
        </section>
        <p class="cs-dica">${img.original_name} · ${img.width} × ${img.height} · ${kb(img.bytes)} · enviada ${when(img.uploaded_at)}${img.uploaded_by ? ` por ${firstName(img.uploaded_by)}` : ""}</p>
        <div class="cs-acoes cs-acoes--fim gl-form__acoes">
          <button class="link-button" type="button" @click=${() => replace(img, () => win.close())}>Substituir foto</button>
          <button class="link-button gl-apagar" type="button" @click=${() => remove(img, () => win.close())}>Apagar foto</button>
          <span class="gl-form__espaco"></span>
          <button class="btn btn--outline" type="button" data-close>Cancelar</button>
          <button class="btn" type="submit" ?disabled=${busy} aria-busy=${busy ? "true" : "false"}>${busy ? "Salvando…" : "Salvar foto"}</button>
        </div>
      </form>`,
    });
  }

  // ---- desenho ------------------------------------------------------------------------------

  function card(img, index, list) {
    const missingAlt = !img.alt?.trim();
    const notReady = preparing(img);
    return html`<li class="gl-foto ${missingAlt ? "is-pendente" : ""} ${notReady ? "is-preparando" : ""}">
      <!-- a foto também abre, para o mouse; o botão "Editar" é o caminho para teclado e leitores de tela -->
      <div class="gl-foto__abrir" @click=${() => editWindow(img)}>
        ${notReady
          ? html`<span class="gl-foto__preparo" style=${`background:${img.placeholder || "transparent"}`}><span class="raiz raiz--gira" aria-hidden="true"></span></span>`
          : html`<img src=${thumb(img)} alt="" loading="lazy" width=${img.width} height=${img.height} style=${`object-position:${focus(img)};background:${img.placeholder || "transparent"}`} />`}
      </div>
      <div class="gl-foto__texto">
        ${notReady ? html`<p class="gl-foto__estado" role="status"><span class="badge badge--pending">preparando</span> Em instantes ela fica pronta para usar no site.</p>` : nothing}
        ${missingAlt ? html`<p class="gl-foto__falta">${losango("")}Falta descrever a foto</p>` : html`<p class="gl-foto__alt">${img.alt}</p>`}
        <p class="gl-foto__meta">${[img.area, img.credit ? `foto: ${img.credit}` : ""].filter(Boolean).join(" · ") || "sem área nem crédito"}</p>
        <p class="gl-foto__usos">
          ${img.usages.length
            ? html`<span class="badge badge--said-yes">em uso</span> ${img.usages.map(placeLabel).join(", ")}`
            : html`<span class="badge badge--expired">sem uso</span>`}
        </p>
      </div>
      <div class="gl-foto__acoes">
        <button class="action" type="button" aria-label=${`Editar ${img.alt || img.original_name}`} @click=${() => editWindow(img)}>Editar</button>
        ${filter === "todas"
          ? html`<span class="gl-ordem">
              <button class="gl-ordem__btn" type="button" data-ordem=${img.id} data-dir="up" aria-label=${`Mover antes: ${img.alt || img.original_name}`} ?disabled=${index === 0} @click=${() => move(img, img.sort - 1)}>←</button>
              <button class="gl-ordem__btn" type="button" data-ordem=${img.id} data-dir="down" aria-label=${`Mover depois: ${img.alt || img.original_name}`} ?disabled=${index === list.length - 1} @click=${() => move(img, img.sort + 1)}>→</button>
            </span>`
          : nothing}
      </div>
    </li>`;
  }

  function galleryView(images) {
    const counts = {
      todas: images.length,
      "sem-texto": images.filter((i) => !i.alt?.trim()).length,
      "sem-uso": images.filter((i) => !i.usages.length).length,
    };
    const list = filter === "sem-texto" ? images.filter((i) => !i.alt?.trim()) : filter === "sem-uso" ? images.filter((i) => !i.usages.length) : images;
    return html`<div class="gl-topo">
        <div class="gl-envio-zona ${dragging ? "is-arrastando" : ""}" @dragover=${(e) => onDrag(e, true)} @dragleave=${(e) => onDrag(e, false)} @drop=${onDrop}>
          <button class="btn" type="button" @click=${() => pickFiles({ onPick: startUpload })}>Enviar fotos</button>
          <p>ou arraste as fotos para cá. JPG, PNG ou WebP, até 15 MB cada.</p>
        </div>
        <div class="gl-filtros" role="group" aria-label="Mostrar">
          ${FILTERS.map(
            (f) => html`<button class="gl-filtro" type="button" aria-pressed=${String(filter === f.key)} @click=${() => ((filter = f.key), draw())}>
              ${f.label} <small>${counts[f.key]}</small>
            </button>`,
          )}
        </div>
      </div>
      ${filter === "todas" ? html`<p class="cs-dica gl-dica">A ordem aqui é a da seção “Ambiente” do site. Use as setas de cada foto para mudar.</p>` : nothing}
      ${list.length
        ? html`<ul class="gl-grade">${list.map((img, i) => card(img, i, list))}</ul>`
        : html`<p class="cs-dica">${filter === "sem-texto" ? "Todas as fotos têm descrição." : "Todas as fotos estão em uso."}</p>`}`;
  }

  function draw() {
    let body;
    if (state.status === "loading") body = loadingBox();
    else if (state.status === "error") body = errorBox(state.error, () => load(), "A galeria não abriu.");
    else if (!state.images.length)
      body = html`<div class="gl-envio-zona gl-envio-zona--vazia ${dragging ? "is-arrastando" : ""}" @dragover=${(e) => onDrag(e, true)} @dragleave=${(e) => onDrag(e, false)} @drop=${onDrop}>
        ${emptyBox({
          title: "Nenhuma foto ainda",
          text: "Envie as fotos da casa: fachada, salão, quintal, pratos. Cada uma com uma descrição curta do que aparece.",
          action: html`<button class="btn" type="button" @click=${() => pickFiles({ onPick: startUpload })}>Enviar fotos</button>`,
        })}
      </div>`;
    else body = galleryView(state.images);
    render(body, container);
  }

  load();
  return () => {
    clearTimeout(poll);
    document.querySelectorAll(".gl-arquivo").forEach((input) => input.remove());
  };
}
