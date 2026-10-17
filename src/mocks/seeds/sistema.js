// O que a área Sistema mostra (história 1.14): os aparelhos da casa com quando cada um foi visto por último
// e quanto o relógio dele está longe do do servidor, e dados de saúde de exemplo para o WhatsApp, a
// fila de envio, os backups e os erros recentes.
import { uuid } from "../../lib/uuid.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function extend(state, now) {
  const ago = (ms) => new Date(now.getTime() - ms).toISOString();
  const owner = state.users?.find((u) => u.role === "owner")?.name || "Marcus Norberto";

  // outra área pode já listar os aparelhos (pareamento, história 1.10): aí mantém os dela
  if (!state.devices?.length) {
    const device = (fields) => ({
      id: uuid(),
      status: "approved",
      approved_by: owner,
      approved_at: ago(20 * DAY),
      revoked_at: null,
      version: "1",
      ...fields,
    });
    state.devices = [
      device({ name: "Computador da recepção", kind: "desktop", location: "Recepção", role: "floor", last_seen_at: ago(2 * MIN) }),
      device({ name: "Tablet do salão", kind: "tablet", location: "Salão", role: "floor", last_seen_at: ago(40 * MIN), approved_at: ago(3 * DAY) }),
      device({ name: "Tablet do quintal", kind: "tablet", location: "Quintal", role: "floor", last_seen_at: ago(19 * HOUR) }),
      device({ name: "Celular do bar", kind: "phone", location: "Balcão", role: "floor", status: "pending", approved_by: null, approved_at: null, last_seen_at: ago(6 * MIN) }),
      device({ name: "Celular antigo da recepção", kind: "phone", location: "Recepção", role: "floor", status: "revoked", revoked_at: ago(11 * DAY), last_seen_at: ago(11 * DAY) }),
    ];
  }

  // o tablet do quintal perdeu a chave do aparelho hoje de manhã (história 1.11, o alerta device_key_lost do Hoje)
  const quintal = state.devices.find((d) => d.name === "Tablet do quintal") || state.devices.find((d) => d.kind === "tablet" && d.status === "approved");
  if (quintal && !state.devices.some((d) => d.key_lost_at)) quintal.key_lost_at = ago(5 * HOUR);

  // segundos que o relógio do aparelho está adiantado (+) ou atrasado (−) em relação ao servidor, pelo nome do aparelho
  const skews = { "Computador da recepção": 2, "Tablet do salão": -4, "Tablet do quintal": 214, "Celular do bar": 0 };

  state.system = {
    clock: state.devices.map((d, i) => ({ device_id: d.id, clock_skew_s: skews[d.name] ?? (i % 2 ? -3 : 5) })),
    whatsapp: { state: "ok", detail: "Número da casa conectado. Última mensagem entregue há 4 min.", checked_ago_min: 1 },
    queue: { state: "ok", waiting: 3, failed: 0, sent_today: 46, detail: "3 na fila, nenhuma com falha. 46 enviadas hoje.", checked_ago_min: 1 },
    backup: { state: "ok", at: ago(17 * HOUR), size_mb: 38, detail: "Backup da noite concluído, 38 MB, guardado fora da casa." },
    restore: { state: "problem", at: ago(10 * DAY), detail: "O último teste de restauração foi há 10 dias. O combinado é um por semana." },
    // lembretes que a fila de envio não conseguiu entregar (o alerta reminder_failed do Hoje)
    reminder_failures: [{ id: uuid(), at: ago(35 * MIN), text: "O lembrete do dia não saiu para Larissa: o número não tem WhatsApp. Ligue para ela, se precisar." }],
    errors: [
      { id: uuid(), at: ago(35 * MIN), where: "Lembrete do dia", message: "Uma mensagem voltou: o número de Larissa não tem WhatsApp.", request_id: "req-7f3a21" },
      { id: uuid(), at: ago(5 * HOUR), where: "Site", message: "Uma reserva demorou mais de 3 s para confirmar.", request_id: "req-51c0be" },
      { id: uuid(), at: ago(2 * DAY), where: "Backup", message: "O envio para fora da casa repetiu uma vez e concluiu.", request_id: "req-0d99e4" },
    ],
  };
}
