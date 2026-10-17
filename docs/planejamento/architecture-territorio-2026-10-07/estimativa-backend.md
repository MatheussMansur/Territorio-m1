# Estimativa do backend · Território módulo 1

Data: 08/10/2026 · Base: `prd.md` (FR-1…FR-99), `addendum.md`, o registro de decisões da época da arquitetura (não está mais no repositório), `docs/api/openapi.yaml` (104 operações), `03-modelos.md`, `04-regras-reserva.md`, `src/mocks/availability.js`, `extract-arquitetura.md`.

> Estado: completo. Resumo: backend provável ≈ 57 dias úteis (pessimista ≈ 94); com o front e a folga, ≈ 77 dias (pessimista ≈ 122). Não cabe em 8 semanas.

## 1. Premissas

- **Quem faz:** uma pessoa (Matheus), nível júnior a pleno. Já publicou FastAPI na mesma hospedagem (Dionísio: nginx, certbot, uvicorn, systemd).
- **Dia produtivo:** 6 h. Semana: 5 dias úteis. 8 semanas = 40 dias úteis = 240 h.
- **Stack decidida:** FastAPI em camadas (api → domain → repo; integrations nas bordas), Supabase só como Postgres (papel próprio, RLS negando o anon, `house_id` em tudo), exclusion constraint (btree_gist) contra reserva dupla, WhatsApp Cloud API direto (sem n8n), mensagens e tarefas como linhas no banco executadas por um laço único no processo da API com `pg_advisory_lock`, fotos no disco da VM, backup para o Oracle Object Storage.
- **Três números por pacote:** otimista (tudo encaixa de primeira), provável (o esperado, com um ou dois tropeços), pessimista (regra que muda no meio, bug de concorrência ou fuso, refação). Cada pacote inclui os testes do próprio pacote; o pacote "Testes" é só o que atravessa tudo.
- **Fora destas horas:** o front restante (fases 2 a 7, contado à parte na seção 4) e as esperas de calendário (Meta, casa), que entram como folga.
- **Disponibilidade:** o motor já existe em JS (410 linhas, `resolveDay`, `tableOptions`, `freeOptions`, `dayAvailability`, `simulate`, `applyDayPlan`). Portar para Python poupa o desenho; não poupa o teste nem a troca de "estado em memória" por consulta ao banco.

## 2. Pacotes de trabalho

Horas: **O** otimista · **P** provável · **Pe** pessimista.

### 2.1 Base

| # | Pacote | O que entra | FRs | O | P | Pe |
| --- | --- | --- | --- | --: | --: | --: |
| B1 | Setup do projeto | Repositório do backend, estrutura em camadas (api/domain/repo/integrations), configuração por ambiente, `.env.example`, problem+json (RFC 9457) com erro por campo, log estruturado, CSRF por cabeçalho, limite de taxa básico, teste que compara o OpenAPI gerado com `openapi.yaml`, CI simples (lint + pytest) | transversal | 5 | 8 | 14 |
| B2 | Esquema e migrações | ~28 entidades de `03-modelos.md` em migrações (Alembic ou SQL puro), `house_id` em toda tabela e índice, RLS ligada negando tudo ao anon, papel próprio do backend, `btree_gist` + exclusion constraint por mesa × intervalo só para estados ativos (e para a junção de mesas: uma linha por mesa ocupada), índices únicos (código, telefone, chave de idempotência), `timestamptz` + data da noite, dados de semente (casa, semana padrão, planta de exemplo) | FR-44 e base de todos | 10 | 16 | 26 |
| B3 | Matriz de permissões | Tabela única operação → papéis no código (dono, gerente, salão), dependência aplicada em cada rota, recortes "só a noite", "só hoje", "dígitos escondidos", teste que percorre as 104 operações × 3 papéis + anônimo | FR-45…FR-99 (colunas de papel), lacuna 7 | 3 | 5 | 8 |

### 2.2 Acesso

| # | Pacote | O que entra | FRs | O | P | Pe |
| --- | --- | --- | --- | --: | --: | --: |
| B4 | Autenticação da equipe | Sessões no servidor (cookie httpOnly Secure SameSite=Strict), argon2id, senha ≥ 12 e recusa de senha vazada (k-anonimato HIBP), primeiro acesso do dono (link de uso único), convite 72 h, esqueci/troca de senha por e-mail (30 min, mesma resposta exista ou não o e-mail; provedor de e-mail transacional + SPF/DKIM), TOTP em duas etapas com códigos de recuperação, bloqueio 5 erros/15 min crescente, reautenticação para ações sensíveis, lista e encerramento de sessões, trocar a senha encerra as outras, nunca deixar a casa sem dono, usuários (convidar, desativar, mudar papel), conta compartilhada "Salão" | FR-77, FR-79…FR-82, FR-95 (sem permissão), FR-98 | 14 | 22 | 34 |
| B5 | Código do cliente pelo WhatsApp + sessão | `POST /auth/otp` e `/auth/verify`: código de 6 dígitos com hash, 10 min, 5 tentativas, reenvio após 30 s, 3 por hora por número, telefone BR/PY/AR normalizado (E.164), sessão do cliente (cookie Lax), "lembrar aparelho" 90 dias, `/me`, sair. Depende do envio do B17 | FR-14, FR-15, FR-28 | 6 | 9 | 15 |

### 2.3 Reserva (núcleo)

| # | Pacote | O que entra | FRs | O | P | Pe |
| --- | --- | --- | --- | --: | --: | --: |
| B6 | Porte do motor de disponibilidade | Portar `availability.js` para `domain/availability.py` (resolver o dia: semana padrão + plano do dia + evento; tempo de mesa por tamanho; mesas usáveis online; junções; mesas ocupadas; bloqueios por demanda; janela de 30 dias e 1 h; "últimas mesas"). Trocar o estado em memória por leitura do banco em uma consulta por dia. Portar os casos do mock como testes de tabela (mesma entrada, mesma saída nos dois lados). `GET /availability/days`, `/availability/slots`, `/staff/availability` | FR-9…FR-11, FR-13 | 8 | 14 | 24 |
| B7 | Ciclo de vida da reserva | Função única de transição no domain (tabela de `04` §Transições, `invalid_transition` no resto) que grava registro + mensagem na mesma transação; `POST /reservations` com `Idempotency-Key` (24 h, hash do corpo, corpo diferente = 422); versão das regras aceitas; bloqueios do FR-17 (lotou → alternativas, repetida, mais de 2 futuras, cliente bloqueado, 409 da constraint traduzido); confirmação automática até 8; `PATCH /reservations/{code}` remarcar **e mudar pessoas** (lacuna 1) com nova verificação e "nada muda se não houver mesa"; prazo de 2 h; dois tokens (leitura e ação) guardados como hash, 30 dias; `/links/{token}` (GET não muda nada), confirmar, cancelar, aceitar/recusar oferta; `/reservations/mine`; caixa de novidades (lacuna 2); arquivo .ics para agenda | FR-12, FR-16, FR-17, FR-19…FR-25, FR-29…FR-32, FR-35, FR-44 | 14 | 24 | 38 |
| B8 | Lista de espera e ofertas | Entrar na lista com posição; ao liberar mesa (cancelar, não veio, mudar mesa, pendente vencido) procurar o primeiro que cabe antes do horário; oferta com prazo de 10 min (tarefa agendada); recusa ou vencimento passa ao próximo; oferta à mão e "virar reserva" pela equipe; trava para não oferecer a mesma mesa a dois | FR-18, FR-26, FR-38, FR-39, FR-54, FR-94 | 7 | 12 | 20 |
| B9 | Pendente e aprovação | Regra de aprovação (2 faltas, evento com aprovação), mesa provisória, prazo (4 h ou 2 h antes, o que vier primeiro), aprovar/recusar com motivo e link, aviso ao WhatsApp do dono | FR-36, FR-37, FR-43, FR-55 | 4 | 6 | 10 |

### 2.4 Painel

| # | Pacote | O que entra | FRs | O | P | Pe |
| --- | --- | --- | --- | --: | --: | --: |
| B10 | Noite no painel | `/staff/dashboard` (Hoje: noite, semana, pendentes, sem mesa, respostas ao lembrete, evento), busca por nome/telefone/código, lista com filtros, `/staff/floor` (estado de cada mesa, calculado no servidor), ações `chegou`, `sentou`, `não veio` (conta falta), `mesa vagou` (sem falta), mudar mesa, remarcar/cancelar pela casa com mensagem, sentar sem reserva (balcão ou mesa), **reserva lançada pela equipe** (lacuna 6: sem código de verificação, telefone estrangeiro aceito, 9+ pessoas, entra nas contas de faltas e visitas), atrasada / passou da tolerância (+10 min se avisou) | FR-40, FR-45…FR-54, FR-56, FR-91, FR-93 | 12 | 20 | 32 |
| B11 | Agenda, plano do dia, plantas, simulação | Calendário do mês, plano do dia (CRUD + padrão por dia da semana), plantas (CRUD, duplicar, áreas, mesas, junções), simulação antes de mudar (porte de `simulate`/`planDayChange`/`applyDayPlan`), reservas que ficaram sem mesa, fechar dia só depois de remarcar ou cancelar cada reserva, configurações por seção (mudança vale só para reservas novas), cadastro em 5 passos e estado "casa sendo cadastrada" | FR-57…FR-63, FR-83, FR-84 | 12 | 20 | 32 |
| B12 | Eventos e lista na porta | CRUD, publicar, duplicar, apagar, modo (mesa / lista / os dois), capacidade da lista, limite de pessoas por evento, **várias fotos das edições passadas** (lacuna 3), lista de convidados, check-in com chegada parcial e desfazer, exportar lista | FR-4, FR-13, FR-64…FR-66 | 7 | 11 | 18 |
| B13 | Conteúdo, cardápio, avisos, regra do dia | Endpoints públicos `/house` (aberta agora, exceção, próxima abertura), `/menu`, `/content` com cache curto; cardápio em rascunho + publicar, categorias, ordem, preço "a confirmar"; ligar/desligar prato na hora; **prato do dia separado** e opção de aparecer no "Hoje na casa" (lacuna 5); blocos de texto com versões e restaurar; **avisos com validade e regra por dia da semana** (lacuna 5); bloco da política de privacidade (lacuna 10) | FR-1…FR-3, FR-6, FR-67…FR-69, FR-99 | 10 | 16 | 26 |
| B14 | Imagens | Upload com validação de tipo e tamanho, texto alternativo obrigatório, tirar metadados, gerar tamanhos (Pillow, WebP/AVIF) pelo laço de tarefas, gravar no disco da VM servido pelo nginx, uso da foto **editável** (lacuna 4), apagar só se não estiver em uso | FR-70 | 5 | 9 | 15 |
| B15 | Clientes e LGPD | Lista com visitas e faltas, anotação, revelar telefone (vai ao registro), bloquear, exportar reservas/listas/clientes em CSV com reautenticação, baixar os próprios dados, apagar os próprios dados (cancela futuras), anonimizar a pedido, apagar restrição alimentar 30 dias após a visita, anonimizar após 24 meses sem visita, registro guardado 12 meses | FR-33, FR-34, FR-71…FR-76, FR-97 | 9 | 14 | 22 |
| B16 | Registro de ações | Tabela só-inclusão gravada na mesma transação, "Salão" para a conta do tablet, listar/filtrar (dono vê tudo, gerente só as próprias), exportar | FR-78 | 3 | 6 | 10 |

### 2.5 Mensagens e automação

| # | Pacote | O que entra | FRs | O | P | Pe |
| --- | --- | --- | --- | --: | --: | --: |
| B17 | WhatsApp (código) | Cliente da Cloud API (httpx), catálogo dos ~15 templates de `04` §Mensagens com variáveis e `{dia_com_artigo}`, envio a partir da outbox com nova tentativa e sem duplicar, webhook da Meta (verificação por GET com `hub.challenge`, assinatura `X-Hub-Signature-256`, botões do lembrete → confirmar / cancelar / +10 min, status entregue/lido/falhou) no lugar do `/internal/whatsapp/replies` (lacuna 8), registro de mensagens, janela de 24 h, limite de ~250 conversas/dia observado | FR-15, FR-21, FR-22, FR-27, FR-43, FR-90 | 12 | 20 | 32 |
| B18 | Meta (configuração, Matheus) | Conta Business no nome da casa, número novo, app, token permanente (usuário de sistema), webhook registrado, envio dos templates, correção de template recusado, pedido de verificação da empresa. Só horas de trabalho; a espera está na folga | FR-89, FR-90 | 4 | 8 | 16 |
| B19 | Laço de tarefas | Tabela de tarefas com horário + outbox, um laço no processo da API com `pg_advisory_lock`, retentativa e batimento; tarefas: lembrete (180 min antes de abrir, não manda para quem reservou depois), "sem resposta" (30 min antes), atrasada / passou da tolerância, vencer pendente, vencer oferta e passar ao próximo, fechar a noite no horário de fechamento (FR-42, lacuna 9), encerrar lista de dia fechado (FR-96), apagar dado de saúde e anonimizar (FR-97), limpar chaves de idempotência / códigos / sessões / links vencidos, processar fotos; tudo por relógio do servidor em America/Sao_Paulo com "depois da meia-noite é a noite anterior" | FR-22, FR-37, FR-39…FR-42, FR-96, FR-97 | 9 | 15 | 24 |

### 2.6 Contrato, testes e integração

| # | Pacote | O que entra | FRs | O | P | Pe |
| --- | --- | --- | --- | --: | --: | --: |
| B20 | As 10 lacunas do contrato | Escrever no `openapi.yaml` e no mock (mesmo commit) as 10 lacunas do adendo: `party_size` no PATCH, opt-in de novidades, várias fotos no evento, usos da foto editáveis, avisos + regra do dia + prato do dia separado, reserva pela equipe, matriz de papéis, webhook da Meta e status, gatilhos das tarefas, bloco da política. Congelar a v1. A implementação de cada uma está no pacote dela (B7, B10, B12…B19); aqui é desenho, contrato, mock e revisão | FR-3, FR-16, FR-31, FR-64, FR-67, FR-69, FR-70, FR-91, FR-99 | 5 | 8 | 14 |
| B21 | Testes que atravessam tudo | pytest com Postgres real (contêiner local ou banco de teste no Supabase), fábrica de dados, teste de concorrência (duas reservas na mesma mesa ao mesmo tempo → uma 409), teste de idempotência sob repetição, tabela completa de transições, fuso e virada da meia-noite, relógio controlável para as tarefas, contrato gerado × arquivo, suíte do front com `VITE_API_MODE=http` contra a API real, revisão de segurança (OWASP, cabeçalhos, IDOR por `house_id`) e correções | transversal | 14 | 22 | 36 |
| B22 | Integração com o front | Trocar o mock pela API real e corrigir o que o mock perdoa: cookies e CSRF, erros problem+json por campo, 401/403/409/422 reais, idempotência de verdade, latência (estados de carregando), datas e horários que vêm do servidor, paginação, dados de semente diferentes dos do mock, imagens com tamanhos reais. Conta o lado do backend e o lado do front dos ajustes; a tarefa 7.7 do front (1 dia) é só o começo disto | todos F, B | 14 | 24 | 40 |

### 2.7 Publicação e operação

| # | Pacote | O que entra | FRs | O | P | Pe |
| --- | --- | --- | --- | --: | --: | --: |
| B23 | Deploy na Oracle + domínio | VM Always Free em São Paulo (forma ARM pode estar sem capacidade: tentar de novo ou usar a AMD micro), regras de rede da Oracle + iptables da imagem, nginx com cabeçalhos e cache, certbot, uvicorn + systemd, front e API no mesmo domínio, `/admin`, demo em subdomínio com noindex, script de deploy com confirmação, DNS do domínio da casa, segredos só no arquivo de ambiente | FR-85 | 5 | 9 | 16 |
| B24 | Backups + teste de restauração | `pg_dump` diário + fotos → Object Storage (API compatível com S3), regra de vida de 30 dias, aviso se falhar, primeira restauração de verdade num banco vazio com registro do tempo e do passo a passo | FR-86 | 3 | 6 | 10 |
| B25 | Acompanhamento | `/api/v1/health` (banco + batimento do laço + fila de mensagens), verificador externo grátis, captura de erros, aviso ao Matheus, alerta de máquina parada (risco da Oracle recuperar VM ociosa) e de Supabase pausado | FR-87 | 3 | 5 | 8 |
| B26 | Texto da política de privacidade | Redigir no tom da casa a partir do que o sistema guarda de fato (dados, finalidade, prazos, direitos, contato), revisão da casa, publicar no bloco de conteúdo | FR-7 | 3 | 5 | 8 |
| B27 | Apoio à noite simulada | Cadastrar a planta real e a configuração da casa, roteiro de cenários (reserva, pendente, espera, oferta, atraso, não veio, sem reserva, evento com lista), relógio adiantável no ambiente de demo para disparar lembrete e prazos, acompanhar a sessão com a equipe e corrigir o que aparecer | etapa 3 do escopo | 6 | 10 | 16 |

## 3. Total do backend

| Grupo | O (h) | P (h) | Pe (h) |
| --- | --: | --: | --: |
| Base (B1–B3) | 18 | 29 | 48 |
| Acesso (B4–B5) | 20 | 31 | 49 |
| Reserva, núcleo (B6–B9) | 33 | 56 | 92 |
| Painel (B10–B16) | 58 | 96 | 155 |
| Mensagens e automação (B17–B19) | 25 | 43 | 72 |
| Contrato, testes, integração (B20–B22) | 33 | 54 | 90 |
| Publicação e operação (B23–B27) | 20 | 35 | 58 |
| **Total** | **207** | **344** | **564** |
| **Em dias úteis (6 h)** | **≈ 35** | **≈ 57** | **≈ 94** |

Leitura: o painel é o maior bloco (28% do provável), seguido do núcleo da reserva e da integração com o front. O pessimista é 1,6 × o provável porque concentra os pacotes em que o risco é técnico de verdade (concorrência, fuso, WhatsApp, simulação).

## 4. Somando o front e as esperas

| Item | Otimista | Provável | Pessimista |
| --- | --: | --: | --: |
| Backend | 35 | 57 | 94 |
| Front restante (fases 2 a 7, `extract-arquitetura.md`) | 13 | 15 | 18 |
| Folga para esperas da Meta e da casa (templates recusados, verificação da empresa, material, aprovação das telas, noite simulada marcada) | 3 | 5 | 10 |
| **Total em dias úteis** | **51** | **77** | **122** |
| **Em semanas (5 dias)** | **≈ 10** | **≈ 15,5** | **≈ 24,5** |

Sobre a folga: a espera da Meta corre em paralelo se os textos forem à Meta no dia da assinatura; ela só vira dia perdido quando trava o fim (código de verificação e lembrete não funcionam sem template aprovado). A aprovação das telas (etapa 1) trava o começo do "sistema real" no escopo; se a sessão com o Marcus atrasar uma semana, a entrega atrasa uma semana.

## 5. Cabe em 8 semanas?

**Não.** Com 40 dias úteis desde a assinatura, nem o cenário otimista cabe (51 dias); o provável pede cerca de 77 dias, quase o dobro. Cortar escopo ajuda (seção 7), mas não fecha a conta: mesmo com os cortes, o provável fica perto de 64 dias (≈ 13 semanas).

Caminhos honestos para a conversa com o Marcus:

1. **Assinar um prazo realista:** 14 semanas com os cortes da seção 7, ou 16 semanas com o escopo inteiro (provável). O pessimista não deve ser prometido, mas serve de aviso.
2. **Manter as 8 semanas para uma abertura menor:** só a reserva pelo site, o código e o lembrete pelo WhatsApp, a noite no painel (Hoje, Salão, chegou / não veio / sem reserva / reserva pela equipe), o cardápio com "tem hoje", o acesso da equipe sem extras, publicação, backup e acompanhamento. Mesmo esse núcleo soma perto de 38 dias de backend + 13 de front: também não cabe em 40 dias com uma pessoa a 6 h/dia. Só cabe com mais horas por dia, uma segunda pessoa, ou com o restante entregue numa segunda etapa já com data no contrato.
3. **Não recomendado:** prometer 8 semanas contando com 9–10 h por dia. O plano já tem pouca margem para o que não depende do Matheus (Meta, casa).

## 6. Maiores riscos

| # | Risco | Efeito no prazo | Mitigação |
| --- | --- | --- | --- |
| R1 | **Meta:** template recusado, verificação da empresa demorada, número suspenso. Sem template aprovado não há código de verificação, então não há reserva pelo site (não existe plano B) | Trava a publicação, não o código | Mandar os textos no dia da assinatura; começar com o limite inicial (~250 conversas/dia, FR-90); ter a reserva pela equipe (FR-91) pronta antes, para a casa operar se o número cair |
| R2 | **Integração com o front maior que o previsto:** o mock perdoa sessão, CSRF, 409, fuso e latência; cada tela tem um ajuste | B22 vai do provável (24 h) ao pessimista (40 h) | Ligar a primeira tela à API real cedo (reserva pública), não no fim; teste de contrato desde o B1 |
| R3 | **Concorrência e fuso:** reserva dupla, oferta para dois, tarefa disparada duas vezes, virada da meia-noite | Bugs que só aparecem na noite simulada ou na primeira noite cheia | Exclusion constraint e `pg_advisory_lock` desde o início; testes de concorrência e de relógio no B21; noite simulada com relógio adiantável |
| R4 | **Escopo do painel:** simulação, plantas, eventos com lista e conteúdo com versões são mais de um terço do painel e os menos usados no primeiro mês | Puxa o provável para cima | São os primeiros candidatos a corte (seção 7) |
| R5 | **Casa:** material, 29 decisões, aprovação das telas por escrito, data da noite simulada | Cada semana de espera é uma semana de atraso no fim | Prazo contado da entrega do material (já está no escopo); combinar as datas da sessão de telas e da noite simulada na assinatura |
| R6 | **Hospedagem gratuita:** VM ARM sem capacidade em São Paulo na hora de criar; Oracle recuperar VM ociosa; Supabase pausar projeto parado | De horas a 1–2 dias no deploy; queda depois de aberto | Criar a VM na primeira semana (não no fim); alerta de máquina parada (B25); passar a conta da Oracle para paga sem custo de uso |
| R7 | **Uma pessoa só:** doença, outro cliente, faculdade (Uniamérica) disputando as mesmas semanas | Não tem quem cubra | Prazo com folga explícita; não aceitar outro projeto grande no mesmo período |

## 7. O que cortar ou adiar

Nenhum corte sozinho fecha as 8 semanas (ver seção 5). A lista abaixo é a ordem sugerida para reduzir o prazo, do que mais economiza com menos perda para a casa. "Adiar" = entra nos 30 dias de correção depois de abrir ou num módulo seguinte, com data.

| Ordem | Cortar ou adiar | FRs | O que fica no lugar | Economia provável (back) | Economia (front) |
| --- | --- | --- | --- | --: | --: |
| 1 | **Replanejamento e editor de plantas:** simulação, resolver sem mesa, trocar a planta da noite, várias plantas, planta padrão por dia | FR-57, FR-58, FR-60, FR-62, FR-63 (FR-61 simplificado) | Uma planta, cadastrada pelo Matheus por semente; fechar um dia só quando não há reserva ou depois de a casa cancelar uma a uma (FR-56); plano do dia só abre/fecha e muda horário | 12 h | ~1,5 dia |
| 2 | **Lista de espera automática:** oferta sozinha, prazo de 10 min, passar ao próximo, aceitar/recusar pelo link | FR-26, FR-38, FR-39 (FR-96 simplificado) | Lista de espera com posição (FR-18) e "virar reserva"/oferecer à mão pela equipe (FR-54, FR-94), com a casa falando com o cliente | 10 h | ~0,5 dia |
| 3 | **Eventos com lista na porta:** modo lista e "os dois", capacidade da lista, check-in, exportar lista, fotos das edições passadas | FR-65, FR-66, parte do FR-64 (lacuna 3) | Evento como conteúdo + noite com reserva de mesa normal e limite de pessoas; uma foto por evento | 7 h | ~1 dia |
| 4 | Extras do acesso: duas etapas, lista de sessões, recusa de senha vazada | FR-82, FR-98 | Senha forte com argon2, bloqueio por erros, troca por e-mail; sair encerra a sessão | 7 h | ~0,5 dia |
| 5 | LGPD por autoatendimento e exportações | FR-33, FR-34, FR-76 (FR-97 vai para os 30 dias de correção: a primeira restrição só vence 30 dias depois da primeira visita) | Pedido pelo WhatsApp da casa, o dono apaga pelo FR-75 dentro do prazo legal | 7 h | ~0,5 dia |
| 6 | Rascunho e versões de conteúdo/cardápio | parte do FR-68 e do FR-69 | Edição direta, com o registro (FR-78) guardando o antes e o depois | 5 h | — |
| 7 | Cadastro guiado em 5 passos | FR-83 | Matheus faz o cadastro com a casa na noite simulada | 3 h | ~0,5 dia |
| | **Soma** | | | **≈ 51 h (≈ 8,5 dias)** | **≈ 4,5 dias** |

**Não cortar:** reserva dupla impedida no banco (FR-44), código pelo WhatsApp (FR-15), lembrete com botões (FR-22), "não veio" × "mesa vagou" (FR-51, FR-52), reserva lançada pela equipe (FR-91, é o plano B se o número cair), mudar o número de pessoas (FR-31, está no escopo assinável), backup com restauração testada (FR-86) e acompanhamento (FR-87), que a mensalidade promete.

Efeito: com os 7 cortes, o provável cai de ≈ 77 para ≈ 64 dias úteis (≈ 13 semanas), e o pessimista de ≈ 122 para ≈ 105. Os três primeiros cortes dão mais da metade da economia.

## 8. Ordem sugerida de construção

1. Semana 1, em paralelo com o front: textos para a Meta (B18), VM e domínio (B23), setup e esquema (B1, B2), lacunas do contrato (B20).
2. Núcleo: disponibilidade (B6), ciclo da reserva (B7), código do cliente (B5), WhatsApp (B17), laço de tarefas (B19). Ligar a reserva pública do front à API real assim que o B7 responder (começa o B22).
3. Painel da noite: acesso da equipe (B4), permissões (B3), noite (B10), pendente (B9), registro (B16), conteúdo e cardápio (B13).
4. O resto do painel (B8, B11, B12, B14, B15), no tamanho que a seção 7 deixar.
5. Fechamento: testes que atravessam (B21), backup e restauração (B24), acompanhamento (B25), política (B26), noite simulada (B27).

---

Estado: completo (08/10/2026).
