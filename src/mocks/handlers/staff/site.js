// Os blocos de texto do site, a tarefa de publicação e os números do site (histórias 4.14, 4.15).
// /staff/site/stats responde números de exemplo para a demonstração.
// Também as funções de apoio que as rotas de Cardápio e Galeria usam: quem está dentro, o registro de ações no
// formato que o Registro lê (defeito 14), a versão lida (o cabeçalho If-Match que client.js manda;
// ?if_match= ainda é aceito) e as chaves da demonstração:
//   ?conflito=1        o próximo salvamento encontra antes o salvamento de outra pessoa (412, uma vez por aba)
//   ?publicacao=falha  as publicações desta aba falham (site_build_failed); =ok desfaz
//   ?mock=erro         a publicação também falha, e a situação dela ainda responde (história 4.12)
import { delay, http, HttpResponse } from "msw";
import { addDays, houseParts, weekdayOf } from "../../../lib/dates.js";
import { session } from "../../../lib/storage.js";
import { uuid } from "../../../lib/uuid.js";
import { lintFields, localizedFields } from "../../../site/lint.js";
import { getState, save } from "../../db.js";
import * as scenario from "../../scenario.js";
import { extend, publicContent } from "../../seeds/site.js";

const { currentRole, currentScenario, mockNow, problem, respond } = scenario;
const API = "/api/v1";
const BLOCKS = ["cover", "about", "notices", "today", "links", "seo"];
const BLOCK_LABEL = { cover: "Capa", about: "A casa", notices: "Avisos", today: "Frases do dia", links: "Links", seo: "Busca (SEO)" };

// Limites de caracteres por campo, os mesmos que o painel mostra. Campos traduzíveis conferem todas as línguas.
const LIMITS = {
  cover: { kicker: 60, hand: 40, lede: 200 },
  about: { text: 200, hand: 40, story_1: 420, story_2: 420 },
  notices: { text: 140 },
  today: { rule: 90, default: 90 },
  links: { instagram: 30, shop: 40, whatsapp_text: 120 },
  seo: { title: 70, description: 160 },
};
const REQUIRED_PT = { cover: ["kicker", "lede"], about: ["text"], seo: ["title", "description"], today: ["default"] };

// ---- quem está dentro, e o registro de ações ----------------------------------------------

/** A pessoa e o aparelho da sessão da equipe (o aparelho da casa tem nome; um acesso pessoal não tem). */
export function staffUser(state) {
  const current = typeof scenario.currentSession === "function" ? scenario.currentSession() : null;
  if (current?.user) return { user: current.user, device: current.device || null };
  const role = currentRole();
  return { user: state.users.find((u) => u.role === role && u.status !== "disabled") || null, device: null };
}

/** Quem está dentro, para "publicado por". */
export function actor(state) {
  return staffUser(state).user?.name || "Equipe";
}

/** 401 quando não há mais ninguém dentro: o painel pede para a pessoa entrar de novo, por cima da tela. */
export const sessionGone = () => problem(401, "session_expired", "Você saiu do painel", { detail: "A entrada da equipe venceu. Entre de novo para gravar." });

const cut = (value) => {
  if (value == null || value === "") return null;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
};

/** Folhas de um valor como { "kicker.pt": "…" }, para o registro poder dizer campo a campo o que mudou. */
function leaves(value, prefix = "", out = {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) leaves(v, prefix ? `${prefix}.${k}` : k, out);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => leaves(v, `${prefix}.${i}`, out));
    if (!value.length) out[prefix] = null;
  } else {
    out[prefix] = value ?? null;
  }
  return out;
}

/** { field: { from, to } } do que é diferente, no máximo 12 campos; ids e campos de controle ficam de fora. */
export function changesOf(before, after, skip = ["id", "version", "sort", "items"]) {
  const a = leaves(before || {});
  const b = leaves(after || {});
  const out = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (skip.some((s) => key === s || key.endsWith(`.${s}`)) || /(^|\.)id$/.test(key)) continue;
    if (JSON.stringify(a[key] ?? null) === JSON.stringify(b[key] ?? null)) continue;
    out[key] = { from: cut(a[key]), to: cut(b[key]) };
    if (Object.keys(out).length >= 12) break;
  }
  return out;
}

/** Uma entrada do registro de ações, do jeito que o Registro lê (occurred_at, actor, device, action, antes e depois). */
export function logAction(state, { action, entity_type, entity_id = null, summary, changes = {} }) {
  const { user, device } = staffUser(state);
  state.audit ??= [];
  state.audit.push({
    id: uuid(),
    occurred_at: mockNow().toISOString(),
    actor_type: "user",
    actor_id: user?.id ?? null,
    actor_label: user?.name ?? "Equipe",
    device_label: device?.name ?? (user?.role === "floor" ? "Computador da recepção" : "Acesso pessoal"),
    action,
    entity_type,
    entity_id,
    summary,
    changes,
  });
}

// ---- versões e o conflito da demonstração ------------------------------------------------

/** A versão que a tela leu: o cabeçalho If-Match (o que client.js manda), ou ?if_match= (ainda aceito). */
export function ifMatchOf(request) {
  return request.headers.get("If-Match") ?? new URL(request.url).searchParams.get("if_match");
}

/** ?conflito=1 na página: o próximo salvamento desta aba encontra antes o salvamento de outra pessoa. */
export function conflictWanted(key) {
  const flag = `territorio:mock-conflito-${key}`;
  if (new URLSearchParams(window.location.search).get("conflito") === "1" && !session.get(`${flag}:usado`)) {
    session.set(`${flag}:usado`, true);
    return true;
  }
  return false;
}

/** O gerente, que "gravou antes" no conflito da demonstração. */
export const otherPerson = (state) => state.users.find((u) => u.role === "manager")?.name || "Gerente da casa";

// ---- publicações --------------------------------------------------------------------------

/** A tarefa site_render: uma publicação fica pendente, depois rodando, depois pronta (ou falha de propósito). */
export function requestBuild(state, reason, by) {
  state.site_builds ||= [];
  const asked = new URLSearchParams(window.location.search).get("publicacao");
  if (asked) session.set("territorio:mock-publicacao", asked);
  const failNext = session.get("territorio:mock-publicacao") === "falha" || currentScenario() === "erro";
  const build = { id: uuid(), status: "pending", reason, requested_by: by, requested_at: mockNow().toISOString(), started_at: null, finished_at: null, error: null, real_at: Date.now(), will_fail: failNext };
  state.site_builds.unshift(build);
  state.site_builds = state.site_builds.slice(0, 30);
  return build;
}

/**
 * Publicar com ?mock=erro: a chamada passa e a publicação falha sozinha
 * (site_build_failed), para a tela mostrar "O site não atualizou" em vez de uma chamada quebrada.
 */
export async function respondPublication(handler) {
  if (currentScenario() !== "erro") return respond(handler);
  await delay(250);
  return handler("erro");
}

/** Faz os builds andarem pelo relógio real (o relógio falso do ?agora= fica parado). */
export function settleBuilds(state) {
  let changed = false;
  for (const b of state.site_builds || []) {
    if (b.status !== "pending" && b.status !== "running") continue;
    const elapsed = Date.now() - (b.real_at || 0);
    const at = (ms) => new Date(new Date(b.requested_at).getTime() + ms).toISOString();
    if (elapsed > 1200 && b.status === "pending") {
      Object.assign(b, { status: "running", started_at: at(1200) });
      changed = true;
    }
    if (elapsed > 5000) {
      Object.assign(b, b.will_fail ? { status: "failed", error: "render failed", finished_at: at(elapsed) } : { status: "done", finished_at: at(elapsed) });
      changed = true;
    }
  }
  if (changed) save();
}

export function buildView(build) {
  const out = { ...build };
  delete out.real_at;
  delete out.will_fail;
  return out;
}

function load() {
  const now = mockNow();
  const state = getState(now);
  if (!state.site_blocks) {
    // um banco da simulação gravado antes de esta área existir: acrescenta os dados dela uma vez
    extend(state, now);
    save();
  }
  return state;
}

function view(b) {
  return {
    block: b.block,
    fields: structuredClone(b.draft ?? b.published),
    published_fields: structuredClone(b.published),
    status: b.draft ? "draft" : "published",
    version: b.version,
    // o que a tela manda de volta como If-Match: muda a cada salvamento, restauração e publicação
    etag: String(b.rev ?? b.version),
    published_at: b.published_at,
    published_by: b.published_by,
    draft_saved_at: b.draft ? b.draft_saved_at ?? null : null,
    draft_saved_by: b.draft ? b.draft_saved_by ?? null : null,
  };
}

const bump = (b) => (b.rev = (b.rev ?? b.version) + 1);

const LANG_NAMES = { pt: "português", es: "espanhol", en: "inglês" };

/** Os textos públicos de um bloco como campos de revisão ("lede.pt", "items.0.text.es"…). */
function publicTexts(block, fields) {
  const out = [];
  if (block === "notices") (fields.items || []).forEach((n, i) => out.push(...localizedFields(`items.${i}.text`, `Aviso ${i + 1}`, n.text)));
  else if (block === "today") {
    out.push(...localizedFields("default", "Frase de sempre", fields.default));
    for (const [d, text] of Object.entries(fields.rules || {})) out.push(...localizedFields(`rules.${d}`, "Frase do dia", text));
  } else if (block === "links") out.push({ field: "whatsapp_text", label: "Mensagem pronta", text: fields.whatsapp_text });
  else for (const key of Object.keys(LIMITS[block] || {})) out.push(...localizedFields(key, key, fields[key]));
  return out;
}

/** Erros 422 do bloco, como [{ field: "kicker.pt", message }]: limites, português, as palavras da casa. */
function validate(block, fields) {
  const errors = [];
  const limits = LIMITS[block];
  const check = (path, value, max, requiredPt = false) => {
    if (value && typeof value === "object") {
      for (const lang of ["pt", "es", "en"]) {
        const text = value[lang] || "";
        if (text.length > max) errors.push({ field: `${path}.${lang}`, message: `Passou de ${max} caracteres em ${LANG_NAMES[lang]}.` });
      }
      if (requiredPt && !String(value.pt || "").trim()) errors.push({ field: `${path}.pt`, message: "Escreva em português: é a língua que o site usa quando falta tradução." });
    } else if (typeof value === "string" && value.length > max) {
      errors.push({ field: path, message: `Passou de ${max} caracteres.` });
    }
  };
  if (block === "notices") {
    (fields.items || []).forEach((n, i) => {
      check(`items.${i}.text`, n.text, limits.text, true);
      if (!n.starts_on || !n.ends_on) errors.push({ field: `items.${i}.dates`, message: "Diga quando o aviso começa e quando termina." });
      else if (n.ends_on < n.starts_on) errors.push({ field: `items.${i}.dates`, message: "O fim vem antes do começo. Confira as datas." });
    });
  } else if (block === "today") {
    for (const [d, text] of Object.entries(fields.rules || {})) check(`rules.${d}`, text, limits.rule);
    check("default", fields.default, limits.default, true);
  } else {
    for (const [key, max] of Object.entries(limits)) check(key, fields[key], max, REQUIRED_PT[block]?.includes(key));
  }
  if (block === "links" && fields.instagram && !/^[a-z0-9._]+$/i.test(fields.instagram.replace(/^@/, ""))) {
    errors.push({ field: "instagram", message: "Só letras, números, ponto e sublinhado, sem espaço." });
  }
  // a revisão de conteúdo do build (NFR-34): as mesmas palavras nunca chegam ao site
  for (const e of lintFields(publicTexts(block, fields))) if (!errors.some((x) => x.field === e.field)) errors.push({ field: e.field, message: e.message });
  return errors;
}

/** Outra pessoa grava o bloco antes (o ?conflito=1 da demonstração): uma mudança pequena e com cara de real. */
function otherPersonSaves(state, b) {
  const fields = structuredClone(b.draft ?? b.published);
  const tweak = {
    cover: () => (fields.hand = { ...fields.hand, pt: "Pode entrar, a casa é sua!" }),
    about: () => (fields.hand = { ...fields.hand, pt: "Se aprochegue, vivente!" }),
    notices: () => fields.items?.[0] && (fields.items[0].ends_on = addDays(fields.items[0].ends_on, 1)),
    today: () => (fields.default = { ...fields.default, pt: "Casa aberta de quarta a sábado, das 19h às 23h30." }),
    links: () => (fields.whatsapp_text = "Oi! Quero reservar uma mesa no Território, por favor."),
    seo: () => (fields.description = { ...fields.description, pt: `${fields.description?.pt || ""} Reserve pelo site.`.trim() }),
  }[b.block];
  tweak?.();
  b.draft = fields;
  b.draft_saved_at = new Date(mockNow().getTime() - 60_000).toISOString();
  b.draft_saved_by = otherPerson(state);
  bump(b);
}

const forbidden = () => problem(403, "forbidden", "Essa parte é de outro perfil da equipe", { detail: "Só o dono e o gerente mudam o site." });
const unknown = () => problem(404, "not_found", "Esse bloco não existe");

// números de exemplo: noites abertas (quarta a sábado) trazem mais visitas
function stats(now) {
  const today = houseParts(now).date;
  const seed = Number(today.replace(/-/g, "")) % 97;
  const days = Array.from({ length: 28 }, (_, i) => {
    const date = addDays(today, i - 27);
    const wd = weekdayOf(date);
    const base = wd >= 3 && wd <= 6 ? 260 : wd === 0 ? 120 : 95;
    const visits = base + ((seed * (i + 3) * 37) % 90) + (wd === 5 || wd === 6 ? 80 : 0);
    return { date, visits, reservations: Math.round(visits * (wd >= 3 && wd <= 6 ? 0.045 : 0.02)) };
  });
  const sum = (list, key) => list.reduce((s, d) => s + d[key], 0);
  const week = days.slice(-7);
  const before = days.slice(-14, -7);
  return {
    example: true,
    period: { from: week[0].date, to: today },
    visits: sum(week, "visits"),
    visits_before: sum(before, "visits"),
    visitors: Math.round(sum(week, "visits") * 0.71),
    reservations: sum(week, "reservations"),
    reservations_before: sum(before, "reservations"),
    menu_views: Math.round(sum(week, "visits") * 0.38),
    days,
    pages: [
      { path: "/", label: "Início", views: Math.round(sum(week, "visits") * 0.92) },
      { path: "/cardapio", label: "Cardápio", views: Math.round(sum(week, "visits") * 0.38) },
      { path: "/reservar", label: "Reservar", views: Math.round(sum(week, "visits") * 0.21) },
      { path: "/es/", label: "Início em espanhol", views: Math.round(sum(week, "visits") * 0.17) },
      { path: "/privacidade", label: "Privacidade", views: Math.round(sum(week, "visits") * 0.02) },
    ],
    languages: [
      { lang: "pt", share: 0.72 },
      { lang: "es", share: 0.22 },
      { lang: "en", share: 0.06 },
    ],
    sources: [
      { source: "Instagram", share: 0.46 },
      { source: "Google", share: 0.29 },
      { source: "Direto ou QR da mesa", share: 0.17 },
      { source: "WhatsApp", share: 0.08 },
    ],
  };
}

export const handlers = [
  http.get(`${API}/staff/content`, () =>
    respond((scenario) => {
      const state = load();
      if (scenario === "vazio") return HttpResponse.json([]);
      return HttpResponse.json(BLOCKS.map((key) => view(state.site_blocks[key])));
    }),
  ),

  http.put(`${API}/staff/content/:block`, async ({ params, request }) => {
    const body = await request.json().catch(() => ({}));
    const ifMatch = ifMatchOf(request);
    const conflict = conflictWanted("site");
    return respond(() => {
      if (!currentRole()) return sessionGone();
      if (currentRole() === "floor") return forbidden();
      const state = load();
      const b = state.site_blocks[params.block];
      if (!b) return unknown();
      if (conflict) otherPersonSaves(state, b);
      if (ifMatch != null && ifMatch !== String(b.rev ?? b.version)) {
        save();
        return problem(412, "precondition_failed", "Outra pessoa gravou antes", { detail: `${b.draft_saved_by || "Outra pessoa"} gravou este bloco enquanto você editava.`, current: view(b) });
      }
      const fields = body?.fields;
      if (!fields || typeof fields !== "object") return problem(422, "validation", "Falta ajeitar alguns campos", { errors: [{ field: "fields", message: "Nada para gravar." }] });
      const errors = validate(params.block, fields);
      if (errors.length) return problem(422, "validation", "Falta ajeitar alguns campos", { errors });
      const before = b.draft ?? b.published;
      const same = JSON.stringify(fields) === JSON.stringify(b.published);
      b.draft = same ? null : structuredClone(fields);
      b.draft_saved_at = mockNow().toISOString();
      b.draft_saved_by = actor(state);
      bump(b);
      logAction(state, {
        action: "content.save",
        entity_type: "content",
        entity_id: b.block,
        summary: same ? `Site · ${BLOCK_LABEL[b.block]}: voltou ao que está no ar` : `Site · ${BLOCK_LABEL[b.block]}: rascunho salvo`,
        changes: changesOf(before, fields),
      });
      save();
      return HttpResponse.json(view(b));
    });
  }),

  http.post(`${API}/staff/content/:block/publish`, ({ params }) =>
    respondPublication(() => {
      if (!currentRole()) return sessionGone();
      if (currentRole() === "floor") return forbidden();
      const state = load();
      const b = state.site_blocks[params.block];
      if (!b) return unknown();
      if (b.draft) {
        const errors = validate(params.block, b.draft);
        if (errors.length) return problem(422, "validation", "Falta ajeitar alguns campos antes de publicar", { errors });
        const by = actor(state);
        const at = mockNow().toISOString();
        const before = b.published;
        b.version += 1;
        b.published = b.draft;
        b.draft = null;
        Object.assign(b, { published_at: at, published_by: by });
        bump(b);
        b.history.push({ version: b.version, fields: structuredClone(b.published), published_at: at, published_by: by });
        state.content = publicContent(state.site_blocks, state.content);
        requestBuild(state, `content:${params.block}`, by);
        logAction(state, {
          action: "content.publish",
          entity_type: "content",
          entity_id: b.block,
          summary: `Publicou no site: ${BLOCK_LABEL[b.block]} (versão ${b.version})`,
          changes: changesOf(before, b.published),
        });
        save();
      }
      return HttpResponse.json(view(b));
    }),
  ),

  http.get(`${API}/staff/content/:block/versions`, ({ params }) =>
    respond(() => {
      const state = load();
      const b = state.site_blocks[params.block];
      if (!b) return unknown();
      return HttpResponse.json(
        [...b.history].reverse().map((v) => ({ block: b.block, fields: v.fields, status: "published", version: v.version, published_at: v.published_at, published_by: v.published_by })),
      );
    }),
  ),

  http.post(`${API}/staff/content/:block/restore`, async ({ params, request }) => {
    const body = await request.json().catch(() => ({}));
    return respond(() => {
      if (!currentRole()) return sessionGone();
      if (currentRole() === "floor") return forbidden();
      const state = load();
      const b = state.site_blocks[params.block];
      if (!b) return unknown();
      const version = b.history.find((v) => v.version === Number(body?.version));
      if (!version) return problem(404, "not_found", "Essa versão não existe mais");
      const before = b.draft ?? b.published;
      const same = JSON.stringify(version.fields) === JSON.stringify(b.published);
      b.draft = same ? null : structuredClone(version.fields);
      b.draft_saved_at = mockNow().toISOString();
      b.draft_saved_by = actor(state);
      bump(b);
      logAction(state, {
        action: "content.restore",
        entity_type: "content",
        entity_id: b.block,
        summary: `Site · ${BLOCK_LABEL[b.block]}: a versão ${version.version} voltou como rascunho`,
        changes: changesOf(before, version.fields),
      });
      save();
      return HttpResponse.json(view(b));
    });
  }),

  http.get(`${API}/staff/site/builds`, ({ request }) =>
    respondPublication((scenario) => {
      if (currentRole() === "floor") return forbidden();
      const state = load();
      if (scenario === "vazio") return HttpResponse.json([]);
      settleBuilds(state);
      const limit = Math.min(50, Number(new URL(request.url).searchParams.get("limit")) || 10);
      const list = [...(state.site_builds || [])].sort((a, b) => b.requested_at.localeCompare(a.requested_at));
      return HttpResponse.json(list.slice(0, limit).map(buildView));
    }),
  ),

  // a aba "Números" da área Site
  http.get(`${API}/staff/site/stats`, () =>
    respond((scenario) => {
      if (currentRole() === "floor") return forbidden();
      const now = mockNow();
      if (scenario === "vazio") return HttpResponse.json({ example: true, visits: 0, visits_before: 0, visitors: 0, reservations: 0, reservations_before: 0, menu_views: 0, days: [], pages: [], languages: [], sources: [] });
      return HttpResponse.json(stats(now));
    }),
  ),
];
