// A galeria (histórias 3.7 e 3.8). Os envios são "processados" aqui do jeito que o servidor vai fazer:
// a foto é redesenhada (o que tira os metadados) num JPEG pequeno guardado no banco da simulação.
// Onde uma foto é usada vem dos lugares do site (dados iniciais) e, ao vivo, do cardápio e dos eventos.
// Toda mudança vai para o registro de ações (defeito 14) com a pessoa, o aparelho e o antes e depois.
import { http, HttpResponse } from "msw";
import { uuid } from "../../../lib/uuid.js";
import { getState, save } from "../../db.js";
import { currentRole, mockNow, problem, respond } from "../../scenario.js";
import { extend } from "../../seeds/galeria.js";
import { actor, changesOf, logAction, sessionGone } from "./site.js";

const API = "/api/v1";
const MAX_BYTES = 15 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp"];

function load() {
  const now = mockNow();
  const state = getState(now);
  if (!state.images) {
    // um banco da simulação gravado antes de esta área existir: acrescenta os dados dela uma vez
    extend(state, now);
    save();
  }
  return state;
}

const forbidden = () => problem(403, "forbidden", "Essa parte é de outro perfil da equipe", { detail: "Só o dono e o gerente mexem na galeria." });
const notFound = () => problem(404, "not_found", "Essa foto não existe mais");

/** Todo lugar onde a foto aparece: "site:capa", "menu:Ramen", "event:Forró no quintal". */
function usages(state, image) {
  const out = [...(image.site_usages || [])];
  for (const c of state.menu_draft || state.menu || []) {
    if (c.image_id === image.id || (image.key && c.photo === image.key)) out.push(`menu:${c.name}`);
  }
  for (const e of state.events || []) if (e.image_id === image.id) out.push(`event:${e.title}`);
  return out;
}

// ?mock=preparando: uma foto enviada agora fica "preparando" (sem versões) por esse tempo, como
// o servidor leva um momento para fazer as versões AVIF, WebP e JPG (história 3.7, N18)
const PREPARING_MS = 45_000;
const preparingWanted = () => new URLSearchParams(window.location.search).get("mock") === "preparando";

/** Uma foto cujas versões já deveriam estar prontas fica pronta (pelo relógio real: ?agora= fica parado). */
function settle(image) {
  if (image.status === "processing" && image.ready_at && Date.now() >= Date.parse(image.ready_at)) {
    image.status = "ready";
    image.variants = image.pending_variants || image.variants;
    delete image.pending_variants;
    delete image.ready_at;
    return true;
  }
  return false;
}

/**
 * A recusa image_not_ready quando uma foto ainda sem versões é colocada em algum lugar do site
 * (aqui o cardápio; os eventos conferem do mesmo jeito), ou null.
 */
export function imageNotReady(state, imageId) {
  if (!imageId) return null;
  const image = (state.images || []).find((i) => i.id === imageId);
  if (!image) return null;
  if (settle(image)) save();
  if (image.status === "ready" && image.variants?.length) return null;
  return problem(409, "image_not_ready", "A foto ainda está sendo preparada", { errors: [{ field: "image_id", message: "A foto ainda está sendo preparada." }] });
}

function view(state, image) {
  const out = { ...image, usages: usages(state, image) };
  delete out.site_usages;
  delete out.pending_variants;
  return out;
}

/** O trabalho do servidor, feito na página: confere o tipo, redesenha pequena e sem metadados. */
async function processFile(file) {
  if (!(file instanceof Blob)) return { error: problem(422, "validation", "Falta a foto", { errors: [{ field: "file", message: "Escolha uma foto." }] }) };
  if (file.size > MAX_BYTES) return { error: problem(413, "upload_too_large", "Arquivo grande demais", { max_mb: 15 }) };
  const name = file.name || "foto.jpg";
  if (!TYPES.includes(file.type) || /\.hei[cf]$/i.test(name)) return { error: problem(415, "upload_type", "Tipo de arquivo não aceito") };
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { error: problem(415, "upload_type", "Tipo de arquivo não aceito") };
  }
  const scale = Math.min(1, 720 / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const [r, g, b] = ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
  const url = canvas.toDataURL("image/jpeg", 0.72);
  const placeholder = `#${[r, g, b].map((v) => Math.round(v * 0.4).toString(16).padStart(2, "0")).join("")}`;
  const result = { name, width: bitmap.width, height: bitmap.height, bytes: file.size, url, small: canvas.width, placeholder };
  bitmap.close?.();
  return { result };
}

const variantsOf = (p) => ["avif", "webp", "jpg"].flatMap((format) => [480, 960, 1600].map((width) => ({ format, width, url: p.url })));

export const handlers = [
  http.get(`${API}/staff/images`, () =>
    respond((scenario) => {
      const state = load();
      if (scenario === "vazio") return HttpResponse.json([]);
      if (state.images.map(settle).some(Boolean)) save();
      return HttpResponse.json([...state.images].sort((a, b) => a.sort - b.sort).map((img) => view(state, img)));
    }),
  ),

  http.post(`${API}/staff/images`, async ({ request }) => {
    const form = await request.formData().catch(() => null);
    return respond(async () => {
      if (!currentRole()) return sessionGone();
      if (currentRole() === "floor") return forbidden();
      const alt = String(form?.get("alt") || "").trim();
      const { error, result } = await processFile(form?.get("file"));
      if (error) return error;
      if (!alt) return problem(422, "validation.alt_text", "Falta descrever a foto", { errors: [{ field: "alt", message: "Escreva em poucas palavras o que aparece." }] });
      const state = load();
      state.images.forEach((img) => (img.sort += 1));
      const image = {
        id: uuid(),
        key: null,
        original_name: result.name,
        width: result.width,
        height: result.height,
        bytes: result.bytes,
        focal_x: 0.5,
        focal_y: 0.5,
        alt: alt.slice(0, 160),
        credit: String(form.get("credit") || "").trim().slice(0, 60),
        area: String(form.get("area") || "").trim().slice(0, 30),
        site_usages: [],
        variants: variantsOf(result),
        placeholder: result.placeholder,
        status: "ready",
        sort: 0,
        ...(preparingWanted() ? { status: "processing", variants: [], pending_variants: variantsOf(result), ready_at: new Date(Date.now() + PREPARING_MS).toISOString() } : {}),
        uploaded_at: mockNow().toISOString(),
        uploaded_by: actor(state),
      };
      state.images.unshift(image);
      logAction(state, { action: "image.upload", entity_type: "image", entity_id: image.id, summary: `Galeria: enviou a foto “${image.alt}”`, changes: changesOf({}, { alt: image.alt, credit: image.credit, area: image.area }) });
      save();
      return HttpResponse.json(view(state, image), { status: 201 });
    });
  }),

  http.patch(`${API}/staff/images/:id`, async ({ params, request }) => {
    const body = await request.json().catch(() => ({}));
    return respond(() => {
      if (!currentRole()) return sessionGone();
      if (currentRole() === "floor") return forbidden();
      const state = load();
      const image = state.images.find((i) => i.id === params.id);
      if (!image) return notFound();
      const before = { alt: image.alt, credit: image.credit, area: image.area, focal_x: image.focal_x, focal_y: image.focal_y, posicao: image.sort + 1 };
      if ("alt" in body && !String(body.alt || "").trim()) {
        return problem(422, "validation.alt_text", "Falta descrever a foto", { errors: [{ field: "alt", message: "Escreva em poucas palavras o que aparece." }] });
      }
      if ("alt" in body) image.alt = String(body.alt).trim().slice(0, 160);
      if ("credit" in body) image.credit = String(body.credit || "").trim().slice(0, 60);
      if ("area" in body) image.area = String(body.area || "").trim().slice(0, 30);
      for (const key of ["focal_x", "focal_y"]) if (typeof body[key] === "number") image[key] = Math.min(1, Math.max(0, body[key]));
      if (Number.isInteger(body.sort)) {
        const rest = state.images.filter((i) => i !== image).sort((a, b) => a.sort - b.sort);
        rest.splice(Math.max(0, Math.min(rest.length, body.sort)), 0, image);
        rest.forEach((img, i) => (img.sort = i));
      }
      const after = { alt: image.alt, credit: image.credit, area: image.area, focal_x: image.focal_x, focal_y: image.focal_y, posicao: image.sort + 1 };
      const changes = changesOf(before, after);
      if (Object.keys(changes).length) {
        const moved = Object.keys(changes).length === 1 && changes.posicao;
        logAction(state, {
          action: moved ? "image.order" : "image.update",
          entity_type: "image",
          entity_id: image.id,
          summary: moved ? `Galeria: mudou a ordem de “${image.alt || image.original_name}”` : `Galeria: editou a foto “${image.alt || image.original_name}”`,
          changes,
        });
      }
      save();
      return HttpResponse.json(view(state, image));
    });
  }),

  http.delete(`${API}/staff/images/:id`, ({ params }) =>
    respond(() => {
      if (currentRole() === "floor") return forbidden();
      const state = load();
      const image = state.images.find((i) => i.id === params.id);
      if (!image) return notFound();
      const used = usages(state, image);
      if (used.length) return problem(409, "conflict", "Essa foto está em uso", { usages: used, count: used.length });
      state.images = state.images.filter((i) => i !== image);
      state.images.sort((a, b) => a.sort - b.sort).forEach((img, i) => (img.sort = i));
      logAction(state, { action: "image.delete", entity_type: "image", entity_id: image.id, summary: `Galeria: apagou a foto “${image.alt || image.original_name}”`, changes: { alt: { from: image.alt || null, to: null } } });
      save();
      return new HttpResponse(null, { status: 204 });
    }),
  ),

  http.put(`${API}/staff/images/:id/file`, async ({ params, request }) => {
    const form = await request.formData().catch(() => null);
    return respond(async () => {
      if (currentRole() === "floor") return forbidden();
      const state = load();
      const image = state.images.find((i) => i.id === params.id);
      if (!image) return notFound();
      const before = image.original_name;
      const { error, result } = await processFile(form?.get("file"));
      if (error) return error;
      // todo lugar mantém a foto; texto alternativo e crédito ficam até alguém editar
      Object.assign(image, {
        original_name: result.name,
        width: result.width,
        height: result.height,
        bytes: result.bytes,
        variants: variantsOf(result),
        placeholder: result.placeholder,
        focal_x: 0.5,
        focal_y: 0.5,
        uploaded_at: mockNow().toISOString(),
        uploaded_by: actor(state),
      });
      logAction(state, { action: "image.replace", entity_type: "image", entity_id: image.id, summary: `Galeria: trocou o arquivo da foto “${image.alt || image.original_name}”, mantendo os lugares`, changes: { file: { from: before, to: result.name } } });
      save();
      return HttpResponse.json(view(state, image));
    });
  }),
];
