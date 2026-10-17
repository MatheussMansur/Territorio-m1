// O endereço de uma página de evento: "Noite do peixe de sexta" → "noite-do-peixe-de-sexta".
// Usado pelo build (uma página por evento), pela API simulada e pela agenda ao vivo do site.
export function slugify(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/** A noite a que um instante pertence: até 05:00 a noite anterior ainda é "hoje" (NFR-27). */
export const NIGHT_ENDS_AT = 5;
