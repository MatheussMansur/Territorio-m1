// /entrar/ (também em /es/ e /en/): moldura impressa; /src/pages/entrar.js desenha a página.
import { clientePagina } from "./cliente-pagina.js";

export function signin({ house, locale, t }) {
  return clientePagina({ house, locale, t, route: "/entrar/", title: t("cliente.page.signin"), script: "/src/pages/entrar.js", slug: "entrar", link: false });
}
