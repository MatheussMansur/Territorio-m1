// A galeria: enviar, descrever, trocar e apagar fotos (histórias 3.7 e 3.8).
import { del, get, patch, post, put } from "./client.js";

export const images = (options) => get("/staff/images", options);

/** Uma foto de um lote; o texto alternativo vai junto (obrigatório). */
export function upload(file, { alt, credit = "", area = "" }) {
  const body = new FormData();
  body.append("file", file);
  body.append("alt", alt);
  body.append("credit", credit);
  body.append("area", area);
  return post("/staff/images", body, { timeout: 60_000 });
}

export const update = (id, body) => patch(`/staff/images/${id}`, body);
export const remove = (id) => del(`/staff/images/${id}`);

/** Um arquivo novo para uma foto em uso: todo lugar continua mostrando ela. */
export function replaceFile(id, file) {
  const body = new FormData();
  body.append("file", file);
  return put(`/staff/images/${id}/file`, body, { timeout: 60_000 });
}
