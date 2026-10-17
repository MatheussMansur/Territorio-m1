// A tabela de descrição de toda tela de configurações: seções, grupos e as suas linhas. Cada linha
// diz como se chama nas palavras da casa, o que faz e qual controle a edita; os
// limites e as opções vêm do `meta` do servidor, nunca daqui. As telas são montadas
// a partir desta tabela, então todo grupo se comporta do mesmo jeito. `also` guarda os sinônimos que a busca usa.

export const SECTIONS = [
  { key: "casa", label: "A casa" },
  { key: "reservas", label: "Reservas e recepção" },
  { key: "site", label: "Site" },
  { key: "sistema", label: "Sistema" },
];

// seções que chegam com os próximos módulos: mostradas apagadas, nunca abrem
export const LOCKED_SECTIONS = [
  { label: "Operação", module: "Módulo 3", what: "comanda, cozinha e bar, caixa, Pix" },
  { label: "Nota fiscal", module: "Módulo 4", what: "NFC-e e perfis tributários" },
  { label: "Financeiro", module: "Módulo 5", what: "plano de contas, contas bancárias" },
  { label: "Lojinha", module: "Módulo 6", what: "checkout, frete, retirada, estoque" },
];

export const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
export const LANGS = [
  { key: "pt", label: "PT", name: "português" },
  { key: "es", label: "ES", name: "espanhol" },
  { key: "en", label: "EN", name: "inglês" },
];

// ---- como os valores se leem -------------------------------------------------------------------

export function minutes(value) {
  if (value == null) return "";
  if (value < 60) return `${value} min`;
  const h = Math.floor(value / 60);
  const m = value % 60;
  return m ? `${h} h ${m}` : `${h} h`;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// ---- linhas ------------------------------------------------------------------------------

const step = (key, label, help, unit, extra = {}) => ({ type: "stepper", key, label, help, unit, ...extra });
const toggle = (key, label, help, extra = {}) => ({ type: "toggle", key, label, help, on: "Sim", off: "Não", ...extra });
const seg = (key, label, help, labels, extra = {}) => ({ type: "segmented", key, label, help, labels, ...extra });
const time = (key, label, help, extra = {}) => ({ type: "time", key, label, help, ...extra });
const field = (key, label, help, extra = {}) => ({ type: "text", key, label, help, ...extra });
const words = (key, label, help, extra = {}) => ({ type: "localized", key, label, help, ...extra });
const fixed = (label, value, help = "", extra = {}) => ({ type: "fixed", label, value, help, ...extra });
const locked = (label, help, module = "Módulo 3") => ({ type: "locked", label, help, module });
const note = (text, link) => ({ type: "note", text, link });
// a tabela única da casa para o fim da tolerância (história 2.12), a mesma do Salão
const toleranceTable = () => ({ type: "tolerance" });
const custom = (kind, key, label, help, extra = {}) => ({ type: kind, key, label, help, ...extra });

const hours = (v) => (v == null ? "" : `${v} h`);

/** @type {Record<string, any>} */
export const GROUPS = {
  casa: {
    api: "house",
    label: "Casa",
    section: "casa",
    site: true,
    intro: "Nome, endereço e contatos que o site, as mensagens e o Google mostram.",
    blocks: [
      {
        title: "Nome e assinatura",
        rows: [
          field("name", "Nome público", "Aparece no site, nas mensagens e no comprovante.", { also: ["nome da casa", "título"] }),
          words("tagline", "Assinatura", "A frase curta embaixo do nome, nas três línguas.", { also: ["slogan", "frase"] }),
        ],
      },
      {
        title: "Onde fica",
        rows: [custom("address", "address", "Endereço", "Com latitude e longitude para o mapa e o Google.", { also: ["mapa", "rua", "localização", "cep"] })],
      },
      {
        title: "Contatos",
        rows: [
          custom("phone", "whatsapp", "WhatsApp da casa", "Escolha o país e escreva o número com DDD. É para onde vai quem quer falar com a casa.", { also: ["telefone", "celular", "zap"] }),
          field("instagram", "Instagram da casa", "O link do perfil.", { input: "url", also: ["rede social"] }),
          field("shop_url", "Link da lojinha", "Vazio, o site não mostra a lojinha.", { input: "url", nullable: true, empty: "desligado", also: ["loja", "lojinha"] }),
        ],
      },
      {
        title: "Rodapé",
        rows: [
          toggle("legal_footer.enabled", "Razão social e CNPJ no rodapé", "Liga quando a casa vender pelo site.", { on: "Ligado", off: "Desligado", also: ["cnpj", "razão social"] }),
          field("legal_footer.legal_name", "Razão social", "Como está no CNPJ.", { when: (d) => d.legal_footer?.enabled }),
          field("legal_footer.cnpj", "CNPJ", "14 números.", { input: "numeric", when: (d) => d.legal_footer?.enabled }),
        ],
      },
      {
        title: "Fixo",
        rows: [
          fixed("Fuso", () => "Horário de Brasília (America/Sao_Paulo)", "", { also: ["fuso horário"] }),
          fixed("Virada da noite", (d) => `${d.night_cutoff}: o que passa da meia-noite conta como a noite anterior`, "", { also: ["madrugada"] }),
        ],
      },
    ],
  },

  horarios: {
    api: "hours",
    label: "Horários",
    section: "casa",
    site: true,
    intro: "A semana padrão da casa. O site, a reserva e o Google leem daqui, sem horário digitado em dois lugares.",
    blocks: [
      {
        title: "Semana padrão",
        rows: [custom("week", "week", "Dias e horários", "Abertura e fechamento de cada dia. O fechamento pode passar da meia-noite.", { paths: ["week", "closed_labels"], also: ["abertura", "fechamento", "dias abertos", "funcionamento", "horário"] })],
      },
      {
        title: "Feriados e dias especiais",
        rows: [custom("exceptions", "exceptions", "Dias que fogem da semana padrão", "As datas gravadas na Agenda, dos próximos dois meses. Cada uma muda na própria data.", { also: ["feriado", "exceção", "dia especial", "agenda"] })],
      },
      {
        title: "Mais",
        rows: [
          seg("max_shifts_per_day", "Turnos por dia", "Dois turnos servem para abrir no almoço também.", { 1: "Um turno", 2: "Dois turnos" }, { also: ["almoço", "turno"] }),
          toggle("confirmed", "Horário confirmado com a casa", "Desligado, o site mostra o horário com “a confirmar”.", { on: "Confirmado", off: "A confirmar" }),
          note("Feriados e dias especiais na Agenda, dia a dia.", { href: "/admin/agenda", label: "Abrir a Agenda" }),
        ],
      },
    ],
  },

  acesso: {
    api: "access",
    label: "Acesso",
    section: "casa",
    ownerOnly: true,
    reauth: true,
    intro: "Quanto tempo as sessões duram e quando a recepção pede o PIN de novo. Gravar pede a sua senha.",
    blocks: [
      {
        title: "Sessões",
        rows: [
          step("session_hours", "Sessão no computador", "Depois disso, a pessoa entra de novo. Vale para as próximas sessões.", "h", { also: ["sessão", "login", "entrar"] }),
          step("remember_days", "“Manter conectado neste aparelho”", "Quantos dias o aparelho lembra da pessoa.", "dias", { also: ["lembrar", "conectado"] }),
          step("reception_idle_min", "Inatividade da recepção", "Sem uso, o aparelho volta para a tela dos nomes. É o padrão de aparelho novo; cada um guarda o seu.", "min", { also: ["inatividade", "bloqueio", "pin"] }),
        ],
      },
      {
        title: "Regras fixas",
        rows: [
          fixed("PIN", () => "Os 4 últimos dígitos do telefone da pessoa", "", { also: ["pin", "senha"] }),
          fixed("Tentativas de PIN", (d) => `${d.pin_max_attempts} tentativas; depois trava ${d.pin_lock_min} min`, "", { also: ["pin travado"] }),
          fixed("Código do aplicativo", () => "Dono e gerente entram com senha e o código do aplicativo", "", { also: ["totp", "senha", "dois fatores", "2fa"] }),
          fixed("Confirmar que é você", (d) => `Ações sensíveis pedem a senha de novo; vale ${d.reauth_valid_min} min`, "", { also: ["senha"] }),
          locked("Inatividade do garçom e do caixa", "Chega com a comanda e o caixa."),
        ],
      },
    ],
  },

  avisos: {
    api: "alerts",
    label: "Avisos à equipe",
    section: "casa",
    intro: "Quem da equipe recebe cada aviso na central do painel (o sino). Os avisos à equipe saem só pelo painel, sem WhatsApp e sem e-mail. Os avisos do site para o cliente ficam em Site.",
    blocks: [
      {
        title: "Quem recebe",
        rows: [
          custom("people", "pending_to", "Reserva pendente", "Quem decide os pedidos que esperam a casa.", { also: ["pendente", "aprovar"] }),
          custom("people", "late_request_to", "Pedido em cima da hora", "Reserva feita pouco antes do horário.", { also: ["em cima da hora", "última hora"] }),
          custom("people", "privacy_request_to", "Pedido de dados do cliente", "Quando um cliente pede os dados dele (LGPD).", { also: ["lgpd", "dados"] }),
          custom("people", "security_to", "PIN travado e aparelho novo", "Segurança. PIN travado e aparelho sem chave são críticos: aparecem mesmo no silêncio.", { also: ["segurança", "pin", "aparelho"] }),
          custom("people", "system_to", "Alertas do sistema", "Fila parada, limite de mensagens, Google, cópias. Envio bloqueado e fila parada são críticos.", { also: ["sistema", "erro"] }),
        ],
      },
      {
        title: "Silêncio",
        rows: [
          time("quiet_from", "Silêncio começa", "Nesse período, só os avisos críticos contam no sino; o resto espera a manhã.", { also: ["silêncio", "madrugada", "noite"] }),
          time("quiet_to", "Silêncio termina", "Os críticos (sistema fora, aparelho sem chave, PIN travado, pedido vencendo) aparecem mesmo no silêncio."),
          locked("Impressora sem resposta e caixa com diferença", "Chegam com a comanda e o caixa."),
        ],
      },
    ],
  },

  "aparelhos-e-impressoras": {
    api: null,
    label: "Aparelhos e impressoras",
    section: "casa",
    ownerOnly: true,
    devices: true,
    intro: "Os aparelhos da casa que abrem o painel com PIN. Aprove com o código da tela do aparelho.",
    also: ["tablet", "computador", "pareamento", "parear", "impressora", "aparelho"],
  },

  aparencia: {
    api: "appearance",
    label: "Aparência",
    section: "casa",
    readOnly: true,
    intro: "As cores e as fontes vêm do arquivo de tokens. Para trocar, fale com o suporte.",
    blocks: [{ title: "Paleta e fontes", rows: [custom("appearance", "palette", "Papel e ferro", "", { also: ["cores", "paleta", "fonte", "tema escuro", "tema"] })] }],
  },

  reservas: {
    api: "booking",
    label: "Reservas",
    section: "reservas",
    preview: "terms",
    intro: "Tudo aqui muda a reserva pelo site. Os números aparecem sozinhos nos combinados e nas mensagens. Antes de gravar, mostramos quem é afetado.",
    blocks: [
      {
        title: "Quando dá pra reservar",
        rows: [
          toggle("online_enabled", "Reserva pelo site", "Desligada, o site mostra “reservas pelo WhatsApp”.", {
            on: "Ligada",
            off: "Desligada",
            confirmOff: () => ({
              title: "Desligar a reserva online?",
              message: "O site passa a mostrar “reservas pelo WhatsApp”. As reservas já feitas continuam.",
              label: "Desligar a reserva online",
            }),
            also: ["reserva online", "site"],
          }),
          step("window_days", "Até quantos dias à frente", "O cliente reserva no máximo com essa antecedência.", "dias", { also: ["janela", "antecedência máxima"] }),
          step("min_lead_min", "Antecedência mínima", "Ninguém reserva para daqui a menos que isso.", "min", { format: minutes, also: ["antecedência"] }),
          time("first_arrival", "Primeiro horário de chegada", "Recalcula as reservas: passa pela simulação.", { also: ["horário"] }),
          time("last_arrival", "Último horário de chegada", "Precisa caber no horário aberto de cada dia."),
          seg("slot_interval_min", "Intervalo entre horários", "De quanto em quanto tempo o cliente escolhe a chegada.", { 15: "15 min", 30: "30 min", 60: "60 min" }, { also: ["intervalo", "horários"] }),
        ],
      },
      {
        title: "Tempo e tolerância",
        rows: [
          step("tolerance_min", "Tolerância de atraso", "Depois disso, sem aviso, a mesa deixa de ser prioridade do cliente.", "min", { also: ["atraso", "tolerância", "espera a mesa"] }),
          step("extra_tolerance_min", "A mais para quem avisou", "Quem toca “Vou atrasar um pouco” no lembrete. O extra não soma de novo.", "min", { also: ["atraso", "vou atrasar"] }),
          seg("after_tolerance", "Depois da tolerância", "Quem age no fim da tolerância é escolhido em Salão.", { lose_priority: "Perde a prioridade", release: "Libera a mesa" }, { also: ["no-show", "não veio"] }),
          toleranceTable(),
          toggle("late_notice_enabled", "Cliente pode avisar que atrasa", "Mostra “Vou atrasar um pouco” no lembrete e no comprovante.", { also: ["avisar atraso"] }),
          step("duration_min", "Tempo de mesa", "Quanto a reserva ocupa a mesa. Pode variar por dia e por tamanho do grupo.", "min", { format: minutes, nullLabel: "livre", also: ["tempo de mesa", "duração", "giro"] }),
          custom("weekdayMinutes", "duration_by_weekday", "Tempo de mesa por dia", "“Livre” deixa a mesa sem limite naquele dia.", { also: ["tempo de mesa", "livre"] }),
          custom("durationRules", "duration_rules", "Tempo de mesa por tamanho de grupo", "Grupos maiores podem ficar mais.", { also: ["grupo grande"] }),
        ],
      },
      {
        title: "Cancelar e remarcar",
        rows: [
          step("cancel_until_hours", "Avisar com antecedência de", "Aparece nos combinados como “até 2 h antes”.", "h", { format: hours, also: ["cancelamento", "cancelar", "prazo"] }),
          toggle("customer_can_reschedule", "Cliente remarca pela conta", "Só até o prazo acima.", { also: ["remarcar", "mudar"] }),
          seg("customer_can_cancel_late", "Cancelar depois do prazo", "Conta como “em cima da hora”, sem multa.", { true: "Pelo link", false: "Só pelo WhatsApp" }, { also: ["cancelar"] }),
        ],
      },
      {
        title: "Limites",
        rows: [
          step("party_max_online", "Pessoas por reserva no site", "Acima disso, o cliente segue o caminho do grupo grande.", "pessoas", { also: ["grupo", "máximo de pessoas"] }),
          seg("large_group_action", "Caminho do grupo grande", "O que o site oferece para quem passa do máximo.", { whatsapp: "WhatsApp da casa", request: "Pedido no painel" }, { also: ["grupo grande", "aniversário"] }),
          step("max_active_per_phone", "Reservas futuras por telefone", "Quantas reservas ativas um mesmo número pode ter.", "reservas", { also: ["limite por cliente"] }),
          step("max_covers_per_slot", "Pessoas por horário", "Vazio é sem limite. O plano do dia pode mudar numa data.", "pessoas", { nullLabel: "sem limite", also: ["lotação", "capacidade"] }),
          step("max_covers_night", "Pessoas na noite", "Vazio é sem limite.", "pessoas", { nullLabel: "sem limite", also: ["lotação", "capacidade"] }),
          step("few_left_pct", "“Últimas mesas” a partir de", "Quanto sobra da capacidade do horário para o site avisar.", "%", { also: ["últimas mesas"] }),
          step("late_request_alert_hours", "Pedido em cima da hora", "Reserva feita com menos que isso avisa a casa.", "h", { format: hours, also: ["em cima da hora"] }),
          toggle("google_login", "Entrar com Google", "O cliente pode entrar com a conta Google além do WhatsApp.", { also: ["google", "login"] }),
          fixed("Uma reserva ativa por cliente, dia e horário", () => "Sempre", "", { also: ["duplicada"] }),
        ],
      },
    ],
  },

  combinados: {
    api: "terms",
    label: "Combinados",
    section: "reservas",
    preview: "terms",
    intro: "O que o cliente aceita antes de confirmar. Os números vêm de Reservas. Cada gravação cria uma versão nova.",
    blocks: [
      {
        title: "Os itens",
        rows: [custom("terms", "items", "Itens dos combinados", "De 1 a 6 itens, até 240 caracteres. Use {tolerancia}, {extra}, {prazo}, {faltas} e {tempo}.", { also: ["regras", "termos", "combinado"] })],
      },
      {
        title: "Aceite",
        rows: [
          toggle("show_duration_item", "Mostrar o tempo de mesa", "Acrescenta “A mesa é de vocês por {tempo}”.", { also: ["tempo de mesa"] }),
          words("accept_label", "Texto do botão de aceite", "O cliente vê na língua da página.", { also: ["aceite", "botão"] }),
        ],
      },
      { title: "Versões", rows: [custom("versions", "version", "Versões", "Quem reservou numa versão continua com ela.", { also: ["versão"] })] },
    ],
  },

  "aprovacao-e-faltas": {
    api: "approval_no_shows",
    label: "Aprovação e faltas",
    section: "reservas",
    preview: "pending",
    intro: "Quais reservas a casa confirma à mão e como tratar quem faltou, sem acusar ninguém.",
    blocks: [
      {
        title: "Aprovação",
        rows: [
          seg("approval_mode", "Como a reserva é confirmada", "Por regra: só os casos abaixo esperam a casa.", { auto: "Automática", manual: "Tudo pela casa", rules: "Por regra" }, { also: ["aprovação", "confirmar", "pendente"] }),
          step("rule_party_over", "Grupo acima de", "Pedidos maiores que isso esperam a casa.", "pessoas", { when: (d) => d.approval_mode === "rules", also: ["grupo grande"] }),
          step("pending_expiry_hours", "O pendente vence em", "Ou 30 min antes do horário, o que vier primeiro. Pedido feito no silêncio dos avisos começa a contar às 09:00.", "h", { format: hours, also: ["vencimento", "expira"] }),
        ],
      },
      {
        title: "Faltas",
        rows: [
          toggle("rule_no_shows_enabled", "Quem faltou passa pela casa", "As próximas reservas de quem faltou ficam pendentes.", { on: "Ligada", off: "Desligada", also: ["falta", "no-show", "não veio"] }),
          step("rule_no_shows_count", "A partir de quantas faltas", "", "faltas", { when: (d) => d.rule_no_shows_enabled }),
          step("rule_no_shows_window_months", "Nos últimos", "", "meses", { when: (d) => d.rule_no_shows_enabled }),
          step("undo_no_show_hours", "Desfazer o “Não veio” até", "Vale para o marcado à mão e para o automático.", "h", { format: hours, also: ["desfazer", "não veio"] }),
          note("Perdoar uma falta é feito na ficha do cliente.", { href: "/admin/clientes", label: "Abrir Clientes" }),
          note("“Evento pede aprovação” é escolhido em cada evento.", { href: "/admin/eventos", label: "Abrir Eventos" }),
        ],
      },
      {
        title: "Mensagem",
        rows: [words("pending_message", "Mensagem do pendente", "A mesma para qualquer pendente; nunca cita a falta. {hora} vira o horário-limite.", { multiline: true, also: ["mensagem", "pendente"] })],
      },
    ],
  },

  espera: {
    api: "waitlist",
    label: "Lista de espera",
    section: "reservas",
    intro: "Como a mesa que vaga chega a quem espera. Quem deixa a oferta vencer volta ao fim da fila do mesmo horário; quem recusa sai da fila desse horário.",
    blocks: [
      {
        title: "Espera",
        rows: [
          toggle("online_enabled", "Lista de espera pelo site", "Horário cheio oferece a fila.", {
            on: "Ligada",
            off: "Desligada",
            confirmOff: (ctx) => ({
              title: "Desligar a lista de espera?",
              message: `${plural(ctx.waitlist_today ?? 0, "pessoa está", "pessoas estão")} na fila hoje e ${ctx.waitlist_today === 1 ? "continua" : "continuam"} nela. Só não entra ninguém novo pelo site.`,
              label: "Desligar a lista de espera",
            }),
            also: ["fila", "espera"],
          }),
          step("offer_min", "Tempo para aceitar a oferta", "Quando a mesa vaga, a pessoa tem esse tempo para aceitar.", "min", { also: ["oferta", "fila"] }),
          toggle("offer_only_before_time", "Oferta só antes do horário", "A oferta vence no que vier primeiro: o prazo para aceitar ou o horário da reserva."),
          step("max_per_slot", "Fila máxima por horário", "Quem já está continua; só entradas novas param no limite.", "pessoas", { also: ["fila"] }),
          toggle("walk_in_enabled", "Espera de quem chega sem reserva", "A recepção põe na fila quem chega na porta.", { on: "Ligada", off: "Desligada", also: ["porta", "sem reserva"] }),
          toggle("notify_on_capacity_gain", "Avisar a espera quando a casa ganha lugares", "Por exemplo, quando o quintal reabre."),
        ],
      },
    ],
  },

  salao: {
    api: "floor",
    label: "Salão",
    section: "reservas",
    intro: "O que a recepção faz no fim da tolerância e quando a mesa fica “para liberar”, sem precisar perguntar.",
    blocks: [
      {
        title: "Fim da tolerância",
        rows: [
          seg("on_tolerance_end", "Ao fim da tolerância", "Sugerir: nada muda sozinho, a recepção decide. Soltar sozinho só vale com “libera a mesa” em Reservas.", { suggest_no_show: "Sugerir “Não veio”", auto_release: "Soltar a mesa sozinho" }, { also: ["não veio", "no-show", "tolerância"] }),
          toleranceTable(),
          step("release_hint_min", "“Para liberar” antes do fim", "Só marca se houver reserva ou espera para a mesa.", "min", { also: ["liberar mesa"] }),
          step("undo_check_in_min", "Desfazer “Chegou” até", "", "min", { also: ["chegou", "desfazer"] }),
        ],
      },
      {
        title: "A noite",
        rows: [
          custom("areas", "walk_in_areas", "Onde senta quem chega sem reserva", "As áreas da casa.", { also: ["balcão", "sem reserva", "walk-in"] }),
          step("night_close_delay_min", "Fechamento da noite", "Quanto depois do fechamento a rotina da noite roda. Não passa da virada das 05:00.", "min", { format: minutes, also: ["fechamento"] }),
          seg("print_sheet_mode", "Sugerir imprimir a folha da noite", "O Hoje lembra a recepção de imprimir a folha.", { at_open: "Na abertura", at_time: "Numa hora", off: "Desligado" }, { also: ["imprimir", "folha"] }),
          time("print_sheet_at", "Hora de sugerir a folha", "", { when: (d) => d.print_sheet_mode === "at_time" }),
          toggle("reception_can_finish", "Recepção marca “acabou”", "", { also: ["acabou"] }),
          seg("reception_reschedule", "Recepção remarca", "", { same_day: "Só no mesmo dia", never: "Nunca" }, { also: ["remarcar"] }),
        ],
      },
      {
        title: "Chegam com o módulo 3",
        rows: [
          locked("Garçom responsável ao abrir mesa", "Com a comanda."),
          locked("Cadeiras numeradas", "Para lançar por pessoa."),
          locked("Viagem e retirada", "Pedidos para levar."),
        ],
      },
    ],
  },

  mensagens: {
    api: "messages",
    label: "Mensagens",
    section: "reservas",
    preview: "messages",
    intro: "O lembrete e as mensagens prontas do WhatsApp. Mudar um texto pede aprovação à Meta; até aprovar, vale o anterior.",
    blocks: [
      {
        title: "Lembrete",
        rows: [
          toggle("reminder_enabled", "Lembrete do dia", "Uma mensagem por noite, com Confirmo, Não vou mais e Vou atrasar.", {
            on: "Ligado",
            off: "Desligado",
            confirmOff: (ctx) => ({
              title: "Desligar o lembrete?",
              message: `${plural(ctx.reminders_next ?? 0, "reserva", "reservas")} de hoje e amanhã ${ctx.reminders_next === 1 ? "deixa" : "deixam"} de receber o lembrete.`,
              label: "Desligar o lembrete",
            }),
            also: ["lembrete", "whatsapp", "confirmação"],
          }),
          seg("reminder_mode", "Quando sai", "", { before_open: "Antes da abertura", fixed_time: "Numa hora fixa" }, { when: (d) => d.reminder_enabled }),
          step("reminder_offset_min", "Quanto antes da abertura", "Numa noite das 19:00, 3 h antes é às 16:00.", "min", { format: minutes, when: (d) => d.reminder_enabled && d.reminder_mode === "before_open", also: ["hora do lembrete"] }),
          time("reminder_at", "Hora do lembrete", "", { when: (d) => d.reminder_enabled && d.reminder_mode === "fixed_time" }),
          fixed("Botões do lembrete", (d) => d.reminder_buttons.map((b) => b.pt).join(" · "), "Até 3, pedidos à Meta.", { support: false }),
        ],
      },
      {
        title: "Respostas e espera",
        rows: [
          toggle("auto_reply_enabled", "Resposta automática a texto livre", "Com o aplicativo da casa junto, a equipe pode responder à mão.", { on: "Ligada", off: "Desligada", also: ["resposta automática"] }),
          words("auto_reply_text", "Texto da resposta", "", { multiline: true, when: (d) => d.auto_reply_enabled }),
          toggle("waitlist_joined_enabled", "Avisar quem entra na espera", "", { on: "Ligado", off: "Desligado" }),
          toggle("waitlist_closed_enabled", "Avisar quando a espera encerra", "", { on: "Ligado", off: "Desligado" }),
        ],
      },
      {
        title: "Modelos do WhatsApp na Meta",
        rows: [custom("templates", "templates", "Situação de cada modelo", "Todo texto que sai pelo WhatsApp passa pela Meta. Enquanto um texto novo espera, vale o anterior.", { also: ["meta", "modelo", "aprovação", "template"] })],
      },
      {
        title: "Mensagens prontas da recepção",
        rows: [custom("ready", "ready_messages", "Mensagens prontas", "Use {hora} no lugar do número escrito.", { also: ["mensagem pronta", "mesa pronta", "atraso"] })],
      },
      {
        title: "Fixo",
        rows: [
          fixed("Teto diário", (d) => `${d.daily_cap} mensagens por dia`, ""),
          fixed("Língua da mensagem", () => "A da reserva", ""),
          note("O código vai só pelo WhatsApp. Não há SMS."),
        ],
      },
    ],
  },

  eventos: {
    api: "events",
    label: "Eventos",
    section: "reservas",
    site: true,
    intro: "Como os eventos novos recebem reservas e quando a agenda aparece no site.",
    blocks: [
      {
        title: "Eventos na casa",
        rows: [
          seg("default_booking_mode", "Reserva de evento novo", "Cada evento pode mudar depois.", { tables: "Mesas", list: "Lista", mixed: "Misto", private: "Privado", none: "Sem reserva" }, { also: ["evento", "lista"] }),
          seg("site_agenda", "Agenda no site", "", { only_with_event: "Só com evento", always: "Sempre" }, { also: ["agenda"] }),
          note("A capacidade da lista é definida em cada evento.", { href: "/admin/eventos", label: "Abrir Eventos" }),
        ],
      },
      { title: "Chegam com o módulo 3", rows: [locked("Eventos fora da casa", "Pontos de venda, taxa e kit do evento.")] },
    ],
  },

  site: {
    api: "site",
    label: "Site",
    section: "site",
    site: true,
    intro: "As línguas do site. Blocos, avisos com validade e fotos são conteúdo e ficam em Site e Galeria.",
    blocks: [
      {
        title: "Línguas",
        rows: [
          custom("locales", "languages", "Línguas ativas", "O português não pode ser desligado.", { also: ["idioma", "espanhol", "inglês", "língua"] }),
          seg("default_language", "Língua padrão", "Precisa estar ativa.", { pt: "Português", es: "Espanhol", en: "Inglês" }),
          note("O conteúdo do site fica em Site.", { href: "/admin/site", label: "Abrir Site" }),
        ],
      },
    ],
  },

  cardapio: {
    api: "menu",
    label: "Cardápio",
    section: "site",
    site: true,
    intro: "Como o site mostra o cardápio. Categorias, itens, preços, selos e fotos são editados em Cardápio.",
    blocks: [
      {
        title: "No site",
        rows: [
          seg("unpriced_item", "Item sem preço", "", { hide: "Esconder", ask: "Mostrar “consulte”" }, { also: ["preço", "consulte"] }),
          toggle("show_sold_out", "Mostrar “acabou” no site", "Quando a recepção marca que acabou.", { also: ["acabou", "esgotado"] }),
          note("Os itens ficam em Cardápio.", { href: "/admin/cardapio", label: "Abrir Cardápio" }),
          locked("Tempo médio de preparo", "Com a cozinha e o bar."),
        ],
      },
    ],
  },

  privacidade: {
    api: "privacy",
    label: "Privacidade",
    section: "site",
    reauthWhenShorter: ["customer_retention_months", "dietary_retention_days", "audit_retention_months"],
    intro: "Por quanto tempo a casa guarda os dados dos clientes. Encurtar um prazo pede a sua senha.",
    blocks: [
      {
        title: "Guarda dos dados",
        rows: [
          step("customer_retention_months", "Dados dos clientes", "Depois da última atividade (visita, reserva ou entrada na conta), o cliente é anonimizado.", "meses", { also: ["lgpd", "anonimizar", "guarda", "dados"] }),
          step("dietary_retention_days", "Restrição alimentar e alergia", "Depois da visita.", "dias", { also: ["alergia", "restrição"] }),
          step("audit_retention_months", "Registro de ações", "", "meses", { also: ["registro", "auditoria"] }),
          field("dpo_contact", "Contato do encarregado", "E-mail ou WhatsApp para pedidos de dados.", { also: ["encarregado", "dpo"] }),
        ],
      },
      {
        title: "Fixo",
        rows: [
          fixed("Prazo para responder o titular", (d) => `${d.subject_response_days} dias, pela LGPD`, ""),
          fixed("Versão da política", (d) => `${d.privacy_version}`, "", { support: false, also: ["política"] }),
        ],
      },
    ],
  },

  cookies: {
    api: "cookies",
    label: "Cookies",
    section: "site",
    site: true,
    preview: "cookies",
    intro: "O aviso de cookies do site. Mudar o texto pede a escolha de novo a todo visitante.",
    blocks: [
      {
        title: "O aviso",
        rows: [
          words("banner_text", "Texto do aviso", "", { multiline: true, also: ["banner", "cookies", "consentimento"] }),
          fixed("Versão do aviso", (d) => d.banner_version, "", { support: false }),
          toggle("measurement_enabled", "Medição de uso do site", "Só mede quem aceitar. Desligada, nada é medido.", { on: "Ligada", off: "Desligada", also: ["medição", "umami", "estatística"] }),
        ],
      },
      {
        title: "Categorias",
        rows: [fixed("Categorias", () => "Necessários (sempre) · Lembrar de mim · Medição", "Sem categoria de divulgação.")],
      },
    ],
  },

  integracoes: {
    api: "integrations",
    label: "Integrações",
    section: "sistema",
    ownerOnly: true,
    readOnly: true,
    google: true,
    intro: "A conta Google da casa, que leva as reservas para a Agenda e a folha da noite para o Drive, e a situação de cada serviço ligado à casa. Segredos ficam só no servidor; para trocar uma chave, fale com o suporte.",
    also: ["google", "agenda", "calendar", "drive", "conta google"],
    blocks: [{ title: "Serviços", rows: [custom("integrations", "items", "Integrações", "", { also: ["whatsapp", "google", "e-mail", "serviços", "integração"] })] }],
  },
};

export const GROUP_KEYS = Object.keys(GROUPS);

/** O endereço no painel de um grupo do contrato (aprovacao-e-faltas para approval_no_shows). */
export const slugOf = (api) => GROUP_KEYS.find((k) => GROUPS[k].api === api);

/** Todas as linhas de um grupo, achatadas. */
export const rowsOf = (group) => (group.blocks || []).flatMap((b) => b.rows);

/** Os caminhos que uma linha edita (as chaves de primeiro nível decidem o que o salvamento envia). */
export const pathsOf = (row) => row.paths || (row.key ? [row.key] : []);

/** A linha que edita um campo ("legal_footer" acha a linha de legal_footer.enabled). */
export function rowForField(group, fieldName) {
  const top = String(fieldName).split(/[.[]/)[0];
  return rowsOf(group).find((r) => pathsOf(r).some((p) => p === fieldName || p.split(".")[0] === top));
}

// ---- busca ------------------------------------------------------------------------------

const fold = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** "atraso" → Tolerância de atraso (Reservas), A mais para quem avisou… */
export function search(query, visible) {
  const q = fold(query.trim());
  if (q.length < 2) return [];
  const hits = [];
  for (const slug of visible) {
    const group = GROUPS[slug];
    if (fold(group.label).includes(q) || (group.also || []).some((a) => fold(a).includes(q))) hits.push({ slug, group, row: null, score: 2 });
    for (const row of rowsOf(group)) {
      if (!row.label || row.type === "note") continue;
      const inLabel = fold(row.label).includes(q);
      const inAlso = (row.also || []).some((a) => fold(a).includes(q));
      if (inLabel || inAlso) hits.push({ slug, group, row, score: inLabel ? 1 : 0 });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 12);
}

export const anchorOf = (row) => `linha-${String(row.key || row.label).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
