// "{name} gravou antes de você": o 412 de uma planta, de um plano do dia ou de um evento. Mostra o que a
// outra pessoa mudou e deixa a equipe juntar as próprias mudanças por cima, ou descartá-las
// e ficar com a versão gravada. Agenda, Plantas e Eventos usam todos esta mesma janela.
import { html, nothing } from "../../../lib/html.js";
import { openSheet } from "./ui.js";

const shown = (value) => {
  if (value == null || value === "") return "vazio";
  if (Array.isArray(value)) return value.length ? value.map(shown).join(", ") : "vazio";
  if (typeof value === "object") return value.pt ?? JSON.stringify(value);
  if (value === true) return "sim";
  if (value === false) return "não";
  return String(value);
};

/** Os campos que diferem entre o que a tela leu e o que está gravado agora. */
export function changedFields(read, current, labels) {
  return Object.entries(labels)
    .filter(([key]) => JSON.stringify(read?.[key] ?? null) !== JSON.stringify(current?.[key] ?? null))
    .map(([key, label]) => ({ key, label, from: shown(read?.[key]), to: shown(current?.[key]) }));
}

/**
 * Abre a janela de conflito. `read` é o que a tela carregou, `current` o que o servidor tem
 * agora (o corpo do 412), `labels` os campos que valem nomear. Resolve "join", "discard" ou null.
 */
export async function askConflict({ error, read, current, labels }) {
  const changes = changedFields(read, current, labels);
  const sheet = openSheet({
    title: error?.title || "Outra pessoa gravou antes de você",
    size: "narrow",
    view: (close) => html`<p>Enquanto você mexia, outra pessoa gravou. ${changes.length ? "O que ela mudou:" : "Nada do que você vê na tela mudou."}</p>
      ${changes.length
        ? html`<ul class="ag-lista ag-conflito">
            ${changes.map((c) => html`<li><b>${c.label}</b> <span class="ag-troca">${c.from} <span aria-hidden="true">→</span><span class="sr-only">passou a</span> ${c.to}</span></li>`)}
          </ul>`
        : nothing}
      <p class="ag-ajuda">Juntar mantém as suas mudanças por cima da versão nova; depois é só gravar de novo.</p>
      <div class="dialog__actions">
        <button class="btn btn--outline" type="button" @click=${() => close("discard")}>Descartar as minhas</button>
        <button class="btn" type="button" @click=${() => close("join")}>Juntar com as minhas</button>
      </div>`,
  });
  sheet.dialog.querySelector(".dialog__actions .btn:not(.btn--outline)")?.focus();
  return (await sheet.done) ?? null;
}
