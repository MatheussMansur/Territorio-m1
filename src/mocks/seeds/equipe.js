// A equipe da área Equipe: as três sessões básicas (dono, gerente, recepção) ganham telefones
// e últimas entradas, e o resto da casa se junta a elas: um segundo gerente, a recepção que
// só entra com o PIN nos aparelhos da casa, alguém que saiu e um convite a caminho.
// Também as permissões por área que o dono escolheu (história 1.15), começando no padrão.
import { uuid } from "../../lib/uuid.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function extend(state, now) {
  state.users ??= [];
  const ago = (ms) => new Date(now.getTime() - ms).toISOString();

  const base = {
    owner: { phone_e164: "+5545998304994", mfa_enabled: true, last_login_at: ago(2 * HOUR), created_at: ago(60 * DAY) },
    manager: { phone_e164: "+5545999218877", mfa_enabled: true, last_login_at: ago(26 * HOUR), created_at: ago(40 * DAY) },
    floor: { phone_e164: "+5545999540066", mfa_enabled: false, last_login_at: ago(20 * HOUR), created_at: ago(40 * DAY) },
  };
  for (const user of state.users) {
    Object.assign(user, { pin_only: false, pin_locked_until: null, invite_expires_at: null, ...base[user.role] });
  }

  const person = (fields) => ({
    id: uuid(),
    email: null,
    status: "active",
    pin_only: true,
    pin_locked_until: null,
    mfa_enabled: false,
    last_login_at: null,
    invite_expires_at: null,
    created_at: ago(30 * DAY),
    ...fields,
  });

  state.users.push(
    person({ name: "Débora Kato", email: "debora@territorio.test", role: "manager", pin_only: false, mfa_enabled: true, phone_e164: "+5545999873311", last_login_at: ago(3 * DAY) }),
    person({ name: "Tainá Oliveira", role: "floor", phone_e164: "+5545998416620", last_login_at: ago(21 * HOUR) }),
    person({ name: "Rodrigo Benítez", role: "floor", phone_e164: "+595983221144", last_login_at: ago(22 * HOUR) }),
    person({ name: "Lucía Ferreyra", role: "floor", phone_e164: "+5493757553219", last_login_at: ago(4 * DAY), pin_locked_until: null }),
    person({ name: "Kenji Moraes", role: "floor", phone_e164: "+5545999062218", last_login_at: ago(2 * DAY) }),
    person({ name: "Paulo Henrique Silva", role: "floor", status: "disabled", phone_e164: "+5545988330091", last_login_at: ago(25 * DAY), created_at: ago(90 * DAY) }),
    person({ name: "", email: "isadora.nunes@territorio.test", role: "manager", status: "invited", pin_only: false, invite_expires_at: new Date(now.getTime() + 50 * HOUR).toISOString(), created_at: ago(22 * HOUR) }),
  );

  // um PIN travado no tablet da casa há pouco tempo (história 1.12, o alerta pin_locked do Hoje)
  const lucia = state.users.find((u) => u.name === "Lucía Ferreyra");
  if (lucia) {
    const until = new Date(now.getTime() + 9 * 60_000).toISOString();
    lucia.pin_locked_until = until;
    state.pin_locks = [{ id: uuid(), user_id: lucia.id, user_name: lucia.name, device_name: "Tablet do salão", attempts: 5, locked_at: ago(6 * 60_000), until }];
  }

  // null quer dizer "o padrão do arquivo de permissões" (src/admin/nav.js) para aquele perfil
  state.permissions = { manager: null, floor: null, updated_at: null, updated_by: null };
}
