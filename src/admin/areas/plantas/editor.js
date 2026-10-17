// O editor de planta: uma caixa por área da planta, cada uma com a sua grade (um quadrado = 0,5 m,
// 10 px a 100%), com tamanho em metros dado pelo dono. As mesas são arrastadas com o mouse ou o dedo,
// movidas com as setas (Shift = 5 quadrados), marcadas com Espaço para juntar, criadas com N (na
// área em foco) e apagadas com Delete. A barra acima do desenho cria mesas e
// áreas, dá o tamanho da área em foco e afasta o zoom de áreas grandes. A aba "Lista" edita as mesmas mesas
// numa tabela. A barra de salvar fica no pé da tela enquanto algo não foi salvo.
// "Novo ponto" põe um ponto fixo da casa (bar, cozinha, entrada…, história 3.13) na área
// em foco: ele se move e muda de tamanho como uma mesa, mas não tem lugares e nunca junta. Mesas juntadas
// são desenhadas como um grupo com o nome e os lugares. Abaixo de 768 px a planta é só para leitura.
import { confirmAction } from "../../../components/confirm.js";
import { showFormErrors } from "../../../components/field.js";
import { toast } from "../../../components/toast.js";
import { html, nothing, render } from "../../../lib/html.js";
import { uuid } from "../../../lib/uuid.js";
import * as api from "../../../services/api/staff-plantas.js";
import { askConflict } from "../agenda/conflict.js";
import { errorBlock, errorText, isOffline, loadingBlock, offlineNotice, openSheet, plural, recall, remember } from "../agenda/ui.js";
import { DEFAULT_DEPTH, DEFAULT_WIDTH, MODES, SIZE_MAX, SIZE_MIN, areaSheet, gridOf, meters, metersLabel } from "./areas.js";
import { KINDS, fixtureIcon, fixtureName, kindLabel, kindSize, overlaps, placeLegacy, rectOf, tableSize } from "./pontos.js";

const CELL = 10;
const ZOOMS = [0.5, 0.75, 1];
const SHAPES = [
  ["square", "Quadrada"],
  ["round", "Redonda"],
  ["stool", "Banqueta"],
  ["long", "Comprida"],
];
/** Quadrados que uma mesa ou um ponto fixo ocupa. */
const sizeOf = (item) => (item.w ? [item.w, item.h] : tableSize(item));
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const plain = (s) => String(s || "").normalize("NFD").replace(/\p{Diacritic}/gu, "");

function modeHelp(area) {
  if (area.mode === "list") return `Em lista, a reserva conta pessoas até ${area.list_capacity || "a capacidade"}, sem mesa marcada.`;
  if (area.mode === "closed") return "Fechada: ninguém reserva nem senta aqui quando esta planta vale.";
  return "Com mesas: cada reserva ganha uma mesa desta área.";
}

/** A área como esta planta começa: do jeito que a casa disse que ela funciona, no tamanho padrão. */
const layoutAreaFrom = (area, size = {}) => ({
  key: area.key,
  mode: area.default_mode || "tables",
  list_capacity: area.default_mode === "list" ? area.default_list_capacity || null : null,
  bookable_online: area.default_mode !== "closed",
  width_m: size.width_m ?? DEFAULT_WIDTH,
  depth_m: size.depth_m ?? DEFAULT_DEPTH,
});

/** As mesas de exemplo vêm por coluna e linha (0–3); espalha elas na grade uma vez. */
function spread(layout) {
  layout.tables = placeLegacy(layout.tables);
  return layout;
}

/** Mesas e pontos fixos uns sobre os outros ou fora da sua área, em palavras; nunca impedem de salvar. */
function warningsOf(layout) {
  const out = [];
  const items = [
    ...layout.tables.map((t) => ({ name: t.code, area: t.area, r: rectOf(t) })),
    ...layout.fixtures.map((f) => ({ name: fixtureName(f), area: f.area, r: rectOf(f) })),
  ];
  for (const it of items) {
    const conf = layout.areas.find((a) => a.key === it.area);
    if (!conf) {
      out.push(`${it.name} está numa área que saiu desta planta.`);
      continue;
    }
    const { cols, rows } = gridOf(conf);
    if (it.r.x1 < 0 || it.r.y1 < 0 || it.r.x2 > cols || it.r.y2 > rows) out.push(`${it.name} está fora da área.`);
  }
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (a.area === b.area && overlaps(a.r, b.r)) out.push(`${a.name} está em cima de ${b.name}.`);
    }
  }
  return out;
}

/** As mesmas checagens que o servidor faz, para o campo mostrar a mensagem antes de enviar. */
function errorsOf(layout) {
  const errors = {};
  const seen = new Set();
  layout.tables.forEach((t, i) => {
    const code = t.code.trim().toUpperCase();
    if (!code) errors[`tables.${i}.code`] = "Dê um código à mesa.";
    else if (seen.has(code)) errors[`tables.${i}.code`] = `Já existe uma mesa ${code} nesta planta.`;
    seen.add(code);
    if (!(t.max_seats >= 1)) errors[`tables.${i}.max_seats`] = "Pelo menos 1 lugar.";
    if (!(t.min_seats >= 1)) errors[`tables.${i}.min_seats`] = "Pelo menos 1 lugar.";
    else if (t.min_seats > t.max_seats) errors[`tables.${i}.min_seats`] = "O mínimo passa do máximo.";
  });
  layout.areas.forEach((a, i) => {
    if (a.mode === "list" && !(a.list_capacity > 0)) errors[`areas.${i}.list_capacity`] = "Em lista, diga quantas pessoas cabem.";
  });
  layout.fixtures.forEach((f, i) => {
    if (f.kind === "other" && !String(f.name || "").trim()) errors[`fixtures.${i}.name`] = "Dê um nome ao ponto.";
  });
  layout.combos.forEach((c, i) => {
    if (c.min_seats != null && c.max_seats != null && c.min_seats > c.max_seats) errors[`combos.${i}.min_seats`] = "O mínimo da junção passa do máximo.";
  });
  if (!layout.name.trim()) errors.name = "Dê um nome à planta.";
  return errors;
}

export function mountEditor(container, { id, user, navigate, save }) {
  let status = "loading";
  let error = null;
  let layout = null;
  let houseAreas = []; // as áreas da casa, para os nomes e para somar uma a esta planta
  let original = "";
  let current = null; // código da mesa em edição
  let currentPoint = null; // id do ponto fixo em edição
  let focusArea = null; // chave da área em que a barra age
  let pickArea = null; // a área da casa escolhida para entrar nesta planta
  const marked = new Set(); // mesas marcadas para juntar
  let tab = "desenho";
  let zoom = 1;
  let busy = false;
  let savedLine = "";
  let serverWarnings = [];
  let message = "";
  let alive = true;
  let version = null; // a versão lida, devolvida como If-Match
  const controller = new AbortController();
  const narrowQuery = window.matchMedia("(width < 768px)");
  let small = narrowQuery.matches;
  let offline = false; // sem conexão: a última cópia, só para ler
  const narrow = () => small || offline;

  const dirty = () => layout && JSON.stringify(layout) !== original;
  const say = (text) => {
    message = "";
    draw();
    setTimeout(() => {
      message = text;
      draw();
    }, 30);
  };
  const byCode = (code) => layout.tables.find((t) => t.code === code);
  const pointOf = (id) => layout.fixtures.find((f) => f.id === id);
  const confOf = (key) => layout.areas.find((a) => a.key === key);
  const nameOf = (key) => houseAreas.find((a) => a.key === key)?.name || key;
  const focusTable = (code) => requestAnimationFrame(() => container.querySelector(`[data-code="${CSS.escape(code)}"]`)?.focus());
  const focusPoint = (id) => requestAnimationFrame(() => container.querySelector(`[data-ponto="${CSS.escape(id)}"]`)?.focus());
  const keepFocusArea = () => {
    if (!confOf(focusArea)) focusArea = (layout.areas.find((a) => a.mode !== "closed") || layout.areas[0])?.key || null;
  };

  /** Pega uma planta do servidor como a que está em edição (a versão lida fica à parte). */
  function take(data) {
    version = data.version || version;
    const areas = (data.areas || []).map(({ name: _name, ...a }) => ({ ...a, width_m: a.width_m ?? DEFAULT_WIDTH, depth_m: a.depth_m ?? DEFAULT_DEPTH }));
    // os nomes vêm com a planta também: eles servem quando a lista da casa não está à mão
    for (const a of data.areas || []) if (a.name && !houseAreas.some((h) => h.key === a.key)) houseAreas.push({ key: a.key, name: a.name });
    layout = spread({ ...data, areas, tables: data.tables.map((t) => ({ ...t })), combos: (data.combos || []).map((c) => ({ ...c })), fixtures: (data.fixtures || []).map((f) => ({ ...f })) });
    for (const key of ["used_by", "seats_total", "version", "updated_by"]) delete layout[key];
    keepFocusArea();
  }

  async function load() {
    status = "loading";
    draw();
    try {
      const [data, areas] = await Promise.all([api.layout(id, { signal: controller.signal }), api.areas({ signal: controller.signal })]);
      remember(`planta:${id}`, data);
      remember("plantas:areas", areas);
      houseAreas = areas;
      take(data);
      original = JSON.stringify(layout);
      offline = false;
      status = "ready";
    } catch (e) {
      if (!alive || e?.name === "AbortError") return;
      const copy = isOffline(e) ? recall(`planta:${id}`) : null;
      if (copy) {
        houseAreas = recall("plantas:areas") || [];
        take(copy);
        original = JSON.stringify(layout);
        offline = true;
        status = "ready";
      } else {
        status = "error";
        error = e;
      }
    }
    draw();
  }

  /** Em palavras, o que vale citar quando outra pessoa salvou a planta antes. */
  const summary = (l) => ({
    name: l.name,
    description: l.description || "",
    mesas: l.tables.map((t) => `${t.code} ${t.min_seats}–${t.max_seats}`).join(", "),
    juncoes: (l.combos || []).map((c) => c.codes.join("+")).join(", "),
    pontos: (l.fixtures || []).map((f) => fixtureName(f)).join(", "),
    areas: l.areas.map((a) => `${nameOf(a.key)} ${a.mode} ${a.width_m ?? DEFAULT_WIDTH}×${a.depth_m ?? DEFAULT_DEPTH} m`).join(", "),
  });

  async function conflict(e) {
    const current = e.body?.current;
    if (!current) return load();
    const choice = await askConflict({
      error: e,
      read: summary(JSON.parse(original)),
      current: summary(current),
      labels: { name: "Nome", description: "Para quando", mesas: "Mesas", juncoes: "Junções", pontos: "Pontos fixos", areas: "Áreas" },
    });
    if (choice === "join") {
      // o desenho na tela fica por cima da nova versão; salvar de novo envia ele
      version = current.version;
      toast({ title: "Juntamos", message: "O seu desenho continua na tela. Grave de novo para valer." });
      draw();
    } else if (choice === "discard") {
      await load();
    }
  }

  function update(fn) {
    fn(layout);
    draw();
  }

  function setFocusArea(key) {
    if (focusArea === key) return;
    focusArea = key;
    draw();
  }

  /** Um código ainda não usado, pela primeira letra da área: S1, Q1, B1, T1… */
  function nextCode(area) {
    const prefix = { salao: "S", quintal: "Q", balcao: "B" }[area] || plain(nameOf(area)).replace(/[^a-z]/gi, "").charAt(0).toUpperCase() || "M";
    let n = 1;
    while (layout.tables.some((t) => t.code === `${prefix}${n}`)) n++;
    return `${prefix}${n}`;
  }

  /** O primeiro lugar de uma área onde uma peça w × h não encosta em nada (um quadrado de margem em volta). */
  function freeSpot(area, w, h) {
    const { cols, rows } = gridOf(confOf(area));
    const taken = [...layout.tables, ...layout.fixtures].filter((i) => i.area === area).map(rectOf);
    for (let y = 2; y + h <= rows; y++) {
      for (let x = 2; x + w <= cols; x++) {
        const r = { x1: x - 1, y1: y - 1, x2: x + w + 1, y2: y + h + 1 };
        if (!taken.some((t) => overlaps(r, t))) return { x, y };
      }
    }
    return { x: 0, y: 0 };
  }

  function addTable(area = focusArea) {
    if (!confOf(area)) return say("Ponha uma área nesta planta antes de criar mesas.");
    const code = nextCode(area);
    const shape = area === "quintal" ? "round" : area === "balcao" ? "stool" : "square";
    const { x, y } = freeSpot(area, ...tableSize({ shape }));
    layout.tables.push({ code, area, min_seats: 1, max_seats: 4, shape, x, y, bookable_online: area !== "balcao", priority: 1 });
    current = code;
    currentPoint = null;
    focusArea = area;
    if (tab === "desenho") focusTable(code);
    say(`Mesa ${code} criada em ${nameOf(area)}.`);
  }

  async function removeTable(code) {
    const ok = await confirmAction({ title: `Apagar a mesa ${code}?`, message: "As junções com ela também saem desta planta.", confirmLabel: "Apagar mesa", danger: true });
    if (!ok) return;
    layout.tables = layout.tables.filter((t) => t.code !== code);
    layout.combos = layout.combos.filter((c) => !c.codes.includes(code));
    marked.delete(code);
    if (current === code) current = null;
    say(`Mesa ${code} apagada.`);
  }

  // ---- os pontos fixos da casa -----------------------------------------------------------------
  /** "Novo ponto": o tipo, e um nome (obrigatório para "outro"). */
  function pointSheet(area) {
    const form = { kind: "bar", name: "" };
    const sheet = openSheet({
      title: "Novo ponto",
      size: "narrow",
      isDirty: () => Boolean(form.name),
      view: (close, refresh) => {
        const submit = (event) => {
          event.preventDefault();
          const name = form.name.trim();
          if (form.kind === "other" && !name) return showFormErrors(event.currentTarget, { name: "Dê um nome ao ponto." });
          close({ kind: form.kind, name });
        };
        return html`<form class="ag-form" novalidate @submit=${submit}>
          <label class="field">
            <span class="field__label">Tipo</span>
            <select class="field__input" name="kind" @change=${(e) => ((form.kind = e.target.value), refresh())}>
              ${KINDS.map((k) => html`<option value=${k.kind} ?selected=${form.kind === k.kind}>${k.label}</option>`)}
            </select>
          </label>
          <label class="field">
            <span class="field__label">Nome ${form.kind === "other" ? nothing : html`<small>opcional</small>`}</span>
            <input class="field__input" name="name" autocomplete="off" maxlength="40" .value=${form.name} placeholder=${form.kind === "other" ? "Ex.: Telão" : kindLabel(form.kind)} @input=${(e) => (form.name = e.target.value)} />
          </label>
          <p class="ag-ajuda">Entra em ${nameOf(area)} e se move como uma mesa. Não tem lugares, não entra em junção e nunca recebe reserva.</p>
          <div class="dialog__actions">
            <button class="btn btn--outline" type="button" data-close>Voltar</button>
            <button class="btn" type="submit">Pôr na planta</button>
          </div>
        </form>`;
      },
    });
    return sheet.done;
  }

  async function addPoint(area = focusArea) {
    if (!confOf(area)) return say("Ponha uma área nesta planta antes de marcar pontos.");
    const chosen = await pointSheet(area);
    if (!chosen || !alive) return;
    const { cols, rows } = gridOf(confOf(area));
    const [w0, h0] = kindSize(chosen.kind);
    const w = Math.min(w0, cols);
    const h = Math.min(h0, rows);
    const point = { id: uuid(), kind: chosen.kind, name: chosen.name || kindLabel(chosen.kind), area, ...freeSpot(area, w, h), w, h };
    layout.fixtures.push(point);
    current = null;
    currentPoint = point.id;
    focusArea = area;
    if (tab === "desenho") focusPoint(point.id);
    say(`Ponto ${point.name} posto em ${nameOf(area)}.`);
  }

  async function removePoint(id) {
    const f = pointOf(id);
    if (!f) return;
    const ok = await confirmAction({ title: `Apagar o ponto ${fixtureName(f)}?`, message: "Ele sai do desenho desta planta. Nenhuma mesa nem reserva muda.", confirmLabel: "Apagar ponto", danger: true });
    if (!ok) return;
    layout.fixtures = layout.fixtures.filter((x) => x.id !== id);
    if (currentPoint === id) currentPoint = null;
    say(`Ponto ${fixtureName(f)} apagado.`);
  }

  /** Mantém uma peça dentro da sua área depois de mudar de tamanho ou de área. */
  function keepInside(item) {
    const conf = confOf(item.area);
    if (!conf) return;
    const [w, h] = sizeOf(item);
    const { cols, rows } = gridOf(conf);
    item.x = clamp(item.x, 0, Math.max(0, cols - w));
    item.y = clamp(item.y, 0, Math.max(0, rows - h));
  }

  /** Largura ou profundidade de um ponto, digitada em metros (meios metros), mantida dentro da área. */
  function resizePoint(f, key, value) {
    const n = Number(String(value ?? "").replace(",", "."));
    if (Number.isFinite(n) && n > 0) {
      const { cols, rows } = gridOf(confOf(f.area));
      f[key] = clamp(Math.round(n * 2), 1, key === "w" ? cols : rows);
      keepInside(f);
    }
    say(`${fixtureName(f)}: ${metersLabel(f.w / 2)} de largura por ${metersLabel(f.h / 2)} de fundo.`);
  }

  function join() {
    const codes = [...marked];
    if (codes.length < 2) return say("Marque pelo menos 2 mesas com Espaço para juntar.");
    if (layout.combos.some((c) => c.codes.length === codes.length && c.codes.every((x) => codes.includes(x)))) return say("Essas mesas já estão juntas.");
    const seats = codes.reduce((n, c) => n + (byCode(c)?.max_seats || 0), 0);
    layout.combos.push({ codes, max_seats: null, label: null });
    marked.clear();
    say(`${codes.join(" e ")} juntas, ${seats} lugares.`);
  }

  function rename(oldCode, value) {
    const code = value.trim().toUpperCase();
    const t = byCode(oldCode);
    if (!t) return;
    t.code = code;
    layout.combos.forEach((c) => (c.codes = c.codes.map((x) => (x === oldCode ? code : x))));
    if (marked.delete(oldCode)) marked.add(code);
    if (current === oldCode) current = code;
    draw();
  }

  // ---- as áreas desta planta -------------------------------------------------------------------
  function resize(conf, key, value) {
    conf[key] = meters(value, conf[key]);
    say(`${nameOf(conf.key)}: ${metersLabel(conf.width_m)} de largura por ${metersLabel(conf.depth_m)} de fundo.`);
  }

  function addArea(key) {
    const house = houseAreas.find((a) => a.key === key);
    if (!house || confOf(key)) return;
    layout.areas.push(layoutAreaFrom(house));
    focusArea = key;
    say(`${house.name} entrou nesta planta.`);
  }

  function removeArea(key) {
    if (layout.tables.some((t) => t.area === key) || layout.fixtures.some((f) => f.area === key)) return;
    layout.areas = layout.areas.filter((a) => a.key !== key);
    keepFocusArea();
    say(`${nameOf(key)} saiu desta planta.`);
  }

  async function newArea() {
    const result = await areaSheet({ title: "Nova área", withSize: true, send: (body) => api.createArea(body) });
    if (!result) return;
    const { area, ...size } = result;
    houseAreas = [...houseAreas.filter((a) => a.key !== area.key), area];
    layout.areas.push(layoutAreaFrom(area, size));
    focusArea = area.key;
    toast({ title: "Área criada", message: `${area.name} entra nesta planta quando você gravar.` });
    say(`${area.name} entrou nesta planta.`);
  }

  async function undoAll() {
    const ok = await confirmAction({ title: "Desfazer tudo?", message: "A planta volta a ser a última gravada. As áreas criadas continuam na casa.", confirmLabel: "Desfazer tudo", cancelLabel: "Continuar editando", danger: true });
    if (!ok) return;
    layout = JSON.parse(original);
    marked.clear();
    current = null;
    currentPoint = null;
    keepFocusArea();
    say("Mudanças desfeitas.");
  }

  // ---- arrastar (mesas e pontos fixos do mesmo jeito) ------------------------------------------
  let drag = null;
  const nameOfItem = (item) => item.code || fixtureName(item);
  const focusItem = (item) => (item.code ? focusTable(item.code) : focusPoint(item.id));

  function select(item) {
    current = item.code || null;
    currentPoint = item.code ? null : item.id;
    draw();
  }

  function pointerDown(event, item) {
    if (narrow() || event.button > 0) return;
    const node = event.currentTarget;
    node.setPointerCapture(event.pointerId);
    drag = { item, startX: event.clientX, startY: event.clientY, x: item.x, y: item.y, moved: false };
  }
  function pointerMove(event) {
    if (!drag) return;
    const item = drag.item;
    const [w, h] = sizeOf(item);
    const { cols, rows } = gridOf(confOf(item.area));
    const dx = Math.round((event.clientX - drag.startX) / (CELL * zoom));
    const dy = Math.round((event.clientY - drag.startY) / (CELL * zoom));
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 1) return;
    drag.moved = true;
    item.x = clamp(drag.x + dx, 0, Math.max(0, cols - w));
    item.y = clamp(drag.y + dy, 0, Math.max(0, rows - h));
    draw();
  }
  function pointerUp(event, item) {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (moved) say(`${nameOfItem(item)} na coluna ${item.x}, linha ${item.y}.`);
    else if (item.code && (event.ctrlKey || event.metaKey || event.shiftKey)) toggleMark(item.code);
    else select(item);
  }

  function toggleMark(code) {
    if (marked.has(code)) marked.delete(code);
    else marked.add(code);
    say(marked.has(code) ? `${code} marcada. ${plural(marked.size, "mesa marcada", "mesas marcadas")}.` : `${code} desmarcada.`);
  }

  function nodeKey(event, item) {
    const steps = event.shiftKey ? 5 : 1;
    const moves = { ArrowLeft: [-steps, 0], ArrowRight: [steps, 0], ArrowUp: [0, -steps], ArrowDown: [0, steps] };
    if (moves[event.key]) {
      event.preventDefault();
      const [w, h] = sizeOf(item);
      const { cols, rows } = gridOf(confOf(item.area));
      item.x = clamp(item.x + moves[event.key][0], 0, Math.max(0, cols - w));
      item.y = clamp(item.y + moves[event.key][1], 0, Math.max(0, rows - h));
      say(`${nameOfItem(item)} na coluna ${item.x}, linha ${item.y}.`);
      focusItem(item);
    } else if (event.key === " " && item.code) {
      event.preventDefault();
      toggleMark(item.code);
      focusTable(item.code);
    } else if (event.key === "Enter") {
      event.preventDefault();
      select(item);
      requestAnimationFrame(() => container.querySelector(".pl-ficha input, .pl-ficha select")?.focus());
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      if (item.code) removeTable(item.code);
      else removePoint(item.id);
    }
  }

  function editorKey(event) {
    if (narrow() || status !== "ready") return;
    const typing = event.target.closest("input, select, textarea");
    if (!typing && (event.key === "n" || event.key === "N") && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      addTable(byCode(current)?.area ?? pointOf(currentPoint)?.area ?? focusArea);
    }
  }

  // ---- salvar ---------------------------------------------------------------------------------
  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const errors = errorsOf(layout);
    if (Object.keys(errors).length) {
      tab = "lista";
      draw();
      return showFormErrors(form, errors, container.querySelector(".pl-erros"));
    }
    busy = true;
    draw();
    const body = { ...layout };
    try {
      // uma sessão que acaba aqui: a entrada abre por cima do desenho (client.js e identity.js)
      // e a mesma gravação vai de novo com a mesma versão lida
      const result = await save(id, body, version);
      if (result) {
        const saved = result.layout || result;
        take(saved);
        remember(`planta:${id}`, saved);
        original = JSON.stringify(layout);
        serverWarnings = result.warnings || [];
        savedLine = `Gravado · ${user?.name || "equipe"}, ${new Date().toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`;
        toast({ title: "Planta gravada", message: layout.name });
      }
    } catch (e) {
      if (e?.status === 422) {
        tab = "lista";
        busy = false;
        draw();
        return showFormErrors(form, e.fieldErrors, container.querySelector(".pl-erros"));
      }
      if (e?.status === 412) {
        busy = false;
        draw();
        return conflict(e);
      }
      toast({ title: "Não deu para gravar", message: `${errorText(e)} O desenho continua aqui.`, kind: "error" });
    }
    busy = false;
    draw();
  }

  // sair com mudanças pergunta antes (links do painel, e fechar a aba)
  const guardClick = async (event) => {
    const a = event.target instanceof Element ? event.target.closest("a[href^='/admin']") : null;
    if (!a || !dirty() || event.button !== 0 || event.metaKey || event.ctrlKey || a.closest("dialog")) return;
    event.preventDefault();
    event.stopPropagation();
    const ok = await confirmAction({ title: "Descartar as mudanças?", message: "O que você mudou nesta planta ainda não foi gravado.", confirmLabel: "Descartar", cancelLabel: "Continuar editando", danger: true });
    if (ok) {
      original = JSON.stringify(layout);
      navigate(a.pathname);
    }
  };
  const guardUnload = (event) => {
    if (!dirty()) return;
    event.preventDefault();
    event.returnValue = "";
  };
  const onNarrow = (e) => {
    small = e.matches;
    draw();
  };
  document.addEventListener("click", guardClick, true);
  window.addEventListener("beforeunload", guardUnload);
  narrowQuery.addEventListener("change", onNarrow);

  // ---- desenho --------------------------------------------------------------------------------
  /** Lugares de uma junção: o máximo que a casa definiu, ou a soma das mesas. */
  const comboSeats = (c) => c.max_seats ?? c.codes.reduce((n, code) => n + (byCode(code)?.max_seats || 0), 0);
  /** "S3 + S4 · 8 lugares", ou o nome próprio da junção: "Mesa da figueira · 8 lugares". */
  const comboText = (c) => `${c.label || c.codes.join(" + ")} · ${comboSeats(c)} lugares`;

  const tableNode = (t) => {
    const [w, h] = sizeOf(t);
    const joins = layout.combos.filter((c) => c.codes.includes(t.code));
    const joined = joins.length;
    const style = `left:${t.x * CELL}px;top:${t.y * CELL}px;width:${w * CELL}px;height:${h * CELL}px`;
    const joinWords = joins.map((c) => `${c.label ? `${c.label}: ` : ""}${c.codes.join(" e ")} juntas, ${comboSeats(c)} lugares`).join("; ");
    const label = `${t.code}, ${t.min_seats} a ${t.max_seats} lugares, coluna ${t.x}, linha ${t.y}${t.bookable_online ? "" : ", fora do site"}${joined ? `, ${joinWords}` : ""}`;
    const classes = `pl-mesa pl-mesa--${t.shape} ${current === t.code ? "is-atual" : ""} ${t.bookable_online ? "" : "is-fora"}`;
    const content = html`<b>${t.code}</b><span>${t.min_seats === t.max_seats ? t.max_seats : `${t.min_seats}–${t.max_seats}`}</span>${joined ? html`<i class="pl-mesa__junta" aria-hidden="true">+</i>` : nothing}`;
    if (narrow()) return html`<div class=${classes} style=${style} role="img" aria-label=${label}>${content}</div>`;
    return html`<button
      type="button"
      class=${classes}
      style=${style}
      data-code=${t.code}
      aria-pressed=${marked.has(t.code) ? "true" : "false"}
      aria-label=${label}
      @pointerdown=${(e) => pointerDown(e, t)}
      @pointermove=${pointerMove}
      @pointerup=${(e) => pointerUp(e, t)}
      @keydown=${(e) => nodeKey(e, t)}
    >${content}</button>`;
  };

  /** Um ponto fixo: ícone e nome num tom neutro, sem lugares; ele se move como uma mesa. */
  const pointNode = (f) => {
    const style = `left:${f.x * CELL}px;top:${f.y * CELL}px;width:${f.w * CELL}px;height:${f.h * CELL}px`;
    const name = fixtureName(f);
    const kind = kindLabel(f.kind);
    const label = `Ponto fixo: ${name}${f.kind !== "other" && name !== kind ? ` (${kind})` : ""}, ${metersLabel(f.w / 2)} por ${metersLabel(f.h / 2)}, coluna ${f.x}, linha ${f.y}`;
    const classes = `pl-ponto ${currentPoint === f.id ? "is-atual" : ""}`;
    const content = html`${fixtureIcon(f.kind)}<span class="pl-ponto__nome">${name}</span>`;
    if (narrow()) return html`<div class=${classes} style=${style} role="img" aria-label=${label}>${content}</div>`;
    return html`<button
      type="button"
      class=${classes}
      style=${style}
      data-ponto=${f.id}
      aria-label=${label}
      @pointerdown=${(e) => pointerDown(e, f)}
      @pointermove=${pointerMove}
      @pointerup=${(e) => pointerUp(e, f)}
      @keydown=${(e) => nodeKey(e, f)}
    >${content}</button>`;
  };

  /** Mesas juntadas como um grupo: um contorno em comum com o nome e os lugares (N17). */
  const comboOutline = (c) => {
    const rects = c.codes.map(byCode).map(rectOf);
    const x1 = Math.max(0, Math.min(...rects.map((r) => r.x1)) - 1);
    const y1 = Math.max(0, Math.min(...rects.map((r) => r.y1)) - 1);
    const x2 = Math.max(...rects.map((r) => r.x2)) + 1;
    const y2 = Math.max(...rects.map((r) => r.y2)) + 1;
    const style = `left:${x1 * CELL}px;top:${y1 * CELL}px;width:${(x2 - x1) * CELL}px;height:${(y2 - y1) * CELL}px`;
    return html`<div class="pl-grupo ${y1 === 0 ? "is-dentro" : ""}" style=${style} data-grupo=${c.codes.join("+")} aria-hidden="true"><span class="pl-grupo__nome">${comboText(c)}</span></div>`;
  };

  const areaBox = (conf) => {
    const name = nameOf(conf.key);
    const { cols, rows } = gridOf(conf);
    const tables = layout.tables.filter((t) => t.area === conf.key);
    const points = layout.fixtures.filter((f) => f.area === conf.key);
    // uma junção é desenhada onde todas as suas mesas estão nesta área
    const groups = layout.combos.filter((c) => c.codes.length && c.codes.every((code) => byCode(code)?.area === conf.key));
    const focused = !narrow() && conf.key === focusArea;
    const scale = narrow() ? 1 : zoom;
    return html`<section
      class="pl-area ${conf.mode === "closed" ? "is-fechada" : ""} ${focused ? "is-foco" : ""}"
      data-area=${conf.key}
      aria-label=${`${name}: ${plural(tables.length, "mesa", "mesas")}${points.length ? `, ${plural(points.length, "ponto fixo", "pontos fixos")}` : ""}, ${metersLabel(conf.width_m)} por ${metersLabel(conf.depth_m)}`}
      @focusin=${() => !narrow() && setFocusArea(conf.key)}
      @pointerdown=${() => !narrow() && setFocusArea(conf.key)}
    >
      <h3 class="pl-area__nome">
        ${name}${conf.mode === "list" ? ` · lista de ${conf.list_capacity || 0}` : conf.mode === "closed" ? " · fechada" : ""}
        <span class="pl-area__medida">· ${metersLabel(conf.width_m)} × ${metersLabel(conf.depth_m)}</span>
        ${focused ? html`<span class="pl-area__foco">· em foco</span>` : nothing}
      </h3>
      <div class="pl-quadro-rolagem" tabindex="0" role="region" aria-label=${`Desenho de ${name}`}>
        <div class="pl-quadro-medida" style=${`width:${cols * CELL * scale}px;height:${rows * CELL * scale}px`}>
          <div class="pl-quadro" style=${`width:${cols * CELL}px;height:${rows * CELL}px;transform:scale(${scale})`}>${groups.map(comboOutline)}${points.map(pointNode)}${tables.map(tableNode)}</div>
        </div>
      </div>
    </section>`;
  };

  const areaOptions = (selected) => layout.areas.map((a) => html`<option value=${a.key} ?selected=${a.key === selected}>${nameOf(a.key)}</option>`);

  /** Logo acima do desenho: nova mesa e nova área, o tamanho da área em foco, o zoom. */
  const toolbar = () => {
    if (narrow()) return nothing;
    const i = layout.areas.findIndex((a) => a.key === focusArea);
    const conf = layout.areas[i];
    const size = (key, label) => html`<label class="field pl-ferramentas__medida">
      <span class="field__label">${label}</span>
      <input
        class="field__input"
        type="number"
        name=${`areas.${i}.${key}`}
        min=${SIZE_MIN}
        max=${SIZE_MAX}
        step="0.5"
        inputmode="decimal"
        .value=${String(conf[key])}
        @change=${(e) => resize(conf, key, e.target.value)}
      />
    </label>`;
    return html`<div class="pl-ferramentas" role="group" aria-label="Ferramentas do desenho">
      ${conf
        ? html`<label class="field pl-ferramentas__area">
              <span class="field__label">Área em foco</span>
              <select class="field__input" @change=${(e) => setFocusArea(e.target.value)}>${areaOptions(focusArea)}</select>
            </label>
            ${size("width_m", "Largura (m)")}${size("depth_m", "Fundo (m)")}
            <button class="btn" type="button" @click=${() => addTable()}>Nova mesa</button>
            <button class="btn btn--outline" type="button" @click=${() => addPoint()}>Novo ponto</button>`
        : nothing}
      <button class="btn btn--outline" type="button" @click=${newArea}>Nova área</button>
      ${tab === "desenho"
        ? html`<div class="pl-zoom" role="group" aria-label="Zoom do desenho">
            ${ZOOMS.map((z) => html`<button class="btn btn--outline" type="button" aria-pressed=${zoom === z ? "true" : "false"} @click=${() => ((zoom = z), draw())}>${Math.round(z * 100)}%</button>`)}
          </div>`
        : nothing}
    </div>`;
  };

  /** A folha lateral de um ponto fixo: tipo, nome, área e tamanho em metros. */
  const pointFicha = (f) => {
    const changeKind = (kind) =>
      update(() => {
        // um nome que era só a palavra do tipo antigo acompanha o tipo novo
        if (!f.name || f.name === kindLabel(f.kind)) f.name = kind === "other" ? "" : kindLabel(kind);
        f.kind = kind;
      });
    return html`<div class="pl-ficha" aria-labelledby="pl-ficha-titulo">
      <h3 class="ag-secao" id="pl-ficha-titulo">Ponto fixo · ${fixtureName(f)}</h3>
      <div class="ag-grade pl-ficha__grade">
        <label class="field">
          <span class="field__label">Tipo</span>
          <select class="field__input" @change=${(e) => changeKind(e.target.value)}>${KINDS.map((k) => html`<option value=${k.kind} ?selected=${f.kind === k.kind}>${k.label}</option>`)}</select>
        </label>
        <label class="field"><span class="field__label">Nome</span><input class="field__input" maxlength="40" .value=${f.name || ""} placeholder=${f.kind === "other" ? "Ex.: Telão" : kindLabel(f.kind)} @input=${(e) => (f.name = e.target.value)} @change=${() => draw()} /></label>
        <label class="field">
          <span class="field__label">Área</span>
          <select class="field__input" @change=${(e) => update(() => ((f.area = e.target.value), keepInside(f)))}>${areaOptions(f.area)}</select>
        </label>
        <label class="field"><span class="field__label">Largura do ponto (m)</span><input class="field__input" type="number" min="0.5" step="0.5" inputmode="decimal" .value=${String(f.w / 2)} @change=${(e) => resizePoint(f, "w", e.target.value)} /></label>
        <label class="field"><span class="field__label">Fundo do ponto (m)</span><input class="field__input" type="number" min="0.5" step="0.5" inputmode="decimal" .value=${String(f.h / 2)} @change=${(e) => resizePoint(f, "h", e.target.value)} /></label>
      </div>
      <p class="ag-ajuda">Serve para a equipe se orientar no Salão e na folha da noite. Não tem lugares, não entra em junção, não conta na capacidade e nunca recebe reserva.</p>
      <div class="ag-acoes">
        <button class="btn btn--danger btn--sm" type="button" @click=${() => removePoint(f.id)}>Apagar ponto</button>
      </div>
    </div>`;
  };

  const ficha = () => {
    const point = pointOf(currentPoint);
    if (point) return pointFicha(point);
    const t = byCode(current);
    if (!t) return html`<div class="pl-ficha pl-ficha--vazia"><p>Toque numa mesa ou num ponto fixo para editar.</p></div>`;
    const set = (key, parse = (v) => v) => (e) => update(() => (t[key] = parse(e.target.type === "checkbox" ? e.target.checked : e.target.value)));
    const int = (v) => Number.parseInt(v, 10) || 0;
    const combos = layout.combos.filter((c) => c.codes.includes(t.code));
    return html`<div class="pl-ficha" aria-labelledby="pl-ficha-titulo">
      <h3 class="ag-secao" id="pl-ficha-titulo">Mesa ${t.code}</h3>
      <div class="ag-grade pl-ficha__grade">
        <label class="field"><span class="field__label">Código</span><input class="field__input" .value=${t.code} @change=${(e) => rename(t.code, e.target.value)} /></label>
        <label class="field">
          <span class="field__label">Área</span>
          <select class="field__input" @change=${set("area")}>${areaOptions(t.area)}</select>
        </label>
        <label class="field"><span class="field__label">Mínimo</span><input class="field__input" type="number" min="1" inputmode="numeric" .value=${String(t.min_seats)} @input=${set("min_seats", int)} /></label>
        <label class="field"><span class="field__label">Máximo</span><input class="field__input" type="number" min="1" inputmode="numeric" .value=${String(t.max_seats)} @input=${set("max_seats", int)} /></label>
        <label class="field">
          <span class="field__label">Forma</span>
          <select class="field__input" @change=${set("shape")}>${SHAPES.map(([v, l]) => html`<option value=${v} ?selected=${t.shape === v}>${l}</option>`)}</select>
        </label>
        <label class="field"><span class="field__label">Prioridade <small>1 = primeiro</small></span><input class="field__input" type="number" min="1" inputmode="numeric" .value=${String(t.priority ?? 1)} @input=${set("priority", int)} /></label>
      </div>
      <label class="ag-check"><input type="checkbox" .checked=${t.bookable_online} @change=${set("bookable_online")} /><span>Reservável pelo site</span></label>
      <p class="ag-ajuda">${t.bookable_online ? "O site oferece esta mesa." : "Fica para quem chega sem reserva e para a equipe."}</p>
      ${combos.length ? html`<p class="ag-ajuda">Em junção com: ${combos.map((c) => c.codes.filter((x) => x !== t.code).join(" + ")).join("; ")}</p>` : nothing}
      <div class="ag-acoes">
        <button class="btn btn--outline btn--sm" type="button" aria-pressed=${marked.has(t.code) ? "true" : "false"} @click=${() => toggleMark(t.code)}>${marked.has(t.code) ? "Desmarcar" : "Marcar para juntar"}</button>
        <button class="btn btn--danger btn--sm" type="button" @click=${() => removeTable(t.code)}>Apagar mesa</button>
      </div>
    </div>`;
  };

  const combosPanel = () => html`<section class="pl-juncoes" aria-labelledby="pl-juncoes-titulo">
    <h3 class="ag-secao" id="pl-juncoes-titulo">Mesas juntas</h3>
    <p class="ag-ajuda">Marque 2 ou mais mesas (toque com Ctrl, ou Espaço no teclado) e toque em Juntar. ${marked.size ? `Marcadas: ${[...marked].join(", ")}.` : ""}</p>
    <div class="ag-acoes">
      <button class="btn btn--sm" type="button" ?disabled=${narrow() || marked.size < 2} @click=${join}>Juntar${marked.size >= 2 ? ` ${marked.size} mesas` : ""}</button>
      ${marked.size ? html`<button class="btn btn--outline btn--sm" type="button" @click=${() => (marked.clear(), draw())}>Desmarcar</button>` : nothing}
    </div>
    ${layout.combos.length
      ? html`<ul class="pl-juncoes__lista">
          ${layout.combos.map((c, i) => {
            const seats = c.codes.reduce((n, code) => n + (byCode(code)?.max_seats || 0), 0);
            return html`<li>
              <b>${c.codes.join(" + ")}</b>
              <label class="field"><span class="field__label">Nome</span><input class="field__input" name=${`combos.${i}`} .value=${c.label || ""} placeholder="Ex.: Mesa comprida" ?disabled=${narrow()} @input=${(e) => (c.label = e.target.value || null)} @change=${() => draw()} /></label>
              <label class="field"><span class="field__label">Mínimo <small>pelo site</small></span><input class="field__input" type="number" min="1" inputmode="numeric" name=${`combos.${i}.min_seats`} .value=${c.min_seats ?? ""} placeholder="1" ?disabled=${narrow()} @input=${(e) => (c.min_seats = Number.parseInt(e.target.value, 10) || null)} @change=${() => draw()} /></label>
              <label class="field"><span class="field__label">Máximo <small>soma: ${seats}</small></span><input class="field__input" type="number" min="1" inputmode="numeric" name=${`combos.${i}.max_seats`} .value=${c.max_seats ?? ""} placeholder=${String(seats)} ?disabled=${narrow()} @input=${(e) => (c.max_seats = Number.parseInt(e.target.value, 10) || null)} @change=${() => draw()} /></label>
              ${narrow() ? nothing : html`<button class="action" type="button" @click=${() => update((l) => l.combos.splice(i, 1))} aria-label=${`Desfazer a junção ${c.codes.join(" + ")}`}>Desfazer</button>`}
            </li>`;
          })}
        </ul>`
      : html`<p class="ag-ajuda">Nenhuma junção nesta planta.</p>`}
  </section>`;

  /** "Áreas desta planta": como cada uma funciona aqui, e pôr ou tirar uma. */
  const areasPanel = () => {
    const outside = houseAreas.filter((a) => a.id && !confOf(a.key));
    const chosen = outside.find((a) => a.key === pickArea)?.key ?? outside[0]?.key;
    return html`<section class="pl-modos" aria-labelledby="pl-modos-titulo">
      <h3 class="ag-secao" id="pl-modos-titulo">Áreas desta planta</h3>
      <p class="ag-ajuda">Como cada área funciona quando esta planta vale. O tamanho de cada uma muda na barra acima do desenho.</p>
      <div class="pl-modos__grade">
        ${layout.areas.map((conf, i) => {
          const name = nameOf(conf.key);
          const count = layout.tables.filter((t) => t.area === conf.key).length;
          const points = layout.fixtures.filter((f) => f.area === conf.key).length;
          const holds = [count && plural(count, "mesa", "mesas"), points && plural(points, "ponto fixo", "pontos fixos")].filter(Boolean).join(" e ");
          return html`<div class="pl-modo">
            <label class="field">
              <span class="field__label">${name}</span>
              <select class="field__input" name=${`areas.${i}.mode`} ?disabled=${narrow()} @change=${(e) => update(() => (conf.mode = e.target.value))}>
                ${MODES.map(([v, l]) => html`<option value=${v} ?selected=${conf.mode === v}>${l}</option>`)}
              </select>
            </label>
            ${conf.mode === "list"
              ? html`<label class="field"><span class="field__label">Pessoas na lista</span><input class="field__input" name=${`areas.${i}.list_capacity`} type="number" min="1" inputmode="numeric" .value=${conf.list_capacity ?? ""} ?disabled=${narrow()} @input=${(e) => update(() => (conf.list_capacity = Number.parseInt(e.target.value, 10) || null))} /></label>`
              : nothing}
            ${conf.mode !== "closed"
              ? html`<label class="ag-check"><input type="checkbox" .checked=${conf.bookable_online !== false} ?disabled=${narrow()} @change=${(e) => update(() => (conf.bookable_online = e.target.checked))} /><span>Aparece no site</span></label>`
              : nothing}
            <p class="ag-ajuda">${modeHelp(conf)} ${metersLabel(conf.width_m)} × ${metersLabel(conf.depth_m)}.</p>
            ${narrow()
              ? nothing
              : holds
                ? html`<p class="ag-ajuda">Tem ${holds}: mude de área ou apague para tirar ${name} desta planta.</p>`
                : layout.areas.length === 1
                  ? html`<p class="ag-ajuda">A planta precisa de pelo menos uma área.</p>`
                  : html`<button class="action pl-modo__tirar" type="button" aria-label=${`Tirar ${name} desta planta`} @click=${() => removeArea(conf.key)}>Tirar desta planta</button>`}
          </div>`;
        })}
      </div>
      ${narrow()
        ? nothing
        : html`<div class="pl-modos__por">
            ${outside.length
              ? html`<label class="field">
                    <span class="field__label">Área da casa fora desta planta</span>
                    <select class="field__input" @change=${(e) => (pickArea = e.target.value)}>${outside.map((a) => html`<option value=${a.key} ?selected=${a.key === chosen}>${a.name}</option>`)}</select>
                  </label>
                  <button class="btn btn--outline" type="button" @click=${() => addArea(chosen)}>Pôr nesta planta</button>`
              : html`<p class="ag-ajuda">Todas as áreas da casa já estão nesta planta.</p>`}
            <button class="btn btn--outline" type="button" @click=${newArea}>Criar área</button>
          </div>`}
    </section>`;
  };

  /** Os pontos fixos numa tabela, na aba "Lista": os mesmos campos da folha lateral. */
  const pointsTable = () => {
    const dis = narrow();
    const int = (v) => Number.parseInt(v, 10) || 0;
    return html`<h3 class="ag-secao pl-lista-pontos" id="pl-pontos-titulo">Pontos fixos</h3>
      ${layout.fixtures.length
        ? html`<div class="table-wrap">
            <table class="data-table pl-tabela" aria-labelledby="pl-pontos-titulo">
              <thead><tr><th>Tipo</th><th>Nome</th><th>Área</th><th>Largura (m)</th><th>Fundo (m)</th><th>Coluna</th><th>Linha</th><th><span class="sr-only">Apagar</span></th></tr></thead>
              <tbody>
                ${layout.fixtures.map((f, i) => {
                  const name = fixtureName(f);
                  const n = `ponto ${i + 1}`;
                  return html`<tr class=${currentPoint === f.id ? "is-selected" : ""}>
                    <td><select class="field__input" name=${`fixtures.${i}.kind`} aria-label=${`Tipo do ${n}`} ?disabled=${dis} @change=${(e) => update(() => (f.kind = e.target.value))}>${KINDS.map((k) => html`<option value=${k.kind} ?selected=${f.kind === k.kind}>${k.label}</option>`)}</select></td>
                    <td><div class="field"><input class="field__input" name=${`fixtures.${i}.name`} maxlength="40" aria-label=${`Nome do ${n}`} .value=${f.name || ""} ?disabled=${dis} @input=${(e) => (f.name = e.target.value)} @change=${() => draw()} /></div></td>
                    <td><select class="field__input" name=${`fixtures.${i}.area`} aria-label=${`Área de ${name}`} ?disabled=${dis} @change=${(e) => update(() => ((f.area = e.target.value), keepInside(f)))}>${areaOptions(f.area)}</select></td>
                    <td><input class="field__input pl-num" type="number" min="0.5" step="0.5" name=${`fixtures.${i}.w`} aria-label=${`Largura de ${name} em metros`} .value=${String(f.w / 2)} ?disabled=${dis} @change=${(e) => resizePoint(f, "w", e.target.value)} /></td>
                    <td><input class="field__input pl-num" type="number" min="0.5" step="0.5" name=${`fixtures.${i}.h`} aria-label=${`Fundo de ${name} em metros`} .value=${String(f.h / 2)} ?disabled=${dis} @change=${(e) => resizePoint(f, "h", e.target.value)} /></td>
                    <td><input class="field__input pl-num" type="number" min="0" aria-label=${`Coluna de ${name}`} .value=${String(f.x)} ?disabled=${dis} @change=${(e) => update(() => ((f.x = int(e.target.value)), keepInside(f)))} /></td>
                    <td><input class="field__input pl-num" type="number" min="0" aria-label=${`Linha de ${name}`} .value=${String(f.y)} ?disabled=${dis} @change=${(e) => update(() => ((f.y = int(e.target.value)), keepInside(f)))} /></td>
                    <td>${dis ? nothing : html`<button class="action action--alert" type="button" aria-label=${`Apagar o ponto ${name}`} @click=${() => removePoint(f.id)}>Apagar</button>`}</td>
                  </tr>`;
                })}
              </tbody>
            </table>
          </div>`
        : html`<p class="ag-ajuda">Nenhum ponto fixo nesta planta. "Novo ponto" marca o bar, a cozinha, a entrada e o que ajuda a equipe a se orientar.</p>`}`;
  };

  const listTab = () => html`${tablesTable()}${pointsTable()}`;

  const tablesTable = () => html`<div class="table-wrap">
    <table class="data-table pl-tabela" aria-label="Mesas da planta">
      <thead><tr><th>Código</th><th>Área</th><th>Mín.</th><th>Máx.</th><th>Forma</th><th>Site</th><th>Prior.</th><th>Coluna</th><th>Linha</th><th><span class="sr-only">Apagar</span></th></tr></thead>
      <tbody>
        ${layout.tables.map((t, i) => {
          const set = (key, parse = (v) => v) => (e) => {
            t[key] = parse(e.target.type === "checkbox" ? e.target.checked : e.target.value);
          };
          const int = (v) => Number.parseInt(v, 10) || 0;
          const dis = narrow();
          const { cols, rows } = gridOf(confOf(t.area));
          return html`<tr class=${current === t.code ? "is-selected" : ""}>
            <td><div class="field"><input class="field__input pl-curto" name=${`tables.${i}.code`} aria-label=${`Código da mesa ${i + 1}`} .value=${t.code} ?disabled=${dis} @change=${(e) => rename(t.code, e.target.value)} /></div></td>
            <td><select class="field__input" name=${`tables.${i}.area`} aria-label=${`Área de ${t.code}`} ?disabled=${dis} @change=${(e) => update(() => (t.area = e.target.value))}>${areaOptions(t.area)}</select></td>
            <td><div class="field"><input class="field__input pl-num" type="number" min="1" name=${`tables.${i}.min_seats`} aria-label=${`Mínimo de ${t.code}`} .value=${String(t.min_seats)} ?disabled=${dis} @input=${set("min_seats", int)} @change=${() => draw()} /></div></td>
            <td><div class="field"><input class="field__input pl-num" type="number" min="1" name=${`tables.${i}.max_seats`} aria-label=${`Máximo de ${t.code}`} .value=${String(t.max_seats)} ?disabled=${dis} @input=${set("max_seats", int)} @change=${() => draw()} /></div></td>
            <td><select class="field__input" name=${`tables.${i}.shape`} aria-label=${`Forma de ${t.code}`} ?disabled=${dis} @change=${(e) => update(() => (t.shape = e.target.value))}>${SHAPES.map(([v, l]) => html`<option value=${v} ?selected=${t.shape === v}>${l}</option>`)}</select></td>
            <td><input type="checkbox" class="pl-caixa" aria-label=${`${t.code} reservável pelo site`} .checked=${t.bookable_online} ?disabled=${dis} @change=${(e) => update(() => (t.bookable_online = e.target.checked))} /></td>
            <td><input class="field__input pl-num" type="number" min="1" aria-label=${`Prioridade de ${t.code}`} .value=${String(t.priority ?? 1)} ?disabled=${dis} @input=${set("priority", int)} /></td>
            <td><input class="field__input pl-num" type="number" min="0" max=${cols} aria-label=${`Coluna de ${t.code}`} .value=${String(t.x)} ?disabled=${dis} @change=${(e) => update(() => (t.x = int(e.target.value)))} /></td>
            <td><input class="field__input pl-num" type="number" min="0" max=${rows} aria-label=${`Linha de ${t.code}`} .value=${String(t.y)} ?disabled=${dis} @change=${(e) => update(() => (t.y = int(e.target.value)))} /></td>
            <td>${dis ? nothing : html`<button class="action action--alert" type="button" aria-label=${`Apagar ${t.code}`} @click=${() => removeTable(t.code)}>Apagar</button>`}</td>
          </tr>`;
        })}
      </tbody>
    </table>
  </div>`;

  const tabButton = (key, label) => html`<button
    type="button"
    role="tab"
    class="tab"
    id=${`pl-aba-${key}`}
    aria-controls="pl-painel"
    aria-selected=${tab === key ? "true" : "false"}
    tabindex=${tab === key ? "0" : "-1"}
    @click=${() => ((tab = key), draw())}
    @keydown=${(e) => {
      if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
      tab = tab === "desenho" ? "lista" : "desenho";
      draw();
      requestAnimationFrame(() => container.querySelector(`#pl-aba-${tab}`)?.focus());
    }}
  >${label}</button>`;

  /** No pé da tela enquanto algo não foi salvo; nunca esconde o desenho de vez. */
  const saveBar = () => {
    const changed = dirty();
    return html`<div class="pl-gravar ${changed ? "is-sujo" : ""}" role="group" aria-label="Gravar a planta">
      <p class="pl-gravar__estado">${changed ? html`<b>Mudanças não gravadas.</b>` : "Tudo gravado."}</p>
      <div class="pl-gravar__acoes">
        ${changed ? html`<button class="btn btn--outline" type="button" ?disabled=${busy} @click=${undoAll}>Desfazer tudo</button>` : nothing}
        <button class="btn" type="submit" aria-busy=${busy ? "true" : "false"} ?disabled=${busy || !changed}>Ver o efeito e gravar</button>
      </div>
    </div>`;
  };

  function draw() {
    if (!alive) return;
    const back = html`<a class="ag-voltar" href="/admin/plantas">‹ Voltar às plantas</a>`;
    if (status !== "ready") {
      render(html`<div class="ag">${back}${status === "loading" ? loadingBlock("Abrindo a planta…") : errorBlock(error, load)}</div>`, container);
      return;
    }
    const warnings = [...warningsOf(layout), ...serverWarnings];
    const seats = layout.tables.reduce((n, t) => n + (confOf(t.area)?.mode === "tables" ? t.max_seats : 0), 0);
    render(
      html`<form class="ag pl-editor" novalidate @submit=${submit} @keydown=${editorKey}>
        ${back}
        <div class="pl-cabeca">
          <label class="field pl-cabeca__nome">
            <span class="field__label">Nome da planta</span>
            <input class="field__input" name="name" .value=${layout.name} ?disabled=${narrow()} @input=${(e) => (layout.name = e.target.value)} @change=${() => draw()} />
          </label>
          <label class="field pl-cabeca__desc">
            <span class="field__label">Para quando</span>
            <input class="field__input" name="description" .value=${layout.description || ""} ?disabled=${narrow()} @input=${(e) => (layout.description = e.target.value)} @change=${() => draw()} />
          </label>
        </div>
        ${layout.archived ? html`<div class="notice" role="status">Esta planta está arquivada: a Agenda não a oferece.</div>` : nothing}
        ${offline ? offlineNotice() : nothing}
        ${small ? html`<div class="notice notice--alert" role="status">Para editar a planta, use uma tela de 768 px ou mais. Aqui ela aparece só para leitura.</div>` : nothing}
        <div class="pl-erros"></div>
        <p class="ag-legenda">${plural(layout.areas.length, "área", "áreas")} · ${plural(layout.tables.length, "mesa", "mesas")} · ${seats} lugares em mesas${layout.fixtures.length ? ` · ${plural(layout.fixtures.length, "ponto fixo", "pontos fixos")}` : ""}${savedLine ? html` · <b>${savedLine}</b>` : nothing}</p>
        <div class="pl-barra-desenho">
          <div class="tabs tabs--row pl-abas" role="tablist" aria-label="Ver a planta">${tabButton("desenho", "Desenho")}${tabButton("lista", "Lista")}</div>
          ${toolbar()}
        </div>
        <div id="pl-painel" role="tabpanel" aria-labelledby=${`pl-aba-${tab}`} class="pl-painel">
          ${tab === "desenho"
            ? html`${narrow() ? nothing : html`<p class="ag-ajuda">Arraste as mesas. Com uma mesa em foco: setas movem 1 casa (0,5 m), Shift + seta 5 casas, Espaço marca para juntar, Enter edita, Delete apaga. N cria uma mesa nova na área em foco. Os pontos fixos (bar, cozinha, entrada…) se movem do mesmo jeito e não têm lugares.</p>`}
                <div class="pl-desenho">
                  <div class="pl-areas-quadro">
                    ${layout.areas.length ? layout.areas.map(areaBox) : html`<p class="notice">Esta planta ainda não tem área. Crie uma ou ponha uma área da casa.</p>`}
                  </div>
                  ${narrow() ? nothing : ficha()}
                </div>`
            : listTab()}
        </div>
        ${warnings.length
          ? html`<div class="notice notice--alert" role="status">
              <b>Atenção</b> <span class="ag-ajuda">(não impede gravar)</span>
              <ul class="pl-avisos">${warnings.map((w) => html`<li>${w}</li>`)}</ul>
            </div>`
          : nothing}
        ${areasPanel()}
        ${combosPanel()}
        ${narrow() ? nothing : saveBar()}
        <p class="sr-only" aria-live="polite">${message}</p>
      </form>`,
      container,
    );
  }

  load();
  return () => {
    alive = false;
    controller.abort();
    document.removeEventListener("click", guardClick, true);
    window.removeEventListener("beforeunload", guardUnload);
    narrowQuery.removeEventListener("change", onNarrow);
    render(nothing, container);
  };
}
