// Os avisos da equipe guardados pela simulação, como o servidor guarda (FR-87): um registro por
// aviso da casa (quando nasceu, quando foi resolvido e por quem) e, por pessoa, o que ela já leu,
// o que dispensou só para si e o que escolheu não seguir. As condições (pedido pendente, PIN
// travado, WhatsApp fora…) são lidas dos dados a cada leitura; o que deixou de valer vira
// "resolvido" sozinho, e o que volta a valer nasce de novo.
import { addDays, houseParts } from "../lib/dates.js";
import { canDismissForMe, canMute, canResolve, codeOf, countsInBell, isSilenced, levelOf, noticeOf, receives } from "../admin/avisos/catalogo.js";

const KEEP_DAYS = 7;

/** O lugar dos avisos nos dados, criado no primeiro uso. */
export function storeOf(state) {
  state.notices ??= {};
  const s = state.notices;
  s.records ??= {};
  s.people ??= {};
  s.prefs ??= {};
  return s;
}

/** As escolhas da pessoa em "Meus avisos": os códigos que ela não segue (nunca um crítico). */
export const mutedOf = (state, userId) => (storeOf(state).prefs[userId]?.muted || []).filter(canMute);

export function setMuted(state, userId, muted) {
  storeOf(state).prefs[userId] = { muted: [...new Set(muted.map(codeOf))].filter(canMute), updated_at: new Date().toISOString() };
}

/** O horário de silêncio da casa (Configurações › Avisos). */
export const quietOf = (state) => {
  const a = state.settings?.alerts?.data || {};
  return { quiet_from: a.quiet_from || "01:00", quiet_to: a.quiet_to || "09:00" };
};

export const alertSettings = (state) => state.settings?.alerts?.data || {};

/**
 * Junta o que vale agora (`active`, já com id, kind e texto, visto por `role`) aos registros: o
 * que é novo nasce, o que sumiu é resolvido pelo sistema, o que voltou nasce de novo. Um aviso
 * resolvido à mão continua resolvido enquanto a condição durar (só volta se acontecer de novo).
 * Diz se algo mudou (só então vale gravar: uma leitura não deve sobrescrever os dados à toa).
 */
export function sync(state, active, role, now) {
  const store = storeOf(state);
  const seen = new Set();
  let changed = false;
  for (const alert of active) {
    const id = alert.id;
    seen.add(id);
    let rec = store.records[id];
    if (rec?.resolved_at && !rec.manual) {
      // aconteceu de novo: um aviso novo, que ninguém leu
      rec = null;
      changed = true;
      for (const person of Object.values(store.people)) delete person[id];
    }
    if (!rec) {
      rec = store.records[id] = { id, kind: codeOf(alert.kind), first_at: alert.at || now.toISOString(), resolved_at: null, resolved_by: null, manual: false, views: {} };
      changed = true;
    }
    const view = { ...alert, kind: codeOf(alert.kind) };
    if (JSON.stringify(rec.views[role]) !== JSON.stringify(view)) changed = true;
    rec.views[role] = view;
  }
  for (const rec of Object.values(store.records)) {
    if (rec.resolved_at || seen.has(rec.id)) continue;
    // só resolve o que o mesmo perfil via (outro perfil pode não receber o aviso)
    if (!rec.views[role]) continue;
    Object.assign(rec, { resolved_at: now.toISOString(), resolved_by: "Sistema", manual: false });
    changed = true;
  }
  // os resolvidos de mais de uma semana saem
  const limit = addDays(houseParts(now).date, -KEEP_DAYS);
  for (const [id, rec] of Object.entries(store.records)) {
    if (rec.resolved_at && houseParts(rec.resolved_at).date < limit) {
      changed = true;
      delete store.records[id];
      for (const person of Object.values(store.people)) delete person[id];
    }
  }
  return changed;
}

/** O aviso como a pessoa vê: o texto do perfil dela e o que ela fez com ele. */
export function personal(state, rec, user, role, now) {
  const view = rec.views[role];
  if (!view) return null;
  const mine = storeOf(state).people[user.id]?.[rec.id] || {};
  const muted = mutedOf(state, user.id).includes(rec.kind);
  const n = noticeOf(rec.kind);
  return {
    ...view,
    kind: rec.kind,
    level: levelOf(rec.kind),
    title: n?.title || "Aviso",
    at: view.at || rec.first_at,
    path: view.path ?? n?.path ?? null,
    path_label: view.path_label ?? n?.action ?? null,
    read_at: mine.read_at ?? null,
    dismissed_at: mine.dismissed_at ?? null,
    resolved_at: rec.resolved_at,
    resolved_by: rec.resolved_by,
    muted,
    silenced: !rec.resolved_at && isSilenced(rec.kind, rec.first_at, now, quietOf(state)),
    can_dismiss: !rec.resolved_at && !mine.dismissed_at && canDismissForMe(rec.kind),
    can_resolve: !rec.resolved_at && canResolve(rec.kind),
  };
}

/** Os avisos desta pessoa: os que ela recebe, ativos e resolvidos da última semana. */
export function listFor(state, user, role, now) {
  const settings = alertSettings(state);
  const who = { id: user.id, role };
  return Object.values(storeOf(state).records)
    .filter((rec) => receives(rec.kind, who, settings))
    .map((rec) => personal(state, rec, user, role, now))
    .filter(Boolean);
}

/** Quantos contam no sino e quantos críticos estão de pé. */
export function countsOf(list) {
  return {
    unread: list.filter(countsInBell).length,
    critical: list.filter((n) => n.level === "critical" && !n.resolved_at).length,
  };
}

export function markRead(state, userId, ids, now) {
  const person = (storeOf(state).people[userId] ??= {});
  for (const id of ids) person[id] = { ...person[id], read_at: person[id]?.read_at || now.toISOString() };
}

export function dismissFor(state, userId, id, now) {
  const person = (storeOf(state).people[userId] ??= {});
  person[id] = { ...person[id], read_at: person[id]?.read_at || now.toISOString(), dismissed_at: now.toISOString() };
}

export function resolveForAll(state, id, by, now) {
  const rec = storeOf(state).records[id];
  if (rec) Object.assign(rec, { resolved_at: now.toISOString(), resolved_by: by, manual: true });
  return rec;
}

/** Se o aviso sai do Hoje desta pessoa: alguém marcou como resolvido, ou ela dispensou só para si. */
export function hiddenFor(state, userId, id) {
  const rec = storeOf(state).records[id];
  return Boolean(rec?.resolved_at && rec.manual) || Boolean(storeOf(state).people[userId]?.[id]?.dismissed_at);
}
