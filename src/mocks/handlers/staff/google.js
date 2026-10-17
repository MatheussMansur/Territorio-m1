// A conta Google da casa (história 2.22, FR-84, FR-85), só o dono: conectar depois da
// autorização simulada do Google, escolher (ou criar) a agenda e a pasta do Drive, ligar
// ou desligar cada parte, e desconectar. A agenda simulada é recalculada a partir das reservas
// a cada leitura, então sempre bate com elas: cada reserva confirmada ou pendente dos próximos 30
// dias é um evento, com primeiro nome, pessoas, mesa, código e o link do painel, nunca o telefone
// nem a restrição alimentar. Nenhuma destas rotas está no contrato ainda:
//   GET/PUT/DELETE /staff/integrations/google, GET /staff/integrations/google/calendars,
//   GET /staff/integrations/google/folders, GET /staff/integrations/google/events
import { http, HttpResponse } from "msw";
import { addDays, houseParts } from "../../../lib/dates.js";
import { session } from "../../../lib/storage.js";
import { uuid } from "../../../lib/uuid.js";
import { getState, save } from "../../db.js";
import { currentRole, mockNow, problem, respond } from "../../scenario.js";
import { blankGoogle } from "../../seeds/google.js";

const API = "/api/v1";
// a mesma janela de 5 minutos que POST /staff/auth/reauth abre (Configurações)
const REAUTH_KEY = "territorio:mock-reauth";
const SCOPES = { calendar: "calendar.events", drive: "drive.file" };
const DEFAULT_CALENDAR = "Reservas · Território";
const DEFAULT_FOLDER = "Território · Sistema";
const SYNCED = new Set(["confirmed", "pending"]);
const WINDOW_DAYS = 30;
const NEVER_SENT = ["telefone", "restrição alimentar", "sobrenome", "notas da casa"];

const forbidden = () => problem(403, "forbidden", "Essa parte é só do dono");
// 403, não 401: um 401 encerraria a sessão do painel
const reauthRequired = () => problem(403, "reauth_required", "Confirme que é você", { detail: "Digite sua senha e o código para desligar." });
const reauthOk = () => {
  const at = session.get(REAUTH_KEY);
  return typeof at === "number" && Date.now() - at < 5 * 60_000;
};

function load() {
  const now = mockNow();
  const state = getState(now);
  // um banco gravado antes de esta história existir ganha a conta em branco agora
  if (!state.google) {
    state.google = blankGoogle();
    save();
  }
  // o ?google=falha da demonstração mostra um envio que falhou; ?google=ok limpa
  const flag = new URLSearchParams(window.location.search).get("google");
  if (flag === "falha" && state.google.connected && !state.google.problem) {
    state.google.problem = "O Google não respondeu na última tentativa. O sistema tenta de novo a cada 5 minutos; 2 mudanças esperando.";
    save();
  } else if (flag === "ok" && state.google.problem) {
    state.google.problem = null;
    save();
  }
  return { state, now, g: state.google };
}

const userOf = (state) => state.users?.find((u) => u.role === currentRole() && u.status === "active") || state.users?.find((u) => u.role === "owner");
const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "Cliente";

function audit(state, now, action, summary, changes = {}) {
  state.audit = state.audit || [];
  state.audit.unshift({
    id: uuid(),
    occurred_at: now.toISOString(),
    actor_type: "user",
    actor_label: userOf(state)?.name || "Dono",
    action: `settings.${action}`,
    entity_type: "settings",
    entity_id: "google",
    summary,
    changes,
  });
}

// ---- a agenda simulada -------------------------------------------------------------------

/** Uma reserva como o evento que a agenda guarda: só o que a casa escolheu mandar. */
function eventOf(state, r) {
  const customer = state.customers?.find((c) => c.id === r.customer_id);
  const name = firstName(customer?.name || r.customer?.name);
  const tables = (r.table_codes || []).join(" + ");
  const people = `${r.party_size} ${r.party_size === 1 ? "pessoa" : "pessoas"}`;
  const link = `${window.location.origin}/admin/reservas/${r.id}`;
  return {
    id: `ev-${r.id}`,
    reservation_id: r.id,
    title: `${r.status === "pending" ? "(pendente) " : ""}${name} · ${people}${tables ? ` · mesa ${tables}` : ""}`,
    first_name: name,
    party_size: r.party_size,
    table: tables || null,
    code: r.code,
    link,
    status: r.status === "pending" ? "tentative" : "confirmed",
    date: r.date,
    time: r.time,
    starts_at: r.starts_at,
    ends_at: r.ends_at,
    description: `Código ${r.code}\nAbrir no painel: ${link}`,
  };
}

/** Os eventos que a agenda deveria ter agora: confirmados ou pendentes, de hoje até 30 dias à frente. */
function expected(state, now) {
  const today = houseParts(now).date;
  const last = addDays(today, WINDOW_DAYS);
  return (state.reservations || [])
    .filter((r) => SYNCED.has(r.status) && r.date >= today && r.date <= last)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .map((r) => eventOf(state, r));
}

const signature = (e) => [e.title, e.starts_at, e.ends_at, e.status].join("|");

/**
 * Acerta a agenda simulada com as reservas: cria, muda e apaga eventos,
 * e anota a hora da última mudança enviada. Sistema lê o resultado por googleItem().
 */
export function syncGoogle(state, now) {
  const g = state.google;
  if (!g?.connected || !g.calendar || !g.calendar_sync) return { created: 0, updated: 0, removed: 0 };
  const before = new Map((g.events || []).map((e) => [e.id, e]));
  const after = expected(state, now);
  const today = houseParts(now).date;
  let created = 0;
  let updated = 0;
  for (const e of after) {
    const old = before.get(e.id);
    if (!old) created += 1;
    else if (signature(old) !== signature(e)) updated += 1;
    before.delete(e.id);
  }
  // o que saiu da lista: canceladas, recusadas ou "não veio" são apagadas; noites passadas simplesmente ficam
  const removed = [...before.values()].filter((e) => e.date >= today).length;
  g.events = after;
  if (created || updated || removed) {
    g.last_sync_at = now.toISOString();
    g.last_change = { created, updated, removed };
  }
  if (!g.last_sync_at) g.last_sync_at = now.toISOString();
  // a folha da noite vai para a pasta todo dia antes de abrir (17h)
  if (g.drive_sync && g.folder && houseParts(now).minutes >= 17 * 60 && !g.files.some((f) => f.night === today)) {
    g.files.unshift({ id: uuid(), name: `Folha da noite ${today.split("-").reverse().join("-")}.pdf`, night: today, kind: "night_sheet", created_at: now.toISOString(), folder: `${g.folder.name}/${today.slice(0, 7)}` });
  }
  return { created, updated, removed };
}

/** A linha do Google em Sistema: ligada, com problema ou não ligada, com a última sincronização. */
export function googleItem(state, now, scenario) {
  const g = state.google;
  const off = (detail) => ({ key: "google", state: "not_connected", checked_at: now.toISOString(), detail });
  if (scenario === "vazio" || !g?.connected) return off("A conta Google da casa ainda não foi ligada. Ligue em Configurações → Integrações.");
  syncGoogle(state, now);
  if (g.problem) return { key: "google", state: "problem", checked_at: g.last_sync_at || now.toISOString(), detail: g.problem };
  if (!g.calendar_sync || !g.calendar) {
    return { key: "google", state: "not_connected", checked_at: g.last_sync_at || now.toISOString(), detail: `Conta ${g.account_email} ligada, mas as reservas não vão para a agenda.` };
  }
  const n = g.events.length;
  return {
    key: "google",
    state: "ok",
    checked_at: g.last_sync_at,
    detail: `Agenda "${g.calendar.name}" em dia: ${n} ${n === 1 ? "reserva" : "reservas"} nos próximos ${WINDOW_DAYS} dias.${g.drive_sync && g.folder ? ` Drive na pasta "${g.folder.name}".` : ""}`,
  };
}

// ---- a resposta ---------------------------------------------------------------------------

function view(state, now, scenario) {
  if (scenario === "vazio") {
    const blank = blankGoogle();
    return publicOf(blank, [], NEVER_SENT);
  }
  syncGoogle(state, now);
  return publicOf(state.google, state.google.events, NEVER_SENT);
}

function publicOf(g, events, neverSent) {
  const sample = events.find((e) => e.table) || events[0] || null;
  return {
    connected: g.connected,
    account_email: g.account_email,
    account_name: g.account_name,
    scopes: g.scopes,
    connected_at: g.connected_at,
    connected_by: g.connected_by,
    calendar: g.calendar,
    folder: g.folder,
    calendar_sync: g.calendar_sync,
    drive_sync: g.drive_sync,
    sync: {
      state: !g.connected ? "not_connected" : g.problem ? "problem" : g.calendar_sync && g.calendar ? "ok" : "not_connected",
      last_sync_at: g.last_sync_at,
      last_change: g.last_change || null,
      detail: g.problem || null,
      events_count: g.calendar_sync ? events.length : 0,
      window_days: WINDOW_DAYS,
      kept_events: g.kept_events || 0,
    },
    sent: ["primeiro nome", "pessoas", "mesa", "código da reserva", "link do painel"],
    never_sent: neverSent,
    preview: sample,
    files: g.files.slice(0, 5),
  };
}

function pick(list, choice, fallbackName) {
  if (!choice) return undefined;
  if (choice.create) return { id: `novo-${uuid().slice(0, 8)}`, name: String(choice.name || fallbackName).slice(0, 80), created: true };
  const found = list.find((x) => x.id === choice.id);
  return found ? { id: found.id, name: found.name, created: false } : null;
}

export const handlers = [
  http.get(`${API}/staff/integrations/google`, () =>
    respond((scenario) => {
      if (currentRole() !== "owner") return forbidden();
      const { state, now } = load();
      const body = view(state, now, scenario);
      save();
      return HttpResponse.json(body);
    }),
  ),

  http.get(`${API}/staff/integrations/google/calendars`, () =>
    respond(() => {
      if (currentRole() !== "owner") return forbidden();
      const { g } = load();
      if (!g.connected) return problem(409, "not_connected", "A conta Google não está ligada");
      return HttpResponse.json(g.account_calendars);
    }),
  ),

  http.get(`${API}/staff/integrations/google/folders`, () =>
    respond(() => {
      if (currentRole() !== "owner") return forbidden();
      const { g } = load();
      if (!g.connected) return problem(409, "not_connected", "A conta Google não está ligada");
      return HttpResponse.json(g.account_folders);
    }),
  ),

  http.get(`${API}/staff/integrations/google/events`, () =>
    respond((scenario) => {
      if (currentRole() !== "owner") return forbidden();
      const { state, now, g } = load();
      if (scenario === "vazio" || !g.connected || !g.calendar_sync) return HttpResponse.json([]);
      syncGoogle(state, now);
      save();
      return HttpResponse.json(g.events);
    }),
  ),

  // conectar (depois da autorização simulada), escolher agenda ou pasta, ligar ou desligar partes
  http.put(`${API}/staff/integrations/google`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    return respond((scenario) => {
      if (currentRole() !== "owner") return forbidden();
      const { state, now, g } = load();
      const who = userOf(state)?.name || "Dono";

      if (!g.connected) {
        const email = String(body?.account_email || "").trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return problem(422, "validation", "Escolha uma conta Google", { errors: [{ field: "account_email", message: "Escolha uma conta Google." }] });
        }
        const scopes = (body.scopes || []).filter((s) => Object.values(SCOPES).includes(s));
        if (!scopes.length) return problem(422, "google_no_scopes", "Sem nenhuma permissão o sistema não tem o que fazer");
        Object.assign(g, {
          connected: true,
          account_email: email,
          account_name: body.account_name || null,
          scopes,
          connected_at: now.toISOString(),
          connected_by: who,
          calendar: null,
          folder: null,
          calendar_sync: false,
          drive_sync: false,
          last_sync_at: null,
          last_change: null,
          problem: null,
          events: [],
          kept_events: 0,
        });
        audit(state, now, "google_connect", `Conta Google da casa ligada: ${email}`, { account_email: { before: null, after: email } });
        save();
        return HttpResponse.json(view(state, now, scenario));
      }

      const changes = {};
      const calendar = pick(g.account_calendars, body.calendar, DEFAULT_CALENDAR);
      const folder = pick(g.account_folders, body.folder, DEFAULT_FOLDER);
      if (calendar === null || folder === null) return problem(422, "validation", "Essa agenda ou pasta não está mais na conta");
      if (calendar && !g.scopes.includes(SCOPES.calendar)) return problem(409, "google_scope_missing", "Falta a permissão da agenda. Ligue a conta de novo.");
      if (folder && !g.scopes.includes(SCOPES.drive)) return problem(409, "google_scope_missing", "Falta a permissão dos arquivos. Ligue a conta de novo.");

      const turningOff = (key) => body[key] === false && g[key] === true;
      if ((turningOff("calendar_sync") || turningOff("drive_sync")) && !reauthOk()) return reauthRequired();

      if (calendar) {
        if (calendar.created && !g.account_calendars.some((c) => c.name === calendar.name)) g.account_calendars.push({ id: calendar.id, name: calendar.name, primary: false });
        changes.calendar = { before: g.calendar?.name || null, after: calendar.name };
        g.calendar = calendar;
        // uma agenda nova começa vazia: os eventos são criados lá de novo
        g.events = [];
        if (body.calendar_sync === undefined && !g.calendar_sync) body.calendar_sync = true;
      }
      if (folder) {
        if (folder.created && !g.account_folders.some((f) => f.name === folder.name)) g.account_folders.push({ id: folder.id, name: folder.name });
        changes.folder = { before: g.folder?.name || null, after: folder.name };
        g.folder = folder;
        if (body.drive_sync === undefined && !g.drive_sync) body.drive_sync = true;
      }
      if (typeof body.calendar_sync === "boolean" && body.calendar_sync !== g.calendar_sync) {
        if (body.calendar_sync && !g.calendar) return problem(422, "validation", "Escolha a agenda antes de ligar");
        changes.calendar_sync = { before: g.calendar_sync, after: body.calendar_sync };
        g.calendar_sync = body.calendar_sync;
        if (!body.calendar_sync) {
          g.kept_events = body.delete_events ? 0 : g.events.length;
          changes.events_deleted = { before: g.events.length, after: body.delete_events ? 0 : g.events.length };
          g.events = [];
        } else {
          g.kept_events = 0;
          g.events = [];
        }
      }
      if (typeof body.drive_sync === "boolean" && body.drive_sync !== g.drive_sync) {
        if (body.drive_sync && !g.folder) return problem(422, "validation", "Escolha a pasta antes de ligar");
        changes.drive_sync = { before: g.drive_sync, after: body.drive_sync };
        g.drive_sync = body.drive_sync;
      }
      if (Object.keys(changes).length) {
        const words = Object.keys(changes)
          .map((k) => ({ calendar: "agenda", folder: "pasta", calendar_sync: body.calendar_sync ? "reservas na Agenda ligadas" : "reservas na Agenda desligadas", drive_sync: body.drive_sync ? "Drive ligado" : "Drive desligado", events_deleted: body.delete_events ? "eventos apagados" : "eventos mantidos" })[k])
          .join(", ");
        const off = changes.calendar_sync?.after === false || changes.drive_sync?.after === false;
        audit(state, now, off ? "google_disconnect" : "google_update", `Conta Google da casa: ${words}`, changes);
      }
      g.last_sync_at = null;
      const out = view(state, now, scenario);
      save();
      return HttpResponse.json(out);
    });
  }),

  // a conta inteira sai; delete_events=true também tira os eventos já criados
  http.delete(`${API}/staff/integrations/google`, ({ request }) =>
    respond(() => {
      if (currentRole() !== "owner") return forbidden();
      const { state, now, g } = load();
      if (!g.connected) return new HttpResponse(null, { status: 204 });
      if (!reauthOk()) return reauthRequired();
      const deleteEvents = new URL(request.url).searchParams.get("delete_events") === "true";
      const email = g.account_email;
      const events = g.events.length;
      const { account_calendars, account_folders } = g;
      state.google = { ...blankGoogle(), account_calendars, account_folders };
      audit(state, now, "google_disconnect", `Conta Google da casa desligada: ${email}${events ? (deleteEvents ? `, ${events} eventos apagados` : `, ${events} eventos ficaram na agenda`) : ""}`, {
        account_email: { before: email, after: null },
        events_deleted: { before: events, after: deleteEvents ? 0 : events },
      });
      save();
      return new HttpResponse(null, { status: 204 });
    }),
  ),
];
