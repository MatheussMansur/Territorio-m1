// "Lançar do papel" (história 6.13): depois de uma queda, o que foi anotado na folha de papel entra com
// a hora real em que aconteceu (occurred_at, até 6 h para trás, mesma noite, nunca mais de 2 min
// à frente): quem chegou, quais mesas foram liberadas e quem sentou sem reserva. Uma hora que
// não encaixa recebe "Confira a hora anotada"; uma mesa que o site vendeu durante a queda mostra as duas
// reservas lado a lado e oferece outra mesa; depois que a noite fechou, as anotações vão para
// o dono e o gerente como correções no Hoje deles.
import { toast } from "../../../components/toast.js";
import { addDays, houseTime } from "../../../lib/dates.js";
import { html, nothing, render } from "../../../lib/html.js";
import * as api from "../../../services/api/staff-salao.js";
import { firstName, freeTables, people, readFloor } from "./model.js";
import { clearBacklog, guardWrite } from "./retrato.js";
import { errorBlock, loadingBlock, newKey, problemText, stepper, tablePicker } from "./ui.js";
import { withCorrection } from "./correcao.js";
import { correctsClosedNight } from "../reservas/labels.js";

/** "21:40" da noite de `date` como um instante (depois da meia-noite pertence à mesma noite). */
function instantOf(date, time) {
  if (!/^\d{2}:\d{2}$/.test(time || "")) return null;
  const day = Number(time.slice(0, 2)) < 6 ? addDays(date, 1) : date;
  return new Date(`${day}T${time}:00-03:00`).toISOString();
}

export async function mountPaper(container, { user }) {
  // quem corrige uma noite fechada vem do arquivo de permissões (história 1.3)
  const fixesClosed = correctsClosedNight(user);
  let floor = null;
  let read = null;
  let failure = null;
  let alive = true;
  const notes = {}; // por linha: { time, people, error, conflict, picked }
  const walk = { time: "", people: 2, picked: [], error: null };
  const pendingCorrections = []; // anotações que deram night_closed
  let sentCorrections = false;

  const draw = () => alive && render(screen(), container);
  const note = (id, extra = {}) => (notes[id] ??= { time: "", people: null, error: null, conflict: null, picked: [], ...extra });

  async function load() {
    try {
      floor = await api.floor();
      read = floor.day?.layout ? readFloor(floor, new Date(floor.server_time)) : null;
      failure = null;
    } catch (error) {
      failure = error;
    }
    draw();
  }

  /** O que um lançamento que falhou diz: a hora, a mesa ocupada, ou a noite já fechada. */
  function failed(error, n, correction) {
    if (error?.type === "validation") n.error = error.errors?.[0]?.message || "Confira a hora anotada.";
    else if (error?.body?.reason === "table_taken" || error?.body?.code === "table_taken") n.conflict = true;
    else if (error?.type === "night_closed") {
      n.error = "A noite já fechou: só o dono ou o gerente corrigem.";
      if (!pendingCorrections.some((c) => c.key === correction.key)) pendingCorrections.push(correction);
    } else n.error = problemText(error).message || problemText(error).title;
  }

  const launchArrival = guardWrite(async (r, tables = null) => {
    const n = note(r.id);
    n.error = null;
    const at = instantOf(floor.date, n.time);
    if (!at) {
      n.error = "Escreva a hora anotada, como 21:40.";
      return draw();
    }
    try {
      const codes = tables || (r.table_codes?.length ? r.table_codes : r.lost_table_codes || []);
      await withCorrection((extra) => api.reservationAction(r.id, { action: "check_in", people: n.people ?? r.party_size, table_codes: codes, occurred_at: at, from_paper: true, ...extra }, newKey()));
      n.done = `Chegada às ${n.time} lançada.`;
      n.conflict = null;
      toast({ title: "Lançado do papel", message: `${firstName(r)} chegou às ${n.time}.` });
    } catch (error) {
      failed(error, n, { key: r.id, kind: "check_in", reservation_id: r.id, occurred_at: at, people: n.people ?? r.party_size, label: `${firstName(r)} chegou (${people(n.people ?? r.party_size)})` });
    }
    draw();
  });

  const launchRelease = guardWrite(async (s) => {
    const n = note(s.id);
    n.error = null;
    const at = instantOf(floor.date, n.time);
    if (!at) {
      n.error = "Escreva a hora anotada, como 22:15.";
      return draw();
    }
    try {
      await withCorrection((extra) => api.release(s.id, newKey(), { occurred_at: at, from_paper: true, ...extra }));
      n.done = `Mesa liberada às ${n.time}.`;
      toast({ title: "Lançado do papel", message: `Mesa ${s.table_codes.join("+")} liberada às ${n.time}.` });
    } catch (error) {
      failed(error, n, { key: s.id, kind: "release", table_codes: s.table_codes, occurred_at: at, label: `Mesa ${s.table_codes.join("+")} liberada` });
    }
    draw();
  });

  const launchWalkIn = guardWrite(async () => {
    walk.error = null;
    const at = instantOf(floor.date, walk.time);
    if (!at || !walk.picked.length) {
      walk.error = !at ? "Escreva a hora anotada, como 20:50." : "Escolha a mesa em que sentaram.";
      return draw();
    }
    try {
      await withCorrection((extra) => api.walkIn({ table_codes: walk.picked, party_size: walk.people, occurred_at: at, from_paper: true, ...extra }, newKey()));
      toast({ title: "Lançado do papel", message: `${people(walk.people)} sem reserva na ${walk.picked.join("+")} às ${walk.time}.` });
      Object.assign(walk, { time: "", people: 2, picked: [], error: null });
      await load();
      return;
    } catch (error) {
      failed(error, walk, { key: `walk-${walk.time}`, kind: "walk_in", table_codes: walk.picked, people: walk.people, occurred_at: at, label: `${people(walk.people)} sem reserva na ${walk.picked.join("+")}` });
    }
    draw();
  });

  const sendToOwner = guardWrite(async () => {
    try {
      await api.sendCorrections(pendingCorrections.map(({ key: _key, ...item }) => ({ ...item, date: floor.date })));
      sentCorrections = true;
      pendingCorrections.length = 0;
      clearBacklog();
      toast({ title: "Mandado para corrigir", message: "O dono e o gerente veem as anotações no Hoje, com a hora anotada." });
    } catch (error) {
      toast({ kind: "error", ...problemText(error) });
    }
    draw();
  });

  const timeField = (id, n, label) => html`<div class=${`field papel__hora ${n.error ? "field--invalid" : ""}`}>
    <label class="field__label" for=${`hora-${id}`}>${label}</label>
    <input class="field__input" id=${`hora-${id}`} type="time" .value=${n.time} aria-invalid=${n.error ? "true" : "false"} aria-describedby=${n.error ? `hora-${id}-erro` : nothing}
      @input=${(e) => ((n.time = e.target.value), (n.error = null))} />
    ${n.error ? html`<p class="field__error" id=${`hora-${id}-erro`}>${n.error}</p>` : nothing}
  </div>`;

  function conflictView(r, n) {
    const codes = r.table_codes?.length ? r.table_codes : r.lost_table_codes || [];
    const holder = read && codes.map((c) => read.tables.get(c)).find((t) => t?.session);
    return html`<div class="notice notice--alert papel__conflito" role="alert">
      <p><b>Essa mesa foi ocupada durante a queda.</b></p>
      <div class="papel__lado-a-lado">
        <div><small>Do papel</small><p><b>${firstName(r)}</b> · ${people(r.party_size)} · ${r.time} · mesa ${codes.join("+")}</p></div>
        <div><small>No sistema</small><p><b>${holder ? firstName(holder.reservation) : "Outra reserva"}</b>${holder ? ` · sentou às ${houseTime(holder.session.seated_at)}` : ""}</p></div>
      </div>
      ${tablePicker({ label: "Outra mesa para a chegada", tables: read ? freeTables(read) : [], picked: n.picked, single: true, onPick: (codes2) => ((n.picked = codes2), draw()) })}
      <button class="btn btn--sm" type="button" ?disabled=${!n.picked.length} @click=${() => launchArrival(r, n.picked)}>Lançar na ${n.picked[0] || "mesa escolhida"}</button>
    </div>`;
  }

  function screen() {
    if (failure) return errorBlock(failure, () => ((failure = null), draw(), load()));
    if (!floor) return loadingBlock();
    const notArrived = (floor.reservations || []).filter((r) => ["confirmed", "no_show"].includes(r.status) && r.source !== "walk_in").sort((a, b) => a.time.localeCompare(b.time));
    const open = (floor.sessions || []).filter((s) => s.status === "open");
    const closed = floor.night?.closed;
    return html`<div class="papel stack">
      <div class="salao-folha__acoes"><a class="btn btn--outline btn--sm" href="/admin/salao">Voltar ao salão</a></div>
      <p class="papel__intro">Lance cada coisa com a hora que está no papel. A hora vale para a noite de hoje, até 6 horas antes de agora.</p>
      ${closed && !fixesClosed ? html`<p class="notice notice--alert" role="status"><b>A noite já fechou.</b> O que você lançar aqui vai para o dono ou o gerente corrigir.</p>` : nothing}
      ${pendingCorrections.length
        ? html`<div class="notice notice--alert retrato-faixa" role="status">
            <p><b>${pendingCorrections.length} ${pendingCorrections.length === 1 ? "anotação esbarrou" : "anotações esbarraram"} na noite fechada.</b> O dono ou o gerente corrigem, com a hora anotada.</p>
            <button class="btn btn--sm" type="button" @click=${sendToOwner}>Mandar para o dono ou o gerente corrigir</button>
          </div>`
        : nothing}
      ${sentCorrections ? html`<p class="notice" role="status">Anotações mandadas. Elas aparecem no Hoje do dono e do gerente.</p>` : nothing}

      <section class="papel__bloco" aria-labelledby="papel-chegadas">
        <h2 class="papel__titulo" id="papel-chegadas">Quem chegou</h2>
        ${notArrived.length
          ? html`<ul class="papel__lista">
              ${notArrived.map((r) => {
                const n = note(r.id);
                return html`<li class="papel__linha">
                  <p><b>${firstName(r)}</b> · ${people(r.party_size)} · ${r.time} · ${(r.table_codes?.length ? r.table_codes : r.lost_table_codes || []).join("+") || "sem mesa"}${r.status === "no_show" ? " · marcada como não veio" : ""}</p>
                  ${n.done
                    ? html`<p class="badge badge--confirmed">${n.done}</p>`
                    : html`<div class="papel__campos">
                        ${timeField(r.id, n, "Chegou às")}
                        ${stepper({ id: `papel-pessoas-${r.id}`, label: "Pessoas", value: n.people ?? r.party_size, max: 40, onChange: (v) => ((n.people = v), draw()) })}
                        <button class="btn btn--sm" type="button" @click=${() => launchArrival(r)}>Lançar chegada</button>
                      </div>
                      ${n.conflict ? conflictView(r, n) : nothing}`}
                </li>`;
              })}
            </ul>`
          : html`<p class="papel__vazio">Todas as reservas da noite já têm chegada.</p>`}
      </section>

      <section class="papel__bloco" aria-labelledby="papel-liberadas">
        <h2 class="papel__titulo" id="papel-liberadas">Mesas que vagaram</h2>
        ${open.length
          ? html`<ul class="papel__lista">
              ${open.map((s) => {
                const n = note(s.id);
                return html`<li class="papel__linha">
                  <p><b>Mesa ${s.table_codes.join("+") || "do balcão"}</b> · ${people(s.people)} · sentou às ${houseTime(s.seated_at)}</p>
                  ${n.done
                    ? html`<p class="badge badge--confirmed">${n.done}</p>`
                    : html`<div class="papel__campos">${timeField(s.id, n, "Liberou às")}<button class="btn btn--sm" type="button" @click=${() => launchRelease(s)}>Lançar liberação</button></div>`}
                </li>`;
              })}
            </ul>`
          : html`<p class="papel__vazio">Nenhuma mesa aberta agora.</p>`}
      </section>

      <section class="papel__bloco" aria-labelledby="papel-sem-reserva">
        <h2 class="papel__titulo" id="papel-sem-reserva">Quem sentou sem reserva</h2>
        <div class="papel__campos">
          ${timeField("walk", walk, "Sentou às")}
          ${stepper({ id: "papel-walk-pessoas", label: "Pessoas", value: walk.people, max: 20, onChange: (v) => ((walk.people = v), draw()) })}
        </div>
        ${tablePicker({ label: "Em qual mesa", tables: read ? freeTables(read) : [], picked: walk.picked, onPick: (codes) => ((walk.picked = codes), draw()) })}
        <button class="btn btn--sm" type="button" @click=${launchWalkIn}>Lançar mesa sem reserva</button>
      </section>

      <div class="cluster">
        <button class="btn btn--outline" type="button" @click=${() => (clearBacklog(), toast({ title: "Pronto", message: "O aviso do papel saiu." }))}>Terminei de lançar</button>
      </div>
    </div>`;
  }

  draw();
  await load();
  return () => {
    alive = false;
  };
}
