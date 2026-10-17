# Revisão pela régua · ARCHITECTURE-SPINE.md (Território, Módulo 1)

- **Data:** 08/10/2026
- **Revisado:** `ARCHITECTURE-SPINE.md` (draft, 16 ADs), contra a régua do "bom spine".
- **Lido para conferir:** o registro de decisões da época (não está mais no repositório), `pesquisa-stack.md` e `estimativa-backend.md` (desta pasta); `prd.md` e `addendum.md` (PRD); `docs/03-modelos.md`, `docs/04-regras-reserva.md` e `docs/api/openapi.yaml`; `README.md`, `package.json`, `vite.config.js`, `eslint.config.js`, `.env*`, `src/app/boot.js`, `src/services/api/*`, `src/lib/{dates,idempotency,money}.js` e `src/mocks/{start.js,handlers/public.js}`.

## Veredito

O spine acerta no núcleo da reserva: transição única, constraint no banco, relógio, outbox, sessões e uma porta só no front. Ainda não serve de base para construir, por três motivos. Faltam duas decisões que todas as histórias do backend tocam: quem abre a transação e o modelo de acesso ao banco (sync ou async, psycopg ou SQLAlchemy Core). Falta um ambiente com o backend real antes da produção. E algumas Regras afirmam garantias que não se cumprem como estão escritas (outbox "não reenvia", teste de contrato exato, CSRF "em toda escrita") ou contradizem o código do front que já existe.

| Severidade | Quantos |
| --- | --- |
| Crítico | 2 |
| Alto | 9 |
| Médio | 10 |
| Baixo | 7 |
| **Total** | **28** |

## Resultado por item da régua

| Item da régua | Situação |
| --- | --- |
| Fixa os pontos reais de divergência, sem faltar nenhum | **Parcial.** Faltam a transação e o acesso ao banco (C-1), o catálogo de tarefas e o que é calculado ou gravado (A-3), a ligação da resposta do WhatsApp com a reserva (A-2), o modo `static` (A-1), a atualização do painel (M-5) e a forma de cortar campos por papel (A-6) |
| Cada Regra é verificável e impede a divergência que diz impedir | **Parcial.** AD-2, AD-5, AD-6, AD-8 e AD-9 têm Regras que não se verificam ou que não fecham a divergência (A-3, A-4, A-5, A-8, M-1) |
| Nada em "Adiado" deixa duas partes divergirem | **Quase.** O tamanho da VM decide se o AD-13 cabe (M-8). O resto do Adiado não afeta como as partes são construídas |
| Tecnologia citada é atual (pesquisa-stack.md) | **OK.** Todas as versões batem com a pesquisa de 08/10. Faltam bibliotecas que o próprio spine exige (M-10) |
| Ratifica o front existente sem contradizer | **Parcial.** Contradiz o código em CSRF (A-5), `errors[].field` (M-6) e fotos (A-7). O modo `static` não existe no código (A-1) |
| Cobre as funções do PRD e as três entregas | **Quase.** A tabela de funções cobre todos os grupos de FR, e o AD-15 cobre as entregas. Faltam FR-20, FR-33/76 (exportação), FR-87 (captura de erros) e FR-88 (atualizações) (A-9, B-4) |
| Toda dimensão da altitude está decidida, adiada ou em aberto (envelope operacional) | **Não.** Faltam homologação e banco de teste (C-2), CI, ordem de publicação e migração, volta atrás, captura de erros, rede e SSH, atualizações e gerenciador de dependências (A-9). Faltam também criptografia e tamanho do backup, e o agendamento dele (M-4) |
| O registro de decisões da época entrou no spine | **Sim, com pequenos desvios** (B-1; tabela no fim) |

## Achados

### Crítico

**C-1. Ninguém é dono da transação, e o modelo de acesso ao banco está em aberto.**
O AD-4 exige mudança, registro e outbox "na mesma transação". O AD-3 proíbe o domínio de escrever SQL e de conhecer FastAPI. Não está dito quem abre e confirma essa transação: a rota, por dependência, ou um "unit of work" passado ao domínio. Também não está decidido:

- se as rotas e o repo são `async` (psycopg `AsyncConnection`) ou síncronos, rodando no threadpool;
- se o repo escreve SQL cru com psycopg ou usa SQLAlchemy Core. A tabela de camadas diz "psycopg / SQLAlchemy", e as Ferramentas listam os dois;
- qual pool de conexões usar (`psycopg_pool` nem está nas Ferramentas).

Cada pessoa vai escolher de um jeito, e os repos não vão se compor. Uma função de domínio que chama dois repos em conexões diferentes quebra o AD-4 sem ninguém perceber.

**Correção:** acrescentar um AD-17, "Transação e acesso ao banco", com esta Regra:

- "Rotas `async def`. Uma dependência `uow()` abre **uma** conexão do `psycopg_pool.AsyncConnectionPool` e **uma** transação por requisição de escrita, e entrega ao domínio um objeto `Uow` com os repos já ligados a essa conexão. O domínio nunca abre nem confirma transação. O laço de tarefas usa o mesmo `Uow`, uma transação por tarefa."
- "O repo usa SQLAlchemy Core para montar SQL e executa pela conexão psycopg do `Uow` (ou: SQL cru com psycopg, escolher um). Nenhum ORM."
- Pôr `psycopg_pool` (versão exata) nas Ferramentas.
- Criar um teste de arquitetura (import-linter ou um teste pytest que lê os imports) que falha se `domain/` importar `fastapi`, `httpx`, `psycopg` ou `sqlalchemy`. Assim o AD-3 deixa de depender da boa vontade de quem escreve.

**C-2. Não existe ambiente com o backend real antes da produção, nem banco de teste definido.**
A tabela de ambientes tem dev (mock), demo (mock) e prod. O escopo assinado prevê a etapa "Sistema real" e a "Noite simulada", em que a equipe opera uma noite com reservas de teste e relógio adiantável (estimativa, R3). Isso não pode acontecer na produção, que nessa época está servindo a entrega 1. A convenção "pytest contra Postgres de verdade" não diz qual Postgres. A estimativa (B21) ainda oscila entre "contêiner local ou banco de teste no Supabase". Também não há número de WhatsApp de teste. O risco concreto: uma sessão aponta testes ou migrações para o banco de produção.

**Correção:** completar a tabela de ambientes e escrever a Regra no AD-14 ou num AD novo:

- **test:** Postgres 17 local em contêiner, com `btree_gist`, para o pytest. Nunca o Supabase.
- **homolog:** o segundo projeto Free do Supabase (o plano permite 2 ativos) e o subdomínio `homolog.` na mesma VM, com um segundo processo uvicorn e a Meta em número de teste. O relógio só pode ser adiantado aqui (`CLOCK_OFFSET` lido do ambiente, recusado se `ENV=prod`). É onde roda a noite simulada.
- **prod:** como está.

Acrescentar: "Cada ambiente tem seu próprio arquivo de ambiente e seu papel no banco. O script de publicação recusa migrar prod sem `--prod` e confirmação." Dizer também que a trava do laço (AD-5) é por banco: dois processos em bancos diferentes não se bloqueiam, e isso é o esperado.

### Alto

**A-1. O modo `VITE_API_MODE=static` do AD-15 não existe no código, e a origem do conteúdo "gravado na publicação" não está definida.**
O front tem só `mock` e `http` (`.env.*`, `boot.js`). O `vite.config.js` só barra `mock` em produção. O README diz que `npm run build` é "API real". Ficam em aberto:

- de onde vem o cardápio, os horários e os eventos no build da entrega 1. Já existe `src/content/images.json`; texto e cardápio virão de JSON no repositório?
- como a FR-1 ("sem a API, a página mostra o cardápio do momento da publicação") vale **também** na entrega 2. Ou existe um pré-render na publicação, lendo da API ou do banco, ou a página fica sem conteúdo quando a API cai;
- se `/reservar?pessoas=4`, o link da bio da UJ-1, já existe na entrega 1. Se não existir, a URL pública muda na entrega 2, que é justamente o que o AD-15 quer impedir.

**Correção:** reescrever a Regra do AD-15:

- "`static` é um terceiro modo de `src/services/api`: os módulos de recurso leem `src/content/*.json` (gerado na publicação) em vez de HTTP. Nenhuma tela sabe o modo."
- "O build de produção (`npm run build:site` na entrega 1, `npm run build` depois) roda `scripts/snapshot-content.mjs`, que grava o JSON a partir dos arquivos do repositório (entrega 1) ou de `GET /api/v1/house|menu|content` (entrega 2). O HTML sai pré-renderizado desse JSON e, com a API, é atualizado no navegador."
- "Todas as URLs públicas da entrega 2 (`/reservar`, `/minhas-reservas`, `/r/`, `/confirmar`, `/espera`) existem desde a entrega 1. Na entrega 1, `/reservar` abre o WhatsApp da casa com a mensagem montada pelos parâmetros."

Atualizar `vite.config.js` para aceitar `static` só com `--mode site` e acrescentar o script no `package.json`. Isso fica para a história. O spine só fixa a regra.

**A-2. O webhook da Meta não diz como a resposta encontra a reserva, e o contrato ainda descreve o caminho do n8n.**
O contrato tem `POST /internal/whatsapp/replies` com `internalSignature` ("HMAC ... compartilhado com o n8n"), `X-Signature` e o corpo `{message_id, phone, answer}`. O AD-12 diz que a Meta chama a API direto, mas não diz:

- **o caminho**: o novo endpoint, e que o antigo sai do contrato. O AD-2 manda mudar o contrato primeiro, e o teste dele vai acusar a divergência;
- **como ligar o toque do botão à reserva.** Um telefone pode ter 2 reservas futuras ativas, e até duas na mesma noite. Procurar pelo telefone pode cancelar a reserva errada no "Não vou mais";
- **o que fazer com os status** (`sent`, `delivered`, `read`, `failed`), que alimentam o `MessageLog` de `03-modelos.md`.

**Correção:** completar a Regra do AD-12:

- "Webhook em `GET|POST /api/v1/webhooks/whatsapp`. O `POST` confere `X-Hub-Signature-256` sobre os **bytes crus**, antes de interpretar o JSON, com `hmac.compare_digest`. `/internal/whatsapp/replies` e `internalSignature` saem do contrato."
- "Cada linha da outbox guarda o `wamid` devolvido pela Meta. O payload de cada botão de resposta rápida leva `<reservation_id>:<answer>`. A resposta é ligada pelo payload, conferida pelo `context.id`, e nunca pelo telefone."
- "Eventos de status atualizam a linha da outbox e o `MessageLog`, sem chamar o domínio."
- "O webhook responde 200 depois de gravar o evento cru numa tabela `inbound_events` (idempotente pelo id do evento). O tratamento acontece na mesma requisição ou no laço."

Pôr isso no contrato como lacuna 8 antes de qualquer rota.

**A-3. O AD-5 promete o que a Graph API não garante e não fixa o catálogo de tarefas.**
"Cada linha tem chave de idempotência; repetir não reenvia" não se cumpre: a API de mensagens da Meta não aceita chave de idempotência. Se o processo cair entre o 200 da Meta e o "marcar feito", a mensagem sai de novo. Também não está fixado:

- como o laço pega as linhas para si (lease e estado `sending`) nem quantas vezes tenta de novo;
- quais tarefas existem e com que granularidade. O lembrete pode ser uma tarefa por reserva, criada na reserva, ou uma por noite. "Reserva feita depois do envio do lembrete não recebe lembrete" só fica certo no segundo modelo;
- se "atrasada" e "passou da tolerância" (FR-40) são gravadas por tarefa ou calculadas na leitura. A estimativa B19 lista como tarefa; a B10 diz "calculado no servidor";
- que uma tarefa vencida sobre uma reserva que mudou (por exemplo, oferta já aceita) tem de virar nada, e não erro.

**Correção:** reescrever a Regra do AD-5:

- "Entrega **pelo menos uma vez**. Cada linha passa por `pending → sending (lease 60 s, attempts++) → sent | failed`, até 5 tentativas com espera crescente. Se o lease vencer, outro ciclo pega a linha. Para reduzir o envio duplo, a linha guarda o `wamid` assim que a Meta responde. A chave de idempotência impede **enfileirar** duas vezes (`UNIQUE(house_id, idempotency_key)`), não enviar duas vezes."
- Acrescentar uma tabela de tarefas: `night_reminder` (uma por noite), `night_no_reply` (uma por noite), `pending_expiry` e `offer_expiry` (uma por reserva), `night_close` (uma por noite), `retention_sweep` (diária), `cleanup` (diária), `image_process` (uma por foto).
- "Toda tarefa sobre reserva chama `transition()`. `invalid_transition` marca a tarefa como `skipped`."
- "As marcações da noite (atrasada, passou da tolerância, sem resposta) são calculadas na leitura a partir de `server_time`, nunca gravadas."
- Pôr a mesma transação também para mensagens fora de transição, como o código de verificação.

**A-4. O teste de contrato do AD-2, como está escrito, falha sempre ou não confere nada, e nada confere o mock.**
Comparar o OpenAPI que o FastAPI gera com um arquivo escrito à mão dá diferença em tudo: nomes de schema, `problem+json`, segurança por cookie, `422` automático, ordem das chaves. Na prática alguém afrouxa o teste. Além disso, "o mock muda no mesmo commit" não tem verificação: os handlers do MSW podem divergir do arquivo sem nenhum teste falhar.

**Correção:** trocar a Regra:

- "O teste normaliza os dois documentos e compara caminho × método × status, nomes de parâmetros e o JSON Schema dos corpos, sem olhar descrições nem nomes de componentes."
- Ou então: "Os modelos Pydantic são gerados do `openapi.yaml` (`datamodel-code-generator`, com versão fixa) e nunca escritos à mão."
- Para o mock: "Um teste em `tests/unit` valida as respostas dos handlers do MSW contra o schema do `openapi.yaml` (Ajv). O `npm test` falha se divergir."

**A-5. "Toda escrita exige o cabeçalho CSRF" (AD-9) contradiz o front e o contrato.**
`src/services/api/client.js` manda sem token, de propósito, os pedidos feitos antes de existir sessão: `/auth/otp`, `/auth/verify`, `/staff/auth/{login,mfa,setup,accept-invite,forgot,reset}` e todos os `POST /links/*`. O webhook da Meta também é um `POST` sem CSRF. Quem seguir o AD-9 ao pé da letra quebra o login, o código de verificação e os links.

**Correção:** escrever na Regra a lista fechada de exceções, igual à expressão `NO_SESSION` do cliente mais o webhook. Dizer que essas rotas se protegem por outra via:

- **links:** pelo token de ação;
- **webhook:** pela assinatura;
- **login e código:** por limite de tentativas e por `Origin`/`Sec-Fetch-Site` conferido no servidor.

Acrescentar: "O token CSRF é por sessão, guardado com ela, e devolvido em `/me` e `/staff/auth/session`." E um teste que percorre todas as rotas de escrita fora da lista e espera `403 csrf_failed` sem o cabeçalho.

**A-6. O AD-9 não fixa as decisões de segurança que a estimativa já conta e que o PRD exige.**
A estimativa (B1, B3, B4) prevê limite de taxa, TOTP com códigos de recuperação, recusa de senha vazada (HIBP), reautenticação em ações sensíveis e cortes por papel ("só a noite", "dígitos escondidos"). O spine não diz nada disso. Sem regra, cada rota corta campos do seu jeito, e o telefone completo ou a restrição alimentar escapam numa resposta.

**Correção:** acrescentar ao AD-9, ou num AD-18 "Dados sensíveis e limites":

- **Limite de taxa:** em tabela no Postgres por (chave, janela), aplicado por dependência nas rotas de código, login, reserva e esqueci a senha. O nginx só faz um teto grosso por IP. O IP real vem de `X-Forwarded-For`, aceito só do nginx local.
- **Reautenticação:** uma dependência `require_recent_password()` (senha conferida há menos de 5 min) nas rotas de exportar, apagar cliente e mudar papéis. Nenhuma rota confere senha por conta própria.
- **TOTP:** `pyotp`. Segredo cifrado no banco com uma chave do arquivo de ambiente. 10 códigos de recuperação guardados como hash.
- **Cortes por papel:** os schemas de resposta da equipe são montados por um único `serialize_for(role, obj)`. O telefone sai mascarado para o salão. `dietary`/saúde só vai para dono e gerente e nunca entra em exportação. Um teste por papel confere os campos.

**A-7. O AD-13 ("duas formas de guardar e servir foto") ignora o fluxo de imagens que o front já tem.**
O front já gera AVIF, WebP e JPG de `assets-src/` com `sharp` (`npm run images`) e lista as fotos em `src/content/images.json`. A entrega 1 depende disso. Na entrega 2 entra o banco de fotos em `/media`. Já são duas formas, e o spine não diz qual foto fica em qual, nem como as fotos da entrega 1 passam para o banco de fotos quando o painel assume o site.

**Correção:** ratificar as duas e separar as funções na Regra:

- "As fotos da identidade, fixas e só mudadas por pedido ao suporte, ficam no build (`assets-src` → `sharp` → `/assets/`)."
- "As fotos que a casa troca pelo painel ficam em `/media/`, processadas pelo Pillow com os **mesmos** tamanhos (480/960/1600) e formatos."
- "Na entrega 2, um script de semente importa as fotos de conteúdo de `images.json` para o banco de fotos uma vez. Depois disso, as telas de conteúdo só leem `Image` da API."

**A-8. O AD-6 não diz como "estados ativos" chegam à tabela de ocupação, nem os casos de borda.**
A tabela de ocupação é separada da reserva. Ficam em aberto:

- se a constraint usa uma coluna de estado copiada da reserva (que pode ficar desatualizada) ou se a linha de ocupação é apagada na transição;
- os limites do intervalo: `[)` para que 19:00–21:00 e 21:00–23:00 não colidam;
- se quem chega sem reserva (FR-50) e as mesas guardadas ocupam linhas;
- o que "mesa vagou" (`left_at`) faz com o fim do intervalo;
- se as linhas apontam para o `table.id` da planta do dia. Ao trocar a planta (FR-58), as ocupações da data mudam de mesa.

**Correção:** escrever na Regra:

- "Linhas de `table_occupancy(house_id, table_id, period tstzrange '[)', reservation_id)` existem só enquanto a reserva está `pending` com mesa, `confirmed` ou `offered`. `transition()` cria e apaga as linhas na mesma transação. A constraint é `EXCLUDE USING gist (table_id WITH =, period WITH &&)`, sem filtro por estado."
- "Quem chega sem reserva é uma reserva `source=walk_in` e ocupa linhas como as outras. Mesa guardada não ocupa linha: é filtro da disponibilidade."
- "'Mesa vagou' encurta `period` até `left_at`."
- "Trocar a planta de uma data reatribui as linhas na mesma transação. O que não couber fica sem mesa (FR-57)."
- E um teste de concorrência (duas transações, uma recebe 409) como critério de aceite.

**A-9. O envelope operacional não decide CI, ordem de publicação, volta atrás, captura de erros, atualizações, rede e dependências.**
O AD-14 e o AD-16 cobrem a VM, o nginx, o backup e o health. Faltam, e dois deles são promessas do PRD (FR-87, FR-88):

- **CI:** a estimativa (B1) prevê lint + pytest. Onde roda e o que bloqueia a publicação?
- **Ordem de publicação:** migrar antes ou depois de reiniciar? As migrações precisam ser compatíveis com o código anterior? Como se volta atrás, se as migrações só andam para frente?
- **Captura de erros (FR-87, "acompanhar erros"):** só há health. Nada registra uma exceção 500.
- **Atualizações (FR-88, segurança em até 7 dias):** sem `unattended-upgrades`, sem `pip-audit`/`npm audit`, sem Dependabot.
- **Rede:** security list da OCI e iptables só com 80/443. SSH só por chave, de preferência fechado ao público.
- **Gerenciador de dependências do Python** e arquivo de trava.
- **Imagem do sistema** e como o Python 3.13 é instalado na VM.

**Correção:** acrescentar um AD-19, "Publicação e manutenção", com esta Regra:

- "GitHub Actions roda `npm run lint && npm run test:unit` e `ruff + pytest` a cada push. `deploy/publish.sh` só publica um commit com CI verde."
- "Ordem: backup → `alembic upgrade head` → troca do build → `systemctl restart`. Migração compatível com o código anterior. Voltar atrás é publicar o commit anterior; nunca `downgrade`."
- "Exceções não tratadas vão para o log JSON (journald, 14 dias) e para um alerta. Escolher entre Sentry Free e GlitchTip, ou um e-mail pelo Resend com limite."
- "`unattended-upgrades` só de segurança. `pip-audit` e `npm audit` semanais no CI. Dependabot mensal."
- "Ubuntu 24.04. Python por `uv` com `uv.lock`. Portas 80/443 abertas; 22 só pelo Bastion da OCI ou por IP fixo."

### Médio

**M-1. "Toda consulta filtra por `house_id`" e a RLS do AD-8 não têm mecanismo.**
Nada obriga o filtro. A Regra também não diz como o papel próprio do backend passa pela RLS: dono das tabelas, `BYPASSRLS` ou políticas. O spine não fala da API de dados do Supabase (PostgREST), que fica exposta à chave `anon` pública do projeto. E não define o tamanho do pool no pooler em modo sessão, que tem limite de clientes no Free, sendo que uma conexão fica presa para sempre pela trava do laço.
**Correção:**

- "Toda função de `repo/` recebe `house_id` como primeiro parâmetro obrigatório."
- "Um teste de IDOR cria duas casas e confere que nenhuma rota devolve dado da outra."
- "O papel `territorio_app` é dono das tabelas do schema `app`, fora de `public`. A API de dados do Supabase fica desligada nas configurações do projeto. A RLS nega tudo a `anon` e `authenticated`."
- "Pool de 5 conexões mais 1 dedicada à trava do laço."

**M-2. Idempotência (AD-10): "aceita" ou "exige", o alcance da chave e dois envios ao mesmo tempo.**
O contrato marca `Idempotency-Key` como `required: true`, e `04-regras-reserva.md` diz "exige". O AD-10 diz "aceita". A Regra não diz de quem é a chave: por casa, por rota, por ator. Também não diz o que acontece com dois envios **simultâneos** da mesma chave, que é justamente o toque duplo que o AD quer impedir. Nem diz que "uma reserva ativa por cliente, dia e horário" é constraint no banco.
**Correção:**

- "Obrigatória nas rotas que o contrato marca."
- "Chave única por (`house_id`, rota, `Idempotency-Key`). A primeira requisição insere a linha `in_progress` antes de trabalhar. Uma segunda com a mesma chave em andamento recebe `409 request_in_progress`; o cliente tenta de novo."
- "Índice único parcial `(customer_id, date, time) WHERE status IN (ativos)`, cuja violação vira `duplicate_reservation`."
- "As linhas são limpas pela tarefa `cleanup`."

**M-3. O registro só de inclusão (AD-11) choca com o apagamento da LGPD.**
FR-34, FR-75 e FR-97 apagam ou anonimizam o cliente. O `AuditLog` tem `actor_label`, `summary` e `changes`, que guardam nomes e telefones, e o banco proíbe `UPDATE`/`DELETE`. Uma sessão vai ou quebrar a LGPD ou abrir uma exceção na trava.
**Correção:** "O registro guarda só ids e rótulos de equipe. Dado de cliente entra por referência (`entity_id`), nunca em `summary` ou `changes`; a frase da tela é montada na leitura." Se for preciso, permitir uma única função `SECURITY DEFINER` `audit_redact(customer_id)`, chamada só pela anonimização. Acrescentar um teste que procura telefone e nome nas colunas do registro.

**M-4. Backup (AD-16): agendamento, criptografia, tamanho e restauração.**
- O AD-5 proíbe "cron do sistema", e o AD-16 não diz quem dispara o `pg_dump`.
- O dump tem dado de saúde e telefone, e vai sem criptografia.
- "Banco e fotos todo dia, guardados 30 dias" multiplica as fotos por 30 e pode passar dos 20 GB do Object Storage.
- A restauração trimestral não tem para onde ir.
- O `pg_dump` precisa ser da mesma versão principal do Postgres do Supabase.

**Correção:**

- "Backup e keep-alive por `systemd timer`. A proibição do AD-5 vale só para regras de negócio."
- "Dump cifrado com `age`, chave pública na VM e a privada fora dela."
- "Fotos por `rclone sync` para um bucket com versionamento, não cópia diária completa."
- "Restauração testada no projeto de homologação (C-2), com registro em `docs/operacao/restauracoes.md`."
- "`postgresql-client` na mesma versão principal do Supabase."
- Lembrar que um dado apagado continua até 30 dias nas cópias, e dizer isso na política de privacidade.

**M-5. O spine não decide como o painel se atualiza.**
FR-45 e FR-48 pedem "atualiza a cada 30 s no máximo". Sem regra, uma sessão põe WebSocket ou SSE. Isso mexe no nginx, no processo único e no pooler.
**Correção:** "O painel atualiza por consulta a cada 20 s (`GET /staff/floor` e `/staff/dashboard`, com `ETag`/`304`), pausada quando a aba fica escondida. Sem WebSocket ou SSE no módulo 1." Pôr em Convenções.

**M-6. A convenção "`errors[].field` em português" contradiz o contrato e o mock.**
No contrato e no mock, `field` é o nome do campo JSON em inglês (`phone`, `party_size`), e `message` é que vem em português. O `client.js` usa `field` para achar o campo do formulário.
**Correção:** trocar para "`errors[].field` = nome do campo JSON (inglês); `errors[].message` = frase em português".

**M-7. Relógio (AD-7): o nome `night_date` e o que o front pode calcular.**
O AD-7 cria `night_date`, mas o modelo e o contrato chamam isso de `date`, o que vai gerar duas colunas ou dois nomes. "O front nunca calcula prazo" se choca com a contagem da oferta (FR-26) e com o "aberta agora" do `openStatus()` em `src/lib/dates.js`, que usa o relógio do navegador (e, na entrega 1, nem tem `server_time`).
**Correção:**

- "O campo `date` da reserva **é** a data da noite. Não existe `night_date` separado."
- "O front pode **mostrar** contagens e 'aberta agora' usando `server_time` (diferença guardada em memória) e os dias que a API resolveu. Nunca decide se algo é permitido."
- "Na entrega 1, usa o relógio do aparelho com os horários gravados."

**M-8. "Forma da VM" no Adiado decide se o AD-13 cabe.**
Na AMD micro (1/8 de OCPU, 1 GB), gerar AVIF de 3 tamanhos para uma foto de 15 MB pode levar minutos e disputar memória com o uvicorn no mesmo processo. A arquitetura (ARM ou x86) também muda as wheels. Adiar a escolha é aceitável; adiar sem regra de saída, não.
**Correção:** pôr no Adiado uma regra de decisão: "Se for AMD micro: swap de 2 GB, `image_process` uma de cada vez com `nice`, AVIF só no tamanho de 960 px (o resto WebP/JPG). Se for A1: tudo como no AD-13." Em qualquer caso, `client_max_body_size 15m` no nginx.

**M-9. A matriz de papéis do AD-9 não tem fonte para o teste conferir.**
"Um teste percorre todas as operações × papéis", mas contra o quê? Os papéis de FR-52, FR-53, FR-56, FR-74 e FR-91 ainda são [SUPOSIÇÃO], e a Q8 está aberta. Se `permissions.py` for a fonte e também o gabarito, o teste não pega nada.
**Correção:** "A matriz é um arquivo de dados (`docs/api/permissoes.yaml`, operação → papéis), conferido pelo Marcus e lido pelo teste. `permissions.py` carrega ou é gerado desse arquivo. Toda operação do `openapi.yaml` aparece nele (o teste falha se faltar)." Registrar as suposições do PRD no arquivo como estão, marcadas.

**M-10. Faltam ferramentas que o próprio spine exige.**
As versões listadas batem com `pesquisa-stack.md`, sem nada desatualizado. Mas faltam:

- `python-multipart`, sem o qual o FastAPI não recebe o upload de fotos;
- `psycopg_pool` (C-1);
- a biblioteca de TOTP (A-6);
- a forma de falar com o Resend (SDK ou `httpx`);
- lint e formatação do Python (`ruff`);
- o gerenciador de dependências (A-9);
- a versão principal do Postgres (M-4).

**Correção:** acrescentar as linhas com versões exatas, depois de uma consulta ao PyPI no mesmo dia, como foi feito na pesquisa. E fixar `Python 3.13.16` (versão de correção) na VM e no CI.

### Baixo

**B-1. Pequenos desvios entre o registro de decisões da época e o spine.**
- O registro de decisões marca como [ADOPTED] o servidor (FastAPI + Supabase + VM Oracle) e o WhatsApp direto. AD-8, AD-12 e AD-14 aparecem sem a marca.
- O registro de decisões marca o ambiente demo "na mesma VM, subdomínio demo" como [SUPOSIÇÃO]. O spine afirma isso como decidido.
- O addendum sugeria APScheduler com tarefas no banco. O AD-5 recusa, e o motivo está no registro de decisões, mas não no spine.

**Correção:** marcar AD-8, AD-12 e AD-14 como [ADOPTED], manter [SUPOSIÇÃO] no demo e pôr no AD-5 uma linha: "Substitui a sugestão de APScheduler do adendo do PRD".

**B-2. A política de cache do nginx não está dita.**
É a armadilha já vista no Dionísio: HTML em cache segura JS velho.
**Correção:** no AD-14, "HTML `Cache-Control: no-cache`; `/assets/*` com hash `max-age=31536000, immutable`; `/media/*` `max-age=604800`; `/api/*` `no-store`". E a CSP (`script-src 'self'`, com a exceção do service worker do MSW só no demo).

**B-3. "SQL numerado (Alembic)" mistura duas coisas.**
O Alembic gera ids aleatórios.
**Correção:** "Alembic com `file_template = %%(year)d%%(month).2d%%(day).2d_%%(rev)s_%%(slug)s`, migração escrita em SQL (`op.execute`), uma por mudança."

**B-4. Funções do PRD que não têm lugar na tabela "Funções → onde vivem".**
FR-20 (arquivo `.ics`), FR-33 e FR-76 (exportações: formato e exclusão do dado de saúde), FR-43 (aviso de pendente ao dono, um template a mais) e FR-87 (aviso à **casa** em até 1 h, não só ao Matheus).
**Correção:** acrescentar as linhas:

- "Exportações (FR-33, FR-76): CSV UTF-8 com BOM, montado no domínio, sem dado de saúde."
- "Agenda (FR-20): `.ics` gerado pela API em `/links/{token}/calendar`."
- No AD-16: "O Matheus avisa a casa pelo WhatsApp do dono em até 1 h."

**B-5. A convenção de testes só fala do backend, e a camada `features/` ainda não existe.**
O front já tem `node:test`, Playwright e axe. O ESLint cita `src/features/**`, mas a pasta não existe.
**Correção:** em Convenções, "Front: `node:test` para `lib/`, Playwright + axe para telas, a suíte e2e roda também com `VITE_API_MODE=http` contra a homologação". No Paradigma, trocar "Já existe no código" por "já existe (tokens, components, pages); `features/` entra na fase 2, com a regra de import do ESLint já pronta".

**B-6. Acompanhamento na entrega 1.**
Sem API não há `/api/v1/health`, e o AD-16 só fala dele.
**Correção:** "Na entrega 1, o UptimeRobot confere `GET /` (palavra-chave da página); na entrega 2, passa para `/api/v1/health`. O Healthchecks.io também recebe o batimento diário que mantém o Supabase ativo."

**B-7. Os tokens da equipe não seguem a regra dos links.**
Convite, primeiro acesso e troca de senha (`/staff/auth/tokens/{token}`) ficam fora da regra dos links do cliente.
**Correção:** em Convenções, "Todo token de link (cliente ou equipe) é aleatório com ≥ 128 bits, guardado só como hash SHA-256, com validade e uso único quando o PRD diz (FR-98)".

## Registro de decisões → spine

| Entrada do registro de decisões | Onde entrou | Situação |
| --- | --- | --- |
| Front Vite multipágina, uma porta para a API [ADOPTED] | AD-1, Paradigma | OK |
| Contrato primeiro [ADOPTED] e teste gerado × arquivo | AD-2 | OK (a Regra precisa da correção A-4) |
| FastAPI + Supabase + VM Oracle, nginx, certbot, systemd [ADOPTED] | AD-8, AD-14 | Entrou sem a marca [ADOPTED] (B-1) |
| WhatsApp direto, sem n8n, agendador interno, número novo [ADOPTED] | AD-5, AD-12 | Entrou sem a marca; o contrato ainda tem o n8n (A-2) |
| Camadas com adaptadores | Paradigma, AD-3 | OK |
| Uma função de transição | AD-4 | OK |
| Outbox e tarefas no banco, na mesma transação, trava | AD-5 | Entrou; "mesma transação" só fica explícito para transições (A-3) |
| Exclusion constraint | AD-6 | OK (incompleto, A-8) |
| Relógio e fuso [ADOPTED] | AD-7 | OK |
| Supabase só como Postgres, RLS, `house_id` | AD-8 | OK (sem mecanismo, M-1) |
| Sessões, argon2id, CSRF, matriz única [ADOPTED] | AD-9 | OK |
| problem+json, idempotência 24 h com hash, 422 [ADOPTED] | AD-10 | OK |
| Dois tokens como hash [ADOPTED] | AD-10 | OK |
| Registro só de inclusão, "Salão" | AD-11 | OK |
| Fotos no disco, processadas pelo laço | AD-13 | OK |
| Backup diário para o Object Storage, 30 dias, teste trimestral | AD-16 | OK |
| Ambientes dev/demo/prod, demo [SUPOSIÇÃO] | Estrutura | Entrou sem a [SUPOSIÇÃO] (B-1) |
| Um processo uvicorn, publicação por script | AD-14 | OK |
| Health + verificador externo + batimento | AD-16 | OK |
| Versões da pesquisa | Ferramentas | OK, todas batem |
| Restrições da Oracle (ociosidade, A1, PAYG) | Adiado | OK |
| Restrições do Supabase (pausa, sem backup, pooler em modo sessão) | AD-8, AD-16, Adiado | OK |
| Restrições do WhatsApp (template de autenticação, botões) | AD-12 | OK |
| Resend, UptimeRobot, Healthchecks.io | Ferramentas, AD-16 | OK. O registro de decisões também previa o Healthchecks.io para manter o Supabase ativo; o spine deixou isso no Adiado (B-6) |
| Três entregas, sem mudar URLs | AD-15 | Entrou; falta o mecanismo (A-1) |

## Ordem sugerida para corrigir

1. C-1 e C-2. Sem eles, a primeira história do backend (B1/B2 da estimativa) já se divide.
2. A-2, A-3, A-5 e A-8. São Regras que, como estão, levam a comportamento errado.
3. A-1 e A-7, antes de começar a entrega 1 (15 dias úteis).
4. A-4, A-6 e A-9, antes da primeira rota.
5. Os médios e baixos podem entrar numa segunda passada do spine, antes de congelar o contrato v1.
