// Números de WhatsApp dos três países em volta da casa: Brasil, Paraguai e
// Argentina. Tudo é guardado em E.164 (+5545999990000); só celulares são aceitos,
// porque a reserva fala com o cliente pelo WhatsApp.

const BR_DDD = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47,
  48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87,
  88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

// Argentina: 11 é Buenos Aires; estes são os outros códigos de área com 3 dígitos; o resto
// tem 4 (Puerto Iguazú é 3757). Usado só para escrever o número no formato legível.
const AR_AREA_3 = new Set([
  220, 221, 223, 230, 236, 237, 249, 260, 261, 263, 264, 266, 280, 291, 294, 297, 298, 299, 336, 341, 342, 343, 345, 348,
  351, 353, 358, 362, 364, 370, 376, 379, 380, 381, 383, 385, 387, 388,
]);
const arAreaLength = (national) => (national.startsWith("11") ? 2 : AR_AREA_3.has(Number(national.slice(0, 3))) ? 3 : 4);

export const COUNTRIES = [
  { id: "BR", dial: "55", label: "BR +55", name: "Brasil", example: "(45) 99999-0000" },
  { id: "PY", dial: "595", label: "PY +595", name: "Paraguai", example: "0981 123 456" },
  { id: "AR", dial: "54", label: "AR +54", name: "Argentina", example: "11 1234-5678" },
];

const digits = (s) => String(s ?? "").replace(/\D/g, "");

/** Transforma o que a pessoa digitou em E.164, ou null quando não é um celular válido. */
export function toE164(input, country = "BR") {
  let d = digits(input);
  if (String(input).trim().startsWith("+")) {
    const found = COUNTRIES.find((c) => d.startsWith(c.dial));
    if (!found) return null;
    country = found.id;
    d = d.slice(found.dial.length);
  }
  switch (country) {
    case "BR": {
      if (d.length === 13 && d.startsWith("55")) d = d.slice(2);
      d = d.replace(/^0+/, "");
      if (d.length !== 11) return null;
      if (!BR_DDD.has(Number(d.slice(0, 2))) || d[2] !== "9") return null;
      return `+55${d}`;
    }
    case "PY": {
      if (d.startsWith("595")) d = d.slice(3);
      d = d.replace(/^0+/, "");
      if (d.length !== 9 || d[0] !== "9") return null;
      return `+595${d}`;
    }
    case "AR": {
      if (d.startsWith("54")) d = d.slice(2);
      d = d.replace(/^0+/, "");
      if (d.length === 11 && d.startsWith("9")) d = d.slice(1);
      // costume local: código de área + "15" + número; o WhatsApp tira o 15
      const with15 = d.match(/^(\d{2,4})15(\d{6,8})$/);
      if (d.length === 12 && with15) d = with15[1] + with15[2];
      // "15" no começo quer dizer que falta o código de área: o número não existiria
      if (d.length !== 10 || d.startsWith("15")) return null;
      return `+549${d}`;
    }
    default:
      return null;
  }
}

export const isValidE164 = (e164) => toE164(e164) !== null;

const dialOf = (country) => COUNTRIES.find((c) => c.id === country)?.dial ?? "55";

/**
 * O que o campo diz sobre um número digitado (FR-20, história 7.4):
 * - unsupported: um país que não seja Brasil, Paraguai ou Argentina ("+1 …", "+34 …", "0034 …");
 * - e164: o número como o WhatsApp entende, ou null;
 * - corrected: os dígitos digitados tiveram de mudar para o WhatsApp (Argentina com o "15" ou sem
 *   o "9", Paraguai com o "0" na frente), então o campo pergunta "Confere?" antes de o código ir.
 */
export function phoneCheck(input, country = "BR") {
  const raw = String(input ?? "").trim();
  let d = digits(raw);
  const international = raw.startsWith("+") || (raw.startsWith("00") && d.length > 10);
  if (international) {
    if (!raw.startsWith("+")) d = d.slice(2);
    const found = COUNTRIES.find((c) => d.startsWith(c.dial));
    if (!found) return { e164: null, unsupported: d.length >= 2, corrected: false, country };
    country = found.id;
    d = d.slice(found.dial.length);
  }
  const e164 = toE164(international ? `+${dialOf(country)}${d}` : raw, country);
  if (!e164) return { e164: null, unsupported: false, corrected: false, country };
  const national = e164.slice(1 + dialOf(country).length);
  let typed = d;
  if (!international && typed.startsWith(dialOf(country)) && typed.length > national.length) typed = typed.slice(dialOf(country).length);
  return { e164, unsupported: false, corrected: country !== "BR" && typed !== national, country };
}

export function countryOf(e164) {
  const d = digits(e164);
  return COUNTRIES.find((c) => d.startsWith(c.dial))?.id ?? "BR";
}

/** Formato legível: "(45) 99999-0000", "+595 981 123 456", "+54 9 11 1234-5678". */
export function formatPhone(e164) {
  const d = digits(e164);
  if (d.startsWith("55") && d.length === 13) return `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.startsWith("595")) return `+595 ${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}`;
  if (d.startsWith("549") && d.length === 13) {
    const national = d.slice(3);
    const area = arAreaLength(national);
    const local = national.slice(area);
    return `+54 9 ${national.slice(0, area)} ${local.slice(0, -4)}-${local.slice(-4)}`;
  }
  return e164;
}

/** Esconde os dígitos do meio nas listas: "(45) 9••••-4994", "+595 9•• ••• 456", "+54 9 11 ••••-5678". */
export function maskPhone(e164) {
  const d = digits(e164);
  if (d.startsWith("55") && d.length === 13) return `(${d.slice(2, 4)}) ${d[4]}••••-${d.slice(9)}`;
  if (d.startsWith("595")) return `+595 ${d[3]}•• ••• ${d.slice(9)}`;
  if (d.startsWith("549") && d.length === 13) {
    const national = d.slice(3);
    return `+54 9 ${national.slice(0, arAreaLength(national))} ••••-${national.slice(-4)}`;
  }
  return "••••";
}
