# Revisão de cobertura · spine × PRD de 14/10

- **Alvo:** `ARCHITECTURE-SPINE.md` contra `prd.md` (FR-1 a FR-81, §6 NFRs), `configuracoes.md` e `addendum.md` de 14/10.
- **Pergunta:** o que do PRD não tem AD, convenção ou item do Adiado que o governe, e onde o spine contradiz o PRD.
- **Convenção:** "Contradição" = o spine decide diferente do PRD. Algumas são escolhas legítimas da arquitetura, mas precisam ficar registradas como desvio (com quem aprova), porque o PRD diz "quando o PRD e os planos divergem, vale o PRD".
- O spine não foi editado.

## Veredito

**Cobertura boa no fluxo da reserva e na operação; lacunas em i18n, LGPD e sessões, e um bloco de contradições não registradas.** Das 81 FRs, cerca de 68 têm AD que governa; 13 ficam sem dono claro ou contraditas. Das NFRs do §6, tempo real, backup, logs, sessão e privacidade divergem do PRD sem registro de desvio.

## 1. Contradições spine × PRD

| # | Tema | PRD diz | Spine diz | Severidade | Correção sugerida |
| --- | --- | --- | --- | --- | --- |
| C1 | Status no "Chegou" | FR-44: reserva vira `completed` na hora | AD-4 manda seguir `04-regras-reserva.md`, que só permite `confirmed → completed` com a noite fechada; contrato tem `arrived`/`seated` | **crítico** | Emendar AD-4 e a tabela de transições (ver adversarial A1) |
| C2 | Virada da noite | §6: "depois da meia-noite pertence ao dia de abertura"; catálogo A: 05:00, Dev, 00:00–08:00 | AD-7: `closes_at` ou 06:00, o que vier primeiro (às 23:30 numa noite que fecha 23:00, "hoje" já é amanhã) | **crítico** | AD-7: corte fixo pela configuração `night_cutover` (05:00) |
| C3 | Tempo real | §4.7 e addendum: WebSocket, `WS /ws`, eventos `floor.session_*` | AD-27: SSE com dica + nova leitura; "nada de WebSocket" | alto | Manter SSE (é melhor para o porte), mas registrar o desvio no spine ("substitui o WS do PRD §4.7 e do addendum §2"), pôr o formato do evento (`<entidade>:<id>:<versão>`, enum de entidades) no contrato e dizer como o mock emula o stream (AD-2) |
| C4 | Cookie de sessão | §6: `__Host-`, httpOnly, Secure, **SameSite=Strict** | AD-9: cliente `SameSite=Lax`; sem `__Host-` | médio | Registrar: Lax no cliente é necessário pelo retorno do Google e pelos links do WhatsApp; pôr o prefixo `__Host-` e os nomes dos cookies no AD-9 |
| C5 | Duração das sessões | Catálogo O: 12 h no computador, 30 dias "manter conectado" (1–90); FR-26: 90 dias para o cliente | Silêncio | alto | AD-9: `expires_at` gravado na criação a partir do grupo `access` (equipe) e 90 dias deslizantes (cliente); mudança vale para sessões novas |
| C6 | Matriz de permissões | §6: "gerada do código, teste quebra se endpoint sem política" | AD-9: arquivo de dados `permissoes.yaml`, conferido com a casa | baixo | Registrar; o teste do AD-9 cumpre a intenção |
| C7 | Cifra de telefone e e-mail | §6: "telefone e e-mail cifrados, com hash para busca" | AD-22: upsert por `phone_e164` em claro; só o segredo TOTP é cifrado (AD-23) | **alto** | AD novo (ou AD-23): `phone_enc`/`email_enc` com `cryptography` (AES-GCM, chave no arquivo de ambiente) e `phone_hash` = HMAC-SHA256 com pimenta, único por casa; `resolve()` busca pelo hash; outbox e exportação decifram no domínio. Ou registrar a recusa (RLS + sem API de dados) com aprovação do Matheus |
| C8 | Apagar dados | FR-29/UJ-8: cancela as futuras **avisando**, cria pedido com prazo de 15 dias, cliente recebe confirmação | AD-11: cancela "sem mensagem"; sem entidade de pedido | **alto** | AD-11: `privacy_requests`, cancelamento pelo comando de AD-4 com aviso, confirmação pela outbox |
| C9 | Backup | §6: restauração testada **todo domingo**, RPO 24 h, **RTO 2 h**; §7: Supabase pago para backup | AD-16: restauração a cada 3 meses; sem RTO; Supabase Free | alto | Ou levar o PRD para trimestral (com o Marcus), ou AD-16: restauração automática semanal em homolog por timer, com batimento no Healthchecks; declarar RTO 2 h como meta |
| C10 | Logs | §6: JSON por 30 dias; erros ligados por `request_id` do front ao worker | AD-24: journald 14 dias; `request_id` só por requisição | médio | AD-24: `SystemMaxRetentionSec=30d`; convenção: `request_id` vem do front (`X-Request-Id`), vai para a outbox e a tarefa e para o Sentry |
| C11 | Implantação sem parar | §6: "deploy sem parar o serviço" | AD-24: `systemctl restart` de um uvicorn só | médio | Aceitar segundos de queda em segunda/terça (registrar) ou dois sockets com troca no nginx |
| C12 | Fotos | FR-65: "bucket privado", variantes AVIF/WebP/JPG, regravada sem metadados | AD-13: original no disco servido em `/media/` | alto | AD-13: o original fica fora de `/media` (ex.: `/var/lib/territorio/originals`, não servido); só as variantes sem EXIF são públicas; nomes com hash |
| C13 | SMS | FR-20 no escopo (corte nº 2); catálogo G: "SMS ligado" por padrão | AD-30 e Adiado: fora | médio | Registrar o corte nº 2 já aplicado e mudar o padrão do catálogo G para "desligado" |
| C14 | Infra do PRD §7 e addendum §5 | VPS, Supabase Storage, Docker/Caddy, Redis, SQLAlchemy | Oracle Always Free, disco, systemd/nginx, sem Redis, psycopg | baixo | Já resolvido no spine; listar no spine "desvios do addendum §5" em uma linha, para a história não reabrir |
| C15 | Webhook | Catálogo, passo 8: `https://{domínio}/webhooks/whatsapp` | AD-12: `/api/v1/webhooks/whatsapp` | baixo | Corrigir o catálogo |
| C16 | Rotas | Addendum: 185 rotas, `/public/*`, `/floor/*`, `/reservations/{id}/late`, `/notify`, `/setup/progress`, `/site/builds`, `/pin/setup`, `/public/vitals`, `/public/terms` | Convenção: o `openapi.yaml` (85 caminhos) manda; addendum é inventário | médio | Boa decisão; falta a tabela de tradução capacidade → caminho para as 26 novas, senão cada história escolhe (`/staff/floor/walk-ins` já existe e `POST /floor/sessions` do addendum faz a mesma coisa). Ver também AD-29 `POST /settings/{group}/preview` × contrato `PATCH ?dry_run` |
| C17 | Desfazer "Chegou" | FR-44 e catálogo H: até 15 min, sem nada pendurado | AD-4: "recusado depois do fechamento da noite" | médio | AD-4: janela do grupo `salao` |
| C18 | Sessão sem reserva | FR-45 e glossário: "abre uma sessão sem reserva" | AD-28: toda sessão nasce de reserva (walk-in vira reserva) | baixo | Escolha boa; registrar e excluir `source=walk_in` da SM-1 e da medição de FR-69 |
| C19 | "Dono" de horários | FR-6/FR-53: uma fonte só para site, reserva e dados estruturados | Catálogo B como grupo de configuração × `day_plans` de `domain.plans` | alto | Ver rubrica nº 6 |
| C20 | Python | — | Stack 3.14 × AD-24 `uv python install 3.13` | alto | AD-24 → 3.14 |

## 2. FRs e NFRs sem AD, convenção ou Adiado

| # | Requisito | O que falta decidir | Severidade | Correção sugerida |
| --- | --- | --- | --- | --- |
| G1 | **FR-1, FR-11, FR-13, FR-18, FR-54, FR-64, §6 "toda tela pública nas três línguas"; mensagens "na língua da reserva"** | Forma do texto traduzível no banco e no contrato (`{pt,es,en}` por campo ou tabela de traduções), onde ficam os arquivos de língua do front, como o build falha em chave faltando, rotas `/es/` e `/en/` × as URLs de AD-15 (`/es/reservar`?), `locale` na reserva e no cliente, regra "falta tradução → português e pendência" | **alto** | AD novo "Três línguas": tipo `LocalizedText {pt, es?, en?}` único no `openapi.yaml`; `src/i18n/{pt,es,en}.json` + teste de chave; `reservation.locale` e `customer.locale` (enum `Locale`); links do WhatsApp sem prefixo de língua (a página usa `reservation.locale`); painel só em português (§8) |
| G2 | **FR-29, FR-59** pedidos do titular | Entidade, prazo, quem atende, como o cliente é avisado | alto | Ver C8 |
| G3 | **FR-78** desfazer `no_show` automático em até 24 h | Não há comando nem transição `no_show → confirmed/completed` | alto | AD-4: comando `undo_no_show` (prazo do grupo E, motivo obrigatório), transição nova, desconta a falta |
| G4 | **FR-79** "ações do papel lançadas depois com a hora real" | `occurred_at` aceito ou não para horários da noite | alto | Ver adversarial A17 |
| G5 | **FR-46** liberar sozinho ao fim da tolerância (opção do grupo H) | Nenhum `kind` no catálogo de AD-19 faz isso; a marca é só leitura (AD-7) | médio | AD-19: `tolerance_release` por reserva, criada só com a opção ligada, rodando `no_show`; ou declarar a opção fora do módulo 1 |
| G6 | **FR-33 + catálogo I** avisos à equipe no WhatsApp, horário de silêncio 01–09 | Destinatário que não é reserva, adiar pelo silêncio, dedupe | médio | AD-5: `outbox.recipient_kind ∈ {customer, staff}`; silêncio = `not_before` na linha; alertas do sistema ignoram |
| G7 | **§6 "alerta quando a fila de envio passar de 5 min parada"** | Quem detecta se o próprio laço parou | médio | AD-16: o laço manda batimento ao Healthchecks.io a cada rodada (prazo 5 min) e `/api/v1/health` expõe a idade da `pending` mais velha; o UptimeRobot confere com palavra-chave |
| G8 | **FR-67** registro do consentimento de cookies | Tabela, rota sem sessão (fora de `NO_SESSION` → `403 csrf_failed` pelo teste de AD-9) | médio | AD-9: acrescentar a `NO_SESSION` `/consent`, `/vitals` e o pedido de pareamento de aparelho, protegidos por limite por IP e `Origin` |
| G9 | **FR-81** medidas de desempenho (`web_vitals`, 90 dias) | Tabela, retenção (não está na `retention_sweep`), rota sem sessão | médio | AD-19 `retention_sweep`: incluir `web_vitals` 90 dias; G8 cobre a rota |
| G10 | **FR-20, §6** Turnstile na reserva, no código e no login | Onde é conferido (dependência única), CSP para o script | alto | AD-23: `require_turnstile()` nas três rotas, `siteverify` por `integrations/turnstile`; AD-14: liberar `challenges.cloudflare.com` em `script-src` e `frame-src` |
| G11 | **FR-70** senha recusada se estiver em vazamento | Integração externa (HIBP k-anonimidade) não aparece em `integrations/` nem em AD-33 | médio | AD-23: `integrations/pwned` por k-anonimidade, falha aberta com log; ou lista local |
| G12 | **§6 limites** login 5/conta/15 min com espera crescente e 20/IP/h; reserva 5/telefone/dia; API 300/min/sessão; código 3/número/h, 10/IP/h, teto diário; PIN 5 erros → 15 min e aviso ao dono (FR-73) | AD-23 nomeia as rotas mas não os números, não cobre PIN nem o teto da API | médio | AD-23: tabela de limites com os números do PRD como padrão do grupo `access`; o de 300/min fica no nginx por cookie de sessão (`limit_req` com chave do cookie), não no Postgres |
| G13 | **§6 cabeçalhos** HSTS (sem `preload` no dia 1), `frame-ancestors 'none'`, Referrer-Policy, Permissions-Policy | AD-14 só tem CSP | baixo | AD-14: lista de cabeçalhos do nginx, com o teste da publicação conferindo |
| G14 | **§4.1 NFRs e §6** Lighthouse na CI, orçamento de JS/CSS/imagem, contraste nos dois temas, lint de palavras proibidas (§5.2), gitleaks, ZAP baseline | `publish.sh` (AD-24) não lista nenhum | médio | AD-24: a verificação inclui Lighthouse CI com orçamento, contraste dos tokens, lint de conteúdo e gitleaks; ZAP antes de ir ao ar |
| G15 | **FR-71** "sempre existe pelo menos um dono ativo" | Duas mudanças de papel simultâneas zeram os donos | médio | `domain.staff`: trava a linha da casa antes de mudar papel ou desativar; conta donos ativos |
| G16 | **FR-43 / catálogo H** recepção remarca só no mesmo dia; **FR-40** recepção vê só o dia; **FR-41** dono e gerente passam do limite com motivo | Permissão condicional (por dado) não cabe na matriz `operação → papéis` | médio | AD-9: "condições por papel são regras do domínio, lidas do grupo `floor`"; AD-18: `override_reason` só para dono/gerente, ainda sob a mesma trava |
| G17 | **FR-77** saúde do sistema: último teste de restauração, erros recentes | AD-16 guarda a restauração num arquivo do repositório; erros no Sentry | baixo | Tabela `ops_events(kind, at, ok)` gravada pelo script de restauração e pelo backup; "erros recentes" = contagem do log local, sem chamar a API do Sentry |
| G18 | **FR-64** rascunho, publicação, histórico e volta; **FR-13** rascunho do cardápio | Um modelo de rascunho e versão para conteúdo, cardápio e evento | médio | AD-15: `draft`/`published` por linha com `content_versions` só de inclusão; publicar = copiar rascunho e enfileirar `site_render`; mesmo modelo para cardápio e evento |
| G19 | **FR-69** procedência `?de=` | Campo na reserva e enum | baixo | `reservation.referrer` (enum `Referrer`: bio, qr, google, direct) |
| G20 | **FR-63** assistente de primeiro uso | Addendum: progresso em `settings`; AD-29 não tem esse grupo | baixo | Grupo `setup` no enum de grupos |
| G21 | **AD-32 × AD-14** | Painel PWA com service worker do retrato (pastas) × "service worker do MSW só no demo" | médio | AD-14: SW do painel permitido em `/admin/sw.js`, sem cache de `/api` além do retrato |
| G22 | **FR-56** chegada na lista do evento | Se abre sessão ou só marca chegada | baixo | Ver adversarial A4 |

## 3. NFRs do §6 bem cobertas

- **Tempo real "até 2 s":** AD-27 cumpre com `NOTIFY` no commit + SSE (com as ressalvas de C3 e da assinatura do aparelho; o endpoint SSE deve ser `async def` e não segurar conexão do pool de 5 do AD-17; a escuta usa conexão própria fora do pool; nginx com `proxy_buffering off` para `/api/v1/staff/stream`).
- **Concorrência na última mesa:** AD-6 com teste de duas transações.
- **Contrato como fonte única:** AD-2.
- **Fuso:** AD-7 (exceto o corte, C2).
- **Disponibilidade 99,5% e site sem depender da internet da casa:** AD-14, AD-15, AD-16.
- **Registro só de inclusão "nem pelo banco":** AD-11 (exceto a poda, ver rubrica nº 4).

## Resumo

- **Críticos:** C1 (status no "Chegou"), C2 (virada da noite).
- **Altos:** C3 (WS × SSE sem registro), C5 (sessões 12 h/30 d/90 d sem dono), C7 (cifra de telefone/e-mail), C8/G2 (pedido do titular), C9 (restauração semanal × trimestral), C12 (original público com EXIF), C19 (dono dos horários), C20 (Python), G1 (i18n), G3 (desfazer `no_show`), G4 (hora real), G10 (Turnstile × CSP).
- Mais 18 médios e baixos nas tabelas acima.
