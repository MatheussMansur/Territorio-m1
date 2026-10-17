// A galeria (histórias 3.7 e 3.8): as fotos que já estão em public/img/fotos, com os textos
// alternativos do site aprovado e onde cada uma aparece. As fotos usadas pelo cardápio são achadas
// ao vivo pela rota (category.photo); os lugares do próprio site estão listados aqui.
import { addDays, houseParts } from "../../lib/dates.js";
import { uuid } from "../../lib/uuid.js";
import CONTENT from "../../content/content.json" with { type: "json" };
import IMAGES from "../../content/images.json" with { type: "json" };

// para que o site usa cada foto, de content.json (capa, a casa, destaques, "Ambiente")
function siteUsages() {
  const uses = {};
  const add = (key, use) => key && (uses[key] ||= new Set()).add(use);
  add(CONTENT.cover.photo, "site:capa");
  add(CONTENT.cover.photo_mobile, "site:capa-celular");
  add(CONTENT.about.photo, "site:casa");
  for (const h of CONTENT.highlights) add(h.photo, "site:destaques");
  for (const g of CONTENT.gallery) add(g.photo, "site:ambiente");
  return uses;
}

function alts() {
  const out = { capa: CONTENT.cover.photo_alt.pt, "capa-cel": CONTENT.cover.photo_alt.pt, salao: CONTENT.about.photo_alt.pt };
  for (const h of CONTENT.highlights) out[h.photo] ||= h.alt.pt;
  for (const g of CONTENT.gallery) out[g.photo] = g.alt.pt;
  // faz01 e poster-ramen ficam sem descrição, para a demonstração mostrar o aviso
  out["capa-m"] = "Fachada do Território à noite, em pé, para o celular";
  out["menu-ramen"] = "Folha preta do cardápio de ramen, com os quatro caldos";
  return out;
}

const AREAS = {
  capa: "Fachada", "capa-cel": "Fachada", "capa-m": "Fachada", placa: "Fachada", janela: "Fachada",
  salao: "Salão", balcao: "Balcão", quintal: "Quintal", bandeirinhas: "Quintal",
  cozinha: "Cozinha", fogo: "Cozinha", equipe: "Cozinha",
  mesa: "Pratos", ramen: "Pratos", oniguiri: "Pratos", prato: "Pratos", faz01: "Pratos",
  "menu-ramen": "Cardápio", "poster-ramen": "Cardápio",
};

const CREDITS = { equipe: "Larissa Okamoto", balcao: "Larissa Okamoto", quintal: "Larissa Okamoto", bandeirinhas: "Larissa Okamoto" };

export function extend(state, now) {
  const today = houseParts(now).date;
  const uses = siteUsages();
  const alt = alts();
  const order = [...new Set([...CONTENT.gallery.map((g) => g.photo), ...Object.keys(IMAGES)])];
  state.images = order
    .filter((key) => IMAGES[key])
    .map((key, i) => {
      const img = IMAGES[key];
      return {
        id: uuid(),
        key,
        original_name: `${key.toUpperCase().replace(/-/g, "_")}_${String(4100 + i * 13)}.jpg`,
        width: img.width,
        height: img.height,
        bytes: Math.round(img.width * img.height * 0.31),
        focal_x: 0.5,
        focal_y: key.startsWith("capa") ? 0.62 : 0.5,
        alt: alt[key] || "",
        credit: CREDITS[key] || "Acervo da casa",
        area: AREAS[key] || "",
        site_usages: [...(uses[key] || [])],
        variants: ["avif", "webp", "jpg"].flatMap((format) => img.widths.map((width) => ({ format, width, url: `/img/fotos/${key}-${width}.${format}` }))),
        placeholder: img.placeholder,
        status: "ready",
        sort: i,
        uploaded_at: new Date(`${addDays(today, -20 + (i % 6))}T1${i % 9}:30:00-03:00`).toISOString(),
        uploaded_by: i % 3 ? "Marcus Norberto" : "Gerente da casa",
      };
    });
}
