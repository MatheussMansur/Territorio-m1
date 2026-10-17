// Plantas do salão e as áreas da casa.
import { del, get, patch, post } from "./client.js";

export const areas = (options) => get("/staff/areas", options);
export const createArea = (body, options) => post("/staff/areas", body, options);
export const updateArea = (id, changes, options) => patch(`/staff/areas/${id}`, changes, options);
/** Recusado (409 area_in_use, com used_by) enquanto uma planta usa a área. */
export const deleteArea = (id, options) => del(`/staff/areas/${id}`, options);

export const layouts = (options) => get("/staff/layouts", options);
export const layout = (id, options) => get(`/staff/layouts/${id}`, options);
export const createLayout = (body, options) => post("/staff/layouts", body, options);
export const duplicateLayout = (id, name, options) => post(`/staff/layouts/${id}/duplicate`, name ? { name } : {}, options);
export const archiveLayout = (id, options) => del(`/staff/layouts/${id}`, options);

/**
 * Grava uma planta; com dryRun responde o que ela faz com as noites que a usam. `version` é a
 * lida (mandada como If-Match, 412 quando alguém gravou antes).
 */
export const updateLayout = (id, body, { dryRun = false, version, ...options } = {}) =>
  patch(`/staff/layouts/${id}`, body, { ...options, ifMatch: dryRun ? undefined : version, query: { dry_run: dryRun || undefined } });
