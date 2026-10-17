import { post } from "./client.js";

const PATH = "/measure";

/**
 * Um lote de eventos de medição (sem dados pessoais, veja src/lib/measure.js). Quando a página está
 * fechando, o beacon do navegador leva o lote para ele não se perder; senão, uma chamada normal.
 */
export function send(body, { leaving = false } = {}) {
  if (leaving && navigator.sendBeacon?.(`/api/v1${PATH}`, new Blob([JSON.stringify(body)], { type: "application/json" }))) {
    return Promise.resolve();
  }
  return post(PATH, body);
}
