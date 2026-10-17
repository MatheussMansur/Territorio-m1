// O catálogo de erros da casa (história 1.5): todo ProblemType do contrato tem a sua frase,
// as frases do cliente existem nos três idiomas com as mesmas lacunas, nenhum texto
// usa palavra que a casa proibiu, e a função única guarda o número do pedido e nunca
// mostra o texto cru do servidor.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

globalThis.window = { location: { origin: "http://casa.test" }, dispatchEvent() {} };
const { CATALOG, describeError, errorCode, errorMessage, staffErrorCode, staffErrorMessage, staffProblem } = await import("../../src/lib/errors.js");
const { ApiError } = await import("../../src/services/api/client.js");

const contract = readFileSync(new URL("../../docs/api/openapi.yaml", import.meta.url), "utf8");
const problemTypes = contract.match(/^ {4}ProblemType:\r?\n(?: {6}.*\r?\n)*? {6}enum: \[([^\]]+)\]/m)[1].split(",").map((t) => t.trim());
// os códigos do próprio front (erros-e-mensagens.md, seção 5)
const FRONT = ["network", "timeout", "offline", "bad_response", "unknown", "screen_error", "storage_blocked", "cookies_blocked", "webcrypto_unavailable", "device_key_lost", "device_clock_skew", "device_pending", "session_expired.staff", "offline.panel", "realtime_lost"];
const vars = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
// jargão e palavras que a casa não usa na frente das pessoas (erros-e-mensagens.md, seção 1)
const BANNED = /experi[eê]ncia|experiencia|experience|prezad|informamos|erro 500|servidor|\btoken\b|requisi[cç][aã]o|falha de autentica|par[aâ]metro|stack|exception/i;

test("o contrato tem tipos de erro e cada um tem a frase da casa", () => {
  assert.ok(problemTypes.length >= 35, `achei só ${problemTypes.length} tipos no openapi.yaml`);
  const missing = problemTypes.filter((type) => !CATALOG[type]?.pt?.title || !CATALOG[type]?.pt?.text);
  assert.deepEqual(missing, [], `tipos sem mensagem: ${missing.join(", ")}`);
});

test("os códigos do próprio aparelho também têm frase", () => {
  const missing = FRONT.filter((code) => !CATALOG[code]?.pt?.title);
  assert.deepEqual(missing, []);
});

test("toda mensagem tem título, texto e um jeito de mostrar", () => {
  for (const [code, entry] of Object.entries(CATALOG)) {
    assert.ok(["field", "notice", "dialog", "page"].includes(entry.display), `${code}: display`);
    assert.ok(entry.pt.title.trim() && entry.pt.text.trim(), `${code}: vazio`);
  }
});

test("o que chega ao cliente existe em espanhol e inglês, com os mesmos marcadores", () => {
  for (const [code, entry] of Object.entries(CATALOG)) {
    if (entry.audience === "staff") continue;
    for (const locale of ["es", "en"]) {
      assert.ok(entry[locale]?.title && entry[locale]?.text, `${code}: falta ${locale}`);
      assert.deepEqual(vars(entry[locale].title + entry[locale].text), vars(entry.pt.title + entry.pt.text), `${code}: marcadores em ${locale}`);
    }
  }
});

test("nenhum texto usa palavra vetada pela casa", () => {
  for (const [code, entry] of Object.entries(CATALOG)) {
    for (const locale of ["pt", "es", "en"]) {
      if (!entry[locale]) continue;
      assert.doesNotMatch(`${entry[locale].title} ${entry[locale].text} ${entry[locale].action}`, BANNED, `${code} (${locale})`);
    }
  }
});

test("a variante da tela vence a base, e o desconhecido cai numa frase com saída", () => {
  assert.equal(errorCode({ type: "gone", status: 410 }, "invite"), "gone.invite");
  assert.equal(errorCode({ type: "gone", status: 410 }, "nada"), "gone");
  assert.equal(errorCode({ status: 418 }), "unknown");
  assert.equal(errorCode({ status: 503 }), "server");
  assert.equal(errorCode("pin_locked"), "pin_locked");
  assert.equal(errorCode(new TypeError("x")), "unknown");
});

test("erro do servidor guarda o número do pedido e nunca mostra o texto cru", () => {
  const error = new ApiError({ status: 500, type: "server", title: "Traceback (most recent call last)", requestId: "req-42" });
  const d = describeError(error);
  assert.equal(d.requestId, "req-42");
  assert.equal(d.title, "Algo deu errado do nosso lado");
  assert.doesNotMatch(`${d.title} ${d.text} ${error.userMessage}`, /Traceback|req-42/);
  assert.equal(d.log, true);
});

test("os números vêm do próprio problema", () => {
  const limited = describeError(new ApiError({ status: 429, type: "rate_limited", retryAfter: 600 }), { variant: "login" });
  assert.match(limited.text, /10 min/);
  const pin = describeError(new ApiError({ status: 401, type: "pin_invalid", body: { remaining_attempts: 2 } }));
  assert.match(pin.text, /Restam 2 tentativas/);
  const clock = describeError(new ApiError({ status: 401, type: "device_signature_invalid", body: { reason: "clock", skew_s: 360 } }));
  assert.equal(clock.code, "device_clock_skew");
  assert.match(clock.text, /6 min adiantado/);
  assert.match(clock.text, /Não precisa parear de novo/, "never pair again because of the clock");
  const slow = describeError(new ApiError({ status: 401, type: "device_signature_invalid", body: { reason: "clock", skew_s: -480 } }));
  assert.match(slow.text, /8 min atrasado/);
  const locked = describeError("pin_locked", { vars: { name: "Tainá", minutes: 15 } });
  assert.equal(locked.title, "Tainá está travado por 15 min");
});

test("marcador sem valor nunca aparece entre chaves", () => {
  for (const code of Object.keys(CATALOG)) {
    const { title, text } = describeError(code);
    assert.doesNotMatch(`${title} ${text}`, /[{}]/, code);
  }
});

test("o painel lê em português; o cliente, na língua da página", () => {
  const staff = describeError("reauth_required", { locale: "en" });
  assert.equal(staff.title, "Confirme que é você");
  const customer = describeError("slot_full", { locale: "es" });
  assert.notEqual(customer.title, CATALOG.slot_full.pt.title);
  assert.equal(errorMessage("csrf_failed"), "Precisamos recarregar a página. A página ficou aberta por muito tempo. Recarregue e faça de novo; o que já foi gravado continua.");
});

test("o painel usa o mesmo catálogo e nunca uma frase escrita para o cliente", () => {
  // todo status que a API pode responder, com e sem um tipo que o catálogo conhece
  const cases = [400, 401, 403, 404, 409, 410, 412, 422, 423, 429, 500, 502, 503, 418].flatMap((status) => [
    new ApiError({ status }),
    ...Object.keys(CATALOG).map((type) => new ApiError({ status, type: type.split(".")[0] })),
  ]);
  for (const error of cases) {
    const code = staffErrorCode(error);
    assert.ok(CATALOG[code], `${code} existe`);
    assert.notEqual(CATALOG[code].audience, "customer", `${error.status} ${error.type} → ${code}`);
  }
});

test("no painel, a razão do problema e a variante da equipe vencem a base", () => {
  assert.equal(staffErrorCode(new ApiError({ status: 409, type: "conflict", body: { reason: "table_taken" } })), "conflict.table_taken");
  assert.equal(staffErrorCode(new ApiError({ status: 409, type: "conflict", body: { code: "event_list_full" } })), "conflict.event_list_full");
  assert.equal(staffErrorCode(new ApiError({ status: 409, type: "slot_full" })), "slot_full.staff");
  assert.equal(staffErrorCode(new ApiError({ status: 409, type: "invalid_transition" })), "invalid_transition.staff");
  assert.equal(staffErrorCode(new ApiError({ status: 404, type: "not_found" })), "not_found.staff");
  assert.equal(staffErrorCode(new ApiError({ status: 503 })), "server.staff");
  assert.equal(staffErrorCode(new ApiError({ status: 0, type: "network" })), "network");
  assert.equal(staffErrorCode(new TypeError("x")), "unknown.staff");
});

test("no painel, o texto cru do servidor nunca aparece", () => {
  const error = new ApiError({ status: 409, type: "invalid_transition", title: "Transition seated->cancelled refused", detail: "SQLSTATE 23505" });
  const said = staffErrorMessage(error);
  assert.doesNotMatch(said, /SQLSTATE|Transition/);
  assert.match(said, /Não dá para fazer isso agora/);
  const { title, message } = staffProblem(new ApiError({ status: 500, title: "Traceback" }));
  assert.equal(title, "Algo deu errado do nosso lado");
  assert.doesNotMatch(message, /WhatsApp/, "a equipe não chama a casa no WhatsApp");
});

test("no painel, os fatos da recusa entram na frase: quem, quando e o prazo", () => {
  const canceled = staffErrorMessage(new ApiError({ status: 409, type: "invalid_transition", body: { reason: "customer_canceled", time: "19:12" } }));
  assert.match(canceled, /^O cliente cancelou às 19:12\./);
  const arrived = staffErrorMessage(new ApiError({ status: 409, type: "invalid_transition", body: { reason: "already_arrived", name: "Tainá", time: "21:02" } }));
  assert.match(arrived, /^Chegada já marcada por Tainá às 21:02\./);
  const checkIn = staffErrorMessage(new ApiError({ status: 409, type: "undo_window_closed", body: { minutes: 15 } }));
  assert.match(checkIn, /em até 15 min/);
  const noShow = staffErrorMessage(new ApiError({ status: 409, type: "undo_window_closed", body: { minutes: 1440, hours: 24, reason: "no_show" } }));
  assert.match(noShow, /em até 24 h/);
  assert.doesNotMatch(noShow, /1440/);
});
