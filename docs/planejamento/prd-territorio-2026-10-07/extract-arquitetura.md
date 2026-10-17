# Extração: arquitetura, fases, responsabilidades e riscos

07/10/2026 · fontes: `territorio/docs/09-plano-de-construcao.md` (plano, 1195 linhas), `territorio/docs/11-estado-2026-10-07.md`, `territorio-app/docs/10-escopo-modulo-1.md`, `docs/05-decisoes.md`, `docs/api/openapi.yaml` e o próprio código do `territorio-app` (README, package.json, vite.config.js, src/, scripts/, tests/, .githooks/, git log).

Convenções:
- **[INFERIDO]** = o plano ou o escopo não dizem; é dedução minha.
- **[SERVIDOR GRÁTIS]** = ponto em que a decisão do Matheus de 07/10 (servidor gratuito por enquanto, no lugar do VPS do plano) muda alguma coisa.
- Estado conferido no repositório em 07/10/2026 (5 commits, o último `97a64f5`).

---

## 1. Arquitetura decidida

### 1.1 Visão geral

Front-end completo primeiro, rodando sobre uma API simulada que segue o contrato da API real. O Marcus valida telas e fluxo; só depois entra o backend, sem reescrever tela. Um único módulo (`src/services/api/`) conhece URLs; é ele que troca o mock pelo backend.

```
Páginas → Features (regras) → services/api ──agora──→ MSW (mock no navegador)
                                            └─depois─→ FastAPI → Supabase (Postgres SP)
                                                               → n8n → WhatsApp Cloud API
```

### 1.2 Front-end

| Item | Decisão | Estado no código |
| --- | --- | --- |
| Stack | HTML, CSS e JS puros; Vite multipágina (`appType: "mpa"`, toda `index.html` vira entrada); lit-html nas partes dinâmicas; three.js só sob demanda | Feito. `vite@8`, `lit-html@3`, `three@0.186`. Plugin próprio de partials (`<!-- @include x.html -->`) |
| Camadas | tokens → componentes → features → páginas. Página só junta peças | Tokens, componentes, lib, services, mocks e types existem; **`src/features/` ainda não existe** |
| Visual | Migrar `territorio/site/index.html` e `site/fluxo.html` aprovados, sem redesenhar. Design system "papel e ferro" (marsala, off-white, mescla, preto lavado; paleta Food Club só nos produtos) | Tokens e 13 folhas de componente (`badge, button, choice, data-table, dialog, feedback, field, floor, receipt, seal, stats, tabs, toast`); catálogo `/_ds/` publicado |
| Fontes | WOFF2 locais, só latim + acentos, Nanum Pen com acentos completados; pré-carregar só Big Shoulders e Archivo | Feito (`public/fonts/`, `scripts/fonts/build_fonts.py`) |
| Imagens | sharp gera AVIF, WebP e JPG; `<picture>` com tamanho declarado | Feito (`scripts/optimize-images.mjs`, 19 fotos em `public/img/fotos/`); larguras 480/900 (ou 480/960/1440), não as 4 do plano |
| Páginas públicas | `/`, `/cardapio` (QR nas mesas), `/reservar` (link da bio), `/minhas-reservas`, `/r?t=` (comprovante), `/confirmar?t=`, `/espera?t=`, `/privacidade`, `404` | **Só existem `/` (página provisória "em construção") e `/_ds/`** |
| Páginas do admin (`/admin/…`) | entrar, primeiro-acesso, convite, recuperar-senha, nova-senha, hoje, reservas, salao, espera, agenda, eventos, clientes, plantas, cardapio, site, galeria, equipe, registro, configuracoes, conta (+ primeiro uso) | **Nenhuma existe** |
| Como fala com a API | Tela chama `reservations.create()`, nunca `fetch` (lint barra `fetch` fora de `services/api`). Erros problem+json (RFC 9457) com erro por campo. Cookie `httpOnly` + `credentials: 'include'` + cabeçalho CSRF. Chave de idempotência. Timeout. Datas `YYYY-MM-DD`/`HH:MM` no fuso da casa, instantes em UTC, dinheiro em centavos. Base `VITE_API_BASE=/api/v1` (mesmo domínio) | Feito: `client.js` (timeout 15 s, CSRF, idempotência, erros), `auth.js`, `availability.js`, `house.js`, `links.js`, `reservations.js`. **Falta o lado `staff/*`** |
| Público × admin | Pastas, CSS e JS separados; landing funciona sem JS (conteúdo gravado no HTML no build); admin `noindex` em `/admin` no mesmo domínio | Ainda não aplicável (sem landing nem admin) |
| Multi-casa | `house_id` em toda entidade desde já | Nos modelos (`src/types/models.js`) e no contrato |

### 1.3 API simulada (mock)

- **MSW** interceptando as chamadas no navegador; seeds geradas a partir da data de hoje (mesmos nomes e mesas do `fluxo.html`), motor de disponibilidade simulado, persistência em `localStorage` com versão, barra de demonstração (resetar, trocar papel), estados forçados `?mock=lento|erro|vazio` e hora fingida `?agora=…`.
- O mock só entra no build de demonstração (`npm run build:demo`). **O build de produção falha com `VITE_API_MODE=mock`** (checado em `vite.config.js`) — feito.
- **Estado real:** o motor de disponibilidade (`src/mocks/availability.js`, 410 linhas, com 246 linhas de teste) e as seeds estão feitos, mas **os handlers cobrem só 5 rotas públicas de leitura**: `GET /house`, `/content`, `/menu`, `/availability/days`, `/availability/slots`. O contrato tem **85 caminhos**; faltam no mock todos os POST/PATCH (reserva, código pelo WhatsApp, links, minhas reservas) e todo o `/staff/*`.
- Contrato: `docs/api/openapi.yaml` (2113 linhas, v0), cobrindo público, cliente, links, webhook `/internal/whatsapp/replies` e o painel inteiro.

### 1.4 Backend previsto (não começado)

| Peça | Papel |
| --- | --- |
| **FastAPI** | Dona de toda regra que importa: vaga, limites, permissões por papel (matriz da seção 5 aplicada em cada endpoint), transições de status, relógio do servidor. Gera o mesmo OpenAPI para conferir contra o contrato |
| **Supabase** (Postgres, região São Paulo) | Banco; trava contra duas reservas na mesma mesa/horário no próprio banco (exclusion constraint) [INFERIDO o mecanismo]; índices únicos; RLS por `house_id`; registro de ações só-inclusão garantido no banco; senha com argon2id ou Supabase Auth operado pelo servidor |
| **n8n** | Orquestra mensagens: código de 6 dígitos, reserva recebida/confirmada, lembrete 3 h antes de abrir com botões (Confirmo / Não vou mais / Vou atrasar um pouco), oferta da lista de espera (10 min), recusa, aviso de pendente à casa. `MessageLog` com status |
| **WhatsApp Cloud API** (Meta) | Canal oficial; templates aprovados pela Meta; cobra por mensagem (~R$ 0,04; estimativa R$ 10–40/mês). Conta no nome da casa, cartão da casa |
| E-mail | Desligado na v1 (só para recuperação de senha da equipe [INFERIDO: o plano exige "enviamos um link" no esqueci a senha, logo precisa de um provedor de e-mail transacional]) |
| Agenda do celular | `.ics` gerado no comprovante |

Backlog específico do backend (fase 7 do plano): contrato v1 congelado; esboço do banco (tabelas, índices, trava de mesa, RLS); matriz de permissões por endpoint; lista de tudo que o mock "perdoa" (relógio do navegador, validação só no front) como item obrigatório; templates para a Meta; plano de publicação. **O backend em si não tem estimativa de horas em nenhum documento** (apontado pelo julgamento de 06/10).

### 1.5 Hospedagem e deploy

**O plano diz:** mesma hospedagem do Dionísio — VPS com nginx na frente do uvicorn (systemd), HTTPS por certbot, deploy por script; Brotli, arquivos com hash em cache de 1 ano, HTML sempre revalidado; site, painel e API no mesmo domínio (por isso sem CORS e cookie `SameSite=Strict`); Cloudflare opcional; backups do banco com teste de restauração; ambientes dev/demo/prod com chaves próprias.

**O escopo assinável diz:** "Servidor e banco de dados começam nos planos gratuitos. Se o movimento exigir um plano pago, eu aviso antes." Mensalidade de R$ 100 promete **backup diário guardado por 30 dias, com teste de restauração a cada 3 meses**. Publicação no domínio da casa com HTTPS.

**[SERVIDOR GRÁTIS] — onde a troca de VPS por plano gratuito muda algo:**

| Ponto do plano | O que muda |
| --- | --- |
| nginx + certbot + systemd + deploy por script (tarefa 7.6) | Some o roteiro "esquema Dionísio". Vira: front estático numa hospedagem grátis de site estático [INFERIDO: Cloudflare Pages, Netlify ou similar] e a API num serviço grátis de contêiner ou numa VM grátis. A tarefa 7.6 precisa ser reescrita |
| "Mesmo domínio, sem CORS, cookie `SameSite=Strict`" | Se front e API ficarem em provedores diferentes, é preciso **ou** proxy reverso no provedor do front (`/api/*` → API) **ou** subdomínio `api.<domínio-da-casa>` (mesmo "site", então cookie `SameSite` continua valendo, mas aí entra CORS com credenciais). Decidir antes de congelar o contrato v1 |
| Cabeçalhos de segurança (CSP sem `unsafe-inline`, HSTS, `frame-ancestors`) e cache/Brotli | Saem do nginx e vão para o arquivo de cabeçalhos do provedor estático [INFERIDO] |
| Serviço da API sempre ligado | Planos gratuitos de contêiner costumam **adormecer após inatividade** (partida a frio de dezenas de segundos) [INFERIDO, conferir o provedor]. Afeta a primeira reserva da noite, o webhook do WhatsApp (a Meta reenvia, mas a resposta atrasa) e o envio dos lembretes agendados. Uma VM gratuita "sempre ligada" [INFERIDO: ex. Oracle Cloud Always Free, que tem região São Paulo] preserva o modelo VPS do plano quase sem mudança |
| "Dados ficam no Brasil" (LGPD, seção 7) | Supabase grátis pode ficar em São Paulo; mas muitos serviços grátis de API não têm região no Brasil, então os dados **passam** por fora do país. Ajustar a política de privacidade ou escolher provedor com região BR |
| Backup diário por 30 dias + teste de restauração (prometido no escopo) | O plano gratuito do Supabase **não inclui backups diários gerenciados** [INFERIDO, conferir]. Precisa de rotina própria (`pg_dump` agendado — ex. GitHub Actions — para um armazenamento grátis) |
| Banco sempre disponível | Projeto gratuito do Supabase **pausa após ~1 semana sem atividade** e tem limite de 500 MB [INFERIDO, conferir]. Com reservas diárias não deve pausar, mas em férias da casa pode |
| n8n | O registro de decisões do PRD, da época, anota "n8n local". Se "local" for o PC do Matheus, **lembretes, códigos e ofertas da lista de espera dependem do PC dele ligado**. Alternativas: n8n no mesmo servidor grátis da API, ou mover os envios para dentro do FastAPI (agendador próprio) [INFERIDO] |
| Limite de envio e rate limit (seção 7) | Sem nginx, o limite por IP/telefone precisa morar no FastAPI ou no proxy do provedor |
| Ambientes dev/demo/prod | Demo pode ficar em hospedagem estática grátis com senha [INFERIDO: proteção por senha nem sempre é grátis; alternativa é link secreto + `noindex`] |

### 1.6 Segurança (decidido)

- **Nunca no front:** `service_role` do Supabase, segredo de JWT, token da WhatsApp Cloud API, segredos do n8n. Variável `VITE_` vai para o navegador. Chave que entrou no git uma vez é trocada (lição do Dionísio).
- **Equipe:** sessão no servidor, cookie `httpOnly; Secure; SameSite=Strict`, nada em `localStorage`; senha ≥ 12, senha vazada recusada, bloqueio após 5 falhas, duas etapas para o dono; reautenticação para exportar, mudar papel e apagar cliente; primeiro acesso do dono só por link de configuração (sem cadastro público de admin); convite 72 h; troca de senha 30 min, uso único.
- **Cliente:** código de 6 dígitos pelo WhatsApp com hash, 10 min, 5 tentativas, reenvio após 30 s; "lembrar aparelho" 90 dias.
- **Links:** dois tokens longos (leitura e ação), guardados só como hash; abrir o link nunca muda nada (prévia do WhatsApp abre a URL sozinha); `?voltar=` só aceita caminho interno.
- **Abuso e custo:** campo invisível, tempo mínimo de preenchimento, 3 códigos/hora por número, 2 reservas futuras por telefone, teto diário de envios, só +55/+595/+54; Turnstile só se aparecer abuso.
- **LGPD:** nome + WhatsApp como mínimo; restrição alimentar como dado de saúde (apagada 30 dias após a visita); guarda de 24 meses e registro de ações por 12 meses; "baixar/apagar meus dados"; telefone mascarado para o perfil Salão; sem cookies de terceiros; plano de incidente (ANPD em 3 dias úteis). Escopo: a casa é controladora, Matheus é operador.
- **XSS:** lit-html escapa; ESLint `no-unsanitized` barra `innerHTML` com dados.
- **Estado no código:** lint feito (ESLint + `no-unsanitized` + regra contra `fetch`, Stylelint contra cor fora dos tokens, Prettier); hook `.githooks/pre-commit` roda `scripts/check-secrets.mjs` (o plano pedia gitleaks; foi trocado por script próprio). **Achado da revisão de 07/10 ainda aberto:** o `check-secrets` não pega valor entre aspas. Arquivos `.env*` estão fora do git (corretamente), mas **não há `.env.example`** apesar de o README e o plano o citarem — um clone novo não tem as variáveis públicas.

### 1.7 Testes

| Tipo | Plano | Estado |
| --- | --- | --- |
| Unidade | Funções de `lib/` com teste | Feito: `node:test`, 38 testes em 3 arquivos (lib, client, availability). **Não roda no `npm test` nem no hook** (achado da revisão) |
| Ponta a ponta + acessibilidade | Playwright, computador e celular, axe | Feito para o catálogo: 14 testes em `tests/e2e/design-system.spec.js` (computador 1440 e Pixel 7), axe incluído, estados `?mock=` cobertos |
| Visual contra os prints aprovados | `toHaveScreenshot` contra `pdf/shots` e o `fluxo.html` | Configurado (tolerância 1%), **nenhum teste visual escrito** |
| E2E da reserva (feliz + 12 erros) | Fase 3 | Não começado |
| Lighthouse CI com orçamento | Fase 6 | Não começado; **não há CI** (sem `.github/`) |
| Mock × contrato | Fase 7 | Não começado |
| Leitor de tela (NVDA, TalkBack), aparelhos reais | Fase 6 | Não começado |

---

## 2. Fases e backlog, com estado real

Plano: 8 fases, 84 tarefas, ~18 dias úteis até o backend poder começar (a soma das fases dá 15). Caminho crítico: **0.5 → 1.8 → 1.9 → 3.1 → 3.8 → 5.5 → 6.5 → 7.1**. O escopo assinável prevê 8 semanas da assinatura até a publicação, contadas a partir de quando a casa entregar o material.

### Resumo

| Fase | Duração no plano | Estado real |
| --- | --- | --- |
| 0 · Inventário e contrato | 0,5 dia | **Feito** (só o pedido de material ao Marcus, 0.7, sem comprovação) |
| 1 · Setup e base visual | 1,5 dia | **Quase feito** — faltam handlers do mock além do público de leitura, partials de cabeçalho/rodapé/casca, testes visuais, gaveta como componente próprio [a conferir] |
| 2 · Landing | 2 dias | **Não começado** (`/` é página provisória) |
| 3 · Reservas | 3 dias | **Não começado** (só o cliente da API e componentes soltos: otp, telefone, escolhas, comprovante em CSS) |
| 4 · Autenticação e casca do painel | 1 dia | **Não começado** |
| 5 · Painel | 4 dias | **Não começado** (só CSS de `floor`, `stats`, `data-table` no catálogo) |
| 6 · Validação com o Marcus | 2 dias | **Não começado** |
| 7 · Preparação para o backend | 1 dia | **Não começado** |
| Backend (FastAPI, Supabase, n8n, WhatsApp, deploy) | sem estimativa | **Não começado** |

### Fase 0 · Inventário e contrato — FEITO

| ID | Tarefa | Estado |
| --- | --- | --- |
| 0.1 | Escopo | Feito (`docs/01-escopo.md`) + escopo assinável `docs/10-escopo-modulo-1.md` |
| 0.2 | Mapa de telas | Feito (`docs/02-telas.md`) |
| 0.3 | Modelos de dados | Feito (`docs/03-modelos.md`, `src/types/models.js`) |
| 0.4 | Regras da reserva | Feito (`docs/04-regras-reserva.md`) |
| 0.5 | Contrato v0 | Feito (`docs/api/openapi.yaml`, 85 caminhos) |
| 0.6 | Decisões como configuração | Feito (`docs/05-decisoes.md`, 29 decisões) |
| 0.7 | Pedido de fotos, textos, cardápio ao Marcus | **Não comprovado** — a lista existe ("Conteúdo que falta" em `05-decisoes.md` e "O que a casa fornece" no escopo), mas não há registro de envio |

### Fase 1 · Setup e base visual — QUASE FEITO

| ID | Tarefa | Estado |
| --- | --- | --- |
| 1.1 | Repo, Vite MPA, ESLint, Stylelint, Prettier, gitleaks, `.env.example` | Parcial: tudo menos gitleaks (trocado por script próprio, com falha conhecida) e `.env.example` (ausente). Repo com 5 commits |
| 1.2 | Tokens | Feito (`src/styles/tokens.css`) |
| 1.3 | Fontes locais com acentos | Feito |
| 1.4 | Base e layout | Feito (`base.css`, `layout.css`) |
| 1.5 | Componentes base | Quase feito: botão, campo, escolhas, janela, confirmação, aviso, selo de status, tabela, abas, vazio, esqueleto, OTP, telefone, selo de sementes, comprovante, mesa da planta. Gaveta só como variação do `dialog.css` |
| 1.6 | Catálogo `/_ds` | Feito |
| 1.7 | `lib/` | Feito, com teste (datas no fuso, telefone BR/PY/AR, validação, dinheiro, textos, html, idempotência, storage) |
| 1.8 | Cliente da API | Feito (crítico) |
| 1.9 | MSW, seeds, motor, persistência, barra de demo | Parcial (crítico): motor, seeds, cenários, barra e persistência prontos; handlers só para 5 GETs públicos |
| 1.10 | Partials | Parcial: só `head.html` |
| 1.11 | Pipeline de imagens | Feito |
| 1.12 | Playwright + visual + axe | Parcial: Playwright e axe sim; comparação com prints aprovados não |

### Fase 2 · Landing — NÃO COMEÇADO

2.1 cabeçalho/rodapé · 2.2 capa · 2.3 Hoje na casa (o 3D saiu da lojinha; ver 11-estado) · 2.4 A casa e Experiência · 2.5 Cardápio + `/cardapio` · 2.6 Ambiente · 2.7 faixa de reserva · 2.8 lojinha (**mudou**: o plano fala em varal 3D; a proposta agora usa a vitrine de manequins, com 4 defeitos abertos no `territorio/site`) · 2.9 localização e horários · 2.10 SEO · 2.11 conteúdo gravado no HTML · 2.12 comparação visual + Lighthouse. Todas não começadas.

### Fase 3 · Reservas — NÃO COMEÇADO

3.1 máquina de estados (crítico) · 3.2 pessoas · 3.3 dia · 3.4 horário · 3.5 combinados · 3.6 quem vem · 3.7 código pelo WhatsApp · 3.8 revisão e confirmar (crítico) · 3.9 comprovantes · 3.10 `/reservar` · 3.11 Minhas reservas (o escopo acrescenta remarcar e **mudar o número de pessoas**) · 3.12 `/r`, `/confirmar`, `/espera` · 3.13 erros gerais · 3.14 E2E feliz + 12 erros. Peças prontas que serão usadas: `otp.js`, `phone-field.js`, `choice-group.js`, `receipt.css`, `lib/idempotency.js`, `services/api/reservations.js` e `links.js`.

### Fase 4 · Autenticação e casca — NÃO COMEÇADO

4.1 sessão simulada e guarda de rota · 4.2 login · 4.3 primeiro acesso · 4.4 convite · 4.5 esqueci a senha · 4.6 casca do painel · 4.7 minha conta (P2).

### Fase 5 · Painel — NÃO COMEÇADO

5.1 Plantas · 5.2 Configurações · 5.3 Primeiro uso · 5.4 Hoje · 5.5 Reservas (crítico) · 5.6 Aprovação manual (**o escopo tira "propor horário"**: a recusa leva o link) · 5.7 Salão ao vivo · 5.8 Lista de espera · 5.9 Agenda e plano do dia · 5.10 Cardápio · 5.11 Clientes · 5.12 Site · 5.13 Galeria · 5.14 Equipe · 5.15 Registro (o escopo acrescenta: conta compartilhada do tablet aparece como "Salão") · 5.16 E2E painel → landing · 5.17 Eventos · 5.18 Lista na porta · 5.19 Sugestão pela procura (P2).

### Fase 6 · Validação — NÃO COMEÇADO

6.1 checklist (seção 10 do plano) · 6.2 revisão de design e acessibilidade · 6.3 Lighthouse CI · 6.4 publicação de demonstração (**[SERVIDOR GRÁTIS]**: onde hospedar com senha) · 6.5 sessão guiada com o Marcus (crítico; corresponde à etapa 1 "Telas" do escopo, com aceite por escrito) · 6.6 ajustes e segunda rodada.

### Fase 7 · Preparação para o backend — NÃO COMEÇADO

7.1 contrato v1 (crítico) · 7.2 mock × contrato · 7.3 esboço do banco · 7.4 matriz de permissões · 7.5 templates para a Meta e fluxos n8n · 7.6 plano de publicação (**[SERVIDOR GRÁTIS]**: reescrever, o plano diz VPS/nginx/certbot/systemd) · 7.7 suíte com `VITE_API_MODE=http`.

### Depois da fase 7 (escopo, etapas 2 a 4; sem tarefas no plano)

- Etapa 2 "Sistema real": construir o backend, ligar banco, WhatsApp e domínio, cadastrar a planta real.
- Etapa 3 "Noite simulada" com a equipe.
- Etapa 4 "Publicação": abre ao público; começam os 30 dias de correção e a mensalidade.
- [INFERIDO] Itens novos que o escopo criou e o plano não tem como tarefa: rotina de backup diário + teste de restauração trimestral; redação da política de privacidade; caixa "quero receber novidades" (separada da reserva); oferta automática da lista de espera (o escopo diz "o sistema oferece a mesa sozinho"; o plano tinha "Oferecer mesa" como ação da equipe em 5.8); confirmação pela página do site como plano B se a Meta atrasar.

---

## 3. Divisão de responsabilidades

Papéis: **Matheus** (decisões, contato com cliente, contas e infra), **Backend**, **Front-end**, **Casa** (Marcus e equipe). Hoje Matheus faz backend e front sozinho; os papéis separam *o tipo* de trabalho.

| Bloco | Quem faz | Fonte |
| --- | --- | --- |
| Confirmar por escrito que o "sim" de 30/09 cobriu só o módulo 1 (mensagem pronta em 11-estado) | Matheus envia; Casa responde | 11-estado, julgamento |
| Assinar o escopo e pagar 50% | Casa (Marcus) assina; Matheus envia | Escopo |
| Responder as 29 decisões (no cadastro da casa, na validação) | Casa | Plano seção 4, escopo |
| Planta real das mesas | Casa informa; **Matheus cadastra** antes de abrir as reservas | Escopo ("cadastrada por mim") |
| Cardápio e carta de bebidas finais com preços | Casa | Escopo |
| Fotos em alta (fachada, salão, quintal, pratos) | Casa (ou fotógrafo dela) [INFERIDO o fotógrafo] | Escopo |
| Dados para a política de privacidade (razão social, CNPJ, contato) | Casa | Escopo |
| Redigir a política de privacidade | Matheus redige; Casa revisa e publica; revisão jurídica recomendada | Escopo, plano seção 7 |
| Número de WhatsApp da casa | Casa | Escopo |
| Conta Meta Business, verificação da empresa, migração do número, cartão para cobrança | **Casa é titular** (conta e cartão no nome dela); **Matheus conduz a configuração** [INFERIDO a condução] | Escopo |
| Templates de mensagem para aprovação da Meta | Matheus escreve (7.5); Meta aprova; textos fixos na v1 | Plano, escopo |
| Domínio (manter o atual ou escolher novo) e registro | Casa decide e é titular [INFERIDO a titularidade]; Matheus aponta o DNS | Escopo |
| Contas de infraestrutura grátis (hospedagem do front, API, Supabase, n8n) | Matheus cria e opera [INFERIDO]; recomendação: contas no nome/e-mail da casa ou transferíveis [INFERIDO] | Escopo ("eu aviso antes" do plano pago) |
| Autorização para frases de clientes (depoimentos) | Casa | 05-decisoes |
| Mockups em alta da lojinha e foto da ecobag | Casa pede à Mixi (designer) [INFERIDO quem pede] | 11-estado |
| Códigos das cores Food Club | Designer da casa confirma | Plano seção 9 |
| Fases 1–5 (base visual, landing, reservas, auth, painel) | Front-end | Plano |
| Mock (MSW) e contrato | Front-end (mock) + Backend (contrato v1 congelado) | Plano |
| Fase 6: checklist, revisão, Lighthouse, demo | Front-end; Matheus conduz a sessão | Plano |
| Fase 6: sessão guiada, crítica, **aprovação por escrito das telas** | Casa (Marcus) | Plano, escopo |
| Fase 7 e backend (FastAPI, banco, RLS, permissões, n8n, WhatsApp, rate limit, upload, e-mail de senha) | Backend | Plano |
| Deploy, HTTPS, cabeçalhos, backups, monitoramento | Matheus/Backend [INFERIDO: o plano diz "deploy por script", sem dono] | Plano, escopo |
| Noite simulada | Casa (equipe opera); Matheus acompanha | Escopo |
| Manutenção mensal (correções, atualizações, backup, 2 h/mês) | Matheus | Escopo |
| Trocar peças da lojinha, mudar regra do sistema | Pedido da Casa → Matheus (conta nas 2 h) | Escopo |
| Ajustes do dia a dia (cardápio, eventos, plano do dia, textos, fotos) | Casa, pelo painel | Escopo |
| Atender pedido de titular (LGPD) | Casa (controladora), usando o painel | Escopo |

---

## 4. Dependências externas e riscos de prazo

### Dependências externas

| Dependência | De quem depende | Bloqueia o quê |
| --- | --- | --- |
| Assinatura do escopo e confirmação do 30/09 | Marcus | O relógio das 8 semanas e o pagamento inicial |
| Material da casa (cardápio, fotos, CNPJ, número, domínio, respostas) | Marcus | O prazo de 8 semanas só conta a partir da entrega |
| Verificação da empresa na Meta, migração do número, aprovação dos templates | Meta + casa | Código, confirmação e lembrete pelo WhatsApp. Plano B do escopo: abrir com confirmação pela página do site |
| Número de WhatsApp | Casa | Se for o número que a casa usa hoje no app WhatsApp Business, migrar para a Cloud API **tira o número do app do celular** [INFERIDO, conferir regras atuais da Meta] — a casa pode perder o atendimento por DM nesse número |
| Domínio | Casa | HTTPS, link da bio, QR do cardápio, imagem de compartilhamento |
| Aprovação das telas por escrito | Marcus | Etapa 2 (sistema real). Depois dela, mudança de layout é orçamento à parte |
| Planos gratuitos (Supabase, hospedagem) | Provedores | Disponibilidade, backups, região dos dados |
| Imagens da Mixi | Designer da casa | Lojinha final |

### Riscos de prazo

1. **Meta/WhatsApp (alto).** Verificação da empresa, migração do número e aprovação de templates levam "de dias a semanas" e não dependem do Matheus. O código de 6 dígitos para entrar e reservar também passa pelo WhatsApp: sem a Meta, o plano B precisa cobrir **a verificação do cliente**, não só a confirmação [INFERIDO — o escopo só fala da confirmação]. Começar a verificação da Meta logo na assinatura.
2. **Material e decisões da casa (alto).** 29 decisões, cardápio com preços "a confirmar", fotos em alta, CNPJ. O prazo de 8 semanas pausa enquanto não chegam, mas o trabalho trava junto.
3. **Aprovação das telas (alto).** A etapa 1 exige o Marcus operando uma noite simulada sem ajuda e aprovando por escrito; o plano prevê duas rodadas de ajuste. Um dono ocupado em temporada de eventos atrasa tudo depois dela.
4. **Backend sem estimativa (alto).** Só o front tem 84 tarefas e ~15–18 dias úteis, com 2 de 8 fases feitas; o backend (FastAPI, banco com trava de mesa e RLS, permissões, n8n, WhatsApp, upload, e-mail, deploy, backups) não tem nenhuma estimativa, e as 8 semanas do escopo precisam cobrir os dois.
5. **[SERVIDOR GRÁTIS] (médio).** API que adormece, n8n "local" no PC do Matheus, Supabase grátis sem backup diário e com pausa por inatividade, dados possivelmente fora do Brasil, mesmo domínio para cookie. Contradiz duas promessas do escopo (backup diário de 30 dias; operação estável) e a frase "dados no Brasil" do plano. Decidir o provedor antes da fase 7.
6. **Domínio (médio).** Se a casa não tem domínio, escolher, registrar (registro.br, titular CNPJ/CPF) e propagar DNS. Sem ele não há publicação nem link final para o QR e a bio.
7. **Escopo cresceu além do plano (médio).** Itens do escopo sem tarefa no plano: mudar número de pessoas, oferta automática da lista de espera, caixa de novidades, rotina de backup, política de privacidade, plano B sem WhatsApp. Somam horas não previstas nos 18 dias.
8. **Dívidas do repositório (baixo).** `check-secrets` não pega valor entre aspas; testes de unidade fora do `npm test` e do hook; sem `.env.example`; sem CI (o plano conta com Lighthouse CI e `npm audit` no CI).
