# Extração: dados, regras, API e integrações (Território, módulo 1)

Fontes: `docs/03-modelos.md` (M), `docs/04-regras-reserva.md` (R), `docs/api/openapi.yaml` (API), `docs/10-escopo-modulo-1.md` (E10). Apoio pontual: `02-telas.md` (T, matriz de papéis) e `01-escopo.md` (S, stack).
Marcas: **[LACUNA]** = o escopo 10 promete, mas modelos/contrato não cobrem (ou cobrem pela metade). **[FORA]** = especificado, mas fora do módulo 1.

---

## 1. Entidades de dados

Convenções (M): `id` UUID; toda entidade tem `house_id`; `created_at`/`updated_at` UTC ISO 8601; `date` YYYY-MM-DD e `time` HH:MM no fuso `America/Sao_Paulo`; dinheiro em centavos; enums em inglês minúsculo; Layout, DayPlan, Event e HouseSettings têm `version` (If-Match → 412).

| # | Entidade | Para que serve | Campos-chave | Relações |
| --- | --- | --- | --- | --- |
| 1 | `Reservation` | Reserva, pedido pendente, entrada na espera, convidado de lista de evento ou walk-in | `code` (TR-4821, não secreto), `view_token`/`action_token` (hash, ≥128 bits), `status`, `source`, `party_size`, `date`/`time`, `starts_at`/`ends_at`, `duration_min` congelado, `table_codes`, `area_key`, `area_preference`, `customer_confirmation`, `tolerance_min`/`extra_tolerance_min`, `arrived_at`/`seated_at`/`left_at`, `arrived_people`, `notes` (≤280), `internal_notes`, `flags`, `waitlist_position`, `offer_expires_at`, `canceled_by`/`cancel_reason`/`decline_reason`, `terms_version`/`terms_values`/`terms_accepted_at`, `idempotency_key`, `created_by` | N:1 Customer; N:1 Event (opcional); `table_codes` → `Layout.tables[].code` da planta do dia; N:1 User (`created_by`); 1:N MessageLog; 1:N AuditLog |
| 2 | `ReservationPublic` / `ReservationStaff` / `ReservationDetail` (visões) | Recortes da reserva por público: cliente; equipe (cortada por papel); detalhe com `history[]` e `messages[]` | Público: code, date, time, party_size, status, first_name, tolerance_until, waitlist_position, pending_until, offer_expires_at, can_cancel_until, receipt_url | Projeções de Reservation |
| 3 | `Customer` | Cliente da casa; chave é o telefone | `phone_e164` (único por casa), `name`, `phone_verified_at`, `email` (desligado na v1), `visits`/`no_shows`/`last_visit_at` (calculados), `tags` (regular, attention), `internal_notes`, `blocked`/`blocked_reason`, `marketing_opt_in`/`opt_in_at`, `privacy_version`/`privacy_accepted_at`, `anonymized_at` | 1:N Reservation |
| 4 | `User` | Pessoa da equipe | `name`, `email` (único), `role` (owner, manager, floor), `status` (invited, active, disabled), `mfa_enabled`, `last_login_at`, `invited_by`, `invite_expires_at`; senha só hash | 1:N Session; 1:N AuditLog (ator); convidado por User |
| 5 | `Session` | Sessão da equipe guardada no servidor | `device`, `created_at`, `last_seen_at`, expira em, `current` | N:1 User |
| 6 | Sessão do cliente (sem modelo descrito) | Cookie `tr_customer` (90 dias com "lembrar aparelho") | — | N:1 Customer. [LACUNA] sem modelo/campos em M |
| 7 | Código OTP (sem modelo descrito) | Código de 6 dígitos via WhatsApp, 10 min, 5 tentativas | — | por telefone. [LACUNA] sem modelo em M |
| 8 | Disponibilidade (calculada, não guardada) | Situação de dia e horários para um tamanho de grupo | `open`/`reason`, `state` (available, few_left, full, closed, no_booking), `slots[]` (time, state, waitlist_open), `areas[]`, `list`, `event`, `duration_min`, `tolerance_min`, `cancel_until_hours`, `party_max_online`, `party_too_large` | Deriva de ResolvedDay + reservas ativas |
| 9 | `Area` | Espaço físico fixo (salao, quintal, balcao) | `key`, `name`, `sort` | Referenciada por Layout.areas/tables |
| 10 | `Layout` (planta) | Uma forma de montar a casa | `name`, `description`, `areas[]` (key, mode tables/list/closed, `list_capacity`, `bookable_online`), `tables[]` (code único na planta, area, min/max_seats, shape, x, y, bookable_online, priority), `combos[]` (codes ≥2, max_seats, label), `archived`, `seats_total`, `used_by`, `version` | Usada por OpeningHours, DayPlan, Event |
| 11 | `OpeningHours` | Semana padrão (weekday 0 = domingo) | `open`, `label`, `opens_at`, `closes_at`, `slots[]`, `layout_id` | N:1 Layout |
| 12 | `DayPlan` (plano do dia) | Exceção de uma data sobre a semana padrão; vazio herda | `date`, `open`, `closed_reason`, `public_label`, `opens_at`/`closes_at`, `slots`, `layout_id`, `duration_min`, `max_covers_per_slot`, `max_covers_night`, `held_tables`, `closed_areas`, `party_max_online`, `event_id`, `internal_note`, `version` | N:1 Layout; 0..1 Event |
| 13 | `ResolvedDay` (calculado) | Dia já resolvido (semana + plano + evento) | tudo do dia + `source` (week, day_plan, event), `list_capacity`, `entry_times` | — |
| 14 | `Event` | "Território Convida": evento com plano do dia próprio | `title`, `date`, `starts_at`/`ends_at`, `description`, `image_id`, `published`, `booking_mode` (tables, list, mixed, private, none), `list_capacity`, `entry_times`, `party_max`, `requires_approval`, `price_cents` [FORA], `layout_id`, `internal_note`, `counts`, `version` | 1:1 DayPlan; N:1 Image; 1:N Reservation |
| 15 | `HouseSettings` | Configuração da casa em seções (house, hours, booking, terms, privacy, messages) | booking: `window_days`, `min_lead_min`, `party_max_online`, `large_group_action`, `approval_mode`, `approval_rules` (party_over, customer_no_shows_at_least, special_events), `pending_expiry_hours`, `tolerance_min`, `extra_tolerance_min`, `duration_rules[]`, `cancel_until_hours`, `max_active_per_phone`, `waitlist_enabled`, `waitlist_offer_min`, `walk_in_policy`, `reminder_offset_min`, `reply_deadline_offset_min`, `google_login` [FORA]; privacy: `retention_months`, `sensitive_retention_days`, `privacy_version`; messages.templates (só leitura) | Singleton por casa; OpeningHours dentro de `hours.week` |
| 16 | `Terms` (combinados) | Texto aceito na reserva, versionado, com placeholders `{tempo_de_mesa}`, `{tolerancia}`, `{cancelar_ate}` | `version`, `items[]` (title, text) | Reservation guarda versão + valores |
| 17 | `ContentBlock` | Textos editáveis do site com rascunho/versões | `block` (cover, today, about, experience, notices, testimonials, links, seo), `fields`, `status` (draft, published), `version`, `published_at`, `published_by` | — |
| 18 | `TodayRule` | Regra fixa do dia da semana ("toda quinta é peixe") | `weekday`, `text` | Sem endpoint próprio; presumivelmente dentro do bloco `today` [LACUNA de contrato] |
| 19 | `Notice` | Aviso com validade | `text`, `starts_at`, `ends_at` | Sem endpoint próprio; presumivelmente bloco `notices` [LACUNA de contrato] |
| 20 | `MenuCategory` | Aba/folha do cardápio | `name`, `subtitle`, `sheet_style` (dark, light, handmade, default; M não lista handmade), `footer`, `sort`, `image_id` | 1:N MenuItem; N:1 Image |
| 21 | `MenuItem` | Prato/bebida | `category_id`, `name`, `description`, `group`, `price_cents` ou vazio, `price_label`, `badges` (vegetarian, gluten_free, spicy), `available` ("tem hoje"), `featured`, `sort` | N:1 MenuCategory |
| 22 | `Image` | Foto do banco de fotos | `original_name`, `mime`, `width`/`height`/`bytes`, `focal_x`/`focal_y`, `alt` (obrigatório), `credit`, `usages[]`, `variants[]` (AVIF/WebP/JPG × 480/960/1600), `placeholder`, `status` (processing, ready, failed) | Referenciada por Event, MenuCategory, blocos |
| 23 | `AuditLog` | Registro de ações, só inclusão (garantido no banco) | `occurred_at`, `actor_type` (user, customer, system), `actor_id`, `actor_label`, `action`, `entity_type`/`entity_id`, `summary`, `changes` (sem sensíveis), `ip_hash`, `request_id` | Aponta para qualquer entidade |
| 24 | `MessageLog` | Rastreio de mensagens enviadas | reserva, canal, template, situação (queued, sent, delivered, read, failed), horário | N:1 Reservation |
| 25 | `BookingDraft` (só navegador) | Rascunho do fluxo de reserva | passo, escolhas, dados, chave de idempotência; `sessionStorage`, apagado no sucesso | — |
| 26 | Problem (erro) | Erro problem+json RFC 9457 | `type` (código), `title`, `status`, `detail`, `errors[]` (field, message), `request_id` | — |
| 27 | Tokens de acesso da equipe (sem modelo) | Setup do dono, convite, reset | `kind` (owner_setup, invite, reset), `email`, `role`, `expires_at`, `valid` | [LACUNA] sem modelo persistente em M |
| 28 | `Onboarding` (calculado) | Progresso do cadastro da casa | `done`, `steps[]` (house, hours, layouts, booking, team; done, missing) | — |

Códigos de erro previstos (`Problem.type`): validation, slot_full, duplicate_reservation, invalid_transition, rate_limited, active_limit, customer_blocked, terms_outdated, session_expired, csrf_failed, party_too_large, needs_whatsapp, account_disabled, day_has_reservations, precondition_failed.

---

## 2. Regras de negócio da reserva (uma linha testável cada)

### 2.1 Fuso, relógio e calendário
- R01 · Todo cálculo de dia/horário usa `America/Sao_Paulo` (UTC−3, sem horário de verão). (R "Fuso"; M)
- R02 · Toda resposta que depende de hora traz `server_time`; o relógio do navegador nunca decide. (R; API info)
- R03 · Semana padrão: seg/ter `production` fechado; qua–sáb abre 19:00 com slots 19:00–21:30 de 30 em 30; dom fechado. (R "Semana padrão"; E10 #8)
- R04 · Montagem do dia: semana padrão → plano do dia substitui só o que define → evento publicado impõe o modo de reserva. (R "Como um dia é montado")
- R05 · Evento publicado numa data fechada (ex.: domingo) abre a casa nesse dia. (R)
- R06 · Plano de evento em rascunho não vale: a data segue como estava até publicar. (R)
- R07 · `closes_at` pode passar da meia-noite (ex.: 01:00). (API DayStatus)

### 2.2 Janela, antecedência, tempo de mesa
- R08 · Reserva aceita até `window_days` (30) dias à frente; fora → `reason=outside_window`. (R; E10 #7)
- R09 · Reserva aceita até `min_lead_min` (60) antes do horário; horário passado → slot `past` e some da lista. (R)
- R10 · Tempo de mesa por `duration_rules` (120 min para qualquer tamanho); a reserva ocupa de `starts_at` a `ends_at`. (R; E10 #3)
- R11 · `duration_min` e `party_max_online` do plano do dia valem só para reservas novas; as feitas guardam o que tinham. (R "Limites por demanda")
- R12 · `/availability/days` aceita intervalo de no máximo 62 dias (padrão from=hoje, to=from+13). (API)
- R13 · `party_size` na consulta de disponibilidade: 1 a 20. (API PartySize)

### 2.3 Combinados
- R14 · Os combinados são preenchidos pela API com `{tempo_de_mesa}`, `{tolerancia}`, `{cancelar_ate}` do dia e do grupo; nunca texto fixo. (R "Combinados")
- R15 · A reserva grava `terms_version` + `terms_values` + `terms_accepted_at`; `terms_version` é obrigatório no POST. (R; M; API ReservationCreate)
- R16 · `terms_version` diferente da vigente → erro `terms_outdated`. (API Problem) [inferido]
- R17 · Mudar combinados em Configurações cria versão nova; vale só para reservas novas. (R; API settings)

### 2.4 Mesas, vaga e estados
- R18 · A vaga é calculada sobre a planta do dia, não sobre planta fixa. (R)
- R19 · No site entram só mesas `bookable_online`, em área modo `tables`, aberta no dia, fora de `held_tables`; a equipe pode usar qualquer mesa. (R; API staff/availability)
- R20 · Na planta padrão o balcão fica para quem chega sem reserva. (R; E10 #4, #16)
- R21 · No site uma mesa serve se `min_seats ≤ pessoas ≤ max_seats`; a equipe usa qualquer mesa com lugar suficiente. (R)
- R22 · Junções (`combos`) entram só quando nenhuma mesa sozinha serve ou as que servem estão ocupadas; lugares = soma ou `max_seats` do combo. (R; API LayoutCombo)
- R23 · Opção livre = nenhuma mesa dela com reserva ativa (`pending` com mesa, `confirmed`, `offered`) sobrepondo o intervalo. (R)
- R24 · Estado do horário: ≥2 opções livres → `available`; 1 → `few_left`; 0 ou estouro de `max_covers_per_slot` → `full`. (R)
- R25 · Estado do dia: fechado → `closed`+motivo; evento `none` → `no_booking`; nenhum horário com opção (e lista cheia) → `full`; um só horário com opção ou todos `few_left` → `few_left`; senão `available`. (R)
- R26 · Alocação automática: a opção que sobra menos lugares; empate pela `priority`. (R)
- R27 · Pendente segura mesa provisória (se houver mesa que serve) até resposta ou prazo; pedido de grupo grande fica sem mesa. (R)
- R28 · `max_covers_per_slot` limita pessoas chegando no mesmo horário; `max_covers_night` limita o total da noite. (R; E10 #17)
- R29 · A disponibilidade pública nunca devolve nome, telefone ou mesa de outras reservas. (M)

### 2.5 Limites, duplicidade e grupo grande
- R30 · Pessoas de 1 a `party_max_online` (8), que o plano do dia ou `party_max` do evento podem baixar. (R; E10 #5)
- R31 · Acima do máximo → `party_too_large`; com `large_group_action=whatsapp` (padrão) a tela leva ao WhatsApp com mensagem pronta; com `request` vira pedido pendente sem mesa. (R)
- R32 · No máximo `max_active_per_phone` (2) reservas futuras ativas por telefone → senão `active_limit`. (R; API Problem)
- R33 · Uma reserva ativa por cliente, dia e horário; repetida → 409 `duplicate_reservation` com `existing`. (R; API ReservationConflict)
- R34 · Horário que lotou durante o preenchimento → 409 `slot_full` com `alternatives[]`. (API)
- R35 · Cliente `blocked` não reserva → `customer_blocked`. (API Problem; M)
- R36 · `name` 2–60 caracteres; `notes` ≤ 280. (API ReservationCreate; M)
- R37 · Walk-in (`walk_in_policy` counter, padrão): balcão se houver lugar; equipe senta pelo Salão (`POST /staff/floor/walk-ins`). (R; E10 #4)

### 2.6 Aprovação
- R38 · `approval_mode` ∈ auto, manual, rules (padrão rules). (R; API)
- R39 · Em `rules`, vira `pending`: grupo acima do máximo com `large_group_action=request`; cliente com ≥2 `no_shows`; evento com `requires_approval`. (R; E10 #5)
- R40 · Pendente expira em `pending_expiry_hours` (4) ou 2 h antes do horário, o que vier primeiro. (R)
- R41 · Pedido que precisaria de aprovação a menos de 3 h do horário não vira pendente: 4xx `needs_whatsapp`. (R)
- R42 · Aprovar/recusar só dono e gerente; recusa exige motivo e manda link para outro horário. (T permissões; R mensagens)

### 2.7 Lista de espera e oferta
- R43 · Entra na espera só se o horário está `full` e `waitlist_enabled`; fila por ordem de entrada (`waitlist=true` no POST). (R; API)
- R44 · Mesa que serve o grupo liberada (cancelamento, release, remarcação, planta maior) → o 1º da fila recebe `offered` com `offer_expires_at = agora + waitlist_offer_min` (10) e link `/espera?t=`. (R; E10 "oferece sozinho")
- R45 · Oferta só sai para horário que ainda não começou; mesa que vaga depois do início fica para walk-in. (R; E10 #24)
- R46 · Quem aceita tem a tolerância contada do horário ou do aceite, o que for mais tarde. (R)
- R47 · Aceitou a tempo → `confirmed` com mesa; aceite após vencer/repetido → 409. (R; API accept-offer)
- R48 · Recusou pelo link ("Não vou conseguir") → `canceled`, oferta passa ao próximo na hora. (R; API decline-offer)
- R49 · Não respondeu no prazo → `expired`, oferta passa ao próximo. (R)
- R50 · A equipe pode "virar reserva" (`action=confirm` com `table_codes`) quem está na fila. (R; API ReservationAction)
- R51 · A equipe pode disparar oferta manual (`POST /staff/waitlist/{id}/offer`), com o mesmo prazo. (API)
- R52 · No fechamento da noite, quem continua `waitlisted` → `expired`. (R)
- R53 · Em lista de evento, sem lugar para o grupo → `full` com lista de espera. (R "Mesas, lista e áreas")

### 2.8 Estados e transições (`ReservationStatus`: pending, confirmed, waitlisted, offered, declined, expired, canceled, completed, no_show)
- R54 · (nova) → `confirmed` quando há mesa e a regra permite (cliente ou equipe): mesa, mensagem, registro. (R)
- R55 · (nova) → `pending` quando a regra pede aprovação: mesa provisória, aviso à casa. (R)
- R56 · (nova) → `waitlisted` quando o horário está lotado: posição, mensagem. (R)
- R57 · `pending` → `confirmed` (casa aprova) / `declined` (casa recusa com motivo) / `expired` (sistema, prazo). (R)
- R58 · `waitlisted` → `offered` (sistema/casa) / `confirmed` (casa) / `expired` (fim da noite). (R)
- R59 · `offered` → `confirmed` (aceite) / `canceled` (recusa pelo link) / `expired` (prazo). (R)
- R60 · `pending|confirmed|waitlisted|offered` → `canceled`: cliente até `cancel_until_hours`, casa a qualquer hora; libera mesa, oferta à fila, mensagem. (R)
- R61 · `confirmed` → `completed` quando chegou e a noite fechou: +1 visita. (R)
- R62 · `confirmed` → `no_show` (casa ou sistema) quando passou da tolerância sem chegar: +1 falta, mesa liberada. (R)
- R63 · Qualquer outra transição → 409 `invalid_transition`. (R; API actions)
- R64 · Ações da equipe: approve, decline, confirm, reschedule, move_tables, cancel, arrived, seated, extra_tolerance, release, no_show, resend_confirmation, note. (API ReservationAction)

### 2.9 Andamento da noite e tolerância
- R65 · Aguardando = antes do horário; Atrasada = depois do horário até `tolerance_min` (15) + `extra_tolerance_min` (10, se avisou); depois = "Passou da tolerância". (R; E10 #2, #22)
- R66 · "Chegou" grava `arrived_at` e, se a mesa está livre, `seated_at`; "Sentou" é para quem chegou e esperou. (R)
- R67 · O tempo de mesa conta a partir do horário da reserva, não da chegada. (R)
- R68 · "Liberar mesa" (passou da tolerância) → `no_show` com falta; "Mesa vagou" → `release`, grava `left_at`, sem falta. (R)
- R69 · Mesa livre = `left_at` preenchido ou fim do tempo de mesa. (R)
- R70 · A tolerância é congelada na reserva (`tolerance_min`), mudar a configuração não altera reservas feitas. (M; R combinados)

### 2.10 Lembrete e confirmação do cliente
- R71 · Lembrete sai `reminder_offset_min` (180) antes da abertura do dia (16:00 para abertura 19:00) para toda reserva `confirmed` da noite. (R; E10 #21)
- R72 · Reserva criada depois do envio do lembrete não recebe lembrete. (R)
- R73 · Botão "Confirmo" → `customer_confirmation=yes`. (R)
- R74 · "Não vou mais" → `canceled` pelo cliente, mesmo depois do prazo de cancelamento. (R; E10 #6)
- R75 · "Vou atrasar um pouco" → soma `extra_tolerance_min` (10). (R)
- R76 · `/confirmar?t=` faz o mesmo que os botões; ali "Não vou mais" pede confirmação. (R; API links/confirm)
- R77 · A resposta pode ser trocada até o horário da reserva. (R; API)
- R78 · Sem resposta até `reply_deadline_offset_min` (30) antes da abertura → `no_reply` e alerta em Hoje; nada é cancelado sozinho. (R)

### 2.11 Cancelar e remarcar pelo cliente
- R79 · Cliente cancela até `cancel_until_hours` (2) antes, por Minhas reservas ou link de ação; depois → 409 "fale com a casa". (R; API links/cancel)
- R80 · O link de leitura (comprovante) nunca cancela → 403. (R; API)
- R81 · Remarcar segue o mesmo prazo; depois dele só a casa. (R; E10 #6)
- R82 · Remarcar confere a vaga de novo; com mesa muda e mantém o `code`; sem mesa nada muda. (R)
- R83 · Mudar o número de pessoas = remarcar com outro tamanho, se houver mesa. (R; E10 #27) [LACUNA: `ReservationCustomerAction` só tem `cancel|reschedule` com date/time, sem `party_size`]

### 2.12 Dia fechado, plantas e plano do dia
- R84 · A API não fecha um dia com reserva ativa → 409 `day_has_reservations`; a equipe remarca/cancela antes (uma a uma ou todas). (R; API day-plans; E10 #23)
- R85 · Ao fechar o dia, a lista de espera do dia é encerrada com mensagem. (R)
- R86 · Evento `private` publicado num dia com reservas segue a mesma regra do dia fechado. (R)
- R87 · Toda mudança que mexe em mesas/horário de datas com reserva exige simulação (`dry_run`) devolvendo `kept`, `moved`, `without_table`. (R; API)
- R88 · Vale para: plano do dia (incl. voltar à semana e várias datas), publicar/mudar/apagar evento, editar planta em uso, mudar horário da semana / planta padrão / tempo de mesa em Configurações. (R; API)
- R89 · Ordem de realocação: (1) mantém se as mesmas mesas existem, em área com mesas, cabem o grupo (combo só se a planta nova junta igual) ou mesma lista; (2) área virou lista → entra na lista se houver lugar; (3) senão a menor mesa livre da planta nova; reservas por horário, maiores primeiro. (R)
- R90 · Sem `confirm_conflicts`, gravar com reserva sem mesa → 409; com ele, a equipe assume esses casos. (R; API)
- R91 · `notify_affected=true` avisa pelo WhatsApp quem teve mesa/horário mexido. (API ConflictChoice)
- R92 · Planta com mais lugares dispara ofertas à espera do dia (`waitlist_offers`). (R; API DayPlanResult)
- R93 · Toda troca de planta fica no registro com antes e depois. (R)
- R94 · Planta só é arquivada se não é padrão de dia da semana nem está em plano do dia futuro → senão 409. (API layouts DELETE)
- R95 · Área `closed` na planta ou em `closed_areas` fica fora da vaga e da preferência de área. (R)
- R96 · Gravar Layout/DayPlan/Event/Settings com `version` velha → 412. (M; API IfMatch)

### 2.13 Eventos e lista
- R97 · Criar evento cria o plano do dia dele; duplicar evento copia plano e planta para outra data. (R; API)
- R98 · `private` mostra "Evento fechado"; `none` mostra "Entrada livre, sem reserva" (`no_booking`). (R; M)
- R99 · Em `list` as áreas com mesa somem do site; em `tables` as áreas em lista somem; `mixed` mostra as duas. (R)
- R100 · Capacidade da lista = `list_capacity` do evento ou soma das áreas em modo lista. (R)
- R101 · Lista: sobrando <20% da capacidade após o grupo → `few_left`; sem lugar → `full`. (R)
- R102 · Horários de chegada (`entry_times`) passados ou dentro da antecedência mínima saem da lista; limites por horário/noite também valem. (R)
- R103 · Reserva de lista guarda área, pessoas e horário de chegada, sem mesa. (R; M)
- R104 · Na porta: check-in grava `arrived_at` e `arrived_people` (chegada parcial); pode ser desfeito. (R; API)
- R105 · Quem chega fora da lista entra se houver lugar, já com chegada marcada; lista cheia → 409. (API guests POST)
- R106 · Remover evento não apaga reservas; o dia volta ao plano anterior, com simulação. (API events DELETE)
- R107 · Reserva de evento segue os mesmos estados, lembrete e cancelamento. (R)

### 2.14 Idempotência
- R108 · `POST /reservations` exige `Idempotency-Key` (uuid); mesma chave em 24 h devolve a mesma resposta sem criar outra. (R; API)
- R109 · `Idempotency-Key` também é obrigatório em POST staff/reservations, floor/walk-ins, waitlist/{id}/offer e events/{id}/guests. (API)
- R110 · O front gera a chave no passo Confirmar e guarda no `sessionStorage` até o sucesso. (R; M BookingDraft)

### 2.15 Tokens de link
- R111 · Cada reserva tem `view_token` (só leitura, compartilhável) e `action_token` (age; só em mensagens ao próprio cliente), aleatórios ≥128 bits, guardados como hash; nunca o `code`. (R; M)
- R112 · Nenhum token aparece no painel. (M)
- R113 · GET num link nunca muda nada; toda ação exige POST (prévia do WhatsApp abre a URL). (R; API)
- R114 · Link vale até 30 dias depois da reserva; vencido → 410. (R; API)
- R115 · Ação já feita mostra o resultado; só a resposta ao lembrete pode ser trocada, até o horário. (R)
- R116 · Token mínimo de 22 caracteres no path. (API Token)

### 2.16 Privacidade, saúde e retenção
- R117 · Restrição alimentar/alergia (`notes`, flag `dietary`) é dado sensível: campo opcional com aviso. (R; M)
- R118 · Dado de saúde visível só para salão no dia, gerente e dono. (R)
- R119 · Dado de saúde fica fora das exportações padrão. (R; API exports)
- R120 · Dado de saúde é apagado `sensitive_retention_days` (30) após a visita. (R; M)
- R121 · Dados pessoais guardados por `retention_months`, depois anonimizados (`anonymized_at`, fica só a estatística). (M) [LACUNA: valor padrão e o gatilho do job não definidos]
- R122 · Cliente vê só `ReservationPublic`: nunca `internal_notes`, `table_codes` ou dados de terceiros. (M)
- R123 · Papel `floor` vê só as reservas de hoje, primeiro nome, telefone mascarado, observações e marcadores. (M; API staff/reservations; E10 #25)
- R124 · Telefone completo só dono/gerente, via `reveal-phone`, que gera registro `customer.reveal_phone`. (API; T; E10 #25)
- R125 · `DELETE /me` cancela reservas futuras e anonimiza o cliente; `GET /me/data` baixa os dados (JSON). (API)
- R126 · Exportar reservas, lista de evento, cliente ou registro: só dono, pedindo a senha de novo, e fica no registro. (API; T)
- R127 · Anonimizar cliente pelo painel: só dono, com senha. (API; E10 LGPD)
- R128 · `marketing_opt_in` é consentimento separado da reserva. (M; E10) [LACUNA: nenhum campo no POST/verify nem endpoint para marcar a caixa]
- R129 · AuditLog é só inclusão; `changes` sem campos sensíveis; IP só como hash. (M)

**Total: 129 regras (R01–R129).**

---

## 3. Comportamentos automáticos (jobs, timers, mensagens)

| # | Comportamento | Gatilho | Efeito | Fonte |
| --- | --- | --- | --- | --- |
| A1 | Expirar pendente | `min(created + pending_expiry_hours, starts_at − 2h)` | `pending → expired`, libera mesa provisória, msg "Pendente vencido" | R |
| A2 | Oferta automática da espera | Mesa que serve o grupo liberada (cancel, release, remarcação, planta maior), antes do horário | 1º da fila `waitlisted → offered`, `offer_expires_at = agora + 10 min`, msg "Oferta da espera" com `/espera?t=` | R; E10 |
| A3 | Vencer oferta | `offer_expires_at` passou | `offered → expired`, msg "Oferta vencida", oferta ao próximo (A2) | R |
| A4 | Encadear após recusa | `decline-offer` | `canceled` + oferta imediata ao próximo | R |
| A5 | Lembrete do dia | `opens_at − reminder_offset_min` (16:00) | Para cada `confirmed` da noite: msg com 3 botões, `customer_confirmation=sent`; reservas criadas depois não recebem | R |
| A6 | Prazo de resposta | `opens_at − reply_deadline_offset_min` (18:30) | `sent` sem resposta → `no_reply` + alerta em Hoje; não cancela | R |
| A7 | Receber resposta do lembrete | n8n → `POST /internal/whatsapp/replies` (HMAC) | yes / no (cancela) / late (+10 min); feed do Hoje | API; R |
| A8 | No-show automático | Passou da tolerância sem chegada | `confirmed → no_show` ("casa ou sistema"), +1 falta. [LACUNA: momento exato em que o sistema age; o painel diz que a equipe escolhe] | R |
| A9 | Fechamento da noite | "Fim da noite" | `waitlisted → expired`; `confirmed` com chegada → `completed` (+1 visita). [LACUNA: gatilho do fechamento — `closes_at`? manual? — não definido] | R |
| A10 | Mensagens por transição | Confirmada, pendente, recusa, espera, cancelada (cliente/casa), mudou mesa/horário, remarcada | Envia template correspondente; registra em MessageLog | R "Mensagens" |
| A11 | Aviso à casa | Novo `pending` | Msg "Para a casa: pedido pendente" com `{link_painel}`. [LACUNA: destino (número da casa? qual?)] | R |
| A12 | Código de acesso | `POST /auth/otp` | WhatsApp com código de 6 dígitos (10 min) | API; R |
| A13 | Notificar afetados | Gravação de planta/plano/evento com `notify_affected` | Msg "Mudou a mesa ou o horário" | API |
| A14 | Encerrar espera de dia fechado | Dia fechado com fila | Fila encerrada com mensagem | R |
| A15 | Apagar dado de saúde | Visita + 30 dias | Remove `notes` sensíveis / flag `dietary` | R |
| A16 | Retenção | `retention_months` | Anonimiza cliente. [LACUNA: valor e job] | M |
| A17 | Recalcular estatísticas | Transições completed/no_show | `visits`, `no_shows`, `last_visit_at` | M |
| A18 | Processar imagem | Upload | Regrava, tira metadados, gera 9 variantes, placeholder; `processing → ready/failed` | API; M |
| A19 | Expirar idempotência | 24 h | Chave deixa de deduplicar | R |
| A20 | Expirar links/tokens | 30 dias (cliente); convite 72 h; reset 30 min; setup uso único | 410 | R; API |
| A21 | Reset de senha | Senha trocada | Outras sessões encerradas | API |
| A22 | Audit | Toda ação relevante | Insere AuditLog (ator "Salão" no tablet compartilhado) | M; E10 |
| A23 | Backup | Diário, guarda 30 dias, teste de restauração trimestral | Operacional, fora do contrato. [LACUNA técnica: não especificado em S/API] | E10 |

---

## 4. Mapa da API (`/api/v1`, 104 operações em 85 caminhos)

| Grupo (tag) | Ops | Caminhos / o que cobre | Quem acessa |
| --- | --- | --- | --- |
| Público | 5 | `/house`, `/menu`, `/content`, `/availability/days`, `/availability/slots` | Anônimo |
| Cliente | 9 | `/auth/otp`, `/auth/verify` (anônimos); `/auth/logout`, `GET/DELETE /me`, `/me/data`, `POST /reservations`, `/reservations/mine`, `PATCH /reservations/{code}` | Cliente com sessão `tr_customer` (+CSRF nas escritas) |
| Links | 5 | `GET /links/{token}`, `/confirm`, `/accept-offer`, `/decline-offer`, `/cancel` | Portador do token; ações só com `action_token` (view → 403) |
| Interno | 1 | `POST /internal/whatsapp/replies` | n8n, servidor a servidor, `X-Signature` HMAC. (Tag "Interno" não declarada na lista de tags) |
| Equipe · acesso | 16 | login, mfa, tokens/{token}, session, logout, setup, accept-invite, forgot, reset (7 anônimos); me GET/PATCH, password, me/mfa POST/DELETE, sessions GET/DELETE | Todos os papéis; setup só dono; convite gerente/salão |
| Equipe · operação | 33 | dashboard; reservations (GET, POST, export, {id}, actions); floor + walk-ins; availability; waitlist + offer; calendar; day-plans (GET, PUT lote, {date} GET/PUT/DELETE); events (GET, POST, PATCH, DELETE, duplicate, guests GET/POST, check-in POST/DELETE, guests export); customers (GET, {id} GET/PATCH, reveal-phone, export, anonymize) | Dono e gerente: tudo menos exports/anonymize (só dono). Salão: Hoje reduzido, reservas só de hoje, Salão ao vivo, walk-in, espera, porta do evento/check-in; agenda/eventos só ver; clientes só os da noite; sem aprovar/recusar, trocar planta ou ver telefone |
| Equipe · casa | 11 | areas GET/PATCH; layouts GET/POST, {id} GET/PATCH/DELETE, duplicate; settings GET, settings/{section} PATCH (house, hours, booking, terms, privacy); onboarding | Plantas: dono e gerente editam, salão vê. Configurações: dono edita, gerente vê. Onboarding: dono |
| Equipe · conteúdo | 18 | menu GET, categories POST/PATCH/DELETE, items POST/PATCH/DELETE, menu/publish; content GET, {block} PUT, publish, versions, restore; images GET/POST, {id} PATCH/DELETE, {id}/file PUT | Dono e gerente; salão só `PATCH items` com `available` ("tem hoje") |
| Equipe · administração | 6 | users GET, invite, {id} PATCH, revoke-sessions; audit GET, audit/export | Só dono; audit: gerente vê só as próprias ações |
| **Total** | **104** | | |

Notas:
- A matriz papel × endpoint não está no contrato: vem de `summary` ("dono", "salão só pode available") e de T. [LACUNA: matriz formal por operação, ex.: se o salão pode `no_show`, `release`, `offer`, `move_tables`.]
- Erros comuns: 401, 403 (papel), 404, 409 (conflito/transição/vaga), 410 (link vencido), 412 (versão), 413/415 (imagem), 422 (validação), 429 (`Retry-After`).
- Paginação por cursor, `limit` 1–100 (padrão 50).

---

## 5. Integrações externas

| Integração | Uso | Onde aparece |
| --- | --- | --- |
| WhatsApp Cloud API (Meta) | OTP de login do cliente; confirmação, pendente, recusa, espera, oferta, lembrete com 3 botões, cancelamentos, mudanças; aviso à casa | R "Mensagens"; API `/auth/otp`, `waitlist/offer`, `notify_affected`, `resend_confirmation`; E10 "Sobre o WhatsApp"; S. Templates precisam de aprovação Meta, cada template novo é nova aprovação; custo ~R$ 0,04/msg pago pela casa |
| n8n | Ponte entre API e WhatsApp; devolve respostas dos botões | API `/internal/whatsapp/replies` (HMAC `X-Signature`); S. [LACUNA: contrato de saída API→n8n (envio, callback de status do MessageLog) não especificado] |
| Supabase (Postgres, região SP) | Banco; migrações SQL numeradas | S; E10 "Servidor e banco" (plano gratuito no início). Não aparece no contrato |
| Aplicativo autenticador (TOTP) | Duas etapas da equipe (`otpauth_url`) | API `/staff/me/mfa`, `/staff/auth/mfa` |
| E-mail transacional (provedor não definido) | Convite (72 h), reset de senha (30 min), link de setup do dono | API staff/auth/*. [LACUNA: provedor e templates de e-mail não especificados] |
| Instagram | Link do perfil; "Pedir pelo direct" da lojinha | M (`instagram`), API ContentPublic `links.instagram/shop` |
| Google OAuth | "Entrar com Google" | API `google_login` em BookingRulesPublic/Settings. **[FORA]** (E10) |
| Pix | Sinal/ingresso | M/API `price_cents`. **[FORA]** |
| Mapa/geo | `address.lat/lng` | API Address. [LACUNA: provedor de mapa não definido] |
| Infra | VPS/nginx/certbot/uvicorn (S); domínio da casa + HTTPS (E10) | Registro de decisões de 07/10: servidor gratuito por ora |

---

## 6. Requisitos não funcionais implícitos

**Segurança e sessão**
- Cookies `httpOnly` + `Secure`; equipe `SameSite=Strict` (`tr_staff`), cliente `SameSite=Lax` (`tr_customer`, 90 dias com "lembrar aparelho"). (API)
- CSRF: `X-CSRF-Token` em toda escrita; token vem no login, no verify, em `GET /me` e `/staff/auth/session`; cada página do site chama `/me` ao abrir. (API)
- Front e API no mesmo domínio, sem CORS; painel em `/admin`. (S; API)
- Senhas da equipe ≥12 caracteres, só hash; login com erro genérico, bloqueio progressivo após 5 falhas, `account_disabled` 403; forgot sempre 202. (API)
- MFA opcional (TOTP); desligar pede senha; mudar papel pede senha; sempre sobra um dono. (API)
- Reautenticação por senha em exports e anonimização. (API)
- Sessões listáveis e revogáveis; reset encerra as outras. (API)
- Tokens de link ≥128 bits, guardados como hash; GET sem efeito colateral. (R; M)
- Concorrência otimista com `version`/If-Match (412). (M; API)
- Uploads: até 15 MB, regravados sem metadados, tipos restritos (415). (API)
- Webhook interno assinado por HMAC. (API)
- Auditoria imutável no banco, IP só em hash, `request_id` ligando ao log. (M)

**Anti-abuso / rate limit**
- OTP: 3 envios/h por número e por IP; reenvio após 30 s; código 10 min, 5 tentativas; só DDI +55, +595, +54. (API)
- Honeypot `website` e tempo mínimo de formulário (`started_at`) no POST de reserva. (API)
- 429 com `Retry-After` em OTP, verify, login, mfa e reserva. (API)
- Limite de reservas ativas por telefone (2) e duplicidade por cliente/dia/horário. (R)

**LGPD**
- Casa = controladora, Matheus = operador; política de privacidade versionada (`privacy_version`) aceita pelo cliente. (E10; M) [LACUNA: não há bloco/página de conteúdo para o texto da política nem endpoint público que a sirva]
- Direitos do titular: baixar dados (`/me/data`), apagar (`DELETE /me`, "resposta em até 15 dias; aqui é imediato"), anonimização pelo painel. (API; E10)
- Minimização: telefone mascarado por padrão, revelação auditada; dado de saúde com acesso restrito, fora de exportação, apagado em 30 dias. (R; M)
- Consentimento de marketing separado. (M; E10)

**Acessibilidade e UX de dados**
- `alt` obrigatório em toda imagem; ponto focal preservado nos recortes; placeholder de cor. (M; API)
- Erros por campo (`errors[].field/message`) em português para leitores de tela. (M)
- Variantes AVIF/WebP/JPG em 480/960/1600 px. (M)
- [LACUNA: nenhum alvo explícito de WCAG nos documentos lidos]

**Performance e operação**
- O front nunca calcula vaga; tudo vem da API. (API staff/availability)
- `/house` já entrega ontem, hoje e 14 dias resolvidos (evita chamadas extras). (API)
- Paginação por cursor, máx. 100. (API)
- Infra pequena (VPS ~1 GB, uvicorn 100–150 MB) → jobs e processamento de imagem precisam ser leves. (S)
- Backup diário 30 dias + teste de restauração trimestral; acompanhamento de erros. (E10) [LACUNA técnica]
- [LACUNA: sem metas de latência/disponibilidade]

**Fuso e tempo**
- Fuso fixo `America/Sao_Paulo`, UTC−3 sem horário de verão; instantes em UTC; relógio do servidor manda (`server_time`). (R; M; API)
- Horários depois da meia-noite (`closes_at` 01:00) pertencem à noite anterior. (API)

---

## 7. Resumo de lacunas e itens fora

**[LACUNA] (escopo 10 promete, contrato/modelos não cobrem bem)**
1. Lojinha (vitrine de peças + "Pedir pelo direct"): sem entidade nem endpoint; só `links.shop`. (E10 Site)
2. Mudar número de pessoas pelo cliente: `PATCH /reservations/{code}` não aceita `party_size`. (E10 #27)
3. Caixa "quero receber novidades": `marketing_opt_in` existe no modelo, mas não há campo no POST/verify nem endpoint para marcar/desmarcar. (E10)
4. Fallback sem WhatsApp: E10 diz que as reservas abrem "com confirmação pela página do site" se a Meta atrasar, mas o login do cliente é só OTP via WhatsApp; não há caminho alternativo de verificação nem de envio.
5. Gatilhos dos jobs: fechamento da noite (A9), no-show pelo sistema (A8), retenção (`retention_months` sem padrão) e saída API→n8n (envio, status do MessageLog) não especificados.
6. "Hoje na casa" com prato do dia (E10 #26, ajuste no painel): não há configuração para ligar/desligar nem campo explícito de "prato do dia" (só `featured`/`kind: dish`); `TodayRule` e `Notice` não têm endpoints próprios.
7. Eventos "com fotos das edições passadas": `Event` tem um único `image_id`; não há galeria por evento. Banco de fotos "escolhe onde aparece": `usages` é só leitura, sem endpoint para atribuir uso.
8. Matriz papel × operação não formalizada no contrato (salão pode `no_show`/`release`/`offer`?); ator "Salão" da conta compartilhada sem regra de `actor_label`.
9. Outras: texto público da política de privacidade; provedor de e-mail da equipe; provedor de mapa; backup/monitoramento; metas WCAG/latência; modelos de OTP, sessão do cliente e tokens da equipe.

**[FORA] (especificado, mas fora do módulo 1)**
- `google_login` (Entrar com Google) em BookingRulesPublic e HouseSettings.
- `price_cents` em Event (ingresso/sinal Pix).
- `Customer.email` (desligado na v1) / e-mail para cliente.
- Uso de `marketing_opt_in` para campanhas, aniversários (módulo Clientes e WhatsApp).
- Edição de `messages.templates` (só leitura na v1; E10 #20 "regra do sistema").
- Propor outro horário na recusa (a recusa só leva `{link_reservar}`).
- Almoço de sábado: o modelo já só tem um `opens_at` por dia (coerente).
