// O adaptador `static` (história 4.1, AR-11 a AR-13): o site montado com `--mode site`
// (VITE_API_MODE=static) roda sem a API. As páginas foram impressas na hora do build a partir da
// cópia de src/content/, então toda parte ao vivo mantém o valor impresso; este adaptador responde as
// poucas leituras que consegue a partir da mesma cópia e recusa toda outra chamada com `static_mode`, cuja
// entrada no catálogo oferece o WhatsApp da casa. As telas nunca testam o modo: elas leem
// api.capabilities (reserva desligada manda "Reservar mesa" para o WhatsApp com a mensagem pronta).
import HOUSE from "../../content/house.json" with { type: "json" };

/** O que o site pode fazer em cada modo; as telas decidem por isto, nunca pelo nome do modo. */
export const CAPABILITIES = {
  static: Object.freeze({ mode: "static", booking: false, account: false, live: false, panel: false }),
  api: Object.freeze({ mode: "api", booking: true, account: true, live: true, panel: true }),
};

/**
 * A resposta da cópia dos dados a uma leitura, ou undefined quando o site estático não tem (o cliente então
 * recusa a chamada com static_mode). Só os dados da própria casa, nunca nada que muda.
 */
export function staticReply(method, path) {
  if (method !== "GET") return undefined;
  if (path === "/house") {
    const { name, tagline, address, whatsapp, instagram, timezone } = HOUSE;
    return { static: true, name, tagline, address, whatsapp, instagram, timezone };
  }
  return undefined;
}
