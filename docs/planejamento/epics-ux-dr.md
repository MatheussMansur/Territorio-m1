# Requisitos de UX e design (UX-DR) · Território, módulo 1

> **Superado em 14/10.** Vale o PRD de 14/10 (`territorio/docs/planejamento/prds/prd-territorio-modulo-1-2026-10-14/`), a arquitetura (AD-1…AD-37) e a revisão geral (`territorio/docs/planejamento/revisao-2026-10-14.md`). Diferenças conhecidas: fontes Big Shoulders e Bangers → Oferta do Dia (títulos), Familjen Grotesk (interface) e Archivo (texto); reserva em 3 etapas → uma página que flui em `/reservar`; Entrar com Google fora → dentro do módulo 1; perfil do salão com senha → aparelho aprovado + PIN (últimos 4 dígitos do telefone); painel atualizado por consulta → tempo real por SSE (aviso do Postgres). Será refeito pelo processo de épicos e histórias a partir do PRD de 14/10.

Lista dos requisitos de interface que os épicos e histórias do módulo 1 precisam cobrir, além das funções (FR) do PRD. Cada UX-DR vira uma história ou entra como critério de aceite de uma.

**Fontes (valem as versões mais novas):** `docs/02-telas.md`; o site aprovado `territorio/site/index.html` e o fluxo aprovado `territorio/site/fluxo.html`; `territorio/docs/02-historico-de-versoes.md` e `territorio/docs/11-estado-2026-10-07.md`; o design system em `src/styles` (tokens e 13 folhas de componente), `src/components` e o catálogo `/_ds/`; o `README.md`; o PRD §5 e §8 (`prd-territorio-2026-10-07/prd.md`).

**Entrega** (PRD §5): **1** = site estático (FR-1, FR-5, FR-7, FR-8, FR-100); **2** = sistema; **3** = complementos (oferta automática, várias plantas e simulação, lista na porta, fotos das edições passadas). Um UX-DR com duas entregas diz o que vai em cada uma.

**Regras que valem para todos** (não repetidas em cada item): cor, fonte e medida só de `tokens.css` (o lint barra); texto de tela só em `src/lib/strings.js`; componente novo entra no `/_ds/` com todos os estados; todo teste de tela roda nos projetos computador e celular do Playwright, com axe.

## O que já existe (não refazer, só estender)

| Peça | Onde | Falta |
| --- | --- | --- |
| Tokens do tema (paleta da casa, Food Club, tipos, espaço, movimento) | `src/styles/tokens.css` | UX-DR1 a UX-DR5 |
| Botões, campos, aceite ("Li e tá combinado"), código (OTP), telefone | `button.css`, `field.css`, `otp.js`, `phone-field.js` | Estados do código e do telefone (UX-DR12, UX-DR13) |
| Pessoas (ladrilhos), dias (semana), horários (janela) com fechado, lotado, poucos e passado | `choice.css`, `choice-group.js` | Estados do dia e navegação de 30 dias (UX-DR9, UX-DR10) |
| Barra de progresso de 3 passos (`.steps`, só traços) | `receipt.css` | Etapas com nome e histórico (UX-DR7) |
| Comprovante, comprovante da espera, resumo, carimbo (selo) | `receipt.css`, `seal.js` | Variantes e compartilhar (UX-DR14) |
| Selos de status (os 9 do cliente + sem resposta e respondeu) | `badge.css` | — |
| Janela, janela lateral (drawer), confirmação | `dialog.js`, `confirm.js` | Janela de reserva (UX-DR6), senha de novo (UX-DR33) |
| Aviso, vazio, erro, carregando, faixa "sem internet" | `feedback.css` | Comportamento da faixa e "Tentar de novo" (UX-DR19) |
| Notificação (até 3, erro fica) | `toast.js` | Conflito 412 (UX-DR21) |
| Abas, tabela, números, feed, ticket | `tabs.js`, `data-table.css`, `stats.css` | Tabela no celular (UX-DR45), filtros (UX-DR27) |
| Planta: áreas e mesas (reservada, sentada, atrasada, liberar, livre, junção) | `floor.css` | 5 estados novos e ações (UX-DR2, UX-DR28) |

---

## A. Tokens e fundação

### UX-DR1 · Tokens dos estados de mesa que faltam
**Entrega:** 2 · **Fonte:** 02-telas "Estados de mesa no Salão"; `floor.css`
- Além dos 5 do aprovado (livre, reservada, sentada, atrasada, liberar), existem tokens e classes para: **guardada** (para quem chega sem reserva), **provisória** (pedido pendente), **oferecida** (esperando aceite da lista), **área fechada** e **área em lista** (noite de evento).
- Os novos usam só as cores da paleta da casa; cada estado se distingue também sem cor (traço, hachura, borda dupla ou rótulo curto), e o teste confere que a planta em escala de cinza ainda separa os 10 estados.
- A legenda do salão (`salao-chave` do aprovado) mostra todos os estados presentes na noite, e só eles.
- `/_ds/` "Planta do salão" mostra uma mesa em cada estado, redonda, quadrada e banqueta, e uma área fechada e uma em lista.

### UX-DR2 · Tokens dos estados do dia e do horário que faltam
**Entrega:** 2 · **Fonte:** 02-telas "Estados da reserva" 2 e 3; `choice.css`
- O dia tem estado e visual para: aberto, **últimos horários** (`few_left`), lotado (já existe, número riscado), **fechado com motivo** (produção, fechado, feriado, evento fechado, manutenção, com o motivo escrito no dia), **entrada livre** (evento sem reserva), **dia de evento** (com reserva ou lista), **fora da janela** e hoje (já existe).
- Nenhum estado depende só de cor: lotado risca, fechado hachura (já existe), últimos horários usa o canto terracota do aprovado, evento tem rótulo.
- O horário mantém os quatro da chave aprovada (tem mesa, últimas mesas, lotado · lista de espera, seu horário); horário passado ou a menos de 1 h **não aparece** (a classe `.is-past` sai do fluxo do cliente e fica só para o painel).

### UX-DR3 · Camadas e pontos de quebra num lugar só
**Entrega:** 1 (pontos de quebra) e 2 (camadas do painel) · **Fonte:** `tokens.css` (`--z-viga`, `--z-aviso`, `--z-demo`); `floor.css` (860 px); 02-telas "Navegação"
- Tokens de camada para: viga do site, barra inferior do painel, menu lateral, faixa "sem internet", janelas, notificações e barra de demonstração, numa ordem documentada (a faixa "sem internet" fica sobre a barra e sob as janelas; notificação fica sobre tudo, menos a barra de demonstração).
- Os pontos de quebra são só três, nomeados e documentados no `tokens.css`: celular (< 768), tablet (768 a 1023) e computador (≥ 1024), mais o caso "tablet em pé" por orientação. O 860 px atual da planta passa para um deles. Um teste do lint (ou uma busca no CI) falha se aparecer outro valor de `@media` de largura.

### UX-DR4 · Contraste conferido de cada par de tokens
**Entrega:** 1 · **Fonte:** PRD §8 Acessibilidade; `tokens.css`
- Uma tabela no `/_ds/` "Cores" lista cada par texto × fundo usado (papel, off white, kraft, ferro, noite, terracota, as folhas do cardápio e o Food Club) com a razão de contraste calculada; todo texto normal ≥ 4,5:1, texto grande e borda de controle ≥ 3:1.
- `--mescla`, `--lampada` e `--moeda` não são cor de texto: o lint barra o uso deles em `color`.
- Foco (`--cor-foco`) tem ≥ 3:1 contra papel, kraft e ferro; em superfície escura o anel usa a variante clara.

### UX-DR5 · Tipografia e acentos das fontes locais
**Entrega:** 1 · **Fonte:** README (`npm run fonts`); `fonts.css`
- Todas as fontes do site e do painel (Big Shoulders Display, Archivo, Nanum Pen Script com o recorte pt, IBM Plex Mono, Shojumaru, Chakra Petch, Bangers) carregam do próprio domínio, com `font-display: swap`, e `npm run fonts` confere ç, ã, õ, é, ê, á, í, ó, ú, à em cada uma.
- A letra de título sai do logo e do impresso da casa (letreiro, ramen, bebidas); o corpo é Archivo. Nenhum título usa outra família.
- A troca da fonte de reserva para a final não muda a altura da linha da capa a ponto de mover o botão "Reservar mesa" mais de 8 px (teste de captura da capa com e sem fonte).

---

## B. Componentes novos

### UX-DR6 · Janela de reserva (casca)
**Entrega:** 2 · **Fonte:** site `#reservaModal`, `.rsv`, `.rsv-lado`; fluxo 2 e 3; 02-telas "Reserva"
- Um componente só serve a janela da página inicial e a página `/reservar`: `<dialog>` com a viga (logo, "Reservar mesa", fechar), a coluna principal em papel e a coluna lateral em ferro com o progresso, o resumo (Dia, Horário, Pessoas) e o botão da etapa.
- Abre pelo botão da capa, pela viga (o botão fica no topo de todas as partes, como no fluxo 1) e por link pronto (`?pessoas=&dia=`, que já vêm escolhidos).
- Fechar com ×, Esc ou o voltar no primeiro passo devolve o foco ao botão que abriu; fechar com dados preenchidos na etapa "Quem vem" pede confirmação.
- **Entrega 1:** não existe janela de reserva. Os botões "Reservar" da capa e da viga são um link simples para o WhatsApp da casa (decisão do Matheus, 08/10). A janela nasce na entrega 2.

### UX-DR7 · Etapas da reserva com nome e histórico
**Entrega:** 2 · **Fonte:** 02-telas "Estados da reserva" (3 etapas, `?etapa=`); `.steps`; site `.progresso`
- As 3 etapas aparecem com nome: **Sua mesa**, **Quem vem**, **Comprovante**; o leitor de tela anuncia "Etapa 2 de 3, Quem vem" ao trocar, e o foco vai para o título da etapa.
- Cada etapa grava uma entrada no histórico (`?etapa=`). O voltar do celular e do navegador volta uma etapa sem perder o que foi escolhido; no Comprovante o histórico é trocado (`replaceState`) e o voltar não refaz a reserva nem reabre "Quem vem" (teste e2e).
- Abrir direto `?etapa=quem-vem` sem mesa escolhida leva a "Sua mesa".
- A etapa feita fica clicável para voltar; a próxima não.

### UX-DR8 · Seletor de pessoas com "9 ou mais"
**Entrega:** 1 e 2 · **Fonte:** fluxo 2 ("9+ chama no WhatsApp"); FR-9
- Ladrilhos de 1 até o máximo online do dia (8; o evento pode baixar, e os ladrilhos acima somem, não ficam desligados).
- O último ladrilho é "9 ou mais" e leva ao WhatsApp da casa com a mensagem pronta (ou ao pedido de grupo grande, se a casa escolher); ele é um link, não uma opção do grupo de rádio.
- Teclado: setas andam entre os ladrilhos (o `choice-group.js` atual), Tab sai do grupo.

### UX-DR9 · Calendário de dias da janela de 30 dias
**Entrega:** 2 · **Fonte:** site `#dias` (semana de 7); FR-10; UX-DR2
- Mostra a semana atual e anda por semana (anterior e próxima) até 30 dias à frente; as setas desligam nas pontas da janela.
- Cada dia mostra dia da semana, número e uma linha curta de estado (ex.: "últimos horários", "fechado · feriado", "entrada livre", "evento").
- Dia lotado leva à lista de espera (ou ao WhatsApp se a lista estiver desligada); dia fechado não é escolhível e diz o motivo ao leitor de tela; "nenhuma vaga nos próximos 30 dias" troca o calendário por um aviso com WhatsApp e Instagram.
- Os estados vêm da API; a tela nunca calcula vaga (teste com o mock: mudar a semente muda o dia sem mudar o front).

### UX-DR10 · Janela de horários com lista de espera
**Entrega:** 2 · **Fonte:** site `#janela` e `.chave`; fluxo 2; FR-11, FR-18
- Os horários aparecem como as vidraças da janela de ferro (o `.slots` atual), com a chave de 4 estados embaixo.
- Horário lotado mostra "lista de espera" e, ao ser escolhido, troca o botão da etapa para "Entrar na lista de espera".
- Ao trocar pessoas ou dia, os horários antigos esmaecem (`.is-dimming`) até a resposta chegar; resposta com mais de 300 ms mostra o carregando no lugar das vidraças, sem mudar a altura.
- A legenda "mesa por 2 horas" vem do tempo de mesa daquele dia e grupo.

### UX-DR11 · Combinados da casa
**Entrega:** 2 · **Fonte:** site `.combinados` (3 itens e "Li e tá combinado"); FR-12; 02-telas "Estados da reserva" 4
- Mostra os 3 combinados com os números daquele dia e grupo (tolerância, tempo de mesa, prazo de cancelamento), escritos como cuidado ("Vai se atrasar? Avisa a gente."), nunca como multa.
- "Continuar" fica desligado até marcar "Li e tá combinado"; tentar seguir sem marcar mostra o erro no próprio campo.
- Se os combinados mudam durante o preenchimento, a etapa volta a mostrá-los com o aceite desmarcado e um aviso do que mudou; a reserva guarda a versão aceita.

### UX-DR12 · Campo de código com reenvio e estados
**Entrega:** 2 · **Fonte:** fluxo 3; `otp.js`; 02-telas "Estados da reserva" 6; FR-15
- O campo de 6 dígitos já existe; falta: "Reenviar" desligado com contagem de 30 s, e os estados **enviado** (para qual número), **código errado** (tentativas restantes), **vencido** (10 min), **tentativas esgotadas** e **limite de 3 códigos por hora** (diz quando dá de novo).
- Colar o código inteiro preenche as 6 casas; o teclado do celular é numérico; `autocomplete="one-time-code"`.
- Cada estado tem texto em `strings.js`, anunciado pelo leitor de tela, e aparece no `/_ds/`.

### UX-DR13 · Telefone de três países e campo de restrição alimentar
**Entrega:** 2 · **Fonte:** `phone-field.js`; 02-telas "Estados da reserva" 5; FR-14
- O telefone aceita Brasil, Paraguai e Argentina; outro país mostra o aviso com o WhatsApp da casa, sem erro vermelho.
- O campo de restrição alimentar tem o aviso de dado de saúde junto (quem vê, quando apaga) e o link para `/privacidade`.
- A caixa "quero receber novidades da casa" vem desmarcada e não bloqueia o envio.

### UX-DR14 · Comprovante: variantes, compartilhar e agenda
**Entrega:** 2 · **Fonte:** fluxo 4 ("Tá reservado", "Pode entrar, Ana! A casa é sua."); `receipt.css`; FR-17, FR-19, FR-20
- Variantes: **confirmada** (com carimbo), **pendente** (sem carimbo, "Esperando a casa"), **lista de espera** (com a posição), **nome na lista do evento**.
- Código da reserva em mono (ex.: TR-4821), dia, horário, pessoas e tolerância ("tolerância até 20:45").
- "Compartilhar" usa o compartilhamento do aparelho e, sem ele, copia o link de leitura (com aviso "Link copiado"); o link compartilhado nunca cancela.
- "Pôr na agenda" baixa um `.ics` com o horário no fuso de São Paulo.

### UX-DR15 · Indicador "aberto agora"
**Entrega:** 2 (na entrega 1 os horários são fixos no texto) · **Fonte:** 02-telas Landing e Topo do painel; FR-2, FR-92
- Um componente para a capa e o topo do painel: **aberto agora**, **fechado** (com a próxima abertura: "Abre quarta às 19:00"), **exceção do dia** (feriado, evento, com o motivo).
- Usa a hora do servidor no fuso de São Paulo, não a do aparelho (teste com `?agora=`).

### UX-DR16 · Bloco "Hoje na casa"
**Entrega:** 2 (entrega 1: a faixa fixa "Toda quinta é dia de peixe fresco!" do aprovado) · **Fonte:** site `.quinta-cel`; 02-telas Landing; FR-3
- Mostra, nesta ordem de prioridade, um aviso com validade, o prato do dia (se a casa ligou a opção), a regra do dia da semana ou a próxima abertura; nunca fica vazio.
- Ligar o prato do dia no painel muda o bloco sem publicar o site de novo.

### UX-DR17 · Agenda do Território Convida
**Entrega:** 1 (eventos gravados), 2 (vindos de `/admin/eventos`) e 3 (fotos das edições passadas) · **Fonte:** 02-telas Landing; FR-4, FR-64
- Cartão de evento: data, nome, modo; com reserva leva a `/reservar?dia=`; fechado ou de entrada livre fica sem botão, com o rótulo.
- Edições passadas aparecem como fotos com texto alternativo (entrega 3); sem evento, a seção some inteira (não fica "nenhum evento").
- Os dois eventos do protótipo não entram como texto fixo na entrega 2.

### UX-DR18 · Selo "Atualizado às HH:MM"
**Entrega:** 2 · **Fonte:** 02-telas "Telas gerais do painel" (Desatualizado); FR-45, FR-48
- Em Hoje, Salão e Espera, um selo discreto mostra a hora da última atualização boa; atualiza sozinho a cada 30 s no máximo.
- Se a atualização falha, o selo fica em destaque (terracota) com "Atualizado às 20:41" e "Atualizar agora"; volta ao normal na próxima atualização boa.
- O leitor de tela só anuncia quando o selo muda para desatualizado.

### UX-DR19 · Faixa "sem internet" e "Tentar de novo"
**Entrega:** 1 (site) e 2 (painel e reserva) · **Fonte:** 02-telas "Telas gerais do site" e "do painel"; `.offline`; FR-8
- **Site:** sem internet, a ação (reservar, confirmar, cancelar) fica desligada no lugar, com "Tentar de novo"; com a API fora, aparece o WhatsApp da casa com a mensagem pronta.
- **Painel:** faixa fixa no topo enquanto o navegador está sem conexão; todo botão que muda dado fica desligado com o motivo no `title`/descrição; ler continua possível; a faixa some sozinha quando a conexão volta, e a tela atualiza.
- Teste e2e com `context.setOffline(true)` em reserva, Salão e lista na porta.

### UX-DR20 · Telas de erro gerais
**Entrega:** 1 (404 do site) e 2 (painel) · **Fonte:** 02-telas "Telas gerais"; FR-8, FR-95
- `/404.html`: voltar ao início ou reservar (na entrega 1, reservar = WhatsApp).
- Painel: sem sessão vai ao login e volta à tela pedida (só caminho interno; teste com caminho externo na volta); 403 "Essa parte é de outro papel" com caminho para Hoje; 404 com caminho para Hoje; erro da tela "Algo deu errado nesta tela" com recarregar e voltar.

### UX-DR21 · Aviso de conflito "Alguém mudou isso agora"
**Entrega:** 2 · **Fonte:** 02-telas (412); FR-45
- Quando a API responde 412, a ação não é refeita; aparece "Alguém mudou isso agora. Recarregar" junto do item (ou como notificação com ação, se o item saiu da tela), e o botão recarrega só aquele dado.
- Teste: duas abas mudando a mesma reserva; a segunda vê o aviso e nada se perde em silêncio.

### UX-DR22 · Casca do painel: topo
**Entrega:** 2 · **Fonte:** 02-telas "Navegação do painel" (Topo); FR-92
- O topo tem: aberto ou fechado agora (UX-DR15), relógio da casa, seletor de dia, busca rápida (UX-DR24), número de pendentes (dono e gerente) e o menu do usuário (Minha conta, Sair).
- Salão não vê pendentes. O relógio é o do servidor.
- Enquanto o cadastro da casa não terminou, gerente e salão veem a faixa "A casa ainda está sendo cadastrada".

### UX-DR23 · Menu lateral e barra inferior com "Mais"
**Entrega:** 2 · **Fonte:** 02-telas "Navegação do painel"; FR-95
- Computador e tablet deitado: menu lateral com Hoje, Reservas, Salão, Espera, Agenda, Eventos, Clientes, Plantas, Cardápio, Site, Galeria, Equipe, Registro e Configurações, mostrando só o que o papel pode abrir.
- Celular e tablet em pé: barra inferior com Hoje, Reservas, Salão e Mais; "Mais" abre uma folha com o resto, que fecha com Esc, toque fora e voltar.
- O item atual tem `aria-current="page"`; a barra respeita a área segura do iPhone e não cobre o último item da tela.

### UX-DR24 · Busca rápida
**Entrega:** 2 · **Fonte:** 02-telas Topo; FR-46, FR-93
- Busca por nome, telefone ou código, com resultado enquanto digita (após 2 caracteres, espera de 250 ms), em lista navegável por setas (padrão combobox do ARIA).
- Escolher um resultado abre `/admin/reservas?r=<id>`; sem resultado diz "Nada com esse nome, telefone ou código".
- Atalho de teclado `/` foca a busca no computador.

### UX-DR25 · Seletor de dia do painel
**Entrega:** 2 · **Fonte:** 02-telas Topo
- Troca o dia de Hoje, Reservas, Salão e Espera; mostra "hoje" destacado; dia fechado aparece com o motivo.
- O dia escolhido vai na URL e sobrevive ao recarregar.

### UX-DR26 · Ficha da reserva
**Entrega:** 2 · **Fonte:** 02-telas (`/admin/reservas?r=`); `.dialog--drawer`; FR-49 a FR-56, FR-93
- Janela lateral com nome, pessoas, horário, mesa, observação, restrição (só quem pode ver), status (selo), resposta ao lembrete, visitas e faltas.
- As ações aparecem conforme papel e estado: chegou, sentou, mesa vagou, não veio, mudar mesa, remarcar, cancelar com mensagem, aprovar ou recusar (com motivo).
- "Não veio" pede confirmação e diz que conta falta; "Mesa vagou" diz que não conta.
- A ficha abre por link e o voltar a fecha.

### UX-DR27 · Filtros da lista de reservas
**Entrega:** 2 · **Fonte:** 02-telas Reservas; FR-47, FR-57
- Filtros por dia, status, horário e "sem mesa", como chips que vão para a URL; "Limpar" volta ao padrão.
- Filtro sem resultado mostra o vazio com "Limpar filtros". Salão só vê hoje (os filtros de dia não aparecem).

### UX-DR28 · Mesa do salão com ações
**Entrega:** 2 · **Fonte:** site `#salao` ("Toque numa mesa para filtrar a lista"); `floor.css`; FR-48 a FR-53
- Tocar uma mesa a seleciona (`aria-pressed`) e filtra a fila ao lado; tocar de novo abre as ações daquela mesa (as da ficha, UX-DR26).
- Junção de mesas aparece com o selo de junção (S3+S4) e conta como uma mesa só.
- Cada mesa é um botão com nome acessível completo: "Mesa Q4, reservada, Thiago, 4 pessoas, 20:30".
- Quem chega sem reserva: "Sentar sem reserva" escolhe balcão ou mesa livre (ou guardada).

### UX-DR29 · Salão em lista por área (celular)
**Entrega:** 2 · **Fonte:** 02-telas "Por aparelho"; FR-48
- Abaixo de 768 px, a planta vira uma lista agrupada por área (salão, quintal, balcão), cada linha com mesa, estado (selo e texto), nome e horário, e as mesmas ações.
- Um botão "Ver planta" mostra a planta só para olhar; a lista é o padrão no celular.

### UX-DR30 · Editor de plantas
**Entrega:** 2 (uma planta, com junção) e 3 (várias plantas, planta padrão por dia da semana, planta de evento) · **Fonte:** 02-telas Plantas; FR-62, FR-63
- A partir de 768 px: criar área, pôr mesa (quadrada, redonda, banqueta), mudar lugares, mover por arrasto e por teclado (setas movem, Shift+setas movem mais), marcar mesas que juntam.
- Abaixo de 768 px, a tela só mostra a planta, com o aviso "Para editar, abra num tablet ou computador".
- Salvar uma planta em uso num dia com reserva pede a simulação (entrega 3) ou, na entrega 2, avisa quantas reservas ficam sem mesa antes de salvar.

### UX-DR31 · Simulação antes de mudar
**Entrega:** 2 (fechar dia com reservas) e 3 (simulação geral) · **Fonte:** 02-telas Agenda, Eventos, Configurações; FR-57, FR-60, FR-61
- Antes de uma mudança que mexe em reservas, uma janela lista quem é afetado (nome, horário, pessoas) e o que acontece com cada um.
- Fechar um dia só confirma depois que cada reserva da lista foi remarcada ou cancelada; o botão "Fechar o dia" fica desligado com o número de reservas que faltam.

### UX-DR32 · Calendário mensal da agenda
**Entrega:** 2 · **Fonte:** 02-telas Agenda; FR-59
- Mês a mês, cada dia com o plano (aberto, fechado com motivo, evento, planta usada), e reservas do dia em número.
- Clicar no dia abre o plano do dia para editar (dono e gerente) ou só ver (salão).
- Navegável por teclado em grade (setas, Home/End, PageUp/PageDown para mês).

### UX-DR33 · Pedir a senha de novo
**Entrega:** 2 · **Fonte:** 02-telas "Permissões por ação"; FR-75, FR-76, FR-77
- Exportar, mudar papel e apagar dados de cliente abrem uma janela de senha antes da ação; senha errada mostra o erro no campo; o bloqueio por tentativas vale aqui também.

### UX-DR34 · Telefone com dígitos escondidos
**Entrega:** 2 · **Fonte:** 02-telas (decisão 25); FR-73
- O telefone aparece como "(45) 9••••-0000"; dono e gerente têm "Ver o número", que mostra o número inteiro e grava no registro; o salão não tem o botão.

### UX-DR35 · Interruptor "Tem hoje" e barra de rascunho
**Entrega:** 2 · **Fonte:** 02-telas Cardápio e Site; FR-67, FR-68, FR-69
- Um interruptor (`role="switch"`) liga e desliga o prato na hora, com notificação de sucesso; o salão só vê esse controle.
- Nome, preço, ordem e categorias ficam em rascunho: uma barra fixa diz "Rascunho com N mudanças", com "Publicar" e "Descartar"; o Conteúdo do site tem "Versão anterior".
- Sair da tela com rascunho não publicado pede confirmação.

### UX-DR36 · Envio de foto com texto alternativo
**Entrega:** 2 · **Fonte:** 02-telas Galeria; FR-70
- Envio com barra de progresso ("Enviando"); o campo de texto alternativo é obrigatório antes de usar a foto; foto em uso mostra onde está e não pode ser apagada sem trocar.

### UX-DR37 · Cadastro da casa em 5 passos
**Entrega:** 2 · **Fonte:** 02-telas `/admin/primeiro-uso`; FR-83
- Usa as mesmas etapas com nome da reserva (UX-DR7), com "Passo salvo" ao avançar e uma lista do que falta no último passo; dá para sair e voltar onde parou.

### UX-DR38 · Linha da lista na porta
**Entrega:** 3 · **Fonte:** 02-telas `/admin/eventos/porta`; PRD §8 ("botões grandes na lista na porta"); FR-66
- Lista com busca por nome no topo (fixa ao rolar); cada linha: nome, tamanho do grupo, quantos já chegaram.
- Botões de chegada com pelo menos 56 × 56 px e 8 px entre eles; chegada de parte do grupo com − e + (ex.: 2 de 4); "Desfazer" por 10 s depois de cada chegada.
- Quem chega fora da lista: "Entrou sem estar na lista" se ainda houver lugar; o contador de lugares fica sempre à vista.
- Funciona com uma mão no celular em pé (teste a 360 × 740).

### UX-DR39 · Contagem do prazo da oferta
**Entrega:** 3 · **Fonte:** 02-telas `/espera?t=`, `/admin/espera`; FR-26, FR-39
- Contagem regressiva (mm:ss) do prazo da oferta, calculada a partir da hora do servidor; o leitor de tela anuncia só a cada minuto e no último minuto.
- Ao zerar, a tela troca para "oferta vencida" sem recarregar.

---

## C. Estados de cada tela

Cada tela tem carregando (esqueleto do tamanho final), vazio e erro, forçáveis por `?mock=lento`, `?mock=vazio` e `?mock=erro`. Os itens abaixo são os estados próprios e viram casos de teste e2e, um por estado.

### UX-DR40 · Estados da página inicial e do cardápio
**Entrega:** 1 (cardápio do build, horários fixos, 3D carregando ou indisponível) e 2 (aberto agora, Hoje na casa, agenda, "acabou") · **Fonte:** 02-telas `/` e `/cardapio`; FR-1, FR-6
- Sem a API (ou sem JavaScript), a página mostra o cardápio do momento da publicação e nada quebra (teste com JS desligado).
- O selo 3D da capa mostra o selo estático enquanto carrega e quando não há WebGL (`.sem3d`).
- Cardápio: prato "acabou" fica visível, riscado e com o rótulo; preço sem fonte aparece "a confirmar"; as abas do cardápio (`menu-abas`) e a folha (`menu-folha`) seguem o aprovado, com as folhas impressas da casa (ramen preta, bebidas em azulejo).
- `/cardapio` abre sozinho para o QR code das mesas, leve (sem vitrine nem 3D).

### UX-DR41 · Estados da reserva, etapa "Sua mesa"
**Entrega:** 2 · **Fonte:** 02-telas "Estados da reserva" 1 a 4 e 7
- Um caso de teste para cada estado de pessoas, dia, horário e combinados listados em UX-DR8 a UX-DR11, e para os três modos do dia de evento (reserva de mesa, entrada na lista com lugares restantes, só o aviso).

### UX-DR42 · Estados da reserva, envio e comprovante
**Entrega:** 2 · **Fonte:** 02-telas "Estados da reserva" 5, 6, 8 e 9; FR-17
- Um caso de teste para cada bloqueio do envio: enviando (botão com o giro e desligado), lotou enquanto preenchia (com alternativas de horário), reserva repetida, limite de reservas futuras, cliente bloqueado (mensagem neutra e WhatsApp da casa), combinados mudaram, sessão vencida (pede o código de novo, sem perder os dados), grupo acima do limite, aprovação a menos de 3 h (WhatsApp), sem internet, API fora.
- Toque duplo em "Confirmar reserva" cria uma reserva só (a tela manda a mesma chave de idempotência).
- Cada estado do comprovante (UX-DR14) tem o seu caso.

### UX-DR43 · Estados das páginas do cliente
**Entrega:** 2 (`/minhas-reservas`, `/r`, `/confirmar`) e 3 (`/espera`) · **Fonte:** 02-telas "Público"; FR-23 a FR-34
- `/minhas-reservas`: sem reservas; fora do prazo de cancelar; remarcar (dia, horário e pessoas) sem vaga diz que nada mudou; apagar meus dados pede confirmação e diz que cancela as reservas futuras; sessão vencida pede o código.
- `/r?t=`: os 9 status com os nomes da casa; link inválido ou vencido; com o link de leitura não há botão de cancelar; cancelar fora do prazo leva ao WhatsApp da casa.
- `/confirmar?t=`: Confirmo, Não vou mais (pede confirmação), Vou atrasar um pouco; já respondido mostra a resposta e deixa trocar até o horário; horário passado.
- `/espera?t=`: contagem (UX-DR39), aceitar, "Não vou conseguir", oferta vencida (leva a reservar outro horário), já aceita, recusada.
- Abrir qualquer link não muda nada sozinho: toda mudança pede um toque (teste: GET da página não chama escrita na API).

### UX-DR44 · Estados das telas de acesso
**Entrega:** 2 · **Fonte:** 02-telas login, primeiro acesso, convite, senhas; FR-79 a FR-82, FR-98
- Login: sessão expirada, conta desativada, bloqueio por tentativas (diz por quanto tempo).
- Primeiro acesso, convite e nova senha conferem o link antes do formulário (vencido ou já usado aparece no lugar do formulário); o convite mostra o e-mail e o papel antes de preencher.
- "Esqueci minha senha" dá sempre a mesma resposta.
- Minha conta: duas etapas ligada ou desligada; sessões abertas com "Encerrar".

### UX-DR45 · Estados das telas da noite
**Entrega:** 2 · **Fonte:** 02-telas Hoje, Reservas, Salão, Espera
- Hoje: nenhuma reserva hoje; casa fechada hoje; evento da noite com esperados e chegados; reservas sem mesa; desatualizado (UX-DR18); salão sem a semana e sem pendentes.
- Salão: sem reservas ("Sentar sem reserva"); casa fechada; sem internet (ações desligadas); todos os estados de mesa (UX-DR1).
- Espera: oferta em andamento; oferta vencida; oferecer à mão e transformar em reserva.
- A tabela de Reservas, no celular, vira linhas empilhadas (nome e horário em cima, selo e mesa embaixo), sem rolagem lateral.

### UX-DR46 · Estados das telas de planejamento e conteúdo
**Entrega:** 2 (3 para o que é da entrega 3) · **Fonte:** 02-telas Agenda a Configurações
- Agenda: mudança que mexe em reservas; fechar dia com reservas (UX-DR31). Eventos: lista cheia, evento fechado, duplicar evento passado, mudar evento num dia com reservas. Clientes: cliente anonimizado (sem nome nem telefone). Plantas: planta em uso; planta padrão (3). Cardápio e Site: rascunho, versão anterior. Galeria: enviando, foto em uso. Equipe: convite pendente, último dono (não pode sair nem perder o papel). Registro: dono vê tudo, gerente só as próprias ações. Configurações: mudança que afeta reservas feitas.
- Cada tela mostra para o papel só o que ele pode (ver, ver e anotar, ligar e desligar prato), conforme a tabela de 02-telas; um teste por papel abre cada tela e confere as ações visíveis.

---

## D. Responsivo

### UX-DR47 · Site no celular
**Entrega:** 1 · **Fonte:** site (capa-cel, `.quinta-cel`); prints `m-*`
- Sem rolagem lateral de 320 a 1440 px; margem lateral de 16 px no celular; a capa usa a foto do celular (`capa-cel`); o botão "Reservar mesa" cabe acima da dobra a 360 × 740.
- Texto não fica menor que 13,5 px (`--t-pequeno`) em lugar nenhum, exceto rótulos mono de 10,5 a 11,5 px.

### UX-DR48 · Janela de reserva no celular
**Entrega:** 1 e 2 · **Fonte:** prints `m-reserva`, fluxo 2 e 3
- No celular a janela ocupa a tela toda; a coluna de ferro vira uma barra de resumo fixa embaixo (Dia, Horário, Pessoas e o botão), que sobe com o teclado sem cobrir o campo em foco.
- No computador, a janela é centrada com as duas colunas, como em `d-reserva`.

### UX-DR49 · Painel por aparelho
**Entrega:** 2 (3 para a porta) · **Fonte:** 02-telas "Por aparelho"; PRD §8 "Celular primeiro"
- Teste em três tamanhos: 390 × 844 (celular), 820 × 1180 em pé e 1180 × 820 deitado (tablet do salão), 1440 × 900 (computador): navegação certa (UX-DR23), Salão em planta ou lista (UX-DR29), Plantas edita só a partir de 768 px (UX-DR30), lista na porta feita para o celular (UX-DR38).
- Alvo de toque mínimo de 44 px (`--alvo-toque`) em todo o painel.

---

## E. Acessibilidade

### UX-DR50 · axe sem violação em toda tela e estado
**Entrega:** 1 e 2 · **Fonte:** PRD §8; `tests/e2e/design-system.spec.js` (já roda axe com wcag2a, 2aa, 21aa, 22aa)
- O mesmo teste do `/_ds/` passa a rodar em cada página e em cada estado de C (carregando, vazio, erro e os próprios), no computador e no celular, com zero violação.
- Janela aberta, folha "Mais" aberta e notificação visível também são analisadas.

### UX-DR51 · Tudo pelo teclado, com foco visível
**Entrega:** 1 e 2 · **Fonte:** PRD §8; `base.css` (`:focus-visible`, `.skip-link`)
- Os fluxos de reserva, confirmar, cancelar, Salão (marcar chegada), lista na porta e editor de plantas são feitos só com teclado (teste e2e sem mouse).
- Janelas prendem o foco e devolvem ao botão que abriu; o link "Pular para o conteúdo" existe em todas as páginas; o foco nunca some atrás da viga ou da barra inferior (`scroll-margin`).
- Grupos de escolha usam um Tab só e setas dentro (padrão atual do `choice-group.js`).

### UX-DR52 · Erros por campo, em português
**Entrega:** 2 · **Fonte:** PRD §8; `field.css` (`.field__error`, `.form-errors`)
- Cada erro aparece junto do campo, ligado por `aria-describedby`, com `aria-invalid`, e diz como corrigir ("Falta o DDD", não "Inválido").
- Ao enviar com erro, o foco vai para o primeiro campo errado; com mais de um erro, o resumo no topo lista cada um com link para o campo.
- O erro só aparece depois de sair do campo ou de enviar, não enquanto digita.

### UX-DR53 · Leitor de tela nos fluxos principais
**Entrega:** 2 · **Fonte:** PRD §8 ("conferido com axe e com leitor de tela")
- Roteiro manual com NVDA (computador) e TalkBack (celular) para: reservar do começo ao comprovante, cancelar pelo link, marcar chegada no Salão e na porta; resultado registrado com data.
- Vagas que mudam, notificações e a troca de etapa são anunciadas por regiões vivas que existem antes da primeira mensagem (padrão do `toast.js`).

### UX-DR54 · Zoom e texto ampliado
**Entrega:** 1 e 2 · **Fonte:** WCAG 1.4.4 e 1.4.10
- Com zoom de 200% no computador e largura de 320 px, nada corta nem sobrepõe na página inicial, na reserva e em Hoje; a barra fixa de resumo não cobre mais de 25% da altura.

---

## F. Movimento e vitrine

### UX-DR55 · Regras gerais de movimento
**Entrega:** 1 e 2 · **Fonte:** `tokens.css` (durações e curvas); site (`prefers-reduced-motion` em cada animação)
- Toda animação usa `--dur-*` e `--ease-*`; com `prefers-reduced-motion: reduce`, entradas, parallax da capa, avanço sozinho e rolagem suave desligam, e a informação continua lá (teste com a emulação de movimento reduzido).
- No painel, o movimento só confirma ação (mesa que muda de estado, notificação); nada se mexe sozinho durante o serviço.
- Animação só de `transform` e `opacity`; nenhuma roda fora da tela (pausa por `IntersectionObserver`).

### UX-DR56 · Entrada da capa e selo 3D
**Entrega:** 1 · **Fonte:** site `.capa`, `.entra` (atrasos 0,5 a 1,22 s), `selo3d-fonte.js`
- A capa entra na ordem do aprovado (selo, rótulo, logo, "Pode entrar! A casa é sua!", texto, botões), em até 1,5 s no total; o botão de reservar é tocável desde o início.
- O selo 3D só carrega quando a capa está na tela e não atrasa a primeira pintura (LCP da capa ≤ 2,5 s em 4G simulado); sem WebGL fica o selo estático.

### UX-DR57 · Vitrine da lojinha no front novo
**Entrega:** 1 · **Fonte:** site `#lojinha` / `#varal` e o script da vitrine; 11-estado "Lojinha"; FR-5
- Os manequins (camiseta marinho e creme) e a ecobag no cabide de madeira ficam enfileirados no muro de tijolo: a da frente no meio, iluminada; as outras um passo atrás, menores e na sombra.
- Passam por arrasto (com embalo), pelas setas ‹ ›, pelas teclas ← → e pelo avanço sozinho a cada 7 s; a fila **para nas pontas** (cede um pouco no arrasto e volta).
- O avanço sozinho pausa com o ponteiro em cima ou o foco na seção, e não roda com movimento reduzido.
- "Ver as costas" vira as peças uma depois da outra (70 ms entre elas) e troca o texto para "Ver a frente"; Enter no palco faz o mesmo.
- O leitor de tela só anuncia as trocas que a pessoa pediu ("Ramen · creme, Camiseta · Território Food Club").
- Embaixo: etiqueta, nome, descrição, "preço a confirmar" (até ter fonte) e "Pedir pelo direct", que abre o Instagram da lojinha. Sem carrinho nem pagamento.
- A seção usa a paleta da casa (noite, papel, marsala); as cores do Food Club ficam só nas peças.

### UX-DR58 · Defeito da vitrine: tocar na peça não vira
**Entrega:** 1 · **Fonte:** 11-estado (o `setPointerCapture`)
- Hoje o `setPointerCapture` no `pointerdown` faz o `pointerup` chegar com o alvo no palco, então `e.target.closest(".vitrine-peca")` não acha a peça e o toque não vira. Correção: achar a peça pelo ponto do toque (`elementFromPoint`) ou capturar só depois de passar o limite de arrasto (6 px).
- Teste e2e no projeto celular: tocar na peça da frente vira para as costas; tocar numa peça do lado a traz para a frente; arrastar não vira.

### UX-DR59 · Defeito da vitrine: "pronto" antes das imagens
**Entrega:** 1 · **Fonte:** 11-estado (`varalPronto`)
- O sinal de pronto (`window.varalPronto`, ou o atributo que o substituir) só liga depois que todas as imagens da frente e das costas terminaram de carregar (`img.decode()`), para as capturas do PDF e os testes de imagem não saírem com peças em branco.
- Teste: com a rede lenta, o sinal não liga antes do `decode` de cada imagem.

### UX-DR60 · Defeito da vitrine: laço de animação sem fim
**Entrega:** 1 · **Fonte:** 11-estado; script da vitrine (`if (arrasto || pos !== alvo || (visivel && !calmo))`)
- Parada e na tela, a vitrine hoje pede quadro a cada 16 ms só para esperar o avanço sozinho. Correção: com a fila parada, o laço para e um temporizador acorda no próximo avanço.
- Teste: com a vitrine visível e parada por 3 s, nenhum `requestAnimationFrame` é chamado (contagem pelo `page.evaluate`).

### UX-DR61 · Defeito da vitrine: falta a imagem de reserva no HTML
**Entrega:** 1 · **Fonte:** 11-estado
- O palco já vem no HTML com a peça da frente como `<img>` real (com texto alternativo e tamanho), para quem não tem JavaScript, para o primeiro instante e se o script falhar; as peças hoje nascem do script com `alt=""`.
- Teste com JavaScript desligado: a lojinha mostra uma peça, o nome e "Pedir pelo direct".

### UX-DR62 · Limpeza do varal e imagens da vitrine
**Entrega:** 1 · **Fonte:** 11-estado ("sobraram arquivos em `site/img/varal/` e comentários do varal"; "pedir à Mixi os mockups em alta"); PRD §5
- Saem `site/img/varal/`, as classes `varal-*` e os comentários do varal que não servem mais (a vitrine fica com nomes próprios); nada do que sai é referenciado (teste: nenhum 404 de imagem).
- As peças passam pelo `npm run images` (AVIF, WebP, JPG, versões para celular e computador). Com os mockups em alta da Mixi, a peça da frente fica nítida a 2× numa tela de 1440 px; enquanto não chegam, a prancha de 738 px é a fonte e isso fica anotado como pendência da casa.
- As capturas da seção para o PDF (`pdf/shots/varal-*`) são refeitas da vitrine.

### UX-DR63 · Carimbo do comprovante
**Entrega:** 2 · **Fonte:** fluxo 4 (o comprovante é carimbado quando entra na tela)
- O carimbo do comprovante confirmado bate uma vez quando o comprovante aparece; pendente não tem carimbo; com movimento reduzido o carimbo já aparece colocado.

---

## G. Conferência com o aprovado

### UX-DR64 · Teste de imagem contra os prints aprovados
**Entrega:** 1 (capa, cardápio, lojinha) e 2 (reserva, comprovante, salão) · **Fonte:** PRD §8 ("a tela construída bate com o print"); `territorio/pdf/shots`; `site/fluxo.html`
- Cada print aprovado tem a tela construída correspondente, numa tabela no repositório: `d-capa`, `m-capa` → `/`; `d-cardapio`, `m-cardapio` → cardápio; `d-reserva`, `m-reserva`, `m-parte-1` a `5` → janela de reserva; `m-comprovante` → comprovante; `e-salao` → Salão; as telas do fluxo (1 a 5) → as mesmas.
- Testes de captura do Playwright com os mesmos tamanhos dos prints, dados fixos (`?agora=` e semente do mock), fontes carregadas e animações paradas; a diferença aceita é pequena e anotada, e cada diferença maior é defeito ou vira mudança aprovada registrada no histórico de versões.
- `e-comanda` e `e-cozinha` ficam fora (módulos futuros).

### UX-DR65 · Catálogo `/_ds/` como referência
**Entrega:** 1 e 2 · **Fonte:** README ("Componente novo entra no catálogo `/_ds/` com todos os estados")
- Todo componente de B entra no `/_ds/` com todos os estados, e o catálogo ganha captura de referência por seção, para pegar mudança sem querer num componente.
- O catálogo não vai para o build de produção.

---

## H. Conteúdo e tom

### UX-DR66 · Tirar da página inicial o que era da proposta
**Entrega:** 1 · **Fonte:** site aprovado (seções `#marca`, `#visual`, `#hoje`, `#mapa`, `#landing`, `#salao`, `#comanda`, `#cozinha`, `#plano`)
- A página inicial real tem: capa, Hoje na casa, cardápio, eventos, lojinha, localização e horários, rodapé (privacidade e Instagram). As seções que explicavam a proposta ficam fora.
- Saem também os textos de proposta: "Proposta de site e reservas · 28 set 2026", "Protótipo", "Fase 3", "A planta foi estimada pelas fotos" e "Entrar com Google" (fora do módulo 1).
- Teste: nenhuma dessas frases aparece no HTML publicado.

### UX-DR67 · Voz da casa e regra como cuidado
**Entrega:** 1 e 2 · **Fonte:** PRD §8 "Visual, conteúdo e tom"
- Regras de tolerância, cancelamento, falta e bloqueio são escritas como cuidado com quem espera, nunca como ameaça. Uma lista de palavras proibidas em `strings.js` para o cliente (multa, punição, penalidade, infração, "você foi bloqueado") é conferida por teste.
- Cliente bloqueado vê só uma mensagem neutra com o WhatsApp da casa.
- A voz é a da casa ("Pode entrar! A casa é sua!", "Tá de pé?", "Li e tá combinado"); nada de texto em outra língua como enfeite; nada de oferta que a casa não tem mais; nada que diminua a casa.

### UX-DR68 · Nomes de status para o cliente
**Entrega:** 2 · **Fonte:** 02-telas "Como o cliente vê cada status"; PRD §8
- O cliente vê só os nomes da casa: Confirmada, Esperando a casa, Na lista de espera, Abriu uma mesa, Foi, Cancelada, Não deu dessa vez, Venceu, Não veio. Os nomes da equipe (glossário) aparecem só no painel.
- Teste: cada um dos 9 status renderiza o rótulo certo em `/r`, `/minhas-reservas` e no comprovante.

### UX-DR69 · Todo fato com fonte, o resto "a confirmar"
**Entrega:** 1 · **Fonte:** PRD §8; site (`.menu-nota`, "preço a confirmar")
- Preço, horário, prato e peça da lojinha vêm de uma fonte anotada (legenda, destaque RANGOS ou o Marcus); o que não tem aparece "a confirmar", nunca um valor inventado.
- O conteúdo gravado da entrega 1 fica num arquivo de dados com a fonte de cada item ao lado.

### UX-DR70 · Data, hora e números no jeito daqui
**Entrega:** 1 e 2 · **Fonte:** fluxo ("qua 30/09 · 20:30", "TR-4821"); PRD §8 Tempo
- Datas e horas no fuso de São Paulo e em pt-BR: "qua 30/09", "20:30", "Abre quarta às 19:00"; preço "R$ 50"; telefone "(45) 99999-0000"; código da reserva em mono.
- Teste com o aparelho em outro fuso (Assunção, Buenos Aires): as horas mostradas não mudam.

### UX-DR71 · Visual sem fórmula genérica
**Entrega:** 1 e 2 · **Fonte:** PRD §8 ("papel e ferro" aprovado em 30/09); `tokens.css`
- Papel é a superfície, a esquadria de ferro é a grade, terracota é seleção e carimbo; nenhum cartão arredondado, sombra de cartão, botão dourado, texto dourado ou âmbar, nem palavra colorida em itálico fora do `<em>` do letreiro aprovado.
- Uma revisão visual por entrega confere cada tela nova contra essa regra antes de ir para a aprovação do Marcus.
