# Regras da reserva

> **Superado em 14/10.** Vale o PRD de 14/10 (`territorio/docs/planejamento/prds/prd-territorio-modulo-1-2026-10-14/`), a arquitetura (AD-1…AD-37) e a revisão geral (`territorio/docs/planejamento/revisao-2026-10-14.md`). Diferenças conhecidas: tolerância 15 → 20 min (+10 se avisar); faltas 2 → 1 em 12 meses leva à confirmação; pendente vence em 4 h ou 2 h antes → 4 h ou 30 min antes.

As regras que a API garante e que o mock já segue. O front só repete as regras para ajudar quem está digitando; quem decide é a API. Os valores entre parênteses são os padrões da configuração (ver [05-decisoes.md](05-decisoes.md)).

## Fuso e relógio

- Fuso fixo `America/Sao_Paulo` (UTC−3, sem horário de verão).
- O relógio que vale é o do servidor: toda resposta que depende de hora traz `server_time`. O relógio do navegador só serve para exibir.

## Semana padrão

| Dia | Situação | Horários de reserva |
| --- | --- | --- |
| Segunda e terça | Produção (fechado) | — |
| Quarta a sábado | Aberto a partir das 19:00 | 19:00, 19:30, 20:00, 20:30, 21:00, 21:30 |
| Domingo | Fechado | — |

O horário definitivo ainda está "a confirmar" com o Marcus. O plano do dia (feriado, evento, férias, chuva, noite cheia) vale por cima da semana padrão; ver o fim deste documento.

## Janela, antecedência e tempo de mesa

- Reserva até `window_days` (30) dias à frente e até `min_lead_min` (60) minutos antes do horário. Horário que já passou fica `past` e sai da lista.
- Tempo de mesa por `duration_rules` (120 minutos para qualquer tamanho). A reserva ocupa as mesas de `starts_at` até `ends_at`.

## Combinados

- Os combinados têm partes que mudam pelo dia e pelo grupo: `{tempo_de_mesa}`, `{tolerancia}` e `{cancelar_ate}`. A API preenche com os valores do dia (plano do dia) e do tamanho do grupo; o texto nunca diz "2 horas" fixo.
- A reserva grava a versão dos combinados e os valores aceitos (`terms_values`). Mudar a tolerância, o tempo de mesa ou o prazo em Configurações vale para reservas novas.

## Mesas e vaga

- A vaga é calculada sobre a **planta do dia** (ver "Plantas, plano do dia e eventos" abaixo), não sobre uma planta fixa.
- No site só entram as mesas da planta do dia marcadas como reserváveis, em áreas em modo mesa, abertas naquele dia e fora das mesas guardadas. A equipe pode usar qualquer mesa. Na planta padrão o balcão fica para quem chega sem reserva.
- No site, uma mesa serve o grupo quando `min_seats ≤ pessoas ≤ max_seats` (a mesa de quatro não vai para um casal). A equipe pode usar qualquer mesa com lugar para o grupo. As junções da planta (`combos`) formam uma opção com os lugares somados, e entram quando nenhuma mesa sozinha serve ou quando as que servem estão ocupadas no horário.
- Uma opção está livre no horário quando nenhuma das suas mesas tem reserva ativa (`pending` com mesa, `confirmed`, `offered`) sobrepondo o intervalo da nova reserva.
- **Estado do horário** para o grupo: 2 ou mais opções livres → `available`; 1 → `few_left`; nenhuma, ou o limite de pessoas do horário estouraria → `full`.
- **Estado do dia:** fechado → `closed` com motivo; evento de entrada livre → `no_booking`; nenhum horário com opção (e lista cheia, se houver) → `full`; só um horário com opção, ou todos em `few_left` → `few_left`; senão `available`.
- **Alocação:** a opção que sobra menos lugares; empate pela `priority`.
- Pendente segura uma mesa provisória (quando há mesa que serve) até a casa responder ou o prazo vencer. O pedido de grupo grande fica sem mesa até a casa montar.

## Limites

- Pessoas: de 1 a `party_max_online` (8; o plano do dia ou o evento podem baixar). Acima disso, `large_group_action`: `whatsapp` (padrão, como na proposta aprovada: a janela leva ao WhatsApp da casa com a mensagem pronta) ou `request` (pedido pendente; a casa monta a mesa).
- Quem chega sem reserva (`walk_in_policy`): balcão, se tiver lugar (padrão); a equipe senta pelo Salão.
- No máximo `max_active_per_phone` (2) reservas futuras ativas por telefone.
- Uma reserva ativa por cliente, dia e horário. Repetida → erro `duplicate_reservation` com a reserva que já existe.

## Aprovação

- `approval_mode`: `auto`, `manual` ou `rules` (padrão). Em `rules`, a reserva vira pendente quando: grupo acima de `party_max_online` (se `large_group_action` for `request`), cliente com 2 ou mais faltas, ou evento que pede aprovação (`requires_approval`).
- Pendente expira em `pending_expiry_hours` (4) ou 2 horas antes do horário, o que vier primeiro.
- Pedido que precisaria de aprovação a menos de 3 horas do horário não vira pendente, porque a casa não teria tempo de responder: a API recusa com `needs_whatsapp`, e a janela leva ao WhatsApp da casa.

## Lista de espera

- Entra quando o horário está `full` e `waitlist_enabled` está ligado. A fila é por ordem de entrada.
- Quando libera uma mesa que serve o grupo (cancelamento, liberação, remarcação, planta com mais lugares), o primeiro da fila recebe a oferta: `offered`, com `offer_expires_at` = agora + `waitlist_offer_min` (10 minutos) e o link de ação `/espera?t=`.
- A oferta só sai para horário que ainda não começou. Quem aceita tem a tolerância contada do horário ou do aceite, o que for mais tarde. Mesa que vaga depois do horário começar fica para quem chega sem reserva.
- Aceitou a tempo → `confirmed` com a mesa. Recusou pelo link ("Não vou conseguir") → `canceled`, e a oferta passa ao próximo na hora. Não respondeu → `expired`, e a oferta passa ao próximo.
- A equipe pode "virar reserva" quem está na fila, depois de falar com a pessoa, escolhendo a mesa.
- No fechamento da noite, quem continua `waitlisted` → `expired`.

## Transições

| De | Para | Quem | Quando | Efeitos |
| --- | --- | --- | --- | --- |
| (nova) | `confirmed` | Cliente ou equipe | Há mesa e a regra permite | Mesa atribuída, mensagem, registro |
| (nova) | `pending` | Cliente | A regra pede aprovação | Mesa provisória, aviso para a casa |
| (nova) | `waitlisted` | Cliente | Horário lotado | Posição na fila, mensagem |
| `pending` | `confirmed` | Casa | Aprovou | Mesa definitiva, mensagem |
| `pending` | `declined` | Casa | Recusou, com motivo | Mensagem com o motivo |
| `pending` | `expired` | Sistema | Prazo | Mensagem |
| `waitlisted` | `offered` | Sistema ou casa | Mesa liberou, antes do horário | Mensagem com o link (`waitlist_offer_min`) |
| `waitlisted` | `confirmed` | Casa | Falou com o cliente e há mesa ("virar reserva") | Mesa atribuída, mensagem |
| `offered` | `confirmed` | Cliente | Aceitou a tempo | Mesa atribuída |
| `offered` | `canceled` | Cliente | Recusou a oferta pelo link | Oferta para o próximo na hora |
| `offered` | `expired` | Sistema | Não aceitou | Oferta para o próximo |
| `waitlisted` | `expired` | Sistema | Fim da noite | — |
| `pending`, `confirmed`, `waitlisted`, `offered` | `canceled` | Cliente (até `cancel_until_hours` antes) ou casa (a qualquer hora) | Cancelou | Mesa liberada, oferta para a fila, mensagem |
| `confirmed` | `completed` | Casa e sistema | Chegou e a noite fechou | Conta uma visita |
| `confirmed` | `no_show` | Casa ou sistema | Passou da tolerância sem chegar | Conta uma falta, mesa liberada |

Qualquer outra transição é recusada pela API com `invalid_transition`.

## Andamento da noite (painel do salão)

| Situação | Regra |
| --- | --- |
| Aguardando | Antes do horário |
| Atrasada | Depois do horário, até a tolerância (`tolerance_min` 15, mais `extra_tolerance_min` 10 se avisou) |
| Passou da tolerância | Depois disso, sem chegada. A equipe escolhe "chegou" ou "liberar mesa" (→ `no_show`) |
| Sentada | `seated_at` preenchido; o tempo de mesa conta a partir do horário da reserva |
| Mesa livre | `left_at` preenchido ou fim do tempo de mesa |

- **Chegou** grava `arrived_at` e, se a mesa está livre, `seated_at`. **Sentou** é para quem chegou e esperou a mesa.
- **Liberar mesa** (passou da tolerância sem chegar) → `no_show`, conta uma falta. **Mesa vagou** (o grupo foi embora) → `release`, grava `left_at`, sem falta.

## Lembrete e confirmação do cliente

- O lembrete sai `reminder_offset_min` (180) minutos antes da abertura do dia, no fuso da casa (16:00 numa noite que abre às 19:00), para toda reserva `confirmed` daquela noite.
- A resposta é pelos botões do próprio WhatsApp, como na proposta aprovada: **Confirmo** → `customer_confirmation = yes`; **Não vou mais** → `canceled` pelo cliente, mesmo depois do prazo de cancelamento; **Vou atrasar um pouco** → soma `extra_tolerance_min` (10) à tolerância. A página `/confirmar?t=` faz o mesmo para quem preferir o link, e lá o "Não vou mais" pede confirmação.
- A resposta pode ser trocada até o horário da reserva.
- Sem resposta até `reply_deadline_offset_min` (30) minutos antes da abertura → `no_reply`, que aparece como alerta em Hoje. Nada é cancelado sozinho.
- Reserva feita depois do envio do lembrete não recebe lembrete.

## Cancelar e remarcar pelo cliente

- Até `cancel_until_hours` (2) antes do horário, por Minhas reservas ou pelo link de ação das mensagens. O link de leitura, que a pessoa compartilha com quem vai junto, não cancela. Depois do prazo, "fale com a casa pelo WhatsApp". A exceção é o "Não vou mais" em resposta ao lembrete, que cancela a qualquer hora porque libera a mesa (ver Lembrete).
- Remarcar e mudar o número de pessoas seguem o mesmo prazo de `cancel_until_hours`; depois dele, só a casa. Remarcar confere a vaga de novo. Se o novo horário tem mesa, a reserva muda e mantém o código; se não tem, nada muda. Mudar o número de pessoas é remarcar com outro tamanho.

## Duplicidade e idempotência

- `POST /reservations` exige o cabeçalho `Idempotency-Key`. A mesma chave em até 24 horas devolve a mesma resposta, sem criar outra reserva.
- O front gera a chave quando a pessoa chega ao passo Confirmar e guarda no `sessionStorage` até o sucesso.

## Links enviados ao cliente

- Cada reserva tem dois tokens aleatórios e longos, guardados só como hash, nunca o `code`: `view_token` (só leitura; é o link do comprovante, que a pessoa pode compartilhar) e `action_token` (confirmar, cancelar, aceitar ou recusar a oferta; vai só nas mensagens para o próprio cliente).
- Abrir o link não muda nada: toda ação exige clique (POST). A prévia de link do WhatsApp abre a URL sozinha.
- Validade: até 30 dias depois da reserva. Uma ação já feita mostra o resultado; só a resposta ao lembrete pode ser trocada, até o horário.

## Mensagens (rascunho, na voz da casa)

| Momento | Texto |
| --- | --- |
| Código de acesso | "Seu código do Território: {codigo_acesso}. Vale por 10 minutos." |
| Confirmada | "Pode entrar, {nome}! Mesa pra {pessoas} {dia_com_artigo} às {hora}. Código {codigo}. Ver ou cancelar: {link_acao}" |
| Pendente | "Recebemos seu pedido pra {pessoas} {dia_com_artigo} às {hora}. A casa responde até {prazo}. Acompanhe: {link_acao}" |
| Pendente vencido | "A casa não conseguiu responder a tempo o pedido {dia_com_artigo} às {hora}. Chama a gente no WhatsApp que a gente vê." |
| Recusa | "Dessa vez não deu pra {dia_com_artigo} às {hora}. {motivo} Outro horário: {link_reservar}" |
| Lista de espera | "Você está na lista de espera pra {pessoas} {dia_com_artigo} às {hora}. Se abrir mesa, a gente avisa aqui." |
| Oferta da espera | "Abriu uma mesa pra {pessoas} às {hora}! Você tem {minutos} minutos pra aceitar: {link_acao}" |
| Oferta vencida | "A mesa das {hora} foi para o próximo da lista. Quer tentar outro horário? {link_reservar}" |
| Lembrete | "Oi, {nome}! Hoje tem mesa pra {pessoas} às {hora}. Tá de pé?", com os botões "Confirmo", "Não vou mais" e "Vou atrasar um pouco" |
| Cancelada pelo cliente | "Cancelado. Obrigado por avisar! Quando quiser: {link_reservar}" |
| Cancelada pela casa | "{nome}, precisamos cancelar a mesa {dia_com_artigo} às {hora}. {motivo} Chama a gente no WhatsApp que a gente ajeita." |
| Mudou a mesa ou o horário | "{nome}, sua mesa {dia_com_artigo} mudou: agora é às {hora}. Qualquer coisa, chama no WhatsApp." |
| Remarcada | "Remarcado: mesa pra {pessoas} {dia_com_artigo} às {hora}. Código {codigo}." |
| Para a casa: pedido pendente | "Pedido pra {pessoas} {dia_com_artigo} às {hora}, esperando resposta até {prazo}: {link_painel}" |

`{dia_com_artigo}` sai como "hoje", "amanhã", "na quarta" ou "no sábado". `{link_acao}` usa o `action_token`; o comprovante compartilhado usa o `view_token`. Os textos finais passam pela aprovação de templates da Meta antes de ir para produção; cada template novo é uma aprovação nova.

## Dados de saúde

- Restrição alimentar e alergia são dado de saúde, que a LGPD trata como sensível: o campo é opcional e vem com aviso.
- Aparece só para quem atende a mesa: o salão no dia, o gerente e o dono.
- Fica fora da exportação padrão e é apagado `sensitive_retention_days` (30) dias depois da visita.

## Plantas, plano do dia e eventos

### Como um dia é montado

1. Parte da semana padrão: se abre, horário, horários de reserva e planta.
2. O plano do dia daquela data, se existir, substitui o que ele definir; o resto continua herdado.
3. Se há evento publicado na data, o modo de reserva dele vale (o evento sempre tem o próprio plano do dia). Evento marcado numa data em que a casa não abre (um domingo, por exemplo) abre a casa naquele dia.
4. O plano de um evento em rascunho não vale ainda: a data segue como estava até o evento ser publicado.

### Mesas, lista e áreas fechadas

- Área em modo `tables`: vale a regra de mesas acima, com as mesas e junções da planta do dia. Mesas em `held_tables` ficam fora do site; a equipe usa para quem chega sem reserva.
- Área em modo `list`: a reserva é por pessoa, sem mesa marcada. A capacidade da noite é a do evento, se ele definir; senão, a soma das áreas em modo lista na planta. Sobrando menos de 20% da capacidade depois do grupo → `few_left`; sem lugar para o grupo → `full`, com lista de espera. Horários de chegada que já passaram (ou estão a menos da antecedência mínima) saem da lista.
- Área em modo `closed` na planta, ou listada em `closed_areas` no plano do dia (chuva, manutenção): fica fora da vaga e da preferência de área.

### Limites por demanda

- `max_covers_per_slot`: quantas pessoas podem chegar no mesmo horário (o ritmo da cozinha). O horário que estouraria com aquele grupo fica `full` para ele.
- `max_covers_night`: total de pessoas da noite.
- `duration_min` e `party_max_online` do dia valem para reservas novas; as já feitas guardam o que tinham.
- Acima do `party_max_online` do dia (ou do `party_max` do evento), o site responde `party_too_large` e a janela segue o `large_group_action`.
- Na lista do evento, os limites por horário e da noite também valem: o horário de chegada que estouraria sai da lista para aquele grupo.

### Trocar a planta de uma data

- Sempre com simulação antes (`dry_run`). A API devolve três listas: quem mantém o lugar, quem muda e quem fica sem mesa.
- Vale para tudo que muda as mesas ou o horário de datas com reserva: o plano do dia (inclusive voltar à semana padrão e aplicar a várias datas); publicar, mudar ou apagar um evento; editar uma planta em uso; e mudar, em Configurações, o horário da semana, a planta padrão de um dia ou o tempo de mesa.
- A ordem de realocação: (1) mantém quem pode ficar onde está (as mesmas mesas existem na planta nova, em área com mesas, e cabem o grupo, e uma junção só continua se a planta nova também junta essas mesas; ou continua na mesma lista); (2) se a área da reserva virou lista (noite de evento), a reserva entra na lista enquanto houver lugar; (3) senão, vai para a menor mesa livre da planta nova no tempo de mesa que a reserva já tinha, e a equipe pode trocar. As reservas são vistas por horário, e as maiores primeiro dentro do mesmo horário.
- Quem fica sem mesa aparece para a equipe resolver: outra mesa, outro horário, a lista do evento ou avisar o cliente. A troca só é gravada sem ninguém sem mesa, ou com a equipe assumindo esses casos.
- Planta com mais lugares libera vaga: a lista de espera daquele dia recebe as ofertas na hora.
- Toda troca fica no registro, com antes e depois.

### Fechar um dia que tem reservas

- A API não fecha um dia com reserva ativa. A tela lista as reservas, e a equipe remarca ou cancela cada uma (ou todas de uma vez), com a mensagem de cancelamento pela casa e o motivo ("A casa não abre nesse dia").
- A lista de espera do dia é encerrada, com mensagem.
- Evento fechado (`private`) publicado num dia com reservas segue a mesma regra.

### Eventos

- Criar um evento cria o plano do dia dele (planta, horário, limites). Duplicar um evento passado copia tudo para outra data.
- `private` fecha o dia para o público com o rótulo "Evento fechado"; `none` mostra o dia como "Entrada livre, sem reserva" (`no_booking`).
- Em `list`, as áreas com mesa não aparecem no site naquele dia; em `tables`, as áreas em lista não aparecem. `mixed` mostra as duas.
- Em lista, a reserva guarda área, pessoas e horário de chegada (`entry_times`). Na porta, a equipe marca a chegada pela lista (`arrived_at`).
- Evento pode exigir aprovação (`requires_approval`) e ter limite de grupo próprio (`party_max`).
- A reserva de evento segue os mesmos estados, lembrete e cancelamento das outras.
