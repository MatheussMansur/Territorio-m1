// O cardápio no painel (histórias 4.11 a 4.13). O rascunho (state.menu_draft) muda à vontade;
// publicar copia ele para state.menu, que o site lê. "Acabou" (available) muda os dois
// de uma vez e nunca espera uma publicação. A recepção pode mudar só `available`, e
// só enquanto Configurações › Salão deixar ("recepção marca acabou").
// Toda mudança vai para o registro de ações com a pessoa, o aparelho e o antes e depois.
// Um salvamento manda a versão lida (If-Match ou ?if_match=): 412 quando alguém gravou no meio;
// o ?conflito=1 da demonstração faz o próximo salvamento encontrar antes o salvamento de outra pessoa.
import { http, HttpResponse } from "msw";
import { uuid } from "../../../lib/uuid.js";
import { lintFields } from "../../../site/lint.js";
import { getState, save } from "../../db.js";
import { currentRole, mockNow, problem, respond } from "../../scenario.js";
import { extend } from "../../seeds/cardapio.js";
import { imageNotReady } from "./galeria.js";
import { actor, changesOf, conflictWanted, ifMatchOf, logAction, otherPerson, requestBuild, respondPublication, sessionGone } from "./site.js";

const API = "/api/v1";
const STYLES = ["dark", "light", "handmade", "default"];
const BADGES = ["vegetarian", "gluten_free", "spicy"];

function load() {
  const now = mockNow();
  const state = getState(now);
  if (!state.menu_draft) {
    // um banco de dados da simulação gravado antes de esta área existir: acrescenta os dados dela uma vez
    extend(state, now);
    save();
  }
  return state;
}

/** Configurações › Cardápio e Salão, como as telas do cardápio obedecem. */
function menuSettings(state) {
  // os espelhos que Configurações grava a cada salvamento, senão os próprios grupos
  const menu = { ...(state.settings?.menu?.data || {}), ...(state.menu_settings || {}) };
  const floor = { ...(state.settings?.floor?.data || {}), ...(state.floor_settings || {}) };
  return {
    reception_can_finish: floor.reception_can_finish !== false,
    unpriced_item: menu.unpriced_item === "ask" ? "ask" : "hide",
    show_sold_out: menu.show_sold_out !== false,
  };
}

const forbidden = (detail = "A recepção só marca e desmarca o acabou.") => problem(403, "forbidden", "Essa parte é de outro perfil da equipe", { detail });
const invalid = (errors, title = "Falta ajeitar alguns campos") => problem(422, "validation", title, { errors });
const notFound = (what) => problem(404, "not_found", `Esse ${what} não existe mais`);

const bySort = (a, b) => a.sort - b.sort;
const renumber = (list) => list.sort(bySort).forEach((x, i) => (x.sort = i));
const versionOf = (x) => String(x.version ?? 1);
const bump = (x) => (x.version = (x.version ?? 1) + 1);

/** Move uma entrada para uma nova posição, mantendo as outras em ordem. */
function move(list, entry, to) {
  const rest = list.filter((x) => x !== entry).sort(bySort);
  rest.splice(Math.max(0, Math.min(rest.length, to)), 0, entry);
  rest.forEach((x, i) => (x.sort = i));
}

/** O que o site receberia: sem pratos arquivados, sem categorias vazias. */
function publishable(draft) {
  return draft
    .map((c) => ({ ...structuredClone(c), items: c.items.filter((i) => !i.archived).map((i) => structuredClone(i)) }))
    .filter((c) => c.items.length)
    .sort(bySort);
}

const PUBLIC_ITEM = ["name", "description", "group", "price_cents", "price_label", "badges", "featured", "sort", "i18n", "category_id", "image_id"];
const PUBLIC_CATEGORY = ["name", "subtitle", "sheet_style", "footer", "photo", "image_id", "sort", "i18n"];
const differs = (a, b, keys) => keys.some((k) => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null));

/** A lista do que muda no site quando o rascunho é publicado. */
function changes(state) {
  const next = publishable(state.menu_draft);
  const now = state.menu;
  const out = [];
  const nowCats = new Map(now.map((c) => [c.id, c]));
  const nowItems = new Map(now.flatMap((c) => c.items).map((i) => [i.id, i]));
  const nextItems = new Map(next.flatMap((c) => c.items).map((i) => [i.id, i]));
  for (const c of next) {
    const before = nowCats.get(c.id);
    if (!before) out.push({ kind: "new", what: "category", label: c.name });
    else if (differs(c, before, PUBLIC_CATEGORY)) out.push({ kind: "changed", what: "category", label: c.name });
  }
  for (const c of now) if (!next.some((x) => x.id === c.id)) out.push({ kind: "removed", what: "category", label: c.name });
  for (const [id, item] of nextItems) {
    const before = nowItems.get(id);
    if (!before) out.push({ kind: "new", what: "item", label: item.name });
    else if (before.price_cents !== item.price_cents) out.push({ kind: "price", what: "item", label: item.name, from: before.price_cents, to: item.price_cents });
    else if (differs(item, before, PUBLIC_ITEM)) out.push({ kind: "changed", what: "item", label: item.name });
  }
  for (const [id, item] of nowItems) if (!nextItems.has(id)) out.push({ kind: "removed", what: "item", label: item.name });
  return out;
}

function view(state, scenario) {
  const categories = scenario === "vazio" ? [] : structuredClone(state.menu_draft).sort(bySort);
  for (const c of categories) {
    c.items.sort(bySort);
    c.version = versionOf(c);
    for (const i of c.items) i.version = versionOf(i);
  }
  return {
    published_at: state.menu_meta?.published_at ?? null,
    published_by: state.menu_meta?.published_by ?? null,
    categories,
    changes: scenario === "vazio" ? [] : changes(state),
    settings: menuSettings(state),
  };
}

function cleanText(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : value;
}

function validateItem(body, { partial }) {
  const errors = [];
  if (!partial || "name" in body) {
    if (!String(body.name || "").trim()) errors.push({ field: "name", message: "Dê um nome ao prato." });
    else if (body.name.length > 60) errors.push({ field: "name", message: "Passou de 60 caracteres." });
  }
  if ("price_cents" in body && body.price_cents != null && (!Number.isInteger(body.price_cents) || body.price_cents < 0 || body.price_cents > 100000)) {
    errors.push({ field: "price", message: "Confira o preço: só números, como 32 ou 32,50." });
  }
  if ("description" in body && String(body.description || "").length > 220) errors.push({ field: "description.pt", message: "Passou de 220 caracteres." });
  if ("badges" in body && (!Array.isArray(body.badges) || body.badges.some((b) => !BADGES.includes(b)))) errors.push({ field: "badges", message: "Selo desconhecido." });
  return errors;
}

function validateCategory(body, { partial }) {
  const errors = [];
  if (!partial || "name" in body) {
    if (!String(body.name || "").trim()) errors.push({ field: "name.pt", message: "Dê um nome à categoria." });
    else if (body.name.length > 40) errors.push({ field: "name.pt", message: "Passou de 40 caracteres." });
  }
  if ("sheet_style" in body && !STYLES.includes(body.sheet_style)) errors.push({ field: "sheet_style", message: "Escolha o desenho da folha." });
  return errors;
}

/** Os textos públicos do cardápio como campos de revisão, cada um com o nome do prato ou da categoria a que pertence. */
function menuTexts(draft) {
  const out = [];
  const add = (field, label, text) => text && out.push({ field, label, text });
  for (const c of draft) {
    add(`categories.${c.id}.name`, `Categoria ${c.name}`, c.name);
    add(`categories.${c.id}.subtitle.pt`, `${c.name} · frase de baixo`, c.subtitle);
    add(`categories.${c.id}.footer`, `${c.name} · frase do pé da folha`, c.footer);
    for (const lang of ["es", "en"]) add(`categories.${c.id}.subtitle.${lang}`, `${c.name} · frase de baixo (${lang})`, c.i18n?.[lang]?.subtitle);
    for (const i of c.items.filter((x) => !x.archived)) {
      add(`items.${i.id}.name`, i.name, i.name);
      add(`items.${i.id}.description.pt`, `${i.name} · descrição`, i.description);
      for (const lang of ["es", "en"]) add(`items.${i.id}.description.${lang}`, `${i.name} · descrição (${lang})`, i.i18n?.[lang]?.description);
    }
  }
  return out;
}

const findItem = (menu, id) => {
  for (const c of menu) {
    const item = c.items.find((i) => i.id === id);
    if (item) return { category: c, item };
  }
  return {};
};

const ITEM_FIELDS = ["name", "description", "group", "price_cents", "price_label", "badges", "featured", "archived", "i18n", "image_id"];
const CATEGORY_FIELDS = ["name", "subtitle", "sheet_style", "footer", "photo", "photo_alt", "image_id", "i18n"];
const itemView = (item) => ({ ...structuredClone(item), version: versionOf(item) });
const categoryView = (category) => ({ ...structuredClone(category), version: versionOf(category) });
const editable = (x, keys) => Object.fromEntries(keys.filter((k) => k in x).map((k) => [k, x[k]]));

/** A outra pessoa da demonstração: o gerente muda o prato (ou a categoria) um minuto antes do salvamento. */
function otherPersonChanges(state, entry, kind) {
  if (kind === "item") {
    if (entry.price_cents != null) entry.price_cents += 200;
    else entry.description = `${entry.description || ""} Sai bem quentinho.`.trim();
  } else {
    entry.subtitle = `${entry.subtitle || ""}`.trim() || "Da cozinha para o meio da mesa.";
  }
  bump(entry);
  entry.updated_by = otherPerson(state);
  entry.updated_at = new Date(mockNow().getTime() - 60_000).toISOString();
}

/** 412 quando a versão lida não é a atual. */
function stale(entry, ifMatch, what) {
  if (ifMatch == null || ifMatch === versionOf(entry)) return null;
  return problem(412, "precondition_failed", "Outra pessoa gravou antes", {
    detail: `${entry.updated_by || "Outra pessoa"} mudou ${what} enquanto você editava.`,
    current: { ...structuredClone(entry), version: versionOf(entry) },
  });
}

export const handlers = [
  http.get(`${API}/staff/menu`, () => respond((scenario) => HttpResponse.json(view(load(), scenario)))),

  http.post(`${API}/staff/menu/categories`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    return respond(() => {
      if (!currentRole()) return sessionGone();
      if (currentRole() === "floor") return forbidden();
      const errors = validateCategory(body, { partial: false });
      if (errors.length) return invalid(errors);
      const state = load();
      const category = { id: uuid(), name: "", subtitle: "", sheet_style: "dark", footer: "", photo: null, photo_alt: null, image_id: null, i18n: { es: {}, en: {} }, items: [], sort: state.menu_draft.length, version: 1 };
      for (const key of CATEGORY_FIELDS) if (key in body) category[key] = cleanText(body[key], 200);
      state.menu_draft.push(category);
      logAction(state, { action: "menu.category_create", entity_type: "menu_category", entity_id: category.id, summary: `Cardápio: nova categoria ${category.name} (rascunho)`, changes: changesOf({}, editable(category, CATEGORY_FIELDS)) });
      save();
      return HttpResponse.json(categoryView(category), { status: 201 });
    });
  }),

  http.patch(`${API}/staff/menu/categories/:id`, async ({ params, request }) => {
    const body = await request.json().catch(() => ({}));
    const ifMatch = ifMatchOf(request);
    const conflict = conflictWanted("cardapio");
    return respond(() => {
      if (!currentRole()) return sessionGone();
      if (currentRole() === "floor") return forbidden();
      const state = load();
      const category = state.menu_draft.find((c) => c.id === params.id);
      if (!category) return notFound("categoria");
      if (conflict) otherPersonChanges(state, category, "category");
      const late = stale(category, ifMatch, "a categoria");
      if (late) {
        save();
        return late;
      }
      const errors = validateCategory(body, { partial: true });
      if (errors.length) return invalid(errors);
      // uma foto ainda em preparo não pode ir para o site (história 3.7)
      const notReady = body.image_id !== category.image_id && imageNotReady(state, body.image_id);
      if (notReady) return notReady;
      const before = editable(category, CATEGORY_FIELDS);
      const sortBefore = category.sort;
      for (const key of CATEGORY_FIELDS) if (key in body) category[key] = cleanText(body[key], 200);
      if (Number.isInteger(body.sort)) move(state.menu_draft, category, body.sort);
      bump(category);
      category.updated_by = actor(state);
      category.updated_at = mockNow().toISOString();
      const moved = Number.isInteger(body.sort) && Object.keys(body).length === 1;
      logAction(state, {
        action: moved ? "menu.order" : "menu.category_update",
        entity_type: "menu_category",
        entity_id: category.id,
        summary: moved ? `Cardápio: mudou a ordem de ${category.name} (rascunho)` : `Cardápio: editou a categoria ${category.name} (rascunho)`,
        changes: moved ? { posicao: { from: String(sortBefore + 1), to: String(category.sort + 1) } } : changesOf(before, editable(category, CATEGORY_FIELDS)),
      });
      save();
      return HttpResponse.json(categoryView(category));
    });
  }),

  http.delete(`${API}/staff/menu/categories/:id`, ({ params }) =>
    respond(() => {
      if (!currentRole()) return sessionGone();
      if (currentRole() === "floor") return forbidden();
      const state = load();
      const category = state.menu_draft.find((c) => c.id === params.id);
      if (!category) return notFound("categoria");
      if (category.items.length) return problem(409, "conflict", "A categoria ainda tem pratos", { detail: "Arquive ou mude os pratos de categoria antes de tirar a categoria." });
      state.menu_draft = state.menu_draft.filter((c) => c !== category);
      renumber(state.menu_draft);
      logAction(state, { action: "menu.category_delete", entity_type: "menu_category", entity_id: category.id, summary: `Cardápio: tirou a categoria ${category.name} (rascunho)`, changes: { name: { from: category.name, to: null } } });
      save();
      return new HttpResponse(null, { status: 204 });
    }),
  ),

  http.post(`${API}/staff/menu/items`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    return respond(() => {
      if (!currentRole()) return sessionGone();
      if (currentRole() === "floor") return forbidden();
      const state = load();
      const category = state.menu_draft.find((c) => c.id === body.category_id);
      if (!category) return invalid([{ field: "category_id", message: "Escolha a categoria." }]);
      const errors = validateItem(body, { partial: false });
      if (errors.length) return invalid(errors);
      const item = { id: uuid(), category_id: category.id, name: "", description: "", group: null, price_cents: null, price_label: null, badges: [], available: true, featured: false, archived: false, image_id: null, i18n: { es: {}, en: {} }, sort: category.items.length, version: 1 };
      for (const key of ITEM_FIELDS) if (key in body) item[key] = cleanText(body[key], 220);
      category.items.push(item);
      logAction(state, { action: "menu.item_create", entity_type: "menu_item", entity_id: item.id, summary: `Cardápio: novo prato ${item.name} em ${category.name} (rascunho)`, changes: changesOf({}, editable(item, ITEM_FIELDS)) });
      save();
      return HttpResponse.json(itemView(item), { status: 201 });
    });
  }),

  http.patch(`${API}/staff/menu/items/:id`, async ({ params, request }) => {
    const body = await request.json().catch(() => ({}));
    const ifMatch = ifMatchOf(request);
    const keys = Object.keys(body || {});
    const onlyAvailable = keys.length === 1 && keys[0] === "available";
    const conflict = onlyAvailable ? false : conflictWanted("cardapio");
    return respond(() => {
      const role = currentRole();
      if (!role) return sessionGone();
      if (role === "floor" && !onlyAvailable) return forbidden();
      const state = load();
      if (role === "floor" && !menuSettings(state).reception_can_finish) {
        return forbidden("Configurações › Salão não deixa a recepção marcar o acabou. Peça ao gerente.");
      }
      const { category, item } = findItem(state.menu_draft, params.id);
      if (!item) return notFound("prato");
      if (onlyAvailable) {
        // "acabou" vai na hora para o site: o rascunho e o cardápio publicado juntos, sem conferir versão
        const before = item.available !== false;
        item.available = Boolean(body.available);
        const live = findItem(state.menu, params.id).item;
        if (live) live.available = item.available;
        if (before !== item.available) {
          logAction(state, {
            action: "menu.sold_out",
            entity_type: "menu_item",
            entity_id: item.id,
            summary: item.available ? `${item.name} voltou ao cardápio de hoje` : `Marcou ${item.name} como acabou hoje`,
            changes: { available: { from: before, to: item.available } },
          });
        }
        save();
        return HttpResponse.json(itemView(item));
      }
      if (conflict) otherPersonChanges(state, item, "item");
      const late = stale(item, ifMatch, "o prato");
      if (late) {
        save();
        return late;
      }
      const errors = validateItem(body, { partial: true });
      if (errors.length) return invalid(errors);
      const notReady = body.image_id !== item.image_id && imageNotReady(state, body.image_id);
      if (notReady) return notReady;
      const before = editable(item, ITEM_FIELDS);
      const sortBefore = item.sort;
      for (const key of ITEM_FIELDS) if (key in body) item[key] = cleanText(body[key], 220);
      if (body.category_id && body.category_id !== category.id) {
        const target = state.menu_draft.find((c) => c.id === body.category_id);
        if (!target) return invalid([{ field: "category_id", message: "Essa categoria não existe mais." }]);
        category.items = category.items.filter((i) => i !== item);
        renumber(category.items);
        item.category_id = target.id;
        item.sort = target.items.length;
        target.items.push(item);
      } else if (Number.isInteger(body.sort)) {
        move(category.items, item, body.sort);
      }
      bump(item);
      item.updated_by = actor(state);
      item.updated_at = mockNow().toISOString();
      const moved = Number.isInteger(body.sort) && keys.length === 1;
      const archived = keys.length === 1 && "archived" in body;
      let action = "menu.item_update";
      let summary = `Cardápio: editou ${item.name} (rascunho)`;
      if (moved) {
        action = "menu.order";
        summary = `Cardápio: mudou a ordem de ${item.name} (rascunho)`;
      } else if (archived) {
        action = body.archived ? "menu.item_archive" : "menu.item_restore";
        summary = body.archived ? `Cardápio: arquivou ${item.name} (sai do site ao publicar)` : `Cardápio: trouxe ${item.name} de volta (rascunho)`;
      }
      logAction(state, {
        action,
        entity_type: "menu_item",
        entity_id: item.id,
        summary,
        changes: moved ? { posicao: { from: String(sortBefore + 1), to: String(item.sort + 1) } } : changesOf(before, editable(item, ITEM_FIELDS)),
      });
      save();
      return HttpResponse.json(itemView(item));
    });
  }),

  http.delete(`${API}/staff/menu/items/:id`, ({ params }) =>
    respond(() => {
      if (!currentRole()) return sessionGone();
      if (currentRole() === "floor") return forbidden();
      const state = load();
      const { category, item } = findItem(state.menu_draft, params.id);
      if (!item) return notFound("prato");
      category.items = category.items.filter((i) => i !== item);
      renumber(category.items);
      logAction(state, { action: "menu.item_delete", entity_type: "menu_item", entity_id: item.id, summary: `Cardápio: apagou ${item.name} do rascunho`, changes: { name: { from: item.name, to: null } } });
      save();
      return new HttpResponse(null, { status: 204 });
    }),
  ),

  // vários de uma vez, arrastados na tela (história 4.11): a ordem inteira das categorias,
  // ou dos pratos de uma categoria; uma lista que não bate mais com o rascunho é um conflito
  http.put(`${API}/staff/menu/order`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    return respond(() => {
      if (!currentRole()) return sessionGone();
      if (currentRole() === "floor") return forbidden();
      const state = load();
      let list;
      let what;
      let ids;
      if (Array.isArray(body.categories)) {
        list = state.menu_draft;
        ids = body.categories;
        what = "das categorias";
      } else {
        const category = state.menu_draft.find((c) => c.id === body.category_id);
        if (!category) return notFound("categoria");
        list = category.items;
        ids = body.items;
        what = `dos pratos de ${category.name}`;
      }
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) return invalid([{ field: "order", message: "Mande a lista inteira, na ordem nova." }]);
      const current = new Set(list.map((x) => x.id));
      if (ids.length !== current.size || ids.some((id) => !current.has(id))) {
        return problem(409, "conflict", "O cardápio mudou agora há pouco", { detail: "Alguém pôs ou tirou um prato enquanto você mudava a ordem. Atualize e arraste de novo." });
      }
      const before = [...list].sort(bySort).map((x) => x.name);
      const byId = new Map(list.map((x) => [x.id, x]));
      ids.forEach((id, i) => (byId.get(id).sort = i));
      list.sort(bySort);
      logAction(state, {
        action: "menu.order",
        entity_type: "menu",
        entity_id: body.category_id || null,
        summary: `Cardápio: mudou a ordem ${what} (rascunho)`,
        changes: { ordem: { from: before.join(", "), to: list.map((x) => x.name).join(", ") } },
      });
      save();
      return HttpResponse.json(view(state, "normal"));
    });
  }),

  http.post(`${API}/staff/menu/publish`, () =>
    respondPublication((scenario) => {
      if (!currentRole()) return sessionGone();
      if (currentRole() === "floor") return forbidden();
      const state = load();
      // a revisão de conteúdo do build (NFR-34): a tela diz qual prato ou categoria corrigir
      const problems = lintFields(menuTexts(state.menu_draft));
      if (problems.length) return invalid(problems.map(({ field, label, message }) => ({ field, label, message: `${label}: ${message}` })), "Falta ajeitar antes de publicar");
      const by = actor(state);
      const list = changes(state);
      state.menu = publishable(state.menu_draft);
      state.menu_meta = { published_at: mockNow().toISOString(), published_by: by };
      requestBuild(state, "menu:publish", by);
      const word = { new: "novo", changed: "mudou", removed: "saiu", price: "preço" };
      logAction(state, {
        action: "menu.publish",
        entity_type: "menu",
        entity_id: null,
        summary: `Publicou o cardápio (${list.length} ${list.length === 1 ? "mudança" : "mudanças"})`,
        changes: Object.fromEntries(
          list.slice(0, 12).map((c) => [c.label, c.kind === "price" ? { from: c.from == null ? "sem preço" : String(c.from / 100), to: c.to == null ? "sem preço" : String(c.to / 100) } : { from: c.kind === "new" ? null : "no site", to: word[c.kind] }]),
        ),
      });
      save();
      return HttpResponse.json(view(state, scenario === "erro" ? "normal" : scenario));
    }),
  ),
];
