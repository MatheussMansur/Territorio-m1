import { get } from "./client.js";

/** Situação de cada dia entre duas datas para um tamanho de grupo. */
export const getDays = ({ from, to, partySize }, options) =>
  get("/availability/days", { ...options, query: { from, to, party_size: partySize } });

/** @returns {Promise<import("../../types/models.js").DayAvailability>} */
export const getSlots = ({ date, partySize }, options) =>
  get("/availability/slots", { ...options, query: { date, party_size: partySize } });
