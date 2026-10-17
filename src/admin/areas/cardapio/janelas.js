// As janelas da área Cardápio: um prato e uma categoria, com os textos em três idiomas.
// Tudo o que se salva aqui vai para o rascunho; o site só muda em "Publicar". Um salvamento envia a
// versão lida: quando alguém salvou o mesmo prato no meio-tempo (412) a janela oferece juntar as
// duas ou descartar a sua; um 422 marca o campo e leva o foco para o primeiro.
import { toast } from "../../../components/toast.js";
import { html, nothing } from "../../../lib/html.js";
import * as galeria from "../../../services/api/staff-galeria.js";
import * as api from "../../../services/api/staff-cardapio.js";
import { changedLeaves, conflictWindow, fieldErrors, joinChanges, langTabs, missing, missingNote, openWindow, parseMoney, priceInput, sayError, textField } from "../site/comum.js";

const BADGES = [
  { value: "vegetarian", label: "Vegetariano" },
  { value: "gluten_free", label: "Sem glúten" },
  { value: "spicy", label: "Picante" },
];

export const STYLES = [
  { value: "dark", label: "Folha preta", help: "como a do ramen" },
  { value: "handmade", label: "Feita à mão", help: "como a carta de bebidas" },
  { value: "light", label: "Folha clara", help: "papel claro, letra preta" },
];

const discard = { title: "Descartar as mudanças?", message: "O que você mudou nesta janela vai se perder.", confirmLabel: "Descartar mudanças", cancelLabel: "Continuar editando" };

const FIELD_LABEL = {
  name: "nome",
  description: "descrição",
  "i18n.es.description": "descrição em espanhol",
  "i18n.en.description": "descrição em inglês",
  price_cents: "preço",
  group: "grupo",
  badges: "selos",
  featured: "prato do dia",
  image_id: "foto",
  category_id: "categoria",
  subtitle: "frase de baixo",
  sheet_style: "desenho da folha",
  footer: "frase do pé da folha",
  "i18n.es.name": "nome em espanhol",
  "i18n.en.name": "nome em inglês",
  "i18n.es.subtitle": "frase de baixo em espanhol",
  "i18n.en.subtitle": "frase de baixo em inglês",
};

/**
 * As fotos da galeria, carregadas uma vez por janela. Uma foto ainda sendo preparada aparece com
 * "preparando"; escolhê-la é recusado pelo servidor com image_not_ready (história 3.7).
 */
function galleryPhotos(onReady) {
  galeria
    .images()
    .then((list) => onReady(list.filter((p) => p.status === "ready" || p.status === "processing")))
    .catch(() => onReady([]));
}

const photoLabel = (p) => `${p.alt || p.original_name}${p.status === "ready" ? "" : " · preparando"}`;

/** Os erros da janela para um salvamento que falhou: uma foto não pronta é dita no aviso da janela. */
const saveErrors = (error) => (error?.type === "image_not_ready" ? { _: sayError(error) } : fieldErrors(error));

const thumbOf = (photo) => photo?.variants?.find((v) => v.width >= 480 && v.format === "jpg")?.url || photo?.variants?.[0]?.url || "";

/**
 * Envia uma mudança com a versão lida; no 412 pergunta se junta ou descarta. `base` é o que a janela
 * abriu, `body` o que ela envia; `current` volta com o salvamento da outra pessoa.
 * Resolve com a entrada salva, "discarded", ou null (continuar editando).
 */
export async function saveVersioned({ send, base, body, version, keys }) {
  try {
    return await send(body, version);
  } catch (error) {
    if (error?.status !== 412 || !error.body?.current) throw error;
    const current = error.body.current;
    const pick = (x) => Object.fromEntries(keys.map((k) => [k, x?.[k] ?? null]));
    const join = joinChanges(pick(base), pick(body), pick(current));
    const answer = await conflictWindow({
      who: current.updated_by,
      at: current.updated_at,
      what: "isto",
      theirs: changedLeaves(pick(base), pick(current)),
      both: join.both,
      label: (path) => FIELD_LABEL[path] || FIELD_LABEL[path.split(".")[0]] || path,
    });
    if (answer === "discard") return "discarded";
    if (answer !== "join") return null;
    return send(join.merged, current.version);
  }
}

/** Idiomas que faltam num valor traduzido cujo português está escrito. */
const gapsOf = (value) => (String(value?.pt || "").trim() ? missing(value).filter((c) => c !== "pt") : []);

function focusFirstError(win) {
  requestAnimationFrame(() => win.dialog.querySelector('[aria-invalid="true"]')?.focus());
}

/**
 * A janela do prato. `item` é null para um prato novo. `onSaved(item)` recarrega a tela.
 */
export function itemWindow({ item, category, categories, onSaved }) {
  const isNew = !item;
  const form = {
    name: item?.name || "",
    group: item?.group || "",
    price: priceInput(item?.price_cents ?? null),
    desc: { pt: item?.description || "", es: item?.i18n?.es?.description || null, en: item?.i18n?.en?.description || null },
    badges: [...(item?.badges || [])],
    featured: Boolean(item?.featured),
    category_id: item?.category_id || category.id,
    image_id: item?.image_id || null,
  };
  const start = JSON.stringify(form);
  let lang = "pt";
  let errors = {};
  let busy = false;
  let photos = null; // a galeria, carregada quando a janela abre
  const groups = [...new Set(categories.flatMap((c) => c.items.map((i) => i.group)).filter(Boolean))];
  galleryPhotos((list) => {
    photos = list;
    win.redraw();
  });

  async function save(event) {
    event.preventDefault();
    const price = parseMoney(form.price);
    errors = {};
    if (!form.name.trim()) errors.name = "Dê um nome ao prato.";
    if (Number.isNaN(price)) errors.price = "Confira o preço: só números, como 32 ou 32,50.";
    if (Object.keys(errors).length) {
      win.redraw();
      return focusFirstError(win);
    }
    const body = {
      name: form.name.trim(),
      group: form.group.trim() || null,
      price_cents: price,
      description: form.desc.pt.trim(),
      i18n: { es: { description: form.desc.es || null }, en: { description: form.desc.en || null } },
      badges: form.badges,
      featured: form.featured,
      category_id: form.category_id,
      image_id: form.image_id,
    };
    busy = true;
    win.redraw();
    try {
      const saved = isNew
        ? await api.createItem(body)
        : await saveVersioned({ send: (b, v) => api.updateItem(item.id, b, v), base: item, body, version: item.version, keys: Object.keys(body) });
      if (saved === null) {
        busy = false;
        return win.redraw();
      }
      win.close();
      if (saved === "discarded") {
        toast({ title: "Ficou o que a outra pessoa gravou", message: "As suas mudanças neste prato foram descartadas." });
        return onSaved(item);
      }
      toast({ title: isNew ? `${saved.name} entrou no rascunho` : `${saved.name} salvo no rascunho`, message: "O site muda quando você publicar." });
      onSaved(saved);
    } catch (error) {
      busy = false;
      errors = saveErrors(error);
      if (!Object.keys(errors).length) errors._ = sayError(error);
      if (errors["description.pt"]) lang = "pt";
      win.redraw();
      focusFirstError(win);
    }
  }

  const win = openWindow({
    title: isNew ? `Novo prato · ${category.name}` : `Editar ${item.name}`,
    size: "drawer",
    isDirty: () => JSON.stringify(form) !== start,
    discard,
    body: () => {
      const gaps = gapsOf(form.desc);
      return html`<form class="cd-form" novalidate @submit=${save}>
        ${errors._ ? html`<p class="notice notice--alert" role="alert">${errors._}</p>` : nothing}
        ${textField({ id: "prato-nome", name: "name", label: "Nome do prato", value: form.name, max: 60, required: true, error: errors.name, help: "O nome fica igual nas três línguas, como no cardápio impresso.", onInput: (v) => ((form.name = v), win.redraw()) })}
        <div class="cd-form__linha">
          ${textField({ id: "prato-preco", name: "price", label: "Preço em reais", value: form.price, error: errors.price, help: "Em branco, o prato aparece sem preço.", onInput: (v) => ((form.price = v), win.redraw()) })}
          <div class="field">
            <label class="field__label" for="prato-grupo">Grupo <small>opcional</small></label>
            <input class="field__input" id="prato-grupo" name="group" list="prato-grupos" maxlength="40" .value=${form.group} @input=${(e) => (form.group = e.target.value)} />
            <datalist id="prato-grupos">${groups.map((g) => html`<option value=${g}></option>`)}</datalist>
          </div>
        </div>
        <div class="field">
          <label class="field__label" for="prato-categoria">Categoria</label>
          <select class="field__input" id="prato-categoria" name="category_id" .value=${form.category_id} @change=${(e) => (form.category_id = e.target.value)}>
            ${categories.map((c) => html`<option value=${c.id} ?selected=${c.id === form.category_id}>${c.name}</option>`)}
          </select>
        </div>
        <fieldset class="cd-form__grupo">
          <legend class="field__label">Descrição</legend>
          ${langTabs({ id: "prato-desc", lang, missingIn: gaps, onPick: (code) => ((lang = code), win.redraw()) })}
          <div role="tabpanel" id="prato-desc-painel" aria-labelledby=${`prato-desc-tab-${lang}`}>
            ${missingNote(lang, gaps)}
            ${textField({
              id: "prato-descricao",
              name: `description.${lang}`,
              label: `Descrição em ${{ pt: "português", es: "espanhol", en: "inglês" }[lang]}`,
              value: form.desc[lang] || "",
              max: 220,
              multiline: true,
              lang: lang === "pt" ? "pt-BR" : lang,
              placeholder: lang === "pt" ? "" : form.desc.pt,
              error: errors[`description.${lang}`],
              onInput: (v) => ((form.desc[lang] = v || (lang === "pt" ? "" : null)), win.redraw()),
            })}
          </div>
        </fieldset>
        <fieldset class="cd-form__grupo">
          <legend class="field__label">Selos</legend>
          <div class="cd-form__checks">
            ${BADGES.map(
              (b) => html`<label class="check cd-check">
                <input
                  type="checkbox"
                  name="badges"
                  value=${b.value}
                  .checked=${form.badges.includes(b.value)}
                  @change=${(e) => {
                    form.badges = e.target.checked ? [...form.badges, b.value] : form.badges.filter((x) => x !== b.value);
                    win.redraw();
                  }}
                />
                ${b.label}
              </label>`,
            )}
          </div>
        </fieldset>
        <label class="check cd-check">
          <input type="checkbox" name="featured" .checked=${form.featured} @change=${(e) => ((form.featured = e.target.checked), win.redraw())} />
          Prato do dia: aparece em “Hoje na casa” enquanto tiver
        </label>
        ${photoPicker({ id: "prato-foto", photos, chosen: form.image_id, onPick: (id) => ((form.image_id = id), win.redraw()) })}
        <div class="cs-acoes cs-acoes--fim">
          <button class="btn btn--outline" type="button" data-close>Cancelar</button>
          <button class="btn" type="submit" ?disabled=${busy} aria-busy=${busy ? "true" : "false"}>${busy ? "Salvando…" : isNew ? "Pôr no rascunho" : "Salvar prato"}</button>
        </div>
      </form>`;
    },
  });
  return win;
}

/** A janela da categoria: nome e subtítulo em três idiomas, o estilo da folha e a foto. */
export function categoryWindow({ category, count, onSaved }) {
  const isNew = !category;
  const form = {
    name: { pt: category?.name || "", es: category?.i18n?.es?.name || null, en: category?.i18n?.en?.name || null },
    subtitle: { pt: category?.subtitle || "", es: category?.i18n?.es?.subtitle || null, en: category?.i18n?.en?.subtitle || null },
    sheet_style: category?.sheet_style || "dark",
    footer: category?.footer || "",
    photo: category?.photo || "",
    image_id: category?.image_id || null,
  };
  const start = JSON.stringify(form);
  let lang = "pt";
  let errors = {};
  let busy = false;
  let photos = null; // a galeria, carregada quando a janela abre

  galleryPhotos((list) => {
    photos = list;
    win.redraw();
  });

  async function save(event) {
    event.preventDefault();
    errors = {};
    if (!form.name.pt.trim()) {
      errors["name.pt"] = "Dê um nome à categoria, em português.";
      lang = "pt";
      win.redraw();
      return focusFirstError(win);
    }
    const body = {
      name: form.name.pt.trim(),
      subtitle: form.subtitle.pt.trim(),
      sheet_style: form.sheet_style,
      footer: form.footer.trim(),
      photo: form.photo || null,
      image_id: form.image_id,
      photo_alt: photos?.find((p) => p.id === form.image_id)?.alt ?? category?.photo_alt ?? null,
      i18n: { es: { name: form.name.es || null, subtitle: form.subtitle.es || null }, en: { name: form.name.en || null, subtitle: form.subtitle.en || null } },
    };
    busy = true;
    win.redraw();
    try {
      const saved = isNew
        ? await api.createCategory(body)
        : await saveVersioned({ send: (b, v) => api.updateCategory(category.id, b, v), base: category, body, version: category.version, keys: Object.keys(body) });
      if (saved === null) {
        busy = false;
        return win.redraw();
      }
      win.close();
      if (saved === "discarded") {
        toast({ title: "Ficou o que a outra pessoa gravou", message: "As suas mudanças nesta categoria foram descartadas." });
        return onSaved(category);
      }
      toast({ title: isNew ? `${saved.name} entrou no rascunho` : `${saved.name} salva no rascunho`, message: "O site muda quando você publicar." });
      onSaved(saved);
    } catch (error) {
      busy = false;
      errors = saveErrors(error);
      if (!Object.keys(errors).length) errors._ = sayError(error);
      win.redraw();
      focusFirstError(win);
    }
  }

  const pickPhoto = (event) => {
    const chosen = photos?.find((p) => p.id === event.target.value);
    form.image_id = chosen?.id || null;
    form.photo = chosen?.key || "";
    win.redraw();
  };
  const chosenId = () => form.image_id || photos?.find((p) => p.key && p.key === form.photo)?.id || "";

  const win = openWindow({
    title: isNew ? "Nova categoria" : `Editar ${category.name}`,
    size: "drawer",
    isDirty: () => JSON.stringify(form) !== start,
    discard,
    body: () => {
      const gaps = [...new Set([...gapsOf(form.name), ...gapsOf(form.subtitle)])];
      if (!form.name.pt.trim()) gaps.unshift("pt");
      const thumb = photos?.find((p) => p.id === chosenId());
      return html`<form class="cd-form" novalidate @submit=${save}>
        ${errors._ ? html`<p class="notice notice--alert" role="alert">${errors._}</p>` : nothing}
        ${langTabs({ id: "cat", lang, missingIn: gaps, onPick: (code) => ((lang = code), win.redraw()) })}
        <div class="cd-form" role="tabpanel" id="cat-painel" aria-labelledby=${`cat-tab-${lang}`}>
          ${missingNote(lang, gaps)}
          ${textField({
            id: "cat-nome",
            name: `name.${lang}`,
            label: "Nome da categoria",
            value: form.name[lang] || "",
            max: 40,
            required: lang === "pt",
            lang: lang === "pt" ? "pt-BR" : lang,
            placeholder: lang === "pt" ? "" : form.name.pt,
            error: errors[`name.${lang}`],
            onInput: (v) => ((form.name[lang] = v || (lang === "pt" ? "" : null)), win.redraw()),
          })}
          ${textField({
            id: "cat-sub",
            name: `subtitle.${lang}`,
            label: "Frase de baixo do nome",
            value: form.subtitle[lang] || "",
            max: 120,
            lang: lang === "pt" ? "pt-BR" : lang,
            placeholder: lang === "pt" ? "" : form.subtitle.pt,
            onInput: (v) => ((form.subtitle[lang] = v || (lang === "pt" ? "" : null)), win.redraw()),
          })}
        </div>
        <fieldset class="cd-form__grupo">
          <legend class="field__label">Desenho da folha</legend>
          <div class="cd-form__checks">
            ${STYLES.map(
              (s) => html`<label class="check cd-check">
                <input type="radio" name="sheet_style" value=${s.value} .checked=${form.sheet_style === s.value} @change=${() => ((form.sheet_style = s.value), win.redraw())} />
                <span><b>${s.label}</b> · ${s.help}</span>
              </label>`,
            )}
          </div>
        </fieldset>
        ${textField({ id: "cat-rodape", name: "footer", label: "Frase à mão no pé da folha", value: form.footer, max: 40, onInput: (v) => ((form.footer = v), win.redraw()) })}
        <div class="field">
          <label class="field__label" for="cat-foto">Foto da folha <small>opcional</small></label>
          ${photos === null
            ? html`<p class="cs-dica" role="status">Carregando as fotos da Galeria…</p>`
            : html`<select class="field__input" id="cat-foto" name="image_id" aria-describedby="cat-foto-ajuda" @change=${pickPhoto}>
                <option value="" ?selected=${!chosenId()}>Sem foto</option>
                ${photos.map((p) => html`<option value=${p.id} ?selected=${p.id === chosenId()}>${photoLabel(p)}</option>`)}
              </select>`}
          <p class="field__help" id="cat-foto-ajuda">As fotos vêm da <a href="/admin/galeria">Galeria</a>.${count ? ` A categoria tem ${count} ${count === 1 ? "prato" : "pratos"}.` : ""}</p>
          ${thumbOf(thumb) ? html`<img class="cd-form__foto" src=${thumbOf(thumb)} alt=${thumb.alt} width="160" height="120" />` : nothing}
        </div>
        <div class="cs-acoes cs-acoes--fim">
          <button class="btn btn--outline" type="button" data-close>Cancelar</button>
          <button class="btn" type="submit" ?disabled=${busy} aria-busy=${busy ? "true" : "false"}>${busy ? "Salvando…" : isNew ? "Criar categoria" : "Salvar categoria"}</button>
        </div>
      </form>`;
    },
  });
  return win;
}

/** Uma foto da Galeria para um prato (história 4.11), com a sua miniatura. */
function photoPicker({ id, photos, chosen, onPick }) {
  const thumb = photos?.find((p) => p.id === chosen);
  return html`<div class="field">
    <label class="field__label" for=${id}>Foto do prato <small>opcional</small></label>
    ${photos === null
      ? html`<p class="cs-dica" role="status">Carregando as fotos da Galeria…</p>`
      : html`<select class="field__input" id=${id} name="image_id" aria-describedby=${`${id}-ajuda`} @change=${(e) => onPick(e.target.value || null)}>
          <option value="" ?selected=${!chosen}>Sem foto</option>
          ${photos.map((p) => html`<option value=${p.id} ?selected=${p.id === chosen}>${photoLabel(p)}</option>`)}
        </select>`}
    <p class="field__help" id=${`${id}-ajuda`}>As fotos vêm da <a href="/admin/galeria">Galeria</a>, já com a descrição e o crédito.</p>
    ${thumbOf(thumb) ? html`<img class="cd-form__foto" src=${thumbOf(thumb)} alt=${thumb.alt} width="160" height="120" />` : nothing}
  </div>`;
}
