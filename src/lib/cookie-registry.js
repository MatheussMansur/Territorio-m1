// Todo cookie e toda chave de armazenamento do navegador que o sistema usa, numa lista só (a LGPD trata os dois
// do mesmo jeito: "cookies e tecnologias semelhantes"). Nada grava um nome que não esteja aqui
// (tests/unit/cookies.test.mjs). O aviso, a tabela de cookies da política de privacidade e o
// Set-Cookie do servidor leem esta lista.
//
// Categorias:
//   necessary   sempre ligado: a página não funciona sem ele, ou a pessoa pediu
//               (o tema que escolheu, a sessão depois de entrar). Sem perfil pessoal.
//   remember    "Lembrar de mim": os dados da própria pessoa guardados neste aparelho para preencher a
//               próxima reserva. Só depois de um sim; nunca sai do aparelho.
//   measurement "Medição": como o site é usado (páginas, os passos da reserva, dias e
//               horários preferidos). Só depois de um sim; próprio da casa, sem nome, sem telefone, sem terceiros.
//
// kind: "cookie" (vai até o servidor da casa), "storage" (fica neste navegador).
// by: "page" (gravado pelo script da página) ou "server" (Set-Cookie, httpOnly, __Host-).

export const CATEGORIES = ["necessary", "remember", "measurement"];

const DAY = 86_400;

export const COOKIES = [
  {
    name: "__Host-trt_sessao",
    kind: "cookie",
    by: "server",
    category: "necessary",
    maxAge: null, // acaba quando o navegador fecha; 90 dias com "Lembrar este aparelho" (FR, sessão)
    purpose: {
      pt: "Mantém você conectado depois do código do WhatsApp. Até fechar o navegador, ou 90 dias se você pedir para lembrar o aparelho.",
      es: "Te mantiene conectado después del código de WhatsApp. Hasta cerrar el navegador, o 90 días si pedís recordar el dispositivo.",
      en: "Keeps you signed in after the WhatsApp code. Until the browser closes, or 90 days if you ask to remember the device.",
    },
  },
  {
    name: "__Host-trt_equipe",
    kind: "cookie",
    by: "server",
    category: "necessary",
    maxAge: null, // a sessão da equipe: acaba quando o navegador fecha ou quando a pessoa sai do aparelho
    purpose: {
      pt: "Mantém a pessoa da equipe conectada no painel da casa. Só existe nos aparelhos da casa.",
      es: "Mantiene conectada a la persona del equipo en el panel de la casa. Solo existe en los dispositivos de la casa.",
      en: "Keeps a staff member signed in to the house's panel. It only exists on the house's devices.",
    },
  },
  {
    name: "__Host-trt_aparelho",
    kind: "cookie",
    by: "server",
    category: "necessary",
    maxAge: 365 * DAY,
    purpose: {
      pt: "Identifica um aparelho da equipe já aprovado pelo dono (painel, tablet do salão). Não existe no celular dos clientes.",
      es: "Identifica un dispositivo del equipo ya aprobado por el dueño. No existe en el celular de los clientes.",
      en: "Identifies a staff device already approved by the owner. It never exists on customers' phones.",
    },
  },
  {
    name: "trt_consent",
    kind: "cookie",
    by: "page",
    category: "necessary",
    maxAge: 365 * DAY,
    purpose: {
      pt: "Guarda a sua escolha sobre cookies, para não perguntar de novo a cada página. 12 meses.",
      es: "Guarda tu elección sobre cookies, para no preguntar de nuevo en cada página. 12 meses.",
      en: "Keeps your cookie choice, so we don't ask again on every page. 12 months.",
    },
  },
  {
    name: "trt_tema",
    kind: "cookie",
    by: "page",
    category: "necessary",
    maxAge: 365 * DAY,
    purpose: {
      pt: "Lembra o tema claro ou escuro que você escolheu no botão do topo. 12 meses.",
      es: "Recuerda el tema claro u oscuro que elegiste en el botón de arriba. 12 meses.",
      en: "Remembers the light or dark theme you picked at the top. 12 months.",
    },
  },
  {
    name: "trt_lingua",
    kind: "cookie",
    by: "page",
    category: "necessary",
    maxAge: 365 * DAY,
    purpose: {
      pt: "Lembra a língua que você escolheu para o site (português, espanhol ou inglês), para não sugerir de novo. 12 meses.",
      es: "Recuerda el idioma que elegiste para el sitio (portugués, español o inglés), para no sugerirlo de nuevo. 12 meses.",
      en: "Remembers the language you chose for the site (Portuguese, Spanish or English), so we don't suggest it again. 12 months.",
    },
  },
  {
    name: "trt:lembrar",
    kind: "storage",
    by: "page",
    category: "remember",
    maxAge: 180 * DAY,
    purpose: {
      pt: "Seu nome, seu WhatsApp e quantas pessoas costumam vir, para a próxima reserva já vir preenchida. Fica só neste aparelho. 6 meses.",
      es: "Tu nombre, tu WhatsApp y cuántas personas suelen venir, para que la próxima reserva ya venga completa. Queda solo en este dispositivo. 6 meses.",
      en: "Your name, your WhatsApp and how many people usually come, so the next booking is already filled in. It stays on this device only. 6 months.",
    },
  },
  {
    name: "trt_vis",
    kind: "cookie",
    by: "page",
    category: "measurement",
    maxAge: 365 * DAY,
    purpose: {
      pt: "Número aleatório que conta quem volta ao site, sem saber quem é. 12 meses.",
      es: "Número al azar que cuenta quién vuelve al sitio, sin saber quién es. 12 meses.",
      en: "A random number that counts who comes back, without knowing who it is. 12 months.",
    },
  },
  {
    name: "trt_visita",
    kind: "cookie",
    by: "page",
    category: "measurement",
    maxAge: 30 * 60,
    purpose: {
      pt: "Junta as páginas e os passos da reserva de uma mesma visita. Some depois de 30 minutos parado.",
      es: "Junta las páginas y los pasos de la reserva de una misma visita. Desaparece después de 30 minutos sin uso.",
      en: "Groups the pages and booking steps of one visit. Gone after 30 minutes idle.",
    },
  },
  {
    name: "trt:medida",
    kind: "storage",
    by: "page",
    category: "measurement",
    maxAge: null,
    purpose: {
      pt: "Fila das medições ainda não enviadas (por exemplo, sem internet). Esvazia ao enviar.",
      es: "Fila de mediciones todavía no enviadas (por ejemplo, sin internet). Se vacía al enviar.",
      en: "Queue of measurements not sent yet (for example, offline). Empties once sent.",
    },
  },
];

export const byName = (name) => COOKIES.find((c) => c.name === name) || null;
