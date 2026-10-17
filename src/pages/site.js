// O scriptzinho das páginas públicas. A página já está completa sem ele; ele só acrescenta:
// a troca de tema, a escolha de cookies, as abas do cardápio, a barra de ferro sobre a capa, as fotos
// abertas em tamanho grande, a sugestão de idioma, a janela de reserva, e as partes ao vivo lidas da
// API da casa: "Aberto agora", "Hoje na casa", os textos publicados no painel, "acabou", a
// ordem e os créditos da galeria e os eventos. Com a API fora do ar a página impressa fica, sem
// erro na tela.
import "../styles/main.css";
import "../styles/site.css";
import "../site/live.css";
import { boot } from "../app/boot.js";
import { houseParts } from "../lib/dates.js";
import { html, render } from "../lib/html.js";
import { setLocale, t } from "../lib/strings.js";
import * as api from "../services/api/index.js";
import { bookingDialog } from "../site/live/booking.js";
import { renderAgenda, renderEventPage } from "../site/live/events.js";
import { deviceElsewhere, inLang, openLine, todayLine, weekDays } from "../site/live/house-day.js";
import { languageSuggestion } from "../site/live/language.js";
import { applyMenu, dishOfTheDay } from "../site/live/menu.js";
import { cookies, cookieSettings, themeToggle } from "./site-chrome.js";

const locale = () => document.documentElement.dataset.locale || "pt";
const MENU_EVERY_MS = 30_000; // "acabou" chega ao site em até um minuto (NFR-8)

/** A barra de ferro é transparente sobre a capa e vira ferro quando a capa sai da tela. */
function viga() {
  const bar = document.querySelector("[data-viga].viga--capa");
  const cover = document.querySelector(".capa");
  if (!bar || !cover) return;
  const update = () => bar.classList.toggle("is-transparente", cover.getBoundingClientRect().bottom > bar.offsetHeight + 8);
  update();
  addEventListener("scroll", update, { passive: true });
}

/** O bloco do cardápio: sem o script toda folha aparece; com ele, as abas trocam folha e foto. */
function menuTabs() {
  const root = document.querySelector("[data-tabs]");
  if (!root) return;
  const tabs = [...root.querySelectorAll("[data-tab]")];
  const show = (id, focus = false) => {
    for (const tab of tabs) {
      const on = tab.dataset.tab === id;
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      if (on && focus) tab.focus();
    }
    for (const el of root.querySelectorAll("[data-tab-panel], [data-tab-photo]")) {
      el.classList.toggle("is-ativa", (el.dataset.tabPanel || el.dataset.tabPhoto) === id);
    }
  };
  root.classList.add("is-ligado");
  show(tabs[0]?.dataset.tab);
  root.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-tab]");
    if (!tab) return;
    event.preventDefault();
    show(tab.dataset.tab);
  });
  root.addEventListener("keydown", (event) => {
    const index = tabs.indexOf(document.activeElement);
    if (index < 0) return;
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    show(tabs[(index + step + tabs.length) % tabs.length].dataset.tab, true);
  });
}

/**
 * As fotos do lugar abrem grandes numa moldura de ferro: as setas (na tela e no teclado) passam
 * por elas, Esc fecha e o foco volta para a foto. Sem o script cada
 * foto é um link simples para o arquivo grande. Sem carrossel. A ordem é lida quando abre, para
 * as setas seguirem a ordem ao vivo da galeria (vinda do painel).
 */
function gallery() {
  const grid = document.querySelector("[data-galeria]");
  if (!grid) return;
  const links = () => [...grid.querySelectorAll("[data-galeria-foto]")];
  const t = (key) => grid.dataset[key];
  const dialog = document.createElement("dialog");
  dialog.className = "lampiao";
  render(
    html`<figure>
      <img alt="" />
      <figcaption>
        <span data-legenda></span>
        <span class="lampiao__acoes">
          <button type="button" data-ir="-1" aria-label=${t("prev")}>←</button>
          <button type="button" data-ir="1" aria-label=${t("next")}>→</button>
          <button type="button" data-fechar aria-label=${t("close")}>✕</button>
        </span>
      </figcaption>
    </figure>`,
    dialog,
  );
  document.body.append(dialog);
  const img = dialog.querySelector("img");
  const caption = dialog.querySelector("[data-legenda]");
  let index = 0;
  let opener = null;
  const show = (i) => {
    const list = links();
    index = (i + list.length) % list.length;
    const link = list[index];
    img.src = link.getAttribute("href");
    img.alt = link.querySelector("img")?.alt || "";
    caption.textContent = `${link.querySelector(".galeria__legenda")?.textContent || ""} · ${t("count").replace("{n}", index + 1).replace("{total}", list.length)}`;
  };
  grid.addEventListener("click", (event) => {
    const link = event.target.closest("[data-galeria-foto]");
    if (!link) return;
    event.preventDefault();
    opener = link;
    show(links().indexOf(link));
    dialog.showModal();
  });
  dialog.addEventListener("click", (event) => {
    const step = event.target.closest("[data-ir]");
    if (step) show(index + Number(step.dataset.ir));
    else if (event.target.closest("[data-fechar]") || event.target === dialog) dialog.close();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight") show(index + 1);
    else if (event.key === "ArrowLeft") show(index - 1);
  });
  dialog.addEventListener("close", () => opener?.focus());
}

/**
 * O selo da capa: o 3D do site aprovado nas telas grandes, começando depois que o título
 * se escreveu (2,1 s depois de a página abrir). Celulares, movimento reduzido ou falta de WebGL ficam com o
 * desenho plano, que então faz a sua própria entrada.
 */
function seal() {
  const stage = document.querySelector("[data-selo]");
  if (!stage || matchMedia("(max-width: 860px), (prefers-reduced-motion: reduce)").matches) return;
  stage.classList.add("is-3d");
  const flat = () => {
    stage.classList.remove("is-3d");
    stage.style.setProperty("--selo-inicio", "0s");
  };
  import("../components/seal-3d.js")
    .then(({ mountSeal }) => {
      setTimeout(() => {
        try {
          mountSeal(stage, { color: "#F3E6CC", lightColor: "#F0B060", duration: 2.2, shadowOpacity: 0.22 });
        } catch {
          flat();
        }
      }, Math.max(0, 2100 - performance.now()));
    })
    .catch(flat);
}

// ---- as partes ao vivo --------------------------------------------------------------------

/** O que o build imprimiu para "Hoje na casa" (avisos com a validade, frases, horários). */
function buildData() {
  try {
    return JSON.parse(document.getElementById("hoje-dados")?.textContent || "null");
  } catch {
    return null;
  }
}

/** "Aberto agora" no idioma da página, pelo relógio do servidor; "horário de Foz" quando o aparelho está em outro lugar. */
function showOpen(house) {
  const target = document.querySelector('[data-live="open-status"]');
  if (!target || !house?.days?.length) return;
  const instant = new Date(house.server_time || Date.now());
  const status = openLine(house.days, instant, t);
  const text = target.querySelector("b") || target;
  text.textContent = status.text;
  target.classList.toggle("is-open", status.open);
  target.dataset.state = status.open ? "open" : "closed";
  const foz = target.querySelector('[data-live="foz-time"]');
  if (foz) foz.hidden = !deviceElsewhere(instant);
}

/** "Hoje na casa": dados ao vivo quando há, os do build senão, sempre pelo relógio da casa. */
function showToday({ house, content, menu }) {
  const target = document.querySelector('[data-live="today"]');
  const data = buildData();
  if (!target || !data) return;
  const instant = new Date(house?.server_time || content?.server_time || Date.now());
  const days = house?.days?.length ? house.days : weekDays(data.hours, houseParts(instant).date);
  const tonight = (content?.events || []).find((e) => e.tonight || e.date === houseParts(instant).date);
  const line = todayLine({
    notices: content ? content.notices || [] : data.notices,
    rules: content ? content.today_rules || {} : data.rules,
    fallback: content ? content.today_default : data.fallback,
    days,
    dish: dishOfTheDay(menu),
    eventTitle: tonight ? inLang(tonight.title_i18n, locale()) : null,
    instant,
    t,
    locale: locale(),
  });
  if (line.text) target.textContent = line.text;
  target.dataset.kind = line.kind;
}

/** Os textos da capa e da casa como publicados no painel (no lugar dos do build). */
function showTexts(texts) {
  for (const el of document.querySelectorAll("[data-text]")) {
    const [block, field] = el.dataset.text.split(".");
    const text = inLang(texts?.[block]?.[field], el.dataset.textLang || locale());
    if (text) el.textContent = text;
  }
}

/** "Ambiente" na ordem da galeria, com o crédito de cada foto (história 3.8). */
function showGallery(photos) {
  const grid = document.querySelector("[data-galeria]");
  if (!grid || !photos?.length) return;
  const items = new Map([...grid.querySelectorAll("[data-photo]")].map((li) => [li.dataset.photo, li]));
  const ordered = photos.map((p) => items.get(p.key)).filter(Boolean);
  for (const li of items.values()) if (!ordered.includes(li)) ordered.push(li);
  for (const li of ordered) grid.append(li);
  for (const p of photos) {
    const credit = items.get(p.key)?.querySelector("[data-credit]");
    if (!credit) continue;
    credit.textContent = p.credit ? t("site.galleryCredit", { credit: p.credit }) : "";
    credit.hidden = !p.credit;
  }
}

async function live() {
  const needsMenu = Boolean(document.querySelector("[data-item]")) || Boolean(document.querySelector('[data-live="today"]'));
  const [house, content, menu] = await Promise.all([
    api.house.getHouse().catch(() => null),
    api.house.getContent().catch(() => null),
    needsMenu ? api.house.getMenu().catch(() => null) : null,
  ]);
  if (house?.settings?.cookies) cookieSettings(house.settings.cookies);
  showOpen(house);
  showToday({ house, content, menu });
  if (content) {
    showTexts(content.texts);
    showGallery(content.gallery);
    renderAgenda(content.events || [], { t, locale: locale(), agenda: content.settings?.events?.site_agenda });
    renderEventPage(content.events || [], { t, locale: locale() });
  }
  if (menu) applyMenu(menu, t);
  if (document.querySelector("[data-item]")) {
    // "acabou" marcado no painel aparece aqui em até um minuto, enquanto a página está à vista
    setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      const fresh = await api.house.getMenu().catch(() => null);
      if (fresh) applyMenu(fresh, t);
    }, MENU_EVERY_MS);
  }
}

boot(async () => {
  setLocale(document.documentElement.lang);
  themeToggle();
  cookies();
  viga();
  menuTabs();
  gallery();
  seal();
  languageSuggestion();
  bookingDialog({ t });
  await live();
});
