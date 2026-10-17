// O cardápio no painel: rascunho, publicação e "acabou" (histórias 4.11 a 4.13).
// Uma edição manda a versão lida no cabeçalho If-Match (412 quando alguém gravou no meio).
import { del, get, patch, post, put } from "./client.js";

const versioned = (version) => (version == null ? {} : { ifMatch: version });

export const menu = (options) => get("/staff/menu", options);
export const createCategory = (body) => post("/staff/menu/categories", body);
export const updateCategory = (id, body, version) => patch(`/staff/menu/categories/${id}`, body, versioned(version));
export const removeCategory = (id) => del(`/staff/menu/categories/${id}`);
export const createItem = (body) => post("/staff/menu/items", body);
export const updateItem = (id, body, version) => patch(`/staff/menu/items/${id}`, body, versioned(version));
export const removeItem = (id) => del(`/staff/menu/items/${id}`);
/** "Acabou" vai na hora para o site, sem publicar. */
export const setAvailable = (id, available) => patch(`/staff/menu/items/${id}`, { available });
/** Uma nova ordem arrastada na tela: { categories: [ids] } ou { category_id, items: [ids] }. */
export const order = (body) => put("/staff/menu/order", body);
export const publish = () => post("/staff/menu/publish");
