import { get } from "./client.js";

/** @returns {Promise<import("../../types/models.js").HousePublic>} */
export const getHouse = (options) => get("/house", options);
export const getContent = (options) => get("/content", options);
export const getMenu = (options) => get("/menu", options);
