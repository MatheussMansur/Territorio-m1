// Um <dialog> usado como janela modal: o foco entra, a página para de rolar, Esc, o X
// e um clique no fundo fecham a janela (perguntando antes quando algo foi digitado), e o foco
// volta para o botão que a abriu.
import { t } from "../lib/strings.js";
import { confirmAction } from "./confirm.js";

export function openDialog(dialog, { isDirty = () => false, discard, onClose } = {}) {
  if (dialog.open) return { close: () => dialog.close() };
  const opener = document.activeElement;
  dialog.showModal();
  document.documentElement.classList.add("is-locked");

  const close = () => dialog.open && dialog.close();
  const tryClose = async () => {
    if (!isDirty()) return close();
    const ok = await confirmAction({
      title: discard?.title ?? t("common.discardTitle"),
      message: discard?.message ?? t("common.discardMessage"),
      confirmLabel: discard?.confirmLabel ?? t("common.discard"),
      cancelLabel: discard?.cancelLabel ?? t("common.keepGoing"),
      danger: true,
    });
    if (ok) close();
  };

  const onCancel = (event) => {
    event.preventDefault();
    tryClose();
  };
  // a própria caixa do diálogo também recebe cliques no espaço vazio da borda interna: só um clique fora
  // do retângulo dela conta como fundo
  const onClick = (event) => {
    if (event.target.closest("[data-close]")) return tryClose();
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
    if (!inside) tryClose();
  };
  dialog.addEventListener("cancel", onCancel);
  dialog.addEventListener("click", onClick);
  dialog.addEventListener(
    "close",
    () => {
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("click", onClick);
      if (!document.querySelector("dialog[open]")) document.documentElement.classList.remove("is-locked");
      if (opener instanceof HTMLElement) opener.focus();
      onClose?.();
    },
    { once: true },
  );
  return { close };
}
