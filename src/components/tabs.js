// Abas ARIA: as setas andam e abrem a próxima aba; cada aba controla um painel. Várias
// abas podem controlar o mesmo painel (uma tabela mostrada em estados diferentes): ele fica visível
// enquanto qualquer uma delas estiver selecionada.
//   <div role="tablist"> <button role="tab" aria-selected aria-controls="panel-id">
//   <div role="tabpanel" id="panel-id">

export function tabs(tablist, { onChange } = {}) {
  const all = () => [...tablist.querySelectorAll('[role="tab"]')];

  const select = (tab, { focus = false } = {}) => {
    const shown = tab.getAttribute("aria-controls");
    for (const t of all()) {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      const id = t.getAttribute("aria-controls");
      const panel = document.getElementById(id);
      if (panel) panel.hidden = id !== shown;
    }
    if (focus) tab.focus();
    onChange?.(tab);
  };

  tablist.addEventListener("click", (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (tab) select(tab);
  });
  tablist.addEventListener("keydown", (event) => {
    const list = all();
    const index = list.indexOf(event.target.closest('[role="tab"]'));
    if (index < 0) return;
    const moves = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    let next;
    if (event.key in moves) next = list[(index + moves[event.key] + list.length) % list.length];
    else if (event.key === "Home") next = list[0];
    else if (event.key === "End") next = list.at(-1);
    else return;
    event.preventDefault();
    select(next, { focus: true });
  });

  const initial = all().find((t) => t.getAttribute("aria-selected") === "true") || all()[0];
  if (initial) select(initial);
  return { select };
}
