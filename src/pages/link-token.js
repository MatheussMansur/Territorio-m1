// O token de um link de mensagem: /confirmar/<token> como a mensagem do WhatsApp manda, ou
// /confirmar/?t=<token> (a forma que a hospedagem estática serve sem reescrita).
export function linkToken() {
  const query = new URLSearchParams(location.search).get("t");
  if (query) return query;
  const parts = location.pathname.split("/").filter(Boolean);
  const last = parts.at(-1);
  return parts.length >= 2 && !["r", "confirmar", "espera"].includes(last) ? last : null;
}
