// Eventos (histórias 3.9 a 3.11 e a lista da porta): criar, duplicar, publicar e despublicar,
// como cada evento recebe reservas, e a lista de convidados com "Chegou" na porta. Publicar ou
// mudar um evento publicado passa por "quem perde mesa" (./agenda/effect.js).
import "./eventos.css";
import { confirmAction } from "../../components/confirm.js";
import { showFormErrors } from "../../components/field.js";
import { toast } from "../../components/toast.js";
import { formatDay, houseParts, shortTime } from "../../lib/dates.js";
import { html, nothing, render } from "../../lib/html.js";
import { uuid } from "../../lib/uuid.js";
import * as api from "../../services/api/staff-eventos.js";
import { layouts as fetchLayouts } from "../../services/api/staff-plantas.js";
import { askConflict } from "./agenda/conflict.js";
import { withEffect } from "./agenda/effect.js";
import {
  can,
  emptyBlock,
  errorBlock,
  errorText,
  intOrNull,
  isOffline,
  loadingBlock,
  offlineNotice,
  openSheet,
  parseTimes,
  plural,
  recall,
  remember,
} from "./agenda/ui.js";
import { asWords, localizedField, missingLangs } from "./agenda/words.js";
import { AREA } from "../area-names.js";


const MODES = [
  [
    "mixed",
    "Mesas e lista",
    "Mesas no salão como numa noite normal, até o limite das mesas, e lista por pessoa na área em modo lista.",
  ],
  ["tables", "Só mesas", "Cada reserva ganha uma mesa da planta do evento."],
  ["list", "Só lista", "Reserva por pessoa, sem mesa marcada, até a capacidade da lista."],
  [
    "private",
    "Fechado",
    "A casa fecha para o público. O site mostra o dia bloqueado com o motivo e só entra quem está na lista da casa.",
  ],
  ["none", "Entrada livre", "Sem reserva: o site avisa que é só chegar."],
];
const MODE_LABEL = Object.fromEntries(MODES.map(([k, l]) => [k, l]));
/** Os campos do evento que vale nomear quando outra pessoa salvou antes. */
const EVENT_LABELS = {
  title: "Nome",
  date: "Data",
  starts_at: "Começa",
  ends_at: "Termina",
  description: "Texto para o site",
  booking_mode: "Modo de reserva",
  list_capacity: "Pessoas na lista",
  tables_limit: "Pessoas nas mesas",
  party_max: "Grupo máximo",
  private_label: "O que o cliente lê",
  layout_id: "Planta",
  image_id: "Foto",
  internal_note: "Nota da equipe",
  published: "Publicado",
};
const WITH_LIST = new Set(["list", "mixed", "private"]);
const LANGS = [
  ["pt", "Português"],
  ["es", "Español"],
  ["en", "English"],
];
const AREA_NAME = new Proxy({}, { get: (_, key) => AREA[key]?.toLowerCase() });

const nightToday = () => houseParts(new Date(Date.now() - 5 * 3_600_000)).date;
const people = (e) =>
  e.list_capacity && WITH_LIST.has(e.booking_mode)
    ? `${e.counts?.people ?? 0} de ${e.list_capacity} pessoas`
    : plural(e.counts?.people ?? 0, "pessoa", "pessoas");

export async function mount(container, { user, sub, navigate }) {
  if (sub === "novo") return mountSheet(container, { id: null, user, navigate });
  if (sub) return mountSheet(container, { id: sub, user, navigate });
  return mountList(container, { user, navigate });
}

// ---- ações compartilhadas ----------------------------------------------------------------------------

/** Publica ou despublica passando pelo efeito naquela noite. */
async function setPublished(event, published, version = event.version) {
  return withEffect({
    title: published ? `Publicar ${event.title}` : `Despublicar ${event.title}`,
    saveLabel: published ? "Publicar" : "Despublicar",
    simulate: () => api.updateEvent(event.id, { published }, { dryRun: true }),
    commit: ({ resolutions, notify, confirm }) =>
      api.updateEvent(
        event.id,
        { published, resolutions, notify_affected: notify, confirm_conflicts: confirm || undefined },
        { version },
      ),
  });
}

async function duplicateSheet(event) {
  let date = "";
  let busy = false;
  const sheet = openSheet({
    title: `Duplicar ${event.title}`,
    size: "narrow",
    view: (close, refresh) => {
      const submit = async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        if (!date) return showFormErrors(form, { date: "Escolha a data do novo evento." });
        busy = true;
        refresh();
        try {
          close(await api.duplicateEvent(event.id, date));
        } catch (error) {
          busy = false;
          refresh();
          if (error?.status === 422) showFormErrors(form, error.fieldErrors);
          else toast({ title: "Não deu para duplicar", message: errorText(error), kind: "error" });
        }
      };
      return html`<form class="ag-form" novalidate @submit=${submit}>
        <p class="ag-sheet__lead">
          Nasce um rascunho com o texto, a planta e o modo de reserva copiados. Nada aparece no site até
          publicar.
        </p>
        <label class="field">
          <span class="field__label">Nova data</span>
          <input
            class="field__input"
            type="date"
            name="date"
            min=${nightToday()}
            .value=${date}
            @input=${(e) => (date = e.target.value)}
          />
        </label>
        <div class="dialog__actions">
          <button class="btn btn--outline" type="button" data-close>Voltar</button>
          <button class="btn" type="submit" aria-busy=${busy ? "true" : "false"} ?disabled=${busy}>
            Duplicar
          </button>
        </div>
      </form>`;
    },
  });
  return sheet.done;
}

const situation = (e, today) => {
  if (e.date < today) return html`<span class="badge badge--expired">passou</span>`;
  return e.published
    ? html`<span class="badge badge--confirmed">publicado</span>`
    : html`<span class="badge badge--pending">rascunho</span>`;
};

// ---- a lista ------------------------------------------------------------------------------------

function mountList(container, { navigate }) {
  let status = "loading";
  let error = null;
  let items = [];
  let alive = true;
  let offline = false; // sem conexão: a última lista vista, só para ler
  const controller = new AbortController();
  const today = nightToday();

  async function load() {
    status = "loading";
    draw();
    try {
      items = (await api.events({}, { signal: controller.signal })).items;
      remember("eventos", items);
      offline = false;
      status = "ready";
    } catch (e) {
      if (!alive || e?.name === "AbortError") return;
      const copy = isOffline(e) ? recall("eventos") : null;
      if (copy) {
        items = copy;
        offline = true;
        status = "ready";
      } else {
        status = "error";
        error = e;
      }
    }
    draw();
  }

  async function toggle(event) {
    try {
      const done = await setPublished(event, !event.published);
      if (done) {
        toast({
          title: event.published ? "Evento despublicado" : "Evento publicado",
          message: event.published ? "Saiu do site e da Agenda." : "Já aparece no site e na Agenda.",
        });
        load();
      }
    } catch (e) {
      toast({ title: "Não deu para mudar", message: errorText(e), kind: "error" });
    }
  }

  async function duplicate(event) {
    const copy = await duplicateSheet(event);
    if (copy) {
      toast({ title: "Rascunho criado", message: `${copy.title}, ${formatDay(copy.date)}` });
      navigate(`/admin/eventos/${copy.id}`);
    }
  }

  const table = (list, label) =>
    html`<div class="table-wrap">
      <table class="data-table data-table--stack" aria-label=${label}>
        <thead>
          <tr>
            <th>Data</th>
            <th>Evento</th>
            <th>Modo</th>
            <th>Situação</th>
            <th>Lista</th>
            <th><span class="sr-only">Ações</span></th>
          </tr>
        </thead>
        <tbody>
          ${list.map(
            (e) =>
              html`<tr>
                <td data-label="Data" class="num">${formatDay(e.date)} · ${shortTime(e.starts_at)}</td>
                <td data-label="Evento" class="is-wide">
                  <a class="ev-nome" href=${`/admin/eventos/${e.id}`}>${e.title}</a>
                </td>
                <td data-label="Modo">${MODE_LABEL[e.booking_mode] || e.booking_mode}</td>
                <td data-label="Situação">${situation(e, today)}</td>
                <td data-label="Lista" class="num">
                  ${people(e)}${e.counts?.arrived ? html`<small class="ev-chegaram">${e.counts.arrived} chegaram</small>` : nothing}
                </td>
                <td data-label="Ações" class="is-wide">
                  <div class="pl-acoes ev-acoes">
                    <a class="action pl-link" href=${`/admin/eventos/${e.id}`}>Abrir</a>
                    ${offline ? nothing : html`<button class="action" type="button" aria-label=${`Duplicar ${e.title}`} @click=${() => duplicate(e)}>Duplicar</button>`}
                    ${
                      e.date >= today && !offline
                        ? html`<button
                            class="action ${e.published ? "action--alert" : "action--solid"}"
                            type="button"
                            aria-label=${`${e.published ? "Despublicar" : "Publicar"} ${e.title}`}
                            @click=${() => toggle(e)}
                          >
                            ${e.published ? "Despublicar" : "Publicar"}
                          </button>`
                        : nothing
                    }
                  </div>
                </td>
              </tr>`,
          )}
        </tbody>
      </table>
    </div>`;

  function draw() {
    if (!alive) return;
    const next = items.filter((e) => e.date >= today);
    const past = items.filter((e) => e.date < today).reverse();
    render(
      html`<div class="ag ev">
        <div class="ag-barra">
          <p class="ag-legenda pl-intro">
            Rascunho não muda a noite. Publicado, o evento aparece no site e na Agenda, e a noite segue o modo
            de reserva dele.
          </p>
          ${offline ? nothing : html`<a class="btn" href="/admin/eventos/novo">Criar evento</a>`}
        </div>
        ${offline ? offlineNotice() : nothing}
        ${status === "loading" ? loadingBlock("Abrindo os eventos…") : nothing}
        ${status === "error" ? errorBlock(error, load) : nothing}
        ${status === "ready" && !items.length ? emptyBlock("Nenhum evento ainda", "Crie o primeiro: forró no quintal, noite do peixe, festa fechada.", html`<a class="btn" href="/admin/eventos/novo">Criar evento</a>`) : nothing}
        ${
          status === "ready" && next.length
            ? html`<h2 class="ag-secao">Próximos</h2>
                ${table(next, "Próximos eventos")}`
            : nothing
        }
        ${status === "ready" && items.length && !next.length ? html`<div class="notice">Nenhum evento marcado daqui para frente. Duplique um que deu certo.</div>` : nothing}
        ${
          status === "ready" && past.length
            ? html`<h2 class="ag-secao">Passados</h2>
                ${table(past, "Eventos passados")}`
            : nothing
        }
      </div>`,
      container,
    );
  }

  load();
  return () => {
    alive = false;
    controller.abort();
    render(nothing, container);
  };
}

// ---- um evento: a folha e a lista -------------------------------------------------------------

function blankEvent() {
  return {
    title: "",
    date: "",
    starts_at: "20:00",
    ends_at: "",
    description: "",
    published: false,
    booking_mode: "tables",
    list_capacity: 40,
    tables_limit: "",
    entry_times: ["20:00", "21:00"],
    party_max: 8,
    requires_approval: false,
    layout_id: null,
    day_plan: { opens_at: "19:00", closes_at: "23:30" },
    internal_note: "",
    private_label: { pt: "Evento fechado", es: "Evento privado", en: "Private event" },
    image_id: null,
    translations: { es: { title: "", description: "" }, en: { title: "", description: "" } },
  };
}

function toForm(e) {
  return {
    ...blankEvent(),
    ...e,
    ends_at: e.ends_at || "",
    entry_times: (e.entry_times || []).join(", "),
    list_capacity: e.list_capacity ?? "",
    party_max: e.party_max ?? "",
    day_plan: { opens_at: e.day_plan?.opens_at || "", closes_at: e.day_plan?.closes_at || "" },
    translations: {
      es: { title: "", description: "", ...e.translations?.es },
      en: { title: "", description: "", ...e.translations?.en },
    },
    tables_limit: e.tables_limit ?? "",
    private_label: e.private_label ? asWords(e.private_label) : blankEvent().private_label,
    image_id: e.image_id ?? null,
  };
}

function toBody(f) {
  return {
    title: f.title.trim(),
    date: f.date,
    starts_at: f.starts_at,
    ends_at: f.ends_at || null,
    description: f.description,
    booking_mode: f.booking_mode,
    list_capacity: WITH_LIST.has(f.booking_mode) ? intOrNull(f.list_capacity) : null,
    entry_times: parseTimes(f.entry_times),
    party_max: intOrNull(f.party_max),
    requires_approval: Boolean(f.requires_approval),
    layout_id: f.layout_id || null,
    day_plan: { opens_at: f.day_plan.opens_at || null, closes_at: f.day_plan.closes_at || null },
    internal_note: f.internal_note,
    tables_limit: f.booking_mode === "mixed" ? intOrNull(f.tables_limit) : null,
    private_label: f.booking_mode === "private" ? asWords(f.private_label) : null,
    image_id: f.image_id || null,
    translations: f.translations,
  };
}

const missing = (f, lang) =>
  !f.translations?.[lang]?.title?.trim() ||
  (f.description?.trim() && !f.translations?.[lang]?.description?.trim());

function mountSheet(container, { id, user, navigate }) {
  let status = "loading";
  let error = null;
  let event = null;
  let form = null;
  let original = "";
  let layouts = [];
  let tab = "ficha";
  let lang = "pt";
  let labelLang = "pt";
  let busy = false;
  let alive = true;
  let offline = false; // sem conexão: a última cópia vista, só para ler
  let version = null; // a versão lida, enviada de volta como If-Match
  let photos = []; // a Galeria, para a foto do evento
  let photoError = "";
  const controller = new AbortController();
  const today = nightToday();
  // a lista de convidados
  let list = null;
  let listStatus = "idle";
  let listError = null;
  let query = "";
  const guestForm = { name: "", party_size: "2" };

  const dirty = () => form && JSON.stringify(form) !== original;

  async function load() {
    status = "loading";
    draw();
    try {
      const [e, l, defaults, gallery] = await Promise.all([
        id ? api.event(id, { signal: controller.signal }) : null,
        fetchLayouts({ signal: controller.signal }),
        // um evento novo pega o modo padrão da casa (Configurações › Eventos)
        id ? null : api.eventSettings({ signal: controller.signal }).catch(() => null),
        api.photos({ signal: controller.signal }).catch(() => []),
      ]);
      layouts = l.filter((x) => !x.archived);
      photos = gallery || [];
      event = e;
      version = e?.version ?? null;
      const mode = defaults?.data?.default_booking_mode || "tables";
      form = e
        ? toForm(e)
        : {
            ...toForm({ ...blankEvent(), booking_mode: mode }),
            layout_id: layouts.find((x) => x.name.startsWith("Evento"))?.id || layouts[0]?.id || null,
          };
      original = JSON.stringify(form);
      if (id) remember(`evento:${id}`, { event: e, layouts, photos });
      offline = false;
      status = "ready";
    } catch (err) {
      if (!alive || err?.name === "AbortError") return;
      const copy = id && isOffline(err) ? recall(`evento:${id}`) : null;
      if (copy) {
        ({ event, layouts, photos } = copy);
        version = event.version;
        form = toForm(event);
        original = JSON.stringify(form);
        offline = true;
        status = "ready";
      } else {
        status = "error";
        error = err;
      }
    }
    draw();
    if (tab === "lista") loadList();
  }

  async function loadList() {
    if (!id) return;
    listStatus = "loading";
    draw();
    try {
      list = await api.guests(id, { signal: controller.signal });
      listStatus = "ready";
    } catch (e) {
      if (!alive || e?.name === "AbortError") return;
      listStatus = "error";
      listError = e;
    }
    draw();
  }

  /** "Fulano gravou antes de você": manter a minha folha sobre a nova versão, ou pegar a dele. */
  async function conflict(err) {
    const current = err.body?.current;
    if (!current) return load();
    const choice = await askConflict({ error: err, read: event, current, labels: EVENT_LABELS });
    if (choice === "join") {
      version = current.version;
      event = { ...current };
      toast({ title: "Juntamos", message: "As suas mudanças continuam na ficha. Grave de novo para valer." });
      draw();
    } else if (choice === "discard") {
      await load();
    }
  }

  async function submit(e) {
    e.preventDefault?.();
    const formEl = e.currentTarget || container.querySelector(".ev-ficha");
    const body = toBody(form);
    photoError = "";
    busy = true;
    draw();
    try {
      if (!id) {
        const created = await api.createEvent({ ...body, published: false });
        original = JSON.stringify(form);
        toast({ title: "Rascunho criado", message: "Confira e publique quando estiver pronto." });
        navigate(`/admin/eventos/${created.id}`);
        return;
      }
      const saved = event.published
        ? await withEffect({
            title: "O efeito na noite do evento",
            simulate: () => api.updateEvent(id, body, { dryRun: true }),
            commit: ({ resolutions, notify, confirm }) =>
              api.updateEvent(
                id,
                { ...body, resolutions, notify_affected: notify, confirm_conflicts: confirm || undefined },
                { version },
              ),
          })
        : await api.updateEvent(id, body, { version });
      if (saved) {
        toast({ title: "Evento gravado", message: body.title });
        busy = false;
        await load();
        return;
      }
    } catch (err) {
      busy = false;
      draw();
      if (err?.type === "image_not_ready") {
        photoError = "A foto ainda está sendo preparada. Escolha outra ou espere alguns minutos.";
        draw();
        container.querySelector(".ev-foto button")?.focus();
        return;
      }
      if (err?.status === 422) {
        if (lang !== "pt") {
          lang = "pt";
          draw();
        }
        return showFormErrors(formEl, err.fieldErrors, container.querySelector(".ev-erros"));
      }
      if (err?.status === 412) return conflict(err);
      toast({
        title: "Não deu para gravar",
        message: `${errorText(err)} A ficha continua na tela.`,
        kind: "error",
      });
      return;
    }
    busy = false;
    draw();
  }

  async function publish(next) {
    if (dirty())
      return toast({
        title: "Grave as mudanças antes",
        message: "Depois publique ou despublique.",
        kind: "error",
      });
    busy = true;
    draw();
    try {
      const done = await setPublished(event, next, version);
      if (done) {
        const pending = [
          ...new Set([
            ...LANGS.slice(1)
              .filter(([l]) => missing(form, l))
              .map(([, n]) => n),
            ...(form.booking_mode === "private" ? missingLangs(form.private_label) : []),
          ]),
        ];
        toast({
          title: next ? "Evento publicado" : "Evento despublicado",
          message:
            next && pending.length
              ? `Falta traduzir para ${pending.join(" e ")}: o site mostra o texto em português.`
              : next
                ? "Já aparece no site e na Agenda."
                : "Saiu do site e da Agenda.",
        });
        busy = false;
        await load();
        return;
      }
    } catch (err) {
      if (err?.status === 412) {
        busy = false;
        draw();
        return conflict(err);
      }
      toast({ title: "Não deu para mudar", message: errorText(err), kind: "error" });
    }
    busy = false;
    draw();
  }

  async function duplicate() {
    const copy = await duplicateSheet(event);
    if (copy) {
      toast({ title: "Rascunho criado", message: `${copy.title}, ${formatDay(copy.date)}` });
      navigate(`/admin/eventos/${copy.id}`);
    }
  }

  async function remove() {
    const ok = await confirmAction({
      title: `Remover ${event.title}?`,
      message: "As reservas continuam. O dia volta ao plano que tinha antes do evento.",
      confirmLabel: "Remover evento",
      danger: true,
    });
    if (!ok) return;
    try {
      const done = await withEffect({
        title: "O efeito de remover o evento",
        saveLabel: "Remover",
        simulate: () => (event.published ? api.removeEvent(id, { dryRun: true }) : null),
        commit: ({ confirm }) => api.removeEvent(id, { confirm }).then(() => true),
      });
      if (done) {
        original = JSON.stringify(form);
        toast({ title: "Evento removido", message: event.title });
        navigate("/admin/eventos");
      }
    } catch (err) {
      toast({ title: "Não deu para remover", message: errorText(err), kind: "error" });
    }
  }

  // ---- a lista de convidados ----
  async function addGuest(e, atDoor) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const size = Number.parseInt(guestForm.party_size, 10);
    const errors = {};
    if (!guestForm.name.trim()) errors.name = "Escreva o nome de quem vem.";
    if (!(size >= 1)) errors.party_size = "Pelo menos 1 pessoa.";
    if (Object.keys(errors).length) return showFormErrors(formEl, errors);
    try {
      await api.addGuest(
        id,
        { name: guestForm.name.trim(), party_size: size, at_door: atDoor || undefined },
        { idempotencyKey: uuid() },
      );
      toast({
        title: atDoor ? "Entrou, já com a chegada marcada" : "Nome na lista",
        message: `${guestForm.name.trim()} · ${plural(size, "pessoa", "pessoas")}`,
      });
      guestForm.name = "";
      guestForm.party_size = "2";
      await loadList();
      container.querySelector(".ev-convidado input[name=name]")?.focus();
    } catch (err) {
      if (err?.status === 422) return showFormErrors(formEl, err.fieldErrors);
      if (err?.body?.code === "event_list_full")
        return toast({
          title: "A lista do evento está cheia",
          message: "Chegou ao limite de pessoas. Aumente a capacidade na ficha do evento.",
          kind: "error",
        });
      toast({ title: "Não deu para acrescentar", message: errorText(err), kind: "error" });
    }
  }

  async function arrive(r, undo = false) {
    try {
      if (undo) await api.undoCheckIn(id, r.id);
      else await api.checkIn(id, r.id, { occurred_at: new Date().toISOString() });
      toast({
        title: undo ? "Chegada desfeita" : `${r.customer?.name || r.code} chegou`,
        message: undo ? "" : plural(r.party_size, "pessoa", "pessoas"),
        action: undo
          ? undefined
          : { label: "Desfazer", onClick: () => arrive({ ...r, status: "completed" }, true) },
      });
      await loadList();
    } catch (err) {
      toast({ title: "Não deu para marcar", message: errorText(err), kind: "error" });
    }
  }

  async function takeOff(r) {
    const ok = await confirmAction({
      title: `Tirar ${r.customer?.name || r.code} da lista?`,
      confirmLabel: "Tirar da lista",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.removeGuest(id, r.id);
      toast({ title: "Nome tirado da lista" });
      await loadList();
    } catch (err) {
      toast({ title: "Não deu para tirar", message: errorText(err), kind: "error" });
    }
  }

  // sair com mudanças pergunta antes
  const guardClick = async (ev) => {
    const a = ev.target instanceof Element ? ev.target.closest("a[href^='/admin']") : null;
    if (!a || !dirty() || ev.button !== 0 || ev.metaKey || ev.ctrlKey || a.closest("dialog")) return;
    ev.preventDefault();
    ev.stopPropagation();
    const ok = await confirmAction({
      title: "Descartar as mudanças?",
      message: "O que você mudou no evento ainda não foi gravado.",
      confirmLabel: "Descartar",
      cancelLabel: "Continuar editando",
      danger: true,
    });
    if (ok) {
      original = JSON.stringify(form);
      navigate(a.pathname);
    }
  };
  document.addEventListener("click", guardClick, true);

  const set = (path) => (e) => {
    const value = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    const keys = path.split(".");
    let target = form;
    for (const k of keys.slice(0, -1)) target = target[k];
    target[keys.at(-1)] = value;
    if (["booking_mode", "requires_approval"].includes(path)) draw();
  };

  const langTabs = () =>
    html`<div class="tabs tabs--row ev-linguas" role="tablist" aria-label="Língua do texto">
      ${LANGS.map(
        ([key, name]) =>
          html`<button
            type="button"
            role="tab"
            class="tab"
            id=${`ev-lingua-${key}`}
            aria-controls="ev-texto"
            aria-selected=${lang === key ? "true" : "false"}
            tabindex=${lang === key ? "0" : "-1"}
            @click=${() => ((lang = key), draw())}
          >
            ${name}${key !== "pt" && missing(form, key) ? html` <span class="ev-falta">falta</span>` : nothing}
          </button>`,
      )}
    </div>`;

  const textFields = () => {
    if (lang === "pt") {
      return html`<label class="field"
          ><span class="field__label">Nome do evento</span
          ><input
            class="field__input"
            name="title"
            .value=${form.title}
            placeholder="Ex.: Forró no quintal"
            @input=${set("title")}
        /></label>
        <label class="field"
          ><span class="field__label">Texto para o site</span
          ><textarea
            class="field__input"
            name="description"
            rows="3"
            .value=${form.description}
            @input=${set("description")}
          ></textarea>
        </label>`;
    }
    return html`<label class="field"
        ><span class="field__label">Nome do evento (${lang})</span
        ><input
          class="field__input"
          .value=${form.translations[lang].title}
          placeholder=${form.title}
          @input=${set(`translations.${lang}.title`)}
          @change=${() => draw()}
      /></label>
      <label class="field"
        ><span class="field__label">Texto para o site (${lang})</span
        ><textarea
          class="field__input"
          rows="3"
          .value=${form.translations[lang].description}
          placeholder=${form.description}
          @input=${set(`translations.${lang}.description`)}
          @change=${() => draw()}
        ></textarea>
      </label>
      <p class="ag-ajuda">Sem tradução, o site mostra o texto em português.</p>`;
  };

  // ---- a foto do evento, escolhida na Galeria ----
  const ready = (p) => p.status === "ready" && p.variants?.length;
  const photoField = () => {
    const chosen = photos.find((p) => p.id === form.image_id);
    const thumb = (p) => p.variants?.find((v) => v.width === 480)?.url || p.url || null;
    return html`<div
      class="ev-foto ${photoError ? "is-erro" : ""}"
      role="group"
      aria-labelledby="ev-foto-rotulo"
    >
      <span class="field__label" id="ev-foto-rotulo">Foto do evento <small>da Galeria</small></span>
      ${
        chosen
          ? html`<div class="ev-foto__escolhida">
              ${thumb(chosen) ? html`<img src=${thumb(chosen)} alt=${chosen.alt || ""} width="96" height="64" />` : nothing}
              <span
                >${chosen.alt || chosen.original_name}${ready(chosen) ? nothing : html` <span class="badge badge--pending">preparando</span>`}</span
              >
            </div>`
          : html`<p class="ag-ajuda">Sem foto: o site mostra o evento só com o texto.</p>`
      }
      <div class="ag-acoes">
        <button class="btn btn--outline btn--sm" type="button" @click=${pickPhoto}>
          ${chosen ? "Trocar a foto" : "Escolher na Galeria"}
        </button>
        ${chosen ? html`<button class="action" type="button" @click=${() => ((form.image_id = null), (photoError = ""), draw())}>Tirar a foto</button>` : nothing}
      </div>
      ${photoError ? html`<p class="field__error" role="alert">${photoError}</p>` : nothing}
    </div>`;
  };

  async function pickPhoto() {
    if (!photos.length) {
      toast({ title: "A Galeria está vazia", message: "Envie as fotos em Galeria e volte aqui." });
      return;
    }
    const sheet = openSheet({
      title: "Foto do evento",
      view: (close) =>
        html`<p class="ag-sheet__lead">As fotos marcadas “preparando” ainda não podem ir para o site.</p>
          <ul class="ev-galeria">
            ${photos.map(
              (p) =>
                html`<li>
                  <button
                    type="button"
                    class="ev-galeria__foto ${p.id === form.image_id ? "is-on" : ""}"
                    aria-pressed=${p.id === form.image_id ? "true" : "false"}
                    @click=${() => close(p.id)}
                  >
                    ${p.variants?.[0]?.url || p.url ? html`<img src=${p.variants?.find((v) => v.width === 480)?.url || p.url} alt="" width="160" height="107" loading="lazy" />` : nothing}
                    <span>${p.alt || p.original_name}</span>
                    ${ready(p) ? nothing : html`<span class="badge badge--pending">preparando</span>`}
                  </button>
                </li>`,
            )}
          </ul>`,
    });
    const picked = await sheet.done;
    if (picked) {
      form.image_id = picked;
      photoError = "";
      draw();
    }
  }

  const ficha = () => {
    const past = event && event.date < today;
    return html`<form class="ag-form ev-ficha" novalidate @submit=${submit}>
      <div class="ev-erros"></div>
      ${offline ? offlineNotice() : nothing}
      <fieldset class="ag-ler" ?disabled=${offline}>
        <legend class="sr-only">${offline ? "Ficha do evento, só para leitura" : "Ficha do evento"}</legend>
        ${past ? html`<div class="notice" role="status">Este evento já passou. Duplique para fazer de novo em outra data.</div>` : nothing}
        <section class="ev-bloco" aria-labelledby="ev-texto-titulo">
          <h2 class="ag-secao" id="ev-texto-titulo">O que é</h2>
          ${langTabs()}
          <div id="ev-texto" role="tabpanel" aria-labelledby=${`ev-lingua-${lang}`} class="ag-form">
            ${textFields()}
          </div>
          <div class="ag-grade">
            <label class="field"
              ><span class="field__label">Data</span
              ><input
                class="field__input"
                type="date"
                name="date"
                min=${id ? nothing : today}
                .value=${form.date}
                @input=${set("date")}
            /></label>
            <label class="field"
              ><span class="field__label">Começa</span
              ><input
                class="field__input"
                type="time"
                name="starts_at"
                .value=${form.starts_at}
                @input=${set("starts_at")}
            /></label>
            <label class="field"
              ><span class="field__label">Termina <small>opcional</small></span
              ><input
                class="field__input"
                type="time"
                name="ends_at"
                .value=${form.ends_at}
                @input=${set("ends_at")}
            /></label>
          </div>
          ${photoField()}
        </section>

        <fieldset class="ev-bloco">
          <legend class="ag-secao">Como recebe reservas</legend>
          <div class="ev-modos">
            ${MODES.map(
              ([key, label, help]) =>
                html`<label class="ev-modo ${form.booking_mode === key ? "is-on" : ""}">
                  <input
                    type="radio"
                    name="booking_mode"
                    value=${key}
                    .checked=${form.booking_mode === key}
                    @change=${set("booking_mode")}
                  />
                  <span><b>${label}</b><small>${help}</small></span>
                </label>`,
            )}
          </div>
          <div class="ag-grade">
            ${
              WITH_LIST.has(form.booking_mode)
                ? html`<label class="field"
                    ><span class="field__label">Pessoas na lista</span
                    ><input
                      class="field__input"
                      type="number"
                      min="1"
                      inputmode="numeric"
                      name="list_capacity"
                      .value=${String(form.list_capacity ?? "")}
                      @input=${set("list_capacity")}
                  /></label>`
                : nothing
            }
            ${
              ["list", "mixed"].includes(form.booking_mode)
                ? html`<label class="field"
                    ><span class="field__label">Horários de chegada da lista</span
                    ><input
                      class="field__input"
                      name="entry_times"
                      .value=${form.entry_times}
                      placeholder="20:00, 21:00"
                      @input=${set("entry_times")}
                  /></label>`
                : nothing
            }
            ${
              ["tables", "list", "mixed"].includes(form.booking_mode)
                ? html`<label class="field"
                    ><span class="field__label">Grupo máximo no site</span
                    ><input
                      class="field__input"
                      type="number"
                      min="1"
                      inputmode="numeric"
                      name="party_max"
                      .value=${String(form.party_max ?? "")}
                      @input=${set("party_max")}
                  /></label>`
                : nothing
            }
            ${
              form.booking_mode === "mixed"
                ? html`<label class="field"
                    ><span class="field__label">Pessoas nas mesas <small>vazio: todas as mesas</small></span
                    ><input
                      class="field__input"
                      type="number"
                      min="1"
                      inputmode="numeric"
                      name="tables_limit"
                      .value=${String(form.tables_limit ?? "")}
                      @input=${set("tables_limit")}
                  /></label>`
                : nothing
            }
            ${
              form.booking_mode === "private"
                ? html`<div class="ag-grade__largo">
                    ${localizedField({
                      id: "ev-motivo",
                      label: "O que o cliente lê no calendário",
                      name: "private_label",
                      value: form.private_label,
                      lang: labelLang,
                      setLang: (l) => {
                        labelLang = l;
                        draw();
                      },
                      onInput: (value) => {
                    form.private_label = value;
                    draw();
                  },
                      placeholder: "Ex.: Festa fechada",
                    })}
                  </div>`
                : nothing
            }
          </div>
          ${
            ["tables", "list", "mixed"].includes(form.booking_mode)
              ? html`<label class="ag-check"
                  ><input
                    type="checkbox"
                    .checked=${form.requires_approval}
                    @change=${set("requires_approval")}
                  /><span>Evento pede aprovação: cada reserva espera a casa aceitar</span></label
                >`
              : nothing
          }
          <p class="ag-ajuda">Não há ingresso nem valor em nenhum modo.</p>
        </fieldset>

        <fieldset class="ev-bloco">
          <legend class="ag-secao">A noite do evento</legend>
          <div class="ag-grade">
            <label class="field ag-grade__largo">
              <span class="field__label">Planta</span>
              <select class="field__input" name="layout_id" @change=${set("layout_id")}>
                ${layouts.map((l) => html`<option value=${l.id} ?selected=${l.id === form.layout_id}>${l.name}</option>`)}
              </select>
            </label>
            <label class="field"
              ><span class="field__label">A casa abre</span
              ><input
                class="field__input"
                type="time"
                .value=${form.day_plan.opens_at}
                @input=${set("day_plan.opens_at")}
            /></label>
            <label class="field"
              ><span class="field__label">A casa fecha</span
              ><input
                class="field__input"
                type="time"
                .value=${form.day_plan.closes_at}
                @input=${set("day_plan.closes_at")}
            /></label>
          </div>
          <label class="field">
            <span class="field__label">Nota da equipe <small>o cliente não vê</small></span>
            <textarea
              class="field__input"
              name="internal_note"
              rows="2"
              .value=${form.internal_note}
              @input=${set("internal_note")}
            ></textarea>
          </label>
        </fieldset>

        <div class="ag-acoes ev-gravar">
          <button class="btn" type="submit" aria-busy=${busy ? "true" : "false"} ?disabled=${busy}>
            ${!id ? "Criar rascunho" : event?.published ? "Ver o efeito e gravar" : "Gravar"}
          </button>
          ${id && !past ? html`<button class="btn btn--outline" type="button" ?disabled=${busy} @click=${() => publish(!event.published)}>${event.published ? "Despublicar" : "Publicar"}</button>` : nothing}
          ${id ? html`<button class="btn btn--outline" type="button" @click=${duplicate}>Duplicar</button>` : nothing}
          ${id && can(user, "DELETE /staff/events/{id}") ? html`<button class="btn btn--danger" type="button" @click=${remove}>Remover</button>` : nothing}
        </div>
      </fieldset>
    </form>`;
  };

  const guestList = () => {
    if (listStatus === "loading" && !list) return loadingBlock("Abrindo a lista…");
    if (listStatus === "error") return errorBlock(listError, loadList);
    if (!list) return nothing;
    const isPrivate = event.booking_mode === "private";
    const q = query.trim().toLowerCase();
    const shown = list.guests.filter(
      (g) => !q || (g.customer?.name || "").toLowerCase().includes(q) || g.code.toLowerCase().includes(q),
    );
    const past = event.date < today;
    const addForm = (atDoor) =>
      html`<form
        class="ev-convidado"
        novalidate
        @submit=${(e) => addGuest(e, atDoor)}
        aria-label=${atDoor ? "Entrou na porta" : "Acrescentar nome"}
      >
        <label class="field"
          ><span class="field__label">Nome</span
          ><input
            class="field__input"
            name="name"
            autocomplete="off"
            .value=${guestForm.name}
            @input=${(e) => (guestForm.name = e.target.value)}
        /></label>
        <label class="field ev-convidado__num"
          ><span class="field__label">Pessoas</span
          ><input
            class="field__input"
            name="party_size"
            type="number"
            min="1"
            inputmode="numeric"
            .value=${guestForm.party_size}
            @input=${(e) => (guestForm.party_size = e.target.value)}
        /></label>
        <button class="btn" type="submit">${atDoor ? "Entrou na porta" : "Acrescentar nome"}</button>
      </form>`;
    return html`<div class="ev-lista">
      <dl class="ag-resumo">
        <div>
          <dt>Na lista</dt>
          <dd>
            ${list.capacity ? `${list.expected_people} de ${list.capacity} pessoas` : plural(list.expected_people, "pessoa", "pessoas")}
          </dd>
        </div>
        <div>
          <dt>Chegaram</dt>
          <dd>${plural(list.arrived_people, "pessoa", "pessoas")}</dd>
        </div>
        <div>
          <dt>Nomes</dt>
          <dd>${list.guests.length}</dd>
        </div>
      </dl>
      ${past ? nothing : addForm(!isPrivate)}
      ${
        list.guests.length
          ? html`<label class="field ev-busca"
                ><span class="field__label">Procurar na lista</span
                ><input
                  class="field__input"
                  type="search"
                  .value=${query}
                  placeholder="Nome ou código"
                  @input=${(e) => ((query = e.target.value), draw())}
              /></label>
              <div class="table-wrap">
                <table class="data-table data-table--stack" aria-label="Lista do evento">
                  <thead>
                    <tr>
                      <th>Hora</th>
                      <th>Nome</th>
                      <th>Pessoas</th>
                      <th>Onde</th>
                      <th>Chegada</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${shown.map((g) => {
                      const arrived = g.status === "completed";
                      return html`<tr class=${arrived ? "ev-chegou" : ""}>
                        <td data-label="Hora" class="num">${g.time}</td>
                        <td data-label="Nome" class="strong">
                          ${g.customer?.name || g.code}${g.source === "walk_in" ? html` <span class="badge">na porta</span>` : nothing}
                        </td>
                        <td data-label="Pessoas" class="num">
                          ${arrived && g.arrived_people && g.arrived_people !== g.party_size ? `${g.arrived_people} de ${g.party_size}` : g.party_size}
                        </td>
                        <td data-label="Onde">
                          ${g.table_codes?.length ? `mesa ${g.table_codes.join(" + ")}` : `lista · ${AREA_NAME[g.area_key] || g.area_key || "casa"}`}
                        </td>
                        <td data-label="Chegada" class="is-wide">
                          <div class="pl-acoes">
                            ${
                              arrived
                                ? html`<span class="badge badge--completed">chegou</span>
                                    ${past ? nothing : html`<button class="action" type="button" aria-label=${`Desfazer a chegada de ${g.customer?.name || g.code}`} @click=${() => arrive(g, true)}>Desfazer</button>`}`
                                : past
                                  ? html`<span class="badge badge--expired">não veio</span>`
                                  : html`<button
                                        class="action action--solid"
                                        type="button"
                                        aria-label=${`${g.customer?.name || g.code} chegou`}
                                        @click=${() => arrive(g)}
                                      >
                                        Chegou
                                      </button>
                                      ${isPrivate ? html`<button class="action action--alert" type="button" aria-label=${`Tirar ${g.customer?.name || g.code} da lista`} @click=${() => takeOff(g)}>Tirar</button>` : nothing}`
                            }
                          </div>
                        </td>
                      </tr>`;
                    })}
                    ${
                      shown.length
                        ? nothing
                        : html`<tr class="data-table__state">
                            <td colspan="5">Ninguém com esse nome na lista.</td>
                          </tr>`
                    }
                  </tbody>
                </table>
              </div>`
          : emptyBlock(
              "Ninguém na lista ainda",
              isPrivate
                ? "Acrescente o nome e quantas pessoas vêm com cada um."
                : "Quem reservar para esse dia aparece aqui.",
              past
                ? nothing
                : html`<button
                    class="btn btn--outline"
                    type="button"
                    @click=${() => container.querySelector(".ev-convidado input[name=name]")?.focus()}
                  >
                    Acrescentar nome
                  </button>`,
            )
      }
    </div>`;
  };

  const pageTab = (key, label) =>
    html`<button
      type="button"
      role="tab"
      class="tab"
      id=${`ev-aba-${key}`}
      aria-controls="ev-painel"
      aria-selected=${tab === key ? "true" : "false"}
      tabindex=${tab === key ? "0" : "-1"}
      @click=${() => {
        tab = key;
        draw();
        if (key === "lista") loadList();
      }}
      @keydown=${(e) => {
        if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
        tab = tab === "ficha" ? "lista" : "ficha";
        draw();
        if (tab === "lista") loadList();
        requestAnimationFrame(() => container.querySelector(`#ev-aba-${tab}`)?.focus());
      }}
    >
      ${label}
    </button>`;

  function draw() {
    if (!alive) return;
    const back = html`<a class="ag-voltar" href="/admin/eventos">‹ Voltar aos eventos</a>`;
    if (status !== "ready") {
      render(
        html`<div class="ag">
          ${back}${status === "loading" ? loadingBlock("Abrindo o evento…") : errorBlock(error, load)}
        </div>`,
        container,
      );
      return;
    }
    render(
      html`<div class="ag ev-pagina">
        ${back}
        <header class="ag-dia-plano__cabeca ev-cabeca">
          <h2 class="ev-titulo">${event ? event.title : "Novo evento"}</h2>
          ${event ? situation(event, today) : html`<span class="badge badge--pending">rascunho</span>`}
          ${event ? html`<span class="ag-ajuda">${formatDay(event.date, "long")} · ${MODE_LABEL[event.booking_mode]} · ${people(event)}</span>` : nothing}
        </header>
        ${
          id
            ? html`<div class="tabs tabs--row" role="tablist" aria-label="Partes do evento">
                ${pageTab("ficha", "Ficha")}${pageTab("lista", "Lista")}
              </div>`
            : nothing
        }
        <div
          id="ev-painel"
          role=${id ? "tabpanel" : nothing}
          aria-labelledby=${id ? `ev-aba-${tab}` : nothing}
        >
          ${tab === "ficha" || !id ? ficha() : guestList()}
        </div>
      </div>`,
      container,
    );
  }

  load();
  return () => {
    alive = false;
    controller.abort();
    document.removeEventListener("click", guardClick, true);
    render(nothing, container);
  };
}
