// Os blocos de texto do site, a publicação do site e os números dele (histórias 4.14 e 4.15).
// A versão lida (o etag do bloco) volta em todo salvamento: a API responde 412 quando alguém
// gravou no meio. Ela vai no cabeçalho If-Match.
import { get, post, put } from "./client.js";

const versioned = (etag) => (etag == null ? {} : { ifMatch: etag });

/** Todo bloco, com o rascunho (fields), o que está no site (published_fields) e o etag. */
export const blocks = (options) => get("/staff/content", options);
export const saveBlock = (block, fields, etag) => put(`/staff/content/${block}`, { fields }, versioned(etag));
export const publishBlock = (block) => post(`/staff/content/${block}/publish`);
export const versions = (block, options) => get(`/staff/content/${block}/versions`, options);
export const restore = (block, version) => post(`/staff/content/${block}/restore`, { version });

/** A tarefa site_render, as mais recentes primeiro. */
export const builds = (limit = 10, options) => get("/staff/site/builds", { ...options, query: { limit } });

/** Visitas e páginas do site (números de exemplo até o contador estar no ar). */
export const stats = (options) => get("/staff/site/stats", options);
