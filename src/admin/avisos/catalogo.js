// O catálogo único dos avisos da equipe (FR-87, mudança de 16/10): cada aviso tem um código, um
// nível, quem recebe por padrão, quando some e se fura o silêncio da noite. O Hoje, as faixas do
// topo, a central com o sino, as preferências em "Meus avisos" e a simulação leem esta lista;
// nenhuma tela decide nível ou destinatário por conta própria.
//
// Os avisos à equipe saem só pelo painel (decisão do Matheus, 16/10): sem WhatsApp e sem e-mail.
// O e-mail fica só para assuntos da conta (convite, recuperar a senha).
//
// Níveis:
//   critical  fica até resolver, ninguém desliga, fura o silêncio, faixa no topo de toda tela
//   important conta no sino, some quando resolve, espera o fim do silêncio
//   info      só na central e no Hoje, sem contar como urgente; some no fim da noite e cada
//             pessoa pode dispensar só para si
import { houseParts, toMinutes } from "../../lib/dates.js";

export const LEVELS = {
  critical: { label: "crítico", order: 0 },
  important: { label: "importante", order: 1 },
  info: { label: "informativo", order: 2 },
};

const ALL = ["owner", "manager", "floor"];
const MGMT = ["owner", "manager"];
const OWNER = ["owner"];

/**
 * Cada aviso:
 *   level    critical | important | info
 *   title    nome curto (a faixa crítica e a central usam)
 *   to       perfis que recebem por padrão
 *   setting  a lista de Configurações › Avisos que troca o padrão por pessoas escolhidas
 *   clears   quando some, em palavras da casa
 *   action   o botão que leva a resolver
 *   resolve  "manual" quando quem recebe pode marcar como resolvido para todos
 *   hoje     aparece também em "Precisa de atenção" do Hoje
 *   origin   server (a casa cria e guarda) ou device (o próprio aparelho percebe e mostra)
 */
export const NOTICES = {
  // ---- críticos ------------------------------------------------------------------------
  whatsapp_down: { level: "critical", title: "WhatsApp da casa fora do ar", to: ALL, setting: null, clears: "quando o WhatsApp volta", action: "Ver o sistema", path: "/admin/sistema", hoje: false, origin: "server" },
  whatsapp_blocked: { level: "critical", title: "Envio de mensagens bloqueado", to: MGMT, setting: "system_to", clears: "quando a Meta libera o envio", action: "Ver o sistema", path: "/admin/sistema", hoje: false, origin: "server" },
  queue_stuck: { level: "critical", title: "Fila de mensagens parada", to: OWNER, setting: "system_to", clears: "quando a fila volta a andar", action: "Ver o sistema", path: "/admin/sistema", hoje: false, origin: "server" },
  pending_expiring: { level: "critical", title: "Pedido para aprovar vencendo", to: MGMT, setting: "pending_to", clears: "quando alguém aprova, recusa ou o pedido vence", action: "Aprovar", hoje: false, origin: "server" },
  pin_locked: { level: "critical", title: "PIN travado", to: OWNER, setting: "security_to", clears: "quando o PIN destrava", action: "Ver a equipe", path: "/admin/equipe", hoje: true, origin: "server" },
  device_key_lost: { level: "critical", title: "Aparelho perdeu a chave", to: OWNER, setting: "security_to", clears: "quando o dono aprova o aparelho de novo", action: "Ver aparelhos", path: "/admin/configuracoes/aparelhos-e-impressoras", hoje: true, origin: "server" },
  night_not_closed: { level: "critical", title: "Noite sem fechar", to: MGMT, setting: null, clears: "quando a noite é fechada", action: "Fechar a noite", hoje: true, origin: "server" },
  offline_server: { level: "critical", title: "Sistema da casa fora", to: ALL, setting: null, clears: "quando a conexão com a casa volta", action: "Imprimir a folha", path: "/admin/salao/folha", hoje: false, origin: "device" },
  offline_panel: { level: "critical", title: "Aparelho sem conexão", to: ALL, setting: null, clears: "quando a internet do aparelho volta", action: "Imprimir a folha", path: "/admin/salao/folha", hoje: false, origin: "device" },

  // ---- importantes ---------------------------------------------------------------------
  pending_request: { level: "important", title: "Pedido para aprovar", to: MGMT, setting: "pending_to", clears: "quando alguém aprova, recusa ou o pedido vence", action: "Aprovar", hoje: false, origin: "server" },
  late_request: { level: "important", title: "Pedido em cima da hora", to: MGMT, setting: "late_request_to", clears: "quando passa o horário da reserva", action: "Ver a reserva", hoje: false, origin: "server" },
  privacy_request: { level: "important", title: "Pedido de dados de cliente", to: OWNER, setting: "privacy_request_to", clears: "quando o pedido é atendido", action: "Ver os pedidos", path: "/admin/clientes/pedidos", hoje: false, origin: "server" },
  privacy_request_due: { level: "important", title: "Pedido de dados perto do prazo", to: OWNER, setting: "privacy_request_to", clears: "quando o pedido é atendido", action: "Ver os pedidos", path: "/admin/clientes/pedidos", hoje: true, origin: "server" },
  message_failed: { level: "important", title: "Mensagem ao cliente não chegou", to: ALL, setting: null, clears: "quando a mensagem sai de novo ou a noite acaba", action: "Ver a reserva", hoje: true, origin: "server" },
  message_held: { level: "important", title: "Mensagem segurada pelo limite do dia", to: MGMT, setting: "system_to", clears: "quando a mensagem sai ou vence", action: "Ver a reserva", hoje: true, origin: "server" },
  meta_limit: { level: "important", title: "Mensagens do dia em 80% do limite", to: OWNER, setting: "system_to", clears: "na virada do dia", action: "Ver o sistema", path: "/admin/sistema", hoje: false, origin: "server" },
  google_failed: { level: "important", title: "Google com problema", to: OWNER, setting: "system_to", clears: "quando o Google volta a receber", action: "Ver o Google", path: "/admin/configuracoes/google", hoje: false, origin: "server" },
  google_disconnect: { level: "important", title: "Conta Google desligada", to: OWNER, setting: "system_to", clears: "quando a conta é ligada de novo", action: "Ver o Google", path: "/admin/configuracoes/google", hoje: false, origin: "server" },
  offer_failed: { level: "important", title: "Oferta da espera não entregue", to: ALL, setting: null, clears: "quando a oferta é feita à mão ou vence", action: "Ver a espera", path: "/admin/espera", hoje: false, origin: "server" },
  device_pending: { level: "important", title: "Aparelho novo pedindo entrada", to: OWNER, setting: "security_to", clears: "quando o dono aprova ou recusa", action: "Ver aparelhos", path: "/admin/configuracoes/aparelhos-e-impressoras", hoje: false, origin: "server" },
  paper_correction: { level: "important", title: "Anotação do papel para lançar", to: MGMT, setting: null, clears: "quando alguém lança ou descarta", action: "Ver a anotação", hoje: true, origin: "server" },
  reminder_failed: { level: "important", title: "Lembrete não saiu", to: MGMT, setting: null, clears: "quando o lembrete sai ou a noite acaba", action: "Ver o sistema", path: "/admin/sistema", resolve: "manual", hoje: true, origin: "server" },
  no_show_review: { level: "important", title: "\"Não veio\" para conferir", to: MGMT, setting: null, clears: "quando acaba o prazo de desfazer ou alguém marca como resolvido", action: "Conferir", resolve: "manual", hoje: true, origin: "server" },
  outage_review: { level: "important", title: "Noite com queda para conferir", to: MGMT, setting: null, clears: "quando alguém confere as chegadas", action: "Conferir", resolve: "manual", hoje: true, origin: "server" },
  night_closing: { level: "important", title: "A noite vai fechar com mesas abertas", to: ALL, setting: null, clears: "quando as mesas fecham ou a noite fecha", action: "Ver o salão", path: "/admin/salao", hoje: true, origin: "server" },
  backup_failed: { level: "important", title: "Cópia de segurança falhou", to: OWNER, setting: "system_to", clears: "quando a próxima cópia dá certo", action: "Ver o sistema", path: "/admin/sistema", hoje: false, origin: "server" },
  system_errors: { level: "important", title: "Erros repetidos no sistema", to: OWNER, setting: "system_to", clears: "quando passa uma hora sem erro", action: "Ver o sistema", path: "/admin/sistema", hoje: false, origin: "server" },
  codes_not_arriving: { level: "important", title: "Códigos não estão chegando", to: MGMT, setting: "system_to", clears: "quando os códigos voltam a ser confirmados", action: "Ver o sistema", path: "/admin/sistema", hoje: false, origin: "server" },
  whatsapp_quality: { level: "important", title: "Qualidade do número caiu", to: OWNER, setting: "system_to", clears: "quando a Meta volta a qualidade", action: "Ver o sistema", path: "/admin/sistema", hoje: false, origin: "server" },
  site_build_failed: { level: "important", title: "Publicação do site falhou", to: MGMT, setting: null, clears: "quando o site é publicado", action: "Ver o site", path: "/admin/site", hoje: false, origin: "server" },
  email_failed: { level: "important", title: "E-mail da conta não saiu", to: OWNER, setting: "system_to", clears: "quando o e-mail sai", action: "Ver o sistema", path: "/admin/sistema", hoje: false, origin: "server" },
  email_quota: { level: "important", title: "E-mails do mês acabaram", to: OWNER, setting: "system_to", clears: "na virada do mês", action: "Ver o sistema", path: "/admin/sistema", hoje: false, origin: "server" },
  template_rejected: { level: "important", title: "Meta recusou um modelo", to: OWNER, setting: null, clears: "quando o texto novo é aprovado", action: "Ver as mensagens", path: "/admin/configuracoes/mensagens", hoje: false, origin: "server" },
  offline_backlog: { level: "important", title: "Lançar o que foi anotado no papel", to: ALL, setting: null, clears: "quando alguém dispensa neste aparelho", action: "Ver o salão", path: "/admin/salao", hoje: false, origin: "device" },
  clock_skew: { level: "important", title: "Relógio do aparelho errado", to: ALL, setting: null, clears: "quando o relógio é acertado", action: "", hoje: false, origin: "device" },

  // ---- informativos --------------------------------------------------------------------
  large_group: { level: "info", title: "Grupo grande", to: ALL, setting: null, clears: "no fim da noite", action: "Ver a reserva", hoje: true, origin: "server" },
  birthday: { level: "info", title: "Aniversário", to: ALL, setting: null, clears: "no fim da noite", action: "Ver a reserva", hoje: true, origin: "server" },
  dietary: { level: "info", title: "Restrição alimentar", to: ALL, setting: null, clears: "no fim da noite", action: "Ver a reserva", hoje: true, origin: "server" },
  without_table: { level: "info", title: "Reserva sem mesa", to: ALL, setting: null, clears: "quando a reserva ganha mesa", action: "Ver a reserva", hoje: true, origin: "server" },
  no_reply: { level: "info", title: "Cliente não respondeu", to: ALL, setting: null, clears: "quando o cliente responde ou a noite acaba", action: "Ver a reserva", hoje: true, origin: "server" },
  print_sheet: { level: "info", title: "Imprimir a folha da noite", to: ALL, setting: null, clears: "quando alguém imprime a folha", action: "Imprimir a folha", path: "/admin/salao/folha", hoje: true, origin: "server" },
  onboarding: { level: "info", title: "Falta no primeiro uso", to: OWNER, setting: null, clears: "quando o passo é feito", action: "Resolver", hoje: true, origin: "server" },
  waitlist_full: { level: "info", title: "Espera cheia num horário", to: ALL, setting: null, clears: "quando a fila abre vaga", action: "Ver a espera", path: "/admin/espera", hoje: false, origin: "server" },
  template_pending: { level: "info", title: "Modelo esperando a Meta", to: OWNER, setting: null, clears: "quando a Meta responde", action: "Ver as mensagens", path: "/admin/configuracoes/mensagens", hoje: false, origin: "server" },
  restore_late: { level: "info", title: "Teste de restauração atrasado", to: OWNER, setting: "system_to", clears: "quando o próximo teste roda", action: "Ver o sistema", path: "/admin/sistema", hoje: false, origin: "server" },
  alerts_handed: { level: "info", title: "Avisos passaram para você", to: OWNER, setting: null, clears: "quando o dono escolhe outra pessoa", action: "Ver os avisos", path: "/admin/configuracoes/avisos", hoje: false, origin: "server" },
  sheet_changes: { level: "info", title: "Mudanças desde a folha", to: ALL, setting: null, clears: "quando a folha é impressa de novo", action: "Imprimir a folha", path: "/admin/salao/folha", hoje: false, origin: "device" },
  realtime_lost: { level: "info", title: "Atualização ao vivo pausada", to: ALL, setting: null, clears: "quando a conexão ao vivo volta", action: "", hoje: false, origin: "device" },
};

/** Nomes antigos que a demonstração pode ter guardado (até a versão 7 dos dados). */
export const RENAMED = { night_outage: "outage_review" };

export const codeOf = (code) => RENAMED[code] || code;
export const noticeOf = (code) => NOTICES[codeOf(code)] || null;
export const levelOf = (code) => noticeOf(code)?.level || "info";
export const titleOf = (code) => noticeOf(code)?.title || "Aviso";

/** O código de um id de aviso ("pin_locked:abc" → "pin_locked"). */
export const codeOfId = (id) => codeOf(String(id || "").split(":")[0]);

/** Só o crítico fura o silêncio da noite. */
export const breaksSilence = (code) => levelOf(code) === "critical";

/** Ninguém desliga um crítico; o resto cada pessoa escolhe seguir ou não em "Meus avisos". */
export const canMute = (code) => Boolean(noticeOf(code)) && levelOf(code) !== "critical";

/** "Dispensar só para mim": só o informativo. */
export const canDismissForMe = (code) => levelOf(code) === "info";

/** "Marcar como resolvido" para todos: o que não tem como sumir sozinho; nunca um crítico. */
export const canResolve = (code) => levelOf(code) !== "critical" && noticeOf(code)?.resolve === "manual";

/**
 * Se esta pessoa recebe o aviso. A lista escolhida pelo dono em Configurações › Avisos manda
 * quando existe e tem alguém; senão vale o perfil padrão do catálogo. Sem ninguém para receber,
 * o aviso vai ao dono (nenhum aviso fica sem quem veja).
 * @param {string} code
 * @param {{id?: string, role: string}} user
 * @param {Record<string, any>} [settings] os dados do grupo `alerts`
 */
export function receives(code, user, settings = {}) {
  const n = noticeOf(code);
  if (!n || !user) return false;
  const chosen = n.setting ? settings?.[n.setting] : null;
  if (Array.isArray(chosen)) return chosen.length ? chosen.includes(user.id) : user.role === "owner";
  return n.to.includes(user.role);
}

/** Os códigos que um perfil recebe por padrão (a tela de preferências mostra só esses). */
export const codesFor = (role) => Object.keys(NOTICES).filter((code) => NOTICES[code].to.includes(role) && NOTICES[code].origin === "server");

/** Se o minuto do dia (0–1439) cai no silêncio (de `from` a `to`, podendo passar da meia-noite). */
export function inQuiet(minutes, quiet = {}) {
  const from = toMinutes(quiet.from || quiet.quiet_from || "01:00");
  const to = toMinutes(quiet.to || quiet.quiet_to || "09:00");
  if (from === to) return false;
  return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

/** O começo do silêncio em curso (instante), ou null fora dele. */
export function quietStart(now, quiet = {}) {
  const at = new Date(now);
  const parts = houseParts(at);
  if (!inQuiet(parts.minutes, quiet)) return null;
  const from = toMinutes(quiet.from || quiet.quiet_from || "01:00");
  const back = (parts.minutes - from + 24 * 60) % (24 * 60);
  // o minuto cheio de agora, menos o que já passou do silêncio
  return new Date(at.getTime() - (at.getTime() % 60_000) - back * 60_000);
}

/**
 * Se o aviso espera o fim do silêncio: não crítico, nascido dentro do silêncio em curso. Ele fica
 * na central (aba "Tudo"), mas não conta no sino nem é anunciado até o silêncio acabar.
 */
export function isSilenced(code, bornAt, now, quiet = {}) {
  if (breaksSilence(code)) return false;
  const start = quietStart(now, quiet);
  return Boolean(start) && new Date(bornAt || now).getTime() >= start.getTime();
}

/**
 * O estado de um aviso para uma pessoa, a partir do que a casa guardou dele e do que ela fez.
 * @param {{resolved_at?: string|null, read_at?: string|null, dismissed_at?: string|null, muted?: boolean, silenced?: boolean}} n
 */
export function stateOf(n) {
  if (n.resolved_at) return "resolved";
  if (n.dismissed_at) return "dismissed";
  return "active";
}

/** Conta no sino: ativo, não lido, não desligado pela pessoa e fora do silêncio (crítico sempre conta). */
export function countsInBell(n) {
  if (stateOf(n) !== "active" || n.read_at) return false;
  if (levelOf(n.kind) === "critical") return true;
  return !n.muted && !n.silenced;
}

/** As três abas da central. */
export const TABS = [
  { key: "agir", label: "Para agir" },
  { key: "tudo", label: "Tudo" },
  { key: "resolvidos", label: "Resolvidos" },
];

/** Os avisos de uma aba, do mais urgente ao menos, e do mais novo ao mais antigo. */
export function inTab(list, tab) {
  const pick = {
    agir: (n) => stateOf(n) === "active" && levelOf(n.kind) !== "info" && (!n.muted || levelOf(n.kind) === "critical"),
    tudo: (n) => stateOf(n) === "active",
    resolvidos: (n) => stateOf(n) !== "active",
  }[tab] || (() => false);
  return list.filter(pick).sort((a, b) => LEVELS[levelOf(a.kind)].order - LEVELS[levelOf(b.kind)].order || String(b.at || "").localeCompare(String(a.at || "")));
}
