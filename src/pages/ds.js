// O catálogo do design system: todo componente em todo estado, mais uma chamada ao vivo para a
// API simulada, para ver os estados de carregando, erro e vazio com a barra de demonstração.
import "../styles/main.css";
import "../styles/ds.css";
import { boot } from "../app/boot.js";
import { choiceGroup, syncChoiceGroup } from "../components/choice-group.js";
import { confirmAction } from "../components/confirm.js";
import { openDialog } from "../components/dialog.js";
import { otpInput } from "../components/otp.js";
import { phoneField } from "../components/phone-field.js";
import { mountSeals, sealTemplate } from "../components/seal.js";
import { tabs } from "../components/tabs.js";
import { toast } from "../components/toast.js";
import { formatDay, houseParts, openStatus } from "../lib/dates.js";
import { $, html, render } from "../lib/html.js";
import { formatPhone } from "../lib/phone.js";
import { t } from "../lib/strings.js";
import { availability, house } from "../services/api/index.js";

// As duas paletas da casa e as cores dos cardápios impressos.
const SWATCHES = {
  swatches: [
    ["--marsala", "Seleção, carimbo, atenção (avental)"],
    ["--off-white", "Painéis e campos"],
    ["--mescla", "Faixas e o que é secundário"],
    ["--preto-lavado", "Esquadria, texto, botão principal"],
    ["--papel", "Fundo da página (off white com mescla)"],
    ["--kraft", "Seções alternadas (mescla clara)"],
    ["--tinta-2", "Texto secundário"],
    ["--tinta-3", "Rótulos e desativado"],
    ["--terracota-escura", "Marsala escuro: texto de atenção, erro"],
    ["--noite", "Capa e fundos noturnos"],
    ["--lampada", "A frase da capa, pouco"],
  ],
  "swatches-food-club": [
    ["--fc-vermelho", "Destaque dos produtos Food Club"],
    ["--fc-marinho", "Fundo e texto dos produtos Food Club"],
    ["--fc-creme", "Superfície clara do Food Club"],
    ["--fc-branco", "Estampa e superfície"],
  ],
  "swatches-cardapio": [
    ["--folha-preta", "Folha do ramen"],
    ["--vermelho-cardapio", "Preço na folha do ramen"],
    ["--azulejo", "Borda da carta de bebidas"],
    ["--moeda", "Preço na carta de bebidas"],
  ],
};

function swatches() {
  const style = getComputedStyle(document.documentElement);
  for (const [host, list] of Object.entries(SWATCHES)) {
    render(
      list.map(
        ([token, use]) => html`<figure class="ds-swatch">
          <i style=${`background:var(${token})`}></i>
          <figcaption><b>${token.slice(2)}</b><span class="mono">${style.getPropertyValue(token).trim()}</span><small>${use}</small></figcaption>
        </figure>`,
      ),
      $(`#${host}`),
    );
  }
}

function spinners() {
  for (const button of document.querySelectorAll("[data-spin]")) {
    const spin = document.createElement("span");
    spin.className = "btn__spin";
    render(sealTemplate(), spin);
    button.prepend(spin);
  }
}

// ---- escolhas da reserva ----
const DEMO_DAYS = [
  { value: "30", wd: "qua", d: 30, sub: "hoje", today: true },
  { value: "01", wd: "qui", d: 1, sub: "últimas" },
  { value: "02", wd: "sex", d: 2, sub: "lotado", full: true },
  { value: "03", wd: "sáb", d: 3, sub: "6 horários" },
  { value: "04", wd: "dom", d: 4, sub: "fechado", closed: true },
  { value: "05", wd: "seg", d: 5, sub: "produção", closed: true },
  { value: "06", wd: "ter", d: 6, sub: "produção", closed: true },
];
const DEMO_SLOTS = [
  ["19:00", "available"],
  ["19:30", "few_left"],
  ["20:00", "full"],
  ["20:30", "available"],
  ["21:00", "available"],
  ["21:30", "available"],
];

function choices() {
  const picked = { party: "2", day: "30", slot: "20:30" };
  const tiles = $("#demo-tiles");
  const days = $("#demo-days");
  const slots = $("#demo-slots");

  const draw = () => {
    render(
      [1, 2, 3, 4, 5, 6, 7, 8]
        .map(String)
        .map(
          (n) => html`<button type="button" class="tile" role="radio" data-value=${n} aria-checked=${String(picked.party === n)} aria-label=${`${n} ${n === "1" ? "pessoa" : "pessoas"}`}>${n}</button>`,
        )
        .concat(html`<button type="button" class="tile" role="radio" data-value="9+" aria-checked=${String(picked.party === "9+")}>9+</button>`),
      tiles,
    );
    render(
      DEMO_DAYS.map(
        (d) => html`<button
          type="button"
          class=${["day", d.today ? "is-today" : "", d.full ? "is-full" : "", d.closed ? "is-closed" : ""].join(" ")}
          role="radio"
          data-value=${d.value}
          aria-checked=${String(picked.day === d.value)}
          aria-disabled=${String(Boolean(d.closed))}
          aria-label=${`${d.wd} ${d.d}, ${d.sub}`}
        >
          <small>${d.wd}</small><b>${d.d}</b><span>${d.sub}</span>
        </button>`,
      ),
      days,
    );
    render(
      DEMO_SLOTS.map(
        ([time, state]) => html`<button
          type="button"
          class=${["slot", state === "few_left" ? "is-few" : "", state === "full" ? "is-full" : ""].join(" ")}
          role="radio"
          data-value=${time}
          aria-checked=${String(picked.slot === time)}
          aria-label=${`${time}, ${t(`slot.${state}`)}`}
        >
          <b>${time}</b><span>${t(`slot.${state}`)}</span>
        </button>`,
      ),
      slots,
    );
    [tiles, days, slots].forEach(syncChoiceGroup);
  };
  draw();
  choiceGroup(tiles, (v) => ((picked.party = v), draw()));
  choiceGroup(days, (v) => ((picked.day = v), draw()));
  choiceGroup(slots, (v) => ((picked.slot = v), draw()));
}

function badges() {
  const statuses = ["confirmed", "pending", "waitlisted", "offered", "declined", "canceled", "expired", "completed", "no_show"];
  render(
    statuses.map((s) => html`<span class=${`badge badge--${s.replace("_", "-")}`}>${t(`status.${s}`)}</span>`),
    $("#badges"),
  );
}

// ---- tabela ----
const ROWS = [
  ["19:00", "Carla + 3", 4, "S1", "confirmed", "said-yes", "aniversário"],
  ["19:30", "Juliana + 5", 6, "Q3", "confirmed", "said-yes", "1 vegetariano"],
  ["20:00", "Camila + 1", 2, "—", "waitlisted", "", ""],
  ["20:30", "Gustavo + 9", 10, "—", "pending", "", "aniversário de 30 anos"],
  ["20:30", "Ana + 1", 2, "S2", "confirmed", "no-reply", ""],
];

function tableDemo() {
  const table = $("#demo-table");
  const head = html`<thead><tr><th>Hora</th><th>Nome</th><th>Pessoas</th><th>Mesa</th><th>Status</th><th>Lembrete</th><th>Observação</th></tr></thead>`;
  const state = (content) => html`<tr class="data-table__state"><td colspan="7">${content}</td></tr>`;
  const bodies = {
    dados: ROWS.map(
      ([time, name, n, table_, status, reply, note], i) => html`<tr class=${i === 4 ? "is-selected" : ""}>
        <td data-label="Hora" class="time">${time}</td>
        <td data-label="Nome" class="strong">${name}</td>
        <td data-label="Pessoas" class="num">${n}</td>
        <td data-label="Mesa" class="num">${table_}</td>
        <td data-label="Status"><span class=${`badge badge--${status}`}>${t(`status.${status}`)}</span></td>
        <td data-label="Lembrete">${reply ? html`<span class=${`badge badge--${reply}`}>${reply === "said-yes" ? "confirmou" : "sem resposta"}</span>` : "—"}</td>
        <td data-label="Observação" class="is-wide">${note || "—"}</td>
      </tr>`,
    ),
    carregando: [1, 2, 3].map(
      () => html`<tr aria-hidden="true">${[1, 2, 3, 4, 5, 6, 7].map(() => html`<td><span class="skeleton skeleton--text"></span></td>`)}</tr>`,
    ),
    vazio: state(html`<div class="empty"><span class="seal seal--ink">${sealTemplate()}</span><b>Nada por aqui</b><p>${t("empty.filters")}</p><button class="btn btn--sm btn--outline" type="button">Limpar filtros</button></div>`),
    erro: state(html`<div class="empty error-state" role="alert"><span class="seal">${sealTemplate()}</span><b>Não carregou</b><p>${t("errors.network")}</p><button class="btn btn--sm" type="button">${t("common.retry")}</button></div>`),
  };
  const draw = (which) => render(html`${head}<tbody>${bodies[which]}</tbody>`, table);
  draw("dados");
  const list = $("#table-state");
  for (const tab of list.querySelectorAll('[role="tab"]')) tab.setAttribute("aria-controls", "demo-table");
  tabs(list, { onChange: (tab) => draw(tab.dataset.state) });
}

function dialogs() {
  const dialog = $("#demo-dialog");
  const name = $("#dlg-name");
  $("#open-dialog").addEventListener("click", () =>
    openDialog(dialog, {
      isDirty: () => name.value.trim() !== "",
      discard: { title: "Descartar a reserva?", message: "O que você escolheu vai se perder.", confirmLabel: "Descartar", cancelLabel: "Continuar reservando" },
      onClose: () => (name.value = ""),
    }),
  );
  $("#open-drawer").addEventListener("click", () => openDialog($("#demo-drawer")));
  $("#open-confirm").addEventListener("click", async () => {
    const ok = await confirmAction({
      title: "Cancelar a reserva de Ana?",
      message: "A mesa volta a ficar livre e a lista de espera é avisada.",
      confirmLabel: "Cancelar reserva",
      cancelLabel: "Manter reserva",
      danger: true,
    });
    toast(ok ? { title: "Reserva cancelada", message: "Ana foi avisada pelo WhatsApp." } : { title: "Nada mudou", message: "A reserva continua de pé." });
  });
}

function toasts() {
  $("#toast-ok").addEventListener("click", () => toast({ title: "Reserva confirmada", message: "Ana + 1 · 20:30 · mesa S2" }));
  $("#toast-undo").addEventListener("click", () =>
    toast({ title: "Mesa liberada", message: "S5 está livre de novo.", action: { label: t("common.undo"), onClick: () => toast({ title: "Desfeito", message: "S5 voltou para Diego." }) } }),
  );
  $("#toast-error").addEventListener("click", () => toast({ kind: "error", title: "Não deu para salvar", message: t("errors.network") }));
}

function fields() {
  phoneField($("#phone-demo"));
  const help = $("#otp-help");
  otpInput($("#otp-demo"), { onComplete: () => (help.textContent = "Código completo. Na reserva, ele segue sozinho.") });
  for (const area of document.querySelectorAll("[data-count]")) {
    const counter = document.querySelector(`[data-count-for="${area.id}"]`);
    const update = () => (counter.textContent = `${area.value.length}/${area.maxLength}`);
    area.addEventListener("input", update);
    update();
  }
}

// ---- chamada ao vivo para a API simulada ----
async function apiDemo() {
  const houseBox = $("#api-house");
  const daysBox = $("#api-days");
  const loading = html`<span class="skeleton skeleton--title"></span><span class="skeleton skeleton--text"></span><span class="skeleton skeleton--text"></span>`;
  const failed = (error, retry) => html`<div class="empty error-state" role="alert">
    <span class="seal">${sealTemplate()}</span><b>Não carregou</b><p>${error.userMessage || t("errors.server")}</p>
    <button class="btn btn--sm" type="button" @click=${retry}>${t("common.retry")}</button>
  </div>`;

  const loadHouse = async () => {
    render(loading, houseBox);
    try {
      const data = await house.getHouse();
      const status = openStatus(data.days, data.server_time);
      render(
        html`<span class="ds-label">GET /api/v1/house</span>
          <p class="letreiro ds-api-name">${data.name}</p>
          <p class="rotulo">${data.tagline}</p>
          <p>${data.address.street}, ${data.address.number} · ${data.address.district} · ${data.address.city}</p>
          <p class="mono">WhatsApp ${formatPhone(data.whatsapp)}</p>
          <p><span class=${`badge ${status.open ? "badge--confirmed" : "badge--pending"}`}>${status.label}</span></p>
          ${data.hours_confirmed ? null : html`<p class="field__help">Horário a confirmar com o Marcus.</p>`}`,
        houseBox,
      );
    } catch (error) {
      render(failed(error, loadHouse), houseBox);
    }
  };

  const loadDays = async () => {
    render(html`<div class="days">${Array.from({ length: 14 }, () => html`<span class="day skeleton"></span>`)}</div>`, daysBox);
    try {
      // sem datas: a API começa no hoje da casa, seja o que for que o relógio do aparelho diga
      const data = await availability.getDays({ partySize: 2 });
      const serverToday = houseParts(data.server_time).date;
      render(
        html`<div class="days" role="list">
          ${data.days.map((d) => {
            const count = d.slots?.filter((s) => s.state === "available" || s.state === "few_left").length ?? 0;
            const sub = !d.open ? d.reason_label : d.state === "full" ? t("day.full") : `${count} ${count === 1 ? "horário" : "horários"}`;
            const cls = ["day", d.date === serverToday ? "is-today" : "", !d.open ? "is-closed" : "", d.state === "full" ? "is-full" : ""].join(" ");
            return html`<span class=${cls} role="listitem"><small>${formatDay(d.date, "weekday-short")}</small><b>${Number(d.date.slice(8))}</b><span>${sub}</span></span>`;
          })}
        </div>`,
        daysBox,
      );
    } catch (error) {
      render(failed(error, loadDays), daysBox);
    }
  };

  await Promise.all([loadHouse(), loadDays()]);
}

boot(() => {
  mountSeals();
  spinners();
  swatches();
  choices();
  badges();
  tableDemo();
  tabs($("#tabs-col"));
  tabs($("#tabs-row"));
  dialogs();
  toasts();
  fields();
  apiDemo();
});
