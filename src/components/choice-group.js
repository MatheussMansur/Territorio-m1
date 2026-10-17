// Grupos de escolha única (pessoas, dia, horário) como grupos de rádio ARIA: uma parada de Tab,
// as setas vão para a próxima opção e a escolhem (o padrão de rádio), Espaço ou Enter escolhe.
// Uma tela que carrega algo a cada escolha deve esperar um instante antes de carregar. Funciona com HTML desenhado pelo
// lit-html: chame `syncChoiceGroup` depois de cada desenho.
//   <div role="radiogroup" aria-labelledby="…"> <button role="radio" aria-checked="…" data-value="…">

const OPTION = '[role="radio"]';

const enabled = (group) => [...group.querySelectorAll(OPTION)].filter((o) => !o.disabled && o.getAttribute("aria-disabled") !== "true");

/** Só a opção escolhida (ou a primeira que dá para usar) é alcançada com Tab. */
export function syncChoiceGroup(group) {
  const options = [...group.querySelectorAll(OPTION)];
  const usable = enabled(group);
  const chosen = usable.find((o) => o.getAttribute("aria-checked") === "true") || usable[0];
  for (const o of options) o.tabIndex = o === chosen ? 0 : -1;
}

/** Liga teclado e clique uma vez só; `onPick(value, option)` roda quando uma opção é escolhida. */
export function choiceGroup(group, onPick) {
  const pick = (option) => {
    if (!option || option.disabled || option.getAttribute("aria-disabled") === "true") return;
    onPick(option.dataset.value, option);
  };

  group.addEventListener("click", (event) => pick(event.target.closest(OPTION)));
  group.addEventListener("keydown", (event) => {
    const current = event.target.closest(OPTION);
    if (!current) return;
    const usable = enabled(group);
    const index = usable.indexOf(current);
    let next;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = usable[(index + 1) % usable.length];
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = usable[(index - 1 + usable.length) % usable.length];
        break;
      case "Home":
        next = usable[0];
        break;
      case "End":
        next = usable.at(-1);
        break;
      case " ":
      case "Enter":
        event.preventDefault();
        pick(current);
        return;
      default:
        return;
    }
    event.preventDefault();
    for (const o of usable) o.tabIndex = o === next ? 0 : -1;
    next.focus();
    pick(next);
  });
  syncChoiceGroup(group);
}
