# Decisões da casa

> **Superado em 14/10.** Vale o PRD de 14/10 (`territorio/docs/planejamento/prds/prd-territorio-modulo-1-2026-10-14/`), a arquitetura (AD-1…AD-37) e a revisão geral (`territorio/docs/planejamento/revisao-2026-10-14.md`). Diferenças conhecidas: tolerância 15 → 20 min (+10 se avisar); Entrar com Google fora → dentro do módulo 1; perfil do salão com senha → aparelho aprovado + PIN (últimos 4 dígitos do telefone); WhatsApp: número novo → número atual da casa (+55 45 99830-4994) em coexistência.

O que só o Marcus decide. Até ele responder, o sistema usa o padrão da tabela, que já está na configuração (`HouseSettings`) e no mock. Na validação, ele responde preenchendo o cadastro da casa em `/admin/primeiro-uso`.

| # | Decisão | Padrão até decidir | Onde muda |
| --- | --- | --- | --- |
| 1 | Mesas por área (salão, quintal, balcão) e quais se juntam | A planta estimada pelas fotos: salão S1 a S6, quintal Q1 a Q8, balcão B1 a B6; S3 junta com S4 | Plantas |
| 2 | Tolerância de atraso | 15 minutos, mais 10 se avisar | Configurações › Reservas |
| 3 | Tempo de mesa | 2 horas para qualquer tamanho | Configurações › Reservas |
| 4 | Quem chega sem reserva | Balcão, se tiver lugar (balcão fora da reserva pelo site) | Configurações › Reservas |
| 5 | Aprovação e grupo grande | Automática até 8 pessoas; de 9 em diante, WhatsApp da casa com a mensagem pronta, como na proposta (pedido para a casa aprovar fica como opção) | Configurações › Reservas |
| 6 | Cancelamento pelo cliente | Até 2 horas antes | Configurações › Reservas |
| 7 | Janela e antecedência | 30 dias à frente; até 1 hora antes | Configurações › Reservas |
| 8 | Horário da casa | Quarta a sábado a partir das 19:00, reservas das 19:00 às 21:30 (a confirmar) | Configurações › Horários |
| 9 | Sinal por Pix | Nunca, por enquanto | Fora desta fase |
| 10 | Almoço de sábado | Superada (16/10): o módulo 1 aceita dois turnos por dia (história 2.8); o painel liga o segundo turno e o site mostra os dois | — |
| 11 | Entrar com Google | Fora do módulo 1; a reserva é pelo WhatsApp, obrigatório para o lembrete | — |
| 12 | Quem opera o painel | Um dono, um gerente e um perfil de salão para o tablet | Equipe |
| 13 | Cozinha: impressora ou tela | Fora desta fase (fase 2 da proposta) | — |
| 14 | Como se reserva nos eventos: mesa, lista por pessoa ou os dois | Reserva de mesa normal até ele escolher, evento por evento | Eventos |
| 15 | Capacidade do quintal em evento com lista | A confirmar; o modelo "Evento no quintal" usa 40 pessoas só como exemplo | Plantas |
| 16 | Guardar mesas para quem chega sem reserva nas noites cheias | Nenhuma além do balcão | Agenda › plano do dia |
| 17 | Limite de pessoas chegando no mesmo horário (ritmo da cozinha) | Sem limite | Agenda › plano do dia |
| 18 | Ingresso ou sinal por Pix em evento | Não, por enquanto (fase 3) | Eventos |
| 19 | Plantas que a casa já usa (chuva, eventos, casa cheia) | "Padrão", "Sem quintal" e o modelo "Evento no quintal"; ele desenha as dele no primeiro uso | Plantas |
| 20 | Resposta ao lembrete | Botões no próprio WhatsApp ("Confirmo", "Não vou mais", "Vou atrasar um pouco"), como na proposta; a página do link é a alternativa | Mensagens |
| 21 | Hora do lembrete | 3 horas antes de abrir (16:00 numa noite que abre às 19:00) | Configurações › Reservas |
| 22 | Quem avisa que vai atrasar | Ganha os +10 minutos na hora | Configurações › Reservas |
| 23 | Dia fechado que já tem reservas | A casa remarca ou cancela cada uma, com mensagem; o sistema não fecha o dia com reserva ativa | Agenda |
| 24 | Mesa que vaga depois que o horário começou | Fica para quem chega sem reserva; a lista de espera só recebe oferta antes do horário | Configurações › Reservas |
| 25 | Telefone completo para o perfil do salão | Não: só dono e gerente; o salão vê o número mascarado | Equipe |
| 26 | Prato do dia muda o "Hoje na casa" | Sim, como na proposta: ligar o prato do dia no Cardápio troca o aviso | Cardápio |
| 27 | Cliente muda o número de pessoas | Sim, como remarcação, se houver vaga | Configurações › Reservas |
| 28 | Propor outro horário ao recusar um pedido | Fora da v1: a recusa leva o motivo e o link para reservar outro horário | — |
| 29 | Novidades da casa pelo WhatsApp | Fora da v1; o cliente só aceita a política de privacidade | — |

## Conteúdo que falta

- Carta de bebidas e cardápio finais (os atuais saíram dos destaques; preços sem fonte estão "a confirmar").
- Fotos em alta resolução da fachada, salão, quintal e pratos.
- Texto e dados para a política de privacidade (razão social, CNPJ, canal de contato).
- Autorização para usar frases de clientes na seção de depoimentos.
