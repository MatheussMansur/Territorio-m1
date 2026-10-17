# Plano de back-end e front-end · Módulo 1

14/10/2026 · Para o Matheus revisar antes de executar. Ele traduz o contrato de arquitetura (`ARCHITECTURE-SPINE.md`, AD-1 a AD-37) em pastas, peças e ordem de trabalho. Quando os dois divergirem, vale o contrato.

As entradas são:
- PRD de 14/10: `territorio/docs/planejamento/prds/prd-territorio-modulo-1-2026-10-14/`;
- UX de 14/10, que define a identidade do site, as configurações e os modelos de mensagem: `territorio/docs/planejamento/ux-designs/ux-territorio-2026-10-14/`.

## 1. O que muda em relação ao plano de 08/10

| Ponto | 08/10 | Agora |
| --- | --- | --- |
| Escopo | Site, reservas e painel em 3 entregas | O mesmo, mais a conta do cliente com Google, a recepção completa (sessão de mesa), as configurações de tudo, os aparelhos com PIN e a folha da noite |
| Infra | VM Oracle grátis (A1 ou AMD micro) | VM A1 com o máximo grátis de hoje: **2 OCPUs e 12 GB** (AD-34) |
| Perfis | dono, gerente e "salão" com login | dono e gerente com e-mail, senha e TOTP; recepção com aparelho aprovado e PIN (AD-26) |
| Painel ao vivo | consulta a cada 20 s | aviso do Postgres por SSE em até 2 s; a consulta de 20 s fica como reserva (AD-27) |
| WhatsApp | número novo | número da casa em coexistência; depende de Tech Provider ou BSP (AD-12) |
| Publicar o site | só pelo script | publicar no painel regera o HTML sozinho (AD-15) |
| Python | 3.13 | 3.14 |
| Pago | — | nada pago sem orçamento: SMS, Supabase Pro e outros ficam fora (AD-33) |

Ficam como estavam:
- o contrato primeiro, com mock que valida contra ele;
- SQL à mão com psycopg, sem ORM;
- um processo por ambiente, com o laço de tarefas dentro;
- outbox e tarefas no Postgres, sem Redis;
- nginx e systemd;
- Supabase só como banco;
- backup cifrado.

## 2. Onde roda

- **Oracle:** uma VM Oracle A1 em São Paulo (2 OCPUs, 12 GB, Ubuntu 24.04, 200 GB de disco), numa conta Pay As You Go.
- **nginx:** recebe tudo e serve:
  - `/` (site estático) e `/admin` (painel);
  - `/media` (fotos) e `/api/v1` (a API).
- **Ambientes:** dois processos uvicorn, um de produção e um de homologação (`homolog.`), cada um com o seu laço de tarefas.
- **Banco:** dois projetos Supabase Free em `sa-east-1`, um para cada ambiente.
- **Testes:** Postgres 17 local em contêiner, na máquina do Matheus e na VM.
- **Serviços de fora:**
  - WhatsApp Cloud API, Resend (e-mail da equipe) e Google (login do cliente);
  - Sentry (erros, sem dado de cliente) e UptimeRobot com Healthchecks.io (no ar e backup);
  - Oracle Object Storage (cópias).
- **Medição de visitas (AD-37):** primeira parte. A página manda os eventos para `POST /measure`, com os ids `trt_vis` e `trt_visita`, só depois do sim na categoria medição. O Umami entra na própria VM quando ela estiver no ar, alimentado pelo `/measure`; até lá, os eventos ficam na API.

## 3. Back-end

### Pastas

```text
server/app/
  api/            rotas por grupo do contrato (public, customer, links, staff/*, webhooks), projections.py
  auth/           sessões (pessoal, aparelho+PIN, cliente), CSRF, permissions.py, reautenticação
  domain/         as regras (nada de HTTP, SQL ou WhatsApp aqui)
  repo/           SQL à mão, um arquivo por dono de tabela
  integrations/   whatsapp, email, storage, google, alerts
  worker/         laço de tarefas e outbox
  realtime.py     LISTEN do Postgres → SSE
  uow.py          uma transação por requisição
server/migrations/NNNN_slug.sql · server/migrate.py · server/tests/
```

### Módulos do domínio e o que cada um é dono

| Módulo | Dono de | Comandos principais |
| --- | --- | --- |
| `reservations` | reservas, transições, código TR | `create`, cada `ReservationAction` (confirmar, recusar, cancelar, não veio, remarcar, trocar mesa…), `answer_reminder`, `check_in`, `undo_check_in` |
| `availability` | só leitura: horários com mesa | calcula sobre a planta do dia, a ocupação e as configurações |
| `occupancy` | `table_occupancy` (a trava da mesa física) | prender, soltar, mover; é chamado pelos outros, nunca pela rota |
| `floor` | `table_sessions`, `table_session_events` | abrir (pelo `check_in`), trocar, juntar, separar, liberar, +10 min |
| `night` | `nights`, o que é "hoje" | `night_of`, fechamento da noite |
| `plans` | áreas, mesas físicas, plantas, plano do dia | criar e editar planta, simular e gravar o plano do dia |
| `events` | eventos na casa, lista na porta | criar, publicar, marcar chegada |
| `customers` | clientes, identidades Google, pedidos do titular | `resolve`, bloquear, anonimizar, exportar |
| `settings` | grupos de configuração, versões dos combinados | `get`, `preview`, `update` |
| `devices` | aparelhos, pareamento | pedir pareamento, aprovar, revogar |
| `staff` | pessoas, perfis, convites, PIN | convidar, desativar, criar pessoa só de PIN (o PIN são os últimos 4 dígitos do telefone dela) |
| `content` | blocos do site, avisos, cardápio, fotos e usos | rascunho, publicar (enfileira `site_render`) |
| `messages` | catálogo de modelos e montagem do texto | enfileirar na outbox, nunca enviar direto |
| `analytics` | só leitura | números da reserva e desempenho do site |

**Regras que valem para todos:**
- **Comando:** toda mudança é um comando do domínio que grava, numa transação só, a mudança, o registro de ações, a ocupação, a outbox, as tarefas e o aviso (`NOTIFY`).
- **Rotas:** só validam, conferem a permissão e chamam o domínio.

### API

- **Contrato:** `docs/api/openapi.yaml`, que hoje está na versão 0.3.0, com 122 caminhos e 148 operações, continua sendo a fonte.
- **Inventário:** o PRD de 14/10 lista cerca de 184 rotas no padrão do plano 10. Elas são o inventário do que falta, e cada uma entra no contrato no padrão dele.

| Grupo | O que tem | Situação |
| --- | --- | --- |
| Público (`/house`, `/menu`, `/content`, `/availability/*`, `/events`, consentimento de cookies, desempenho) | site e reserva sem login | existe; falta eventos, consentimento, desempenho |
| Cliente (`/auth/otp`, `/auth/verify`, `/auth/google/*`, `/me`, `/reservations/*`) | código, Google, perfil, minhas reservas, remarcar, cancelar, baixar e apagar dados | existe; falta Google, remarcar e mudar pessoas pela conta, perfil |
| Links (`/links/{token}/*`) | comprovante, confirmar, atrasar, cancelar, aceitar ou recusar oferta, `.ics` | existe |
| Equipe: acesso (`/staff/auth/*`, `/staff/me/*`) | login, TOTP, convite, senha, sessões, reautenticação | existe; falta reautenticação com TOTP |
| Equipe: aparelhos e PIN (`/staff/devices*`, `/pin/*`) | pareamento, aprovação, entrar com nome + PIN (últimos 4 dígitos do telefone) | **novo** |
| Equipe: operação (`/staff/dashboard`, `/staff/reservations*`, `/staff/floor*`, `/staff/waitlist*`, `/staff/night/snapshot`, `/staff/stream`) | Hoje, reservas, salão ao vivo, espera, folha da noite, avisos ao vivo | existe em parte; falta sessão de mesa, retrato da noite, SSE |
| Equipe: planejamento (`/staff/calendar`, `/staff/day-plans*`, `/staff/areas*`, `/staff/layouts*`, `/staff/events*`) | agenda, plano do dia com simulação, plantas, eventos | existe |
| Equipe: clientes (`/staff/customers*`, pedidos do titular) | ficha, telefone com reautenticação, bloquear, anonimizar | existe; falta perdoar falta e pedidos do titular |
| Equipe: conteúdo (`/staff/content*`, `/staff/menu*`, `/staff/images*`, `/staff/site/builds`) | textos, cardápio, galeria, situação da publicação | existe em parte |
| Equipe: configurações (`/staff/settings`, `/staff/settings/{group}`, `/preview`, `/staff/terms*`) | os 19 grupos do módulo 1 (12 de reserva e site, 7 da base) | **novo** |
| Equipe: sistema (`/staff/audit*`, `/staff/notifications*`, `/staff/system/status`, `/health`) | registro, mensagens, saúde | existe em parte |
| Webhooks (`/webhooks/whatsapp`) | botões e situação das mensagens | sai `/internal/whatsapp/replies` |

### Tarefas do laço (catálogo fechado, AD-19)

| Tarefa | Faz |
| --- | --- |
| `pending_expiry` | vence a reserva pendente |
| `offer_expiry` | vence a oferta da espera |
| `night_reminder` | manda o lembrete |
| `night_close` | fecha a noite: não veio, encerra sessões e vence a espera |
| `capacity_freed` | oferece a mesa à espera |
| `image_process` | gera os tamanhos das fotos |
| `site_render` | regera o HTML do site |
| `retention_sweep` | aplica os prazos de privacidade |
| `cleanup` | limpa o que venceu |

### Banco

Entram as tabelas do esquema de 08/10 (casas, equipe, mesas físicas, plantas, plano do dia, noites, eventos, clientes, reservas, ocupação, outbox, tarefas, idempotência, registro, conteúdo, cardápio, fotos), e mais estas:
- `devices` e `pin_credentials`;
- `table_sessions` e `table_session_events`;
- `settings` e `terms_versions`;
- `customer_identities` e `customer_sessions`;
- `privacy_requests`, `cookie_consents` e `web_vitals`.

**Regras do esquema:**
- toda tabela tem `house_id`, RLS e índice começando por `house_id`;
- só migração muda o esquema.

## 4. Front-end

### Duas aplicações, uma base

```text
src/
  styles/tokens.css   a identidade (papel, kraft, preto lavado, marsala) e o tema escuro
  components/         peças da tela (já existem: campo, telefone, código, diálogo, abas, toast, selo…)
  features/           fluxos com estado (reserva, minhas reservas, salão, configurações…)
  pages/              páginas do site (pré-renderizadas no build, nas três línguas)
  admin/              o painel: pages, features próprias, service worker do retrato da noite
  services/api/       a única porta para a API: adaptadores mock, http e static
  mocks/              MSW 3 a partir do contrato, com cenários e barra de demonstração
  lib/                datas, telefone, dinheiro, idempotência, validação
  i18n/               pt, es, en (textos fixos); o conteúdo editável vem da API
```

- **O site** é HTML pronto do build, que abre sem JavaScript. As partes vivas (aberto agora, acabou, eventos, disponibilidade) são ilhas que leem a API.
- **O painel** é uma aplicação lit-html com roteador próprio, PWA no computador da recepção (para o retrato da noite) e o mesmo `tokens.css`.

### Telas

| Área | Telas |
| --- | --- |
| Site (12) | página da casa, `/cardapio`, `/eventos`, evento, `/reservar`, `/entrar`, `/minhas-reservas`, `/r`, `/confirmar`, `/espera`, `/privacidade`, 404, nas três línguas |
| Painel: acesso (8) | entrar, código, aparelho e PIN, primeiro acesso, convite, recuperar senha, nova senha, minha conta |
| Painel: operação (6) | Hoje, Reservas, Salão ao vivo, Espera, folha da noite, Clientes |
| Painel: planejamento (4) | Agenda, Plantas, Eventos, Evento (lista na porta) |
| Painel: conteúdo (3) | Site, Cardápio, Galeria |
| Painel: casa (4) | Equipe, Aparelhos, Registro, Sistema |
| Configurações (19 no módulo 1) | índice; Casa, Horários, Acesso, Avisos, Aparelhos, Aparência; Reservas, Combinados, Aprovação e faltas, Espera, Salão, Mensagens, Eventos; Site, Cardápio, Privacidade, Cookies; Integrações. Modelo: `mockups/configuracoes-reservas-site.html` |

### Componentes novos

| Grupo | Componentes |
| --- | --- |
| Configurações | linha de configuração, passo (−/+), segmentado, chave, linha que mudou, barra de impacto, diálogo "O que muda", prévia do cliente |
| Painel | trilho do painel, índice com pendências |
| Salão | planta ao vivo |
| Recepção | teclado de PIN, faixa "sem conexão" |
| Identidade | seletor de língua, botão de tema, banner de cookies |

As medidas e cores de cada componente estão no `DESIGN.md` de 14/10.

### Do mock ao back-end real

1. Cada capacidade entra primeiro no `openapi.yaml`.
2. O handler do MSW e os seeds mudam no mesmo commit. O teste confere as respostas do mock contra o contrato (Ajv).
3. A tela usa só `services/api/` e decide pelo que a porta declara, nunca pelo modo.
4. Quando o back-end de um grupo fica pronto, o teste de contrato do servidor compara o OpenAPI gerado com o arquivo. A suíte Playwright roda também com `VITE_API_MODE=http` contra a homologação.
5. Produção recusa o modo mock.

## 5. Ordem de trabalho

São 9,5 a 12 semanas de uma pessoa, como no PRD. Cada passo termina com algo para ver.

| # | Passo | Semanas | Termina com |
| --- | --- | --- | --- |
| 0 | **Base:** contrato v1 com as capacidades novas; `tokens.css` com tema escuro; fontes locais (Nanum com `ō ñ ¿ ¡`, sem Bangers); i18n; VM A1 criada; domínio e HTTPS; `homolog.` com senha; conta e decisão de coexistência na Meta | 1,5 | site antigo no domínio novo; contrato v1 |
| 1 | **Site no mock:** página da casa, cardápio, eventos, privacidade, cookies, três línguas, dois temas | 1,5 | site navegável, Lighthouse no verde |
| 2 | **Reserva e conta no mock:** reserva em três passos, espera, código, Google (simulado), minhas reservas, links | 1,5 | reserva completa de ponta a ponta no mock |
| 3 | **Painel no mock:** acesso, aparelho e PIN, Hoje, Reservas, Salão ao vivo, Espera, Agenda, Plantas, Eventos, Clientes, Conteúdo, Configurações, folha da noite | 2 | **demonstração ao Marcus** e validação das telas e permissões |
| 4 | **Back-end, base:** migrações, UoW, sessões, CSRF, permissões, aparelhos e PIN, configurações, registro, laço de tarefas, SSE | 1,5 | login real em homologação |
| 5 | **Back-end, reservas:** disponibilidade, ocupação, reservas, espera, conta, Google, WhatsApp (outbox e webhook), tarefas | 1,5 a 2 | reserva real em homologação com o número de teste |
| 6 | **Back-end, painel:** salão e sessão de mesa, plano do dia com simulação, plantas, eventos, clientes e LGPD, conteúdo e `site_render`, fotos | 1 a 1,5 | o painel inteiro em homologação |
| 7 | **No ar:** noite simulada com a equipe, restauração de backup testada, varredura de segurança, modelos aprovados pela Meta, troca para produção | 0,5 a 1 | clientes reservando sozinhos |

O passo 0 da Meta (verificação da empresa, coexistência, modelos) leva dias e corre em paralelo desde o começo.

**Onde estamos (14/10):** o passo 1 está quase pronto; o passo 2 está parcial (a reserva vive em `src/pages/reservar.js`); o passo 3 é o próximo e começa pelas configurações e pela gestão do módulo, antes do painel de reservas (decisão do Matheus em 14/10).

## 6. Testes

- **Back-end:**
  - pytest contra o Postgres local, com relógio controlável;
  - teste de duas transações disputando a última mesa;
  - matriz de permissões gerada do `permissoes.yaml`;
  - teste de IDOR com duas casas;
  - teste do registro sem dado pessoal;
  - teste de contrato.
- **Front:**
  - `node:test` para `lib/` e para o mock contra o contrato;
  - Playwright com axe nas telas, nos dois temas e nas três línguas do site;
  - os caminhos de erro da reserva (PRD FR-24);
  - Lighthouse no celular.
- **Antes de ir ao ar:** noite simulada, restauração do backup e varredura de segurança (ZAP).

## 7. Antes de executar

1. Criar a VM A1 (2 OCPUs, 12 GB), que pode faltar em São Paulo; insistir até conseguir. A conta é Pay As You Go.
2. Decidir a coexistência do WhatsApp: Tech Provider (grátis, exige verificação de empresa) ou BSP (pago, vai ao orçamento).
3. Domínio escolhido pelo Marcus: `territoriofoz.com.br` (o `SITE_URL` de produção, em `.env.production`).
4. Atualizar o `openapi.yaml` com as capacidades novas (passo 0). Os documentos `03-modelos.md` e `04-regras-reserva.md` se ajustam junto.
5. Gerar os épicos e histórias a partir do PRD de 14/10 e deste contrato. O `epics.md` de 08/10 ficou sem a lista de épicos.
