// /espera/ (também em /es/ e /en/): moldura impressa; /src/pages/espera.js desenha a página.
import { clientePagina } from "./cliente-pagina.js";

export function waitlist({ house, locale, t }) {
  return clientePagina({ house, locale, t, route: "/espera/", title: t("cliente.page.waitlist"), script: "/src/pages/espera.js", slug: "espera", link: true });
}
