// O aparelho da casa (histórias 1.10 a 1.12, AD-26): a sua própria chave ECDSA P-256, feita pelo WebCrypto
// como não exportável e guardada no IndexedDB; a marca de que foi pareado, guardada à parte no
// localStorage para separar uma chave perdida de um navegador novo; a assinatura em todo pedido da
// sua sessão (id, hora, nonce, hash do corpo); e a abertura dessa sessão com um desafio assinado.
import { local, session } from "../../lib/storage.js";
import { setSigner } from "../../services/api/client.js";
import * as auth from "../../services/api/staff-auth.js";

const DB = "territorio-aparelho";
const STORE = "chaves";
const KEY_ID = "aparelho";
/** Fora do IndexedDB de propósito: só a marca de que este navegador foi pareado, e o id do aparelho. */
const MARK = "territorio:aparelho";
const IS_MOCK = import.meta.env?.VITE_API_MODE === "mock";

const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export const canHoldKey = () => Boolean(globalThis.crypto?.subtle && globalThis.indexedDB);

// ---- a chave no IndexedDB ----

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const result = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(result?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function readKey() {
  if (!canHoldKey()) return null;
  try {
    return (await withStore("readonly", (store) => store.get(KEY_ID))) || null;
  } catch {
    return null;
  }
}

async function writeKey(value) {
  await withStore("readwrite", (store) => store.put(value, KEY_ID));
}

export async function forgetKey() {
  try {
    await withStore("readwrite", (store) => store.delete(KEY_ID));
  } catch {
    // nada para esquecer
  }
}

// ---- a marca ----

/** { device_id, status: "pending"|"approved", code?, expires_at? } ou null. */
export const mark = () => local.get(MARK);
export const setMark = (value) => local.set(MARK, value);
export const clearMark = () => local.remove(MARK);

// ---- pareamento ----

/**
 * Pede ao navegador para manter os dados deste site (a chave mora lá). False quando ele ainda
 * pode apagar: negado, janela anônima ou perfil de visitante.
 */
export async function keepStorage() {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** Faz a chave (a metade privada nunca sai do navegador) e pede à API para parear. */
export async function requestPairing({ label, replaces } = {}) {
  if (!canHoldKey()) throw Object.assign(new Error("webcrypto"), { type: "webcrypto_unavailable" });
  let pair;
  try {
    pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
    const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    const pairing = await auth.devices.pair({ public_key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, label, user_agent: navigator.userAgent, replaces: replaces || undefined });
    await writeKey({ privateKey: pair.privateKey, publicKey: pair.publicKey, device_id: pairing.id, created_at: new Date().toISOString() });
    setMark({ device_id: pairing.id, status: "pending", code: pairing.code, expires_at: pairing.expires_at });
    return pairing;
  } catch (error) {
    if (error?.status || error?.type === "network" || error?.type === "timeout") throw error;
    throw Object.assign(new Error("webcrypto"), { type: "webcrypto_unavailable" });
  }
}

// ---- o relógio e a assinatura do aparelho ----

/** O relógio do próprio aparelho. A demonstração pode rodá-lo rápido ou devagar (?relogio=6) para ver a história 1.11. */
export function deviceNow() {
  if (!IS_MOCK) return Date.now();
  const fromUrl = new URLSearchParams(window.location.search).get("relogio");
  if (fromUrl !== null) session.set("territorio:demo-relogio", Number(fromUrl) || 0);
  return Date.now() + (Number(session.get("territorio:demo-relogio")) || 0) * 60_000;
}

async function sha256hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sign(privateKey, message) {
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, enc.encode(message));
  // o ?assinatura=errada da demonstração manda uma assinatura que não bate (história 1.11)
  if (IS_MOCK && session.get("territorio:demo-assinatura") === "errada") return b64url(new Uint8Array(64));
  return b64url(signature);
}

let held = null;

/** Começa a assinar todo pedido à API com a chave do aparelho (só enquanto ele tem uma). */
export async function startSigning() {
  if (IS_MOCK) {
    const flag = new URLSearchParams(window.location.search).get("assinatura");
    if (flag) session.set("territorio:demo-assinatura", flag);
  }
  held = await readKey();
  const current = mark();
  if (!held || !current || held.device_id !== current.device_id) {
    setSigner(null);
    return false;
  }
  setSigner(async ({ method, path, body }) => {
    const time = new Date(deviceNow()).toISOString();
    const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
    const message = `${method}\n${path}\n${time}\n${await sha256hex(body || "")}\n${nonce}`;
    return { "X-Device-Id": held.device_id, "X-Device-Time": time, "X-Device-Nonce": nonce, "X-Device-Signature": await sign(held.privateKey, message) };
  });
  return true;
}

export function stopSigning() {
  held = null;
  setSigner(null);
}

/** Minutos entre o relógio deste aparelho e o do servidor (positivo: o aparelho está adiantado). */
export const skewMinutes = (serverTime) => (deviceNow() - Date.parse(serverTime)) / 60_000;

/**
 * Abre a sessão do aparelho com um desafio assinado. Resolve a StaffSession, ou rejeita
 * com um problema que o painel mostra na própria tela do aparelho, na ordem da história 1.11:
 * webcrypto_unavailable, device_clock_skew, device_signature_invalid, device_key_lost.
 */
export async function openSession() {
  const current = mark();
  if (!canHoldKey()) throw Object.assign(new Error("webcrypto"), { type: "webcrypto_unavailable" });
  const challenge = await auth.devices.challenge(current.device_id);
  const skew = skewMinutes(challenge.server_time);
  if (Math.abs(skew) > 5) {
    throw Object.assign(new Error("clock"), { type: "device_signature_invalid", status: 401, body: { reason: "clock", skew_s: Math.round(skew * 60), server_time: challenge.server_time } });
  }
  const key = await readKey();
  if (!key || key.device_id !== current.device_id) throw Object.assign(new Error("key lost"), { type: "device_key_lost" });
  const opened = await auth.devices.open({
    device_id: current.device_id,
    challenge_id: challenge.challenge_id,
    signature: await sign(key.privateKey, challenge.challenge),
    device_time: new Date(deviceNow()).toISOString(),
  });
  await startSigning();
  return { ...opened, skew };
}

/** Volta a um aparelho que nunca foi pareado: sem chave, sem marca, sem assinatura. */
export async function unpair() {
  stopSigning();
  clearMark();
  await forgetKey();
}
