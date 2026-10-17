// Um grupo de configurações: as linhas montadas pelo catálogo, a marca "mudou" em cada linha alterada,
// a barra de impacto com "Desfazer" e "Ver o efeito e gravar", a janela "O que muda", a
// gravação com a versão lida, e os estados de conflito, validação, sem conexão e descarte.
import { openDialog } from "../../../components/dialog.js";
import { confirmAction } from "../../../components/confirm.js";
import { toast } from "../../../components/toast.js";
import { houseParts } from "../../../lib/dates.js";
import { describeError, staffErrorMessage } from "../../../lib/errors.js";
import { html, nothing, render } from "../../../lib/html.js";
import { clearIdempotencyKey, idempotencyKey } from "../../../lib/idempotency.js";
import { session } from "../../../lib/storage.js";
import * as api from "../../../services/api/staff-configuracoes.js";
import { confirmIdentity, identityFresh } from "../../identity.js";
import { effectView } from "../agenda/effect.js";
import { toleranceTable } from "../salao/tolerancia.js";
import { publication } from "../site/publicacao.js";
import { GROUPS, SECTIONS, anchorOf, pathsOf, rowForField, rowsOf } from "./catalog.js";
import { control, describedBy, formatValue } from "./controls.js";
import { CUSTOM } from "./custom.js";
import { mountGoogle } from "./google.js";
import { historyDialog, loadHistory, versionData } from "./history.js";
import { cookiesPreview, messagesPreview, pendingPreview, termsPreview } from "./preview.js";
import { sideNav } from "./side-nav.js";
import { canDo } from "../../nav.js";

const CACHE = (slug) => `territorio:cfg-ultima:${slug}`;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (v) => (v === undefined ? v : structuredClone(v));

export function getPath(obj, path) {
  return path.split(".").reduce((node, part) => (node == null ? undefined : node[part]), obj);
}

function setPath(obj, path, value) {
  const parts = path.split(".");
  const out = { ...obj };
  let node = out;
  for (const part of parts.slice(0, -1)) {
    node[part] = { ...(node[part] || {}) };
    node = node[part];
  }
  node[parts.at(-1)] = value;
  return out;
}

/** "hoje 16:02", "ontem 21:10", "14/10 às 16:20". */
export function when(iso) {
  if (!iso) return "";
  const at = houseParts(iso);
  const today = houseParts(new Date());
  const yesterday = houseParts(new Date(Date.now() - 86_400_000));
  if (at.date === today.date) return `hoje ${at.time}`;
  if (at.date === yesterday.date) return `ontem ${at.time}`;
  const [, m, d] = at.date.split("-");
  return `${d}/${m} às ${at.time}`;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const WIDE = new Set([
  "localized", "week", "address", "people", "weekdayMinutes", "durationRules", "terms", "versions", "ready", "areas", "locales",
  "appearance", "integrations", "exceptions", "templates",
]);
// abaixo desta largura a prévia do cliente vira uma aba ao lado do formulário (tablet e celular)
const NARROW = "(width < 1360px)";
const isoDay = (date) => date.toISOString().slice(0, 10);

/**
 * @param {HTMLElement} container
 * `embedded` desenha o grupo sem o índice lateral e sem o caminho de volta (o passo a passo do primeiro uso).
 * @param {{slug: string, user: any, navigate: (p: string) => void, index: any, highlight?: string, onSaved: () => void, embedded?: boolean}} options
 */
export function mountGroup(container, { slug, user, navigate, index, highlight, onSaved, embedded = false }) {
  const group = GROUPS[slug];
  // quem pode mudar as regras vem do arquivo de permissões (história 1.3), nunca de um perfil escrito aqui
  const isOwner = canDo(user.role, "PATCH /staff/settings/{group}", user.areas ?? undefined);
  const s = {
    status: "loading",
    doc: null,
    original: null,
    draft: null,
    errors: {},
    langs: {},
    previewLang: "pt",
    offline: typeof navigator !== "undefined" && navigator.onLine === false,
    stale: false,
    saved: false,
    terms: null,
    dialog: null,
    highlight,
    // o atalho que a mensagem de um campo aponta ("Abrir Reservas"), por campo
    links: {},
    // o que alguns grupos leem além do seu documento: os dias especiais da Agenda, os modelos da Meta,
    // o resultado de "Testar agora" em cada integração
    exceptions: undefined,
    templates: undefined,
    checks: {},
    // tablet e celular: o formulário ou a prévia do cliente
    pane: "form",
    narrow: typeof window !== "undefined" && window.matchMedia(NARROW).matches,
  };
  let alive = true;
  let dialogHandle = null;
  // "Situação da publicação" (história 2.8): a última publicação do site, acompanhada enquanto roda
  const pub = group.site ? publication({ onChange: () => draw() }) : null;
  // a conta Google da casa (Integrações) mora num bloco próprio, montado quando o lugar dele é desenhado
  let googleHost = null;
  let googleCleanup = null;
  const controller = new AbortController();

  // ---- derivados ----
  const readOnly = () => !isOwner || group.readOnly || s.offline || s.stale;
  const changedKeys = () => (s.draft ? Object.keys(s.draft).filter((k) => !same(s.original[k], s.draft[k])) : []);
  const rowChanged = (row) => pathsOf(row).some((p) => !same(getPath(s.original, p), getPath(s.draft, p)));
  const visibleRows = () => rowsOf(group).filter((r) => !r.when || r.when(s.draft));
  const changedRows = () => visibleRows().filter((r) => r.key && !["fixed", "locked", "note", "versions", "tolerance"].includes(r.type) && rowChanged(r));
  const errorCount = () => Object.keys(s.errors).length;
  const dirty = () => changedKeys().length > 0;
  const metaOf = (row) => s.doc?.meta?.[String(row.key || "").split(".")[0]] || {};
  const ctx = () => s.doc?.context || {};
  // o contexto que as linhas personalizadas leem: o do documento, mais o que esta tela buscou sozinha
  const rowContext = () => ({
    ...ctx(),
    exceptions: s.exceptions,
    templates: s.templates,
    checks: s.checks,
    test: isOwner && group.api === "integrations" && !s.offline && !s.stale ? testIntegration : null,
  });

  function errorFor(row) {
    const key = Object.keys(s.errors).find((f) => rowForField(group, f) === row);
    return key ? s.errors[key] : null;
  }

  function linkFor(row) {
    const key = Object.keys(s.links).find((f) => rowForField(group, f) === row);
    return key ? s.links[key] : null;
  }

  function effectOf(row) {
    const scope = metaOf(row).scope;
    const old = formatValue(row, getPath(s.original, row.key));
    if (scope === "all") return `vale na hora para ${plural(ctx().future_reservations ?? 0, "reserva futura", "reservas futuras")}`;
    if (scope === "future") return old ? `só para reservas novas; as já feitas mantêm ${old}` : "só para reservas novas; as já feitas mantêm a regra que tinham";
    if (scope === "recalculates") return "recalcula as reservas já feitas: veja o efeito antes de gravar";
    return group.site ? "aparece no site depois de gravar" : "vale a partir de agora";
  }

  // ---- mudanças ----
  function setField(key, value) {
    if (readOnly()) return;
    s.draft = setPath(s.draft, key, value);
    s.saved = false;
    // a mensagem de uma linha some quando a linha muda de novo
    for (const field of Object.keys(s.errors)) {
      if (field.split(/[.[]/)[0] !== key.split(".")[0]) continue;
      delete s.errors[field];
      delete s.links[field];
    }
    draw();
  }

  function undoAll() {
    s.draft = clone(s.original);
    s.errors = {};
    s.links = {};
    draw();
    container.querySelector(".cfg-grupo__titulo")?.focus();
  }

  // ---- carregando ----
  async function load() {
    s.status = "loading";
    draw();
    try {
      const [doc, terms] = await Promise.all([
        api.group(group.api, { signal: controller.signal }),
        group.preview === "terms" && group.api === "booking" ? api.group("terms", { signal: controller.signal }).catch(() => null) : null,
      ]);
      if (!alive) return;
      s.doc = doc;
      s.original = clone(doc.data);
      s.draft = clone(doc.data);
      s.terms = terms?.data ?? null;
      s.status = "ready";
      s.stale = false;
      session.set(CACHE(slug), doc);
    } catch (error) {
      if (!alive || error?.name === "AbortError") return;
      const cached = session.get(CACHE(slug));
      if ((error?.type === "network" || error?.type === "timeout") && cached) {
        // sem conexão: a última versão lida, só para olhar
        s.doc = cached;
        s.original = clone(cached.data);
        s.draft = clone(cached.data);
        s.status = "ready";
        s.stale = true;
      } else {
        s.status = error?.status === 403 ? "forbidden" : "error";
        s.error = error;
      }
    }
    draw();
    if (s.status === "ready") loadExtras();
    if (s.status === "ready" && s.highlight) {
      const target = document.getElementById(s.highlight);
      s.highlight = null;
      if (target) {
        target.classList.add("is-destaque");
        target.scrollIntoView({ block: "center" });
        (target.querySelector("input, button, select, textarea, [tabindex='0']") || target).focus({ preventScroll: true });
      }
    }
  }

  /** O que alguns grupos mostram além do seu documento; cada um falha sozinho, em silêncio. */
  function loadExtras() {
    const signal = controller.signal;
    if (group.api === "hours") {
      const today = new Date();
      api
        .exceptions(isoDay(today), isoDay(new Date(today.getTime() + 60 * 86_400_000)), { signal })
        .then((list) => (s.exceptions = list))
        .catch(() => (s.exceptions = null))
        .finally(draw);
    }
    if (group.api === "messages") {
      api
        .templates({ signal })
        .then((answer) => (s.templates = answer.items || []))
        .catch(() => (s.templates = null))
        .finally(draw);
    }
    if (pub && !s.stale) pub.load();
  }

  /** "Testar agora" numa integração: a resposta em palavras e a hora, nunca a resposta do serviço. */
  async function testIntegration(key) {
    s.checks = { ...s.checks, [key]: { busy: true } };
    draw();
    try {
      const result = await api.testIntegration(key);
      s.checks = { ...s.checks, [key]: { ok: result.ok, checked_at: result.checked_at } };
      // a própria linha mostra o novo estado e a última resposta boa
      const items = s.doc.data.items.map((i) => (i.key === key ? { ...i, state: result.state, last_ok_at: result.last_ok_at } : i));
      s.doc = { ...s.doc, data: { ...s.doc.data, items } };
      s.original = clone(s.doc.data);
      s.draft = clone(s.doc.data);
    } catch {
      s.checks = { ...s.checks, [key]: { error: true } };
    }
    draw();
  }

  /** "Publicar de novo" depois de site_build_failed: o valor salvo continua salvo, só o site é refeito. */
  async function republish() {
    try {
      await api.republish(`settings:${group.api}`);
      pub.started();
    } catch (error) {
      toast({ kind: "error", title: "Não deu para publicar de novo", message: staffErrorMessage(error) });
    }
  }

  // ---- histórico (história 2.21) ----
  async function openHistory() {
    openModal({ kind: "history", loading: true, entries: [], error: "" });
    try {
      const entries = await loadHistory(group.api);
      if (!alive || s.dialog?.kind !== "history") return;
      s.dialog = { ...s.dialog, loading: false, entries };
    } catch (error) {
      if (!alive || s.dialog?.kind !== "history") return;
      s.dialog = { ...s.dialog, loading: false, error: staffErrorMessage(error) };
    }
    draw();
  }

  /** Os valores de uma versão anterior voltam como mudanças marcadas, pela barra e por "O que muda". */
  function backTo(entry) {
    const data = versionData(s.original, s.dialog.entries, entry);
    closeModal();
    s.draft = { ...clone(s.original), ...clone(data) };
    s.saved = false;
    draw();
    const changed = changedRows();
    toast({
      title: changed.length ? `A versão ${entry.version ?? ""} está na tela` : "Essa versão é igual à de agora",
      message: changed.length ? "Confira as linhas marcadas e grave pelo “Ver o efeito e gravar”." : "",
    });
    container.querySelector(".cfg-linha--mudou")?.scrollIntoView({ block: "center" });
  }

  // ---- gravando ----
  const diff = () => Object.fromEntries(changedKeys().map((k) => [k, s.draft[k]]));

  function needsReauth() {
    if (group.reauth) return true;
    return (group.reauthWhenShorter || []).some((f) => s.draft[f] < s.original[f]);
  }

  function showErrors(errors) {
    s.errors = Object.fromEntries((errors || []).map((e) => [e.field, e.message]));
    s.links = Object.fromEntries((errors || []).filter((e) => e.link?.href).map((e) => [e.field, e.link]));
    draw();
    const first = visibleRows().find((r) => errorFor(r));
    const el = first && document.getElementById(anchorOf(first));
    el?.scrollIntoView({ block: "center" });
    (el?.querySelector("[aria-invalid='true'], input, button, select, textarea") || el)?.focus({ preventScroll: true });
  }

  async function startSave() {
    if (!dirty() || readOnly() || s.dialog) return;
    // a única checagem de identidade do painel: senha e código, valendo 5 minutos (identity.js)
    if (needsReauth() && !identityFresh() && !(await confirmIdentity({ message: "Essa mudança mexe na segurança da casa. Digite a senha e o código; vale por 5 minutos." }))) return;
    await openEffect();
  }

  async function openEffect(note = "") {
    // cada reserva que fica sem mesa recebe aqui a decisão da equipe, como na Agenda
    const fresh = { kind: "effect", loading: true, preview: null, error: "", note, saving: false, notify: true, decisions: new Map() };
    if (s.dialog?.kind === "effect") {
      s.dialog = fresh; // "Ver o efeito de novo" na mesma janela
      draw();
    } else openModal(fresh);
    try {
      const preview = await api.preview(group.api, { data: diff() });
      if (!alive || s.dialog?.kind !== "effect") return;
      if (!preview.valid) {
        closeModal();
        showErrors(preview.errors);
        return;
      }
      s.dialog = { ...s.dialog, loading: false, preview };
    } catch (error) {
      if (!alive) return;
      s.dialog = { ...s.dialog, loading: false, error: staffErrorMessage(error) };
    }
    draw();
    document.querySelector(".cfg-dialogo [data-gravar]")?.focus();
  }

  /** As reservas que ficaram sem mesa e ainda não têm decisão. */
  function undecided(d) {
    const without = (d.preview?.simulation || []).flatMap((day) => day.without_table || []);
    return without.filter((row) => {
      const choice = d.decisions?.get(row.reservation_id);
      return !choice?.action || (choice.action === "reschedule" && !choice.time);
    });
  }

  const resolutionsOf = (d) =>
    [...(d.decisions || new Map()).entries()]
      .filter(([, x]) => x.action)
      .map(([id, x]) => ({ reservation_id: id, action: x.action, time: x.time || null, table_codes: x.table ? x.table.split("+") : null, note: x.note ?? (x.action === "cancel" ? "Mudança no horário da casa" : "") }));

  /** As mensagens prontas cujo texto mudou, como revisões dos seus modelos de WhatsApp. */
  function revisedTemplates(list) {
    const before = s.original.ready_messages || [];
    return list.filter((m, i) => !same(m.text, before[i]?.text)).map((m) => ({ template: m.template, text: m.text }));
  }

  async function confirmSave() {
    const d = s.dialog;
    if (!d || d.saving || !d.preview) return;
    const open = undecided(d);
    if (open.length) {
      s.dialog = { ...d, error: `${plural(open.length, "reserva ainda está", "reservas ainda estão")} sem decisão. Escolha o que fazer com cada uma.` };
      draw();
      container.querySelector(".cfg-dialogo .ag-caso input:not(:checked)")?.focus();
      return;
    }
    s.dialog = { ...d, saving: true, error: "" };
    draw();
    const data = diff();
    // um texto novo de mensagem pronta vai para a Meta como revisão do seu modelo (história 2.14)
    const revisions = group.api === "messages" && data.ready_messages ? revisedTemplates(data.ready_messages) : [];
    if (revisions.length) delete data.ready_messages;
    const body = { data };
    if (d.preview.simulation_hash) body.simulation_hash = d.preview.simulation_hash;
    const resolutions = resolutionsOf(d);
    if (resolutions.length) body.resolutions = resolutions;
    if (d.preview.simulation?.length) body.notify_affected = d.notify;
    const key = `settings:${group.api}:${s.doc.version}`;
    try {
      for (const r of revisions) await api.reviseTemplate(r.template, r.text);
      const doc = Object.keys(data).length
        ? await api.save(group.api, body, s.doc.version, { idempotencyKey: idempotencyKey(key) })
        : await api.group(group.api);
      clearIdempotencyKey(key);
      if (!alive) return;
      s.doc = doc;
      s.original = clone(doc.data);
      s.draft = clone(doc.data);
      s.errors = {};
      s.links = {};
      s.saved = true;
      session.set(CACHE(slug), doc);
      closeModal();
      toast({ title: "Gravado. Vale a partir de agora.", message: revisions.length ? "O texto novo foi para a Meta. Até aprovar, vale o anterior." : "" });
      if (pub) pub.started();
      if (revisions.length) loadExtras();
      if (slug === "reservas") s.terms = (await api.group("terms").catch(() => null))?.data ?? s.terms;
      onSaved?.();
      draw();
      container.querySelector(".cfg-grupo__titulo")?.focus();
    } catch (error) {
      if (!alive) return;
      handleSaveError(error);
    }
  }

  async function handleSaveError(error) {
    const type = error?.type;
    if (type === "reauth_required") {
      // os 5 minutos do servidor acabaram dentro de "O que muda": confirme aqui e grave as mesmas escolhas
      const confirmed = await confirmIdentity({ message: "Os 5 minutos da confirmação passaram. Digite a senha e o código para gravar." });
      if (!alive) return;
      s.dialog = s.dialog ? { ...s.dialog, saving: false } : s.dialog;
      draw();
      if (confirmed) confirmSave();
      return;
    }
    if (error?.status === 422 || type === "validation") {
      closeModal();
      showErrors(error.errors);
      return;
    }
    if (error?.status === 412) {
      // a mesma janela vira o conflito, sem fechar e abrir de novo
      s.dialog = { kind: "conflict", title: describeError(error, { staff: true, vars: { name: error.body?.current?.updated_by } }).title, current: error.body?.current };
      draw();
      container.querySelector(".cfg-dialogo [data-foco]")?.focus();
      return;
    }
    if (type === "preview_required") {
      // o servidor quer o efeito visto antes: "O que muda" abre de novo em vez de um erro
      openEffect();
      return;
    }
    if (type === "plan_changed") {
      s.dialog = { ...s.dialog, saving: false, error: "O efeito mudou desde que você abriu. Veja de novo antes de gravar." };
      draw();
      return;
    }
    if (type === "day_has_reservations" || type === "conflict") {
      // entrou uma reserva desde a prévia: os casos aparecem de novo, cada um para decidir
      openEffect(`${describeError(error, { staff: true }).title}. Entrou ou saiu reserva enquanto você olhava: confira de novo e decida cada caso.`);
      return;
    }
    if (type === "settings_read_only" || error?.status === 403) {
      closeModal();
      toast({ kind: "error", title: "Só o dono muda as regras", message: "As mudanças continuam na tela." });
      return;
    }
    // rede, tempo esgotado, servidor: as mudanças ficam; a mesma chave é usada de novo
    s.dialog = { ...s.dialog, saving: false, error: staffErrorMessage(error) };
    draw();
  }

  function resolveConflict(keepMine) {
    const current = s.dialog?.current;
    if (!current) return closeModal();
    const mine = diff();
    s.doc = current;
    s.original = clone(current.data);
    s.draft = keepMine ? { ...clone(current.data), ...clone(mine) } : clone(current.data);
    closeModal();
    toast({ title: keepMine ? "Juntamos: as suas mudanças continuam marcadas." : "Ficou a versão gravada pela outra pessoa." });
    draw();
  }

  // ---- o lugar das janelas ----
  function openModal(state) {
    s.dialog = state;
    draw();
    const el = container.querySelector(".cfg-dialogo");
    if (!el) return;
    // uma janela fechada logo antes (reauth → effect) dispara o evento de fechar depois, quando esta
    // já está aberta: só um fechamento de verdade limpa o estado
    dialogHandle = openDialog(el, {
      onClose: () => {
        if (el.open) return;
        dialogHandle = null;
        s.dialog = null;
        draw();
      },
    });
    el.querySelector("[data-foco]")?.focus();
  }

  function closeModal() {
    s.dialog = null;
    dialogHandle?.close();
    dialogHandle = null;
    draw();
  }

  // ---- telas ----
  function rowView(row) {
    if (row.when && !row.when(s.draft)) return nothing;
    if (row.type === "note") {
      return html`<div class="cfg-linha cfg-linha--nota"><p>${row.text}</p>${row.link ? html`<a class="link-button" href=${row.link.href}>${row.link.label}</a>` : nothing}</div>`;
    }
    if (row.type === "tolerance") {
      // alimentada com o que está na tela agora, a outra metade da regra vinda do outro grupo
      const rules = { ...ctx().booking, ...ctx().floor, ...s.draft };
      return html`<div class="cfg-linha cfg-linha--larga cfg-linha--tolerancia">${toleranceTable(rules)}</div>`;
    }
    if (row.type === "locked") {
      return html`<div class="cfg-linha cfg-linha--travada">
        <div class="cfg-linha__rot">
          <span class="cfg-linha__rotulo">${row.label}<span class="sr-only">, travado, ${row.module.toLowerCase()}</span></span>
          <p class="cfg-ajuda">${row.help}</p>
        </div>
        <span class="cfg-modulo" aria-hidden="true">${row.module}</span>
      </div>`;
    }
    if (row.type === "fixed") {
      return html`<div class="cfg-linha cfg-linha--fixa" id=${anchorOf(row)}>
        <div class="cfg-linha__rot"><span class="cfg-linha__rotulo">${row.label}</span>${row.help ? html`<p class="cfg-ajuda">${row.help}</p>` : nothing}</div>
        <div class="cfg-linha__ctl"><span class="cfg-fixo__valor">${row.value(s.draft)}</span>${row.support === false ? nothing : html`<span class="cfg-fixo">fixo · fale com o suporte</span>`}</div>
      </div>`;
    }
    const uid = `cfg-${anchorOf(row)}`;
    const changed = rowChanged(row) && row.type !== "versions";
    const error = errorFor(row);
    const meta = metaOf(row);
    const value = getPath(s.draft, row.key);
    const old = getPath(s.original, row.key);
    const disabled = readOnly() || meta.read_only;
    const c = {
      row, value, old, meta, uid, error, disabled,
      data: s.draft,
      context: rowContext(),
      errors: s.errors,
      describedby: describedBy(row, uid, error),
      set: (v) => setField(row.key, v),
      setField,
      lang: s.langs[row.key] || "pt",
      langOf: (k) => s.langs[k] || "pt",
      confirmToggle: async (next) => {
        if (!next && row.confirmOff) {
          const ask = row.confirmOff(ctx());
          const ok = await confirmAction({ title: ask.title, message: ask.message, confirmLabel: ask.label, cancelLabel: "Manter ligada", danger: true });
          if (!ok) return;
        }
        setField(row.key, next);
      },
    };
    // os controles chamam setLang(lang); linhas com vários textos chamam setLang(key, lang)
    c.setLang = (k, l) => {
      if (l === undefined) s.langs[row.key] = k;
      else s.langs[k] = l;
      draw();
    };
    const wide = WIDE.has(row.type);
    const ctl = CUSTOM[row.type] ? CUSTOM[row.type](c) : control(row, c);
    const showOld = changed && !wide && row.type !== "toggle";
    return html`<div class="cfg-linha ${wide ? "cfg-linha--larga" : ""} ${changed ? "cfg-linha--mudou" : ""} ${error ? "cfg-linha--erro" : ""}" id=${anchorOf(row)}>
      <div class="cfg-linha__rot">
        <span class="cfg-linha__rotulo" id=${`${uid}-rotulo`}>${row.label}</span>${changed ? html` <span class="cfg-mudou">mudou</span>` : nothing}
        ${row.help ? html`<p class="cfg-ajuda" id=${`${uid}-ajuda`}>${row.help}</p>` : nothing}
        ${changed ? html`<p class="cfg-efeito">${effectOf(row)}</p>` : nothing}
        ${error
          ? html`<p class="cfg-erro" id=${`${uid}-erro`}>${error}${linkFor(row) ? html` <a class="cfg-erro__atalho" href=${linkFor(row).href}>${linkFor(row).label}</a>` : nothing}</p>`
          : nothing}
      </div>
      <div class="cfg-linha__ctl">
        ${showOld ? html`<s class="cfg-antes"><span class="sr-only">antes: </span>${formatValue(row, old) || "vazio"}</s>` : nothing}
        ${ctl}
      </div>
    </div>`;
  }

  function previewView() {
    if (!group.preview || !s.draft) return nothing;
    const setLang = (l) => ((s.previewLang = l), draw());
    const lang = s.previewLang;
    if (group.preview === "terms") {
      const isBooking = group.api === "booking";
      const terms = isBooking ? s.terms : s.draft;
      const booking = isBooking ? { ...s.draft, no_shows: ctx().booking?.no_shows } : ctx().booking;
      const before = isBooking ? { ...s.original, no_shows: ctx().booking?.no_shows } : null;
      return termsPreview({ terms, booking, bookingBefore: before, lang, setLang });
    }
    if (group.preview === "pending") return pendingPreview({ message: s.draft.pending_message, lang, setLang });
    if (group.preview === "messages") return messagesPreview({ data: s.draft, booking: ctx().booking, lang, setLang });
    if (group.preview === "cookies") return cookiesPreview({ text: s.draft.banner_text, lang, setLang });
    return nothing;
  }

  function impactBar() {
    if (readOnly() || !s.draft) return nothing;
    const rows = changedRows();
    const n = rows.length || changedKeys().length;
    if (!n && !errorCount()) return nothing;
    const scopes = new Set(rows.map((r) => metaOf(r).scope));
    const bits = [];
    if (scopes.has("all")) bits.push(`vale na hora para ${plural(ctx().future_reservations ?? 0, "reserva futura", "reservas futuras")}`);
    if (scopes.has("future")) bits.push("parte vale só para as novas");
    if (scopes.has("recalculates")) bits.push("recalcula reservas");
    return html`<div class="cfg-impacto" role="region" aria-label="Mudanças não gravadas">
      <p class="cfg-impacto__texto">
        <b>${plural(n, "mudança", "mudanças")}</b>${errorCount() ? html` · <span class="cfg-impacto__erro">${plural(errorCount(), "campo para corrigir", "campos para corrigir")}</span>` : nothing}${bits.length
          ? html`<span class="cfg-impacto__efeito"> · ${bits.join(" · ")}</span>`
          : nothing}
      </p>
      <span class="cfg-impacto__acoes">
        <button type="button" class="btn btn--sm btn--ghost-dark" @click=${undoAll}>Desfazer</button>
        <button type="button" class="btn btn--sm btn--inverse" @click=${startSave} ?disabled=${!n}>Ver o efeito e gravar</button>
      </span>
    </div>`;
  }

  function lastChange() {
    const doc = s.doc;
    if (!doc) return nothing;
    if (s.saved) return html`<p class="cfg-grupo__ultima" role="status"><b>Gravado</b> · ${doc.updated_by}, ${when(doc.updated_at)} · versão ${doc.version}</p>`;
    if (!doc.updated_by) return html`<p class="cfg-grupo__ultima">Ainda no padrão da casa</p>`;
    return html`<p class="cfg-grupo__ultima">Última mudança: ${doc.updated_by}, ${when(doc.updated_at)} · versão ${doc.version}</p>`;
  }

  function banners() {
    const out = [];
    if (!isOwner) out.push(html`<p class="cfg-aviso" role="note">Só o dono muda as regras. Fale com o ${index?.owner_name || "dono"}.</p>`);
    if (s.offline || s.stale) out.push(html`<p class="cfg-aviso cfg-aviso--atencao" role="status">Sem conexão. Você vê a última versão.</p>`);
    if (isOwner && group.readOnly && !s.offline) {
      out.push(html`<p class="cfg-aviso" role="note">${group.google ? "A tabela dos serviços é só para ver. Para trocar uma chave, fale com o suporte." : "Só para ver. Para trocar, fale com o suporte."}</p>`);
    }
    if (s.doc?.pending?.length) {
      out.push(html`<ul class="cfg-pendencias" aria-label="Pendências deste grupo">
        ${s.doc.pending.map((p) => html`<li><span class="losango" aria-hidden="true"></span>${p}</li>`)}
      </ul>`);
    }
    if (pub && !s.stale) {
      const view = pub.view(isOwner ? republish : null);
      if (view !== nothing) out.push(html`<div class="cfg-publicacao"><p class="cfg-publicacao__titulo">Situação da publicação</p>${view}</div>`);
    }
    return out;
  }

  function body() {
    if (s.status === "loading") {
      return html`<div class="area__vazio" role="status"><span class="raiz raiz--gira" aria-hidden="true"></span><p>Abrindo ${group.label}…</p></div>`;
    }
    if (s.status === "forbidden") {
      return html`<div class="area__vazio" role="alert">
        <span class="raiz raiz--atencao" aria-hidden="true"></span>
        <p><b>Essa parte é só do dono.</b> Se precisar mudar algo aqui, fale com o ${index?.owner_name || "dono"}.</p>
        <a class="btn" href="/admin/configuracoes">Voltar às configurações</a>
      </div>`;
    }
    if (s.status === "error") {
      return html`<div class="area__vazio" role="alert">
        <span class="raiz raiz--atencao" aria-hidden="true"></span>
        <p><b>Não deu para abrir ${group.label}.</b> ${staffErrorMessage(s.error)}</p>
        <button class="btn" type="button" @click=${load}>Tentar de novo</button>
      </div>`;
    }
    return html`${banners()}
      ${group.google && isOwner && !s.stale ? html`<div class="cfg-google-host"></div>` : nothing}
      <form class="cfg-form" novalidate @submit=${(e) => (e.preventDefault(), startSave())}>
        ${group.blocks.map(
          (block) => html`<fieldset class="cfg-bloco">
            <legend class="cfg-bloco__titulo">${block.title}</legend>
            ${block.rows.map(rowView)}
          </fieldset>`,
        )}
      </form>`;
  }

  function dialogView() {
    const d = s.dialog;
    let content = nothing;
    if (d?.kind === "effect") content = effectDialog(d);
    if (d?.kind === "conflict") content = conflictDialog(d);
    if (d?.kind === "history") content = historyDialog(d, { group, canGoBack: isOwner && !readOnly(), onBack: backTo });
    return html`<dialog class="dialog dialog--confirm cfg-dialogo" aria-labelledby="cfg-dialogo-titulo">${content}</dialog>`;
  }

  function labelOfField(field) {
    const row = rowForField(group, field);
    return row?.label || field;
  }

  function changeLine(change) {
    const row = rowForField(group, change.field);
    const before = row ? formatValue(row, change.before) : "";
    const after = row ? formatValue(row, change.after) : "";
    const scope = {
      all: html`<b>Vale na hora.</b> ${plural(s.dialog.preview.affected?.future_reservations ?? 0, "reserva futura passa", "reservas futuras passam")} a seguir a regra nova.`,
      future: html`<b>Só para reservas novas.</b> As já feitas mantêm ${before || "a regra que tinham"}.`,
      recalculates: html`<b>Recalcula as reservas.</b> Veja abaixo quem muda.`,
      none: group.site ? html`<b>Aparece no site</b> depois que ele for refeito.` : html`<b>Vale a partir de agora.</b>`,
    }[change.scope || "none"];
    return html`<li class="cfg-muda">
      <p class="cfg-muda__nome">${labelOfField(change.field)}${before && after && before !== after ? html` <span class="cfg-muda__de">${before} → ${after}</span>` : nothing}</p>
      <p>${scope}</p>
    </li>`;
  }

  /**
   * Quem fica com a mesa, quem muda de horário e quem fica sem, por data: o mesmo "quem
   * perde mesa" que a Agenda usa, com uma decisão para cada reserva que fica sem mesa.
   */
  function simulationView(d) {
    const sim = d.preview?.simulation;
    if (!sim?.length) return nothing;
    // uma mudança de horário aparece como "20:30 → 21:00"; os lugares da noite são assunto da Agenda
    const results = sim.map(({ seats_before: _b, seats_after: _a, ...day }) => ({
      ...day,
      moved: (day.moved || []).map((row) => ({ ...row, from: [row.time], to: [row.to_time || row.time], from_list: null, to_list: null })),
    }));
    return html`<div class="cfg-simulacao">
      <h3>Reservas por data</h3>
      ${effectView(results, d.decisions, draw)}
    </div>`;
  }

  /** "Nenhuma reserva afetada" quando a mudança não toca em nenhuma reserva. */
  function noBookings(p) {
    const touched = (p.simulation || []).some((day) => day.moved?.length || day.without_table?.length);
    const now = p.changes.some((c) => c.scope === "all") && p.affected?.future_reservations;
    return touched || now ? nothing : html`<p class="cfg-ajuda cfg-nenhuma" role="status">Nenhuma reserva afetada.</p>`;
  }

  function effectDialog(d) {
    const p = d.preview;
    const ready = p && !d.loading;
    return html`<div class="dialog__body cfg-dialogo__corpo">
      <h2 id="cfg-dialogo-titulo">O que muda</h2>
      ${d.loading ? html`<p role="status"><span class="raiz raiz--gira" aria-hidden="true"></span> Vendo o efeito…</p>` : nothing}
      ${d.note && !d.loading ? html`<p class="cfg-erro" role="alert">${d.note}</p>` : nothing}
      ${p
        ? html`<ul class="cfg-mudancas">${p.changes.map(changeLine)}</ul>
            ${noBookings(p)}
            ${simulationView(d)}
            ${p.notes?.length ? html`<ul class="cfg-notas">${p.notes.map((n) => html`<li>${n}</li>`)}</ul>` : nothing}
            ${p.simulation?.length
              ? html`<label class="check">
                  <input type="checkbox" .checked=${d.notify} @change=${(e) => ((s.dialog = { ...s.dialog, notify: e.target.checked }), draw())} />
                  <span>Avisar pelo WhatsApp quem teve o horário ou a mesa mexidos.</span>
                </label>`
              : nothing}
            <p class="cfg-ajuda">Fica no registro de ações: ${user.name}, agora.</p>`
        : nothing}
      ${d.error ? html`<p class="cfg-erro" role="alert">${d.error}</p>` : nothing}
      <div class="dialog__actions">
        <button type="button" class="btn btn--outline btn--sm" data-close>Voltar</button>
        ${d.error && !d.saving && (d.error.includes("efeito") || !p)
          ? html`<button type="button" class="btn btn--sm" data-foco @click=${() => openEffect()}>Ver o efeito de novo</button>`
          : html`<button type="button" class="btn btn--sm" data-gravar data-foco aria-busy=${String(Boolean(d.saving))} ?disabled=${!ready || d.saving} @click=${confirmSave}>
              ${d.saving ? html`<span class="btn__spin" aria-hidden="true"></span>Gravando…` : d.error ? "Tentar de novo" : "Gravar"}
            </button>`}
      </div>
    </div>`;
  }

  function conflictDialog(d) {
    const current = d.current;
    const theirs = current ? Object.keys(current.data).filter((k) => !same(current.data[k], s.original[k])) : [];
    return html`<div class="dialog__body cfg-dialogo__corpo">
      <h2 id="cfg-dialogo-titulo">${d.title || "Outra pessoa gravou antes de você"}</h2>
      <p>Enquanto você mexia, a versão ${current?.version ?? ""} foi gravada. O que mudou:</p>
      <ul class="cfg-mudancas">
        ${theirs.map((k) => {
          const row = rowForField(group, k);
          return html`<li class="cfg-muda"><p class="cfg-muda__nome">${row?.label || k} <span class="cfg-muda__de">${row ? `${formatValue(row, s.original[k])} → ${formatValue(row, current.data[k])}` : ""}</span></p></li>`;
        })}
      </ul>
      <p class="cfg-ajuda">Juntar mantém as suas mudanças por cima da versão nova.</p>
      <div class="dialog__actions">
        <button type="button" class="btn btn--outline btn--sm" @click=${() => resolveConflict(false)}>Descartar as minhas</button>
        <button type="button" class="btn btn--sm" data-foco @click=${() => resolveConflict(true)}>Juntar com as minhas</button>
      </div>
    </div>`;
  }

  /** Tablet e celular: a prévia é uma aba ao lado do formulário em vez de uma coluna. */
  function paneTabs() {
    const pick = (pane) => {
      s.pane = pane;
      draw();
      requestAnimationFrame(() => container.querySelector(`#cfg-aba-${pane}`)?.focus());
    };
    const tab = (pane, label) => html`<button
      type="button"
      role="tab"
      class="tab"
      id=${`cfg-aba-${pane}`}
      aria-controls=${`cfg-painel-${pane}`}
      aria-selected=${String(s.pane === pane)}
      tabindex=${s.pane === pane ? "0" : "-1"}
      @click=${() => pick(pane)}
      @keydown=${(e) => ["ArrowLeft", "ArrowRight"].includes(e.key) && (e.preventDefault(), pick(s.pane === "form" ? "preview" : "form"))}
    >
      ${label}
    </button>`;
    return html`<div class="tabs tabs--row cfg-abas" role="tablist" aria-label="Ver">${tab("form", "Configuração")}${tab("preview", "Como o cliente vê")}</div>`;
  }

  function draw() {
    if (!alive) return;
    const section = SECTIONS.find((x) => x.key === group.section);
    const withPreview = group.preview && s.status === "ready";
    const tabbed = withPreview && s.narrow;
    const showForm = !tabbed || s.pane === "form";
    render(
      html`<div class="cfg cfg--grupo ${group.preview ? "cfg--com-previa" : ""} ${tabbed ? "cfg--em-abas" : ""} ${embedded ? "cfg--embutido" : ""}">
        ${embedded ? nothing : sideNav(index, slug, user)}
        <section class="cfg-grupo" aria-labelledby="cfg-grupo-titulo">
          ${embedded
            ? nothing
            : html`<a class="cfg-voltar" href="/admin/configuracoes">‹ Todas as configurações</a>
                <p class="cfg-trilha">Configurações / ${section?.label}</p>`}
          <div class="cfg-grupo__topo">
            <h2 class="cfg-grupo__titulo" id="cfg-grupo-titulo" tabindex="-1">${group.label}</h2>
            ${group.api && !group.readOnly && s.status === "ready" ? html`<button type="button" class="action cfg-grupo__historico" @click=${openHistory}>Histórico</button>` : nothing}
          </div>
          ${lastChange()}
          <p class="cfg-grupo__intro">${group.intro}</p>
          ${tabbed ? paneTabs() : nothing}
          <div id="cfg-painel-form" role=${tabbed ? "tabpanel" : nothing} aria-labelledby=${tabbed ? "cfg-aba-form" : nothing} ?hidden=${!showForm}>${body()}</div>
          ${tabbed
            ? html`<div id="cfg-painel-preview" class="cfg-lado cfg-lado--aba" role="tabpanel" aria-labelledby="cfg-aba-preview" ?hidden=${showForm}>${previewView()}</div>`
            : nothing}
          ${impactBar()}
        </section>
        ${withPreview && !tabbed ? html`<aside class="cfg-lado" aria-label="Prévia do cliente">${previewView()}</aside>` : nothing}
        ${dialogView()}
      </div>`,
      container,
    );
    mountGoogleBlock();
  }

  function mountGoogleBlock() {
    const host = container.querySelector(".cfg-google-host");
    if (host === googleHost) return;
    googleCleanup?.();
    googleCleanup = null;
    googleHost = host;
    if (host) googleCleanup = mountGoogle(host, { user });
  }

  // ---- escutas da página toda: Ctrl+S, sair com mudanças, conexão ----
  const onKey = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (dirty()) startSave();
    }
  };
  const onClick = async (e) => {
    const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
    if (!a || !dirty() || e.defaultPrevented || a.target || a.origin !== window.location.origin || !a.pathname.startsWith("/admin")) return;
    if (a.pathname === window.location.pathname) return;
    e.preventDefault();
    e.stopPropagation();
    const ok = await confirmAction({
      title: "Descartar as mudanças?",
      message: `${plural(changedRows().length || changedKeys().length, "mudança não gravada se perde", "mudanças não gravadas se perdem")}.`,
      confirmLabel: "Descartar",
      cancelLabel: "Continuar editando",
      danger: true,
    });
    if (ok) {
      s.draft = clone(s.original);
      navigate(a.pathname);
    }
  };
  const onUnload = (e) => {
    if (!dirty()) return;
    e.preventDefault();
    e.returnValue = "";
  };
  const onLine = () => {
    s.offline = navigator.onLine === false;
    if (!s.offline && s.stale) load();
    else draw();
  };
  window.addEventListener("keydown", onKey);
  window.addEventListener("click", onClick, true);
  window.addEventListener("beforeunload", onUnload);
  window.addEventListener("online", onLine);
  window.addEventListener("offline", onLine);
  const narrowQuery = window.matchMedia(NARROW);
  const onNarrow = (e) => {
    s.narrow = e.matches;
    draw();
  };
  narrowQuery.addEventListener("change", onNarrow);

  load();

  return () => {
    alive = false;
    controller.abort();
    pub?.stop();
    narrowQuery.removeEventListener("change", onNarrow);
    googleCleanup?.();
    dialogHandle?.close();
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("click", onClick, true);
    window.removeEventListener("beforeunload", onUnload);
    window.removeEventListener("online", onLine);
    window.removeEventListener("offline", onLine);
  };
}

