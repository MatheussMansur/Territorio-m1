---
title: 'História 1.1: Casca do painel e menu por papel'
type: 'feature'
created: '2026-10-15'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '275389a0514aa9014aae51e554eeaec3c12f6f45'
context:
  - '{project-root}/docs/planejamento/implementacao/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** O painel da equipe não existe: `/admin/` dá 404, inclusive pelo link "Área da casa" do rodapé, e não há moldura nem menu onde as próximas histórias possam entrar.

**Approach:** Criar o painel como aplicação própria em `src/admin/`, com roteador próprio, o trilho no computador e a barra inferior no celular. Uma sessão simulada (`?papel=dono|gerente|recepcao`) decide o menu. Sem sessão, aparece o lugar da entrada, que a 1.6 troca pela tela de verdade.

## Boundaries & Constraints

**Always:**
- Trilho de 200 px em ferro com grão (`--cor-escuro`, `--grao`), raiz em papel e logo no topo, item ativo em papel claro com barra terracota. Ordem e grupos: Hoje · Reservas · Salão · Espera · Agenda · Plantas · Eventos · Clientes / Site · Cardápio · Galeria / Equipe · Configurações · Registro · Sistema.
- Celular (abaixo de 768 px): barra inferior com Hoje, Reservas, Salão e Mais. "Mais" abre o resto dos itens do papel. Alvos de 44 px.
- Itens por papel nesta história. É o padrão de partida: a lista fica no código, a 1.3 a troca por `docs/api/permissoes.yaml` e, na 1.15, o dono passa a escolher as áreas de cada perfil (FR-82). O dono sempre tem tudo:
  - **dono:** todos;
  - **gerente:** todos menos Equipe, Registro e Sistema;
  - **recepção:** Hoje, Reservas, Salão, Espera e Cardápio (só para o "acabou" da 4.13).
- Endereço direto de item fora do papel mostra a tela `forbidden` do catálogo: "Essa parte é de outro perfil da equipe", "Se precisar, peça ao dono ou ao gerente." e o botão "Voltar ao Hoje".
- Cada área abre uma tela provisória com o título e "Esta parte chega nas próximas etapas.". Endereços: `/admin/` (Hoje), `/admin/reservas`, `/admin/salao`, `/admin/espera`, `/admin/agenda`, `/admin/plantas`, `/admin/eventos`, `/admin/clientes`, `/admin/site`, `/admin/cardapio`, `/admin/galeria`, `/admin/equipe`, `/admin/configuracoes`, `/admin/registro`, `/admin/sistema`.
- A sessão vem de `GET /staff/me` (contrato) pelo `src/services/api/`. Sem `?papel=` a simulação responde 401 `unauthorized`. O papel fica guardado na aba, como o `?mock=`. `?papel=sair` limpa a sessão simulada.
- O painel é só em português, segue o tema do aparelho, tem `noindex` e passa no axe AA nos dois temas. Com "menos movimento", nada se move. Só papéis `--cor-*` e medidas de `tokens.css`.

**Never:**
- Não fazer a tela de permissões por área (1.15) nem guardar escolha do dono nesta história.
- Não fazer a entrada de verdade (1.6), a lista de permissões em arquivo (1.3), o módulo que falha sozinho (1.2) nem o catálogo de erros no código (1.5).
- Não criar operação nova no contrato: `GET /staff/me` já existe.
- O código do painel não entra no pacote do site público; manter a regra de import do ESLint.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Sem sessão | `/admin/` sem `?papel=` | Lugar da entrada com o logo e "A entrada da equipe chega na próxima etapa." | 401 vira esse estado, não erro |
| Dono | `/admin/?papel=dono` | 15 itens, Hoje ativo | — |
| Recepção, item permitido | `/admin/salao?papel=recepcao` | Salão ativo | — |
| Recepção, item proibido | `/admin/configuracoes?papel=recepcao` | Tela `forbidden` com "Voltar ao Hoje" | Nenhum item do menu fica ativo |
| Endereço desconhecido | `/admin/xyz?papel=dono` | Volta para Hoje (`/admin/`) | — |
| API fora | `?papel=dono&mock=erro` | Aviso "Não deu para abrir o painel" com "Tentar de novo" | Nunca texto cru do servidor |

</frozen-after-approval>

## Code Map

- `src/site/pages/chrome.js:72` -- o rodapé já aponta para `/admin/`; não mudar.
- `vite.config.js` -- `findPages()` já pega `admin/index.html`. Falta mandar `/admin/*` para `admin/index.html` no `vite dev` e no `vite preview` (plugin pequeno no mesmo arquivo).
- `_ds/index.html` -- modelo de entrada HTML fora do `@site`: `head.html`, `noindex` e um script módulo.
- `src/app/boot.js` -- toda página começa por `boot()`, que liga a simulação e marca `html[data-ready]`.
- `src/mocks/scenario.js` -- `?mock=` e `?agora=` guardados na aba, com `problem()` e `respond()`. O `?papel=` segue o mesmo jeito.
- `src/mocks/handlers/index.js` -- juntar os handlers novos da equipe aqui.
- `src/services/api/auth.js`, `index.js` e `client.js` -- única porta de rede, com `ApiError`.
- `src/lib/html.js` -- lit-html (`html`, `render`, `classMap`).
- `src/styles/tokens.css` -- `--cor-escuro*`, `--grao`, `--terracota`, `--papel-claro`.
- `public/img/marca/raiz-mascara.webp`, e `.logo-letreiro` em `src/styles/site.css` -- raiz e logo do site; reaproveitar sem puxar o `site.css` inteiro.
- `eslint.config.js:29` -- regra que proíbe páginas públicas de importar o painel.
- `tests/e2e/site.spec.js` -- função `serious()` (axe que espera a troca de tema), modelo para o teste novo.

## Tasks & Acceptance

**Execution:**
- [x] `admin/index.html` -- entrada do painel: `head.html`, `noindex`, título "Território · Painel" e `/src/admin/main.js`.
- [x] `vite.config.js` -- `/admin/<área>` sem arquivo serve `admin/index.html` no dev e no preview.
- [x] `src/services/api/staff.js` e `index.js` -- `staff.me()` chama `GET /staff/me`.
- [x] `src/mocks/scenario.js` e `src/mocks/handlers/staff.js` -- `currentRole()` lê `?papel=`. O handler devolve um `User` do seed (Marcus, gerente, recepção) ou 401 `unauthorized`.
- [x] `src/admin/nav.js` -- lista única das 15 áreas (caminho, rótulo, grupo, papéis, se está na barra do celular), mais `itemsFor(role)` e `canOpen(role, path)`.
- [x] `src/admin/main.js` -- roteador por `history` (cliques internos sem recarregar, voltar do navegador). Monta trilho, barra, "Mais", tela da área, `forbidden`, entrada e erro.
- [x] `src/admin/admin.css` -- trilho, barra inferior, "Mais", área e telas de estado, só com tokens.
- [x] `tests/unit/admin-nav.test.mjs` -- itens por papel, `canOpen` e endereço desconhecido.
- [x] `tests/e2e/admin.spec.js` -- as linhas da matriz no computador e no celular, o "Área da casa" do rodapé abrindo o painel, e axe nos dois temas.

**Acceptance Criteria:**
- Given o computador (1440 px), when o painel abre com sessão, then o trilho tem 200 px, o item ativo tem `aria-current="page"` e o conteúdo usa o resto da largura.
- Given o celular, when toca "Mais", then abre a lista dos itens restantes do papel, com o foco preso. Esc ou tocar fora fecha e devolve o foco ao "Mais".
- Given qualquer tela do painel, when roda o axe nos dois temas, then não há violação séria nem crítica.

## Spec Change Log

## Review Triage Log

| # | Achado | Veredito | Evidência | Destino |
|---|--------|----------|-----------|---------|
| 1 | Foco volta ao "Mais" ao escolher área dentro dele | medium | `openDialog` foca o `opener` no evento `close`, que chega depois do foco no título | patch |
| 2 | 401 com o "Mais" aberto deixa `is-locked` | low | o diálogo some no novo `render` sem `close`; correção de uma linha | patch |
| 3 | Voltar/avançar do navegador não leva o foco ao título | low | o `popstate` só redesenha | patch |
| 4 | "Tentar de novo" deixa o foco no `body` | low | o botão some no redesenho | patch |
| 5 | Papel guardado na aba sem teste | medium | todos os testes passam `?papel=`; tirar o `session.set` não quebra nada | patch (teste) |
| 6 | "Tentar de novo" nunca clicado nos testes | medium | o teste só confere que o botão aparece | patch (teste) |
| 7 | Servidor de verdade sem regra para `/admin/*` | medium | só dev e preview têm o plugin | defer (nginx, Épico 10) |
| 8 | Regra do `vite preview` sem teste | low | não há teste de build/preview | defer |
| 9 | Mensagem de erro em branco | false | `ApiError.userMessage` sempre devolve texto do catálogo de strings | — |
| 10 | `/admin/` no sitemap | false | o sitemap só lista `seo.pages` indexáveis, e `/admin/` está em `private_prefixes` | — |
| 11 | Seed sem usuários dos três papéis | false | `src/mocks/seeds.js:291-293` tem dono, gerente e recepção ativos | — |
| 12 | `staff.me()` nulo derruba o painel | false | o contrato devolve 200 com `User`; 204 não acontece nessa rota | — |
| 13 | Papel fora do enum deixa o "Voltar ao Hoje" em laço | false | `Role` no contrato só tem `owner`, `manager` e `floor`; a 1.15 cuida de área tirada | — |
| 14 | `main.js` não lê as áreas liberadas do servidor | false | o plano manda usar o padrão nesta história; a 1.15 acrescenta | — |
| 15 | Clique no menu perde a query | low | o papel e o cenário ficam guardados na aba; uso diário não sente | rejeitado |
| 16 | `?papel=` com valor errado mantém o papel anterior | low | só na demonstração, com erro de digitação | rejeitado |
| 17 | Medidas fixas no CSS (200px, 112px…) | low | 200 px é do próprio plano; as demais são de desenho | rejeitado |
| 18 | Diálogo "Mais" no DOM do computador | low | escondido e inalcançável; sem efeito para quem usa | rejeitado |
| 19 | Regra do ESLint larga demais / pastas comuns fora | low | `src/pages/admin` não existe; as pastas comuns já eram assim antes | rejeitado |
| 20 | Faltam testes de menos movimento, gerente em Equipe e axe no Salão | low | coberto pela unidade (`canOpen`) e pelo axe nas outras telas | rejeitado |

## Implementation Notes

- Feito conforme o plano. Arquivos novos: `admin/index.html`, `src/admin/{main.js,nav.js,admin.css}`, `src/services/api/staff.js`, `src/mocks/handlers/staff.js`, `tests/unit/admin-nav.test.mjs`, `tests/e2e/admin.spec.js`. Ajustes: `vite.config.js` (plugin `adminRoutes`), `src/mocks/scenario.js` (`currentRole`), `eslint.config.js` (a regra de import passa a cobrir `src/pages/**` e `src/site/**` e barra `**/admin/**`).
- Fora do plano: `serious()` em `tests/e2e/site.spec.js` passou a esperar também a animação de entrada da capa, que fazia o axe do celular falhar às vezes (contraste medido no meio da animação).
- Os grupos do trilho ("A casa", "Site", "Gestão") são só rótulos para leitor de tela; nenhum documento dá nome a eles.
- O item ativo usa `--cor-escuro-texto` (papel), que fica claro nos dois temas.
- O painel usa o `head.html` comum, então segue o tema escolhido no site, se houver um guardado.
- No servidor de verdade, `/admin/*` precisa da mesma regra que manda para `admin/index.html` (nginx, Épico 10).
- Verificação: lint sem erro; 64 testes de unidade; 104 testes no navegador passando depois da revisão (2 pulados de propósito: cada um roda só no seu aparelho).

## Design Notes

A lista de `nav.js` é a única fonte do menu e de `canOpen`. Assim a 1.3 troca só a origem dos papéis, e a 1.15 só acrescenta as áreas liberadas da sessão. Por isso `itemsFor` e `canOpen` recebem as áreas liberadas, e não só o papel: nesta história elas vêm do padrão. As telas provisórias saem de uma função só, e cada história futura substitui a sua área.

## Verification

**Commands:**
- `npm run lint` -- sem erro.
- `npm run test:unit` -- tudo passa.
- `PW_CHANNEL=chrome npx playwright test` -- tudo passa, inclusive `admin.spec.js` nos dois projetos.
