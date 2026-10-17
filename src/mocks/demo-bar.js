// Barrinha mostrada só em desenvolvimento e na demonstração para o cliente: avisa que os dados são
// fictícios e deixa quem está apresentando forçar um estado ou recomeçar os dados. No
// painel ela também abre "Entrada": a senha e o código da demonstração, os atalhos ?papel=, os
// links de uso único (primeiro acesso, convite, nova senha) que iriam por e-mail, e os testes do
// aparelho da casa (relógio, assinatura, inatividade).
import "./demo-bar.css";
import { houseParts } from "../lib/dates.js";
import { html, nothing, render } from "../lib/html.js";
import { local, session } from "../lib/storage.js";
import { getState, resetState, save } from "./db.js";
import { authOf, clearDemoRole, clearMockNow, currentScenario, mockNow, personalCookie, setScenario } from "./scenario.js";
import { DEMO_CODE, DEMO_PASSWORD, inviteToken } from "./seeds/auth.js";

const SCENARIOS = [
  ["normal", "normal"],
  ["lento", "lenta"],
  ["erro", "com erro"],
  ["vazio", "vazia"],
];

function reloadWithout(...params) {
  const url = new URL(window.location.href);
  params.forEach((p) => url.searchParams.delete(p));
  window.location.replace(url);
}

/** O mesmo endereço com ?papel= (o atalho que pula a entrada). */
function withRole(role) {
  const url = new URL(window.location.href);
  url.searchParams.set("papel", role);
  return `${url.pathname}${url.search}`;
}

/** Os dados de entrada do painel: o que os e-mails da demonstração levariam. */
function entryLinks() {
  const now = mockNow();
  const state = getState(now);
  const auth = authOf(state);
  const owner = state.users.find((u) => u.role === "owner");
  const setup = auth.tokens.filter((t) => t.kind === "owner_setup");
  const links = [];
  const open = setup.find((t) => !t.used_at && !t.recovery && new Date(t.expires_at) > now);
  const used = setup.find((t) => t.used_at && !t.recovery);
  const recovery = setup.find((t) => t.recovery && !t.used_at && new Date(t.expires_at) > now);
  if (open) links.push(["Primeiro acesso do dono", `/admin/entrar/primeiro-acesso/${open.token}`]);
  if (used) links.push(["Primeiro acesso já usado", `/admin/entrar/primeiro-acesso/${used.token}`]);
  if (recovery) links.push([`Recuperação de ${owner?.name?.split(" ")[0] || "dono"} (refaz senha e código)`, `/admin/entrar/primeiro-acesso/${recovery.token}`]);
  for (const u of state.users.filter((x) => x.status === "invited")) links.push([`Convite de ${u.email}`, `/admin/entrar/convite/${inviteToken(u)}`]);
  const reset = auth.outbox.find((m) => m.kind === "reset");
  if (reset) links.push([`Nova senha de ${reset.to}`, reset.path]);
  return links;
}

/** A sessão termina no "servidor" como se o tempo dela tivesse acabado: a próxima chamada responde 401. */
function expireSession() {
  const now = mockNow();
  const state = getState(now);
  const cookie = personalCookie();
  const record = cookie && authOf(state).sessions.find((s) => s.id === cookie.id);
  if (record) record.ended_at = now.toISOString();
  else session.set("territorio:mock-equipe", { id: "vencida" }); // o atalho ?papel= vira uma sessão encerrada
  clearDemoRole();
  save();
  const url = new URL(window.location.href);
  url.searchParams.delete("papel");
  window.history.replaceState(window.history.state, "", url);
}

export function mountDemoBar() {
  const host = document.createElement("div");
  host.className = "demo-bar";
  document.body.append(host);
  let open = local.get("territorio:demo-open", window.matchMedia("(min-width: 700px)").matches);
  let entry = false;
  let expired = false;

  const toggle = (value) => {
    open = value;
    local.set("territorio:demo-open", value);
    draw();
  };

  const onScenario = (event) => {
    setScenario(event.target.value);
    reloadWithout("mock");
  };

  const onReset = () => {
    resetState();
    clearMockNow();
    reloadWithout("mock", "agora");
  };

  function entryPanel() {
    return html`<div class="demo-bar__entrada" id="demo-entrada">
      <p>Senha de todos: <b>${DEMO_PASSWORD}</b> · código: <b>${DEMO_CODE}</b></p>
      <p>
        Pular a entrada (<b>?papel=</b>):
        <a href=${withRole("dono")}>dono</a> · <a href=${withRole("gerente")}>gerente</a> · <a href=${withRole("recepcao")}>recepção</a> ·
        <a href=${withRole("sair")}>sair</a>
      </p>
      <p>Links que iriam por e-mail:</p>
      <ul>
        ${entryLinks().map(([label, path]) => html`<li><a href=${path}>${label}</a></li>`)}
      </ul>
      <p>
        Aparelho da casa: <a href="/admin/aparelho">parear este navegador</a> · <a href="?relogio=6">relógio +6 min</a> · <a href="?relogio=0">relógio certo</a> ·
        <a href="?assinatura=errada">assinatura errada</a> · <a href="?assinatura=certa">assinatura certa</a> · <a href="?inatividade=20">trava em 20 s</a>
      </p>
      <button
        type="button"
        @click=${() => {
          expireSession();
          expired = true;
          draw();
        }}
      >
        Vencer a sessão agora
      </button>
      ${expired ? html`<span role="status">A próxima ação pede para entrar de novo.</span>` : nothing}
    </div>`;
  }

  function draw() {
    const scenario = currentScenario();
    const now = houseParts(mockNow());
    const [, month, day] = now.date.split("-");
    const inPanel = window.location.pathname.startsWith("/admin");
    const panel = html`<section class="demo-bar__panel" aria-label="Demonstração">
      <b>Demonstração</b>
      <span>dados fictícios</span>
      <label>
        Situação
        <select @change=${onScenario}>
          ${SCENARIOS.map(([value, label]) => html`<option value=${value} ?selected=${value === scenario}>${label}</option>`)}
        </select>
      </label>
      <span class="demo-bar__clock" title="Hora da casa">${day}/${month} ${now.time}</span>
      ${inPanel
        ? html`<button
            type="button"
            aria-expanded=${String(entry)}
            aria-controls="demo-entrada"
            @click=${() => {
              entry = !entry;
              draw();
            }}
          >
            Entrada
          </button>`
        : nothing}
      <button type="button" @click=${onReset}>Recomeçar dados</button>
      <button type="button" aria-label="Esconder a barra" @click=${() => toggle(false)}>–</button>
      ${inPanel && entry ? entryPanel() : nothing}
    </section>`;
    const tab = html`<button type="button" class="demo-bar__tab" @click=${() => toggle(true)}>Demo</button>`;
    render(open ? panel : tab, host);
  }
  draw();
}
