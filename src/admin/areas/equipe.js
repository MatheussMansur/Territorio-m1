// Equipe (histórias 1.9 e 1.15), só do dono: as pessoas da casa em /admin/equipe e
// as permissões por área em /admin/equipe/permissoes.
import "./equipe.css";
import { mountPermissions } from "./equipe/permissoes.js";
import { mountPeople } from "./equipe/pessoas.js";

export async function mount(container, context) {
  if (context.sub === "permissoes") return mountPermissions(container, context);
  return mountPeople(container, context);
}
