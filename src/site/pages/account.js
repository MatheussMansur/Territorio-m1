// /minhas-reservas/ (também em /es/ e /en/): moldura impressa; /src/pages/minhas-reservas.js desenha a página.
import { clientePagina } from "./cliente-pagina.js";

export function account({ house, locale, t }) {
  return clientePagina({ house, locale, t, route: "/minhas-reservas/", title: t("cliente.page.mine"), script: "/src/pages/minhas-reservas.js", slug: "minhas-reservas", link: false });
}
