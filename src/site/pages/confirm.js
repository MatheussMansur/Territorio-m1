// /confirmar/ (também em /es/ e /en/): moldura impressa; /src/pages/confirmar.js desenha a página.
import { clientePagina } from "./cliente-pagina.js";

export function confirm({ house, locale, t }) {
  return clientePagina({ house, locale, t, route: "/confirmar/", title: t("cliente.page.confirm"), script: "/src/pages/confirmar.js", slug: "confirmar", link: true });
}
