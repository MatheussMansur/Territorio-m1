// O que aconteceu com cada reserva até agora, para a linha do tempo da gaveta e o movimento do Hoje: quem
// fez e como, o comprovante e o lembrete do dia no WhatsApp, as respostas, a aprovação.
// Também algumas reservas que vieram por telefone e WhatsApp, um lembrete que o WhatsApp não entregou
// e um cliente que não respondeu, para os alertas terem algo real para dizer.
const MIN = 60_000;

const MANAGER = "Gerente da casa";
const OWNER = "Marcus Norberto";

/** As pessoas desta noite dos dados iniciais básicos, pelo nome, e como a noite delas é contada. */
const STORIES = {
  Carla: { reply: "yes" },
  Rafael: { failed: true },
  Lucas: { reply: "yes" },
  Juliana: { reply: "yes", note: "Avisou pelo WhatsApp que uma pessoa do grupo é vegetariana." },
  Diego: { noReply: true },
  "Renata Souza": { reply: "yes", source: "whatsapp", by: MANAGER, internal: "Cadeirinha separada no quintal, levar para o salão." },
  Mariana: {},
  Bruno: { reply: "yes", source: "phone", by: OWNER },
  Thiago: {},
  // Paula não tem WhatsApp: reservou por telefone, a casa liga para confirmar (história 5.19)
  Paula: { source: "phone", by: MANAGER, noWhatsapp: true },
  Beatriz: { source: "whatsapp", by: MANAGER },
  Gustavo: { pending: true },
};

const at = (date, time) => new Date(`${date}T${time}:00-03:00`);
const iso = (d) => new Date(d).toISOString();

export function extend(state, now) {
  const users = Object.fromEntries((state.users || []).map((u) => [u.name, u.id]));
  const nameOf = (r) => state.customers.find((c) => c.id === r.customer_id)?.name || r.walk_in_name || "";

  for (const r of state.reservations) {
    if (r.history) continue;
    const story = STORIES[nameOf(r)] || {};
    const created = new Date(r.created_at);
    r.history = [];
    r.messages = [];
    r.locale ??= "pt";
    r.version ??= 1;

    if (story.source) {
      r.source = story.source;
      r.created_by = users[story.by] ?? null;
      r.history.push({ at: iso(created), actor_label: story.by, action: "created", summary: `Reserva lançada ${story.source === "phone" ? "por telefone" : "pelo WhatsApp"}` });
    } else if (r.source === "site" || !r.source) {
      r.history.push({ at: iso(created), actor_label: "Cliente", action: "created", summary: r.status === "pending" ? "Pedido feito pelo site: grupo grande, aguarda a casa" : "Reserva feita pelo site" });
    } else {
      continue; // quem chega sem reserva e a lista de espera contam a própria história nos dados iniciais de Espera e Salão
    }
    if (story.note) r.history.push({ at: iso(created.getTime() + 40 * MIN), actor_label: MANAGER, action: "note", summary: story.note });
    if (story.internal) r.internal_notes ||= story.internal;
    if (story.noWhatsapp) {
      r.flags = [...new Set([...(r.flags || []), "no_whatsapp"])];
      r.phone_verified = false;
      const c = state.customers.find((x) => x.id === r.customer_id);
      if (c) c.phone_verified_at = null;
      r.history.push({ at: iso(created.getTime() + MIN), actor_label: story.by, action: "note", summary: "Sem WhatsApp · confirmar por ligação" });
      continue;
    }
    if (!["pending", "confirmed", "completed", "no_show"].includes(r.status)) continue;

    // o comprovante logo depois de reservar
    r.messages.push({ template: "booking_receipt", status: "read", sent_at: iso(created.getTime() + MIN) });

    // o lembrete do dia às 16:00 (ou um pouco antes de agora, quando ainda não deu 16:00)
    const remindAt = Math.min(at(r.date, "16:00").getTime(), now.getTime() - 50 * MIN);
    if (r.status !== "pending" && r.date <= new Date(now.getTime() + 24 * 3_600_000).toISOString().slice(0, 10) && remindAt > created.getTime()) {
      if (story.failed) {
        r.customer_confirmation = "sent";
        r.messages.push({ template: "reminder", status: "failed", sent_at: iso(remindAt) });
        r.history.push({ at: iso(remindAt + 20 * MIN), actor_label: "Sistema", action: "message_failed", summary: "O lembrete não chegou: o WhatsApp não entregou" });
      } else {
        r.messages.push({ template: "reminder", status: story.reply ? "read" : "delivered", sent_at: iso(remindAt) });
        if (story.reply === "yes") {
          r.customer_confirmation = "yes";
          r.confirmed_by_customer_at = iso(remindAt + 25 * MIN);
          r.history.push({ at: r.confirmed_by_customer_at, actor_label: "Cliente", action: "customer_yes", summary: "Respondeu SIM ao lembrete" });
        } else if (story.noReply) {
          r.customer_confirmation = "no_reply";
        }
      }
    }
  }
}
