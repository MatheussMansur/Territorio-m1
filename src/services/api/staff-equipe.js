// A equipe e as permissões por área (histórias 1.9 e 1.15), só o dono.
import { get, patch, post, put } from "./client.js";

export const users = (options) => get("/staff/users", options);

/** Alguém que só entra com o PIN nos aparelhos da casa: nome, perfil e telefone. */
export const createPinUser = (body) => post("/staff/users", body);

/** Convite por e-mail, vale por 72 horas. */
export const invite = (body) => post("/staff/users/invite", body);

/** Perfil (precisa de `password`), situação, telefone (muda o PIN) ou nome. */
export const update = (id, changes) => patch(`/staff/users/${id}`, changes);

export const resendInvite = (id) => post(`/staff/users/${id}/invite/resend`);

export const revokeSessions = (id) => post(`/staff/users/${id}/revoke-sessions`);

/** Zera a verificação em duas etapas (a pessoa configura uma nova na próxima entrada). */
export const resetMfa = (id) => post(`/staff/users/${id}/mfa/reset`, {});

/** As permissões por área: { areas, defaults, allowed: { manager, floor }, updated_at, updated_by }. */
export const permissions = (options) => get("/staff/permissions", options);

/** Grava as áreas de cada perfil (depois da checagem de identidade). */
export const savePermissions = (body) => put("/staff/permissions", body);
