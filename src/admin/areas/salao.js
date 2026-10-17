// Salão (Épico 6): a planta do salão da noite, ao vivo. Cada mesa mostra o estado em palavras (livre,
// reservada, sentada, atrasada, para liberar); uma mesa abre a gaveta lateral com o que dá para
// fazer ali: "Chegou", sentar um grupo sem reserva, +10 min, "Não veio", liberar, mover, juntar,
// separar, corrigir as pessoas, as mensagens prontas e a linha do tempo da mesa. No celular a planta
// vira uma lista por área. A planta segue as regras salvas em Configurações (tolerância, o que
// acontece no fim dela, "para liberar", a janela de desfazer), se atualiza pelo fluxo ao vivo e,
// sem conexão, mostra o retrato da noite guardado no aparelho, só para leitura.
// Subpáginas: /admin/salao/folha (a folha da noite), /admin/salao/porta (a porta do evento) e
// /admin/salao/papel (lançar o que foi anotado no papel).
import "./salao.css";
import { confirmAction } from "../../components/confirm.js";
import { openDialog } from "../../components/dialog.js";
import { toast } from "../../components/toast.js";
import { formatDay, houseTime } from "../../lib/dates.js";
import { $, html, nothing, render } from "../../lib/html.js";
import { list as waitlist } from "../../services/api/staff-espera.js";
import * as api from "../../services/api/staff-salao.js";
import { arrivingNote, notifiedNote, readyButtons } from "./reservas/prontas.js";
import { fixtureRefs, floorMap } from "./plantas/pontos.js";
import { mountSheet } from "./salao/folha.js";
import { STATE_WORD, arriving, counts, firstName, freeTables, matches, people, readFloor, toleranceSentence } from "./salao/model.js";
import { mountPaper } from "./salao/papel.js";
import { mountDoor } from "./salao/porta.js";
import { toleranceTable } from "./salao/tolerancia.js";
import {
  backlogBand, connection, guardWrite, keepPicture, noPicture, offlineBand, onConnection, readPicture, report, setHealthCheck, setUpPanelApp,
} from "./salao/retrato.js";
import { errorBlock, loadingBlock, maybe, newKey, problemText, seatsOf, stepper, tablePicker, toastError } from "./salao/ui.js";
import { realtimeLostNotice, startLive } from "./salao/vivo.js";
import { withCorrection } from "./salao/correcao.js";
import { canDo } from "../nav.js";
import { correctsClosedNight } from "./reservas/labels.js";

const TICK_MS = 15_000;
const FLAG_WORD = { birthday: "aniversário", high_chair: "cadeirinha", accessibility: "acessibilidade", dietary: "restrição alimentar", no_whatsapp: "sem WhatsApp" };
const EVENT_WORD = {
  opened: "mesa aberta",
  moved: "trocou de mesa",
  merged: "mesas juntas",
  split: "mesas separadas",
  people_changed: "corrigiu as pessoas",
  extended: "+10 min de mesa",
  released: "mesa liberada",
  undone: "liberação desfeita",
  closed_by_system: "fechada no fim da noite",
};

export async function mount(container, context) {
  const { user, sub } = context;
  if (sub === "folha") return mountSheet(container, context);
  if (sub === "porta") return mountDoor(container, context);
  if (sub === "papel") return mountPaper(container, context);

  // quem adia o fechamento, planeja a noite e corrige depois de fechar: o arquivo de permissões (história 1.3)
  const canPostpone = canDo(user.role, "POST /staff/night/postpone", user.areas ?? undefined);
  const canPlan = canDo(user.role, "PUT /staff/day-plans/{date}", user.areas ?? undefined);
  const fixesClosed = correctsClosedNight(user);
  let floor = null;
  let etag = null;
  let loadError = null;
  let offset = 0; // o relógio da casa (server_time) menos o relógio deste aparelho
  let read = null;
  let lost = false;
  let announce = "";
  let warned = new Set(); // mesas atrasadas já anunciadas a 2 min do fim
  let query = "";
  let waitCount = 0;
  let mode = connection();
  let picture = null;
  let pictureRead = false;
  let drawer = null; // a referência da janela aberta
  /** O que a gaveta mostra. */
  let ui = blank();
  let alive = true;
  setUpPanelApp();

  function blank() {
    return { code: null, area: null, view: "main", people: 2, name: "", picked: [], other: null, busy: false, stale: false, openedState: null, reservationId: null, detail: null };
  }

  const now = () => new Date(Date.now() + offset);
  const draw = () => alive && render(screen(), container);
  const tableOf = (code) => read?.tables.get(code);
  // o que faz "Isso mudou agora há pouco" na gaveta aberta: o estado, quem está na mesa e
  // quantos, não os minutos que passam sozinhos
  const tableSign = (row) =>
    row ? [row.state, row.session?.id, row.session?.people, row.session?.table_codes?.join("+"), row.reservation?.id, row.reservation?.party_size, row.reservation?.status].join("|") : "";
  const nightClosed = () => Boolean(floor?.night?.closed) && !fixesClosed;

  async function load({ quiet = false } = {}) {
    if (connection() === "offline") return showPicture();
    try {
      const [answer, waiting] = await Promise.all([api.floorFresh(quiet ? etag : null), waitlist().catch(() => null)]);
      if (!alive) return;
      report(true);
      if (connection() !== "online") return showPicture();
      mode = "online";
      if (waiting) waitCount = waiting.length;
      loadError = null;
      if (!answer.changed && floor) return draw();
      etag = answer.etag;
      const next = answer.data;
      offset = Date.parse(next.server_time) - Date.now();
      const before = read;
      floor = next;
      read = floor.day?.layout ? readFloor(floor, now()) : null;
      if (quiet && before && read) {
        let changed = 0;
        for (const [code, t] of read.tables) if (before.tables.get(code)?.state !== t.state) changed += 1;
        announce = changed ? `${changed} ${changed === 1 ? "mesa mudou" : "mesas mudaram"}` : "";
      }
      if (ui.code && read && tableSign(tableOf(ui.code)) !== ui.openedState) ui.stale = true;
      keepPicture(floor);
    } catch (error) {
      if (!alive) return;
      report(false, error);
      if (connection() !== "online") return showPicture();
      if (!floor) loadError = error;
    }
    draw();
  }

  async function showPicture() {
    mode = connection();
    picture = await readPicture();
    pictureRead = true;
    drawer?.close();
    draw();
  }

  // ---- ações (todas protegidas: sem a linha abrem offline_action) ---------------------------

  async function run(work, { close = true } = {}) {
    if (nightClosed()) {
      toast({ kind: "error", title: "A noite já fechou", message: "Depois do fechamento, só o dono ou o gerente corrigem, com motivo." });
      return;
    }
    ui.busy = true;
    draw();
    try {
      await work();
      if (close) drawer?.close();
    } catch (error) {
      toastError(error);
      if (error?.status === 409 || error?.status === 412) ui.view = "main";
    } finally {
      ui.busy = false;
      await load();
    }
  }

  const checkIn = guardWrite((reservation, tables, count, area = null) =>
    run(async () => {
      const done = await withCorrection((extra) => api.reservationAction(reservation.id, { action: "check_in", people: count, table_codes: tables, area_key: area || undefined, occurred_at: new Date().toISOString(), ...extra }, newKey()));
      toast({
        title: "Chegou",
        message: `${firstName(done)} · ${people(count)} na ${tables.join("+") || "balcão"}`,
        action: { label: "Desfazer", onClick: () => undoCheckIn(done) },
      });
    }),
  );

  const undoCheckIn = guardWrite(async (reservation) => {
    try {
      await withCorrection((extra) => api.reservationAction(reservation.id, { action: "undo_check_in", occurred_at: new Date().toISOString(), ...extra }, newKey()));
      toast({ title: "Chegada desfeita", message: `${firstName(reservation)} voltou a esperar a mesa.` });
    } catch (error) {
      toastError(error);
    }
    await load();
  });

  const seatWalkIn = guardWrite(async (row) => {
    const held = row.state === "reserved" ? row.reservation?.time : row.heldAt;
    if (held && row.reservation?.status !== "offered" && !row.priorityLost) {
      const ok = await confirmAction({
        title: `Mesa guardada para as ${held}`,
        message: `Dá para sentar aqui até ${held}. Depois, a mesa é da reserva.`,
        confirmLabel: "Sentar mesmo assim",
        cancelLabel: "Voltar",
        danger: true,
      });
      if (!ok) return;
    }
    if (row.reservation?.status === "offered") {
      const ok = await confirmAction({
        title: `Mesa oferecida até ${houseTime(row.reservation.offer_expires_at)}`,
        message: "A pessoa da espera pode aceitar a oferta até lá. Se aceitar, a mesa é dela.",
        confirmLabel: "Sentar mesmo assim",
        cancelLabel: "Voltar",
        danger: true,
      });
      if (!ok) return;
    }
    const count = ui.people;
    const tables = [row.code, ...ui.picked.filter((c) => c !== row.code)];
    return run(async () => {
      await withCorrection((extra) => api.walkIn({ table_codes: tables, party_size: count, name: ui.name.trim() || undefined, occurred_at: new Date().toISOString(), ...extra }, newKey()));
      toast({ title: "Mesa aberta", message: `${people(count)} sem reserva na ${tables.join("+")}` });
    });
  });

  /** Um grupo no balcão (uma área em modo lista): sem mesa, só a contagem de pessoas (6.3). */
  const seatInArea = guardWrite((area) =>
    run(async () => {
      await withCorrection((extra) => api.walkIn({ area_key: area.key, party_size: ui.people, name: ui.name.trim() || undefined, occurred_at: new Date().toISOString(), ...extra }, newKey()));
      toast({ title: `No ${area.name.toLowerCase()}`, message: `${people(ui.people)} sem reserva` });
    }),
  );

  const release = guardWrite((row) => {
    const session = row.session;
    const codes = session.table_codes.join("+") || "do balcão";
    return run(async () => {
      await withCorrection((extra) => api.release(session.id, newKey(), extra));
      toast({
        title: `Mesa ${codes} liberada`,
        action: {
          label: "Desfazer",
          onClick: async () => {
            try {
              await withCorrection((extra) => api.reopenWith(session.id, extra));
              toast({ title: `Mesa ${codes} aberta de novo` });
            } catch (error) {
              toastError(error);
            }
            await load();
          },
        },
      });
    });
  });

  const extend = guardWrite((row) =>
    run(async () => {
      const s = await api.extend(row.session.id, newKey());
      toast({ title: "Mais 10 minutos de mesa", message: `Mesa ${row.code} até ${houseTime(s.ends_at)}` });
    }),
  );

  const extraTolerance = guardWrite((row) =>
    run(
      async () => {
        const r = await withCorrection((extra) => api.reservationAction(row.reservation.id, { action: "extra_tolerance", ...extra }, newKey()));
        toast({ title: `Mais ${read?.rules?.extra_tolerance_min ?? 10} minutos`, message: `A mesa ${row.code} espera ${firstName(row.reservation)} até ${houseTime(r.tolerance_until)}.` });
      },
      { close: false },
    ),
  );

  /** "Libera a mesa" no fim da tolerância: a reserva fica para "Não veio". */
  const releaseTable = guardWrite((row) =>
    run(async () => {
      await withCorrection((extra) => api.reservationAction(row.reservation.id, { action: "release_table", ...extra }, newKey()));
      toast({ title: `Mesa ${row.code} livre`, message: `A reserva de ${firstName(row.reservation)} continua: se não vier, marque "Não veio".` });
    }),
  );

  const noShow = guardWrite(async (row) => {
    const ok = await confirmAction({
      title: `${firstName(row.reservation)} não veio?`,
      message: "A reserva fica como falta e a mesa volta a ficar livre.",
      confirmLabel: "Não veio",
      cancelLabel: "Voltar",
      danger: true,
    });
    if (!ok) return;
    return run(async () => {
      await withCorrection((extra) => api.reservationAction(row.reservation.id, { action: "no_show", ...extra }, newKey()));
      toast({ title: "Marcado: não veio", message: `Mesa ${row.code} livre.` });
    });
  });

  const move = guardWrite((row, codes) =>
    run(async () => {
      await api.move(row.session.id, codes, newKey());
      toast({ title: "Mesa trocada", message: `${firstName(row.reservation)} agora na ${codes.join("+")}` });
    }),
  );

  const merge = guardWrite((row, other) =>
    run(async () => {
      await api.merge(row.session.id, other.session.id, newKey());
      toast({ title: "Mesas juntas", message: `${[...row.session.table_codes, ...other.session.table_codes].join("+")}` });
    }),
  );

  const split = guardWrite((row, codes, count) =>
    run(async () => {
      await api.split(row.session.id, codes, count, newKey());
      toast({ title: "Mesas separadas", message: `${people(count)} foram para a ${codes.join("+")}` });
    }),
  );

  const fixPeople = guardWrite((row, count) =>
    run(async () => {
      await api.setPeople(row.session.id, count, row.session.version, newKey());
      toast({ title: "Pessoas corrigidas", message: `Mesa ${row.code}: ${people(count)}` });
    }),
  );

  const postpone = guardWrite(async () => {
    try {
      const answer = await api.postponeClose();
      toast({ title: "Fechamento adiado", message: `A noite fecha às ${houseTime(answer.close_at)}.` });
    } catch (error) {
      toastError(error);
    }
    load();
  });

  async function showTimeline(row) {
    go("timeline");
    try {
      ui.detail = await api.getSession(row.session.id);
    } catch (error) {
      ui.detail = { error: problemText(error) };
    }
    draw();
    focusDrawer();
  }

  // ---- a gaveta ----------------------------------------------------------------------------

  function openTable(code, view = "main", reservationId = null) {
    const row = tableOf(code);
    if (!row) return;
    const r = reservationId ? floor.reservations.find((x) => x.id === reservationId) : row.reservation;
    ui = { ...blank(), code, view, openedState: tableSign(row), reservationId: r?.id ?? null, people: view === "checkin" ? r?.party_size || 2 : 2 };
    showDrawer();
  }

  /** O balcão em modo lista, ou uma reserva sem mesa achada por "Quem chegou?". */
  function openArea(areaKey, view = "seat-list", reservationId = null) {
    const r = reservationId ? floor.reservations.find((x) => x.id === reservationId) : null;
    ui = { ...blank(), area: areaKey, view, reservationId, people: r?.party_size || 2 };
    showDrawer();
  }

  function showDrawer() {
    draw();
    const dialog = $(".salao__gaveta", container);
    drawer = openDialog(dialog, {
      onClose: () => {
        drawer = null;
        ui = blank();
        draw();
      },
    });
    focusDrawer();
  }

  function go(view, extra = {}) {
    ui = { ...ui, view, picked: [], other: null, ...extra };
    draw();
    focusDrawer();
  }

  // o conteúdo muda dentro da gaveta aberta: o título dela recebe o foco, nunca a página
  const focusDrawer = () => requestAnimationFrame(() => $(".salao__gaveta .gaveta__foco", container)?.focus());

  const busy = () => (ui.busy ? "true" : "false");

  function drawerBody() {
    if (ui.view === "seat-list" || ui.view === "pick-table") return areaDrawer();
    const row = ui.code && tableOf(ui.code);
    if (!row) return nothing;
    const r = ui.reservationId ? floor.reservations.find((x) => x.id === ui.reservationId) || row.reservation : row.reservation;
    const title = row.joined.length ? `Mesa ${[row.code, ...row.joined].join("+")}` : `Mesa ${row.code}`;
    return html`<div class="dialog__bar">
        <b class="dialog__title" id="gaveta-titulo">${title}</b>
        <button class="dialog__close" type="button" data-close aria-label="Fechar">×</button>
      </div>
      <div class="dialog__body stack gaveta">
        ${maybe(ui.stale, html`<p class="notice" role="status"><b>Isso mudou agora há pouco.</b> A mesa já mostra o que vale agora.</p>`)}
        ${maybe(nightClosed(), html`<p class="notice notice--alert">A noite já fechou. Só o dono ou o gerente corrigem, com motivo.</p>`)}
        ${body(row, r)}
      </div>`;
  }

  /** A gaveta do balcão em modo lista, ou de uma reserva que precisa de mesa para sentar. */
  function areaDrawer() {
    const area = read?.areas.find((a) => a.key === ui.area);
    const r = ui.reservationId ? floor.reservations.find((x) => x.id === ui.reservationId) : null;
    const head = (title) => html`<div class="dialog__bar">
        <b class="dialog__title" id="gaveta-titulo">${title}</b>
        <button class="dialog__close" type="button" data-close aria-label="Fechar">×</button>
      </div>`;
    if (ui.view === "pick-table" && r) {
      const free = freeTables(read).filter((t) => t.max_seats >= Math.min(ui.people, 2));
      return html`${head(`Chegou: ${firstName(r)}`)}
        <div class="dialog__body stack gaveta">
          <p class="gaveta__foco" tabindex="-1">${r.lost_table_codes?.length ? `A mesa ${r.lost_table_codes.join("+")} foi liberada no fim da tolerância.` : "Essa reserva está sem mesa."} Escolha uma mesa livre.</p>
          ${stepper({ id: "mesa-pessoas", label: "Quantas pessoas entraram?", value: ui.people, max: 40, onChange: (n) => ((ui.people = n), draw()) })}
          ${tablePicker({ label: "Mesas livres", tables: free, picked: ui.picked, onPick: (codes) => ((ui.picked = codes), draw()), empty: "Nenhuma mesa livre agora. Ponha na espera ou sente no balcão." })}
          <div class="gaveta__acoes"><button class="btn" type="button" ?disabled=${!ui.picked.length} aria-busy=${busy()} @click=${() => checkIn(r, ui.picked, ui.people)}>Confirmar chegada</button></div>
        </div>`;
    }
    if (!area) return nothing;
    const free = Math.max(0, area.capacity - area.inside);
    return html`${head(`Sentar no ${area.name.toLowerCase()}`)}
      <div class="dialog__body stack gaveta">
        <p class="gaveta__foco" tabindex="-1"><b>${area.inside}</b> de ${area.capacity} pessoas · ${free} lugares agora. Aqui não se escolhe mesa.</p>
        ${stepper({ id: "balcao-pessoas", label: "Quantas pessoas?", value: ui.people, max: Math.max(1, free), onChange: (n) => ((ui.people = n), draw()) })}
        <div class="field">
          <label class="field__label" for="balcao-nome">Nome (se quiser)</label>
          <input class="field__input" id="balcao-nome" autocomplete="off" maxlength="60" .value=${ui.name} @input=${(e) => (ui.name = e.target.value)} />
        </div>
        ${maybe(ui.people > free, html`<p class="notice" role="status">O ${area.name.toLowerCase()} cabe mais ${free} pessoas agora.</p>`)}
        <div class="gaveta__acoes"><button class="btn" type="button" ?disabled=${ui.people > free || !free} aria-busy=${busy()} @click=${() => seatInArea(area)}>Sentar</button></div>
      </div>`;
  }

  function body(row, r) {
    switch (ui.view) {
      case "checkin":
        return checkInView(row, r);
      case "seat":
        return seatView(row);
      case "move":
      case "join":
      case "split":
      case "checkin-move":
      case "checkin-join":
        return pickView(row, r);
      case "people":
        return peopleView(row);
      case "timeline":
        return timelineView(row);
      default:
        return mainView(row, r);
    }
  }

  const back = () => html`<button class="link-button" type="button" @click=${() => go("main")}>Voltar</button>`;

  function who(r) {
    if (!r) return nothing;
    const flags = (r.flags || []).map((f) => html`<span class="badge">${FLAG_WORD[f] || f}</span>`);
    return html`<div class="gaveta__quem">
      <p><b>${r.customer?.name || firstName(r)}</b> · ${people(r.party_size)} · ${r.source === "walk_in" ? "chegou sem reserva" : `${r.time} · ${r.code}`}</p>
      ${maybe(r.customer?.phone_masked, html`<p class="gaveta__fraco">${r.no_whatsapp ? "Telefone" : "WhatsApp"} ${r.customer?.phone_masked}</p>`)}
      ${maybe(flags.length || r.customer_arriving_at || r.last_notified, html`<p class="cluster gaveta__marcas">${flags} ${arrivingNote(r)} ${notifiedNote(r)}</p>`)}
      ${maybe(r.notes, html`<p class="gaveta__fraco">${r.notes}</p>`)}
    </div>`;
  }

  /** As mensagens prontas de uma reserva desta noite, sem nunca mostrar o telefone (6.9). */
  function ready(r) {
    if (!r || r.source === "walk_in" || !["confirmed", "completed"].includes(r.status)) return nothing;
    return html`<details class="gaveta__prontas">
      <summary class="link-button">Mensagens prontas</summary>
      ${readyButtons(r, { whatsapp: floor.whatsapp, onSent: () => load({ quiet: true }) })}
    </details>`;
  }

  function lateParagraph(row, r) {
    const rules = read.rules || {};
    const sentence = toleranceSentence(r, rules);
    if (!row.over) {
      return html`<p class="gaveta__tolerancia">
        ${sentence} · faltam ${row.left + 1} min
        ${r.customer_late ? html`<span class="badge badge--said-yes">avisou</span>` : nothing}
      </p>`;
    }
    const what = rules.after_tolerance === "release"
      ? rules.on_tolerance_end === "auto_release"
        ? "A mesa foi solta sozinha."
        : "A reserva perde a mesa: libere para quem chega."
      : "A mesa deixa de ser prioridade: dá para sentar quem chega. Se o grupo aparecer e houver lugar, o \"Chegou\" vale.";
    return html`<p class="gaveta__tolerancia">
      ${rules.tolerance_min || r.extra_tolerance_min ? html`A tolerância acabou às <b>${houseTime(row.deadline.toISOString())}</b>.` : html`A mesa esperava às <b>${r.time}</b> em ponto.`}
      ${what} Se o grupo não veio, marque "Não veio".
      ${r.customer_late ? html`<span class="badge badge--said-yes">avisou</span>` : nothing}
    </p>`;
  }

  function mainView(row, r) {
    const word = html`<p class="gaveta__foco" tabindex="-1"><span class="estado-mesa estado-mesa--${row.state}">${STATE_WORD[row.state]}</span> ${row.max_seats} lugares</p>`;
    if (row.session) {
      const s = row.session;
      const near = row.state === "release";
      return html`${word} ${who(r)}
        <dl class="gaveta__dados">
          <div><dt>Sentou</dt><dd>${houseTime(s.seated_at)}</dd></div>
          <div><dt>Pessoas</dt><dd>${s.people}${s.over_capacity ? " · acima da mesa" : ""}</dd></div>
          <div><dt>Mesa até</dt><dd>${s.ends_at ? houseTime(s.ends_at) : "livre"}${s.extended_min ? ` (+${s.extended_min} min)` : ""}</dd></div>
          ${maybe(row.next, html`<div><dt>Livre até</dt><dd>${row.next?.time} · ${firstName(row.next)}</dd></div>`)}
        </dl>
        ${maybe(near, html`<p class="notice notice--alert">A mesa precisa vagar até ${houseTime(s.ends_at)}${row.next ? `: ${firstName(row.next)} chega às ${row.next.time}` : ": tem gente na espera"}.</p>`)}
        <div class="gaveta__acoes">
          <button class="btn" type="button" aria-busy=${busy()} @click=${() => release(row)}>Liberar mesa</button>
          ${maybe(near, html`<button class="btn btn--outline" type="button" aria-busy=${busy()} @click=${() => extend(row)}>+10 min de mesa</button>`)}
          <button class="btn btn--outline" type="button" @click=${() => go("move")}>Trocar de mesa</button>
          <button class="btn btn--outline" type="button" @click=${() => go("join")}>Juntar mesas</button>
          ${maybe(s.table_codes.length > 1, html`<button class="btn btn--outline" type="button" @click=${() => go("split", { people: 1 })}>Separar mesas</button>`)}
          <button class="btn btn--outline" type="button" @click=${() => go("people", { people: s.people })}>Corrigir pessoas</button>
          <button class="btn btn--outline" type="button" @click=${() => showTimeline(row)}>Linha do tempo</button>
        </div>
        ${ready(r)}`;
    }
    if (row.state === "late") {
      const rules = read.rules || {};
      const canRelease = row.over && rules.after_tolerance === "release" && rules.on_tolerance_end !== "auto_release";
      return html`${word} ${who(r)}
        ${lateParagraph(row, r)}
        <div class="gaveta__acoes">
          <button class="btn" type="button" @click=${() => go("checkin", { people: r.party_size, reservationId: r.id })}>Chegou</button>
          <button class="btn btn--outline" type="button" aria-busy=${busy()} @click=${() => extraTolerance(row)}>+${rules.extra_tolerance_min ?? 10} min</button>
          ${maybe(row.over, html`<button class="btn btn--outline" type="button" @click=${() => noShow(row)}>Não veio</button>`)}
          ${maybe(canRelease, html`<button class="btn btn--outline" type="button" aria-busy=${busy()} @click=${() => releaseTable(row)}>Liberar a mesa</button>`)}
          ${maybe(row.priorityLost, html`<button class="btn btn--outline" type="button" @click=${() => go("seat", { people: 2 })}>Sentar quem chegou</button>`)}
        </div>
        ${ready(r)}`;
    }
    if (row.state === "reserved") {
      const offered = r.status === "offered";
      return html`${word} ${who(r)}
        ${offered ? html`<p class="notice">Mesa oferecida pela espera até ${houseTime(r.offer_expires_at)}. Se a pessoa aceitar, a mesa é dela.</p>` : nothing}
        ${r.status === "pending" ? html`<p class="notice">Reserva pendente: a mesa fica presa até o dono ou o gerente decidir.</p>` : nothing}
        ${r.status === "confirmed" ? html`<p class="gaveta__fraco">${toleranceSentence(r, read.rules)}.</p>` : nothing}
        <div class="gaveta__acoes">
          ${maybe(!offered, html`<button class="btn" type="button" @click=${() => go("checkin", { people: r.party_size, reservationId: r.id })}>Chegou</button>`)}
          <button class="btn btn--outline" type="button" @click=${() => go("seat", { people: 2 })}>Sentar sem reserva</button>
        </div>
        ${ready(r)}`;
    }
    return html`${word}
      <p>${row.heldAt ? html`Livre agora. Guardada para as <b>${row.heldAt}</b> (${firstName(row.next)}).` : "Livre a noite toda até agora."}</p>
      <div class="gaveta__acoes">
        <button class="btn" type="button" @click=${() => go("seat", { people: 2 })}>Sentar sem reserva</button>
      </div>`;
  }

  function checkInView(row, r) {
    const tables = r.table_codes?.length ? r.table_codes : [row.code];
    const seats = seatsOf([...read.tables.values()], tables);
    const over = ui.people > seats;
    return html`${back()}
      <h2 class="gaveta__foco gaveta__titulo" tabindex="-1">Chegou: ${firstName(r)}</h2>
      ${who(r)}
      ${stepper({ id: "chegou-pessoas", label: "Quantas pessoas entraram?", value: ui.people, max: 40, onChange: (n) => ((ui.people = n), draw()) })}
      ${over
        ? html`<div class="notice notice--alert" role="status">
              <b>${people(ui.people)} para ${seats} lugares na ${tables.join("+")}.</b> Troque de mesa, junte outra ou sente assim mesmo.
            </div>
            <div class="gaveta__acoes">
              <button class="btn btn--outline" type="button" @click=${() => go("checkin-move", { people: ui.people })}>Trocar de mesa</button>
              <button class="btn btn--outline" type="button" @click=${() => go("checkin-join", { people: ui.people })}>Juntar</button>
              <button class="btn" type="button" aria-busy=${busy()} @click=${() => checkIn(r, tables, ui.people)}>Sentar assim mesmo</button>
            </div>`
        : html`<div class="gaveta__acoes">
            <button class="btn" type="button" aria-busy=${busy()} @click=${() => checkIn(r, tables, ui.people)}>Confirmar chegada na ${tables.join("+")}</button>
          </div>`}`;
  }

  function seatView(row) {
    return html`${back()}
      <h2 class="gaveta__foco gaveta__titulo" tabindex="-1">Sentar sem reserva na ${row.code}</h2>
      ${maybe(row.heldAt || row.state === "reserved", html`<p class="gaveta__fraco">Dá para sentar aqui até ${row.heldAt || row.reservation?.time}.</p>`)}
      ${stepper({ id: "sentar-pessoas", label: "Quantas pessoas?", value: ui.people, max: 20, onChange: (n) => ((ui.people = n), draw()) })}
      <div class="field">
        <label class="field__label" for="sentar-nome">Nome (se quiser)</label>
        <input class="field__input" id="sentar-nome" name="nome" autocomplete="off" maxlength="60" .value=${ui.name} @input=${(e) => (ui.name = e.target.value)} />
      </div>
      ${maybe(ui.people > row.max_seats, html`<p class="notice" role="status">A ${row.code} tem ${row.max_seats} lugares. Junte outra mesa livre ou sente assim mesmo.</p>`)}
      ${maybe(
        ui.people > row.max_seats,
        tablePicker({
          label: "Juntar com",
          tables: freeTables(read).filter((t) => t.code !== row.code && t.area === row.area),
          picked: ui.picked,
          onPick: (codes) => ((ui.picked = codes), draw()),
        }),
      )}
      <div class="gaveta__acoes">
        <button class="btn" type="button" aria-busy=${busy()} @click=${() => seatWalkIn(row)}>Sentar</button>
      </div>`;
  }

  function pickView(row, r) {
    const free = freeTables(read);
    const others = [...read.tables.values()].filter((t) => t.session && row.session && t.session.id !== row.session.id && t.code === t.session.table_codes[0]);
    const pick = (codes) => ((ui.picked = codes), (ui.other = null), draw());
    const go2 = (label, enabled, act) => html`<div class="gaveta__acoes"><button class="btn" type="button" ?disabled=${!enabled} aria-busy=${busy()} @click=${act}>${label}</button></div>`;
    const heading = (text) => html`${back()}<h2 class="gaveta__foco gaveta__titulo" tabindex="-1">${text}</h2>`;
    switch (ui.view) {
      case "move":
        return html`${heading(`Trocar a mesa ${row.code}`)}
          ${tablePicker({ label: "Para qual mesa livre?", tables: free, picked: ui.picked, single: true, onPick: pick })}
          ${go2(ui.picked.length ? `Trocar para a ${ui.picked[0]}` : "Escolha a mesa", ui.picked.length, () => move(row, ui.picked))}`;
      case "join":
        return html`${heading(`Juntar à ${row.code}`)}
          ${tablePicker({ label: "Mesas livres para juntar", tables: free, picked: ui.picked, onPick: pick })}
          ${maybe(
            others.length,
            tablePicker({
              label: "Ou um grupo já sentado (as pessoas passam para cá)",
              tables: others.map((t) => ({ ...t, code: t.session.table_codes.join("+"), pickWord: firstName(t.reservation) })),
              picked: ui.other ? [ui.other.session.table_codes.join("+")] : [],
              single: true,
              onPick: ([code]) => ((ui.other = others.find((t) => t.session.table_codes.join("+") === code)), (ui.picked = []), draw()),
            }),
          )}
          ${ui.other
            ? go2(`Juntar com ${firstName(ui.other.reservation)}`, true, () => merge(row, ui.other))
            : go2(ui.picked.length ? `Juntar ${ui.picked.join("+")}` : "Escolha a mesa", ui.picked.length, () => move(row, [...row.session.table_codes, ...ui.picked]))}`;
      case "split": {
        const own = row.session.table_codes.map((c) => tableOf(c)).filter(Boolean);
        return html`${heading(`Separar a ${row.session.table_codes.join("+")}`)}
          ${tablePicker({ label: "Qual mesa sai?", tables: own.map((t) => ({ ...t, pickWord: "desta mesa" })), picked: ui.picked, onPick: pick })}
          ${stepper({ id: "separar-pessoas", label: "Quantas pessoas vão junto?", value: ui.people, max: Math.max(1, row.session.people - 1), onChange: (n) => ((ui.people = n), draw()) })}
          ${go2("Separar", ui.picked.length && ui.picked.length < own.length, () => split(row, ui.picked, ui.people))}`;
      }
      case "checkin-move":
        return html`${heading(`Outra mesa para ${firstName(r)}`)}
          ${tablePicker({ label: `Mesas livres para ${people(ui.people)}`, tables: free.filter((t) => t.max_seats >= ui.people), picked: ui.picked, single: true, onPick: pick, empty: "Nenhuma mesa livre desse tamanho. Junte duas ou sente assim mesmo." })}
          ${go2(ui.picked.length ? `Sentar na ${ui.picked[0]}` : "Escolha a mesa", ui.picked.length, () => checkIn(r, ui.picked, ui.people))}`;
      default: {
        const base = r.table_codes?.length ? r.table_codes : [row.code];
        return html`${heading(`Juntar mesas para ${firstName(r)}`)}
          ${tablePicker({ label: "Mesas livres para juntar", tables: free, picked: ui.picked, onPick: pick })}
          ${go2(ui.picked.length ? `Sentar na ${[...base, ...ui.picked].join("+")}` : "Escolha a mesa", ui.picked.length, () => checkIn(r, [...base, ...ui.picked], ui.people))}`;
      }
    }
  }

  function peopleView(row) {
    return html`${back()}
      <h2 class="gaveta__foco gaveta__titulo" tabindex="-1">Pessoas na ${row.code}</h2>
      ${stepper({ id: "corrigir-pessoas", label: "Quantas pessoas estão na mesa?", value: ui.people, max: 40, onChange: (n) => ((ui.people = n), draw()) })}
      <div class="gaveta__acoes">
        <button class="btn" type="button" ?disabled=${ui.people === row.session.people} aria-busy=${busy()} @click=${() => fixPeople(row, ui.people)}>Gravar</button>
      </div>`;
  }

  function timelineView(row) {
    const d = ui.detail;
    return html`${back()}
      <h2 class="gaveta__foco gaveta__titulo" tabindex="-1">Linha do tempo da ${row.code}</h2>
      ${!d
        ? html`<p role="status">Carregando…</p>`
        : d.error
          ? html`<p class="notice notice--alert" role="alert"><b>${d.error.title}.</b> ${d.error.message}</p>`
          : html`<ol class="linha-tempo">
              ${d.events.map(
                (e) => html`<li>
                  <time datetime=${e.occurred_at || e.at}>${houseTime(e.occurred_at || e.at)}</time>
                  <span><b>${EVENT_WORD[e.kind] || e.kind}</b>${e.table_codes?.length ? ` · ${e.table_codes.join("+")}` : ""}${e.people ? ` · ${people(e.people)}` : ""}
                    <small>por ${e.actor_label}${e.device_label ? ` · ${e.device_label}` : ""}</small></span>
                </li>`,
              )}
            </ol>`}`;
  }

  // ---- o salão -----------------------------------------------------------------------------

  // a planta desenha cada mesa onde o layout manda, com os pontos fixos da casa
  // (bar, cozinha, entrada…) embaixo delas num tom neutro; a lista do celular mostra os pontos
  // como referência no alto de cada área (história 3.13)
  function node(t, style = "") {
    const shape = t.shape === "round" ? "table-node--round" : t.shape === "stool" ? "table-node--stool" : t.shape === "long" ? "table-node--long" : "";
    const cls = t.state === "free" ? "" : `is-${t.state}`;
    const label = t.state === "late" && t.reservation ? `Mesa ${t.code}, atrasada. ${toleranceSentence(t.reservation, read.rules)}` : undefined;
    return html`<button class="table-node ${shape} ${cls}" style=${style} type="button" data-mesa=${t.code} aria-haspopup="dialog" aria-label=${label ?? nothing} @click=${() => openTable(t.code)}>
      ${maybe(t.joined.length, html`<span class="table-node__joined">+${t.joined.join("+")}</span>`)}
      <b>${t.code}</b><span class="table-node__estado">${STATE_WORD[t.state]}</span><span class="table-node__nota">${t.note}</span>
    </button>`;
  }

  function listArea(area) {
    const free = Math.max(0, area.capacity - area.inside);
    return html`<div class="salao__contagem-area">
      <p class="salao__contagem"><b>${area.inside}</b> de ${area.capacity} pessoas · ${free} lugares</p>
      <button class="btn btn--sm btn--outline" type="button" aria-haspopup="dialog" ?disabled=${!free} @click=${() => openArea(area.key)}>Sentar no ${area.name.toLowerCase()}</button>
    </div>`;
  }

  function plan() {
    return html`<div class="floor salao__planta salao__planta--desenho">
      ${read.areas.map(
        (a) => html`<section class="floor-area" aria-label=${a.name}>
          <span class="floor-area__name" aria-hidden="true">${a.name}</span>
          ${a.mode === "list" ? html`${listArea(a)}${fixtureRefs(a)}` : floorMap(a, node)}
        </section>`,
      )}
    </div>`;
  }

  function list() {
    return html`<div class="salao__lista">
      ${read.areas.map(
        (a) => html`<section class="salao__area" aria-labelledby=${`lista-${a.key}`}>
          <h2 class="salao__area-nome" id=${`lista-${a.key}`}>${a.name}</h2>
          ${fixtureRefs(a)}
          ${a.mode === "list"
            ? listArea(a)
            : html`<ul class="salao__linhas">
                ${a.tables.map(
                  (t) => html`<li>
                    <button class="linha-mesa linha-mesa--${t.state}" type="button" data-mesa=${t.code} aria-haspopup="dialog" @click=${() => openTable(t.code)}>
                      <b class="linha-mesa__codigo">${t.code}</b>
                      <span class="estado-mesa estado-mesa--${t.state}">${STATE_WORD[t.state]}</span>
                      <span class="linha-mesa__nota">${t.note}${t.joined.length ? ` · com ${t.joined.join("+")}` : ""}</span>
                    </button>
                  </li>`,
                )}
              </ul>`}
        </section>`,
      )}
    </div>`;
  }

  function search() {
    const found = query ? arriving(floor, now()).filter((r) => matches(r, query)) : [];
    const chegou = (r) => {
      query = "";
      if (r.table_codes?.length && tableOf(r.table_codes[0])) openTable(r.table_codes[0], "checkin", r.id);
      else {
        const list = read.areas.find((a) => a.mode === "list" && a.key === r.area_key);
        openArea(list ? list.key : null, "pick-table", r.id);
      }
    };
    const onKey = (event) => {
      if (event.key === "Escape") {
        query = "";
        event.target.value = "";
        draw();
      } else if (event.key === "Enter" && found[0]) {
        event.preventDefault();
        chegou(found[0]);
      }
    };
    return html`<div class="salao__busca">
      <div class="field">
        <label class="field__label" for="quem-chegou">Quem chegou?</label>
        <input
          class="field__input"
          id="quem-chegou"
          type="search"
          autocomplete="off"
          aria-describedby="quem-chegou-dica"
          aria-controls="quem-chegou-lista"
          .value=${query}
          @input=${(e) => ((query = e.target.value), draw())}
          @keydown=${onKey}
        />
        <p class="field__help" id="quem-chegou-dica">Nome, código TR ou os 4 últimos dígitos do telefone. Atalho: tecla /</p>
      </div>
      <ul class="salao__achados" id="quem-chegou-lista" aria-live="polite">
        ${query && !found.length ? html`<li class="salao__nada">Ninguém da noite com esse nome.</li>` : nothing}
        ${found.slice(0, 6).map(
          (r) => html`<li>
            <span><b>${r.customer?.name}</b> · ${people(r.party_size)} · ${r.time} · ${r.table_codes.join("+") || "sem mesa"}${r.late ? " · atrasada" : ""}</span>
            <button class="btn btn--sm" type="button" @click=${guardWrite(() => chegou(r))}>Chegou</button>
          </li>`,
        )}
      </ul>
    </div>`;
  }

  function summary() {
    const c = counts(read);
    const parts = [
      [c.free, "livre", "livres"],
      [c.reserved, "reservada", "reservadas"],
      [c.seated, "sentada", "sentadas"],
      [c.late, "atrasada", "atrasadas"],
      [c.release, "para liberar", "para liberar"],
    ].filter(([n]) => n);
    return html`<p class="salao__resumo">${parts.map(([n, one, many], i) => html`${i ? " · " : ""}<b>${n}</b> ${n === 1 ? one : many}`)}</p>`;
  }

  /** "A noite fecha às 00:30: 3 mesas ainda abertas", com a 1 h a mais para o dono e o gerente. */
  function closing() {
    const c = floor.night?.closing;
    if (!c) return nothing;
    return html`<div class="notice notice--alert retrato-faixa" role="status">
      <p><b>A noite fecha às ${c.time}:</b> ${c.open_tables} ${c.open_tables === 1 ? "mesa ainda aberta" : "mesas ainda abertas"}. No fechamento, as mesas abertas fecham sozinhas e quem não chegou vira "Não veio".</p>
      ${canPostpone && c.can_postpone ? html`<button class="btn btn--sm btn--outline" type="button" @click=${postpone}>Adiar 1 h</button>` : nothing}
    </div>`;
  }

  function rulesLine() {
    const rules = read.rules || {};
    if (!rules.tolerance_min && rules.tolerance_min !== 0) return nothing;
    // a linha abre a tabela única da casa para a regra (2.12), a mesma de Configurações
    return html`<details class="salao__regra">
      <summary>${rules.tolerance_min ? `Tolerância de ${rules.tolerance_min} min` : "A mesa espera no horário, em ponto"}${rules.after_tolerance === "release" ? " · no fim, a reserva perde a mesa" : " · no fim, a mesa deixa de ser prioridade"}${rules.on_tolerance_end === "auto_release" ? " sozinha" : ""}.</summary>
      ${toleranceTable(rules)}
    </details>`;
  }

  /** O retrato da noite guardado no aparelho, só para leitura. */
  function offlineScreen() {
    if (!pictureRead) return loadingBlock();
    if (!picture) return noPicture(mode);
    const offline = readFloor(picture.floor, new Date(picture.saved_at));
    return html`<div class="salao">
      ${offlineBand(mode, picture)}
      <div class="floor salao__planta salao__planta--desenho">
        ${offline.areas.map(
          (a) => html`<section class="floor-area" aria-label=${a.name}>
            <span class="floor-area__name" aria-hidden="true">${a.name}</span>
            ${a.mode === "list"
              ? html`<p class="salao__contagem"><b>${a.inside}</b> de ${a.capacity} pessoas</p>${fixtureRefs(a)}`
              : floorMap(
                  a,
                  (t, style) => html`<button class="table-node ${t.shape === "round" ? "table-node--round" : t.shape === "stool" ? "table-node--stool" : ""} ${t.state === "free" ? "" : `is-${t.state}`}" style=${style} type="button" data-mesa=${t.code} @click=${guardWrite(() => {})}>
                    <b>${t.code}</b><span class="table-node__estado">${STATE_WORD[t.state]}</span><span class="table-node__nota">${t.note}</span>
                  </button>`,
                )}
          </section>`,
        )}
      </div>
      <div class="salao__lista">
        ${offline.areas.map(
          (a) => html`<section class="salao__area" aria-labelledby=${`retrato-${a.key}`}>
            <h2 class="salao__area-nome" id=${`retrato-${a.key}`}>${a.name}</h2>
            ${fixtureRefs(a)}
            <ul class="salao__linhas">
              ${a.tables.map(
                (t) => html`<li><button class="linha-mesa linha-mesa--${t.state}" type="button" data-mesa=${t.code} @click=${guardWrite(() => {})}>
                  <b class="linha-mesa__codigo">${t.code}</b><span class="estado-mesa estado-mesa--${t.state}">${STATE_WORD[t.state]}</span><span class="linha-mesa__nota">${t.note}</span>
                </button></li>`,
              )}
            </ul>
          </section>`,
        )}
      </div>
    </div>`;
  }

  function screen() {
    if (mode !== "online") return offlineScreen();
    if (loadError) return errorBlock(loadError, () => ((loadError = null), draw(), load()));
    if (!floor) return loadingBlock();
    if (!read) {
      return html`<div class="area__vazio">
        <span class="raiz" aria-hidden="true"></span>
        <p><b>Sem planta para esta noite.</b> ${floor.day?.reason_label ? `${floor.day.reason_label}. ` : ""}A planta aparece quando a noite tiver um plano.</p>
        ${canPlan ? html`<a class="btn" href="/admin/agenda">Abrir a Agenda</a>` : html`<p>Se precisar, peça ao dono ou ao gerente.</p>`}
      </div>`;
    }
    const clock = now();
    const demo = Math.abs(offset) > 5 * 60_000;
    return html`<div class="salao">
      ${backlogBand(draw)}
      <div class="salao__topo">
        <p class="salao__noite">
          Noite de ${formatDay(floor.date, "long")} · <b>${houseTime(clock.toISOString())}</b>${demo ? html` <small>(hora da demonstração)</small>` : nothing}
        </p>
        <div class="salao__atalhos">
          <a class="btn btn--outline btn--sm" href="/admin/salao/folha">Folha da noite</a>
          <a class="btn btn--outline btn--sm" href="/admin/espera">Espera${waitCount ? ` · ${waitCount}` : ""}</a>
          <a class="btn btn--outline btn--sm" href="/admin/salao/papel">Lançar do papel</a>
          ${floor.day?.event && ["list", "mixed"].includes(floor.day.event.booking_mode) ? html`<a class="btn btn--sm" href=${`/admin/salao/porta?evento=${encodeURIComponent(floor.day.event.id)}`}>Porta do evento</a>` : nothing}
        </div>
      </div>
      ${closing()}
      ${maybe(nightClosed(), html`<p class="notice notice--alert" role="status"><b>A noite já fechou.</b> Só o dono ou o gerente corrigem, com motivo.</p>`)}
      ${maybe(Boolean(floor?.night?.closed) && fixesClosed, html`<p class="notice" role="status" data-estado="noite-fechada"><b>A noite já fechou.</b> Dá para corrigir: cada mudança pede o motivo, que fica no registro de ações.</p>`)}
      ${search()} ${summary()} ${rulesLine()}
      <p class="sr-only" aria-live="polite">${announce}</p>
      ${maybe(lost, html`<p class="notice" role="status" data-estado="realtime_lost">${realtimeLostNotice}</p>`)}
      ${plan()} ${list()}
      <dialog class="dialog dialog--drawer salao__gaveta" aria-labelledby="gaveta-titulo">${drawerBody()}</dialog>
    </div>`;
  }

  /** O leitor de tela ouve a hora limite uma vez, e um alerta 2 minutos antes do fim, nunca a cada segundo. */
  function warnLate() {
    if (!read) return;
    const near = [...read.tables.values()].filter((t) => t.state === "late" && !t.over && t.left <= 1 && !warned.has(t.reservation.id));
    if (!near.length) return;
    near.forEach((t) => warned.add(t.reservation.id));
    announce = near.map((t) => `Mesa ${t.code}: faltam 2 minutos da tolerância, até ${houseTime(t.deadline.toISOString())}`).join(". ");
  }

  // ---- ciclo de vida ----------------------------------------------------------------------

  const onSlash = (event) => {
    if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable], dialog[open]")) return;
    const input = $("#quem-chegou", container);
    if (!input) return;
    event.preventDefault();
    input.focus();
  };
  document.addEventListener("keydown", onSlash);
  const live = startLive({
    skip: ["alerts"],
    refresh: () => (floor || mode !== "online" ? load({ quiet: true }) : undefined),
    onState: ({ lost: down }) => {
      lost = down;
      draw();
    },
  });
  setHealthCheck(() => load({ quiet: true }));
  const stopConnection = onConnection((next) => {
    mode = next;
    if (next === "online") load({ quiet: Boolean(floor) });
    else showPicture();
  });
  // as contagens regressivas mudam no texto a cada minuto
  const tick = setInterval(() => {
    if (floor?.day?.layout) {
      read = readFloor(floor, now());
      warnLate();
    }
    draw();
  }, TICK_MS);

  draw();
  await load();
  warned = new Set([...(read?.tables.values() || [])].filter((t) => t.state === "late" && t.left <= 1).map((t) => t.reservation.id));

  return () => {
    alive = false;
    live.stop();
    stopConnection();
    setHealthCheck(null);
    clearInterval(tick);
    document.removeEventListener("keydown", onSlash);
    drawer?.close();
  };
}

