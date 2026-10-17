// Regras dos campos usadas pela reserva e pelo painel. Elas só ajudam quem está digitando:
// a API confere tudo de novo. Cada regra devolve null quando o valor está certo,
// ou a mensagem a mostrar embaixo do campo.
import { toE164 } from "./phone.js";
import { t } from "./strings.js";

const LINK = /(https?:\/\/|www\.|\.com\b|\.br\b)/i;
// eslint-disable-next-line no-control-regex -- tirar caracteres de controle é justamente o objetivo
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export const cleanText = (value) => String(value ?? "").replace(CONTROL, "").trim();

export const rules = {
  name(value) {
    // o iPhone digita ’ como apóstrofo
    const v = cleanText(value).replace(/[’ʼ]/g, "'").replace(/\s+/g, " ");
    if (!v) return t("validation.required");
    if (v.length < 2) return t("validation.nameShort");
    if (v.length > 60) return t("validation.nameLong");
    if (LINK.test(v)) return t("validation.noLinks");
    if (!/^[\p{L}][\p{L}\p{M}' .-]*$/u.test(v)) return t("validation.nameChars");
    return null;
  },
  phone(value, country = "BR") {
    if (!cleanText(value)) return t("validation.required");
    return toE164(value, country) ? null : t("validation.phone");
  },
  notes(value, max = 280) {
    const v = cleanText(value);
    if (v.length > max) return t("validation.notesLong", { max });
    if (LINK.test(v)) return t("validation.noLinks");
    return null;
  },
  partySize(value, max) {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 && n <= max ? null : t("validation.party", { max });
  },
  otp(value) {
    return /^\d{6}$/.test(String(value ?? "")) ? null : t("validation.otp");
  },
  email(value) {
    const v = cleanText(value);
    if (!v) return t("validation.required");
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? null : t("validation.email");
  },
  password(value) {
    return String(value ?? "").length >= 12 ? null : t("validation.password");
  },
  agree(checked) {
    return checked ? null : t("validation.agree");
  },
};
