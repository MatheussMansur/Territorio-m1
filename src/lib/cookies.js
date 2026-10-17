// Cookies e armazenamento do navegador sob o consentimento do visitante. Só nomes de cookie-registry.js
// podem ser gravados, e só quando a categoria deles é permitida: necessary sempre, "remember" e
// "measurement" depois de um sim no aviso. Retirar uma categoria apaga o que ela guardou.
//
// Configurações › Cookies (história 2.19) chega às páginas por GET /house: uma versão nova do
// texto do aviso anula toda escolha anterior (o aviso pergunta de novo), e a medição
// desligada pela casa fica bloqueada seja o que for que o visitante disse (defeito 16).
import privacy from "../content/privacy.json" with { type: "json" };
import { byName, CATEGORIES, COOKIES } from "./cookie-registry.js";
import { local } from "./storage.js";

const CONSENT = "trt_consent";
/** Uma escolha feita numa política antiga não conta mais: o aviso pergunta de novo. */
export const CONSENT_VERSION = privacy.version;
const listeners = new Set();
let liveVersion = null;
let measurementAvailable = true;

/** A versão que uma escolha precisa ter: a da política, ou a mais nova do aviso nas configurações. */
export const currentVersion = () => (liveVersion && liveVersion > CONSENT_VERSION ? liveVersion : CONSENT_VERSION);

/**
 * O que Configurações › Cookies diz agora (GET /house → settings.cookies). Devolve true quando a
 * escolha do visitante deixou de valer e o aviso precisa perguntar de novo.
 */
export function applySettings({ banner_version: version = null, measurement_enabled: measurement = true } = {}) {
  const before = consent();
  liveVersion = typeof version === "string" && version ? version : null;
  measurementAvailable = measurement !== false;
  if (!measurementAvailable) forgetCategory("measurement");
  return Boolean(before) && !consent();
}

/** False quando a casa desligou a medição: o aviso não a oferece e nada é medido. */
export const measurementOffered = () => measurementAvailable;

function entry(name) {
  const found = byName(name);
  if (!found) throw new Error(`cookie fora do registro: ${name}`);
  if (found.by !== "page") throw new Error(`cookie do servidor não se escreve pela página: ${name}`);
  return found;
}

// ---- acesso direto aos cookies (próprios, path /, SameSite=Lax, Secure em https) ----

export function readCookie(name) {
  const prefix = `${name}=`;
  for (const part of String(globalThis.document?.cookie || "").split(/;\s*/)) {
    if (part.startsWith(prefix)) {
      try {
        return decodeURIComponent(part.slice(prefix.length));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function writeCookie(name, value, maxAge) {
  const secure = globalThis.location?.protocol === "https:" ? "; Secure" : "";
  const age = maxAge == null ? "" : `; Max-Age=${maxAge}`;
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax${age}${secure}`;
}

function eraseCookie(name) {
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
}

// ---- consentimento ----

/** { version, necessary: true, remember, measurement, at, id } desta política, ou null. */
export function consent() {
  try {
    const value = JSON.parse(readCookie(CONSENT) || "null");
    // versões são datas (YYYY-MM-DD): uma escolha feita nesta versão ou numa mais nova vale
    return typeof value?.version === "string" && value.version >= currentVersion() ? value : null;
  } catch {
    return null;
  }
}

export function allowed(category) {
  if (category === "necessary") return true;
  if (category === "measurement" && !measurementAvailable) return false;
  return consent()?.[category] === true;
}

/** Salva a escolha e apaga o que uma categoria recusada tinha guardado. */
export function saveConsent(choice) {
  const value = { remember: false, measurement: false, ...choice, necessary: true, version: currentVersion(), at: new Date().toISOString() };
  if (!measurementAvailable) value.measurement = false;
  writeCookie(CONSENT, JSON.stringify(value), entry(CONSENT).maxAge);
  for (const category of CATEGORIES) if (!value[category]) forgetCategory(category);
  for (const fn of listeners) fn(value);
  return value;
}

/** Roda fn(choice) toda vez que o visitante decide (para começar ou parar de medir, por exemplo). */
export function onConsent(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function forgetCategory(category) {
  for (const c of COOKIES) {
    if (c.category !== category || c.by !== "page") continue;
    if (c.kind === "cookie") eraseCookie(c.name);
    else local.remove(c.name);
  }
}

// ---- leitura e gravação de um nome registrado ----

/** O valor guardado, ou null quando não existe, expirou ou a categoria não é permitida. */
export function get(name) {
  const c = entry(name);
  if (!allowed(c.category)) return null;
  if (c.kind === "cookie") return readCookie(name);
  const saved = local.get(name);
  if (!saved) return null;
  if (c.maxAge != null && Date.now() - saved.at > c.maxAge * 1000) {
    local.remove(name);
    return null;
  }
  return saved.value;
}

/** Grava quando a categoria é permitida; senão devolve false (e não grava nada). */
export function set(name, value) {
  const c = entry(name);
  if (!allowed(c.category)) return false;
  if (c.kind === "cookie") writeCookie(name, String(value), c.maxAge);
  else local.set(name, { value, at: Date.now() });
  return true;
}

export function remove(name) {
  const c = entry(name);
  if (c.kind === "cookie") eraseCookie(name);
  else local.remove(name);
}
