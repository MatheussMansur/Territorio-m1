/** 5000 → "R$ 50"; 1250 → "R$ 12,50"; null → o rótulo, ex.: "a confirmar". */
export function formatPrice(cents, label = "a confirmar") {
  if (cents == null) return label;
  const reais = cents / 100;
  const hasCents = cents % 100 !== 0;
  return "R$ " + reais.toLocaleString("pt-BR", { minimumFractionDigits: hasCents ? 2 : 0, maximumFractionDigits: 2 });
}
