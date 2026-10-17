// Clientes (histórias 5.14 a 5.18): a lista com busca, a ficha do cliente em
// /admin/clientes/<id> e, para o dono, os pedidos de privacidade em /admin/clientes/pedidos.
import "./clientes.css";
import { mountCard } from "./clientes/ficha.js";
import { mountList } from "./clientes/lista.js";
import { mountRequests } from "./clientes/pedidos.js";

export async function mount(container, context) {
  if (context.sub === "pedidos") return mountRequests(container, context);
  if (context.sub) return mountCard(container, { ...context, id: context.sub.split("/")[0] });
  return mountList(container, context);
}
