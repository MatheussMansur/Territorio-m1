# Revisão adversarial · spine de 14/10

- **Alvo:** `ARCHITECTURE-SPINE.md`, foco nas ADs novas ou emendadas (AD-9, 11, 12, 15, 19, 23, 26–34) e no encontro delas com AD-4, AD-5, AD-6, AD-17, AD-18 e AD-22.
- **Jogo:** para cada furo, duas unidades (histórias ou módulos) que obedecem todo AD ao pé da letra e ainda assim constroem de forma incompatível. Cada furo termina com o AD a criar ou apertar.
- O spine não foi editado.

## Veredito

**O núcleo aguenta; a camada nova abre 7 furos de severidade alta ou crítica.** Os mais perigosos estão onde a sessão de mesa (AD-28) encosta na reserva (AD-4) e na ocupação (AD-6): ali dá para construir dois "Chegou", dois "Liberar" e dois períodos de ocupação, todos legais pelo texto.

## Furos

### A1 · Dois "Chegou" — crítico

- **Unidade X (história "Reservas: ações da equipe"):** implementa um comando por valor de `ReservationAction`, como AD-4 manda. O enum do contrato tem `arrived` e `seated`; X grava `arrived_at`/`seated_at` e mantém `confirmed` (como em `04-regras-reserva.md`, que AD-4 manda seguir).
- **Unidade Y (história "Salão: Chegou"):** segue AD-28: `check_in` abre a sessão e, pelo PRD FR-44, põe a reserva em `completed` na hora.
- **Resultado:** a mesma reserva pode estar "chegou sem sessão" ou "completed com sessão", e o `night_close` (AD-19) marca `no_show` nas `confirmed` sem chegada: com X, quem chegou mas nunca "sentou" pode virar falta.
- **Apertar AD-4:** "`check_in` é o único caminho de chegada; `arrived` e `seated` saem do enum `ReservationAction`; `check_in` faz `confirmed → completed` e abre a sessão na mesma UoW; `undo_check_in` faz `completed → confirmed` por até `salao.undo_check_in_min` (padrão 15) e só sem nada pendurado." Atualizar a tabela de transições junto.

### A2 · Dois "Liberar" — crítico

- **X (`domain.reservations`):** `ReservationAction.release` ("mesa vagou") grava `released_at = left_at` na ocupação, como AD-6 descreve.
- **Y (`domain.floor`):** `POST /floor/sessions/{id}/release` encerra a sessão e, como AD-28 manda, chama `domain.occupancy` para soltar.
- **Resultado:** depois do `check_in`, a ocupação pertence à reserva e à sessão. Liberar por X deixa a sessão aberta (o `night_close` a fecha às 00:00 como "encerrada pelo sistema", estragando o giro de FR-48); liberar por Y deixa a reserva sem `left_at`. Os dois emitem `capacity_freed`? AD-4 diz que comando grava a tarefa; AD-28 não diz.
- **Criar regra no AD-28:** "Depois do `check_in`, a mesa só se libera pela sessão (`domain.floor.release`). `ReservationAction.release` sai do enum (ou é recusado com `409 invalid_transition` para reserva com sessão). Liberar a sessão grava `left_at` na reserva de origem e emite `capacity_freed` só se for antes do horário de alguma espera (FR-37)."

### A3 · Período da ocupação da sessão — crítico

- **X (`domain.floor`, walk-in e troca de mesa):** insere ocupação `[agora, 'infinity')` até liberar, para a mesa ficar "ocupada" na tela.
- **Y (`domain.availability`, reserva online às 21:30):** confia no `EXCLUDE` e oferece a mesa a partir das 21:30 porque o walk-in "devia" ter saído.
- **Resultado:** com X, toda reserva futura na mesa recebe `409` até alguém tocar "Liberar"; com a escolha oposta (período de 2 h), a sessão que estoura fica fora do banco e a recepção senta dois grupos.
- **Criar regra no AD-6/AD-28:** período da sessão = `[seated_at, min(seated_at + tempo de mesa, início da próxima ocupação da mesa))`, fixo; estouro não estende (vira "para liberar", FR-47, calculado na leitura); troca de mesa preserva o fim original. Critério de aceite: walk-in às 20:00 numa mesa reservada às 21:00 fica com período `[20:00, 21:00)` e a tela mostra "livre até 21:00".

### A4 · Sessão sem mesa (balcão em modo lista, evento em lista) — alto

- **X:** área balcão em modo lista (catálogo C, "nenhuma além do balcão"; FR-22 regra 4): reserva sem `table_codes`, contada por AD-18, sem linha de ocupação.
- **Y:** AD-28 diz que sessão tem "uma ou mais mesas". "Chegou" num lugar de lista (FR-56, ou walk-in no balcão de UJ-5) ou é recusado ou inventa uma mesa fictícia `BALCAO`.
- **Apertar AD-28:** "Sessão tem zero ou mais mesas; em área de modo lista guarda `area_code` e pessoas, sem ocupação." Ou "o balcão é sempre modo mesas, com bancos como mesas de 1 lugar". Escolher uma.

### A5 · Dedupe da outbox × reenvio e mensagens prontas — alto

- **X (AD-5):** chave `<template>:<entity_id>:<date>:<versão após o comando>`.
- **Y (FR-30 "pode ser reenviado pela equipe", FR-34 "Sua mesa está pronta", FR-20 "reenvio do código depois de 30 s"):** `resend_confirmation` e `notify` não mudam a reserva; a versão é a mesma; o código não tem `entity_id` de reserva.
- **Resultado:** ou o reenvio é engolido pela unicidade, ou cada história inventa um sufixo (`:resend:<uuid>`, incremento artificial de `version`), e a garantia "não enfileirar duas vezes" vira letra morta.
- **Apertar AD-5:** "Chave = `<template>:<entity_id>:<date>:<versão>:<seq>` em que `seq` é 0 para envio automático e o id do comando para envio pedido pela equipe; o código usa `otp:<otp_id>`, um `otp_id` por envio." Também: "o teto diário da casa (catálogo G, 300) e o de códigos (FR-20) são conferidos na inserção da outbox, por `domain.messages`".

### A6 · Dois donos do status da mensagem — médio

- AD-12: eventos de status "atualizam a outbox e o `MessageLog`". Uma história lê a situação de FR-30 do `outbox.status`, outra do `MessageLog`; a `retention_sweep` apaga texto da outbox aos 30 dias mas não diz nada do `MessageLog`.
- **Apertar AD-12:** "`outbox` é a única linha por mensagem; `MessageLog` é uma visão sobre ela." Ou dizer qual tabela é dona e que a outra não existe.

### A7 · Limite por telefone entre noites e ordem de travas — alto

- **X:** cliente reserva sexta na aba 1; **Y:** sábado na aba 2. AD-18 trava `nights(sexta)` e `nights(sábado)`, linhas diferentes; as duas leem "1 reserva futura" e passam de `max_active_per_phone = 2`.
- **Segundo par:** plano do dia em vários dias (FR-50) trava noites em ordem de data da lista; um `reschedule` de sábado para sexta trava sábado e depois sexta. AD-17 só fixa "noite antes de reserva"; deadlock entre os dois.
- **Apertar AD-17/AD-18:** "Ordem de travas: `customers` (por id) → `nights` em ordem crescente de `date` → reservas por id. Criação ou mudança com telefone trava a linha do cliente antes de contar `max_active_per_phone`."

### A8 · Identidade: equipe digita telefone de outra pessoa — alto

- **X (FR-41, reserva da equipe):** `resolve(phone, name, verified=false)` faz upsert por `phone_e164` e liga a reserva ao cliente **verificado** dono do número (AD-22: "sem trocar o nome já verificado").
- **Y (FR-28 "Minhas reservas", AD-30):** lista as reservas do `customer_id`.
- **Resultado:** um erro de digitação da recepção põe a reserva de um estranho em "Minhas reservas" do cliente verificado, e um `no_show` dela faz as próximas reservas dele nascerem `pending` (FR-22). Em FR-27, trocar o telefone para um número que já existe como cliente não verificado: uma história funde, outra devolve 409.
- **Apertar AD-22:** "Reserva guarda `phone_verified` própria. Reserva com telefone não verificado não aparece em Minhas reservas e não conta falta para o cliente verificado do mesmo número até ele confirmar pelo link. Troca de telefone para número de cliente existente: verificado = 409 `phone_in_use`; não verificado = fusão por `domain.customers.merge`, única."

### A9 · Assinatura do aparelho sem formato — alto

- AD-26: "toda requisição leva a assinatura do aparelho". Não diz o que é assinado. O front (`services/api`) assina `method + path`; o back confere `method + path + sha256(body) + timestamp`. Ou ninguém põe timestamp e uma requisição capturada é reaproveitada.
- E o `EventSource` do AD-27 não manda cabeçalho, então o stream da recepção ou fica sem assinatura (furando AD-26) ou não funciona.
- **Apertar AD-26:** "Cabeçalho `X-Device-Signature` = ECDSA-P256-SHA256 sobre `METHOD\nPATH?QUERY\nX-Device-Time\nbase64(sha256(body))`; servidor recusa relógio fora de ±60 s e `(device_id, time, nonce)` repetido." Apertar AD-27: "stream por `fetch` em fluxo pela porta de API, assinado como qualquer GET; nada de `EventSource`."

### A10 · Cookies de dois tipos de sessão de equipe no mesmo navegador — médio

- O Marcus entra pelo acesso pessoal no computador da recepção (FR-73). AD-9 dá um cookie de equipe; se pessoal e aparelho usam o mesmo nome, o login pessoal derruba a sessão do aparelho e a recepção perde o PIN ativo.
- **Apertar AD-9:** nomes fixos `__Host-staff` (pessoal), `__Host-device` (aparelho), `__Host-cust` (cliente); toda rota declara qual lê; com os dois presentes, vale o pessoal e o do aparelho fica intacto.

### A11 · Configuração "Todas" × combinados aceitos — médio

- AD-29: tolerância é "Todas" (lida ao vivo). AD-29/FR-62: a reserva guarda a versão dos combinados, cujo texto traz `{tolerância}`. O dono baixa de 20 para 10: o lembrete (AD-12, variável `{{tolerancia_min}}`) e a tela (FR-46) usam 10, o comprovante e os combinados aceitos dizem 20.
- Uma história de salão lê `settings.get('booking').tolerance`, outra lê da versão dos combinados da reserva.
- **Apertar AD-29:** "Valor que aparece nos combinados é sempre 'Futuras' para a reserva que os aceitou: a reserva copia `tolerance_min`; 'Todas' só vale para aumentar." Ou declarar explicitamente que a reserva segue o valor ao vivo e o texto dos combinados diz "conforme a regra vigente".

### A12 · Settings "Sim" sem simulação — alto

- **X (história Configurações, AD-29):** `PATCH` no grupo de horários com `If-Match`, grava, registra antes/depois.
- **Y (história Plano do dia, AD-25):** toda mudança que afeta reservas passa pela simulação com `simulation_hash`.
- **Resultado:** mudar "último horário de chegada" de 21:30 para 21:00 pelo grupo deixa reservas das 21:30 sem horário válido e sem passar por `move_tables`/`reschedule`.
- **Apertar AD-29:** "Grupos marcados 'Sim' no catálogo só gravam por `domain.plans.apply_change` (AD-25); `domain.settings` recusa com `409 needs_simulation`."

### A13 · Registro com diff × registro sem PII — alto

- **X (AD-29):** grava no registro "o antes e o depois" do grupo `avisos à equipe` (números pessoais) e `casa` (WhatsApp).
- **Y (AD-11):** registro "guarda só ids, `action` e o rótulo do ator", com teste que procura telefone nas colunas.
- **Resultado:** ou X põe o diff numa tabela paralela (dois registros), ou o teste de Y quebra, ou X grava o telefone e o registro, que não se apaga (AD-11), passa a guardar dado pessoal por 12 meses.
- **Apertar AD-11:** "coluna única `diff jsonb`; campos marcados `pii: true` no schema do grupo viram `\"<alterado>\"`; o teste de PII cobre `diff`."

### A14 · Linha do tempo da sessão × registro de ações — médio

- AD-28: `table_session_events`, só de inclusão, com "quem fez". AD-11: o registro guarda toda ação do painel com ator e `device_id`.
- Uma história de giro (FR-48, FR-69) lê `table_session_events`; a tela de registro (FR-76) lê `audit_log`. Uma troca feita só por um dos caminhos some do outro.
- **Apertar AD-28:** "Todo comando de `domain.floor` grava as duas linhas na mesma UoW: o evento (dados operacionais: horários, pessoas, mesas) e o registro (`action`, ator, `device_id`). Nenhum dos dois é derivado do outro."

### A15 · Retenção do registro × registro intocável — crítico

- **X (AD-11):** sem `DELETE` para `territorio_app`, gatilho barra.
- **Y (AD-19 `retention_sweep`, FR-60, catálogo M):** apaga registro com mais de 12 meses, rodando no laço como `territorio_app`.
- **Apertar AD-11:** função `app.prune_audit(before)` `SECURITY DEFINER` dona de `territorio_owner`, única exceção ao gatilho, com `before ≥ agora − 6 meses` conferido dentro dela.

### A16 · Anonimizar fora do domínio de reservas — alto

- AD-11: `domain.customers.anonymize` "cancela as reservas futuras sem mensagem". AD-4: toda mudança em reserva passa por `domain.reservations`; cancelamento grava ocupação, `capacity_freed` e registro.
- Uma história faz `UPDATE reservations SET status='canceled'` dentro de `customers` (não chama a espera, não solta a ocupação); outra chama `reservations.cancel`. Além disso FR-29 manda **avisar** e criar pedido de 15 dias.
- **Apertar AD-11:** "`anonymize` chama `reservations.cancel(notify_customer=true)` por reserva futura e só então anonimiza; o pedido do titular é `privacy_requests`, dono `domain.customers`."

### A17 · Hora real das ações lançadas depois da queda — alto

- FR-79: "as ações feitas no papel durante a queda são lançadas depois, com a hora real". AD-28: o servidor grava `occurred_at` do aparelho "e decide pela própria hora".
- Uma história grava `seated_at`/`left_at` com `occurred_at` (para o giro); outra grava com `now()` (como AD-28 diz) e o giro de FR-48 sai errado. E `undo_check_in` 15 min conta de qual?
- **Apertar AD-28:** "Para `check_in` e `release`, a equipe pode informar `occurred_at` até 6 h no passado, dentro da noite; ele vira `seated_at`/`left_at` e o período da ocupação. Prazos (desfazer, tolerância) contam da hora do servidor. O registro guarda as duas."

### A18 · Configuração lida de dois jeitos para sessões — médio

- AD-26 lê inatividade do grupo `acesso`; o catálogo O tem 12 h de sessão no computador e 30 dias "manter conectado"; FR-26 dá 90 dias ao cliente. AD-9 não diz quem calcula `expires_at`.
- Uma história grava `expires_at` na criação; outra confere `created_at + settings.get('access').session_hours` a cada requisição (mudar a configuração derruba todo mundo).
- **Apertar AD-9:** "`expires_at` é gravado na criação a partir de `access` (equipe) ou fixo de 90 dias (cliente), com renovação deslizante só na sessão de cliente; mudar a configuração vale para as sessões novas."

### A19 · Lembrete por noite × lembrete relativo à reserva — alto

- AD-19: `night_reminder` por noite. Catálogo G: hora "fixa ou relativa à abertura **ou ao horário da reserva**".
- Ligar "relativo à reserva" obriga uma história a criar tarefa por reserva (`reservation_reminder`), o que AD-19 diz ser exatamente a divergência de granularidade que ele impede.
- **Apertar AD-19:** ou tirar "relativo ao horário da reserva" do catálogo, ou declarar que `night_reminder` roda a cada horário de chegada da noite (uma tarefa por `date`+`slot`, chave `night_reminder:<date>:<HH:MM>`).

### A20 · Pedido de preview em duas formas — médio

- AD-29: `POST /settings/{group}/preview`. Contrato existente: `PATCH /staff/settings/{section}?dry_run=true`. Convenção "Caminhos da API": o contrato manda. Uma história faz a rota do AD, outra usa `dry_run`.
- **Apertar AD-29:** remover a rota do texto e citar a do contrato (ou mudar o contrato primeiro, AD-2).

### A21 · Foto substituída com o mesmo endereço — médio

- AD-13: conteúdo referencia por `image_id`; FR-65 "substituir mantendo os usos". AD-14: `/media/*` com `max-age=604800`. Se a história de galeria regrava os arquivos no mesmo caminho, o site mostra a foto velha por 7 dias.
- **Apertar AD-13:** "arquivo publicado leva hash do conteúdo no nome; substituir gera arquivos novos e o `site_render`."

## Resumo das ADs a criar ou apertar

| Furo | Severidade | AD |
| --- | --- | --- |
| A1 dois "Chegou" | crítico | AD-4 (+ tabela de transições, enum) |
| A2 dois "Liberar" | crítico | AD-28, AD-4 |
| A3 período da sessão | crítico | AD-6/AD-28 |
| A15 retenção do registro | crítico | AD-11 |
| A4 sessão sem mesa | alto | AD-28 |
| A5 dedupe × reenvio | alto | AD-5 |
| A7 limite por telefone, ordem de travas | alto | AD-17, AD-18 |
| A8 identidade por telefone não verificado | alto | AD-22 |
| A9 formato da assinatura, SSE | alto | AD-26, AD-27 |
| A12 settings "Sim" | alto | AD-29 |
| A13 diff no registro | alto | AD-11 |
| A16 anonimizar fora do domínio | alto | AD-11, AD-4 |
| A17 hora real | alto | AD-28 |
| A19 lembrete relativo | alto | AD-19 |
| A6, A10, A11, A14, A18, A20, A21 | médio | AD-12, AD-9, AD-29, AD-28, AD-9, AD-29, AD-13 |
