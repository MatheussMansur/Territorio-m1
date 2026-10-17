import { get } from "./client.js";

/**
 * A pessoa da sessão da equipe; um 401 (unauthorized) quer dizer que ninguém está dentro.
 * @returns {Promise<import("../../types/models.js").User>}
 */
export const me = (options) => get("/staff/me", options);
