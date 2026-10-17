// O cliente HTTP com um fetch falso: falha nunca resolve como "null", e numa página nova o
// token CSRF vem da sessão antes do primeiro pedido que muda dados.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

globalThis.window = { location: { origin: "http://casa.test" }, dispatchEvent() {} };
const { ApiError, request, setCsrfToken, setRecovery, setSigner } = await import("../../src/services/api/client.js");

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
let calls;
function fakeFetch(handler) {
  globalThis.fetch = async (url, init) => {
    calls.push({ path: new URL(String(url)).pathname, init });
    return handler(new URL(String(url)).pathname, init);
  };
}

beforeEach(() => {
  calls = [];
  setCsrfToken(null);
});

test("a 200 that is not JSON is an error, not null", async () => {
  fakeFetch(() => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }));
  await assert.rejects(request("GET", "/house"), (e) => e instanceof ApiError && e.type === "bad_response");
});

test("a request the screen already cancelled is not sent", async () => {
  fakeFetch(() => json({}));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(request("GET", "/house", { signal: controller.signal }), { name: "AbortError" });
  assert.equal(calls.length, 0);
});

test("the timeout also covers a body that never ends", async () => {
  fakeFetch(() => ({ status: 200, ok: true, headers: new Headers({ "content-type": "application/json" }), json: () => new Promise(() => {}) }));
  await assert.rejects(request("GET", "/house", { timeout: 30 }), (e) => e instanceof ApiError && e.type === "timeout");
});

test("on a new page, the CSRF token comes from the session before the first change", async () => {
  fakeFetch((path) => (path.endsWith("/me") ? json({ name: "Ana", csrf_token: "tok-1" }) : json({ code: "TR-1" }, 201)));
  await request("POST", "/reservations", { body: {} });
  assert.deepEqual(calls.map((c) => c.path), ["/api/v1/me", "/api/v1/reservations"]);
  assert.equal(calls[1].init.headers["X-CSRF-Token"], "tok-1");

  await request("POST", "/reservations", { body: {} }); // o token fica para os próximos
  assert.equal(calls.length, 3);
});

test("the staff asks its own session for the token", async () => {
  fakeFetch((path) => (path.endsWith("/staff/auth/session") ? json({ csrf_token: "tok-staff" }) : json({}, 200)));
  await request("PATCH", "/staff/settings/booking", { body: {} });
  assert.equal(calls[0].path, "/api/v1/staff/auth/session");
  assert.equal(calls[1].init.headers["X-CSRF-Token"], "tok-staff");
});

test("login, the WhatsApp code and links go without asking the session", async () => {
  fakeFetch(() => json({ ok: true }));
  await request("POST", "/auth/otp", { body: { phone: "+5545999990000" } });
  await request("POST", "/links/abc/confirm", { body: { answer: "yes" } });
  assert.deepEqual(calls.map((c) => c.path), ["/api/v1/auth/otp", "/api/v1/links/abc/confirm"]);
});

test("a rejected CSRF token asks to reload the page, not for another role (catalog)", async () => {
  fakeFetch(() => json({ type: "csrf_failed", title: "Sessão", status: 403 }, 403));
  setCsrfToken("velho");
  await assert.rejects(request("POST", "/reservations", { body: {} }), (e) => e.userMessage.startsWith("Precisamos recarregar a página"));
});

test("the server's raw text never reaches the person; the request number stays on the error", async () => {
  fakeFetch(() => json({ type: "server", title: "KeyError: 'slot'", status: 500, request_id: "req-9" }, 500));
  await assert.rejects(request("GET", "/house"), (e) => e.requestId === "req-9" && !e.userMessage.includes("KeyError") && e.userMessage.startsWith("Algo deu errado do nosso lado"));
});

test("a session that ends mid-way is recovered and the same call goes again", async () => {
  let first = true;
  fakeFetch((path) => {
    if (path.endsWith("/staff/settings/booking") && first) {
      first = false;
      return json({ type: "session_expired", title: "Saiu", status: 401 }, 401);
    }
    return json({ saved: true });
  });
  setCsrfToken("tok");
  const seen = [];
  setRecovery(async (error, path) => {
    seen.push([error.type, path]);
    return true;
  });
  const answer = await request("PATCH", "/staff/settings/booking", { body: { a: 1 } });
  setRecovery(null);
  assert.deepEqual(answer, { saved: true });
  assert.deepEqual(seen, [["session_expired", "/staff/settings/booking"]]);
  assert.equal(calls.filter((c) => c.path.endsWith("/staff/settings/booking")).length, 2);
  assert.equal(calls[1].init.body, JSON.stringify({ a: 1 }), "what was typed goes again");
});

test("a 401 of the sign-in itself is the answer, not a lost session", async () => {
  fakeFetch(() => json({ type: "unauthorized", title: "E-mail ou senha não conferem", status: 401 }, 401));
  let asked = false;
  setRecovery(async () => (asked = true));
  await assert.rejects(request("POST", "/staff/auth/login", { body: {} }), { status: 401 });
  await assert.rejects(request("POST", "/staff/auth/reauth", { body: {} }), { status: 401 });
  await assert.rejects(request("POST", "/staff/pin/login", { body: {} }), { status: 401 });
  setRecovery(null);
  assert.equal(asked, false);
});

test("reauth_required (403) never counts as a lost session", async () => {
  fakeFetch(() => json({ type: "reauth_required", title: "Confirme que é você", status: 403 }, 403));
  setCsrfToken("tok");
  let asked = false;
  setRecovery(async () => (asked = true));
  await assert.rejects(request("POST", "/staff/devices/x/revoke", { body: {} }), { type: "reauth_required" });
  setRecovery(null);
  assert.equal(asked, false);
});

test("the house device signs method, path, time, body hash and nonce", async () => {
  fakeFetch(() => json({}));
  setCsrfToken("tok");
  let seen = null;
  setSigner(async (req) => {
    seen = req;
    return { "X-Device-Id": "d1", "X-Device-Signature": "sig" };
  });
  await request("POST", "/staff/pin/login", { body: { pin: "1234" }, query: { a: "b" } });
  setSigner(null);
  assert.deepEqual(seen, { method: "POST", path: "/api/v1/staff/pin/login?a=b", body: JSON.stringify({ pin: "1234" }) });
  assert.equal(calls.at(-1).init.headers["X-Device-Signature"], "sig");
});

// ---- If-Match, send() e os adaptadores (defeito 17, N5, história 4.1) ------------------------------

const { send, errorOf, capabilities } = await import("../../src/services/api/client.js");
const { isRealRoute, refuseInProduction, ROTAS_REAIS } = await import("../../src/services/api/rotas-reais.js");
const { CAPABILITIES, staticReply } = await import("../../src/services/api/static.js");

test("the version read goes in the If-Match header, never in the address", async () => {
  fakeFetch(() => json({ ok: true }));
  setCsrfToken("tok");
  await request("PATCH", "/staff/settings/booking", { body: { data: {} }, ifMatch: 7 });
  assert.equal(calls[0].init.headers["If-Match"], "7");
  assert.equal(calls[0].path, "/api/v1/staff/settings/booking");
  await request("PATCH", "/staff/settings/booking", { body: { data: {} } });
  assert.equal(calls[1].init.headers["If-Match"], undefined, "no version, no header");
});

test("no service sends the version as ?if_match= any more", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const dir = new URL("../../src/services/api/", import.meta.url);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
    assert.doesNotMatch(readFileSync(new URL(file, dir), "utf8"), /if_match/, file);
  }
});

test("send() signs like request() and gives the raw answer: the stream and the conditional read go signed", async () => {
  fakeFetch(() => new Response("event: ping\ndata: {}\n\n", { status: 200, headers: { "content-type": "text/event-stream" } }));
  setCsrfToken("tok");
  let signed = null;
  setSigner(async (req) => {
    signed = req;
    return { "X-Device-Signature": "sig" };
  });
  const response = await send("GET", "/staff/stream", { headers: { Accept: "text/event-stream" }, timeout: 0 });
  setSigner(null);
  assert.equal(await response.text(), "event: ping\ndata: {}\n\n");
  assert.deepEqual(signed, { method: "GET", path: "/api/v1/staff/stream", body: "" });
  assert.equal(calls[0].init.headers["X-Device-Signature"], "sig");
  assert.equal(calls[0].init.headers.Accept, "text/event-stream");
});

test("send() keeps the CSRF token on writes and errorOf() reads the problem", async () => {
  fakeFetch((path) => (path.endsWith("/staff/auth/session") ? json({ csrf_token: "tok-x" }) : json({ type: "reauth_required", title: "Confirme", status: 403 }, 403)));
  const response = await send("POST", "/staff/audit/export", { body: { from: "2026-10-01" } });
  assert.equal(calls.at(-1).init.headers["X-CSRF-Token"], "tok-x");
  const error = await errorOf(response);
  assert.equal(error.type, "reauth_required");
  assert.equal(error.status, 403);
});

test("staff-hoje's live stream and conditional read go through send() (signed)", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../../src/services/api/staff-hoje.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bfetch\(/, "no direct fetch left");
  assert.match(source, /send\("GET", "\/staff\/stream"/);
});

test("the http adapter can book; the static one cannot and refuses with static_mode", () => {
  assert.equal(capabilities.booking, true, "outside the static build");
  assert.deepEqual({ ...CAPABILITIES.static }, { mode: "static", booking: false, account: false, live: false, panel: false });
  assert.equal(staticReply("GET", "/house").whatsapp.startsWith("+55"), true, "the house's WhatsApp from the snapshot");
  assert.equal(staticReply("POST", "/reservations"), undefined);
  assert.equal(staticReply("GET", "/availability/days"), undefined);
});

test("ROTAS_REAIS starts empty, matches the contract's paths, and production refuses it", () => {
  assert.deepEqual(ROTAS_REAIS, []);
  const list = ["GET /house", "POST /staff/reservations/{id}/actions"];
  assert.equal(isRealRoute("GET", "/house", list), true);
  assert.equal(isRealRoute("POST", "/staff/reservations/abc/actions?x=1", list), true);
  assert.equal(isRealRoute("GET", "/staff/reservations/abc/actions", list), false);
  assert.throws(() => refuseInProduction("production", list), /ROTAS_REAIS/);
  assert.doesNotThrow(() => refuseInProduction("production", []));
  assert.doesNotThrow(() => refuseInProduction("development", list));
});
