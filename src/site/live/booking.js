// "Reservar mesa" abre a reserva sobre a página (história 4.6): um diálogo com o foco preso
// dentro, Esc e o botão de voltar do celular fecham e o foco volta para o botão que
// o abriu. Dentro roda a própria página /reservar/ (mesmo fluxo, mesmo código), então a reserva nunca
// difere entre a janela e a página. A janela pergunta antes de fechar quando algo já foi
// escolhido, e o que foi digitado continua lá se a pessoa abrir de novo. Nos celulares ela ocupa
// a tela inteira. Sem JavaScript todo link [data-book] simplesmente vai para /reservar/.

import { readyMessage, whatsappUrl } from "../../lib/cliente.js";
import { capabilities } from "../../services/api/client.js";
import { staticReply } from "../../services/api/static.js";

const STYLE_IN_FRAME = `
  .viga, .rodape, .skip-link, .cookies, .lingua, .demo-bar, .demo-bar-toggle { display: none !important; }
  body { padding-top: 0 !important; }
`;

/**
 * O site sem a API (história 4.1, AR-13): todo "Reservar mesa" vai direto para o
 * WhatsApp da casa com a mensagem pronta (pessoas e dia quando o link os traz).
 */
function toWhatsapp(t) {
  const phone = staticReply("GET", "/house")?.whatsapp;
  if (!phone) return;
  for (const link of document.querySelectorAll("a[data-book]")) {
    const url = new URL(link.getAttribute("href"), location.origin);
    const party = Number(url.searchParams.get("pessoas")) || null;
    const date = link.dataset.bookDay || url.searchParams.get("dia");
    const day = /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? `${date.slice(8, 10)}/${date.slice(5, 7)}` : null;
    link.href = whatsappUrl(phone, readyMessage(t, { party, day }));
    link.rel = "noopener";
    link.removeAttribute("data-book");
  }
}

export function bookingDialog({ t }) {
  if (!capabilities.booking) {
    toWhatsapp(t);
    return null;
  }
  // na própria página de reserva, e dentro da janela, os links continuam links
  if (/\/reservar\/?$/.test(location.pathname) || window.top !== window) return null;
  let dialog = null;
  let frame = null;
  let question = null;
  let opener = null;
  let dirty = false;
  let inHistory = false;

  function build() {
    dialog = document.createElement("dialog");
    dialog.className = "reserva-janela";
    dialog.setAttribute("aria-labelledby", "reserva-janela-titulo");
    const bar = document.createElement("div");
    bar.className = "reserva-janela__barra";
    const title = document.createElement("h2");
    title.id = "reserva-janela-titulo";
    title.className = "reserva-janela__titulo";
    title.textContent = t("site.bookDialog");
    const close = document.createElement("button");
    close.type = "button";
    close.className = "reserva-janela__fechar";
    close.setAttribute("aria-label", t("site.bookClose"));
    close.textContent = "×";
    close.addEventListener("click", () => requestClose());
    bar.append(title, close);
    frame = document.createElement("iframe");
    frame.className = "reserva-janela__quadro";
    frame.title = t("site.bookDialog");
    frame.addEventListener("load", wireFrame);
    question = document.createElement("div");
    question.className = "reserva-janela__pergunta";
    question.setAttribute("role", "alertdialog");
    question.setAttribute("aria-labelledby", "reserva-sair-titulo");
    question.setAttribute("aria-describedby", "reserva-sair-texto");
    question.hidden = true;
    const qTitle = document.createElement("p");
    qTitle.id = "reserva-sair-titulo";
    qTitle.className = "reserva-janela__pergunta-titulo";
    qTitle.textContent = t("site.bookLeaveTitle");
    const qText = document.createElement("p");
    qText.id = "reserva-sair-texto";
    qText.textContent = t("site.bookLeaveText");
    const stay = document.createElement("button");
    stay.type = "button";
    stay.className = "btn btn--sm";
    stay.dataset.stay = "";
    stay.textContent = t("site.bookLeaveStay");
    const leave = document.createElement("button");
    leave.type = "button";
    leave.className = "btn btn--sm btn--outline";
    leave.dataset.leave = "";
    leave.textContent = t("site.bookLeaveGo");
    const actions = document.createElement("div");
    actions.className = "reserva-janela__pergunta-acoes";
    actions.append(stay, leave);
    question.append(qTitle, qText, actions);
    stay.addEventListener("click", () => answer(false));
    leave.addEventListener("click", () => answer(true));
    dialog.append(bar, frame, question);
    // Esc: o cancelar do próprio diálogo, que pergunta antes quando algo foi escolhido
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      if (!question.hidden) answer(false);
      else requestClose();
    });
    dialog.addEventListener("close", () => {
      question.hidden = true;
      if (inHistory) {
        inHistory = false;
        history.back();
      }
      opener?.focus();
    });
    document.body.append(dialog);
  }

  /** A página de dentro: sem barra nem rodapé próprios, e toda escolha marca a janela como mudada. */
  function wireFrame() {
    try {
      const doc = frame.contentDocument;
      if (!doc) return;
      const style = doc.createElement("style");
      style.textContent = STYLE_IN_FRAME;
      doc.head.append(style);
      doc.documentElement.classList.add("em-janela");
      const mark = () => (dirty = true);
      doc.addEventListener("input", mark);
      doc.addEventListener("change", mark);
      // pessoas, dia e horário são escolhidos em botões (grupos de rádio), não em inputs
      doc.addEventListener("click", (event) => event.target.closest?.('[role="radio"]') && mark());
      // o Esc apertado dentro da reserva só chega à janela desta página por aqui
      doc.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || event.defaultPrevented || doc.querySelector("dialog[open]")) return;
        event.preventDefault();
        if (!question.hidden) answer(false);
        else requestClose();
      });
      // a reserva feita (o comprovante) não tem mais nada a perder
      if (/\/r\/?$/.test(frame.contentWindow.location.pathname)) dirty = false;
    } catch {
      /* outra origem: a janela ainda funciona, sem a pergunta */
    }
  }

  function open(link) {
    opener = link;
    if (!dialog) build();
    const url = new URL(link.getAttribute("href"), location.origin);
    url.searchParams.set("janela", "1");
    const src = `${url.pathname}${url.search}`;
    // a mesma reserva aberta de novo mantém o que foi digitado; outro dia, ou uma reserva já
    // feita, começa uma nova
    if (frame.dataset.src !== src || booked()) {
      frame.dataset.src = src;
      frame.src = src;
      dirty = false;
    }
    dialog.showModal();
    history.pushState({ reservaJanela: true }, "");
    inHistory = true;
    requestAnimationFrame(() => frame.focus());
  }

  /** A reserva já feita (o comprovante na tela): não sobra nada digitado a perder. */
  function booked() {
    try {
      return Boolean(frame.contentDocument?.querySelector(".reserva__pronto"));
    } catch {
      return false;
    }
  }

  function requestClose() {
    if (!dirty || booked()) return dialog.close();
    question.hidden = false;
    question.querySelector("[data-stay]").focus();
  }

  function answer(leave) {
    question.hidden = true;
    if (leave) dialog.close();
    else {
      if (!inHistory) {
        history.pushState({ reservaJanela: true }, "");
        inHistory = true;
      }
      frame.focus();
    }
  }

  // o botão de voltar do celular fecha a janela (perguntando antes), e a página fica onde estava
  addEventListener("popstate", () => {
    if (!dialog?.open || !inHistory) return;
    inHistory = false;
    requestClose();
  });

  document.addEventListener("click", (event) => {
    const link = event.target.closest?.("a[data-book]");
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    open(link);
  });
  return { open };
}
