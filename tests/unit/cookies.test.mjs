// O registro de cookies é a única lista: todo nome que o código grava está nele, toda entrada tem
// categoria, finalidade nos três idiomas e duração; os dados de medição ficam limpos.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CATEGORIES, COOKIES } from "../../src/lib/cookie-registry.js";
import { clean, origin } from "../../src/lib/measure.js";

const files = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const full = join(dir, f);
    return statSync(full).isDirectory() ? files(full) : full.endsWith(".js") ? [full] : [];
  });

test("cada cookie do registro tem categoria, prazo e texto nas três línguas", () => {
  for (const c of COOKIES) {
    assert.ok(CATEGORIES.includes(c.category), `${c.name}: categoria`);
    assert.ok(["cookie", "storage"].includes(c.kind), `${c.name}: tipo`);
    for (const l of ["pt", "es", "en"]) assert.ok(c.purpose[l]?.length > 20, `${c.name}: texto em ${l}`);
    if (c.by === "server") assert.ok(c.name.startsWith("__Host-"), `${c.name}: cookie do servidor usa __Host-`);
  }
  assert.equal(new Set(COOKIES.map((c) => c.name)).size, COOKIES.length, "nomes repetidos");
});

test("nenhum código escreve cookie ou guarda dado fora do registro", () => {
  const names = new Set(COOKIES.map((c) => c.name));
  for (const file of [...files("src"), "public/theme.js"]) {
    if (file.includes("cookies.js") || file.includes("cookie-registry.js") || file.includes("mocks")) continue;
    const text = readFileSync(file, "utf8");
    assert.ok(!/document\.cookie\s*=/.test(text), `${file}: escreve cookie direto; use src/lib/cookies.js`);
    for (const m of text.matchAll(/["'`](trt[_:][\w-]+)["'`]/g)) assert.ok(names.has(m[1]), `${file}: ${m[1]} fora do registro`);
  }
});

test("a medição nunca leva texto livre, só números, booleanos e códigos curtos", () => {
  const out = clean({ party: 4, weekday: 5, time: "20:30", origin: "bio", name: "Ana Souza", phone: "+55 45 99999-0000", note: "x".repeat(60), ok: true, "Bad-Key": 1 });
  assert.deepEqual(out, { party: 4, weekday: 5, time: "20:30", origin: "bio", ok: true });
});

test("procedência: a marca ?de= da casa, o site de origem ou direto", () => {
  assert.equal(origin({ search: "?de=bio", hostname: "territorio.com.br" }, ""), "bio");
  assert.equal(origin({ search: "", hostname: "territorio.com.br" }, "https://www.google.com/search?q=x"), "google.com");
  assert.equal(origin({ search: "", hostname: "territorio.com.br" }, ""), "direto");
});

test("o aviso volta quando a versão do texto sobe, e a medição desligada pela casa não conta (bug 16)", async () => {
  globalThis.document = { cookie: "" };
  const { applySettings, consent, allowed, CONSENT_VERSION } = await import("../../src/lib/cookies.js");
  const choice = (version) => `trt_consent=${encodeURIComponent(JSON.stringify({ version, measurement: true, remember: false }))}`;
  document.cookie = choice(CONSENT_VERSION);
  assert.ok(consent(), "escolha da versão atual vale");
  assert.equal(applySettings({ banner_version: "2099-01-01", measurement_enabled: true }), true, "versão nova pede de novo");
  assert.equal(consent(), null);
  document.cookie = choice("2099-01-01");
  assert.ok(consent(), "escolha feita na versão nova vale");
  assert.equal(allowed("measurement"), true);
  applySettings({ banner_version: "2099-01-01", measurement_enabled: false });
  assert.equal(allowed("measurement"), false, "a casa desligou a medição");
  delete globalThis.document;
});
