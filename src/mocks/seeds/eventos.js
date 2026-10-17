// Dados da demonstração de Eventos: uma noite do peixe já publicada (mesas no salão, uma lista no quintal,
// com nomes nela), uma festa fechada com a lista da própria casa, a noite de samba do mês passado
// com quem veio, para duplicar, e uma noite futura de mesas, de lista e de entrada livre
// (história 7.3: um evento de cada modo). Os dados iniciais básicos mantêm o rascunho "Forró no quintal".
import { uuid } from "../../lib/uuid.js";
import { addReservation, demoDates } from "./agenda.js";

export function extend(state, now) {
  const dates = demoDates(state, now);
  const eventLayout = state.layouts.find((l) => l.name.startsWith("Evento no quintal"))?.id ?? null;
  const common = { ends_at: null, image_id: null, price_cents: null, requires_approval: false, version: "v1", translations: {} };

  const fish = {
    ...common,
    id: uuid(),
    title: "Noite do peixe",
    date: dates.fish,
    starts_at: "19:30",
    ends_at: "23:30",
    description: "Peixe fresco da fronteira, para dividir na mesa. Mesas no salão e lista por pessoa no quintal.",
    published: true,
    booking_mode: "mixed",
    list_capacity: 40,
    entry_times: ["19:30", "20:30"],
    party_max: 8,
    layout_id: eventLayout,
    day_plan: { opens_at: "19:00", closes_at: "23:30" },
    internal_note: "Pedir 18 kg de pintado para quinta de manhã.",
    translations: { es: { title: "Noche del pescado", description: "" }, en: { title: "", description: "" } },
  };
  const party = {
    ...common,
    id: uuid(),
    title: "Aniversário de 40 anos da Fernanda",
    date: dates.private,
    starts_at: "20:00",
    ends_at: "01:00",
    description: "Festa fechada para convidados.",
    published: true,
    booking_mode: "private",
    private_label: { pt: "Festa fechada", es: "Fiesta privada", en: "Private party" },
    list_capacity: 60,
    entry_times: ["20:00"],
    party_max: null,
    layout_id: eventLayout,
    day_plan: null,
    internal_note: "Sinal combinado por fora. Bolo chega às 19h pela lateral.",
  };
  const samba = {
    ...common,
    id: uuid(),
    title: "Roda de samba no quintal",
    date: dates.pastEvent,
    starts_at: "20:00",
    ends_at: "23:00",
    description: "Roda de samba com o grupo Pé na Fronteira. Lista por pessoa no quintal.",
    published: true,
    booking_mode: "list",
    list_capacity: 40,
    entry_times: ["20:00", "21:00"],
    party_max: 6,
    layout_id: eventLayout,
    day_plan: null,
    internal_note: "Casa cheia. Repetir no mês que vem.",
  };
  // uma noite futura de cada outro modo, para todo jeito de reservar um evento aparecer na demonstração:
  // mesas como sempre, uma lista por pessoa, e entrada livre (sem reserva nenhuma)
  const taken = new Set([dates.fish, dates.private, dates.rain, dates.held, dates.maintenance]);
  const [tablesDate, listDate, freeDate] = dates.open.slice(14).filter((d) => !taken.has(d));
  const tables = {
    ...common,
    id: uuid(),
    title: "Noite do ramen",
    date: tablesDate,
    starts_at: "19:00",
    description: "Ramen de porco com caldo de doze horas, só nesta noite. Mesas como sempre, na planta do salão.",
    published: true,
    booking_mode: "tables",
    list_capacity: null,
    entry_times: [],
    party_max: 8,
    layout_id: null,
    day_plan: null,
    internal_note: "O caldo começa na véspera, às 7h.",
    translations: { es: { title: "Noche del ramen", description: "" }, en: { title: "Ramen night", description: "" } },
  };
  const listNight = {
    ...common,
    id: uuid(),
    title: "Sessão de vinil no quintal",
    date: listDate,
    starts_at: "20:00",
    description: "Discos da casa no toca-discos do quintal. Lista por pessoa, sem escolher mesa.",
    published: true,
    booking_mode: "list",
    list_capacity: 40,
    entry_times: ["20:00", "21:00"],
    party_max: 6,
    layout_id: eventLayout,
    day_plan: null,
    internal_note: "Trazer os discos do Marcus na quarta.",
    translations: { es: { title: "Sesión de vinilo en el patio", description: "" }, en: { title: "", description: "" } },
  };
  const free = {
    ...common,
    id: uuid(),
    title: "Roda de choro na calçada",
    date: freeDate,
    starts_at: "19:30",
    description: "Roda de choro aberta, na frente da casa. Não precisa reservar: é só chegar.",
    published: true,
    booking_mode: "none",
    free_label: { pt: "Entrada livre, é só chegar", es: "Entrada libre, solo vení", en: "Free entry, just come by" },
    list_capacity: null,
    entry_times: [],
    party_max: null,
    layout_id: null,
    day_plan: null,
    internal_note: "Avisar os vizinhos na semana.",
  };
  state.events.push(fish, party, samba, ...[tables, listNight, free].filter((e) => e.date));

  // a lista do quintal da noite do peixe e algumas mesas no salão
  const fishList = [
    ["Helena Sato", 4, "19:30"], ["Rogério Campos", 2, "19:30"], ["Tatiane Lopes", 6, "19:30"], ["Igor Fukuda", 3, "20:30"],
    ["Vanessa Rocha", 2, "20:30"], ["Wagner Ishii", 5, "20:30"],
  ];
  for (const [name, size, time] of fishList) addReservation(state, now, { name, size, time, date: dates.fish, area: "quintal", eventId: fish.id });
  addReservation(state, now, { name: "Sérgio Akamine", size: 4, time: "20:00", tables: ["S1"], date: dates.fish });
  addReservation(state, now, { name: "Bianca Freitas", size: 2, time: "20:30", tables: ["S5"], date: dates.fish });

  // a festa fechada: a casa escreve a lista
  const guests = [
    ["Fernanda Kobayashi", 2], ["Família Moretti", 5], ["Turma da faculdade", 12], ["Gisele e Paulo", 2], ["Equipe do escritório", 8], ["Tio Arnaldo", 3],
  ];
  for (const [name, size] of guests) addReservation(state, now, { name, size, time: "20:00", date: dates.private, area: "quintal", eventId: party.id, source: "staff" });

  // o samba do mês passado: quem veio (e dois que não vieram)
  const came = [
    ["Rita Kawamura", 4], ["Daniel Brito", 2], ["Lívia Esteves", 6], ["Murilo Assis", 2], ["Karina Shimizu", 3], ["Fábio Nunes", 4], ["Clara Ventura", 2],
  ];
  for (const [name, size] of came) addReservation(state, now, { name, size, time: "20:00", date: dates.pastEvent, area: "quintal", eventId: samba.id, status: "completed" });
  addReservation(state, now, { name: "Hugo Salles", size: 2, time: "21:00", date: dates.pastEvent, area: "quintal", eventId: samba.id, status: "no_show" });
}
