// Configurações: os grupos de configurações, a prévia e o salvamento deles, os aparelhos da casa e o
// assistente de primeiro uso. A versão lida vai no cabeçalho If-Match (412 quando alguém
// gravou antes).
import { get, post, patch, put } from "./client.js";

/** Índice: versão, autor, data e pendências de cada grupo que a sessão pode ler. */
export const index = (options) => get("/staff/settings", options);

/** Um grupo: { group, version, updated_by, updated_at, data, meta, pending, context }. */
export const group = (key, options) => get(`/staff/settings/${key}`, options);

/** O efeito de uma mudança, sem gravar: mudanças, reservas afetadas, simulação, notas. */
export const preview = (key, body, options) => post(`/staff/settings/${key}/preview`, body, options);

/** Grava só os campos mudados, com a versão lida; 412 quando alguém gravou antes. */
export const save = (key, body, version, options) =>
  patch(`/staff/settings/${key}`, body, { ...options, ifMatch: version, idempotencyKey: options?.idempotencyKey });

/** A senha do dono de novo, antes de um salvamento sensível (vale por 5 minutos). */
export const reauth = (password, options) => post("/staff/auth/reauth", { password }, options);

export const devices = {
  list: (options) => get("/staff/devices", options),
  /** O que um aparelho novo faz na própria tela: pede pareamento e mostra o código de 8 caracteres. */
  requestPairing: (body, options) => post("/staff/devices/pairing", body, options),
  approve: (id, body, options) => post(`/staff/devices/${id}/approve`, body, options),
  update: (id, body, version, options) => patch(`/staff/devices/${id}`, body, { ...options, ifMatch: version }),
  revoke: (id, reason, options) => post(`/staff/devices/${id}/revoke`, { reason }, options),
};

export const onboarding = {
  get: (options) => get("/staff/onboarding", options),
  /** Com a versão lida, o progresso gravado por outra sessão responde 412 em vez de se perder. */
  update: (body, options) => put("/staff/onboarding", body, { ...options, ifMatch: options?.version || undefined }),
};

/** O histórico de um grupo: todo salvamento com quem, quando e o antes e depois de cada campo. */
export const history = (key, options) =>
  get("/staff/audit", { ...options, query: { action: "settings.update", entity: `settings:${key}`, limit: 100 } });

/** As datas entre `from` e `to` que saem da semana padrão (os planos do dia da Agenda). */
export const exceptions = (from, to, options) => get("/staff/day-plans", { ...options, query: { from, to } });

/** Os modelos de WhatsApp e a situação deles na Meta. */
export const templates = (options) => get("/staff/notifications/templates", options);

/** Um texto novo para um modelo, nas três línguas, mandado à Meta para aprovação. */
export const reviseTemplate = (id, text, options) => post(`/staff/notifications/templates/${id}/revisions`, { text }, options);

/** "Testar agora": como o serviço respondeu e quando, nunca a resposta crua dele. */
export const testIntegration = (key, options) => post(`/staff/system/checks/${key}`, {}, options);

/** "Publicar de novo" depois de uma publicação do site que falhou. */
export const republish = (reason, options) => post("/staff/site/builds", { reason }, options);
