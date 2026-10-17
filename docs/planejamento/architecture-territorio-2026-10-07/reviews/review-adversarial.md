---
title: Revisão adversarial da espinha de arquitetura
alvo: ARCHITECTURE-SPINE.md (status draft, 2026-10-08)
data: 2026-10-08
método: pares de unidades um nível abaixo (histórias construídas em sessões separadas) que obedecem todas as ADs ao pé da letra e mesmo assim não encaixam
fontes: prd.md, addendum.md, 03-modelos.md, 04-regras-reserva.md, api/openapi.yaml, src/
---

# Revisão adversarial · Território, módulo 1

## Resumo

| Gravidade | Buracos |
| --- | --- |
| Crítica | 5 |
| Alta | 14 |
| Média | 11 |
| Baixa | 3 |
| **Total** | **33** |

**Crítica** = as duas unidades passam nos testes sozinhas e juntas produzem reserva dupla, mesa presa ou dado errado em produção. **Alta** = retrabalho de esquema, de contrato ou problema de LGPD quando a segunda unidade chegar. **Média** = divergência que um revisor atento pega, mas que nenhuma AD obriga a pegar. **Baixa** = deriva pequena de contrato.

Cada item traz: as duas unidades, por que as duas obedecem às ADs, onde quebram, e a regra (uma frase) que fecha o buraco. As regras estão escritas para entrar na espinha como AD nova ou como reforço de uma AD existente (indicada entre colchetes).

---

## Críticas

### C-1 · A ocupação de mesa aponta para a mesa da planta, e a planta muda

- **Unidade A, "trocar a planta da noite" (FR-58):** grava `day_plans.layout_id` novo e realoca `table_codes` das reservas.
- **Unidade B, "nova reserva" (FR-17):** insere `table_occupancy(table_id, tstzrange)` com o `table_id` da mesa da planta do dia, como o ER sugere (`LAYOUT ||--o{ TABLE`, `TABLE ||--o{ TABLE_OCCUPANCY`).
- **Por que obedecem:** AD-6 diz "uma linha por mesa × intervalo", sem dizer o que é "mesa". A tem a mesa `S1` da planta "Padrão" e B a `S1` da planta "Sem quintal", que são linhas diferentes de `tables`.
- **Onde quebra:** as ocupações antigas continuam apontando para os `table_id` da planta anterior. A exclusion constraint compara `table_id` diferentes e deixa entrar uma segunda reserva na `S1` física. É exatamente a reserva dupla que a AD-6 existe para impedir.
- **Regra [reforça AD-6]:** a ocupação é chaveada pela mesa física (`house_id`, `table_code`) e pelo `tstzrange`, nunca pelo `id` da mesa de uma planta. Toda troca de planta reescreve as ocupações das reservas afetadas na mesma transação.

### C-2 · "Mesa vagou" não muda status, e a constraint só olha o status

- **Unidade A, "noite no painel · mesa vagou" (FR-51):** ação `release`, grava `left_at`. Pela tabela de `04`, o status continua `confirmed`, porque não existe transição de `release`.
- **Unidade B, "sentar sem reserva" (FR-50):** `POST /staff/floor/walk-ins` na mesa que o Salão ao vivo mostra livre.
- **Por que obedecem:** AD-4 só governa mudança de status, e `release` não muda status. AD-6 diz que a constraint "vale só para estados ativos", e `confirmed` é ativo.
- **Onde quebra:** a ocupação da reserva que foi embora continua valendo até `ends_at`. O walk-in leva `409` numa mesa que a tela mostra livre. Além disso, uma exclusion constraint não enxerga o status de outra tabela. Cada sessão vai inventar a própria coluna de "ativo" na ocupação (uma copia o status, outra apaga a linha, outra corta o intervalo).
- **Regra [nova AD-6b]:** a tabela de ocupação tem dono único, `domain/occupancy`, que é o único que insere, corta (`upper = left_at`) ou apaga linhas. A constraint usa uma coluna própria da ocupação (`released_at IS NULL`), atualizada só por ele e chamada por toda ação que libera ou prende mesa (transição, `release`, `move_tables`, `reschedule`, oferta, walk-in).

### C-3 · Metade das mudanças na reserva não é transição

- **Unidade A, "lembrete" (worker):** grava `customer_confirmation = sent` direto no repositório depois de inserir na outbox.
- **Unidade B, "resposta pelo webhook" (FR-22):** grava `yes` / `late` (soma `extra_tolerance_min`) por outra função do domínio.
- **Unidade C, "/confirmar?t=" (FR-23):** terceira função, com registro de ação próprio.
- **Por que obedecem:** AD-4 cobre só o status. `arrived`, `seated`, `extra_tolerance`, `move_tables`, `reschedule` (que mantém o status), `note`, `resend_confirmation`, check-in e as respostas ao lembrete não são transições. AD-3 só exige "regra no domínio", e cada uma está no domínio.
- **Onde quebra:** três caminhos para o mesmo campo, com registros e mensagens diferentes. O "vou atrasar" pelo botão soma 10 e pela página fixa em 10. O painel mostra "sem resposta" para quem respondeu pelo link porque o worker sobrescreveu com `sent`.
- **Regra [amplia AD-4]:** toda mudança numa reserva, com ou sem troca de status, passa por um comando de `domain.reservations` (um por valor de `ReservationAction`, mais `answer_reminder`, `check_in`, `undo_check_in` e `create`), com o mesmo contrato transacional da AD-4. O repositório não expõe `update` genérico de reserva.

### C-4 · `night_date` existe na AD e não existe nos dados

- **Unidade A, "fechar a noite" (worker, FR-42):** roda no `closes_at` (por exemplo 01:00) e busca `WHERE date = hoje_em_SP`. À 01:00, "hoje" já é o dia seguinte.
- **Unidade B, "Hoje no painel" (FR-45):** `GET /staff/dashboard?date=` com o "hoje" do servidor. Às 00:30, o tablet mostra uma noite vazia, e o perfil do salão ("só hoje") perde acesso às reservas que ainda estão na casa.
- **Unidade C, walk-in às 00:30:** grava `date` = data do calendário.
- **Por que obedecem:** AD-7 diz que "o que passa da meia-noite pertence à noite anterior", mas não diz até que hora, nem qual função calcula isso, nem que o campo `date` do contrato **é** a `night_date`. `03-modelos.md` só tem `date`. O front tem a própria `todayInHouse()`.
- **Onde quebra:** as reservas da noite não fecham (nem `completed` nem `no_show`), o SM-2 conta errado, e o lembrete, o fechamento e a limpeza da lista de espera usam dias diferentes.
- **Regra [reforça AD-7]:** `night_date` é o nome canônico do campo `date` da reserva, do walk-in, do plano do dia e do registro da noite. Só `domain.night.night_of(instante)` o calcula, com o corte no `closes_at` do plano do dia ou às 06:00, o que vier antes. `starts_at` sai só de `domain.night.instant(night_date, "HH:MM")`, que soma um dia para horas antes do corte. O "hoje" de toda rota é `night_of(agora)`.

### C-5 · A oferta da lista de espera pode não segurar mesa

- **Unidade A, "oferta pela equipe" (FR-94, entrega 2):** `POST /staff/waitlist/{id}/offer` com `table_codes` **opcional** no contrato. Sem mesa, vira `offered` sem ocupação.
- **Unidade B, "aceitar oferta" (FR-26, entrega 3):** atribui a mesa no aceite ("`offered` → `confirmed`: Mesa atribuída", tabela de `04`).
- **Por que obedecem:** `04` lista `offered` como estado ativo que ocupa mesa, mas a tabela de transições diz que a mesa é atribuída no aceite. As duas leituras cumprem AD-4 e AD-6.
- **Onde quebra:** duas ofertas para a mesma mesa (equipe e worker, ou duas pessoas da equipe), o primeiro aceita e o segundo leva `409` depois de ter recebido "Abriu uma mesa pra você!". Ou, se a oferta prende mesa, um walk-in leva `409` numa mesa que ninguém aceitou ainda, sem que a tela saiba explicar.
- **Regra [reforça AD-4 e AD-6]:** `offered` sempre tem `table_codes` e grava a ocupação na própria transição de oferta. O aceite só troca o status, e o vencimento ou a recusa liberam a ocupação pelo `domain/occupancy`.

---

## Altas

### A-1 · Duas chaves de idempotência com o mesmo nome

- **Unidade A, "oferta pela equipe":** usa o `Idempotency-Key` do HTTP como chave da linha na outbox.
- **Unidade B, "lembrete" (worker):** usa `reminder:{reservation_id}`.
- **Por que obedecem:** AD-5 diz "cada linha tem chave de idempotência", e AD-10 diz "POST aceita `Idempotency-Key`". Nenhuma diz como a chave da outbox é formada.
- **Onde quebra:** depois de um remarcar para outra noite, a chave `reminder:{id}` já existe e o lembrete da noite nova não sai. Com a chave do HTTP, dois cliques da equipe com chaves diferentes (aba recarregada) mandam duas ofertas.
- **Regra [reforça AD-5]:** a chave da outbox é determinística, `{template}:{entity_id}:{night_date}:{versão_da_entidade_após_o_comando}`, e nunca reaproveita o `Idempotency-Key` do HTTP, que só deduplica a resposta da rota.

### A-2 · Onde se guarda o `Idempotency-Key` e em que transação

- **Unidade A, "reserva pelo site":** grava a chave na coluna `reservations.idempotency_key` (está em `03-modelos.md`) com índice único.
- **Unidade B, "walk-in" e "entrada na porta":** um middleware genérico grava numa tabela `idempotency_keys` **depois** do commit da rota.
- **Por que obedecem:** AD-10 diz "guardada 24 h com o hash do corpo" e não diz onde, com que escopo nem em que transação.
- **Onde quebra:** dois formatos de replay. Uma queda entre o commit e a gravação da chave cria duplicata. E sem escopo, a chave de um cliente colide com a do tablet "Salão", que é uma sessão compartilhada.
- **Regra [reforça AD-10]:** uma tabela só, `idempotency_keys(house_id, actor_scope, route, key, body_hash, status, response, expires_at)`, gravada na **mesma** transação da criação. O campo `Reservation.idempotency_key` sai do modelo.

### A-3 · Tarefa agendada que já não vale

- **Unidade A, "lançar reserva pela equipe" (FR-91):** cria na hora a tarefa `reminder` com `run_at` = 16:00 da noite e a de `pending_expiry`.
- **Unidade B, "mudar o plano do dia" (FR-59):** muda `opens_at` para 20:00, ou o cliente remarca para outra noite.
- **Por que obedecem:** AD-5 diz "agendar = inserir em `scheduled_tasks` com `run_at`", sem regra de cancelamento nem de revalidação.
- **Onde quebra:** o lembrete sai às 16:00 em vez de 17:00, ou sai para a noite antiga. A pendente vence pelo prazo velho. Um terceiro dev escolhe "uma tarefa de varredura por noite" e os dois modelos convivem.
- **Regra [nova AD-5b]:** toda tarefa tem chave `{kind}:{entity_id}` (substituída quando o comando que a motiva roda de novo) e todo executor recarrega a entidade e confere status, `night_date` e versão antes de agir, virando no-op se algo mudou. Lembrete, fechamento da noite e limpeza são varreduras por `night_date`, não por reserva.

### A-4 · Fronteira de transação do laço e a trava no pooler

- **Unidade A, "outbox":** manda o HTTP para a Meta dentro da transação que marca `sent`. Se cair depois do envio e antes do commit, manda de novo, e a chave no nosso banco não segura a Meta.
- **Unidade B, "laço":** pega `pg_advisory_lock` numa conexão do pool e a devolve ao pool. A trava (de sessão) fica numa conexão que depois atende requisições da API, ou some quando o pooler recicla a conexão.
- **Por que obedecem:** AD-5 diz "trava `pg_advisory_lock`, executa o que venceu e marca feito", sem dizer onde fica a transação nem qual conexão segura a trava.
- **Onde quebra:** mensagem em dobro (que a AD-5 jura impedir) ou dois laços rodando depois de um reinício.
- **Regra [reforça AD-5]:** o laço segura `pg_try_advisory_lock` numa conexão própria, fora do pool, enquanto viver. Cada linha da outbox passa por três passos: reivindicar (`FOR UPDATE SKIP LOCKED`, `attempts+1`, commit), chamar a Meta e gravar o `wamid`. Uma linha com tentativa sem `wamid` fica `uncertain` e não é reenviada sozinha. Cada tarefa agendada roda numa transação própria junto com o comando do domínio.

### A-5 · Nome de permissão para uma rota que despacha pelo corpo

- **Unidade A, "não veio no painel" (FR-52):** segue o exemplo da AD-9 e declara `require("reservations.no_show")`.
- **Unidade B, "remarcar pela casa" (FR-56):** a rota é a mesma (`POST /staff/reservations/{id}/actions`, com `action` no corpo), então declara `require("reservations.actions")`.
- **Por que obedecem:** AD-9 exige "cada rota declara a operação por dependência", e a rota é uma só para 13 ações. O registro de `03` usa o singular (`reservation.approve`), e o exemplo da AD usa o plural.
- **Onde quebra:** o salão pode "não veio" (FR-52) mas não remarca (FR-56). Com a operação grossa, a matriz libera tudo ou nada. O teste "operações × papéis" passa, porque só enxerga uma operação.
- **Regra [reforça AD-9]:** o nome da operação é `{entidade_no_singular}.{verbo}` e é idêntico ao `action` do registro. A rota de ações confere `require_op(f"reservation.{body.action}")` antes de chamar o domínio, e o teste da matriz percorre os valores do enum `ReservationAction`.

### A-6 · Conteúdo do site: HTML gravado ou API?

- **Unidade A, "entrega 1 estática" (AD-15):** o build lê `src/content/*.json` no formato que o dev achou melhor e grava no HTML.
- **Unidade B, "publicar conteúdo" (FR-68, FR-69, entrega 2):** grava `ContentBlock` no banco, e FR-3 exige que "ligar o prato do dia muda o Hoje na casa sem publicar de novo".
- **Por que obedecem:** AD-15 diz "conteúdo gravado no HTML na publicação", e AD-14 diz "publicação só por script com confirmação". FR-1 exige funcionar sem JavaScript.
- **Onde quebra:** publicar no painel não regera o HTML (só o script do Matheus regera), então quem está sem JS vê o cardápio do último deploy para sempre. Ou alguém põe Node e `vite build` dentro do laço de tarefas da VM de 1 GB. E os dois formatos de conteúdo não são o mesmo.
- **Regra [reforça AD-15]:** existe um único formato de conteúdo, o das respostas `GET /content`, `/menu` e `/house` do `openapi.yaml`. O HTML é pré-renderizado no build a partir de um `content-snapshot.json` nesse formato (na entrega 1, versionado no repositório; depois, puxado da API pelo script de publicação). Na entrega 2 a página atualiza pela API em tempo de execução, e publicar no painel nunca regera HTML.

### A-7 · Migrar o conteúdo e as fotos da entrega 1 para a 2

- **Unidade A, "entrega 1":** fotos em `src/content/images.json` com chaves (`capa`, `balcao`), servidas como assets do Vite com hash no nome.
- **Unidade B, "banco de fotos" (FR-70):** `Image` com `uuid` e variantes em `/media/`.
- **Por que obedecem:** AD-13 trata das fotos do painel, e AD-15 garante as URLs **públicas** (páginas), não as das imagens nem o conteúdo inicial.
- **Onde quebra:** no dia da entrega 2 o banco está vazio. Quem semeia? A sessão de "conteúdo" cria uma migração com dados, e a de "fotos" escreve um script. As chaves `capa` viram `uuid`, e o conteúdo antigo referencia URL de asset.
- **Regra [nova AD-15b]:** a entrega 2 abre com um único comando de importação (dono: o pacote de conteúdo), que lê o `content-snapshot.json` e as fotos da entrega 1 e cria `ContentBlock`, `MenuItem` e `Image` mantendo as chaves antigas em `Image.slug`. O conteúdo referencia foto só por `image_id`, nunca por URL.

### A-8 · Foto em uso: quem é o dono de `usages`

- **Unidade A, "editar texto do site" (FR-69):** guarda o `image_id` dentro de `ContentBlock.fields` (JSON livre).
- **Unidade B, "apagar foto" (FR-70):** "bloqueado se está em uso" confere a coluna `images.usages`.
- **Por que obedecem:** AD-13 diz "o banco guarda só os metadados", e `usages` é metadado. Nenhuma AD diz quem escreve `usages`.
- **Onde quebra:** apagam uma foto usada na capa, e o site quebra. Ou o conteúdo é publicado com foto ainda `processing` (o laço roda a cada 15 s) e a capa sai sem imagem.
- **Regra [reforça AD-13]:** o uso de foto vive numa tabela `image_usages(image_id, entity_type, entity_id, slot)` gravada pelo módulo que referencia, na mesma transação. `usages` é derivado dela. Publicar (conteúdo, cardápio, evento) recusa foto que não está `ready` (`422 image_not_ready`).

### A-9 · O cliente se apaga, mas o registro e a outbox guardam o telefone

- **Unidade A, "apagar meus dados" (FR-34):** anonimiza o cliente e cancela as reservas futuras pela transição, que (AD-4) grava na mesma transação a mensagem "Cancelado. Obrigado por avisar!" para o número que acabou de ser apagado.
- **Unidade B, "registro" (AD-11):** grava `changes` com antes e depois (nome e telefone) e é só de inclusão, garantido no banco.
- **Por que obedecem:** AD-11 proíbe `UPDATE` e `DELETE` no registro. `03` diz "sem campos sensíveis", mas não define o que é sensível. A outbox guarda a mensagem já pronta.
- **Onde quebra:** os dados pessoais ficam para sempre numa tabela que não se apaga, e no `pg_dump` de 30 dias. A mensagem sai (ou falha) para um telefone anonimizado. LGPD.
- **Regra [nova AD-11b]:** o registro, a outbox e as tarefas nunca guardam nome, telefone, nota ou dado de saúde, só ids. O texto é montado na hora do envio. A anonimização é um comando de `domain.customers` que cancela com `notify=false`, apaga a outbox pendente do cliente e roda numa só transação.

### A-10 · Quem cria o cliente

- **Unidade A, "reserva pelo site":** cria ou encontra o cliente por `phone_e164` (único por casa, "chave do cliente").
- **Unidade B, "lançar pela equipe" (FR-91):** o telefone é opcional no `ReservationStaffCreate`. Cria um `Customer` sem telefone, ou usa um cliente fictício "Balcão", ou deixa `customer_id` vazio. E, quando o telefone já existe, sobrescreve o nome que o cliente verificou.
- **Por que obedecem:** nenhuma AD fala de identidade de cliente.
- **Onde quebra:** as faltas e visitas (FR-91: "entra nas contas como as outras") ficam espalhadas, e a aprovação por regra (2 faltas, FR-36) não enxerga o mesmo cliente. Um número não verificado pela equipe passa a ver reservas em "Minhas reservas".
- **Regra [nova AD]:** só `domain.customers.resolve(phone, name, verified)` cria ou liga cliente. Com telefone, ele faz upsert por `phone_e164` sem trocar o nome já verificado. Sem telefone, a reserva fica com `customer_id` nulo, o que só vale para `source in (walk_in, staff)` sem telefone, e não conta falta nem visita.

### A-11 · Mesa liberada: quem oferece à fila

- **Unidade A, "cancelar pelo cliente":** chama `waitlist.offer_next()` dentro da própria transação ("oferta para a fila", tabela de `04`).
- **Unidade B, "não veio" (FR-52):** libera a mesa e não chama nada, porque o dev seguiu a AD-4 ("não veio conta falta"), que não fala da fila.
- **Por que obedecem:** AD-4 é "uma transição para **a** reserva". Um efeito sobre **outra** reserva não está coberto. Na entrega 2 não há oferta automática (FR-94 só pela equipe), e na 3 há.
- **Onde quebra:** a oferta automática dispara em um caminho e não em outro, e a entrega 3 precisa caçar todos os pontos onde se libera mesa.
- **Regra [amplia AD-4]:** quando a capacidade aumenta (cancelamento, vencimento, `release` antes do horário, troca de planta), grava-se na mesma transação uma linha `capacity_freed(night_date, time)` na tabela de tarefas. Só um executor reage a ela: na entrega 2 ele só avisa o painel, e na 3 oferece. Nenhum comando chama a fila direto.

### A-12 · Simulação e gravação da troca de planta

- **Unidade A, "simular" (FR-60, `dry_run`):** devolve as três listas às 18:00.
- **Unidade B, "nova reserva pelo site":** entra às 18:01 na mesa que a simulação dava como livre.
- **Unidade C, "gravar a troca":** aplica as listas que o front mandou, em massa, por SQL, porque não há troca de status (então não é transição) e é mais rápido.
- **Por que obedecem:** AD-4 não cobre mudança de mesa. AD-6 recusa só a colisão exata, e a convenção de `version` protege o plano do dia, não as reservas que ele mexe.
- **Onde quebra:** a gravação aplica uma realocação velha, ou leva `409` no meio e deixa metade aplicada. E as reservas movidas não geram a mensagem "Mudou a mesa ou o horário" nem o registro "antes e depois" que `04` exige.
- **Regra [nova AD]:** o `dry_run` devolve um `simulation_hash`. A gravação recalcula tudo na mesma transação e recusa com `409 plan_changed` se o hash mudou. Cada reserva movida passa pelo comando `move_tables` / `reschedule` de C-3.

### A-13 · Capacidade que não é mesa não tem guarda no banco

- **Unidade A, "lista na porta" (FR-65):** confere `capacity - soma(pessoas)` e insere.
- **Unidade B, a mesma rota em outra requisição no mesmo segundo:** faz o mesmo.
- **Por que obedecem:** AD-6 protege só mesa × intervalo. `max_covers_per_slot`, `max_covers_night`, lista do evento, `max_active_per_phone` e "uma reserva ativa por cliente, dia e horário" ficam como checagem na aplicação, que AD-6 chama de "só sugere".
- **Onde quebra:** o forró de 40 lugares vende 43, e a mesma pessoa tem duas reservas no mesmo horário com dois toques em abas diferentes (chaves de idempotência diferentes).
- **Regra [amplia AD-6]:** os limites por noite e por pessoa são garantidos travando a linha `nights(house_id, night_date)` (`SELECT … FOR UPDATE`) na transação da criação e da mudança de tamanho. "Uma reserva ativa por cliente, noite e horário" é índice único parcial.

### A-14 · A resposta do botão chega sem dizer de qual reserva é

- **Unidade A, "lembrete":** um template por reserva, e o cliente pode ter 2 reservas ativas (`max_active_per_phone`).
- **Unidade B, "webhook" (AD-12):** o contrato atual traz `phone` e `message_id`, e o dev resolve "a reserva de hoje desse telefone".
- **Por que obedecem:** AD-12 diz "entrega as respostas ao domínio", sem dizer a chave. A Meta reenvia o webhook quando a resposta demora.
- **Onde quebra:** "Não vou mais" cancela a reserva errada, e o reenvio da Meta aplica duas vezes.
- **Regra [reforça AD-12]:** o payload de cada botão leva `r:{reservation_id}:{answer}:{outbox_id}`. O webhook resolve só por ele (o `context.id` precisa bater com o `wamid` da outbox), deduplica pelo `wamid` da mensagem que chegou, e as respostas são "definir" (`late` fixa `extra_tolerance_min`, nunca soma).

---

## Médias

### M-1 · Três fontes de fuso

`dates.js` lê `VITE_HOUSE_TIMEZONE`, `HouseSettings.timezone` é editável no contrato, e a AD-7 fixa `America/Sao_Paulo`. Uma sessão de configurações deixa mudar o fuso, e o front continua no da variável de ambiente.
**Regra [reforça AD-7]:** o fuso é constante do domínio, lido de `house.timezone` (só leitura no módulo 1), e o front o recebe em `GET /house`, nunca de variável `VITE_`.

### M-2 · Quem corta a reserva pelo papel

`ReservationStaff` é "cortada pelo papel" (salão: só hoje, primeiro nome, telefone mascarado; dado de saúde só para quem atende). Uma sessão corta no SQL e outra no serializador da rota, e a busca (FR-46) do salão devolve o telefone completo porque usou o outro caminho.
**Regra [reforça AD-9]:** a projeção por papel é feita num só lugar (`api/projections.py`), a partir de grupos de campos declarados na mesma matriz de `permissions.py` (`reservation.read.health`, `customer.read.phone`), e o teste da matriz cobre os campos.

### M-3 · O modo estático é um adaptador ou um `if` nas telas?

AD-1 diz "trocar o mock pela API real é mudar `VITE_API_MODE`, nunca uma tela", mas `static` não é mock nem API. A sessão da página inicial lê o conteúdo do DOM quando `static`, e a da reserva testa `import.meta.env.VITE_API_MODE` na feature para abrir o WhatsApp.
**Regra [reforça AD-1]:** `static` é um terceiro adaptador de `src/services/api/` que devolve o snapshot e responde `ApiError{type:"static_mode"}` ao resto. As features decidem por `api.capabilities.booking`, e o lint barra `VITE_API_MODE` fora de `services/api` e `app/boot.js`.

### M-4 · Lista na porta: entrada e desfazer

`POST /staff/events/{id}/guests` cria a reserva já com a chegada marcada, por um caminho próprio do módulo de eventos. O `DELETE …/check-in` desfaz depois que a noite fechou e a reserva já virou `completed`.
**Regra:** a entrada na porta é `reservations.create(source=walk_in)` seguida de `check_in`, e desfazer a chegada é recusado (`invalid_transition`) depois do fechamento da noite.

### M-5 · A mensagem é montada quando entra na fila ou quando sai

Uma sessão grava o texto pronto ("amanhã às 20:30") às 23:59, e ele sai às 00:01 ou, depois de uma queda da Meta, horas mais tarde. A oferta da espera sai depois de `offer_expires_at`.
**Regra [reforça AD-5 e AD-12]:** a outbox guarda o template, a versão e as variáveis cruas (`night_date`, `time`, ids), monta o texto no envio e tem `expires_at`. Uma mensagem vencida (oferta, lembrete depois do horário) é descartada como `expired`, nunca enviada.

### M-6 · Dono das migrações

"SQL numerado, uma por mudança": duas sessões criam a `0007` em paralelo, e o Alembic fica com duas cabeças. Também não está escrito quem cria `btree_gist` (no Supabase, no esquema `extensions`), o papel do banco, a RLS que nega o `anon` e o gatilho que impede `UPDATE` no registro.
**Regra [reforça Convenções]:** as revisões têm id com data e hora, e o CI falha com mais de uma cabeça. A migração-base é dona das extensões, do papel, da RLS padrão e do gatilho do registro. Um teste lê o catálogo e falha se uma tabela não tem `house_id`, política RLS ou índice começando por `house_id`.

### M-7 · `version` e `If-Match` na reserva

"`version` em toda entidade editável". O painel manda `If-Match` em toda ação, mas o worker e o webhook mudam a reserva sem `If-Match`. O tablet, que atualiza a cada 30 s, leva `412` sempre que o cliente responde o lembrete no meio.
**Regra:** nas reservas, `If-Match` só vale para edições da equipe (`move_tables`, `reschedule`, `note`, campos). Mudança de status é protegida pela tabela de transições (`409 invalid_transition`), e não por versão.

### M-8 · Catálogo de `type` do problem+json

RFC 9457 sugere URI em `type`. O backend manda `https://…/invalid-transition`, e `client.js` compara texto curto (`conflict`, `precondition_failed`, `csrf_failed`).
**Regra [reforça AD-10]:** `type` é um slug `snake_case` de um enum único `ProblemType` no `openapi.yaml`, e o mock e o backend o importam dali.

### M-9 · Dado de saúde dentro de `notes`

FR-97 manda apagar a restrição alimentar 30 dias depois, mas ela está em `notes`, texto livre que também tem "aniversário da Ana". Uma sessão apaga `notes` inteiro, e outra só tira o marcador `dietary`.
**Regra:** a restrição alimentar ganha campo próprio (`dietary_note`), único alvo da limpeza de FR-97 e da projeção de saúde (M-2), e `notes` passa a avisar que não é lugar de dado de saúde.

### M-10 · O mock não é comparado com o contrato

AD-2 compara o OpenAPI do FastAPI com o arquivo, mas "o mock muda no mesmo commit" é só combinado. Os handlers do MSW (`src/mocks/handlers/public.js`) podem devolver outro formato e a tela passa no Playwright. Além disso, a comparação do OpenAPI gerado não está definida (nomes `-Input`/`-Output` do Pydantic, 3.1 contra 3.0).
**Regra [reforça AD-2]:** as respostas do mock são validadas contra os esquemas do `openapi.yaml` nos testes do front. A comparação do backend é semântica (caminhos, métodos, esquemas normalizados por `$ref` resolvido), com o normalizador num só script.

### M-11 · A entrega 2 com uma planta só vira outro esquema

A entrega 2 tem "uma planta só" e a 3 tem várias plantas e simulação. A sessão da entrega 2 grava mesas sem `layout_id` e plano do dia sem planta, e a entrega 3 precisa migrar as ocupações.
**Regra [reforça AD-15]:** o esquema da entrega 2 já tem `layouts`, `day_plans` e `nights` completos, com uma linha de planta. As funções da entrega 3 entram por chave de configuração, nunca por mudança de esquema.

---

## Baixas

### B-1 · O contrato já diverge consigo mesmo

As variantes de imagem são `jpeg` num esquema do `openapi.yaml` e `jpg` no `Image` do mesmo arquivo. `sheet_style` tem `handmade` no contrato e não em `03-modelos.md`. Duas sessões vão escolher lados diferentes.
**Regra [reforça AD-2]:** enums aparecem uma vez em `components/schemas` e são sempre referenciados por `$ref`, e um lint do OpenAPI barra enum repetido inline.

### B-2 · Colisão do `code` da reserva

`TR-4821` tem 10 mil valores. A unicidade (por casa, por noite, para sempre?) não está escrita, e duas sessões geram de jeitos diferentes (aleatório contra sequência).
**Regra [reforça Convenções]:** `code` é único por casa entre reservas não anonimizadas, gerado só por `domain.reservations`, com tentativa nova na colisão do índice único.

### B-3 · Ator "Salão" e "só as próprias"

AD-11 grava "Salão" no tablet, e FR-78 dá ao gerente "só as próprias" ações. Se o gerente usa o tablet, as ações dele somem do registro dele. Uma sessão grava `actor_id` = usuário do tablet, e outra grava nulo com rótulo.
**Regra [reforça AD-11]:** o tablet é um `User` de papel `floor`, com `actor_id` próprio e `actor_label = "Salão"`. "Só as próprias" filtra por `actor_id`.

---

## Os cinco que eu fecharia primeiro

1. **C-1:** a ocupação é chaveada pela mesa física (`table_code`) e não pela mesa da planta.
2. **C-2:** um só dono (`domain/occupancy`) para a tabela de ocupação, com a coluna `released_at` própria dela.
3. **C-3:** toda mudança na reserva é comando do domínio com o contrato da AD-4, não só a troca de status.
4. **C-4:** `night_date` é o campo `date`, com corte definido e calculado só por `domain.night`.
5. **C-5:** a oferta sempre prende a mesa na transição de oferta.
