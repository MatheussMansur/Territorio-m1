// Sistema (história 1.14), só o dono: o estado do WhatsApp, a fila de envio, o último
// backup, o último teste de restauração e os erros recentes, e os aparelhos da casa com a
// diferença dos relógios deles (GET /staff/system/status); GET
// /staff/devices é a lista do contrato (pareamento e aprovação moram com a história dos aparelhos).
//
// Uma fonte só para os serviços (N16): as linhas do WhatsApp e do Google de Sistema e de
// Configurações > Integrações vêm as duas de integrationItems() abaixo, então as duas telas
// nunca discordam.
import { http, HttpResponse } from "msw";
import { getState } from "../../db.js";
import { currentRole, mockNow, problem, respond } from "../../scenario.js";
import { googleItem } from "./google.js";
import { whatsappState } from "./salao.js";

const API = "/api/v1";
const MIN = 60_000;
const forbidden = () => problem(403, "forbidden", "Essa parte é de outro perfil da equipe");

/** O WhatsApp da casa como as duas telas leem (?whatsapp=fora finge que caiu em todo lugar). */
function whatsappLine(state, now) {
  const part = state.system?.whatsapp || {};
  const at = part.at || new Date(now.getTime() - (part.checked_ago_min ?? 1) * MIN).toISOString();
  if (whatsappState(state) === "down") {
    return { key: "whatsapp", state: "problem", checked_at: now.toISOString(), detail: part.state === "problem" && part.detail ? part.detail : "O WhatsApp da casa não está respondendo. As mensagens esperam na fila." };
  }
  return { key: "whatsapp", state: "ok", checked_at: at, detail: part.detail || "Número da casa conectado." };
}

/**
 * As integrações de Configurações (história 2.20), com as linhas ao vivo por cima do que veio
 * nos dados iniciais: o WhatsApp e o Google leem o mesmo estado que Sistema. Atualiza os itens
 * guardados no lugar (quem chama grava quando precisar) e os devolve.
 */
export function integrationItems(state, now, scenario) {
  const items = state.settings?.integrations?.data?.items || [];
  const wa = whatsappLine(state, now);
  const google = googleItem(state, now, scenario);
  for (const item of items) {
    if (item.key === "whatsapp") {
      item.state = wa.state;
      item.checked_at = wa.checked_at;
      if (wa.state === "ok") item.last_ok_at = wa.checked_at;
      item.note = wa.state === "ok" ? null : wa.detail;
    }
    if (item.key === "google") {
      item.state = google.state === "ok" ? "ok" : google.state === "problem" ? "problem" : "unused";
      item.checked_at = google.checked_at;
      if (google.state === "ok") item.last_ok_at = google.checked_at;
      item.note = google.state === "problem" ? google.detail : null;
    }
  }
  return items;
}

function status(state, now, scenario) {
  const at = (ms) => new Date(now.getTime() - ms).toISOString();
  const s = state.system || {};
  if (scenario === "vazio") {
    const off = (key, detail) => ({ key, state: "not_connected", checked_at: now.toISOString(), detail });
    return {
      checked_at: now.toISOString(),
      items: [
        off("whatsapp", "O número da casa ainda não foi ligado."),
        off("queue", "Nada na fila: nenhuma mensagem saiu ainda."),
        off("backup", "O primeiro backup roda na primeira noite."),
        off("restore", "O primeiro teste roda depois do primeiro backup."),
        googleItem(state, now, scenario),
        { key: "errors", state: "ok", checked_at: now.toISOString(), detail: "Nenhum erro por enquanto." },
      ],
      errors: [],
      clock: [],
    };
  }
  const errors = s.errors || [];
  const item = (key, part, fallback) => ({
    key,
    state: part?.state || "ok",
    checked_at: part?.at || at((part?.checked_ago_min ?? 1) * MIN),
    detail: part?.detail || fallback,
  });
  return {
    checked_at: now.toISOString(),
    items: [
      // a mesma linha que Configurações > Integrações mostra
      whatsappLine(state, now),
      item("queue", s.queue, "Fila em dia."),
      item("backup", s.backup, "Backup em dia."),
      item("restore", s.restore, "Teste de restauração em dia."),
      // a agenda Google da casa (história 2.22): ligada, com problema ou não ligada
      googleItem(state, now, scenario),
      {
        key: "errors",
        state: errors.some((e) => now.getTime() - new Date(e.at).getTime() < 60 * MIN) ? "problem" : "ok",
        checked_at: errors[0]?.at || now.toISOString(),
        detail: errors.length ? `${errors.length} nos últimos dias. O mais recente: ${errors[0].where}.` : "Nenhum erro nos últimos dias.",
      },
    ],
    errors,
    clock: s.clock || [],
  };
}

export const handlers = [
  http.get(`${API}/staff/system/status`, () =>
    respond((scenario) => {
      if (currentRole() !== "owner") return forbidden();
      const now = mockNow();
      return HttpResponse.json(status(getState(now), now, scenario));
    }),
  ),

  http.get(`${API}/staff/devices`, () =>
    respond((scenario) => {
      if (currentRole() !== "owner") return forbidden();
      if (scenario === "vazio") return HttpResponse.json([]);
      return HttpResponse.json(getState(mockNow()).devices || []);
    }),
  ),
];
