# Pesquisa de stack: backend de reservas do Território

Data da pesquisa: 08/10/2026. Cada item traz a fonte. O que não deu para confirmar está marcado com **[NÃO CONFIRMADO]**.

> **Nota de 14/10:** esta é uma pesquisa de apoio; quem decide é o contrato de arquitetura (`ARCHITECTURE-SPINE.md`, AD-1 a AD-37). Lá ficou: SQL à mão com psycopg, sem ORM (nada de SQLAlchemy, Alembic ou asyncpg); fila e outbox no próprio Postgres, sem Redis nem Valkey; nginx e systemd na VM Oracle A1. A coexistência do WhatsApp permite usar o número atual da casa (+55 45 99830-4994) no app e na API ao mesmo tempo; falta só escolher a rota (Tech Provider ou BSP). Onde o texto abaixo recomendar outra coisa, vale o contrato.

## 0. Front-end: versões já fixadas em `package.json` (não alterar)

| Pacote | Versão fixada |
|---|---|
| lit-html | ^3.3.3 |
| three | ^0.186.1 |
| vite | ^8.3.1 |
| @playwright/test | ^1.63.0 |
| @axe-core/playwright | ^4.13.0 |
| eslint | ^10.11.0 |
| @eslint/js | ^10.0.1 |
| eslint-plugin-no-unsanitized | ^4.1.5 |
| globals | ^17.12.0 |
| msw | ^3.0.1 |
| prettier | ^3.9.9 |
| sharp | ^0.35.5 |
| stylelint | ^17.15.0 |
| stylelint-config-standard | ^40.0.0 |

Fonte: `C:\Users\matnew\Projects\territorio-app\package.json` (lido em 08/10/2026).

## 1. Backend Python: últimas versões estáveis (consulta ao PyPI em 08/10/2026)

| Componente | Última estável | Data | Python mínimo | Observação |
|---|---|---|---|---|
| Python | 3.14.8 (série 3.14) / 3.13.16 | 30/09/2026 | — | 3.15.0 final sai **09/10/2026** (amanhã). 3.10 chegou ao fim de vida em 01/10/2026. |
| FastAPI | 0.142.4 | 07/10/2026 | >=3.10 | Ainda 0.x: fixar versão exata (`==`), porque minor pode quebrar. |
| Pydantic (v2) | 2.13.5 | 28/08/2026 | >=3.9 | pydantic-settings 2.15.0 (07/08/2026). |
| Uvicorn | 0.54.0 | 25/09/2026 | >=3.10 | |
| psycopg (3) | 3.3.6 | 18/09/2026 | >=3.10 | Usar `psycopg[binary]` ou `psycopg[c]`. |
| asyncpg | 0.32.0 | 06/10/2026 | >=3.9 | Saiu há 2 dias: se escolher asyncpg, considerar 0.31.x até a 0.32 assentar. |
| SQLAlchemy | 2.1.4 | 07/10/2026 | **>=3.11** | A série 2.1 exige Python 3.11+. |
| Alembic | 1.20.0 | 11/09/2026 | >=3.10 | |
| argon2-cffi | 25.1.0 | 03/06/2025 | >=3.8 | Sem release novo desde 2025, mas segue a versão atual. |
| httpx | 0.28.1 | 06/12/2024 | >=3.8 | Sem release há quase 2 anos; continua sendo a última no PyPI (não existe 1.0 estável). |
| pytest | 9.1.1 | 19/06/2026 | >=3.10 | |
| Pillow | 12.3.0 | 01/07/2026 | >=3.10 | **AVIF já vem embutido nas wheels desde Pillow 11.3.0** (leitura e escrita; libaom para codificar, dav1d para decodificar), exceto Windows ARM64 e iOS. |
| pillow-avif-plugin | 1.6.0 | 22/07/2026 | — | Desnecessário com Pillow >= 11.3. |

**Recomendação de Python para produção:** 3.13 (3.13.16), por ser a série madura com suporte até 10/2029 e compatível com tudo acima. 3.14 (3.14.8, suporte até 10/2030) também é seguro um ano após o lançamento. Evitar 3.15 até sair pelo menos a 3.15.1/3.15.2.

Fontes:
- PyPI JSON API: https://pypi.org/pypi/{pacote}/json (fastapi, pydantic, pydantic-settings, uvicorn, psycopg, asyncpg, sqlalchemy, alembic, argon2-cffi, httpx, pytest, pillow, pillow-avif-plugin)
- Ciclos do Python: https://endoflife.date/api/python.json
- Calendário 3.15 (PEP 790): https://peps.python.org/pep-0790/
- Pillow 11.3.0, "AVIF support in wheels": https://pillow.readthedocs.io/en/stable/releasenotes/11.3.0.html
- Pillow 11.2.1 (AVIF só compilando do código-fonte; 11.2.0 retirado): https://pillow.readthedocs.io/en/stable/releasenotes/11.2.1.html

## 2. Oracle Cloud Always Free (2026)

**Compute grátis (documentação oficial, 08/10/2026):**
- **Ampere A1 (Arm, VM.Standard.A1.Flex): 1.500 OCPU-horas e 9.000 GB-horas por mês = 2 OCPUs e 12 GB de RAM no total** (divisíveis entre instâncias). **Atenção: é metade do que valia até 2025 (4 OCPU / 24 GB, 3.000 OCPU-h / 18.000 GB-h).** Tutoriais antigos que falam em 4/24 estão desatualizados.
- **AMD VM.Standard.E2.1.Micro: até 2 instâncias**, cada uma com 1/8 de OCPU (com burst), 1 GB de RAM, até 50 Mbps de internet (480 Mbps interno). Só podem ser criadas em um availability domain.
- Block Volume: 200 GB no total (boot + blocos) e 5 backups de volume. Boot mínimo de 50 GB.
- Compute e volumes Always Free têm de ficar na **região home** (escolhida no cadastro, não muda depois).

**São Paulo (sa-saopaulo-1):** a região tem um único availability domain, então a dica oficial "tente outro AD" não serve lá **[detalhe de 1 AD vem do conhecimento prévio, não reconferido hoje]**. Erros "Out of host capacity" para A1 são relatados em vários fóruns, inclusive em São Paulo (fio da comunidade Oracle sobre usuário sem capacidade A1 em sa-saopaulo-1 por 3 dias, e que também não conseguia migrar para PAYG). **Não há nota oficial de capacidade da região para 2026 [NÃO CONFIRMADO]**. Os AMD Micro costumam estar disponíveis com mais facilidade, mas 1 GB de RAM é apertado para FastAPI + worker.

**Reclamação de instância ociosa (texto oficial atual):** a Oracle pode reclamar instâncias Always Free se, **em um período de 7 dias**, todas as condições forem verdadeiras:
- CPU no **percentil 95 abaixo de 20%**;
- uso de rede **abaixo de 20%**;
- uso de memória **abaixo de 20%** (só vale para A1).

Um backend de reservas de restaurante pequeno fica ocioso quase sempre, então **estaria nesse critério**. (Esse limite já foi 10% e 15% em versões anteriores da regra.)

**Pay As You Go evita a reclamação?** A documentação atual **não diz isso explicitamente**: só diz que, depois do upgrade, recursos Always Free continuam sem cobrança e só se paga o que passar dos limites. O e-mail da Oracle de 2023 (reproduzido por terceiros) dizia que converter para PAYG impede que instâncias ociosas sejam paradas. Na prática a comunidade trata PAYG como proteção. **[NÃO CONFIRMADO em documentação oficial de 2026]**. Riscos: o upgrade exige cartão de crédito (pré-pago costuma ser recusado), faz uma pré-autorização, e qualquer recurso fora do Always Free passa a ser cobrado. Vale configurar orçamento (Budget) com alerta em R$ 0,01 e quotas de compartimento.

**Object Storage Always Free:** 20 GB no total (conta só Always Free: Standard + Infrequent + Archive somados) ou 10 GB de cada classe em conta paga/trial; 50.000 requisições de API por mês.

**Tráfego de saída:** 10 TB por mês grátis.

Fontes:
- Always Free Resources (Oracle): https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- Referência equivalente: https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm
- E-mail de 2023 sobre ociosidade e PAYG (terceiro): https://blog.51sec.org/2023/02/oracle-cloud-cleaning-up-idle-compute.html
- Comunidade Oracle, capacidade ARM (inclui fio de sa-saopaulo-1): https://community.oracle.com/customerconnect/discussions/tagged/arm/p1
- Guia 2026 de terceiros: https://braindetox.kr/en/posts/oracle_always_free_backend_2026.html

## 3. Supabase, plano Free (2026)

- **Banco:** 500 MB por projeto. Egress 5 GB/mês, Storage 1 GB, 50.000 MAU, **2 projetos ativos**.
- **Pausa por inatividade:** projetos Free são pausados após **7 dias de inatividade**. Reservas de restaurante pequeno podem ficar dias sem movimento: é preciso um "keep-alive" (consulta periódica real ao banco, por exemplo um cron/heartbeat que faça `SELECT 1` via API ou pela conexão Postgres). **O critério exato de "atividade" (se uma conexão Postgres direta conta, ou só requisições à API) não está na página de preços [NÃO CONFIRMADO].**
- **Backups:** o plano Free **não inclui backups automáticos**. Backup diário com 7 dias de retenção só no Pro (a partir de US$ 25/mês). No Free, o backup tem de ser nosso: `pg_dump` agendado na VM (enviando para Object Storage da Oracle, por exemplo).
- **Região São Paulo:** disponível, código `sa-east-1` (South America, São Paulo).
- **btree_gist:** está na lista de extensões disponíveis ("Support for indexing common datatypes in GiST"). Habilita `EXCLUDE USING gist` para impedir reservas sobrepostas na mesma mesa.

**Conexão direta x pooler:**

| Modo | Porta | IP | Uso |
|---|---|---|---|
| Direta (`db.<ref>.supabase.co`) | 5432 | **Só IPv6** (IPv4 apenas com o add-on pago de IPv4) | Backends persistentes, migrações, `pg_dump` |
| Pooler Supavisor, modo sessão | 5432 | IPv4 em todos os planos | Backends persistentes em rede só IPv4 |
| Pooler Supavisor, modo transação | 6543 | IPv4 | Serverless; **não suporta prepared statements** (asyncpg exige `statement_cache_size=0`), nem LISTEN/NOTIFY, advisory locks de sessão, tabelas temporárias |

**A VM da Oracle precisa do pooler?** Depende da rede:
- A VCN criada pelo assistente padrão da Oracle é só IPv4. Nesse caso, **sim: usar o pooler em modo sessão (porta 5432 do host do pooler)**, que é a recomendação oficial da Supabase para "rede só IPv4 sem o add-on" e mantém prepared statements.
- A Oracle suporta IPv6 em todas as regiões comerciais: dá para habilitar IPv6 na VCN, na sub-rede e atribuir um IPv6 à VNIC (mais rota `::/0` no internet gateway e regra de segurança). Com isso a VM consegue usar a conexão direta. É configuração extra; o pooler em modo sessão é o caminho mais simples.
- Recomendação: modo sessão para a aplicação; nunca o modo transação com asyncpg/psycopg sem desligar prepared statements.

Fontes:
- Preços: https://supabase.com/pricing
- Conexão: https://supabase.com/docs/guides/database/connecting-to-postgres
- Extensões: https://supabase.com/docs/guides/database/extensions
- Regiões: https://supabase.com/docs/guides/platform/regions
- IPv6 na OCI: https://docs.oracle.com/en-us/iaas/Content/Network/Concepts/ipv6.htm

## 4. WhatsApp Cloud API (2026)

**Versão da Graph API:** a mais recente é a **v26.0** (lançada em 29/07/2026, sem data de expiração definida). v25.0 (18/02/2026) vale até 29/07/2028; v24.0 (08/10/2025) até 18/02/2028. Recomendação: fixar `v26.0` na URL (`https://graph.facebook.com/v26.0/{phone_number_id}/messages`). Não encontrei anúncio de v27 até hoje.

**Webhook: verificação (GET):** a Meta chama a URL com `hub.mode=subscribe`, `hub.challenge` (inteiro) e `hub.verify_token` (string que nós definimos no painel do app). O endpoint confere o token e responde **só o valor de `hub.challenge`** com 200.

**Webhook: assinatura (POST):** cada evento vem com o header `X-Hub-Signature-256: sha256=<hex>`, que é o HMAC-SHA256 do **corpo bruto** da requisição usando o **App Secret**. Validar com o corpo em bytes, antes de qualquer parse de JSON, e comparar em tempo constante (`hmac.compare_digest`). A documentação diz "não é obrigatório, mas você deveria". Nota prática (não está na doc atual): a Meta assina o payload com caracteres Unicode escapados, por isso re-serializar o JSON quebra a assinatura; sempre usar os bytes originais.

**Botões de resposta rápida em templates:**
- Até **10 botões de resposta rápida**, rótulo de até **25 caracteres**; até 10 botões no total por template (no máximo 2 de URL, 1 de telefone, 1 de copiar código).
- Misturando tipos, os de resposta rápida têm de ficar agrupados (ex.: QR, QR, URL é válido; QR, URL, QR dá erro).
- Com mais de 3 botões, 2 aparecem e o resto vai para "Ver todas as opções". Templates com 4+ botões ou com resposta rápida + outro tipo **não aparecem no WhatsApp desktop**.
- O toque chega no webhook como mensagem `type: "button"` com `button.payload` e `button.text` **[formato do webhook vem do conhecimento prévio; a página de componentes não descreve]**.
- Para confirmar/cancelar reserva: template de **utilidade** com 2 botões de resposta rápida ("Confirmar", "Cancelar") resolve.

**Templates de autenticação (OTP):**
- Categoria `AUTHENTICATION`. Texto fixo pela Meta ("<CÓDIGO> é o seu código de verificação"), com opcionais "Para sua segurança, não compartilhe este código" e rodapé de validade (1 a 90 minutos).
- Botões: copiar código, one-tap autofill (exige app Android) ou zero-tap. Para web, o caminho é **copiar código**.
- Restrições a URL, mídia e emoji não constam na página consultada **[NÃO CONFIRMADO]** (o texto é fixo de qualquer jeito).

**Preço no Brasil:** desde 01/07/2025 a cobrança é **por mensagem de template entregue**; mensagens livres dentro da janela de atendimento de 24 h são grátis, e **templates de utilidade enviados dentro da janela aberta também são grátis**. Desde 01/07/2026 empresas elegíveis no Brasil podem ser faturadas em BRL. Valores para o Brasil: autenticação **≈ US$ 0,0068 por mensagem** (rate card de 01/07/2026, segundo a Authgear); utilidade em torno de US$ 0,0068 a 0,008 e marketing ≈ US$ 0,0625 (fontes de terceiros). Ou seja, **autenticação e utilidade custam praticamente o mesmo no Brasil**; marketing custa cerca de 9 vezes mais. **[Valores exatos NÃO CONFIRMADOS no rate card oficial: a tabela da Meta é interativa e não deu para extrair. Conferir em whatsappbusiness.com/pt-br/products/platform-pricing escolhendo Brasil/BRL.]**

**Limite de mensagens (empresa não verificada):** portfólios novos começam com **250 usuários únicos por 24 h móveis** (fora da janela de atendimento). Sobe para **2.000** ao verificar a empresa no Business Manager **ou** ao entregar 2.000 mensagens a usuários únicos em 30 dias com boa qualidade. Depois disso o escalonamento é automático (10 mil, 100 mil, ilimitado). O limite agora é **por portfólio** (compartilhado entre os números). Um restaurante pequeno cabe nos 250, já que respostas dentro da janela não contam.

**Registrar número novo:**
- O número precisa ser seu, ter código de país e DDD (short code não serve) e conseguir **receber código por SMS ou ligação**. A documentação não proíbe chip pré-pago; **chip pré-pago serve** desde que receba SMS/ligação **[não há menção explícita a pré-pago na doc oficial]**. Cuidado: operadoras cancelam e reciclam linhas pré-pagas paradas, então é preciso manter recarga/uso no chip para não perder o número.
- **Não pode estar ativo no app WhatsApp ao mesmo tempo:** um número em uso no WhatsApp tem de ter a conta apagada antes, e depois de registrado "não pode ser usado com o WhatsApp Messenger". A exceção é a **Coexistência** (mesmo número no app WhatsApp Business + Cloud API), que depende de elegibilidade por país **[disponibilidade no Brasil NÃO CONFIRMADA]**. Um terceiro cita espera de 48 h depois de apagar a conta, mas isso **não está na doc da Meta**.
- O registro é feito só pela API (`POST /{phone_number_id}/register`) com PIN de verificação em duas etapas de 6 dígitos (obrigatório). Limite de 10 tentativas de registro a cada 72 h por número. Portfólio novo pode ter 2 números registrados (20 depois de verificar).

Fontes:
- Versões da Graph API: https://developers.facebook.com/docs/graph-api/changelog/versions
- v26.0: https://developers.facebook.com/docs/graph-api/changelog/version26.0
- Webhooks: https://developers.facebook.com/docs/graph-api/webhooks/getting-started
- Componentes de template (botões): https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components
- Categorias de template: https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates
- Templates de autenticação: https://developers.facebook.com/docs/whatsapp/business-management-api/authentication-templates
- Preços: https://developers.facebook.com/docs/whatsapp/pricing e https://whatsappbusiness.com/pt-br/products/platform-pricing/
- Preço de autenticação no Brasil (terceiro): https://www.authgear.com/post/whatsapp-api-pricing
- Faixas de preço no Brasil (terceiros, divergentes): https://hyperleap.ai/whatsapp-pricing-calculator-brazil , https://www.messagecentral.com/blog/whatsapp-business-api-pricing-in-brazil
- Limites de mensagens: https://developers.facebook.com/docs/whatsapp/messaging-limits
- Números de telefone: https://developers.facebook.com/docs/whatsapp/cloud-api/phone-numbers
- Registro: https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/registration/
- Pré-requisitos e coexistência (terceiro): https://www.wati.io/blog/whatsapp-api-prerequisites

## 5. E-mail transacional grátis (redefinição de senha, volume baixo)

| Serviço | Plano grátis (2026) | Observações |
|---|---|---|
| **Resend** | **3.000 e-mails/mês, limite de 100/dia**, 3 domínios, 30 dias de retenção de logs | API simples, SDK Python. Exige verificar domínio (SPF/DKIM). Para reset de senha de um restaurante, 100/dia sobra. |
| **Brevo** | **300 e-mails/dia** (≈ 9.000/mês), transacional por API/SMTP incluído, até 100 mil contatos | Rodapé com marca Brevo no plano grátis. **[Valores de fontes de terceiros; a página oficial de preços não carregou na consulta. NÃO CONFIRMADO direto na Brevo.]** |
| **Amazon SES** | **Não existe mais o "3.000/mês por 12 meses"**: contas novas da AWS recebem até **US$ 200 em créditos do Free Tier** (válidos por 12 meses; o plano grátis da conta dura 6 meses). Depois, US$ 0,10 por 1.000 e-mails (à la carte) | Conta começa em **sandbox**: só envia para endereços verificados e no máximo 200 mensagens/24 h, até pedir acesso de produção. Mais burocracia que Resend/Brevo. |

**Recomendação:** Resend (mais simples, limite diário suficiente); Brevo como alternativa se quiser mais folga diária.

Fontes:
- Resend: https://resend.com/pricing
- Brevo (terceiros): https://dreamlit.ai/blog/brevo-review , https://ecommerce-platforms.com/email-marketing-services-reviews/sendinblue-pricing , https://www.brevo.com/pricing/
- Amazon SES, preços: https://aws.amazon.com/ses/pricing/
- Amazon SES, sandbox: https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html

## 6. Monitoramento de disponibilidade e heartbeat grátis

| Serviço | Plano grátis (2026) | Heartbeat (cron)? | Observações |
|---|---|---|---|
| **UptimeRobot** | **50 monitores, intervalo de 5 min**, 1 página de status básica, até 5 integrações; SMS/ligação são pagos | **Não incluso no Free** (o artigo de ajuda lista só HTTP, keyword, ping e porta) | Uso comercial **permitido**: a ajuda oficial (atualizada em 28/09/2026) diz que o Free "está disponível para qualquer uso, inclusive comercial". Blogs de concorrentes dizem o contrário (regra de 2024), mas a fonte oficial atual vence. |
| **Healthchecks.io** | Hobbyist: **20 checks**, 100 entradas de log por check | **Sim** (é o produto principal: ping de cron/heartbeat) | Ideal para conferir se o `pg_dump` noturno e o keep-alive do Supabase rodaram. SMS/WhatsApp só no plano Business. **[Integrações do plano grátis (e-mail, Telegram etc.) e nº de membros não apareceram na página; NÃO CONFIRMADO.]** |
| **Better Stack** | **10 monitores + heartbeats somados**, 1 página de status, alertas por Slack e e-mail | **Sim** (conta dentro dos 10) | Ligação/SMS não estão no grátis. Intervalo de checagem do grátis não aparece na página **[NÃO CONFIRMADO; historicamente era 3 min]**. Plano descrito como "para projetos pessoais". |

**Recomendação:** UptimeRobot para o `GET /health` público (5 min) + Healthchecks.io para os jobs agendados (backup, keep-alive). Os dois são grátis e somam bem.

Fontes:
- UptimeRobot, preços: https://uptimerobot.com/pricing/
- UptimeRobot, uso do Free: https://help.uptimerobot.com/en/articles/11604710-who-should-use-uptimerobot-s-free-plan
- Healthchecks.io: https://healthchecks.io/pricing/
- Better Stack: https://betterstack.com/pricing

## Resumo do que ficou sem confirmação

1. Se Pay As You Go na Oracle impede a reclamação de instância ociosa (só fonte de 2023; a doc atual não diz).
2. Situação de capacidade A1 em São Paulo em 2026 (só relatos de fórum) e o detalhe de a região ter 1 AD.
3. O que conta como "atividade" para o Supabase não pausar o projeto Free.
4. Preços exatos do WhatsApp no Brasil por categoria (tabela oficial interativa; valores de terceiros).
5. Coexistência (app + API no mesmo número) disponível no Brasil; espera de 48 h após apagar conta.
6. Limites do plano grátis da Brevo direto da fonte oficial.
7. Integrações grátis do Healthchecks.io e intervalo do Better Stack grátis.
