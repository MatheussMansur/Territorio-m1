# Modelos de dados

Os modelos que o front usa (tipados em JSDoc em [`src/types/models.js`](../src/types/models.js)), que o mock devolve e que o backend vai implementar. O contrato completo está em [api/openapi.yaml](api/openapi.yaml).

**Convenções**

- `id` em UUID; toda entidade tem `house_id` (pronto para mais de uma casa).
- `created_at` e `updated_at` em UTC, ISO 8601.
- Dia e horário de reserva no fuso da casa: `date` = `YYYY-MM-DD`, `time` = `HH:MM`. O fuso é fixo: `America/Sao_Paulo`.
- Dinheiro em centavos (`price_cents`).
- Valores fixos (status, papéis, origens) em inglês, minúsculos.
- Plantas, plano do dia, eventos e configurações têm `version`: gravar com uma versão velha devolve 412 (alguém mudou antes).

## Reserva (`Reservation`)

| Campo | Tipo | Para que serve |
| --- | --- | --- |
| `code` | texto, ex. `TR-4821` | Código curto para falar e procurar. Não é segredo |
| `view_token` | texto aleatório (≥ 128 bits), guardado só como hash | Link de leitura do comprovante, que a pessoa pode compartilhar com quem vai junto |
| `action_token` | texto aleatório (≥ 128 bits), guardado só como hash | Link de ação (confirmar, cancelar, aceitar ou recusar a oferta); vai só nas mensagens para o próprio cliente. Nenhum dos dois aparece no painel |
| `customer_id` | uuid | Quem reservou |
| `party_size` | inteiro | Quantas pessoas |
| `date`, `time` | `YYYY-MM-DD`, `HH:MM` | Dia e horário no fuso da casa |
| `starts_at`, `ends_at` | instante UTC | Início e fim da mesa, para calcular sobreposição |
| `duration_min` | inteiro | Tempo de mesa do dia e do grupo, congelado no momento da reserva |
| `area_preference` | `salao`, `quintal`, `balcao` ou vazio | Preferência, sem garantia |
| `table_codes` | lista de códigos (`S1`, `Q3`) | Mesas atribuídas na planta do dia; provisórias enquanto pendente (quando há mesa que serve); vazio na espera, na lista de um evento e no pedido de grupo grande |
| `area_key` | `salao`, `quintal`, `balcao` | Área da reserva; nas áreas em lista é o que vale, sem mesa |
| `status` | enum | Ver [04-regras-reserva.md](04-regras-reserva.md) |
| `source` | `site`, `staff`, `whatsapp`, `phone`, `walk_in` | De onde veio |
| `customer_confirmation` | `not_sent`, `sent`, `yes`, `no`, `no_reply` | Resposta ao lembrete do dia |
| `tolerance_min`, `extra_tolerance_min` | inteiros | Tolerância congelada e o +10 de quem avisou |
| `arrived_at`, `seated_at`, `left_at` | instante UTC | Andamento da noite |
| `arrived_people` | inteiro | Quantos entraram, quando chega só parte do grupo (lista na porta) |
| `notes` | texto até 280 | O que o cliente escreveu |
| `internal_notes` | texto | Só a equipe vê |
| `flags` | lista: `birthday`, `high_chair`, `accessibility`, `dietary` | Marcadores rápidos |
| `event_id` | uuid ou vazio | Reserva ligada a um evento |
| `waitlist_position`, `offer_expires_at` | inteiro, instante | Fila e prazo da oferta de mesa |
| `canceled_by`, `cancel_reason`, `decline_reason` | `customer`, `staff`, `system`; textos | Quem cancelou ou recusou, e por quê |
| `terms_version`, `terms_values`, `terms_accepted_at` | texto, objeto, instante | Quais combinados foram aceitos e com que valores (tempo de mesa, tolerância, prazo de cancelamento) |
| `idempotency_key` | texto | Impede reserva dupla no mesmo envio |
| `created_by` | uuid ou vazio | Pessoa da equipe que criou, quando foi o caso |

O cliente só recebe a visão pública (`ReservationPublic`): código, dia, horário, pessoas, status, primeiro nome, tolerância, posição na fila e prazos. Nunca `internal_notes`, `table_codes` ou dados de outras pessoas.

A equipe recebe `ReservationStaff`, cortada pelo papel: o perfil do salão vê só as reservas de hoje, com o primeiro nome, o telefone mascarado, as observações e os marcadores.

Restrição alimentar e alergia (em `notes` ou no marcador `dietary`) são dado de saúde: ver "Dados de saúde" em [04-regras-reserva.md](04-regras-reserva.md).

## Cliente (`Customer`)

| Campo | Tipo | Para que serve |
| --- | --- | --- |
| `name` | texto | Como chamar |
| `phone_e164` | texto, único por casa | WhatsApp no formato internacional (`+5545999990000`); é a chave do cliente |
| `phone_verified_at` | instante | Quando o código confirmou o número |
| `email` | texto opcional | Desligado na v1 |
| `visits`, `no_shows`, `last_visit_at` | inteiros, instante | Calculados; usados na aprovação por regra |
| `tags` | lista: `regular`, `attention` | Marcadores da equipe |
| `internal_notes` | texto | Só a equipe vê |
| `blocked`, `blocked_reason` | booleano, texto | Bloqueio por abuso |
| `marketing_opt_in`, `opt_in_at` | booleano, instante | Consentimento separado para novidades |
| `privacy_version`, `privacy_accepted_at` | texto, instante | Qual política foi aceita |
| `anonymized_at` | instante | Dados pessoais apagados; fica só a estatística |

## Usuário da equipe (`User`)

| Campo | Tipo | Para que serve |
| --- | --- | --- |
| `name`, `email` | texto; e-mail único | Identificação e login |
| `role` | `owner`, `manager`, `floor` | Dono, gerente, salão |
| `status` | `invited`, `active`, `disabled` | Situação na equipe |
| `mfa_enabled` | booleano | Verificação em duas etapas |
| `last_login_at` | instante | Mostrado em Equipe |
| `invited_by`, `invite_expires_at` | uuid, instante | Convite e validade |

A senha nunca aparece em resposta da API; o servidor guarda só o hash. Sessões (`Session`: aparelho, criada em, visto por último, expira em) ficam no servidor.

## Disponibilidade (calculada, não guardada)

| Campo | Tipo | Para que serve |
| --- | --- | --- |
| `date` | `YYYY-MM-DD` | Dia consultado |
| `open`, `reason` | booleano; `production`, `closed`, `event`, `holiday`, `maintenance`, `outside_window`, `past` | Se abre e, se não, por quê |
| `state` | `available`, `few_left`, `full`, `closed`, `no_booking` | Situação do dia para o tamanho de grupo; `no_booking` é evento de entrada livre |
| `slots[]` | `time`, `state`, `waitlist_open` | Cada horário do dia |
| `areas[]` | `key`, `name`, `mode` | Áreas abertas no dia, para a preferência de área |
| `list` | `capacity`, `remaining`, `state`, `entry_times`, `waitlist_open` | A lista por pessoa da noite, quando o evento tem lista |
| `event` | `id`, `title`, `starts_at`, `booking_mode`, `party_max`, `requires_approval` | O evento do dia, se houver |
| `duration_min`, `tolerance_min`, `cancel_until_hours`, `party_max_online` | inteiros | Os valores do dia e do grupo, que preenchem os combinados |

A resposta nunca traz nome, telefone ou mesa de outras reservas.

## Plantas, plano do dia e eventos

A casa monta o salão de jeitos diferentes conforme o dia, a procura e o evento. Por isso não existe uma planta única: a casa guarda várias **plantas**, escolhe uma padrão para cada dia da semana e pode trocar a planta (e o resto) de uma data pelo **plano do dia**. Um **evento** tem o próprio plano do dia e diz como se reserva nele.

| Modelo | Campos | Para que serve |
| --- | --- | --- |
| `Area` | `key` (`salao`, `quintal`, `balcao`), `name`, `sort` | Os espaços físicos da casa |
| `Layout` (planta) | `name`, `description`, `areas[]`, `tables[]`, `combos[]`, `archived` | Uma forma de montar a casa: "Padrão", "Sem quintal", "Forró no quintal" |
| `Layout.areas[]` | `key`, `mode` (`tables`, `list`, `closed`), `list_capacity`, `bookable_online` | Como cada área funciona nessa planta: com mesas, com lista por pessoa (gente em pé, mesa comunitária) ou fechada |
| `Layout.tables[]` | `code`, `area`, `min_seats`, `max_seats`, `shape`, `x`, `y`, `bookable_online`, `priority` | As mesas dessa planta. O código (S1, Q3) é o que a equipe fala e o que a reserva guarda |
| `Layout.combos[]` | `codes`, `max_seats`, `label` | Mesas que se juntam nessa planta: S3 com S4, ou três mesas que viram uma comprida |
| `OpeningHours` | `weekday`, `open`, `opens_at`, `closes_at`, `slots`, `layout_id` | A semana padrão, com a planta padrão de cada dia |
| `DayPlan` (plano do dia) | `date`, `open`, `closed_reason`, `public_label`, `opens_at`, `closes_at`, `slots`, `layout_id`, `duration_min`, `max_covers_per_slot`, `max_covers_night`, `held_tables`, `closed_areas`, `party_max_online`, `event_id`, `internal_note` | Tudo que muda numa data: outra planta, outro horário, tempo de mesa menor, limite de pessoas por horário e na noite, mesas guardadas para quem chega sem reserva, área fechada (chuva), dia fechado (feriado, férias, evento fechado) |
| `Event` | `title`, `date`, `starts_at`, `ends_at`, `description`, `image_id`, `published`, `booking_mode`, `list_capacity`, `entry_times`, `party_max`, `requires_approval`, `price_cents`, `internal_note` | Território Convida: o evento aponta para o próprio plano do dia e diz como se reserva |

Campo vazio no plano do dia herda da semana padrão; um dia sem plano segue a semana. Dia fechado por vários dias (férias) é um plano do dia para cada data, criado de uma vez pela Agenda.

**Como se reserva num evento (`booking_mode`)**

| Modo | Como funciona | Exemplo |
| --- | --- | --- |
| `tables` | Reserva de mesa normal, com a planta do evento | Jantar especial com o salão montado de outro jeito |
| `list` | Lista por pessoa até a capacidade, sem mesa marcada; na porta a equipe marca quem chegou | Forró no quintal, com gente em pé e mesa comunitária |
| `mixed` | Mesas nas áreas em modo mesa e lista nas áreas em modo lista | Evento no quintal com o salão funcionando |
| `private` | Casa fechada ao público; o site mostra "Evento fechado" | Aniversário fechado |
| `none` | Sem reserva, entrada livre | Evento aberto na rua |

`price_cents` fica vazio na v1: ingresso ou sinal por Pix só entra se o Marcus decidir.

## Configuração da casa (`HouseSettings`)

| Grupo | Campos | Para que serve |
| --- | --- | --- |
| Casa | `name`, `address`, `whatsapp`, `instagram`, `timezone`, `locale` | Dados públicos e base das contas de horário |
| Reservas | `window_days`, `min_lead_min`, `party_max_online`, `large_group_action`, `approval_mode`, `approval_rules`, `pending_expiry_hours`, `tolerance_min`, `extra_tolerance_min`, `duration_rules`, `cancel_until_hours`, `max_active_per_phone`, `waitlist_enabled`, `waitlist_offer_min`, `walk_in_policy`, `reminder_offset_min`, `reply_deadline_offset_min` | As regras de [04-regras-reserva.md](04-regras-reserva.md) |
| Combinados | `terms.version`, `terms.items[]` (`title` e `text`, com `{tempo_de_mesa}`, `{tolerancia}` e `{cancelar_ate}`) | Texto aceito na reserva, com versão; a API preenche os valores do dia e do grupo |
| Privacidade | `retention_months`, `sensitive_retention_days`, `privacy_version` | Tempo de guarda, prazo do dado de saúde e política vigente |
| Mensagens | `templates` | Textos do WhatsApp (só leitura na v1) |

## Conteúdo do site

| Modelo | Campos | Para que serve |
| --- | --- | --- |
| `ContentBlock` | `block` (`cover`, `today`, `about`, `experience`, `notices`, `testimonials`, `links`, `seo`), `fields`, `status` (`draft`, `published`), `version`, `published_at`, `published_by` | Textos editáveis, com rascunho e histórico |
| `TodayRule` | `weekday`, `text` | "Toda quinta é dia de peixe fresco!" |
| `Notice` | `text`, `starts_at`, `ends_at` | Aviso com validade |
| `MenuCategory` | `name`, `subtitle`, `sheet_style` (`dark`, `light`, `default`), `sort`, `image_id` | Abas do cardápio e o desenho de cada folha |
| `MenuItem` | `category_id`, `name`, `description`, `price_cents` ou vazio, `price_label`, `badges`, `available`, `featured`, `sort` | Os pratos |

## Imagem (`Image`)

| Campo | Tipo | Para que serve |
| --- | --- | --- |
| `original_name`, `mime`, `width`, `height`, `bytes` | textos e inteiros | Dados do arquivo, com nome limpo |
| `focal_x`, `focal_y` | 0 a 1 | Ponto que nunca é cortado nos recortes |
| `alt` | texto obrigatório | Acessibilidade e busca |
| `credit` | texto | Fotógrafo |
| `usages` | lista | Onde a foto aparece |
| `variants` | lista | AVIF, WebP e JPG em 480, 960 e 1600 px |
| `placeholder` | cor | Pinta o espaço antes da foto chegar |
| `status` | `processing`, `ready`, `failed` | Processamento no servidor |

## Registro de ação (`AuditLog`)

| Campo | Tipo | Para que serve |
| --- | --- | --- |
| `occurred_at` | instante UTC | Quando |
| `actor_type`, `actor_id`, `actor_label` | `user`, `customer`, `system`; uuid; texto | Quem, com o nome da época |
| `action` | texto | Ex.: `reservation.approve`, `settings.update`, `customer.reveal_phone`, `auth.login_failed` |
| `entity_type`, `entity_id` | texto, uuid | O que foi mexido |
| `summary` | texto | Frase em português para a tela |
| `changes` | objeto | Antes e depois, sem campos sensíveis |
| `ip_hash`, `request_id` | textos | Origem sem guardar o IP puro; ligação com o log do servidor |

Somente inclusão: ninguém edita nem apaga, e isso é garantido no banco.

## Apoio

- **`MessageLog`:** reserva, canal, template, situação (`queued`, `sent`, `delivered`, `read`, `failed`), horário.
- **`BookingDraft`** (só no navegador): passo, escolhas, dados digitados e a chave de idempotência. Fica no `sessionStorage` e é apagado no sucesso.
- **Erro da API** (problem+json, RFC 9457): `type`, `title`, `status`, `detail`, `errors[]` com `field` e `message`.
