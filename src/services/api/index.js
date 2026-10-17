// api.house.getHouse(), api.reservations.create() … um espaço de nomes por recurso.
// api.capabilities diz o que este build pode fazer (história 4.1): as telas decidem por ele, nunca pelo modo.
export * as auth from "./auth.js";
export * as availability from "./availability.js";
export * as consents from "./consents.js";
export { ApiError, capabilities, setCsrfToken } from "./client.js";
export * as house from "./house.js";
export * as links from "./links.js";
export * as measure from "./measure.js";
export * as reservations from "./reservations.js";
export * as staff from "./staff.js";
