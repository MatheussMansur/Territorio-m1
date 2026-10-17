// Os dados de entrada da equipe para a demonstração (histórias 1.6 a 1.8): os links de primeiro acesso do dono
// (um esperando, um já usado, um de recuperação para um autenticador perdido), as sessões que o
// dono e o gerente têm abertas em outros aparelhos, e a senha e o código da demonstração. Qualquer um
// da equipe com e-mail entra com eles; um autenticador real, configurado na tela de primeiro
// acesso, também funciona. Nada aqui é um segredo de verdade.
export const DEMO_PASSWORD = "admin";
// a entrada curta da demonstração para o dono: "admin" vale pelo e-mail do dono e pula o código
export const DEMO_LOGIN = "admin";
export const DEMO_CODE = "123456";
// o segredo do autenticador com que toda pessoa dos dados iniciais começa (base32)
export const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXP";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Um hash curto de mão única, para o banco da demonstração não guardar nenhuma senha às claras. */
export function passwordHash(value) {
  const text = `territorio:${String(value ?? "")}`;
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

/**
 * O link de um convite acompanha a pessoa e o vencimento do convite: reenviar (um novo vencimento)
 * faz o link antigo parar de funcionar, e ele abre como gone.invite.
 */
export function inviteToken(user) {
  const id = String(user.id).replace(/-/g, "").slice(0, 8);
  return `c${id}${passwordHash(`${user.id}|${user.invite_expires_at}`)}${passwordHash(user.invite_expires_at).slice(0, 6)}`;
}

const token = (prefix) => `${prefix}${Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 26)}`;

export function extend(state, now) {
  const ago = (ms) => new Date(now.getTime() - ms).toISOString();
  const ahead = (ms) => new Date(now.getTime() + ms).toISOString();
  const owner = state.users.find((u) => u.role === "owner");
  const manager = state.users.find((u) => u.role === "manager");
  const session = (user, fields) => ({
    id: crypto.randomUUID?.() ?? token("s"),
    user_id: user.id,
    remember: true,
    ended_at: null,
    csrf: token("x"),
    ...fields,
  });

  state.auth = {
    sessions: [
      owner && session(owner, { device: "Safari no iPhone", place: "Foz do Iguaçu, PR (aproximado)", created_at: ago(9 * DAY), last_seen_at: ago(2 * HOUR), expires_at: ahead(21 * DAY) }),
      owner && session(owner, { device: "Chrome no Windows", place: "Foz do Iguaçu, PR (aproximado)", created_at: ago(3 * DAY), last_seen_at: ago(26 * HOUR), expires_at: ahead(27 * DAY) }),
      manager && session(manager, { device: "Chrome no Android", place: "Ciudad del Este, PY (aproximado)", created_at: ago(5 * DAY), last_seen_at: ago(26 * HOUR), expires_at: ahead(25 * DAY) }),
    ].filter(Boolean),
    device_sessions: [],
    tokens: owner
      ? [
          // o primeiro acesso que o instalador manda para o dono: esperando, vale por 48 h
          { token: token("p"), kind: "owner_setup", user_id: owner.id, created_at: ago(HOUR), expires_at: ahead(48 * HOUR), used_at: null },
          // o que já foi usado quando a casa foi configurada: abrir de novo mostra gone.setup
          { token: token("p"), kind: "owner_setup", user_id: owner.id, created_at: ago(12 * DAY), expires_at: ago(10 * DAY), used_at: ago(12 * DAY) },
          // o link de recuperação para um dono que perdeu o autenticador e os códigos de recuperação
          { token: token("p"), kind: "owner_setup", user_id: owner.id, created_at: ago(HOUR), expires_at: ahead(24 * HOUR), used_at: null, recovery: true },
        ]
      : [],
    credentials: {},
    outbox: [],
    challenges: {},
    failures: {},
  };
}
