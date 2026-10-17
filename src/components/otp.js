// Entrada do código em seis caixas. É um input de verdade (para o celular preencher o código da
// mensagem do WhatsApp sozinho) desenhado como seis caixas. Sem maxlength: um "123 456" ou "Seu código:
// 123456" colado mantém os seis dígitos.
//   <div class="otp"><input class="otp__input" inputmode="numeric" autocomplete="one-time-code">
//   <div class="otp__boxes" aria-hidden="true"><span></span>×6</div></div>

export function otpInput(root, { onComplete } = {}) {
  const input = root.querySelector(".otp__input");
  const boxes = [...root.querySelectorAll(".otp__boxes span")];

  const draw = () => {
    const value = input.value;
    boxes.forEach((box, i) => {
      box.textContent = value[i] || "";
      box.classList.toggle("is-current", document.activeElement === input && i === Math.min(value.length, 5));
    });
  };
  const take = (text) => {
    input.value = String(text).replace(/\D/g, "").slice(0, 6);
    draw();
    if (input.value.length === 6) onComplete?.(input.value);
  };

  input.addEventListener("input", () => take(input.value));
  input.addEventListener("paste", (event) => {
    const text = event.clipboardData?.getData("text");
    if (text == null) return;
    event.preventDefault();
    take(text);
  });
  input.addEventListener("focus", draw);
  input.addEventListener("blur", draw);
  draw();

  return {
    get value() {
      return input.value;
    },
    clear() {
      input.value = "";
      draw();
      input.focus();
    },
  };
}
