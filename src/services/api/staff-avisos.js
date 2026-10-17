// A central de avisos da equipe (FR-87): a lista de quem está no painel, com o que leu, e as
// escolhas de "Meus avisos". Mudanças chegam pelo fluxo ao vivo (tópico "alerts").
import { get, post, put } from "./client.js";

/** { server_time, quiet: { from, to, active }, unread, critical, items: [StaffAlert] } */
export const list = (options) => get("/staff/alerts", options);

/** Marca como lidos os avisos mostrados (sem ids: todos os ativos). */
export const markRead = (ids = []) => post("/staff/alerts/read", { ids });

/** "Dispensar só para mim" (só os informativos). */
export const dismiss = (id) => post(`/staff/alerts/${encodeURIComponent(id)}/dismiss`, {});

/** "Marcar como resolvido" para todos (o que não some sozinho; nunca um crítico). */
export const resolve = (id) => post(`/staff/alerts/${encodeURIComponent(id)}/resolve`, {});

/** "Meus avisos": { muted: [código], items: [{ code, level, title, clears, can_mute, following }] } */
export const preferences = (options) => get("/staff/me/alert-preferences", options);

/** Grava os avisos que a pessoa não segue (um crítico nunca entra). */
export const savePreferences = (muted) => put("/staff/me/alert-preferences", { muted });
