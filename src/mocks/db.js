// O "banco de dados" da simulação: dados iniciais montados para hoje, guardados no localStorage para
// a demonstração sobreviver a um recarregamento. Um dia novo (ou "Recomeçar dados" na barra da demonstração) cria tudo de novo.
import { houseParts } from "../lib/dates.js";
import { local } from "../lib/storage.js";
import { buildSeeds } from "./seeds.js";

const KEY = "territorio:mock-db";
const VERSION = 9; // 2: plantas, planos do dia e eventos; 3: regras de atraso e modelos de combinados; 4: áreas do painel; 5: os dados de exemplo delas; 6: entrada da demonstração admin/admin; 7: pontos fixos, eventos em todos os modos; 8: avisos da equipe num só lugar (central de avisos); 9: chaves de integração de medição e monitor
let state = null;

// Cada área do painel acrescenta seus próprios dados de exemplo em src/mocks/seeds/<area>.js, exportando
// extend(state, now); os dados iniciais básicos ficam em seeds.js.
const EXTENDERS = Object.entries(import.meta.glob("./seeds/*.js", { eager: true }))
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, m]) => m.extend)
  .filter(Boolean);

function seed(now) {
  const fresh = buildSeeds(now);
  for (const extend of EXTENDERS) extend(fresh, now);
  fresh.version = VERSION;
  return fresh;
}

// outra aba do mesmo navegador gravou (o dono aprovando o aparelho aberto nesta aqui):
// a próxima leitura pega os dados gravados em vez da cópia desta aba
window.addEventListener("storage", (event) => {
  if (event.key === KEY) state = null;
});

export function getState(now = new Date()) {
  if (state && state.seeded_for === houseParts(now).date) return state;
  const saved = local.get(KEY);
  if (saved?.version === VERSION && saved.seeded_for === houseParts(now).date) {
    state = saved;
  } else {
    state = seed(now);
    save();
  }
  return state;
}

export function save() {
  if (state) local.set(KEY, state);
}

export function resetState(now = new Date()) {
  state = seed(now);
  save();
  return state;
}
