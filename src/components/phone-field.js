// Campo de WhatsApp com o país ao lado. Ao sair do campo o número é conferido
// e reescrito no formato legível; `value` é sempre E.164 ou null. Um número digitado com
// o próprio "+código" muda o seletor de país para combinar.
// Quando o número teve de mudar para o WhatsApp (Argentina com o "15" ou sem o "9",
// Paraguai com o "0" na frente) o campo pergunta "Confere?" e o código só vai depois de um sim.
// Um país que não seja Brasil, Paraguai ou Argentina mostra phone_country_unsupported com o
// WhatsApp da casa (a página dá a mensagem pronta por `whatsappFor`). História 7.4.
import { errorMessage } from "../lib/errors.js";
import { formatPhone, phoneCheck } from "../lib/phone.js";
import { t } from "../lib/strings.js";
import { rules } from "../lib/validate.js";
import { setFieldError, setFieldValid } from "./field.js";

let seq = 0;

export function phoneField(root, { whatsappFor = () => "", onChange = () => {} } = {}) {
  const country = root.querySelector("select");
  const input = root.querySelector("input");
  const id = `fone-${++seq}`;
  let confirmedFor = null;
  // o número que teve de mudar para o WhatsApp: depois de reescrito ele vale como digitado certo, então fica
  let needConfirm = null;
  let last = { e164: null, corrected: false, unsupported: false };

  const confere = document.createElement("div");
  confere.className = "phone__confere";
  confere.hidden = true;
  confere.setAttribute("role", "group");
  confere.setAttribute("aria-labelledby", `${id}-confere-texto`);
  const fora = document.createElement("p");
  fora.className = "phone__fora";
  fora.hidden = true;
  root.append(confere, fora);

  const state = () => ({
    e164: last.e164,
    unsupported: last.unsupported,
    corrected: Boolean(needConfirm),
    confirmed: !needConfirm || confirmedFor === needConfirm,
  });

  const showConfere = (e164) => {
    confere.hidden = false;
    confere.replaceChildren();
    const text = document.createElement("p");
    text.id = `${id}-confere-texto`;
    const strong = document.createElement("strong");
    strong.textContent = t("cliente.phone.confere", { phone: formatPhone(e164) });
    text.append(strong, " ", t("cliente.phone.confereHelp"));
    const yes = document.createElement("button");
    yes.type = "button";
    yes.className = "btn btn--sm";
    yes.textContent = t("cliente.phone.yes");
    yes.addEventListener("click", () => {
      confirmedFor = e164;
      confere.hidden = true;
      onChange(state());
      input.focus();
    });
    const fix = document.createElement("button");
    fix.type = "button";
    fix.className = "btn btn--outline btn--sm";
    fix.textContent = t("cliente.phone.fix");
    fix.addEventListener("click", () => {
      input.focus();
      input.select();
    });
    const actions = document.createElement("div");
    actions.className = "phone__confere-acoes";
    actions.append(yes, fix);
    confere.append(text, actions);
  };

  const showFora = (show) => {
    fora.hidden = !show;
    fora.replaceChildren();
    if (!show) return;
    const link = document.createElement("a");
    link.className = "btn btn--outline btn--sm";
    link.href = whatsappFor() || "#";
    link.rel = "noopener";
    link.textContent = t("cliente.phone.whatsappOther");
    fora.append(link);
  };

  const check = ({ show = true } = {}) => {
    const result = phoneCheck(input.value, country.value);
    last = result;
    if (result.corrected) needConfirm = result.e164;
    else if (result.e164 !== needConfirm) needConfirm = null;
    if (result.unsupported) {
      setFieldError(input, errorMessage("phone_country_unsupported"));
      setFieldValid(input, false);
      confere.hidden = true;
      showFora(true);
    } else if (result.e164) {
      country.value = result.country;
      setFieldError(input, null); // um número corrigido tira a mensagem antiga na hora
      input.value = formatPhone(result.e164);
      setFieldValid(input, true);
      showFora(false);
      if (needConfirm && confirmedFor !== needConfirm) showConfere(needConfirm);
      else confere.hidden = true;
    } else {
      showFora(false);
      confere.hidden = true;
      if (show) setFieldError(input, input.value.trim() ? rules.phone(input.value, country.value) : null);
      setFieldValid(input, false);
    }
    onChange(state());
    return result;
  };

  input.addEventListener("blur", () => check());
  input.addEventListener("input", () => {
    if (root.classList.contains("field--invalid")) check({ show: false });
  });
  // um país novo com um número digitado com outro "+código": esse número era do outro país
  country.addEventListener("change", () => {
    if (input.value.trim().startsWith("+") && phoneCheck(input.value).country !== country.value) {
      input.value = "";
      needConfirm = null;
      confere.hidden = true;
      showFora(false);
      setFieldError(input, null);
      setFieldValid(input, false);
      return;
    }
    if (input.value) check();
  });

  return {
    get value() {
      return phoneCheck(input.value, country.value).e164;
    },
    get state() {
      return state();
    },
    /** E.164 quando pronto para usar; null (com a mensagem na tela) quando não, ou enquanto "Confere?" espera. */
    validate() {
      if (!input.value.trim()) {
        setFieldError(input, rules.phone(""));
        return null;
      }
      const result = check();
      if (!result.e164) return null;
      if (needConfirm && confirmedFor !== needConfirm) {
        confere.querySelector("button")?.focus();
        return null;
      }
      return result.e164;
    },
    /** Um número já confirmado antes (um rascunho trazido de volta depois de recarregar). */
    trust(e164) {
      confirmedFor = e164;
    },
    focus() {
      input.focus();
    },
  };
}
