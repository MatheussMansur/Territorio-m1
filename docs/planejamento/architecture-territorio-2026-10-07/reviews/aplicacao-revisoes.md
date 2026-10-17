# Aplicação das revisões · ARCHITECTURE-SPINE.md

- **Data:** 08/10/2026
- **Entradas:** `review-rubric.md` (28), `review-adversarial.md` (33), `review-atualidade.md` (11) e o último bloco do registro de decisões da época (não está mais no repositório), que vale por cima das sugestões dos revisores quando elas diferem.
- **Resultado:** spine com 25 ADs (AD-1 a AD-16 mantidos e emendados; AD-17 a AD-25 novos). Lint (`lint_spine.py`): 0 achados.
- **Contagem:** 72 achados; 68 fechados, 2 adiados, 2 com pergunta em aberto ao autor.

Onde a decisão do autor substituiu a sugestão do revisor, a linha diz "(decisão do autor)".

## Revisão pela régua (`review-rubric.md`)

| Achado | O que foi feito |
| --- | --- |
| C-1 · Sem dono da transação, acesso ao banco em aberto | AD-17 (UoW por dependência, rotas síncronas, `psycopg_pool.ConnectionPool`, domínio nunca confirma); AD-3 com teste de imports; SQLAlchemy e Alembic saem; `psycopg_pool` na Stack (decisão do autor: síncrono, SQL à mão) |
| C-2 · Sem homologação nem banco de teste | AD-20 + tabela de ambientes (`test` = Postgres local em contêiner; `homolog` = 2º projeto Supabase Free + `homolog.`, relógio adiantável só fora de prod; trava por banco) |
| A-1 · Modo `static` não existe | AD-1 (terceiro adaptador em `services/api`, `api.capabilities`, lint de `VITE_API_MODE`, `--mode site`) e AD-15 (formato único, URLs públicas desde a entrega 1) |
| A-2 · Webhook sem ligação com a reserva | AD-12 (`/api/v1/webhooks/whatsapp`, assinatura sobre bytes crus, `inbound_events`, referência opaca no payload, status sem domínio; o caminho do n8n sai do contrato) |
| A-3 · Outbox promete o que a Meta não garante; sem catálogo de tarefas | AD-5 (pelo menos uma vez, lease, `wamid`, revalidação, `skipped`) e AD-19 (catálogo fechado); marcações da noite calculadas na leitura (AD-7) |
| A-4 · Teste de contrato inviável; mock sem conferência | AD-2 (comparação normalizada num script; mock validado com Ajv no `test:unit`) |
| A-5 · CSRF "em toda escrita" contradiz o front | AD-9 (exceções = `NO_SESSION` do `client.js`, conferido no código, inclusive `staff/auth/tokens`, + webhook; proteção alternativa; teste `403 csrf_failed`) |
| A-6 · Segurança sem regra (taxa, TOTP, reautenticação, cortes) | AD-23 |
| A-7 · Fotos: build × painel | AD-13 (só fotos do painel; build continua com `sharp`; mesmos tamanhos) e AD-15 (importação única na entrega 2) (decisão do autor) |
| A-8 · Ocupação sem estados nem bordas | AD-6 reescrito (mesa física, `[)`, `released_at IS NULL`, dono `domain/occupancy`, walk-in, mesa guardada, teste concorrente) e AD-25 (troca de planta) |
| A-9 · Envelope operacional incompleto | AD-24 (publicação, ordem, volta atrás, atualizações, rede, `uv`); **Pergunta:** fornecedor do alerta de erro e onde roda o CI |
| M-1 · `house_id` e RLS sem mecanismo | AD-8 (schema `app`, API de dados desligada, papéis, RLS, `house_id` como 1º parâmetro, teste de IDOR) e AD-17 (tamanho do pool); AD-21 (teste de catálogo) |
| M-2 · Idempotência: aceita × exige, escopo, concorrência | AD-10 (obrigatória onde o contrato marca, tabela única na mesma transação, segunda espera a primeira, índice único parcial, limpeza pela `cleanup`) |
| M-3 · Registro só de inclusão × LGPD | AD-11 (só ids e rótulo da equipe; anonimização por comando) (decisão do autor) |
| M-4 · Backup: agendamento, cifra, tamanho, restauração | AD-16 (timer do systemd, `age`, `rclone sync` incremental, 10 GB, restauração na homologação, pg_dump PGDG) e AD-5 (exceção do backup) |
| M-5 · Atualização do painel | Convenções (consulta a cada 20 s com `ETag`, sem WebSocket/SSE) |
| M-6 · `errors[].field` em português | Convenções (`field` = nome do campo no contrato, `message` em português) (decisão do autor) |
| M-7 · `night_date` × `date`; o que o front calcula | AD-7 (`date` é a data da noite; dono `domain.night`; front só mostra) |
| M-8 · Forma da VM decide o AD-13 | **Adiado**, com regra de saída para AMD micro × A1; pode esperar porque a regra já diz o que fazer em cada caso e a forma só se conhece ao criar a VM |
| M-9 · Matriz sem fonte para o teste | AD-9 (`docs/api/permissoes.yaml` como fonte; teste exige toda operação do contrato); **Pergunta:** papéis ainda em [SUPOSIÇÃO] (Q8) |
| M-10 · Faltam ferramentas | Stack: `psycopg_pool` 3.3.3, `python-multipart` 0.0.32, `pyotp` 2.10.0, `cryptography` 50.0.2, `ruff` 0.16.10, `pip-audit` 2.10.1, `uv` 0.12.23 (PyPI conferido em 08/10/2026), Ajv 8.20.0, Postgres 17, pg_dump PGDG; Resend por `httpx` |
| B-1 · Desvios do registro de decisões | AD-8, AD-12, AD-14 marcados [ADOPTED]; demo com [SUPOSIÇÃO]; AD-5 diz que substitui o APScheduler do adendo |
| B-2 · Cache do nginx | AD-14 (cabeçalhos por caminho e CSP) |
| B-3 · "SQL numerado (Alembic)" | AD-21 (Alembic sai; executor próprio `server/migrate.py` com `NNNN_slug.sql` e checksum) (decisão do autor: SQL à mão) |
| B-4 · Funções sem lugar | Convenções (exportações CSV, `.ics`); AD-12 (template do aviso de pendente, FR-43); AD-16 (aviso à casa em 1 h); tabela de funções com a linha nova |
| B-5 · Testes do front; `features/` não existe | Convenções (testes do front) e Paradigma (o que já existe e `features/` na fase 2) |
| B-6 · Acompanhamento na entrega 1 | AD-16 (UptimeRobot em `GET /` na entrega 1) |
| B-7 · Tokens da equipe | Convenções (linha "Tokens de link") |

## Revisão adversarial (`review-adversarial.md`)

| Achado | O que foi feito |
| --- | --- |
| C-1 · Ocupação presa à mesa da planta | AD-6 (mesa física `tables(house_id, code)`; ocupação por `table_code`); ER atualizado |
| C-2 · "Mesa vagou" × constraint por status | AD-6 (dono único `domain/occupancy`; `released_at IS NULL`; `release` grava `released_at = left_at`) |
| C-3 · Metade das mudanças não é transição | AD-4 reescrito (toda mudança é comando; repositório sem `update` genérico) |
| C-4 · `night_date` fora dos dados | AD-7 (`date` é a noite; `domain.night.night_of`, corte no `closes_at` ou 06:00, o que vier primeiro; "hoje" = `night_of(agora)`) |
| C-5 · Oferta sem segurar mesa | AD-4 e AD-6 (`offered` sempre com mesa e ocupação na oferta). `04-regras-reserva.md` ("Mesa atribuída" no aceite) e o `table_codes` opcional do contrato se ajustam na história |
| A-1 · Duas chaves de idempotência | AD-5 (chave da outbox determinística, nunca o `Idempotency-Key`) |
| A-2 · Onde se guarda o `Idempotency-Key` | AD-10 (tabela única na transação da criação; campo sai do modelo) |
| A-3 · Tarefa que já não vale | AD-5 (chave por tipo, substituição, revalidação) e AD-19 (lembrete e fechamento por noite) |
| A-4 · Transação do laço e trava no pooler | AD-5 (`pg_try_advisory_xact_lock` por rodada, `SKIP LOCKED`, chamada à Meta fora da transação). O estado `uncertain` sugerido não entrou: o autor escolheu "pelo menos uma vez" com lease (decisão do autor) |
| A-5 · Nome de permissão na rota que despacha pelo corpo | AD-9 (`<entidade>.<verbo>` no singular = ação do registro; a rota confere `reservation.<action>`) (decisão do autor) |
| A-6 · Conteúdo: HTML gravado ou API | AD-15 (formato único; pré-render no build; API no navegador; painel nunca regera HTML) (decisão do autor) |
| A-7 · Migrar conteúdo e fotos da entrega 1 | AD-15 (comando único de importação, `Image.slug`) e AD-13 (foto só por `image_id`) |
| A-8 · Dono de `usages` | AD-13 (`image_usages`; `422 image_not_ready`) |
| A-9 · Registro e outbox com telefone | AD-11 (sem dado pessoal no registro; outbox apaga telefone e texto em 30 dias; `anonymize`) e AD-5 (variáveis cruas, texto montado no envio) (decisão do autor) |
| A-10 · Quem cria o cliente | AD-22 |
| A-11 · Mesa liberada: quem oferece | AD-4 (tarefa `capacity_freed`) e AD-19 |
| A-12 · Simulação × gravação da troca de planta | AD-25 |
| A-13 · Capacidade que não é mesa | AD-18 (trava da linha `nights`) e AD-10 (índice único parcial); ordem de travas em AD-17 |
| A-14 · Resposta do botão sem reserva | AD-12 (referência opaca, `context.id`, deduplicação, resposta que define) (decisão do autor: referência opaca, não o id da reserva) |
| M-1 · Três fontes de fuso | AD-7 (`house.timezone`, só leitura; front pelo `GET /house`) |
| M-2 · Quem corta pelo papel | AD-23 (`projections.py` a partir de grupos de campos da matriz) |
| M-3 · Modo estático: adaptador ou `if` | AD-1 |
| M-4 · Lista na porta: entrada e desfazer | AD-4 |
| M-5 · Mensagem montada na entrada ou na saída | AD-5 (variáveis cruas, `expires_at`, `expired`) |
| M-6 · Dono das migrações | AD-21 |
| M-7 · `version` e `If-Match` na reserva | Convenções ("Concorrência de edição") |
| M-8 · Catálogo de `type` do problem+json | AD-10 (enum `ProblemType`) |
| M-9 · Dado de saúde em `notes` | AD-23 (`dietary_note` próprio, alvo único da limpeza de FR-97); `03-modelos.md` se ajusta na história |
| M-10 · Mock não comparado | AD-2 |
| M-11 · Entrega 2 com uma planta vira outro esquema | AD-15 (esquema completo na entrega 2) |
| B-1 · Contrato diverge consigo mesmo | AD-2 (enum uma vez, por `$ref`, barrado pelo script) |
| B-2 · Colisão do `code` | AD-4 |
| B-3 · Ator "Salão" e "só as próprias" | AD-11 |

## Revisão de atualidade (`review-atualidade.md`)

| Achado | O que foi feito |
| --- | --- |
| 1 · Trava de sessão pelo pooler | AD-5 (`pg_try_advisory_xact_lock` + `SKIP LOCKED`); Adiado "Escalar" atualizado (decisão do autor) |
| 2 · Object Storage com PAYG = 10 GB | AD-16 (10 GB, fotos incrementais, alerta de orçamento) (decisão do autor) |
| 3 · `pg_dump` pelo pooler | AD-8 e AD-16 (conexão direta por IPv6 na VCN; pooler só reserva) (decisão do autor) |
| 4 · Versão do `pg_dump` | Stack e AD-16 (PGDG na versão maior do Supabase, `--schema=app`) |
| 5 · Supabase ativo já resolvido | Adiado reescrito (sem "conferir no primeiro mês") |
| 6 · Let's Encrypt encurtando validade | AD-14 (timer do certbot, recarga no hook) |
| 7 · Formato da resposta ao botão | AD-12 (aceita os dois formatos; fixture do primeiro webhook real) |
| 8 · AVIF na AMD micro | **Adiado**, na regra de saída da forma da VM; pode esperar porque só importa se a VM for a micro, e a regra já diz o que fazer |
| 9 · Python 3.13 na VM | AD-24 e Stack (`uv python install 3.13`) |
| 10 · "SQL numerado (Alembic)" | AD-21 (Alembic sai) |
| 11 · Versões fixadas pelo `package-lock.json` | Stack e AD-24 (`npm ci`) |

## Perguntas em aberto (para o autor)

- Alerta de erro: Sentry Free, GlitchTip ou e-mail pelo Resend? (régua A-9)
- CI: o repositório vai para o GitHub com Actions, ou a verificação fica só no `publish.sh`? (régua A-9)
- Papéis em [SUPOSIÇÃO] de FR-52, FR-53, FR-56, FR-74 e FR-91 (Q8): confirmar com a casa antes de o `permissoes.yaml` virar gabarito. (régua M-9)
