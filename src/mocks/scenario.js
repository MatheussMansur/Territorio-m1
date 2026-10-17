// Como a simulação se comporta agora, para todo estado de tela poder ser visto de propósito:
//   ?mock=lento  respostas lentas (estados de carregamento)
//   ?mock=erro   toda chamada falha (estados de erro)
//   ?mock=vazio  listas vazias, dias lotados (estados vazios)
//   ?mock=fora   o sistema da casa caiu: toda chamada responde 503 (o "sistema fora" do painel)
//   ?agora=2026-10-01T20:40  finge que é esta hora na casa
//   ?papel=dono|gerente|recepcao  uma sessão da equipe com esse perfil, sem entrar (?papel=sair encerra)
//   ?relogio=6  o relógio do aparelho da casa anda 6 min adiantado (-6: atrasado), para ver o aviso do relógio
//   ?inatividade=20  o aparelho da casa trava depois de 20 s sem uso em vez dos minutos dele
// A escolha vale para a aba do navegador (sessionStorage) até ser mudada na barra da demonstração.
//
// A sessão da equipe na simulação, como os cookies da API real: o atalho ?papel= (aba),
// a sessão pessoal (__Host-trt_equipe: a aba, ou 30 dias com "manter conectado") e a
// sessão do aparelho da casa (__Host-trt_aparelho, 12 meses) com a pessoa que entrou pelo PIN.
import { delay, HttpResponse } from "msw";
import { local, session } from "../lib/storage.js";
import { getState } from "./db.js";

const KEY = "territorio:mock-scenario";
const SCENARIOS = ["normal", "lento", "erro", "vazio", "fora"];

export function currentScenario() {
  const fromUrl = new URLSearchParams(window.location.search).get("mock");
  if (fromUrl && SCENARIOS.includes(fromUrl)) {
    session.set(KEY, fromUrl);
    return fromUrl;
  }
  return session.get(KEY, "normal");
}

export function setScenario(name) {
  session.set(KEY, SCENARIOS.includes(name) ? name : "normal");
}

const ROLE_KEY = "territorio:mock-papel";
const ROLES = { dono: "owner", gerente: "manager", recepcao: "floor" };
/** O cookie da sessão pessoal (sessionStorage = até o navegador fechar; localStorage = lembrar). */
export const PERSONAL_COOKIE = "territorio:mock-equipe";
/** O cookie da sessão do aparelho da casa. */
export const DEVICE_COOKIE = "territorio:mock-aparelho";

/** O perfil do atalho ?papel= (owner, manager, floor), ou null. */
export function demoRole() {
  const fromUrl = new URLSearchParams(window.location.search).get("papel");
  if (fromUrl === "sair") {
    session.remove(ROLE_KEY);
    session.remove(PERSONAL_COOKIE);
    local.remove(PERSONAL_COOKIE);
    // só uma vez: com ?papel=sair deixado no endereço, toda chamada seguinte encerraria a entrada que acabou de ser feita
    const url = new URL(window.location.href);
    url.searchParams.delete("papel");
    window.history?.replaceState?.(window.history.state, "", url);
    return null;
  }
  if (fromUrl && Object.hasOwn(ROLES, fromUrl)) {
    session.set(ROLE_KEY, fromUrl);
    return ROLES[fromUrl];
  }
  const saved = session.get(ROLE_KEY);
  return Object.hasOwn(ROLES, saved ?? "") ? ROLES[saved] : null;
}

export function clearDemoRole() {
  session.remove(ROLE_KEY);
}

/** Os dados de entrada da simulação, criados no primeiro uso (um banco gravado antes de eles existirem ganha nessa hora). */
export function authOf(state) {
  state.auth ??= {};
  const auth = state.auth;
  auth.sessions ??= [];
  auth.device_sessions ??= [];
  auth.tokens ??= [];
  auth.credentials ??= {};
  auth.outbox ??= [];
  auth.challenges ??= {};
  auth.failures ??= {};
  return auth;
}

/** O cookie da sessão pessoal deste navegador, ou null. */
export const personalCookie = () => session.get(PERSONAL_COOKIE) ?? local.get(PERSONAL_COOKIE);

/**
 * Quem está dentro, do jeito que o servidor lê os cookies: { kind: "demo"|"personal"|"device", user, role,
 * record, device }. No aparelho da casa, `user` é a pessoa que entrou pelo PIN (null na tela de
 * bloqueio) e `role` é o perfil do aparelho, nunca o perfil mais alto da pessoa.
 */
export function currentSession(now = mockNow()) {
  const role = demoRole();
  const state = getState(now);
  if (role) {
    const user = state.users.find((u) => u.role === role && u.status === "active");
    return user ? { kind: "demo", user, role, record: null, device: null } : null;
  }
  const auth = authOf(state);
  const cookie = personalCookie();
  if (cookie?.id) {
    const record = auth.sessions.find((s) => s.id === cookie.id);
    if (record && !record.ended_at && new Date(record.expires_at) > now) {
      const user = state.users.find((u) => u.id === record.user_id);
      if (user?.status === "active") return { kind: "personal", user, role: user.role, record, device: null };
    }
  }
  // a sessão do aparelho mora com o aparelho (o cookie dele), então outra aba gravando os dados
  // compartilhados nunca derruba ela; o próprio aparelho (aprovado ou revogado) é lido dos dados
  const record = local.get(DEVICE_COOKIE);
  if (record?.device_id && !record.ended_at) {
    const device = (state.devices || []).find((d) => d.id === record.device_id);
    if (device) {
      const person = record.person_id ? state.users.find((u) => u.id === record.person_id) : null;
      const valid = person && person.status === "active" && person.role === record.person_role;
      return { kind: "device", user: valid ? person : null, role: device.role, record, device };
    }
  }
  return null;
}

/** Guarda uma mudança da sessão do aparelho da casa (a pessoa dentro, a última atividade). */
export const saveDeviceRecord = (record) => local.set(DEVICE_COOKIE, record);

/** O perfil da sessão da equipe (owner, manager, floor), ou null quando ninguém está dentro. */
export function currentRole() {
  const current = currentSession();
  return current?.user ? current.role : null;
}

/** O "agora" da casa: hora real, ou a troca pelo ?agora= (hora local da casa, UTC−3). */
export function mockNow() {
  const fake = new URLSearchParams(window.location.search).get("agora") || session.get("territorio:mock-now");
  if (fake) {
    session.set("territorio:mock-now", fake);
    const at = new Date(`${fake.length === 16 ? fake + ":00" : fake}-03:00`);
    if (!Number.isNaN(at.getTime())) return at;
  }
  return new Date();
}

/** Verdadeiro enquanto ?agora= mexe no relógio da casa: aí o relógio deste aparelho não é o da casa. */
export const mockNowIsFake = () => Boolean(new URLSearchParams(window.location.search).get("agora") || session.get("territorio:mock-now"));

export function clearMockNow() {
  session.remove("territorio:mock-now");
}

export function problem(status, type, title, extra = {}, headers = {}) {
  return HttpResponse.json(
    { type, title, status, request_id: `mock-${Date.now().toString(36)}`, ...extra },
    { status, headers: { "Content-Type": "application/problem+json", ...headers } },
  );
}

/** Envolve uma rota: atraso realista, erros forçados e o cenário passado adiante. */
export async function respond(handler) {
  const scenario = currentScenario();
  await delay(scenario === "lento" ? 1800 + Math.random() * 900 : 180 + Math.random() * 320);
  if (scenario === "erro") return problem(500, "server", "Erro simulado pela demonstração");
  if (scenario === "fora") return problem(503, "unavailable", "Sistema da casa fora (simulação)");
  return handler(scenario);
}
