# Versões verificadas: pilha do módulo 1 (reservas)

Verificado em **14/10/2026**, consultando direto o PyPI (API JSON), o registro npm, as releases do GitHub/GitLab, endoflife.date e as páginas oficiais. As datas são da publicação da versão citada.

> **Nota de 14/10:** esta é uma pesquisa de apoio; quem decide é o contrato de arquitetura (`ARCHITECTURE-SPINE.md`, AD-1 a AD-37). Lá ficou: SQL à mão com psycopg, sem ORM (nada de SQLAlchemy, Alembic ou asyncpg); fila e outbox no próprio Postgres, sem Redis nem Valkey; nginx e systemd na VM Oracle A1. A coexistência do WhatsApp permite usar o número atual da casa (+55 45 99830-4994) no app e na API ao mesmo tempo; falta só escolher a rota (Tech Provider ou BSP). Onde o texto abaixo recomendar outra coisa, vale o contrato.

## Backend (Python)

| Tecnologia | Versão | Data | Mantida? | Alerta | Fonte |
|---|---|---|---|---|---|
| **Python** (produção) | **3.14.8** | 30/09/2026 | Sim. Correções de bugs até ~01/10/2027; segurança até 10/2030 | **Usar 3.14.** O 3.13 (3.13.16) saiu da fase de correções em 01/10/2026 e agora só recebe segurança. O 3.12 (3.12.15) já está só em segurança desde 04/2025. O 3.15.0 saiu em 09/10/2026 e é novo demais para produção; reavaliar perto do 3.15.2. Todas as dependências nativas da pilha (asyncpg, pydantic-core, psycopg-binary, argon2-cffi-bindings, uvloop, httptools) já publicam wheels cp314. | [endoflife.date/python](https://endoflife.date/python), [python.org/downloads](https://www.python.org/downloads/) |
| FastAPI | 0.143.1 | 14/10/2026 | Sim, lança versões quase toda semana | Continua na série 0.x, então mudanças de minor podem quebrar. Fixar a versão exata e ler as notas antes de subir. Exige Python 3.10 ou mais novo. | [pypi.org/project/fastapi](https://pypi.org/project/fastapi/) |
| Pydantic | 2.14.1 (pydantic-core 2.50.1) | 11/10/2026 | Sim | Nenhum | [pypi.org/project/pydantic](https://pypi.org/project/pydantic/) |
| SQLAlchemy | 2.1.4 (série 2.0: 2.0.54) | 07/10/2026 (2.1.0 saiu em 24/09/2026) | Sim | A **2.1 é nova**: saiu há 3 semanas e exige Python 3.11 ou mais novo. Num projeto novo, dá para começar na 2.1 com versão fixa. Se algum plugin ainda não for compatível, a 2.0.54 continua mantida. | [pypi.org/project/sqlalchemy](https://pypi.org/project/SQLAlchemy/), [changelog 2.1](https://docs.sqlalchemy.org/en/21/changelog/) |
| Alembic | 1.20.0 | 11/09/2026 | Sim | Nenhum | [pypi.org/project/alembic](https://pypi.org/project/alembic/) |
| asyncpg | 0.32.0 | 06/10/2026 | Sim | Tem wheels para Python 3.14 e 3.15 | [pypi.org/project/asyncpg](https://pypi.org/project/asyncpg/) |
| psycopg 3 | 3.3.6 | 18/09/2026 | Sim | Para o Alembic síncrono ou como driver único. Com o pooler do Supabase em modo transação, desligar os prepared statements (vale para o asyncpg e para o psycopg). | [pypi.org/project/psycopg](https://pypi.org/project/psycopg/) |
| **arq** | 0.28.0 | 16/04/2026 | **Não ativamente. Está em "maintenance only mode"** | **O README e a issue #510 (fixada, de 18/10/2025, de Samuel Colvin/equipe Pydantic) dizem que só haverá correções críticas de segurança e nada de funcionalidades novas ou correções comuns.** O repositório não será arquivado. As versões 0.27 e 0.28 foram só de manutenção. **Não recomendado para projeto novo.** | [README](https://github.com/python-arq/arq), [issue #510](https://github.com/python-arq/arq/issues/510) |
| Alternativa: **Taskiq** | 0.13.0 | 26/09/2026 | Sim | É async-nativo, tem integração com FastAPI (taskiq-fastapi) e broker Redis (taskiq-redis). Substitui o arq de forma mais direta. Ainda é 0.x. | [pypi.org/project/taskiq](https://pypi.org/project/taskiq/) |
| Alternativa: **SAQ** | 0.26.4 | 21/05/2026 | Sim (cadência mais lenta) | É o mais parecido com o arq (async, Redis ou Postgres, com painel web). Suportar Postgres como fila permite dispensar o Redis. | [pypi.org/project/saq](https://pypi.org/project/saq/) |
| Alternativa: Dramatiq | 2.2.1 | 02/09/2026 | Sim | A 2.0 é de 11/2025, um major. É síncrono por natureza (o async é parcial). | [pypi.org/project/dramatiq](https://pypi.org/project/dramatiq/) |
| Alternativa: Celery | 5.6.3 | 26/03/2026 | Sim | Pesado demais para o porte do projeto e não é async-nativo | [pypi.org/project/celery](https://pypi.org/project/celery/) |
| Uvicorn | 0.54.0 | 25/09/2026 | Sim | Série 0.x | [pypi.org/project/uvicorn](https://pypi.org/project/uvicorn/) |
| argon2-cffi | 25.1.0 (bindings 26.1.0) | 03/06/2025 | Sim, mas é uma biblioteca estável e raramente lança versão | Nenhum. As bindings têm wheel abi3 que funciona no 3.14. | [pypi.org/project/argon2-cffi](https://pypi.org/project/argon2-cffi/) |
| pyotp | 2.10.0 | 14/06/2026 | Sim | Nenhum | [pypi.org/project/pyotp](https://pypi.org/project/pyotp/) |
| httpx | 0.28.1 | 06/12/2024 | **Duvidoso.** Não sai versão há cerca de 22 meses, embora o repositório tenha commits em 10/2026 | Funciona e é estável, mas está parado na 0.28 e não há data para a 1.0. Fixar 0.28.1. Ele é usado como cliente de teste do FastAPI (TestClient e ASGITransport). | [pypi.org/project/httpx](https://pypi.org/project/httpx/), [github encode/httpx](https://github.com/encode/httpx) |
| structlog | 26.1.0 | 06/06/2026 | Sim | Usa versionamento por calendário | [pypi.org/project/structlog](https://pypi.org/project/structlog/) |
| redis-py (cliente) | 8.1.0 | 30/07/2026 | Sim | O cliente é MIT e funciona com Redis e com Valkey | [pypi.org/project/redis](https://pypi.org/project/redis/) |

## Qualidade e testes (Python)

| Tecnologia | Versão | Data | Mantida? | Alerta | Fonte |
|---|---|---|---|---|---|
| import-linter | 2.15 | 04/09/2026 | Sim | Nenhum | [pypi.org/project/import-linter](https://pypi.org/project/import-linter/) |
| Schemathesis | 4.31.0 | 12/10/2026 | Sim | É a série 4.x, e a API e a CLI mudaram em relação à 3.x. Usar a documentação da v4. Exige Python 3.11 ou mais novo. | [pypi.org/project/schemathesis](https://pypi.org/project/schemathesis/) |
| pytest | 9.1.1 | 19/06/2026 | Sim | O major 9 tem remoções de APIs que já estavam depreciadas | [pypi.org/project/pytest](https://pypi.org/project/pytest/) |
| Hypothesis | 6.169.1 | 14/10/2026 | Sim | Exige Python 3.11 ou mais novo | [pypi.org/project/hypothesis](https://pypi.org/project/hypothesis/) |
| ruff | 0.17.0 | 09/10/2026 | Sim | Série 0.x, e as regras e a formatação mudam entre minors. Fixar a versão exata. | [pypi.org/project/ruff](https://pypi.org/project/ruff/) |
| mypy | 2.4.0 | 01/10/2026 | Sim | **A 2.0 (06/05/2026) foi um major**: liga por padrão `--local-partial-types` e `--strict-bytes`, entre outras mudanças. Num projeto novo isso não atrapalha. | [pypi.org/project/mypy](https://pypi.org/project/mypy/), [CHANGELOG](https://github.com/python/mypy/blob/master/CHANGELOG.md) |

## Frontend e testes web

| Tecnologia | Versão | Data | Mantida? | Alerta | Fonte |
|---|---|---|---|---|---|
| **Node.js LTS** | **24.22.0 (Krypton)** | 14/10/2026 | Sim. Active LTS até 20/10/2026, depois manutenção até 30/04/2028 | **O Node 26 vira LTS em 28/10/2026** (hoje está na 26.12.0, ainda "Current"). Dá para começar no 24 e migrar para o 26 em novembro, ou fixar o 26 já pensando em longo prazo. O Node 22 está em manutenção até 04/2027. | [nodejs.org/dist/index.json](https://nodejs.org/dist/index.json), [cronograma oficial](https://github.com/nodejs/Release) |
| Vite | 8.3.4 | 08/10/2026 | Sim | **A 8.0 (12/03/2026) trocou o motor pelo Rolldown.** Plugins antigos podem dar problema. | [npm vite](https://www.npmjs.com/package/vite) |
| lit-html / Lit 3 | 3.3.3 (lit e lit-html) | 14/05/2026 | Sim | Nenhum | [npm lit-html](https://www.npmjs.com/package/lit-html), [releases](https://github.com/lit/lit/releases) |
| **MSW** | 3.0.3 | 10/10/2026 | Sim | **A 3.0 (28/09/2026) é um major com quebras.** Passou a publicar só ESM e exige Node 22 ou mais novo e TypeScript 5.9 ou mais novo. `onUnhandledRequest` virou `onUnhandledFrame`. `worker.stop()` agora é async. Deixou de mexer no `setTimeout`, então quem usa timers falsos precisa avançá-los à mão. O header de cookie ficou `null`, e a leitura deve ir pelo argumento `cookies`. Tutoriais antigos são da v2. | [release v3.0.0](https://github.com/mswjs/msw/releases/tag/v3.0.0) |
| openapi-typescript | 7.13.0 | 11/02/2026 | Sim (cadência lenta) | Nenhum | [npm openapi-typescript](https://www.npmjs.com/package/openapi-typescript) |
| openapi-fetch | 0.17.0 | 11/02/2026 | Sim | Série 0.x | [npm openapi-fetch](https://www.npmjs.com/package/openapi-fetch) |
| orval (alternativa) | 8.43.0 | 14/10/2026 | Sim, muito ativo | Também consegue gerar handlers do MSW | [npm orval](https://www.npmjs.com/package/orval) |
| Playwright (@playwright/test) | 1.64.1 | 14/10/2026 | Sim | Nenhum | [npm @playwright/test](https://www.npmjs.com/package/@playwright/test) |
| vite-plugin-pwa | 2.0.0 | 03/10/2026 | Sim | O major 2.0 pede `@vite-pwa/assets-generator` ^2 como peer. A mudança é pequena, mas a versão tem só 11 dias; se der problema, a 1.x é a alternativa. | [release v2.0.0](https://github.com/vite-pwa/vite-plugin-pwa/releases/tag/v2.0.0) |
| Workbox (workbox-build) | 7.4.1 | 04/05/2026 | Sim (repositório ativo em 10/2026) | Nenhum | [npm workbox-build](https://www.npmjs.com/package/workbox-build) |
| @axe-core/playwright | 4.13.0 | 11/08/2026 | Sim | Nenhum | [npm @axe-core/playwright](https://www.npmjs.com/package/@axe-core/playwright) |
| Lighthouse CI (@lhci/cli) | 0.15.1 | 25/06/2025 | **Pouco ativo.** Não sai versão há cerca de 16 meses e o último commit é de 03/2026 | Funciona, mas a manutenção é lenta. Para o porte do projeto, é aceitável no CI. | [npm @lhci/cli](https://www.npmjs.com/package/@lhci/cli), [github](https://github.com/GoogleChrome/lighthouse-ci) |

## Infra e serviços

| Tecnologia | Versão | Data | Mantida? | Alerta | Fonte |
|---|---|---|---|---|---|
| **Redis** | 8.10.2 | 17/09/2026 | Sim | **Licença:** do Redis 8.0 em diante vale uma tripla licença, RSALv2, SSPLv1 **ou AGPLv3**, à escolha. A AGPLv3 é OSI e só obriga a publicar código se o próprio Redis for modificado e oferecido como serviço. Usar sem modificar, como fila e cache interno, não gera obrigação prática. As versões 7.4 a 7.8 eram só RSAL/SSPL, e as anteriores a 7.2, BSD. | [redis.io/legal/licenses](https://redis.io/legal/licenses/), [releases](https://github.com/redis/redis/releases) |
| **Valkey** (alternativa) | 9.1.2 (9.0.6 também mantida; 9.2.0-rc1 em teste) | 01/09/2026 | Sim (Linux Foundation) | Licença BSD-3, sem nenhuma ambiguidade. Funciona como substituto direto do Redis para uma fila simples, e os clientes Python funcionam com ele. **É a escolha mais limpa em termos de licença.** | [releases valkey](https://github.com/valkey-io/valkey/releases) |
| PostgreSQL (upstream) | 18.6 (17.11 na série 17) | 11/08/2026 | Sim. A 17 tem suporte até 11/2029 | Nenhum | [endoflife.date/postgresql](https://endoflife.date/postgresql) |
| **PostgreSQL no Supabase** | **17.11** (imagem 17.11.0.004/005) | 10/2026 | Sim | **O Supabase ainda não oferece o PG 18.** Os projetos novos usam o 17, e o 15.19 continua existindo para projetos antigos. Usar o 17 em desenvolvimento local e no CI para ficar igual à produção. | [supabase/postgres releases](https://github.com/supabase/postgres/releases), [guia de upgrade](https://supabase.com/docs/guides/platform/upgrading) |
| Supabase: região | São Paulo **sa-east-1** disponível como região específica | 10/2026 | Sim | Nenhum | [docs regions](https://supabase.com/docs/guides/platform/regions) |
| Supabase: Pro e backups | US$ 25/mês, com US$ 10 de crédito de compute (cobre um projeto Micro). Backup diário com **7 dias** de retenção. | 10/2026 | Sim | **PITR é um add-on pago: cerca de US$ 100/mês para 7 dias** (US$ 200 para 14, US$ 400 para 28). Exige compute **Small ou maior**, que custa à parte. Com o PITR ligado, os backups diários param. O RPO no pior caso é de cerca de 2 minutos. Sem PITR, a perda pode chegar a 24 horas, então vale combinar com um `pg_dump` próprio. | [pricing](https://supabase.com/pricing), [docs backups](https://supabase.com/docs/guides/platform/backups) |
| Uvicorn + Caddy 2 | Caddy 2.11.7 | 03/10/2026 | Sim | Nenhum | [releases caddy](https://github.com/caddyserver/caddy/releases) |
| Docker Compose | 5.6.0 | 02/10/2026 | Sim | **A v5 (02/12/2025) pulou as versões 3 e 4.** O builder interno foi removido e o build agora passa pelo Docker Bake/buildx. Os arquivos compose continuam iguais, sem o campo `version:`. | [release v5.0.0](https://github.com/docker/compose/releases/tag/v5.0.0), [releases](https://github.com/docker/compose/releases) |
| Umami (self-hosted) | 3.4.0 | 17/09/2026 | Sim | **Só suporta PostgreSQL** (12.14 ou mais novo); o MySQL saiu na v3. Pede Node 18.18 ou mais novo se for compilado do código-fonte; com Docker, isso não importa. Pode usar o mesmo Postgres local num banco separado. | [docs install](https://docs.umami.is/docs/install), [releases](https://github.com/umami-software/umami/releases) |
| Cloudflare Turnstile | Serviço (sem versão) | Página atualizada em 14/08/2026 | Sim | O plano Free cobre tudo de que o projeto precisa: verificações ilimitadas, até 20 widgets e 10 hostnames por widget. A marca da Cloudflare não pode ser removida no Free. | [docs plans](https://developers.cloudflare.com/turnstile/plans/) |
| **GlitchTip** | 6.2.6 | 07/08/2026 | Sim | **É o mais leve.** Mínimo de 256 MB de RAM (512 MB recomendados). Usa Postgres 14 ou mais novo, e o Valkey/Redis é opcional: com `VALKEY_URL` vazio, usa o Postgres como fila. É compatível com o SDK do Sentry. **Recomendado para a VPS de 4 vCPU e 8 GB.** | [docs install](https://glitchtip.com/documentation/install), [tags GitLab](https://gitlab.com/glitchtip/glitchtip-backend/-/tags) |
| Sentry self-hosted | 26.9.0 | 16/09/2026 | Sim | **Não cabe na VPS.** O mínimo é 4 núcleos, **16 GB de RAM + 16 GB de swap** (32 GB recomendados) e disco com IOPS alto. | [develop.sentry.dev/self-hosted](https://develop.sentry.dev/self-hosted/), [releases](https://github.com/getsentry/self-hosted/releases) |
| WhatsApp Cloud API (Graph API) | **v26.0** | 29/07/2026 | Sim | A v25.0 (18/02/2026) vale até 29/07/2028, e a v24.0 até 18/02/2028. Fixar a versão na URL (`/v26.0/`). | [Graph API changelog](https://developers.facebook.com/docs/graph-api/changelog) |
| WhatsApp **coexistência** (app Business + Cloud API) | Documentação oficial existe ("Onboarding WhatsApp Business app users", via Embedded Signup) | 10/2026 | Sim | **Exige ser Solution Partner/Tech Provider ou usar um BSP** e o app Business 2.24.17 ou mais novo. O limite é de 20 msg/s. **Não suporta** grupos, mensagens temporárias e de visualização única, listas de transmissão (ficam só para leitura), chamadas, catálogo, respostas rápidas, etiquetas e mensagens de ausência ou saudação. Na entrada, desvincula os dispositivos companheiros (o WhatsApp para Windows deixa de funcionar). O histórico fica sincronizado. | [docs Meta](https://developers.facebook.com/docs/whatsapp/embedded-signup/custom-flows/onboarding-business-app-users) |
| SMS: **AWS End User Messaging** (antigo SNS SMS) | US$ **0,03** por SMS para o Brasil (todas as operadoras) | CSV oficial em 10/2026 | Sim | **É o mais barato com API.** Os preços mudam com frequência. A página do SNS não mostra o preço por mensagem para o Brasil; o valor está no CSV do End User Messaging. | [pricing](https://aws.amazon.com/end-user-messaging/pricing/), [CSV](https://d1.awsstatic.com/onedam/marketing-channels/website/aws/en_US/business-applications/approved/documents/End-User-Messaging-SMS-Prices.ebc340b4d416d90832dd59629c4792b0deb6f8bc.csv) |
| SMS: Twilio | US$ **0,0599** por segmento para o Brasil, mais taxa de operadora | 10/2026 | Sim | É cerca do dobro da AWS. Mensagens com falha custam US$ 0,001. | [twilio.com/sms/pricing/br](https://www.twilio.com/en-us/sms/pricing/br) |
| SMS: Zenvia | Pacotes mensais de R$ 100 (1.000 SMS, R$ 0,10 cada) a R$ 2.000 (28.572 SMS, cerca de R$ 0,07 cada) | Página sem data | Sim | É cobrado em reais e não exige cartão internacional, mas é pacote mensal, e a página não deixa claro se a API está incluída. Para volume baixo, a AWS sai mais barata. | [zenvia.com promo](https://zenvia.com/promos/dispare-mensagens-que-convertem/) |

## Resumo para fixar

- **Python 3.14.8**, FastAPI 0.143.1, Pydantic 2.14.1, SQLAlchemy 2.1.4, Alembic 1.20.0, asyncpg 0.32.0, psycopg 3.3.6, Uvicorn 0.54.0, argon2-cffi 25.1.0, pyotp 2.10.0, httpx 0.28.1, structlog 26.1.0.
- **Fila: trocar o arq** (em modo manutenção) por **Taskiq 0.13.0**, com taskiq-redis, ou por **SAQ 0.26.4**.
- **Valkey 9.1.2** no lugar do Redis, pela licença BSD. Se preferir o Redis 8.10.2, usar sob a AGPLv3 e sem modificações.
- Testes e qualidade: pytest 9.1.1, Hypothesis 6.169.1, Schemathesis 4.31.0, import-linter 2.15, ruff 0.17.0, mypy 2.4.0.
- Front: **Node 24.22.0 LTS** (migrar para o 26 depois de 28/10/2026), Vite 8.3.4, lit-html 3.3.3, MSW 3.0.3, openapi-typescript 7.13.0 com openapi-fetch 0.17.0, Playwright 1.64.1, vite-plugin-pwa 2.0.0, @axe-core/playwright 4.13.0, @lhci/cli 0.15.1.
- Infra: Supabase com **PG 17.11** em sa-east-1 no plano Pro (avaliar o PITR de cerca de US$ 100/mês mais o compute Small), Caddy 2.11.7, Docker Compose 5.6.0, Umami 3.4.0 (Postgres), **GlitchTip 6.2.6**, Turnstile Free, Graph API v26.0, SMS pela AWS (US$ 0,03).
