// O registro de ações das últimas duas semanas (história 1.13): reservas, clientes, equipe,
// configurações, aparelhos e entradas, cada um com quem, quando, em qual aparelho e o antes e
// depois. Segredos e dados sensíveis nunca levam valor: são marcados { secret: true }
// e a tela mostra "trocado".
import { uuid } from "../../lib/uuid.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const DEVICES = {
  recepcao: "Computador da recepção",
  salao: "Tablet do salão",
  pessoal: "Acesso pessoal",
};

const SECRET = { secret: true };

export function extend(state, now) {
  state.audit ??= [];
  const user = (role, name) => state.users?.find((u) => (name ? u.name === name : u.role === role)) || null;
  const owner = user("owner");
  const manager = user("manager");
  const floor = user("floor");
  const actor = (u, fallback) => ({ actor_type: "user", actor_id: u?.id ?? null, actor_label: u?.name || fallback });
  const debora = actor(user(null, "Débora Kato"), "Débora Kato");
  const taina = actor(user(null, "Tainá Oliveira"), "Tainá Oliveira");
  const rodrigo = actor(user(null, "Rodrigo Benítez"), "Rodrigo Benítez");
  const marcus = actor(owner, "Marcus Norberto");
  const gerente = actor(manager, "Gerente da casa");
  const salao = actor(floor, "Salão");
  const system = { actor_type: "system", actor_id: null, actor_label: "Sistema" };
  const customer = (name) => ({ actor_type: "customer", actor_id: null, actor_label: name });

  const names = (state.customers || []).filter((c) => !c.anonymized_at).map((c) => c.name);
  const pick = (i) => names[i % Math.max(names.length, 1)] || "Cliente";
  const code = (i) => `TR-${4100 + i * 17}`;

  const entries = [];
  const add = (agoMs, who, device, action, entity_type, summary, changes = {}) =>
    entries.push({
      id: uuid(),
      occurred_at: new Date(now.getTime() - agoMs).toISOString(),
      ...who,
      device_label: who.actor_type === "user" ? device : null,
      action,
      entity_type,
      entity_id: null,
      summary,
      changes,
    });

  // hoje e ontem, bem juntos, como é uma noite de verdade
  add(25 * MIN, marcus, DEVICES.pessoal, "auth.login", "session", "Entrou no painel");
  add(40 * MIN, debora, DEVICES.recepcao, "reservation.confirm", "reservation", `Confirmou a reserva ${code(1)} de ${pick(1)}`, { status: { from: "pending", to: "confirmed" } });
  add(55 * MIN, system, null, "message.sent", "message", "Lembrete do dia enviado a 11 clientes");
  add(70 * MIN, customer(pick(4)), null, "reservation.create", "reservation", `Reserva feita pelo site: ${code(4)}, 4 pessoas às 20:30`);
  add(2 * HOUR, gerente, DEVICES.recepcao, "customer.reveal_phone", "customer", `Viu o telefone completo de ${pick(7)}`, { phone: SECRET });
  add(3 * HOUR, marcus, DEVICES.pessoal, "settings.update", "settings", "Mudou a tolerância de atraso", { tolerance_min: { from: 15, to: 20 }, extra_tolerance_min: { from: 5, to: 10 } });
  add(4 * HOUR, gerente, DEVICES.recepcao, "customer.update", "customer", `Anotou na ficha de ${pick(5)}`, { internal_notes: { from: "", to: "Vem com as crianças: separar cadeirinha." } });
  add(5 * HOUR, marcus, DEVICES.pessoal, "menu.update", "menu_item", "Marcou o oniguiri grelhado como esgotado hoje", { available: { from: true, to: false } });
  add(20 * HOUR, taina, DEVICES.salao, "reservation.check_in", "reservation", `Chegou: ${pick(0)}, mesa S1`, { status: { from: "confirmed", to: "completed" } });
  add(20 * HOUR + 12 * MIN, taina, DEVICES.salao, "reservation.check_in", "reservation", `Chegou: ${pick(3)}, mesa Q3`, { status: { from: "confirmed", to: "completed" } });
  add(20 * HOUR + 40 * MIN, rodrigo, DEVICES.salao, "reservation.move_tables", "reservation", `Trocou a mesa de ${pick(6)}`, { table_codes: { from: "Q1", to: "Q2" } });
  add(21 * HOUR, rodrigo, DEVICES.salao, "auth.pin_login", "session", "Entrou com o PIN no tablet do salão");
  add(21 * HOUR + 30 * MIN, taina, DEVICES.recepcao, "reservation.no_show", "reservation", `Marcou "Não veio": ${pick(9)}`, { status: { from: "confirmed", to: "no_show" } });
  add(22 * HOUR, salao, DEVICES.salao, "waitlist.offer", "waitlist", `Ofereceu mesa da espera a ${pick(12)}`);
  add(23 * HOUR, debora, DEVICES.recepcao, "reservation.create", "reservation", `Reserva por WhatsApp para ${pick(10)}, 2 pessoas às 21:00`);
  add(26 * HOUR, marcus, DEVICES.pessoal, "user.mfa_reset", "user", "Zerou a verificação em duas etapas de Débora Kato", { totp_secret: SECRET });
  add(27 * HOUR, marcus, DEVICES.pessoal, "settings.integrations", "settings", "Trocou a chave do WhatsApp", { whatsapp_token: SECRET });
  add(28 * HOUR, gerente, DEVICES.pessoal, "auth.login", "session", "Entrou no painel");
  add(2 * DAY + 3 * HOUR, marcus, DEVICES.pessoal, "user.invite", "user", "Convidou isadora.nunes@territorio.test como gerente", { role: { from: null, to: "manager" } });
  add(2 * DAY + 4 * HOUR, marcus, DEVICES.pessoal, "customer.block", "customer", "Bloqueou Ricardo Nogueira", { blocked: { from: false, to: true }, blocked_reason: { from: "", to: "Três faltas sem avisar entre agosto e setembro." } });
  add(2 * DAY + 5 * HOUR, gerente, DEVICES.recepcao, "reservation.cancel", "reservation", `Cancelou a reserva ${code(14)} a pedido do cliente`, { status: { from: "confirmed", to: "canceled" } });
  add(2 * DAY + 20 * HOUR, taina, DEVICES.salao, "reservation.check_in", "reservation", `Chegou: ${pick(15)}, mesa Q5`);
  add(3 * DAY, marcus, DEVICES.pessoal, "device.approve", "device", "Aprovou o Tablet do salão como aparelho da casa", { status: { from: "pending", to: "approved" } });
  add(3 * DAY + 2 * HOUR, marcus, DEVICES.pessoal, "user.create_pin", "user", "Cadastrou Kenji Moraes (recepção, só PIN)", { pin: SECRET });
  add(3 * DAY + 3 * HOUR, marcus, DEVICES.pessoal, "layout.update", "layout", "Mudou a planta Padrão: juntou S3 e S4", { combos: { from: "—", to: "S3 + S4" } });
  add(4 * DAY, debora, DEVICES.recepcao, "customer.update", "customer", "Marcou Luana Martins como atenção", { tags: { from: "—", to: "atenção" } });
  add(4 * DAY + 6 * HOUR, marcus, DEVICES.pessoal, "event.update", "event", "Editou o rascunho de Forró no quintal", { list_capacity: { from: 30, to: 40 } });
  add(5 * DAY, marcus, DEVICES.pessoal, "customer.export", "customer", "Exportou os dados de Matías González", { file: SECRET });
  add(5 * DAY + 2 * HOUR, marcus, DEVICES.pessoal, "privacy.resolve", "privacy_request", "Deu por atendido o pedido de portabilidade de Matías", { status: { from: "open", to: "done" } });
  add(6 * DAY, system, null, "backup.done", "system", "Backup da noite concluído (38 MB)");
  add(6 * DAY + 3 * HOUR, marcus, DEVICES.pessoal, "user.update", "user", "Desativou Paulo Henrique Silva", { status: { from: "active", to: "disabled" } });
  add(7 * DAY, marcus, DEVICES.pessoal, "settings.update", "settings", "Mudou a janela de reserva", { window_days: { from: 21, to: 30 } });
  add(7 * DAY + 4 * HOUR, gerente, DEVICES.recepcao, "reservation.approve", "reservation", `Aprovou o grupo de 10 de ${pick(11)}`, { status: { from: "pending", to: "confirmed" } });
  add(8 * DAY, marcus, DEVICES.pessoal, "auth.password_change", "user", "Trocou a própria senha", { password: SECRET });
  add(9 * DAY, marcus, DEVICES.pessoal, "permissions.update", "permissions", "Revisou as permissões por área (sem mudanças)");
  add(10 * DAY, system, null, "restore.test", "system", "Teste de restauração do backup concluído");
  add(11 * DAY, marcus, DEVICES.pessoal, "device.revoke", "device", "Revogou o Celular antigo da recepção", { status: { from: "approved", to: "revoked" } });
  add(12 * DAY, marcus, DEVICES.pessoal, "audit.export", "audit", "Exportou o registro de setembro", { file: SECRET });
  add(13 * DAY, marcus, DEVICES.pessoal, "settings.update", "settings", "Ligou a lista de espera", { waitlist_enabled: { from: false, to: true } });

  // as noites das últimas duas semanas: chegadas e reservas do site, para dar volume
  for (let d = 1; d <= 13; d++) {
    for (let k = 0; k < 3; k++) {
      const i = d * 3 + k;
      const who = [taina, rodrigo, salao][i % 3];
      add(d * DAY + (19 + k) * HOUR - 4 * HOUR, who, DEVICES.salao, "reservation.check_in", "reservation", `Chegou: ${pick(i)}, mesa ${["S2", "Q4", "S6"][k]}`, { status: { from: "confirmed", to: "completed" } });
    }
    add(d * DAY + 9 * HOUR, customer(pick(d + 20)), null, "reservation.create", "reservation", `Reserva feita pelo site: ${code(d + 30)}, ${2 + (d % 4)} pessoas`);
  }

  state.audit.push(...entries);
}
