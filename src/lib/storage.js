// O armazenamento do navegador pode faltar ou dar erro (janelas privadas, dados do site bloqueados, cota
// cheia). Estas funções nunca dão erro e caem para a memória, que é lida primeiro.
const memory = new Map();

function safe(kind) {
  try {
    const store = window[kind];
    const probe = "__t";
    store.setItem(probe, probe);
    store.removeItem(probe);
    return store;
  } catch {
    return null;
  }
}

function wrap(kind) {
  const store = safe(kind);
  return {
    get(key, fallback = null) {
      try {
        const k = `${kind}:${key}`;
        const raw = memory.has(k) ? memory.get(k) : store ? store.getItem(key) : null;
        return raw == null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      const raw = JSON.stringify(value);
      try {
        if (!store) return memory.set(`${kind}:${key}`, raw);
        store.setItem(key, raw);
        memory.delete(`${kind}:${key}`);
      } catch {
        memory.set(`${kind}:${key}`, raw);
      }
    },
    remove(key) {
      try {
        store?.removeItem(key);
      } catch {
        /* ignorar */
      }
      memory.delete(`${kind}:${key}`);
    },
  };
}

export const local = wrap("localStorage");
export const session = wrap("sessionStorage");
