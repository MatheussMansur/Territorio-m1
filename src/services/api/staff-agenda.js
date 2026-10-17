// A Agenda: o mês, o plano de uma data e várias datas de uma vez. Toda mudança pode ser
// simulada antes (dryRun) para mostrar quem fica com a mesa, quem muda e quem fica sem.
// A versão lida vai no cabeçalho If-Match (412 quando alguém gravou a data antes).
import { del, get, put } from "./client.js";

/** Os dias de um mês ("2026-10"). */
export const calendar = (month, options) => get("/staff/calendar", { ...options, query: { month } });

/** As datas entre `from` e `to` que saem da semana padrão. */
export const dayPlans = (from, to, options) => get("/staff/day-plans", { ...options, query: { from, to } });

/** A data como vai funcionar (semana padrão, plano e evento), com as reservas dela. */
export const day = (date, options) => get(`/staff/day-plans/${date}`, options);

/** Define o plano de uma data; com dryRun nada é gravado. `version` é a versão lida do plano ("semana" sem plano). */
export const setPlan = (date, plan, { dryRun = false, version, ...options } = {}) =>
  put(`/staff/day-plans/${date}`, plan, { ...options, ifMatch: dryRun ? undefined : version, query: { dry_run: dryRun || undefined } });

/** O mesmo plano em várias datas. */
export const setPlans = (dates, plan, { dryRun = false, confirm = false, resolutions, ...options } = {}) =>
  put("/staff/day-plans", { dates, plan, confirm_conflicts: confirm || undefined, resolutions }, { ...options, query: { dry_run: dryRun || undefined } });

/** Volta para a semana padrão; o corpo leva a decisão sobre cada reserva que ficou sem mesa. */
export const resetPlan = (date, { dryRun = false, confirm = false, resolutions = [], version, ...options } = {}) =>
  del(`/staff/day-plans/${date}`, {
    ...options,
    body: { resolutions },
    ifMatch: dryRun ? undefined : version,
    query: { dry_run: dryRun || undefined, confirm_conflicts: confirm || undefined },
  });
