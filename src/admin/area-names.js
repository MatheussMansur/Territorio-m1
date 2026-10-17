// Os nomes das áreas da casa, lidos uma vez quando o painel abre, para toda tela poder nomear uma
// área que o dono criou em Plantas ("Tenda do evento"), não só as três com que a casa começou.
import { areas } from "../services/api/staff-plantas.js";

const names = { salao: "Salão", quintal: "Quintal", balcao: "Balcão" };

/** "tenda-do-evento" → "Tenda do evento": um nome legível enquanto os nomes não chegaram. */
const humanize = (key) => {
  const words = key.replace(/[-_]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : undefined;
};

/** AREA[key] → o nome da área; chaves desconhecidas ou vazias dão undefined, como um objeto comum. */
export const AREA = new Proxy(names, {
  get: (target, key) => {
    if (typeof key !== "string" || key === "" || key === "undefined" || key === "null") return undefined;
    return Object.hasOwn(target, key) ? target[key] : humanize(key);
  },
});

/** Lê os nomes do servidor; se falhar, as telas ficam com os nomes que já têm. */
export async function loadAreaNames() {
  try {
    for (const area of await areas()) if (area?.key && area?.name) names[area.key] = area.name;
  } catch {
    // o painel continua funcionando: áreas desconhecidas mostram uma forma legível da chave
  }
}
