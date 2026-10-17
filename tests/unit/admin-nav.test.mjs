import assert from "node:assert/strict";
import { test } from "node:test";
import { AREAS, areaFor, canOpen, defaultAreas, entryFor, itemsFor, normalizePath, personalFor } from "../../src/admin/nav.js";

const labels = (items) => items.map((i) => i.label);

test("o menu tem as 15 áreas na ordem do painel", () => {
  assert.deepEqual(labels(AREAS), [
    "Hoje", "Reservas", "Salão", "Espera", "Agenda", "Plantas", "Eventos", "Clientes",
    "Site", "Cardápio", "Galeria",
    "Equipe", "Configurações", "Registro", "Sistema",
  ]);
  assert.deepEqual(AREAS.filter((a) => a.bar).map((a) => a.label), ["Hoje", "Reservas", "Salão"]);
  assert.equal(new Set(AREAS.map((a) => a.path)).size, 15);
});

test("itens por papel", () => {
  assert.equal(itemsFor("owner").length, 15);
  assert.deepEqual(
    labels(itemsFor("manager")),
    ["Hoje", "Reservas", "Salão", "Espera", "Agenda", "Plantas", "Eventos", "Clientes", "Site", "Cardápio", "Galeria", "Configurações"],
  );
  assert.deepEqual(labels(itemsFor("floor")), ["Hoje", "Reservas", "Salão", "Espera", "Cardápio"]);
  assert.deepEqual(itemsFor("visitante"), [], "papel desconhecido não vê nada");
  assert.deepEqual(itemsFor(undefined), []);
});

test("as áreas liberadas decidem, e o dono sempre tem tudo", () => {
  assert.deepEqual(labels(itemsFor("manager", ["hoje", "equipe"])), ["Hoje", "Equipe"]);
  assert.equal(itemsFor("owner", ["hoje"]).length, 15);
  assert.equal(canOpen("floor", "/admin/agenda", [...defaultAreas("floor"), "agenda"]), true);
  assert.equal(canOpen("floor", "/admin/agenda"), false);
});

test("canOpen segue o papel", () => {
  assert.equal(canOpen("owner", "/admin/sistema"), true);
  assert.equal(canOpen("manager", "/admin/registro"), false);
  assert.equal(canOpen("manager", "/admin/equipe"), false);
  assert.equal(canOpen("manager", "/admin/configuracoes"), true);
  assert.equal(canOpen("floor", "/admin/salao"), true);
  assert.equal(canOpen("floor", "/admin/cardapio"), true);
  assert.equal(canOpen("floor", "/admin/configuracoes"), false);
  assert.equal(canOpen("floor", "/admin/"), true);
});

test("endereço desconhecido não abre nada", () => {
  assert.equal(areaFor("/admin/xyz"), null);
  assert.equal(areaFor("/admin/salao/mesa").key, "salao", "uma página dentro da área é da área");
  assert.equal(areaFor("/admin/salaox"), null);
  assert.equal(areaFor("/reservar/"), null);
  assert.equal(canOpen("owner", "/admin/xyz"), false);
});

test("o endereço aceita barra no fim e o painel sem barra", () => {
  assert.equal(normalizePath("/admin"), "/admin/");
  assert.equal(normalizePath("/admin/salao/"), "/admin/salao");
  assert.equal(areaFor("/admin/salao/?papel=dono").key, "salao");
  assert.equal(areaFor("/admin").key, "hoje");
});

test("a entrada e os links de uso único têm o próprio endereço", () => {
  assert.deepEqual(entryFor("/admin/entrar"), { screen: "login", token: null });
  assert.deepEqual(entryFor("/admin/entrar/esqueci/"), { screen: "forgot", token: null });
  assert.deepEqual(entryFor("/admin/entrar/nova-senha/abc123"), { screen: "reset", token: "abc123" });
  assert.deepEqual(entryFor("/admin/entrar/primeiro-acesso/p1"), { screen: "setup", token: "p1" });
  assert.deepEqual(entryFor("/admin/entrar/convite/c1"), { screen: "invite", token: "c1" });
  assert.deepEqual(entryFor("/admin/aparelho"), { screen: "pairing", token: null });
  assert.deepEqual(entryFor("/admin/entrar/qualquer"), { screen: "login", token: null });
  assert.equal(entryFor("/admin/salao"), null);
  assert.equal(areaFor("/admin/entrar"), null, "a entrada não é uma das 15 áreas");
});

test("Minhas sessões é da pessoa, fora do menu das áreas", () => {
  assert.equal(personalFor("/admin/conta/sessoes/").label, "Minhas sessões");
  assert.equal(personalFor("/admin/conta"), null);
  assert.equal(itemsFor("owner").some((a) => a.path.startsWith("/admin/conta")), false);
});
