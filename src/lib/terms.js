// Os combinados da casa com os números das configurações: os textos trazem {tolerancia},
// {extra}, {prazo} e {faltas}, preenchidos pelas regras de reserva (o /house da API, ou a
// cópia do build em house.json). Mudar um número no painel muda todo texto que o mostra.

const KEYS = {
  tolerancia: (r) => r.tolerance_min,
  extra: (r) => r.extra_tolerance_min,
  prazo: (r) => r.cancel_until_hours,
  faltas: (r) => r.no_shows_for_confirmation,
};

export function fillTerms(text, rules = {}) {
  return String(text ?? "").replace(/\{(\w+)\}/g, (whole, key) => {
    const value = KEYS[key]?.(rules);
    return value == null ? whole : String(value);
  });
}

/** "20:00" mais minutos, no relógio (volta depois da meia-noite). */
export function addClock(time, minutes) {
  const [h, m] = time.split(":").map(Number);
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
