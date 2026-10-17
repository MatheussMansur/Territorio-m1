// As regras do catálogo de avisos da equipe (FR-87): níveis, quem recebe, silêncio da noite,
// o que conta no sino, o que some e como, e as abas da central.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  NOTICES, LEVELS, breaksSilence, canDismissForMe, canMute, canResolve, codeOf, codeOfId, codesFor, countsInBell, inQuiet, inTab, isSilenced, levelOf, quietStart, receives, stateOf,
} from "../../src/admin/avisos/catalogo.js";

// 2026-10-16 às 02:30 e às 20:30 no horário da casa (UTC−3)
const at = (hhmm) => new Date(`2026-10-16T${hhmm}:00-03:00`);
const QUIET = { quiet_from: "01:00", quiet_to: "09:00" };
const owner = { id: "u-dono", role: "owner" };
const manager = { id: "u-gerente", role: "manager" };
const floor = { id: "u-recepcao", role: "floor" };

test("cada aviso tem nível, título, quem recebe e quando some", () => {
  const codes = Object.keys(NOTICES);
  assert.ok(codes.length >= 45, `só ${codes.length} avisos no catálogo`);
  for (const [code, n] of Object.entries(NOTICES)) {
    assert.ok(Object.hasOwn(LEVELS, n.level), `${code}: nível`);
    assert.ok(n.title?.trim(), `${code}: título`);
    assert.ok(Array.isArray(n.to) && n.to.length && n.to.every((r) => ["owner", "manager", "floor"].includes(r)), `${code}: quem recebe`);
    assert.ok(n.clears?.trim(), `${code}: quando some`);
    assert.ok(["server", "device"].includes(n.origin), `${code}: origem`);
  }
});

test("todo aviso guardado pela casa está no contrato, e o contrato não tem aviso fora do catálogo", () => {
  const contract = readFileSync(new URL("../../docs/api/openapi.yaml", import.meta.url), "utf8");
  const kinds = contract.match(/StaffAlertKind: \{ type: string, enum: \[([^\]]+)\]/)[1].split(",").map((k) => k.trim());
  const server = Object.keys(NOTICES).filter((c) => NOTICES[c].origin === "server");
  assert.deepEqual(server.filter((c) => !kinds.includes(c)), [], "avisos fora do StaffAlertKind");
  assert.deepEqual(kinds.filter((k) => !NOTICES[k]), [], "StaffAlertKind com aviso fora do catálogo");
});

test("os nomes antigos viram os novos", () => {
  assert.equal(codeOf("night_outage"), "outage_review");
  assert.equal(codeOfId("night_outage:2026-10-15"), "outage_review");
  assert.equal(codeOfId("pin_locked:abc"), "pin_locked");
});

test("só o crítico fura o silêncio, e o silêncio pode passar da meia-noite", () => {
  for (const code of ["whatsapp_down", "device_key_lost", "pin_locked", "pending_expiring", "queue_stuck"]) assert.equal(breaksSilence(code), true, code);
  for (const code of ["pending_request", "message_held", "meta_limit", "google_failed", "birthday"]) assert.equal(breaksSilence(code), false, code);
  assert.equal(inQuiet(150, QUIET), true);
  assert.equal(inQuiet(9 * 60, QUIET), false);
  assert.equal(inQuiet(23 * 60 + 30, { quiet_from: "23:00", quiet_to: "07:00" }), true);
  assert.equal(inQuiet(6 * 60, { quiet_from: "23:00", quiet_to: "07:00" }), true);
  assert.equal(inQuiet(12 * 60, { quiet_from: "23:00", quiet_to: "07:00" }), false);
  assert.equal(inQuiet(3 * 60, { quiet_from: "01:00", quiet_to: "01:00" }), false, "início igual ao fim = sem silêncio");
});

test("aviso que nasce no silêncio espera; o que nasceu antes, não; o crítico nunca espera", () => {
  assert.equal(quietStart(at("20:30"), QUIET), null);
  assert.equal(quietStart(at("02:30"), QUIET).toISOString(), at("01:00").toISOString());
  assert.equal(isSilenced("pending_request", at("02:10"), at("02:30"), QUIET), true);
  assert.equal(isSilenced("pending_request", at("00:50"), at("02:30"), QUIET), false);
  assert.equal(isSilenced("pending_expiring", at("02:10"), at("02:30"), QUIET), false);
  assert.equal(isSilenced("pending_request", at("02:10"), at("09:05"), QUIET), false, "o silêncio acabou");
});

test("quem recebe: o padrão do catálogo e a escolha do dono", () => {
  // pedido para aprovar vai ao dono e ao gerente (PRD)
  assert.equal(receives("pending_request", owner), true);
  assert.equal(receives("pending_request", manager), true);
  assert.equal(receives("pending_request", floor), false);
  // os avisos de só o dono seguem o catálogo, não o Hoje antigo
  assert.equal(receives("reminder_failed", manager), true);
  assert.equal(receives("pin_locked", manager), false);
  assert.equal(receives("whatsapp_down", floor), true);
  // a lista das configurações manda quando existe
  const settings = { pending_to: [manager.id], security_to: [owner.id, manager.id] };
  assert.equal(receives("pending_request", owner, settings), false);
  assert.equal(receives("pending_request", manager, settings), true);
  assert.equal(receives("pin_locked", manager, settings), true);
  // lista vazia: o aviso vai ao dono
  assert.equal(receives("pending_request", owner, { pending_to: [] }), true);
  assert.equal(receives("pending_request", manager, { pending_to: [] }), false);
  assert.equal(receives("nao_existe", owner), false);
  assert.ok(codesFor("floor").every((c) => NOTICES[c].to.includes("floor")));
  assert.ok(!codesFor("floor").includes("pending_request"));
});

test("crítico não desliga; informativo dispensa só para a pessoa; resolver à mão só onde não some sozinho", () => {
  assert.equal(canMute("pin_locked"), false);
  assert.equal(canMute("pending_request"), true);
  assert.equal(canMute("birthday"), true);
  assert.equal(canDismissForMe("birthday"), true);
  assert.equal(canDismissForMe("pending_request"), false);
  assert.equal(canDismissForMe("device_key_lost"), false);
  assert.equal(canResolve("no_show_review"), true);
  assert.equal(canResolve("device_key_lost"), false);
  assert.equal(canResolve("pending_request"), false);
});

test("o que conta no sino e as abas da central", () => {
  const list = [
    { id: "a", kind: "pin_locked", at: "2026-10-16T22:00:00Z", read_at: null, muted: false, silenced: false },
    { id: "b", kind: "pending_request", at: "2026-10-16T23:00:00Z", read_at: null, muted: false, silenced: false },
    { id: "c", kind: "pending_request", at: "2026-10-16T23:10:00Z", read_at: null, muted: true, silenced: false },
    { id: "d", kind: "late_request", at: "2026-10-16T23:20:00Z", read_at: null, muted: false, silenced: true },
    { id: "e", kind: "birthday", at: "2026-10-16T23:30:00Z", read_at: "2026-10-16T23:31:00Z" },
    { id: "f", kind: "birthday", at: "2026-10-16T23:40:00Z", dismissed_at: "2026-10-16T23:41:00Z" },
    { id: "g", kind: "message_failed", at: "2026-10-16T21:00:00Z", resolved_at: "2026-10-16T21:30:00Z" },
    { id: "h", kind: "device_key_lost", at: "2026-10-16T20:00:00Z", read_at: "2026-10-16T20:01:00Z", muted: true },
  ];
  assert.deepEqual(list.filter(countsInBell).map((n) => n.id), ["a", "b"]);
  assert.equal(stateOf(list[5]), "dismissed");
  assert.equal(stateOf(list[6]), "resolved");
  assert.deepEqual(inTab(list, "agir").map((n) => n.id), ["a", "h", "d", "b"], "crítico primeiro; desligado fica fora, menos o crítico");
  assert.deepEqual(inTab(list, "tudo").map((n) => n.id), ["a", "h", "d", "c", "b", "e"]);
  assert.deepEqual(inTab(list, "resolvidos").map((n) => n.id), ["g", "f"]);
  assert.equal(levelOf("nao_existe"), "info");
});
