# Epic 1 Context: A equipe entra no painel com segurança

<!-- Compilado dos documentos de planejamento. Pode editar. Refazer quando os documentos mudarem. -->

## Goal

Dono e gerente entram no painel com e-mail, senha e verificação em duas etapas (TOTP). O dono aprova os aparelhos da casa, e a equipe entra neles com o nome e o PIN. O dono cuida da equipe, das sessões, do registro de ações e vê o estado do sistema. O épico também monta a base do painel: moldura, permissões numa fonte única, módulos que falham sozinhos, catálogo de erros e testes de contrato e de contraste. Tudo é feito na simulação (MSW seguindo o contrato OpenAPI), no repositório do front `territorio-app`. O servidor real vem no épico 8, sem mudar as telas.

## Stories

- Story 1.1: Casca do painel e menu por papel
- Story 1.2: Módulo que falha sozinho
- Story 1.3: Permissões numa fonte única e o teste
- Story 1.4: Testes simulação × contrato e de contraste
- Story 1.5: Mensagens de erro da casa, para qualquer falha
- Story 1.6: Primeiro acesso do dono e entrada com senha e verificação em duas etapas
- Story 1.7: Confirmar identidade para ações sensíveis e sair
- Story 1.8: Recuperar a senha e ver minhas sessões
- Story 1.9: Equipe: convidar, cadastrar quem entra só com PIN, desativar e mudar perfil
- Story 1.10: Aparelhos da casa: parear, aprovar e revogar
- Story 1.11: Aparelho que perde a chave ou está com o relógio errado
- Story 1.12: Entrar pelo PIN no aparelho da casa
- Story 1.13: Registro de ações
- Story 1.14: Sistema
- Story 1.15: Permissões por área, escolhidas pelo dono

## Requirements & Constraints

- Acesso pessoal (dono e gerente, qualquer aparelho, vale o perfil da pessoa) ou aparelho da casa (aprovado pelo dono, vale o perfil do aparelho).
- Senha de 12+ caracteres, recusada se vazada; TOTP obrigatório; códigos de recuperação de uso único. Erro sempre "E-mail ou senha não conferem". Sem cadastro público de equipe.
- Links de uso único: primeiro acesso do dono, convite (72 h), nova senha (30 min, resposta sempre igual). Senha nova encerra as outras sessões.
- Desativar nunca apaga; sempre há ao menos um dono ativo; perfil novo vale na próxima requisição.
- PIN = últimos 4 dígitos do telefone, só em aparelho aprovado. 5 erros travam 15 min e avisam o dono. Inatividade (15 min, de 5 a 60) pede o PIN de novo sem perder a tela.
- Ações sensíveis (exportar, mudar perfil, ver telefone completo, anonimizar, revogar aparelho) pedem senha e TOTP de novo; vale 5 min.
- Registro de ações: só o dono vê e exporta; ninguém edita nem apaga; segredo aparece como "trocado".
- O dono escolhe por perfil (gerente e recepção) as áreas do painel. O dono sempre tem tudo. A tela de permissões e as ações sensíveis ficam só com ele. O padrão vem do arquivo de permissões.
- O servidor decide e a tela só esconde. Na dúvida ou no erro, nega.
- Pronto = só `--cor-*` e `tokens.css`, WCAG 2.2 AA nos dois temas, alvos de 44 px, sem animação com "menos movimento", erros pelo catálogo, `npm run lint` e `npm run test:unit` passando, commit local.

## Technical Decisions

- Front em Vite + lit-html, JavaScript puro. Painel em `src/admin/`; código com estado da equipe em `features/`, com a regra de import do ESLint. Módulos carregam sob demanda.
- Contrato primeiro: rota nova entra em `docs/api/openapi.yaml` antes da tela, com handler e seed do MSW no mesmo commit. Só `src/services/api/` faz requisição.
- Permissões em `docs/api/permissoes.yaml` (operação → papéis, `<entidade>.<verbo>`), lido pelo menu e pelas checagens. Teste falha se faltar operação de equipe.
- Teste valida cada resposta simulada contra o schema do contrato (Ajv).
- `src/lib/errors.js` traduz todo `ApiError` (`ProblemType`, status e erros do aparelho) na mensagem do catálogo; teste falha se faltar mensagem ou língua.
- Cookies (da lista única): `__Host-trt_equipe` (30 dias com "manter conectado") e `__Host-trt_aparelho` (12 meses; corrigir `securitySchemes.deviceSession`). CSRF em toda escrita.
- Aparelho: chave ECDSA P-256 não exportável (WebCrypto, IndexedDB), código de 8 caracteres, `navigator.storage.persist()`. Cada requisição assinada com hora e nonce; relógio fora de ±5 min é recusado.
- Rotas novas: `POST /staff/auth/reauth`, `POST /staff/audit/export`, `GET /staff/system/status` (`SystemStatus`). Alertas `device_key_lost` e `pin_locked` em `GET /staff/dashboard`.
- Cenários da simulação: `?papel=` e `?mock=erro`.
- Padrões até a decisão: aparelho não assina com hora corrigida; só o dono aprova aparelho; confirmação pede sempre senha e código.

## UX & Interaction Patterns

- Menu lateral de 200 px em ferro com grão, raiz ao lado do logo. No celular, barra com Hoje, Reservas, Salão e Mais. Item fora do perfil não aparece e não abre pelo endereço (`forbidden`).
- Carregando: raiz girando devagar, sem esqueleto. Módulo com erro mostra o erro só na área dele, com "Tentar de novo".
- Cada erro aparece onde o catálogo manda (campo, aviso, diálogo ou tela), sempre com uma ação. Painel só em português.
- Turnstile na entrada, com a chave de teste gratuita.

## Cross-Story Dependencies

- 1.1 a 1.5 são a base; a 1.5 serve a todas. A 1.3 troca a lista de papéis da 1.1 pelo arquivo de permissões.
- A 1.6 entrega a entrada que a 1.1 só reserva. A 1.7 é usada por 1.9, 1.10 e 1.13.
- A 1.10 vem antes de 1.11 e 1.12; a 1.12 usa as pessoas só de PIN da 1.9; a 1.14 mostra o relógio dos aparelhos (1.11).
- A tela de aparelhos não depende das Configurações (o índice aponta para ela na 2.1). Os alertas do dashboard só ganham tela na 5.2.
