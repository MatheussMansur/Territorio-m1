// Espera (histórias 5.12 e 5.13): a lista de espera da noite por faixa de horário, com a posição, pessoas,
// quanto tempo esperam e a contagem regressiva de uma mesa oferecida. A partir de uma linha: oferecer mesa por
// WhatsApp, transformar em reserva, sentar o grupo agora ou tirar da fila com um motivo.
// "Pôr na espera quem chegou" adiciona um grupo esperando na porta; um grupo da porta que deixou telefone
// recebe "Sua mesa está pronta" com um toque. Uma oferta que o WhatsApp não entregou aparece na
// linha. A fila se atualiza sozinha pela transmissão ao vivo, e sem conexão mostra o
// retrato da noite guardado no aparelho.
import "./salao.css";
import "./espera.css";
import { confirmAction } from "../../components/confirm.js";
import { openDialog } from "../../components/dialog.js";
import { toast } from "../../components/toast.js";
import { houseTime } from "../../lib/dates.js";
import { askAgain } from "./reservas/chegada.js";
import { $, html, nothing, render } from "../../lib/html.js";
import * as api from "../../services/api/staff-espera.js";
import { firstName, freeTables, minutesUntil, people, readFloor } from "./salao/model.js";
import { backlogBand, connection, guardWrite, noPicture, offlineBand, onConnection, readPicture, report } from "./salao/retrato.js";
import { errorBlock, loadingBlock, maybe, newKey, problemText, seatsOf, stepper, tablePicker, toastError } from "./salao/ui.js";
import { changeSummary, countChanges, realtimeLostNotice, startLive } from "./salao/vivo.js";
import { withCorrection } from "./salao/correcao.js";

const TICK_MS = 30_000;
const REASONS = ["Desistiu de esperar", "Foi embora sem avisar", "Não respondeu a oferta", "Sentou sem passar pela espera"];

export async function mount(container) {
  let entries = null;
  let floor = null;
  let read = null;
  let loadError = null;
  let offset = 0;
  let drawer = null;
  let ui = blank();
  let alive = true;
  let etag = null;
  let lost = false;
  let announce = "";
  let mode = connection();
  let picture = null;
  let pictureRead = false;

  function blank() {
    return { view: null, id: null, picked: [], people: 2, name: "", phone: "", time: "", reason: REASONS[0], busy: false, errors: {} };
  }

  const now = () => new Date(Date.now() + offset);
  const draw = () => alive && render(screen(), container);
  const entry = () => entries?.find((e) => e.id === ui.id);

  async function load({ quiet = false } = {}) {
    if (connection() === "offline") return showPicture();
    try {
      const [answer, night] = await Promise.all([api.listFresh(quiet ? etag : null), api.floor()]);
      if (!alive) return;
      report(true);
      if (connection() !== "online") return showPicture();
      mode = "online";
      if (answer.changed) {
        if (quiet && entries) announce = changeSummary(countChanges(entries, answer.data, (e) => `${e.status}|${e.waitlist_position}|${e.offer_expires_at}|${e.last_notified?.at}`), "pessoa da espera", "pessoas da espera");
        entries = answer.data;
        etag = answer.etag;
      }
      floor = night;
      offset = Date.parse(night.server_time) - Date.now();
      read = night.day?.layout ? readFloor(night, now()) : null;
      loadError = null;
    } catch (error) {
      if (!alive) return;
      report(false, error);
      if (connection() !== "online") return showPicture();
      if (!entries) loadError = error;
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

  // ---- ações -----------------------------------------------------------------------------

  async function run(work) {
    ui.busy = true;
    ui.errors = {};
    draw();
    try {
      await work();
      drawer?.close();
    } catch (error) {
      if (error?.status === 422 && error.errors?.length) ui.errors = error.fieldErrors;
      else toastError(error);
    } finally {
      ui.busy = false;
      await load();
    }
  }

  /** "Sua mesa está pronta" para um grupo da porta que deixou telefone, sem mostrá-lo (6.9). */
  const tellReady = guardWrite(async (e) => {
    const send = (repeat) => api.notifyReady(e.id, { repeat });
    try {
      await send(false);
    } catch (error) {
      if (error?.body?.reason !== "recently_sent") return toast({ kind: "error", ...readyProblem(error) });
      const again = await askAgain("Mandar de novo?", `Você já mandou essa às ${houseTime(error.body.sent_at)}. Mandar de novo?`, "Mandar de novo");
      if (!again) return;
      try {
        await send(true);
      } catch (second) {
        return toast({ kind: "error", ...readyProblem(second) });
      }
    }
    toast({ title: "Mensagem enviada", message: `${firstName(e)} sabe que a mesa está pronta.` });
    load({ quiet: true });
  });

  const readyProblem = (error) => (error?.type === "whatsapp_down" ? { ...problemText(error), message: "Chame na porta." } : problemText(error));

  const offer = (e, codes) =>
    run(async () => {
      const done = await api.offer(e.id, codes, newKey());
      toast({ title: "Oferta enviada", message: `${firstName(e)} tem até ${houseTime(done.offer_expires_at)} para aceitar a ${codes.join("+")}.` });
    });

  const confirm = (e, codes) =>
    run(async () => {
      await withCorrection((extra) => api.reservationAction(e.id, { action: "confirm", table_codes: codes, ...extra }, newKey()));
      toast({ title: "Virou reserva", message: `${firstName(e)} · ${e.time} · mesa ${codes.join("+")}` });
    });

  const seat = (e, codes, count) =>
    run(async () => {
      await withCorrection((extra) => api.reservationAction(e.id, { action: "check_in", table_codes: codes, people: count, occurred_at: new Date().toISOString(), ...extra }, newKey()));
      toast({ title: "Mesa aberta", message: `${firstName(e)} · ${people(count)} na ${codes.join("+")}` });
    });

  async function remove(e) {
    const ok = await confirmAction({
      title: `Tirar ${firstName(e)} da fila?`,
      message: `Motivo: ${ui.reason}. A pessoa não recebe mensagem.`,
      confirmLabel: "Tirar da fila",
      cancelLabel: "Voltar",
      danger: true,
    });
    if (!ok) return;
    return run(async () => {
      await withCorrection((extra) => api.reservationAction(e.id, { action: "cancel", reason: ui.reason, ...extra }, newKey()));
      toast({ title: "Saiu da fila", message: `${firstName(e)} · ${ui.reason.toLowerCase()}` });
    });
  }

  const addAtDoor = () =>
    run(async () => {
      const added = await api.addAtDoor({ name: ui.name.trim(), party_size: ui.people, time: ui.time, phone: ui.phone.trim() || undefined }, newKey());
      toast({ title: "Na espera", message: `${ui.name.trim()} · ${people(ui.people)} · ${added.time} · ${added.waitlist_position}º da fila` });
    });

  // ---- a gaveta --------------------------------------------------------------------------

  const open = guardWrite(openDrawer);

  function openDrawer(view, e = null) {
    const slots = floor?.day?.slots || [];
    const next = slots.find((s) => s >= houseTime(now().toISOString())) || slots.at(-1) || "";
    ui = { ...blank(), view, id: e?.id ?? null, people: e?.party_size || 2, time: next };
    draw();
    drawer = openDialog($(".espera__gaveta", container), {
      isDirty: () => ui.view === "door" && Boolean(ui.name.trim() || ui.phone.trim()),
      onClose: () => {
        drawer = null;
        ui = blank();
        draw();
      },
    });
    requestAnimationFrame(() => $(".espera__gaveta .gaveta__foco", container)?.focus());
  }

  const busy = () => (ui.busy ? "true" : "false");
  const free = () => (read ? freeTables(read) : []);

  function drawerBody() {
    if (!ui.view) return nothing;
    const e = entry();
    const titles = { offer: "Oferecer mesa", confirm: "Virar reserva", seat: "Sentar agora", remove: "Tirar da fila", door: "Pôr na espera quem chegou" };
    return html`<div class="dialog__bar">
        <b class="dialog__title" id="espera-gaveta-titulo">${titles[ui.view]}</b>
        <button class="dialog__close" type="button" data-close aria-label="Fechar">×</button>
      </div>
      <div class="dialog__body stack gaveta">${ui.view === "door" ? doorForm() : e ? lineAction(e) : html`<p>Essa pessoa já saiu da fila.</p>`}</div>`;
  }

  function lineAction(e) {
    const head = html`<p class="gaveta__foco" tabindex="-1"><b>${e.customer?.name || firstName(e)}</b> · ${people(e.party_size)} · ${e.time}</p>`;
    const pick = (codes) => ((ui.picked = codes), draw());
    const fits = free().filter((t) => t.max_seats >= e.party_size);
    const options = fits.length ? fits : free();
    switch (ui.view) {
      case "offer":
        return html`${head}
          <p>A pessoa recebe a oferta no WhatsApp e tem 10 minutos para aceitar. A mesa fica guardada até lá.</p>
          ${tablePicker({ label: "Qual mesa?", tables: options, picked: ui.picked, onPick: pick })}
          <div class="gaveta__acoes">
            <button class="btn" type="button" ?disabled=${!ui.picked.length} aria-busy=${busy()} @click=${() => offer(e, ui.picked)}>Mandar oferta</button>
          </div>`;
      case "confirm":
        return html`${head}
          <p>Vira reserva confirmada para as ${e.time} e sai da fila.</p>
          ${tablePicker({ label: "Mesa da reserva", tables: options, picked: ui.picked, onPick: pick })}
          <div class="gaveta__acoes">
            <button class="btn" type="button" ?disabled=${!ui.picked.length} aria-busy=${busy()} @click=${() => confirm(e, ui.picked)}>Virar reserva</button>
          </div>`;
      case "seat": {
        const seats = seatsOf(free(), ui.picked);
        return html`${head}
          ${stepper({ id: "espera-pessoas", label: "Quantas pessoas entraram?", value: ui.people, max: 30, onChange: (n) => ((ui.people = n), draw()) })}
          ${tablePicker({ label: "Mesa livre", tables: free(), picked: ui.picked, onPick: pick })}
          ${maybe(ui.picked.length && ui.people > seats, html`<p class="notice" role="status">${people(ui.people)} para ${seats} lugares. Junte outra mesa ou sente assim mesmo.</p>`)}
          <div class="gaveta__acoes">
            <button class="btn" type="button" ?disabled=${!ui.picked.length} aria-busy=${busy()} @click=${() => seat(e, ui.picked, ui.people)}>Sentar</button>
          </div>`;
      }
      default:
        return html`${head}
          <fieldset class="espera__motivos">
            <legend>Por que sai da fila?</legend>
            ${REASONS.map(
              (reason, i) => html`<label class="check">
                <input type="radio" name="motivo" value=${reason} .checked=${ui.reason === reason} @change=${() => ((ui.reason = reason), draw())} id=${`motivo-${i}`} />
                <span>${reason}</span>
              </label>`,
            )}
          </fieldset>
          <div class="gaveta__acoes">
            <button class="btn btn--danger" type="button" aria-busy=${busy()} @click=${() => remove(e)}>Tirar da fila</button>
          </div>`;
    }
  }

  function field(name, label, input, help = "") {
    const error = ui.errors[name];
    return html`<div class="field ${error ? "field--invalid" : ""}">
      <label class="field__label" for=${`porta-${name}`}>${label}</label>
      ${input}
      ${help ? html`<p class="field__help" id=${`porta-${name}-ajuda`}>${help}</p>` : nothing}
      ${error ? html`<p class="field__error" id=${`porta-${name}-erro`}>${error}</p>` : nothing}
    </div>`;
  }

  function doorForm() {
    const slots = floor?.day?.slots || [];
    const described = (name, help) => [help ? `porta-${name}-ajuda` : "", ui.errors[name] ? `porta-${name}-erro` : ""].filter(Boolean).join(" ") || nothing;
    const submit = (event) => {
      event.preventDefault();
      if (!ui.name.trim()) {
        ui.errors = { name: "Escreva o nome de quem espera." };
        draw();
        $("#porta-name", container)?.focus();
        return;
      }
      addAtDoor();
    };
    return html`<p class="gaveta__foco" tabindex="-1">Para quem chegou sem reserva e não tem mesa agora. Sem telefone, não sai mensagem: chame na porta.</p>
      <form class="stack" novalidate @submit=${submit}>
        ${field(
          "name",
          "Nome",
          html`<input class="field__input" id="porta-name" name="name" autocomplete="off" maxlength="60" required aria-invalid=${ui.errors.name ? "true" : "false"} aria-describedby=${described("name")} .value=${ui.name} @input=${(e) => (ui.name = e.target.value)} />`,
        )}
        ${stepper({ id: "porta-pessoas", label: "Quantas pessoas?", value: ui.people, max: 20, onChange: (n) => ((ui.people = n), draw()) })}
        ${field(
          "time",
          "Horário",
          html`<select class="field__input" id="porta-time" name="time" aria-invalid=${ui.errors.time ? "true" : "false"} aria-describedby=${described("time")} .value=${ui.time} @change=${(e) => (ui.time = e.target.value)}>
            ${slots.map((s) => html`<option value=${s} ?selected=${s === ui.time}>${s} · ${(entries || []).filter((x) => x.time === s).length} na espera</option>`)}
          </select>`,
        )}
        ${field(
          "phone",
          "WhatsApp (se quiser)",
          html`<input class="field__input" id="porta-phone" name="phone" type="tel" inputmode="tel" autocomplete="off" aria-describedby=${described("phone", true)} .value=${ui.phone} @input=${(e) => (ui.phone = e.target.value)} />`,
          "Com o número, dá para avisar quando a mesa vagar.",
        )}
        <div class="gaveta__acoes"><button class="btn" type="submit" aria-busy=${busy()}>Pôr na espera</button></div>
      </form>`;
  }

  // ---- a fila ----------------------------------------------------------------------------

  function waited(e) {
    const minutes = Math.max(0, -minutesUntil(e.created_at, now()));
    return minutes < 60 ? `espera há ${minutes} min` : `espera há ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  }

  function line(e) {
    const offered = e.status === "offered";
    const left = offered ? minutesUntil(e.offer_expires_at, now()) : null;
    const noWhatsapp = !e.phone_verified;
    // um grupo da porta sem telefone é chamado na porta; uma entrada do site ainda tenta, e a API diz needs_whatsapp
    const noPhone = e.source === "walk_in" && noWhatsapp;
    const notDelivered = offered && e.offer_message_status === "failed";
    return html`<li class="espera__linha ${offered ? "is-oferta" : ""}">
      <span class="espera__posicao" aria-label=${`${e.waitlist_position}º da fila`}>${e.waitlist_position}º</span>
      <div class="espera__quem">
        <p><b>${e.customer?.name || firstName(e)}</b> · ${people(e.party_size)} · <span class="espera__tempo">${waited(e)}</span></p>
        <p class="cluster espera__marcas">
          ${maybe(e.source === "walk_in", html`<span class="badge">na porta</span>`)}
          ${maybe(offered, html`<span class="badge badge--offered">oferecida · ${e.table_codes.join("+")} até ${offered ? houseTime(e.offer_expires_at) : ""}</span>`)}
          ${maybe(offered && left >= 0, html`<span class="espera__conta">faltam ${left + 1} min</span>`)}
          ${maybe(notDelivered, html`<span class="badge badge--no-reply">oferta não entregue</span>`)}
          ${maybe(e.last_notified, html`<span class="badge badge--said-yes">avisado às ${e.last_notified ? houseTime(e.last_notified.at) : ""}</span>`)}
          ${maybe(e.last_offer_expired_at, html`<span class="badge badge--expired">oferta venceu às ${e.last_offer_expired_at ? houseTime(e.last_offer_expired_at) : ""}</span>`)}
          ${maybe(noWhatsapp, html`<span class="badge badge--no-reply">${noPhone ? "sem telefone" : "sem WhatsApp confirmado"}</span>`)}
        </p>
        ${maybe(notDelivered, html`<p class="espera__dica">O WhatsApp não entregou a oferta. Chame na porta ou ofereça a mesa a outra pessoa.</p>`)}
      </div>
      <div class="espera__acoes">
        ${maybe(e.source === "walk_in" && e.has_phone, html`<button class="btn btn--sm btn--outline" type="button" ?disabled=${floor?.whatsapp === "down"} @click=${() => tellReady(e)}>Avisar que a mesa está pronta</button>`)}
        ${maybe(!offered && !noPhone, html`<button class="btn btn--sm" type="button" aria-haspopup="dialog" @click=${() => open("offer", e)}>Oferecer mesa</button>`)}
        <button class="btn btn--sm ${offered || noPhone ? "" : "btn--outline"}" type="button" aria-haspopup="dialog" @click=${() => open("seat", e)}>Sentar agora</button>
        ${maybe(e.source !== "walk_in", html`<button class="btn btn--sm btn--outline" type="button" aria-haspopup="dialog" @click=${() => open("confirm", e)}>Virar reserva</button>`)}
        <button class="btn btn--sm btn--outline" type="button" aria-haspopup="dialog" @click=${() => open("remove", e)}>Tirar da fila</button>
      </div>
    </li>`;
  }

  function offlineScreen() {
    if (!pictureRead) return loadingBlock();
    if (!picture) return noPicture(mode);
    const waiting = (picture.floor.reservations || []).filter((r) => ["waitlisted", "offered"].includes(r.status)).sort((a, b) => a.time.localeCompare(b.time) || a.created_at.localeCompare(b.created_at));
    return html`<div class="espera">
      ${offlineBand(mode, picture)}
      ${waiting.length
        ? html`<ol class="espera__fila">
            ${waiting.map(
              (e) => html`<li class="espera__linha">
                <span class="espera__posicao">${e.time}</span>
                <div class="espera__quem"><p><b>${firstName(e)}</b> · ${people(e.party_size)}${e.source === "walk_in" ? " · na porta" : ""}</p></div>
                <div class="espera__acoes"><button class="btn btn--sm btn--outline" type="button" @click=${guardWrite(() => {})}>Sentar agora</button></div>
              </li>`,
            )}
          </ol>`
        : html`<p>Ninguém na espera no retrato da noite.</p>`}
    </div>`;
  }

  function screen() {
    if (mode !== "online") return offlineScreen();
    if (loadError) return errorBlock(loadError, () => ((loadError = null), draw(), load()));
    if (!entries) return loadingBlock();
    const addButton = html`<button class="btn" type="button" aria-haspopup="dialog" @click=${() => open("door")}>Pôr na espera quem chegou</button>`;
    const dialog = html`<dialog class="dialog dialog--drawer espera__gaveta" aria-labelledby="espera-gaveta-titulo">${drawerBody()}</dialog>`;
    if (!entries.length) {
      return html`<div class="area__vazio">
          <span class="raiz" aria-hidden="true"></span>
          <p><b>Ninguém esperando agora.</b> Quando alguém chegar sem mesa, ponha na espera para não perder a vez.</p>
          ${maybe(floor?.day?.slots?.length, addButton)}
        </div>
        ${dialog}`;
    }
    const slots = [...new Set(entries.map((e) => e.time))].sort();
    const freeNow = free();
    return html`<div class="espera">
      ${backlogBand(draw)}
      ${maybe(lost, html`<p class="notice" role="status" data-estado="realtime_lost">${realtimeLostNotice}</p>`)}
      <p class="sr-only" aria-live="polite">${announce}</p>
      ${maybe(floor?.whatsapp === "down", html`<p class="notice notice--alert" role="status">O WhatsApp da casa está fora: ofertas e avisos não saem. Chame as pessoas na porta.</p>`)}
      <div class="salao__topo">
        <p>
          <b>${entries.length}</b> ${entries.length === 1 ? "grupo" : "grupos"} na espera ·
          ${freeNow.length ? html`mesas livres agora: <b>${freeNow.map((t) => t.code).join(", ")}</b>` : "nenhuma mesa livre agora"}
        </p>
        ${addButton}
      </div>
      ${slots.map((slot) => {
        const here = entries.filter((e) => e.time === slot);
        return html`<section class="espera__horario" aria-labelledby=${`espera-${slot}`}>
          <h2 class="espera__hora" id=${`espera-${slot}`}>${slot} <small>${here.length} ${here.length === 1 ? "grupo" : "grupos"} · ${people(here.reduce((n, e) => n + e.party_size, 0))}</small></h2>
          <ol class="espera__fila">${here.map(line)}</ol>
        </section>`;
      })}
      ${dialog}
    </div>`;
  }

  const live = startLive({
    skip: ["alerts"],
    refresh: () => (entries || mode !== "online" ? load({ quiet: true }) : undefined),
    onState: ({ lost: down }) => {
      lost = down;
      draw();
    },
  });
  const stopConnection = onConnection((next) => {
    mode = next;
    if (next === "online") load({ quiet: Boolean(entries) });
    else showPicture();
  });
  const tick = setInterval(draw, TICK_MS);
  draw();
  await load();

  return () => {
    alive = false;
    live.stop();
    stopConnection();
    clearInterval(tick);
    drawer?.close();
  };
}
