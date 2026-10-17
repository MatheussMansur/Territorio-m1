// A porta do evento (história 6.8), feita para o celular na porta: a lista com primeiro nome,
// pessoas, hora de chegada e quem já entrou, a busca por nome, os números esperados e
// chegados no topo. "Chegou" marca a chegada com a hora real e quantos entraram, com
// "Desfazer"; quem não está na lista entra com "Pôr para dentro" enquanto houver espaço.
// Dono e gerente imprimem a lista da porta (primeiro nome, pessoas e chegada, nunca o telefone); o
// CSV é do dono, depois da confirmação de identidade. /admin/salao/porta?evento=<id>; sem ele,
// o evento do salão desta noite.
import { toast } from "../../../components/toast.js";
import { houseTime } from "../../../lib/dates.js";
import { html, nothing, render } from "../../../lib/html.js";
import * as eventos from "../../../services/api/staff-eventos.js";
import { exportGuests } from "../../../services/api/staff-reservas.js";
import { floor as readFloor } from "../../../services/api/staff-salao.js";
import { withIdentity } from "../../identity.js";
import { canDo, canDoOption } from "../../nav.js";
import { saveFile } from "../clientes/comum.js";
import { guardWrite } from "./retrato.js";
import { errorBlock, loadingBlock, maybe, problemText, stepper, toastError } from "./ui.js";

const fold = (s) => String(s || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const first = (r) => String(r.customer?.name || r.walk_in_name || "Sem nome").split(" ")[0];
const people = (n) => `${n} ${n === 1 ? "pessoa" : "pessoas"}`;

export async function mountDoor(container, { user }) {
  // quem abre Eventos, imprime a lista da porta e exporta: o arquivo de permissões (história 1.3)
  const areas = user.areas ?? undefined;
  const opensEvents = canDo(user.role, "GET /staff/events", areas);
  const prints = canDoOption(user.role, "GET /staff/events/{id}/guests", "print", areas);
  const exports = canDo(user.role, "POST /staff/events/{id}/guests/export", areas);
  let eventId = new URLSearchParams(window.location.search).get("evento");
  let data = null;
  let failure = null;
  let query = "";
  let entering = null; // o convidado cujo "Chegou" pergunta quantos entraram
  let count = 1;
  let door = { open: false, name: "", people: 2, error: null };
  let busy = false;
  let alive = true;

  const draw = () => alive && render(screen(), container);

  async function load() {
    try {
      if (!eventId) eventId = (await readFloor())?.day?.event?.id || null;
      data = eventId ? await eventos.guests(eventId) : { none: true };
      failure = null;
    } catch (error) {
      failure = error;
    }
    draw();
  }

  const arrive = guardWrite(async (r, howMany) => {
    busy = true;
    draw();
    try {
      await eventos.checkIn(eventId, r.id, { people: howMany, occurred_at: new Date().toISOString() });
      toast({ title: "Chegou", message: `${first(r)} · ${people(howMany)}`, action: { label: "Desfazer", onClick: () => undo(r) } });
      entering = null;
    } catch (error) {
      toastError(error);
    }
    busy = false;
    await load();
  });

  const undo = guardWrite(async (r) => {
    try {
      await eventos.undoCheckIn(eventId, r.id);
      toast({ title: "Chegada desfeita", message: `${first(r)} voltou para a lista.` });
    } catch (error) {
      toastError(error);
    }
    await load();
  });

  const letIn = guardWrite(async (event) => {
    event.preventDefault();
    if (!door.name.trim()) {
      door.error = "Escreva o nome de quem entra.";
      draw();
      container.querySelector("#porta-nome")?.focus();
      return;
    }
    busy = true;
    draw();
    try {
      await eventos.addGuest(eventId, { name: door.name.trim(), party_size: door.people, at_door: true });
      toast({ title: "Para dentro", message: `${door.name.trim().split(" ")[0]} · ${people(door.people)}` });
      door = { open: false, name: "", people: 2, error: null };
      query = "";
    } catch (error) {
      if (error?.body?.code === "event_list_full") {
        const { title, message } = problemText(error);
        door.error = `${title}. ${message}`;
      }
      else toastError(error);
    }
    busy = false;
    await load();
  });

  async function exportCsv() {
    try {
      const file = await withIdentity(() => exportGuests(eventId), { title: "Exportar a lista da porta", message: "A lista sai sem telefone. Exportar pede a senha e o código de novo, e fica no registro de ações." });
      if (!file) return;
      saveFile(file.text, file.filename, "text/csv;charset=utf-8");
      toast({ title: "Arquivo baixado", message: file.filename });
    } catch (error) {
      const { title, message } = problemText(error);
      toast({ kind: "error", title, message, action: error?.type === "network" ? { label: "Tentar de novo", onClick: exportCsv } : undefined });
    }
  }

  function doorForm() {
    return html`<form class="porta__entrar stack" novalidate @submit=${letIn}>
      <h2 class="porta__titulo">Pôr para dentro</h2>
      <div class=${`field ${door.error ? "field--invalid" : ""}`}>
        <label class="field__label" for="porta-nome">Nome</label>
        <input class="field__input" id="porta-nome" autocomplete="off" maxlength="60" .value=${door.name} aria-invalid=${door.error ? "true" : "false"}
          aria-describedby=${door.error ? "porta-nome-erro" : nothing} @input=${(e) => ((door.name = e.target.value), (door.error = null))} />
        ${door.error ? html`<p class="field__error" id="porta-nome-erro">${door.error}</p>` : nothing}
      </div>
      ${stepper({ id: "porta-quantos", label: "Quantas pessoas?", value: door.people, max: 30, onChange: (n) => ((door.people = n), draw()) })}
      <div class="cluster">
        <button class="btn" type="submit" aria-busy=${String(busy)}>Pôr para dentro</button>
        <button class="btn btn--outline" type="button" @click=${() => ((door.open = false), draw())}>Voltar</button>
      </div>
    </form>`;
  }

  function guest(r) {
    const inside = r.status === "completed" || r.arrived_at;
    if (entering === r.id) {
      return html`<li class="porta__linha is-chegando">
        <p><b>${first(r)}</b> · ${people(r.party_size)} na lista</p>
        ${stepper({ id: `porta-${r.id}`, label: "Quantos entraram?", value: count, max: r.party_size, onChange: (n) => ((count = n), draw()) })}
        <div class="cluster">
          <button class="btn btn--sm" type="button" aria-busy=${String(busy)} @click=${() => arrive(r, count)}>Confirmar chegada</button>
          <button class="btn btn--sm btn--outline" type="button" @click=${() => ((entering = null), draw())}>Voltar</button>
        </div>
      </li>`;
    }
    return html`<li class=${`porta__linha${inside ? " is-dentro" : ""}`}>
      <span class="porta__quem"><b>${first(r)}</b> · ${people(r.party_size)} · ${r.time}</span>
      ${inside
        ? html`<span class="badge badge--confirmed">chegou${r.arrived_at ? ` às ${houseTime(r.arrived_at)}` : ""}${r.arrived_people && r.arrived_people !== r.party_size ? ` · ${r.arrived_people} entraram` : ""}</span>
            <button class="action" type="button" @click=${() => undo(r)} aria-label=${`Desfazer a chegada de ${first(r)}`}>Desfazer</button>`
        : html`<button class="btn btn--sm" type="button" @click=${() => ((entering = r.id), (count = r.party_size), draw())}>Chegou</button>`}
    </li>`;
  }

  function printable(list) {
    return html`<article class="folha porta__folha" aria-labelledby="porta-folha-titulo">
      <header class="folha__cabeca"><h2 id="porta-folha-titulo">Lista da porta · ${data.event.title}</h2><p>Impressa às ${houseTime(new Date().toISOString())}</p></header>
      <table class="data-table folha__tabela">
        <caption class="sr-only">Lista da porta</caption>
        <thead><tr><th scope="col">Nome</th><th scope="col" class="num">Pessoas</th><th scope="col">Horário</th><th scope="col">Chegada</th></tr></thead>
        <tbody>${list.map((r) => html`<tr><td>${first(r)}</td><td class="num">${r.party_size}</td><td class="time">${r.time}</td><td>${r.arrived_at ? houseTime(r.arrived_at) : ""}</td></tr>`)}</tbody>
      </table>
    </article>`;
  }

  function screen() {
    if (failure) return errorBlock(failure, () => ((failure = null), draw(), load()));
    if (!data) return loadingBlock();
    const back = html`<a class="btn btn--outline btn--sm" href="/admin/salao">Voltar ao salão</a>`;
    if (data.none) {
      return html`<div class="area__vazio"><span class="raiz" aria-hidden="true"></span>
        <p><b>Não há evento com lista nesta noite.</b> A porta do evento aparece nas noites de evento com lista.</p>
        ${opensEvents ? html`<a class="btn" href="/admin/eventos">Abrir os eventos</a>` : back}
      </div>`;
    }
    const all = data.guests || [];
    const found = query ? all.filter((r) => fold(r.customer?.name || r.walk_in_name).includes(fold(query))) : all;
    const room = data.capacity ? Math.max(0, data.capacity - all.reduce((n, r) => n + r.party_size, 0)) : null;
    return html`<div class="porta">
      <div class="salao-folha__acoes porta__acoes">
        ${back}
        ${prints ? html`<button class="btn btn--outline btn--sm" type="button" @click=${() => window.print()}>Imprimir lista da porta</button>` : nothing}
        ${exports ? html`<button class="btn btn--outline btn--sm" type="button" @click=${exportCsv}>Exportar lista (CSV)</button>` : nothing}
      </div>
      <h2 class="porta__titulo">${data.event.title}</h2>
      <div class="stats porta__numeros">
        <div class="stat"><b>${data.expected_people}</b><small>esperados</small></div>
        <div class="stat"><b>${data.arrived_people}</b><small>chegaram</small></div>
        ${data.capacity ? html`<div class="stat stat--kraft"><b>${room}</b><small>lugares na lista</small></div>` : nothing}
      </div>
      ${door.open
        ? doorForm()
        : html`<div class="field porta__busca">
              <label class="field__label" for="porta-busca">Buscar na lista</label>
              <input class="field__input" id="porta-busca" type="search" autocomplete="off" .value=${query} @input=${(e) => ((query = e.target.value), draw())} />
            </div>
            ${found.length
              ? html`<ul class="porta__lista">${found.map(guest)}</ul>`
              : html`<div class="area__vazio"><span class="raiz" aria-hidden="true"></span>
                  <p>${all.length ? "Ninguém na lista com esse nome." : "A lista ainda está vazia."}</p>
                </div>`}
            <button class="btn porta__pra-dentro" type="button" @click=${guardWrite(() => ((door = { ...door, open: true, name: query }), draw(), requestAnimationFrame(() => container.querySelector("#porta-nome")?.focus())))}>Pôr para dentro</button>`}
      ${maybe(prints, printable(all))}
    </div>`;
  }

  draw();
  await load();
  return () => {
    alive = false;
  };
}
