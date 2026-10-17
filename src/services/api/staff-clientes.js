// Clientes e pedidos de privacidade do painel (histórias 5.14 a 5.18).
import { get, patch, post } from "./client.js";

/** Uma página de clientes com o telefone mascarado; `q` é um nome ou o fim do telefone. */
export const list = ({ q, cursor, limit = 20 } = {}, options) => get("/staff/customers", { ...options, query: { q, cursor, limit } });

/** A ficha: histórico, notas, etiquetas, preferências e consentimentos. */
export const getOne = (id, options) => get(`/staff/customers/${id}`, options);

/** Notas, etiquetas, bloqueio (com o motivo). `version` é a que a tela viu, mandada como If-Match:
 * um salvamento mais novo responde 412 precondition_failed. */
export const update = (id, changes, version) => patch(`/staff/customers/${id}`, changes, version == null ? {} : { ifMatch: version });

/** O telefone completo; vai para o registro de ações. */
export const revealPhone = (id) => post(`/staff/customers/${id}/reveal-phone`);

/** Tudo o que a casa guarda sobre o cliente, em JSON (dono, depois da checagem de identidade). */
export const exportData = (id) => post(`/staff/customers/${id}/export`, {});

/** Nome e telefone saem, reservas futuras são canceladas com o aviso (dono, depois da checagem de identidade). */
export const anonymize = (id) => post(`/staff/customers/${id}/anonymize`, {});

/** Pedidos de privacidade (LGPD) com o prazo de 15 dias (dono). */
export const privacyRequests = ({ status, cursor } = {}, options) => get("/staff/privacy/requests", { ...options, query: { status, cursor } });

/** Um pedido que chegou por WhatsApp, e-mail ou na casa. */
export const createPrivacyRequest = (body) => post("/staff/privacy/requests", body);

/** Atendido ou recusado (uma recusa precisa do motivo). */
export const resolvePrivacyRequest = (id, body) => post(`/staff/privacy/requests/${id}/resolve`, body);
