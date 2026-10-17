// Palavras e pequenas peças compartilhadas por Hoje e Reservas: carimbos de status (sempre com texto),
// canais, sinais, a resposta do cliente ao lembrete, as pessoas e as mesas.
import { html, nothing } from "../../../lib/html.js";
import { formatDay, houseTime, relativeDay, shortTime } from "../../../lib/dates.js";
import { t } from "../../../lib/strings.js";
import { canDo, canDoAction, canDoOption } from "../../nav.js";

// Quem pode fazer o que com uma reserva vem do arquivo de permissões (história 1.3, AR-22): as
// telas não guardam nenhuma lista de perfis própria.
const ACTIONS = "POST /staff/reservations/{id}/actions";
const areasOf = (user) => user?.areas ?? undefined;

/** Se esta pessoa pode fazer esta ação ("approve", "no_show"…); uma ação que o arquivo não tem é negada. */
export const canAct = (user, action) => canDoAction(user?.role, ACTIONS, action, areasOf(user));
/** Se esta pessoa vê outros dias além de hoje à noite (a recepção só vê hoje, AR-24). */
export const seesAnyDay = (user) => canDoOption(user?.role, "GET /staff/reservations", "any_day", areasOf(user));
/** Se esta pessoa muda uma reserva para outro dia (a recepção mantém o mesmo dia). */
export const movesToAnyDay = (user) => canDoOption(user?.role, ACTIONS, "any_day", areasOf(user));
/** Se esta pessoa lê a nota interna e o detalhe de restrição alimentar. */
export const seesPrivateNotes = (user) => canDoOption(user?.role, "GET /staff/reservations/{id}", "private_notes", areasOf(user));
/** Se esta pessoa corrige uma noite já fechada, com um motivo. */
export const correctsClosedNight = (user) => canDoOption(user?.role, ACTIONS, "closed_night", areasOf(user));
/** Se esta pessoa reserva além do limite da faixa de horário, com um motivo. */
export const canOverride = (user) => canDoOption(user?.role, "POST /staff/reservations", "override", areasOf(user));
/** Se esta pessoa vê o telefone completo (depois da checagem de identidade). */
export const canRevealPhone = (user) => canDo(user?.role, "POST /staff/customers/{id}/reveal-phone", areasOf(user));

export const ACTIVE = new Set(["pending", "confirmed", "waitlisted", "offered"]);

export const SOURCE = { site: "Site", staff: "Equipe", whatsapp: "WhatsApp", phone: "Telefone", walk_in: "Balcão" };
export const SOURCE_LONG = { site: "pelo site", staff: "pela equipe", whatsapp: "pelo WhatsApp", phone: "por telefone", walk_in: "no balcão" };
export const FLAG = { birthday: "aniversário", high_chair: "cadeirinha", accessibility: "acessibilidade", dietary: "restrição alimentar" };
export { AREA } from "../../area-names.js";

const CONFIRMATION = {
  yes: { cls: "badge--said-yes", text: "confirmou" },
  no: { cls: "badge--no-reply", text: "disse que não vem" },
  no_reply: { cls: "badge--no-reply", text: "sem resposta" },
  sent: { cls: "", text: "lembrete enviado" },
};

/** O carimbo de status: texto mais um padrão, nunca só a cor. */
export const statusBadge = (status) => html`<span class=${`badge badge--${status.replace("_", "-")}`}>${t(`status.${status}`)}</span>`;

/** A resposta do cliente ao lembrete do dia, quando há algo a dizer. */
export function confirmationBadge(value) {
  const c = CONFIRMATION[value];
  return c ? html`<span class=${`badge ${c.cls}`}>${c.text}</span>` : nothing;
}

export const people = (n) => `${n} ${n === 1 ? "pessoa" : "pessoas"}`;
export const tables = (r) => (r.table_codes?.length ? r.table_codes.join(" + ") : "—");
export const partyName = (r) => (r.party_size > 1 ? `${r.customer?.name || "Cliente"} + ${r.party_size - 1}` : r.customer?.name || "Cliente");

/** "hoje, 20h30" · "amanhã, 19h" · "sáb 17/10, 21h". */
export function when(r, today) {
  const rel = relativeDay(r.date, today);
  const day = rel === "hoje" || rel === "amanhã" ? rel : formatDay(r.date);
  return `${day}, ${shortTime(r.time)}`;
}

export const clock = (iso) => (iso ? houseTime(iso) : "");

/** Os sinais como pequenas notas. */
export const flagList = (r) => (r.flags?.length ? r.flags.map((f) => FLAG[f] || f).join(" · ") : "");
