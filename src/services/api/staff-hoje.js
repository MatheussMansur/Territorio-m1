// Hoje: a noite num relance, os alertas dela, e o que mantém as telas da noite vivas: o fluxo
// ao vivo (GET /staff/stream) e as leituras condicionais com ETag / If-None-Match. Os dois passam
// pelo send() de client.js, então o aparelho da casa assina como toda outra chamada (AD-26).
import { t } from "../../lib/strings.js";
import { ApiError, errorOf, get, send } from "./client.js";

/**
 * A noite num relance (Dashboard): números, colunas de horário, alertas, ligações, movimento, evento e semana.
 * @param {string} date  YYYY-MM-DD no fuso horário da casa
 */
export const dashboard = (date, options) => get("/staff/dashboard", { ...options, query: { date } });

/**
 * Uma leitura que diz "nada mudou" sem custo: manda o ETag que tem e recebe 304 quando os dados
 * são os mesmos.
 * @returns {Promise<{changed: boolean, data?: any, etag: string|null}>}
 */
export async function readFresh(path, { query, etag, signal, timeout = 15_000 } = {}) {
  const response = await send("GET", path, { query, signal, timeout, cache: "no-store", headers: etag ? { "If-None-Match": etag } : {} });
  if (response.status === 304) return { changed: false, etag };
  if (!response.ok) throw await errorOf(response);
  const data = await response.json().catch(() => undefined);
  if (data === undefined) throw new ApiError({ status: response.status, type: "bad_response", title: t("errors.server") });
  return { changed: true, data, etag: response.headers.get("ETag") };
}

/**
 * O fluxo ao vivo (text/event-stream lido com fetch, para o aparelho da casa poder assinar):
 * chama onEvent({ event, data }) para cada "hello", "ping" e "invalidate". Resolve quando o
 * fluxo termina; rejeita quando não consegue abrir.
 */
export async function stream({ onEvent, signal }) {
  const response = await send("GET", "/staff/stream", { headers: { Accept: "text/event-stream" }, signal, timeout: 0, cache: "no-store" });
  if (!response.ok || !response.body) throw new ApiError({ status: response.status, type: "stream_unavailable", title: t("errors.server") });
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    let cut;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      let event = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      let parsed;
      try {
        parsed = data ? JSON.parse(data) : {};
      } catch {
        parsed = {};
      }
      onEvent({ event, data: parsed });
    }
  }
}
