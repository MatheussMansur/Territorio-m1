// A folha da noite (história 6.10): GET /staff/night/snapshot no papel. Hora, primeiro nome, pessoas,
// mesa, marcadores e telefone mascarado, com um quadrado para anotar a chegada, a espera e linhas em branco
// para quem vem sem reserva. O navegador imprime ou salva como PDF (A4, CSS próprio).
// Imprimir avisa a casa (o alerta "Imprima a folha" de Hoje some, e as mudanças passam a
// contar); ?mudancas=1 é a folha curta do que entrou, saiu ou mudou desde então. Sem
// conexão, a folha vem do retrato da noite guardado no aparelho. No fim, a
// planta da noite: cada mesa com o seu código onde o layout a coloca, e os pontos fixos da
// casa (bar, cozinha, entrada…) hachurados, para quem está com o papel achar as mesas.
import { formatDay, houseTime } from "../../../lib/dates.js";
import { html, nothing, render } from "../../../lib/html.js";
import { nightSnapshot, sheetPrinted } from "../../../services/api/staff-salao.js";
import { fixtureRefs, floorMap, placeOn } from "../plantas/pontos.js";
import { firstName, readFloor } from "./model.js";
import { connection, readPicture } from "./retrato.js";
import { errorBlock, loadingBlock } from "./ui.js";

const FLAG_WORD = { birthday: "aniversário", high_chair: "cadeirinha", accessibility: "acessibilidade", dietary: "restrição", no_whatsapp: "sem WhatsApp" };
const BLANK_LINES = 8;
const CHANGE_WORD = { new: "entrou", left: "saiu", changed: "mudou" };
/** A largura máxima da planta de uma área no papel A4, em pixels. */
const PAPER_PX = 680;

export async function mountSheet(container) {
  const onlyChanges = new URLSearchParams(window.location.search).get("mudancas") === "1";
  let snap = null;
  let failure = null;
  let fromPicture = null;
  let printedAt = new Date();
  let alive = true;

  const flags = (r) => (r.flags || []).map((f) => FLAG_WORD[f] || f).join(", ");

  function header(title) {
    return html`<header class="folha__cabeca">
      <h2 id="folha-titulo">${title} · ${formatDay(snap.date, "long")}</h2>
      <p>Impressa às ${houseTime(printedAt.toISOString())}${fromPicture ? ` · retrato do aparelho das ${houseTime(fromPicture)}` : ""}
        ${onlyChanges ? "" : ` · ${snap.reservations.length} reservas · ${snap.reservations.reduce((n, r) => n + r.party_size, 0)} pessoas`}</p>
    </header>`;
  }

  function changesSheet() {
    const list = snap.changes || [];
    return html`<article class="folha" aria-labelledby="folha-titulo">
      ${header("Mudanças desde a folha")}
      <p>Desde a folha das ${snap.sheet_printed_at ? houseTime(snap.sheet_printed_at) : "—"}.</p>
      ${list.length
        ? html`<table class="data-table folha__tabela">
            <caption class="sr-only">O que entrou, saiu ou mudou</caption>
            <thead><tr><th scope="col">O quê</th><th scope="col">Hora</th><th scope="col">Nome</th><th scope="col" class="num">Pessoas</th><th scope="col">Mesa</th></tr></thead>
            <tbody>
              ${list.map(
                (c) => html`<tr>
                  <td class="strong">${CHANGE_WORD[c.kind] || c.text}</td>
                  <td class="time">${c.time}</td>
                  <td>${c.name}</td>
                  <td class="num">${c.party_size}</td>
                  <td>${c.table_codes.join("+") || "—"}</td>
                </tr>`,
              )}
            </tbody>
          </table>`
        : html`<p>Nada mudou desde a folha.</p>`}
    </article>`;
  }

  /** A planta da noite no papel: mesas pelo código, pontos fixos hachurados com ícone e nome. */
  function plan() {
    if (!snap.day?.layout) return nothing;
    const read = readFloor({ day: snap.day, areas: snap.areas || [], reservations: [], sessions: [], rules: {} }, printedAt);
    const areas = read.areas.filter((a) => a.tables.length || a.fixtures.length);
    if (!areas.length) return nothing;
    return html`<section class="folha__planta" aria-labelledby="folha-planta-titulo">
      <h3 id="folha-planta-titulo">Planta da noite</h3>
      <p class="folha__legenda">Mesas pelo código. Os pontos fixos (hachurados) servem de referência e não recebem ninguém.</p>
      ${areas.map((a) => {
        const cell = Math.min(10, PAPER_PX / Math.max(1, a.cols));
        return html`<div class="folha__area">
          <h4>${a.name}${a.mode === "list" ? ` · lista de ${a.capacity} pessoas` : ""}</h4>
          ${a.mode === "list"
            ? fixtureRefs(a)
            : floorMap(a, (t) => html`<div class="folha-mesa ${t.shape === "round" || t.shape === "stool" ? "folha-mesa--redonda" : ""}" style=${placeOn(t, cell, true)}><b>${t.code}</b></div>`, { cell, extra: 0, label: `Planta de ${a.name} na folha` })}
        </div>`;
      })}
    </section>`;
  }

  function sheet() {
    const status = (r) => (r.status === "completed" ? "chegou" : r.status === "no_show" ? "não veio" : r.status === "pending" ? "pendente" : "");
    return html`<article class="folha" aria-labelledby="folha-titulo">
      ${header("Folha da noite")}
      ${snap.reservations.length
        ? html`<div class="table-wrap" tabindex="0" role="region" aria-label="Reservas da noite">
            <table class="data-table folha__tabela">
              <caption class="sr-only">Reservas da noite</caption>
              <thead>
                <tr><th scope="col">Hora</th><th scope="col">Nome</th><th scope="col" class="num">Pessoas</th><th scope="col">Mesa</th><th scope="col">Marcadores</th><th scope="col">Telefone</th><th scope="col">Chegada</th></tr>
              </thead>
              <tbody>
                ${snap.reservations.map(
                  (r) => html`<tr>
                    <td class="time">${r.time}</td>
                    <td class="strong">${firstName(r)}</td>
                    <td class="num">${r.party_size}</td>
                    <td>${r.table_codes.join("+") || "—"}</td>
                    <td>${flags(r)}</td>
                    <td>${r.customer?.phone_masked || ""}</td>
                    <td class="folha__chegada">${status(r)}</td>
                  </tr>`,
                )}
              </tbody>
            </table>
          </div>`
        : html`<p>Nenhuma reserva para esta noite.</p>`}
      ${snap.waitlist.length
        ? html`<h3>Espera</h3>
            <ul class="folha__espera">
              ${snap.waitlist.map((r) => html`<li>${r.time} · ${firstName(r)} · ${r.party_size} ${r.source === "walk_in" ? "· na porta" : ""}</li>`)}
            </ul>`
        : ""}
      <h3>Sem reserva</h3>
      <table class="data-table folha__branco">
        <caption class="sr-only">Linhas em branco para quem chegar sem reserva</caption>
        <thead>
          <tr><th scope="col">Hora</th><th scope="col">Nome</th><th scope="col" class="num">Pessoas</th><th scope="col">Mesa</th><th scope="col">Saída</th></tr>
        </thead>
        <tbody>
          ${Array.from({ length: BLANK_LINES }, () => html`<tr><td></td><td></td><td></td><td></td><td></td></tr>`)}
        </tbody>
      </table>
      ${plan()}
      <p class="folha__rodape">Território · restrição alimentar aparece só como marcador; o detalhe fica no painel.</p>
    </article>`;
  }

  async function print() {
    printedAt = new Date();
    draw();
    // a casa fica sabendo que a folha foi para o papel; sem a linha, imprime do mesmo jeito
    if (!fromPicture && connection() === "online") await sheetPrinted(onlyChanges ? "changes" : "full").catch(() => {});
    window.print();
  }

  function screen() {
    if (failure) return errorBlock(failure, () => ((failure = null), draw(), load()));
    if (!snap) return loadingBlock();
    return html`<div class="salao-folha">
      <div class="salao-folha__acoes">
        <a class="btn btn--outline btn--sm" href="/admin/salao">Voltar ao salão</a>
        ${onlyChanges ? html`<a class="btn btn--outline btn--sm" href="/admin/salao/folha">Folha inteira</a>` : nothing}
        <button class="btn btn--sm" type="button" @click=${print}>${onlyChanges ? "Imprimir só as mudanças" : "Imprimir ou salvar PDF"}</button>
      </div>
      ${fromPicture ? html`<p class="notice notice--alert" role="status">Sem conexão: a folha sai do retrato da noite guardado neste aparelho, das ${houseTime(fromPicture)}.</p>` : nothing}
      ${onlyChanges && !fromPicture ? changesSheet() : sheet()}
    </div>`;
  }

  const draw = () => alive && render(screen(), container);

  async function fromDevice() {
    const picture = await readPicture();
    if (!picture) return false;
    const f = picture.floor;
    const kept = (f.reservations || []).filter((r) => ["confirmed", "pending", "completed", "no_show"].includes(r.status) && r.source !== "walk_in");
    snap = { date: picture.date, day: f.day, areas: f.areas, reservations: kept.sort((a, b) => a.time.localeCompare(b.time)), waitlist: (f.reservations || []).filter((r) => ["waitlisted", "offered"].includes(r.status)), changes: [] };
    fromPicture = picture.saved_at;
    return true;
  }

  async function load() {
    if (connection() !== "online" && (await fromDevice())) return draw();
    try {
      snap = await nightSnapshot();
      printedAt = new Date();
    } catch (error) {
      if (!(await fromDevice())) failure = error;
    }
    draw();
  }

  draw();
  await load();
  return () => {
    alive = false;
  };
}
