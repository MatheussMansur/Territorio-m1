// Sistema (história 1.14): o estado do que mantém a casa funcionando, e os aparelhos dela.
import { get } from "./client.js";

/** O estado dos serviços: { checked_at, items: [{ key, state, checked_at, detail }], errors, clock }. */
export const status = (options) => get("/staff/system/status", options);

/** Os aparelhos da casa (aprovados, pendentes, revogados). */
export const devices = (options) => get("/staff/devices", options);
