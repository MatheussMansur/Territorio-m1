// Horas das páginas públicas, um formato por idioma, guardado no catálogo de textos
// (site.timeHour para horas cheias, site.timeFull para as outras): "19h" e "23h30", "19 h" e
// "23:30 h", "7:00 pm" e "8:30 pm". Usado pelo build (render.js) e pelas partes ao vivo das
// páginas, para a hora impressa no HTML e a hora que o script escreve ficarem iguais.
//
// Marcadores do padrão: H (0–23), HH, h (1–12), mm, a (am/pm); [texto] é escrito como está.
const TOKEN = /\[([^\]]*)\]|HH|H|h|mm|a/g;

export function applyPattern(pattern, hours, minutes) {
  const values = {
    HH: String(hours).padStart(2, "0"),
    H: String(hours),
    h: String(((hours + 11) % 12) + 1),
    mm: String(minutes).padStart(2, "0"),
    a: hours < 12 ? "am" : "pm",
  };
  return String(pattern).replace(TOKEN, (match, literal) => (literal !== undefined ? literal : values[match]));
}

/** "19:30" + o t() do idioma da página → a hora como o site escreve. */
export function formatTime(hhmm, t) {
  const [hours, minutes] = String(hhmm || "").split(":").map(Number);
  if (!Number.isFinite(hours)) return "";
  return applyPattern(t(minutes ? "site.timeFull" : "site.timeHour"), hours, minutes || 0);
}
