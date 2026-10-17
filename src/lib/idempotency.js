import { session } from "./storage.js";
import { uuid } from "./uuid.js";

// Uma chave por tentativa: criada quando a pessoa chega ao passo de confirmar, mantida entre
// recargas e novas tentativas, descartada depois de uma resposta definitiva. A API responde à mesma chave com
// a mesma reserva em vez de criar outra (FR-21).
export function idempotencyKey(scope) {
  const name = `idem:${scope}`;
  let key = session.get(name);
  if (!key) {
    key = uuid();
    session.set(name, key);
  }
  return key;
}

export function clearIdempotencyKey(scope) {
  session.remove(`idem:${scope}`);
  session.remove(`idem:${scope}:para`);
}

/**
 * A chave deste pedido exato: a mesma enquanto o pedido não muda (uma nova tentativa depois de um
 * tempo esgotado), uma nova quando a pessoa mudou o que é enviado (outro horário depois de "lotou").
 */
export function idempotencyKeyFor(scope, request) {
  const print = JSON.stringify(request);
  if (session.get(`idem:${scope}:para`) !== print) {
    session.remove(`idem:${scope}`);
    session.set(`idem:${scope}:para`, print);
  }
  return idempotencyKey(scope);
}

/**
 * Se o pedido pode ter chegado à casa sem a resposta voltar (sem rede, tempo
 * esgotado, um 5xx, pedidos demais) ou precisa ser enviado de novo como estava (a sessão acabou, e
 * a mesma reserva vai depois do código). Aí a chave fica, para tentar de novo nunca duplicar.
 */
export function mayRetrySame(error) {
  if (!error) return false;
  if (["network", "timeout", "bad_response", "server", "rate_limited", "session_expired", "unauthorized"].includes(error.type)) return true;
  return error.status === 0 || error.status === 401 || error.status === 429 || error.status >= 500;
}

/** Depois de uma resposta: mantém a chave enquanto o mesmo pedido pode ser tentado de novo, senão descarta. */
export function settleIdempotencyKey(scope, error = null) {
  if (!mayRetrySame(error)) clearIdempotencyKey(scope);
}
