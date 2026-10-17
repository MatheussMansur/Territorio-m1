// Primeiro acesso (história 3.12): o dono é levado passo a passo pelo que a casa precisa para
// começar (casa, horários, plantas, combinados e equipe). Cada passo é a mesma tela do
// grupo ou área que ele preenche, então nada é digitado em dois lugares; o progresso (o passo em que o dono
// está e os pulados) fica guardado por PUT /staff/onboarding, e "feito" ou "falta" vem do
// servidor, que lê os próprios dados. Cada passo tem o seu endereço, então sair de um grupo
// com mudanças pergunta antes, como em qualquer lugar de Configurações.
import "./configuracoes.css";
import "./primeiro-acesso.css";
import { toast } from "../../components/toast.js";
import { staffErrorMessage } from "../../lib/errors.js";
import { html, nothing, render } from "../../lib/html.js";
import { session } from "../../lib/storage.js";
import * as api from "../../services/api/staff-configuracoes.js";
import { mountDevices } from "./configuracoes/devices.js";
import { mountGroup } from "./configuracoes/group.js";

const BASE = "/admin/primeiro-acesso";
const CACHE = "territorio:primeiro-acesso";

// os 5 passos visíveis e os 8 valores de OnboardingStepKey do contrato que eles agrupam
export const STEPS = [
  { slug: "casa", label: "Casa", keys: ["house"], parts: [{ slug: "", label: "Casa", group: "casa" }] },
  {
    slug: "horarios",
    label: "Horários",
    keys: ["hours", "booking"],
    parts: [
      { slug: "", label: "Semana padrão", group: "horarios" },
      { slug: "reservas", label: "Regras de reserva", group: "reservas" },
    ],
  },
  { slug: "plantas", label: "Plantas", keys: ["layouts"], parts: [{ slug: "", label: "Plantas", area: "plantas" }] },
  { slug: "combinados", label: "Combinados", keys: ["terms"], parts: [{ slug: "", label: "Combinados", group: "combinados" }] },
  {
    slug: "equipe",
    label: "Equipe",
    keys: ["team", "devices", "messages"],
    parts: [
      { slug: "", label: "Pessoas", area: "equipe" },
      { slug: "aparelhos", label: "Aparelhos", devices: true },
      { slug: "mensagens", label: "Mensagens", group: "mensagens" },
    ],
  },
];

/** "feito" só quando toda chave do passo está feita; "pulado" quando o dono deixou para depois. */
export function stepState(step, progress) {
  const parts = (progress?.steps || []).filter((x) => step.keys.includes(x.key));
  if (parts.length && parts.every((x) => x.done)) return "feito";
  if (parts.some((x) => x.skipped)) return "pulado";
  return "falta";
}

const missingOf = (step, progress) => (progress?.steps || []).filter((x) => step.keys.includes(x.key) && !x.done).flatMap((x) => x.missing || []);

/** O passo visível a que pertence o current_step do servidor. */
const stepOfKey = (key) => STEPS.find((st) => st.keys.includes(key)) || STEPS[0];

export async function mount(container, { user, sub, navigate }) {
  const [stepSlug = "", partSlug = ""] = (sub || "").split("/");
  const s = { status: "loading", progress: null, index: null, offline: false, error: null, busy: false };
  let alive = true;
  let inner = null;
  let innerHost = null;
  const narrow = window.matchMedia("(width < 768px)");

  const step = () => STEPS.find((st) => st.slug === stepSlug) || stepOfKey(s.progress?.current_step);
  const part = () => step().parts.find((p) => p.slug === partSlug) || step().parts[0];
  const stepIndex = () => STEPS.indexOf(step());

  async function load() {
    s.status = "loading";
    draw();
    try {
      const [progress, index] = await Promise.all([api.onboarding.get(), api.index()]);
      if (!alive) return;
      Object.assign(s, { progress, index, status: "ready", offline: false });
      session.set(CACHE, { progress, index });
    } catch (error) {
      if (!alive) return;
      const cached = session.get(CACHE);
      if ((error?.type === "network" || error?.type === "timeout") && cached) {
        // sem conexão, a última versão, só para olhar
        Object.assign(s, { ...cached, status: "ready", offline: true });
      } else Object.assign(s, { status: "error", error });
    }
    // o endereço sem passo abre onde o dono parou
    if (s.status === "ready" && !stepSlug) return navigate(`${BASE}/${stepOfKey(s.progress.current_step).slug}`);
    draw();
    if (s.status === "ready" && !s.offline) remember();
  }

  /** Guarda o passo em que o dono está, para que voltar abra aqui. */
  async function remember() {
    const key = step().keys[0];
    if (s.progress.current_step === key) return;
    await saveProgress({ current_step: key }, { quiet: true });
  }

  // um salvamento por vez, cada um com a versão que o anterior respondeu
  let queue = Promise.resolve(true);
  const saveProgress = (body, options) => (queue = queue.then(() => sendProgress(body, options)));

  /** PUT /staff/onboarding com a versão lida; outra sessão salvando antes faz recarregar. */
  async function sendProgress(body, { quiet = false } = {}) {
    if (s.offline) return false;
    try {
      s.progress = await api.onboarding.update(body, { version: s.progress?.version });
      draw();
      return true;
    } catch (error) {
      if (!alive) return false;
      if (error?.status === 412) {
        s.progress = error.body?.current || (await api.onboarding.get().catch(() => s.progress));
        toast({ title: "O progresso mudou em outra sessão", message: "Recarregamos. O que você gravou nos grupos continua guardado." });
        draw();
        return false;
      }
      if (!quiet) toast({ kind: "error", title: "Não deu para guardar o progresso", message: staffErrorMessage(error) });
      return false;
    }
  }

  /** "Fazer depois": o passo fica como "falta", marcado como pulado, e o próximo abre. */
  async function later() {
    const skipped = [...new Set([...(s.progress.steps || []).filter((x) => x.skipped).map((x) => x.key), ...step().keys])];
    if (await saveProgress({ skipped })) next();
  }

  /** Plantas no celular: a planta estimada pelas fotos vale até a visita técnica. */
  async function keepEstimated() {
    s.busy = true;
    draw();
    const ok = await saveProgress({ layouts_accepted: true });
    s.busy = false;
    if (ok) {
      toast({ title: "Vale a planta estimada pelas fotos", message: "Quando a visita técnica acontecer, desenhe a planta no computador." });
      next();
    } else draw();
  }

  function next() {
    const after = STEPS[stepIndex() + 1];
    if (after) navigate(`${BASE}/${after.slug}`);
    else leave("/admin/configuracoes");
  }

  /**
   * "Terminar" ou "Continuar depois": o painel para de abrir o passo a passo na entrada (o que
   * falta fica no Hoje e no índice de Configurações, história 5.2), e o dono segue.
   */
  async function leave(to) {
    s.busy = true;
    draw();
    if (!s.offline) await saveProgress({ after_setup: false }, { quiet: true });
    s.busy = false;
    if (alive) navigate(to);
  }

  // ---- a tela do próprio passo -----------------------------------------------------------------
  async function mountInner() {
    const host = container.querySelector(".pa-conteudo");
    if (!host || host === innerHost) return;
    inner?.();
    inner = null;
    innerHost = host;
    const p = part();
    const refresh = () => api.onboarding.get().then((progress) => alive && ((s.progress = progress), draw())).catch(() => {});
    if (p.group) {
      inner = mountGroup(host, { slug: p.group, user, navigate, index: s.index, onSaved: refresh, embedded: true });
    } else if (p.devices) {
      inner = mountDevices(host, { user, index: s.index });
    } else if (p.area === "plantas" && narrow.matches) {
      inner = null; // o celular recebe o caminho curto abaixo, sem o editor
    } else if (p.area) {
      const module = p.area === "plantas" ? await import("./plantas.js") : await import("./equipe.js");
      if (!alive || innerHost !== host) return;
      const cleanup = await module.mount(host, { user, path: window.location.pathname, sub: "", navigate });
      inner = typeof cleanup === "function" ? cleanup : null;
    }
  }

  // ---- visões ---------------------------------------------------------------------------------
  const stateLabel = { feito: "feito", falta: "falta", pulado: "falta · pulado" };

  function progressList() {
    return html`<ol class="pa-passos" aria-label="Passos do primeiro acesso">
      ${STEPS.map((st, i) => {
        const state = stepState(st, s.progress);
        const current = st === step();
        return html`<li class="pa-passo is-${state} ${current ? "is-atual" : ""}">
          <a class="pa-passo__link" href=${`${BASE}/${st.slug}`} aria-current=${current ? "step" : nothing}>
            <span class="pa-passo__num" aria-hidden="true">${i + 1}</span>
            <span class="pa-passo__nome">${st.label}</span>
            <span class="pa-passo__estado">${stateLabel[state]}</span>
          </a>
        </li>`;
      })}
    </ol>`;
  }

  function partTabs() {
    const parts = step().parts;
    if (parts.length < 2) return nothing;
    return html`<nav class="pa-partes" aria-label=${`Partes de ${step().label}`}>
      ${parts.map(
        (p) => html`<a class="pa-parte" href=${`${BASE}/${step().slug}${p.slug ? `/${p.slug}` : ""}`} aria-current=${p === part() ? "page" : nothing}>${p.label}</a>`,
      )}
    </nav>`;
  }

  function stepNote() {
    const st = step();
    const missing = missingOf(st, s.progress);
    if (st.slug === "plantas") {
      return html`<p class="pa-nota">Até a visita técnica, a casa usa a planta estimada pelas fotos. Pode seguir com ela e desenhar depois.</p>`;
    }
    if (st.slug === "equipe" && part().devices) {
      return html`<p class="pa-nota">
        Sugestão: pareie dois aparelhos, o computador da recepção e um tablet. Se um perder a chave, o outro segura a noite.
      </p>`;
    }
    return missing.length ? html`<p class="pa-nota">Falta: ${missing.join(", ")}.</p>` : nothing;
  }

  function phoneLayouts() {
    return html`<div class="pa-celular" role="note">
      <p><b>Para desenhar a planta, use o computador.</b> Por enquanto vale a planta estimada pelas fotos.</p>
      <div class="pa-acoes">
        <button class="btn" type="button" aria-busy=${String(s.busy)} ?disabled=${s.busy || s.offline} @click=${keepEstimated}>Seguir com ela</button>
        <button class="btn btn--outline" type="button" ?disabled=${s.busy || s.offline} @click=${later}>Fazer depois</button>
      </div>
    </div>`;
  }

  function footer() {
    const i = stepIndex();
    const before = STEPS[i - 1];
    const after = STEPS[i + 1];
    const plantasPhone = step().slug === "plantas" && narrow.matches;
    return html`<div class="pa-rodape">
      ${before ? html`<a class="btn btn--outline btn--sm" href=${`${BASE}/${before.slug}`}>‹ ${before.label}</a>` : html`<span></span>`}
      <div class="pa-acoes">
        ${step().slug === "plantas" && !plantasPhone && stepState(step(), s.progress) !== "feito"
          ? html`<button class="btn btn--outline btn--sm" type="button" ?disabled=${s.offline} @click=${keepEstimated}>Seguir com a planta estimada</button>`
          : nothing}
        ${plantasPhone ? nothing : html`<button class="btn btn--outline btn--sm" type="button" ?disabled=${s.offline} @click=${later}>Fazer depois</button>`}
        ${after
          ? html`<a class="btn btn--sm" href=${`${BASE}/${after.slug}`}>Próximo: ${after.label}</a>`
          : html`<button class="btn btn--sm" type="button" aria-busy=${String(s.busy)} ?disabled=${s.busy} @click=${() => leave("/admin/configuracoes")}>Terminar</button>`}
      </div>
    </div>`;
  }

  function draw() {
    if (!alive) return;
    if (s.status === "loading") {
      render(html`<div class="area__vazio" role="status"><span class="raiz raiz--gira" aria-hidden="true"></span><p>Abrindo o primeiro acesso…</p></div>`, container);
      return;
    }
    if (s.status === "error") {
      render(
        html`<div class="area__vazio" role="alert">
          <span class="raiz raiz--atencao" aria-hidden="true"></span>
          <p><b>Não deu para abrir o primeiro acesso.</b> ${staffErrorMessage(s.error)}</p>
          <button class="btn" type="button" @click=${load}>Tentar de novo</button>
        </div>`,
        container,
      );
      return;
    }
    const done = STEPS.filter((st) => stepState(st, s.progress) === "feito").length;
    const plantasPhone = step().slug === "plantas" && narrow.matches;
    render(
      html`<div class="pa">
        <p class="pa-intro">
          Passo a passo, o que a casa precisa para começar. Pode parar e voltar depois: o assistente abre onde você parou.
          <b>${done} de ${STEPS.length} feitos.</b>
          <button class="btn btn--sm btn--outline pa-sair" type="button" ?disabled=${s.busy} @click=${() => leave("/admin/")}>Continuar depois</button>
        </p>
        ${s.offline ? html`<p class="cfg-aviso cfg-aviso--atencao" role="status">Sem conexão. Você vê a última versão.</p>` : nothing}
        ${progressList()}
        <section class="pa-passo-atual" aria-labelledby="pa-titulo">
          <h2 class="pa-titulo" id="pa-titulo">${stepIndex() + 1}. ${step().label} <span class="pa-titulo__estado">${stateLabel[stepState(step(), s.progress)]}</span></h2>
          ${stepNote()} ${partTabs()} ${plantasPhone ? phoneLayouts() : html`<div class="pa-conteudo"></div>`}
        </section>
        ${footer()}
      </div>`,
      container,
    );
    mountInner();
  }

  const onNarrow = () => {
    innerHost = null;
    inner?.();
    inner = null;
    draw();
  };
  narrow.addEventListener("change", onNarrow);
  await load();
  return () => {
    alive = false;
    narrow.removeEventListener("change", onNarrow);
    inner?.();
    render(nothing, container);
  };
}
