# Território · Inventário de funções do módulo 1

Extraído em 07/10/2026 de `docs/01-escopo.md`, `docs/02-telas.md`, `docs/05-decisoes.md` e `docs/10-escopo-modulo-1.md`. Quando os documentos discordam, vale o **10** (escopo assinável). Divergências estão marcadas com **[CONFLITO]**. Pontos que nenhum documento resolve estão marcados com **[LACUNA]**. Funções que só aparecem por dedução (por exemplo, a partir de um estado de tela) estão marcadas com *(inferida)*.

Abreviações das fontes: **01** = 01-escopo.md · **02** = 02-telas.md · **05** = 05-decisoes.md · **10** = 10-escopo-modulo-1.md. "D-n" = decisão n da tabela de decisões (05 e 10).

---

## 1. Visitante / cliente

### 1.1 Site público

| ID | Função | Quem usa | Tela / URL | Regra ou limite importante | Fonte |
| --- | --- | --- | --- | --- | --- |
| V01 | Ver a página inicial (capa, sobre a casa, cardápio, eventos, lojinha, localização, horários) | Visitante | `/` | 3D pode estar carregando ou indisponível; sem API, o cardápio exibido é o do build | 10 › Site; 02 › Público (`/`); 01 › O que entra |
| V02 | Ver se a casa está aberta agora, fechada ou com exceção do dia (feriado, evento) | Visitante | `/` | Calculado pela agenda e pelo horário da casa (D-8) | 02 › Público (`/`) |
| V03 | Ver "Hoje na casa" | Visitante | `/` (faixa) | Mostra a regra do dia, o prato do dia (se ligado no Cardápio, D-26), um aviso ou a próxima abertura | 10 › Site; 02 › Público (`/`); 05 D-26 |
| V04 | Ver a agenda do Território Convida (próximos eventos + fotos das edições passadas) | Visitante | `/` | Evento com reserva leva a `/reservar?dia=`; evento fechado ou de entrada livre fica sem botão; a seção some sem evento. Eventos vêm só de `/admin/eventos` (os dois do protótipo não migram como texto fixo) | 02 › Público (`/`) e nota após "Como o cliente vê cada status"; 10 › Site |
| V05 | Ver a lojinha (vitrine com as peças atuais) e pedir pelo direct do Instagram | Visitante | `/` (seção lojinha) | Sem pagamento; troca das peças é pedido ao suporte (dentro das 2 h/mês). **[CONFLITO]** a lojinha não aparece no mapa de telas (02) nem nos estados da landing, e o 01 só a cita em "O que fica para depois" | 10 › Site e Valores; 01 › O que fica para depois |
| V06 | Ver o cardápio sozinho (QR code das mesas) | Cliente na mesa / visitante | `/cardapio` | Estados: prato "acabou"; preço "a confirmar" (fato sem fonte fica "a confirmar") | 02 › Público (`/cardapio`); 01 › Regras de conteúdo |
| V07 | Ver localização e horários | Visitante | `/` | Horário padrão qua a sáb, a partir das 19h (D-8) | 10 › Site e D-8 |
| V08 | Ler a política de privacidade | Visitante | `/privacidade` | Quem guarda o quê, por quanto tempo, como pedir para apagar. Texto redigido pelo Matheus, publicado em nome da casa | 02 › Público; 10 › LGPD |
| V09 | Página não encontrada (voltar ao início ou reservar) | Visitante | `/404.html` | — | 02 › Público |
| V10 | Recuperar de falhas no site: sem internet ("Tentar de novo"), API fora (WhatsApp da casa com mensagem pronta) | Visitante | todas | Sucesso sempre mostra o que mudou e o próximo passo | 02 › Telas gerais do site |

### 1.2 Reserva (janela da landing e `/reservar`)

| ID | Função | Quem usa | Tela / URL | Regra ou limite importante | Fonte |
| --- | --- | --- | --- | --- | --- |
| V11 | Abrir a reserva em página própria ou por link pronto | Visitante | `/reservar?pessoas=&dia=` (link da bio) | 3 etapas: Sua mesa, Quem vem, Comprovante. Cada etapa grava histórico (`?etapa=`); no sucesso o histórico é trocado para o voltar não refazer a reserva | 02 › Público e Estados da reserva |
| V12 | Escolher número de pessoas | Visitante | `/reservar` etapa 1 | 1 até o máximo online do dia (8; evento pode baixar). "9 ou mais" vai ao WhatsApp da casa com mensagem pronta (ou ao pedido de grupo grande, se a casa escolher) | 02 › Estados 1; 10 D-5; 05 D-5 |
| V13 | Escolher o dia | Visitante | `/reservar` etapa 1 | Janela: de 30 dias antes até 1 h antes (D-7). Estados: aberto, últimos horários, lotado (lista de espera ou WhatsApp se a lista estiver desligada), fechado com motivo, entrada livre, fora da janela, nenhuma vaga em 30 dias (WhatsApp e Instagram) | 02 › Estados 2; 10 D-7 |
| V14 | Escolher o horário | Visitante | `/reservar` etapa 1 | Horário que já passou ou a menos de 1 h não aparece; estados: tem mesa, últimas mesas, lotado (lista de espera) | 02 › Estados 3 |
| V15 | Aceitar os combinados ("Li e tá combinado") | Visitante | `/reservar` etapa 1 | Mostra tempo de mesa (D-3), tolerância (D-2) e prazo de cancelamento (D-6) daquele dia e grupo. Se mudarem durante o preenchimento, são mostrados de novo | 02 › Estados 4 e 8 |
| V16 | Reservar em dia de evento: mesa, entrar na lista do evento, ou só ver o aviso | Visitante | `/reservar` | Conforme o modo do evento (D-14); lista mostra lugares restantes | 02 › Estados 7; 10 › Organização (eventos) e D-14 |
| V17 | Informar quem vem (nome, WhatsApp, restrição alimentar) | Visitante | `/reservar` etapa 2 | Telefone aceito: Brasil, Paraguai e Argentina (outro país vai ao WhatsApp da casa); aviso de dado de saúde no campo de restrição; link para a política de privacidade | 02 › Estados 5 |
| V18 | Confirmar o WhatsApp por código | Visitante | `/reservar` etapa 2 | Reenviar só depois de 30 s; máximo 3 códigos por hora; tentativas limitadas; código vence. Entrar com Google fica fora (D-11). **[CONFLITO]** o 10 diz que, sem a conta oficial do WhatsApp na publicação, a confirmação é pela página do site, mas não diz como o código de verificação chega nesse caso | 02 › Estados 6; 10 › Sobre o WhatsApp; 05 D-11 |
| V19 | Marcar "quero receber novidades da casa" | Visitante | `/reservar` (caixa separada da reserva) | Opcional, separada da reserva; forma a base do futuro módulo Clientes e WhatsApp. **[CONFLITO]** 05 D-29 diz "Fora da v1; o cliente só aceita a política de privacidade", e o 02 não mostra essa caixa | 10 › Reservas; 05 D-29 |
| V20 | Enviar a reserva (Confirmar) | Visitante | `/reservar` etapa 2 | Bloqueios: lotou enquanto preenchia (com alternativas), reserva repetida, limite de reservas futuras por telefone, cliente bloqueado (mensagem neutra + WhatsApp da casa), sessão vencida (pede código de novo), grupo acima do limite do dia ou do evento, pedido que precisaria de aprovação a menos de 3 h (vai ao WhatsApp), sem internet, API fora | 02 › Estados 8 |
| V21 | Receber o comprovante | Visitante | `/reservar` etapa 3 | Confirmada (com carimbo), pendente (sem carimbo, aguardando a casa), lista de espera (com posição), nome na lista do evento | 02 › Estados 9 |
| V22 | Entrar na lista de espera | Visitante | `/reservar` (dia ou horário lotado) | Se a lista estiver desligada, vai ao WhatsApp | 02 › Estados 2 e 3; 10 › Reservas |
| V23 | Compartilhar a reserva | Visitante | Comprovante | Compartilhar manda o link de **leitura**, que não cancela | 02 › Estados 9 e `/r?t=` |
| V24 | Grupo de 9 ou mais pelo WhatsApp da casa | Visitante | WhatsApp da casa (mensagem pronta) | Padrão do 10: de 9 em diante, pelo WhatsApp. Pedido de grupo grande para a casa aprovar é opção (05) | 10 D-5; 05 D-5; 02 › Estados 1 |
| V25 | Chegar sem reserva | Cliente na porta | (presencial; operado pelo salão em S-funções) | Balcão, se tiver lugar; balcão fica fora da reserva pelo site (D-4) | 10 D-4; 05 D-4 |

### 1.3 Links de ação e confirmação (vindos da mensagem)

| ID | Função | Quem usa | Tela / URL | Regra ou limite importante | Fonte |
| --- | --- | --- | --- | --- | --- |
| V26 | Ver a reserva por link, sem login | Cliente / quem recebeu o link | `/r?t=` | Link de leitura: só vê e compartilha. Estados: confirmada, pendente, na espera, mesa oferecida, recusada, cancelada, vencida, concluída; link inválido ou vencido | 02 › Público (`/r?t=`) |
| V27 | Cancelar pelo link de ação | Cliente | `/r?t=` (link da mensagem) | Só o link de ação cancela. Fora do prazo (D-6, 2 h) leva ao WhatsApp da casa | 02 › Público (`/r?t=`); 10 D-6 |
| V28 | Responder pelos botões do WhatsApp: "Confirmo", "Não vou mais", "Vou atrasar um pouco" | Cliente | WhatsApp | Textos das mensagens fixos (D-20, regra do sistema). "Não vou mais" vale a qualquer hora (libera a mesa) | 10 › Reservas, D-6 e D-20; 05 D-20 |
| V29 | Confirmar presença pela página (alternativa aos botões) | Cliente | `/confirmar?t=` | Já respondido: dá para trocar até o horário; "Não vou mais" pede confirmação; horário já passou. É também o canal principal se o WhatsApp oficial não estiver pronto na publicação | 02 › Público (`/confirmar?t=`); 10 › Sobre o WhatsApp |
| V30 | Avisar que vai atrasar e ganhar +10 min | Cliente | WhatsApp ou `/confirmar?t=` | Tolerância 15 min, +10 se avisar (D-2, D-22) | 10 D-2 e D-22 |
| V31 | Aceitar a mesa oferecida da lista de espera | Cliente na lista | `/espera?t=` | Dentro do prazo da oferta (contagem na tela); estados: já aceita, oferta vencida (a mesa foi para o próximo; leva a reservar outro horário) | 02 › Público (`/espera?t=`) |
| V32 | Recusar a mesa oferecida ("Não vou conseguir") | Cliente na lista | `/espera?t=` | A mesa passa ao próximo da lista | 02 › Público (`/espera?t=`) |

### 1.4 Área do cliente

| ID | Função | Quem usa | Tela / URL | Regra ou limite importante | Fonte |
| --- | --- | --- | --- | --- | --- |
| V33 | Entrar na área do cliente por código no WhatsApp | Cliente | `/minhas-reservas` | Sessão vence (pede o código de novo) | 02 › Público (`/minhas-reservas`) |
| V34 | Ver as próprias reservas | Cliente | `/minhas-reservas` | Estado "sem reservas"; rótulos de status: Confirmada, Esperando a casa, Na lista de espera, Abriu uma mesa, Foi, Cancelada, Não deu dessa vez, Venceu, Não veio | 02 › Público e "Como o cliente vê cada status"; 10 › Reservas |
| V35 | Remarcar a reserva | Cliente | `/minhas-reservas` | Até 2 h antes (D-6). Remarcar sem vaga: nada muda. **[CONFLITO]** o 05 D-6 só fala do prazo de **cancelar**; o 10 estende o prazo a remarcar e mudar pessoas | 10 › Reservas e D-6; 02; 05 D-6 |
| V36 | Mudar o número de pessoas | Cliente | `/minhas-reservas` | Só se houver mesa para o novo tamanho (D-27, regra do sistema); funciona como remarcação; até 2 h antes | 10 D-27 e D-6; 05 D-27; 02 |
| V37 | Cancelar a reserva | Cliente | `/minhas-reservas` | Até 2 h antes; fora do prazo mostra o estado próprio. O "Não vou mais" do lembrete vale a qualquer hora | 10 D-6; 02 |
| V38 | Baixar os próprios dados | Cliente | `/minhas-reservas` | — | 02 › Público (`/minhas-reservas`) |
| V39 | Apagar os próprios dados | Cliente | `/minhas-reservas` | Pede confirmação e cancela as reservas futuras | 02 › Público (`/minhas-reservas`); 10 › LGPD |

**Total visitante/cliente: 39 funções.**

---

## 2. Equipe (painel `/admin`)

Papéis: **dono**, **gerente** e **salão** (o tablet, conta compartilhada; tudo que é feito nele aparece como "Salão" no registro). Quem opera o painel é regra do sistema (10 D-12). Legenda: ✓ = pode · ver = só vê · parcial = descrito na coluna · — = não pode.

### 2.1 Acesso e conta

| ID | Função | Dono | Gerente | Salão | Tela / URL | Regra ou limite importante | Fonte |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E01 | Entrar com senha | ✓ | ✓ | ✓ | `/admin/entrar` | Sessão expirada; conta desativada; bloqueio por tentativas. Sem sessão, vai ao login e volta à tela pedida (só caminhos internos) | 02 › Painel; 10 › Organização |
| E02 | Criar a conta do dono (primeiro acesso) | ✓ | — | — | `/admin/primeiro-acesso?t=` | Link vencido ou já usado é conferido antes de preencher | 02 › Painel |
| E03 | Aceitar convite | — | ✓ | ✓ | `/admin/convite?t=` | Mostra e-mail e papel antes de preencher; convite vencido ou já usado | 02 › Painel; 01 › Pedido na abertura |
| E04 | Esqueci minha senha | ✓ | ✓ | ✓ | `/admin/recuperar-senha` | Resposta sempre igual (não revela se o e-mail existe) | 02 › Painel |
| E05 | Criar nova senha | ✓ | ✓ | ✓ | `/admin/nova-senha?t=` | Link vencido ou já usado conferido antes | 02 › Painel |
| E06 | Minha conta (incluindo verificação em duas etapas) | ✓ | ✓ | ✓ | `/admin/conta` | Duas etapas ligada ou desligada. **[CONFLITO]** duas etapas está no 02, mas não aparece no 10 | 02 › Painel |
| E07 | Cadastro da casa em 5 passos (primeiro uso) | ✓ | — | — | `/admin/primeiro-uso` | Passo salvo; itens faltando. Enquanto não termina, gerente e salão vão a Hoje com o aviso "A casa ainda está sendo cadastrada". É onde o Marcus responde as decisões na validação | 02 › Painel; 05 › intro |

### 2.2 Noite e reservas

| ID | Função | Dono | Gerente | Salão | Tela / URL | Regra ou limite importante | Fonte |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E08 | Ver Hoje (a noite, a semana, pendentes, reservas sem mesa, evento da noite com esperados e chegados) | ✓ | ✓ | parcial: só a noite, sem a semana e sem pendentes | `/admin/hoje` | Nenhuma reserva hoje; casa fechada hoje; desatualizado ("Atualizado às HH:MM") | 02 › Painel; 10 › Organização |
| E09 | Barra do topo: aberta/fechada agora, relógio, seletor de dia, busca rápida (nome, telefone ou código), pendentes, menu do usuário | ✓ | ✓ | ✓ (pendentes: [LACUNA], o salão não vê pendentes em Hoje) | todas do painel | Busca rápida abre a reserva em `/admin/reservas?r=<id>` | 02 › Navegação do painel |
| E10 | Ver e filtrar reservas (inclui filtro "sem mesa") | ✓ | ✓ | parcial: só hoje | `/admin/reservas` | Filtro sem resultado | 02 › Painel |
| E11 | Abrir uma reserva por link | ✓ | ✓ | parcial: só hoje | `/admin/reservas?r=<id>` | Busca rápida, Hoje, Clientes e o aviso de pendente levam para lá | 02 › Painel |
| E12 | Aprovar ou recusar pedido pendente | ✓ | ✓ | — | `/admin/reservas`, Hoje | Pendentes: quem já faltou 2 vezes e reserva de evento com aprovação (10 D-5). Recusa leva o motivo e o link para reservar outro horário (propor outro horário fica fora, D-28) | 02 › Permissões por ação; 10 D-5 e Fica fora |
| E13 | Resolver reservas que ficaram sem mesa *(inferida)* | ✓ | ✓ | ? [LACUNA] | Hoje, Reservas (filtro) | Surgem quando planta, agenda ou evento mudam | 02 › Hoje e Reservas |
| E14 | Remarcar ou cancelar a reserva de um cliente pela casa, com mensagem | ✓ | ✓ | ? [LACUNA] | `/admin/reservas`, `/admin/agenda` | Obrigatório antes de fechar um dia com reservas (D-23, regra do sistema) | 10 D-23; 05 D-23; 02 › Agenda |
| E15 | Salão ao vivo: ver mesas e estados (reservada, sentada, atrasada, liberar, livre, guardada, provisória, oferecida, área fechada, área em lista) | ✓ | ✓ | ✓ | `/admin/salao` | No celular vira lista por área; sem internet as ações ficam desligadas; casa fechada hoje | 02 › Painel e Estados de mesa; 10 › Painel do salão |
| E16 | Marcar chegada / sentar uma reserva *(inferida dos estados "sentada" e "atrasada")* | ✓ | ✓ | ✓ | `/admin/salao` | Atrasada após a tolerância (15 min, +10 se avisou) | 02 › Estados de mesa; 10 D-2 |
| E17 | Sentar sem reserva | ✓ | ✓ | ✓ | `/admin/salao` | Balcão, se tiver lugar (D-4); mesas guardadas (D-16); mesa de quem passou da tolerância fica para quem chega (D-24) | 02 › Salão; 10 D-4, D-16, D-24 |
| E18 | Liberar mesa *(inferida do estado "liberar")* | ✓ | ✓ | ✓ | `/admin/salao` | Tempo de mesa padrão 2 h (D-3) | 02 › Estados de mesa |
| E19 | Marcar "não veio" *(inferida do status `no_show`)* | ? | ? | ? | `/admin/salao` ou `/admin/reservas` | [LACUNA] nenhum doc diz quem marca nem se é automático; o status alimenta a regra "faltou 2 vezes" | 02 › status; 10 D-5 |
| E20 | Acompanhar a lista de espera e as ofertas | ✓ | ✓ | ✓ | `/admin/espera` | Oferta em andamento; oferta vencida | 02 › Painel |
| E21 | Trocar a planta da noite | ✓ | ✓ | — | `/admin/salao` ou Agenda | — | 02 › Permissões por ação |

### 2.3 Agenda, eventos e plantas

| ID | Função | Dono | Gerente | Salão | Tela / URL | Regra ou limite importante | Fonte |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E22 | Agenda mês a mês com o plano de cada dia (planta, horários, tempo de mesa, limite de chegadas, mesas guardadas, dia fechado) | ✓ | ✓ | ver | `/admin/agenda` | Limite de chegadas por horário: sem limite (D-17); mesas guardadas: nenhuma além do balcão (D-16) | 10 › Organização, D-16, D-17; 02 › Agenda; 05 D-16, D-17 |
| E23 | Ver a simulação antes de uma mudança que mexe em reservas | ✓ | ✓ | — | Agenda, Eventos, Configurações | Vale para plano do dia, publicar/mudar/apagar evento, horário, planta padrão e tempo de mesa | 02 › Agenda, Eventos, Configurações |
| E24 | Fechar um dia | ✓ | ✓ | — | `/admin/agenda` | O sistema não fecha dia com reserva ativa: a casa remarca ou cancela cada uma antes, com mensagem (D-23) | 10 D-23; 02 › Agenda |
| E25 | Cadastrar, publicar, mudar e apagar evento (com fotos das edições passadas) | ✓ | ✓ | ver | `/admin/eventos` | Simulação quando o dia tem reservas; estados: lista cheia, evento fechado | 10 › Site e Organização; 02 › Eventos |
| E26 | Escolher o modo do evento: reserva de mesa, lista na porta ou os dois | ✓ | ✓ | — | `/admin/eventos` | Evento por evento (D-14); padrão até escolher: reserva de mesa normal (05) | 10 D-14; 05 D-14 |
| E27 | Duplicar evento passado | ✓ | ✓ | — | `/admin/eventos` | — | 02 › Eventos |
| E28 | Lista na porta do evento: check-in | ✓ | ✓ | ✓ | `/admin/eventos/porta?evento=<id>` (feita para celular) | Busca por nome; chegada de parte do grupo; quem chega fora da lista entra se houver lugar; desfazer chegada | 10 › Organização; 02 › Eventos/porta e Permissões |
| E29 | Gerenciar várias plantas (Padrão, Sem quintal, Evento no quintal) | ✓ | ✓ | ver | `/admin/plantas` | Edita a partir de 768 px (celular só mostra); planta em uso em dia com reserva; planta padrão de um dia da semana | 10 › Organização e D-19; 02 › Plantas e Navegação |
| E30 | Cadastrar mesas por área e junção de mesas | ✓ | ✓ | ver | `/admin/plantas` | Padrão: S1–S6, Q1–Q8, B1–B6; S3 junta com S4. A planta real é cadastrada pelo Matheus antes de abrir | 10 D-1 e Entrega; 05 D-1 |
| E31 | Definir capacidade do quintal em evento com lista | ✓ | ✓ | ver | `/admin/plantas` | A casa informa (D-15); o modelo usa 40 só como exemplo | 10 D-15; 05 D-15 |

### 2.4 Site, cardápio e fotos

| ID | Função | Dono | Gerente | Salão | Tela / URL | Regra ou limite importante | Fonte |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E32 | Ligar/desligar prato ("tem hoje") e prato do dia | ✓ | ✓ | ✓ | `/admin/cardapio` | Vale na hora, sem publicar; prato do dia troca o "Hoje na casa" (D-26) | 02 › Cardápio; 10 D-26 |
| E33 | Editar o cardápio (nome, preço, ordem, categorias) e publicar | ✓ | ✓ | — | `/admin/cardapio` | Fica em rascunho até Publicar | 02 › Cardápio; 10 › Site |
| E34 | Editar o conteúdo do site (textos, avisos, regra do dia do "Hoje na casa") | ✓ | ✓ | — | `/admin/site` | Rascunho; versão anterior | 02 › Site; 10 › Site |
| E35 | Banco de fotos: subir e escolher onde cada foto aparece | ✓ | ✓ | — | `/admin/galeria` | Enviando; foto em uso | 10 › Site; 02 › Galeria; 01 › Pedido na abertura |

### 2.5 Clientes, equipe, registro e configurações

| ID | Função | Dono | Gerente | Salão | Tela / URL | Regra ou limite importante | Fonte |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E36 | Ver clientes | ✓ | ✓ | parcial: só os da noite | `/admin/clientes` | Cliente anonimizado aparece como estado próprio | 02 › Clientes |
| E37 | Anotar no cliente | ✓ | ✓ | — | `/admin/clientes` | — | 02 › Clientes ("ver e anotar") |
| E38 | Ver o telefone completo | ✓ | ✓ | — (vê mascarado) | Clientes, Reservas | Cada visualização fica no registro (D-25, regra do sistema) | 10 D-25; 02 › Permissões |
| E39 | Encontrar e apagar o cadastro de uma pessoa (pedido LGPD) | ? | ? | — | `/admin/clientes` | [LACUNA] o 10 exige; o 02 só mostra o estado "cliente anonimizado", sem dizer quem pode apagar | 10 › LGPD; 02 › Clientes |
| E40 | Exportar dados | ✓ | — | — | (não indicado) | Pede a senha de novo | 02 › Permissões |
| E41 | Equipe: convidar, ver convite pendente, desativar conta | ✓ | — | — | `/admin/equipe` | Não deixa ficar sem dono ("último dono") | 02 › Equipe; 01 › Pedido na abertura |
| E42 | Mudar o papel de alguém | ✓ | — | — | `/admin/equipe` | Pede a senha de novo | 02 › Permissões |
| E43 | Ver o registro de ações | tudo | só as próprias | — | `/admin/registro` | Cada ação registrada com quem fez; o tablet aparece como "Salão" | 02 › Registro; 10 › Organização |
| E44 | Configurações de reserva e horário (tolerância, tempo de mesa, quem chega sem reserva, grupo grande, prazos, janela, horário, hora do lembrete, +10 de quem avisa) | ✓ | ver | — | `/admin/configuracoes` | Mudança que afeta reservas feitas tem simulação antes. Padrões: D-2 a D-8, D-21, D-22 | 02 › Configurações; 05 coluna "Onde muda"; 10 › Decisões |

### 2.6 Comportamento geral do painel (todos os papéis)

| ID | Função | Quem | Regra | Fonte |
| --- | --- | --- | --- | --- |
| E45 | Navegação por aparelho: menu lateral (computador e tablet deitado), barra inferior com "Mais" (celular e tablet em pé) | Todos | Salão vira lista no celular; Plantas só edita a partir de 768 px | 02 › Navegação |
| E46 | Telas gerais: sem permissão (403 "Essa parte é de outro papel"), não encontrada (404), erro da tela, sem internet (faixa fixa, ações desligadas), desatualizado, "Alguém mudou isso agora" (412) | Todos | — | 02 › Telas gerais do painel |

### 2.7 Resumo por papel

**Dono** pode tudo (46 funções, E19 e E39 em aberto). É o único que: cria a conta pelo primeiro acesso, faz o cadastro da casa, gerencia a equipe e os papéis, exporta dados, vê o registro inteiro e altera as Configurações.

**Gerente** pode operar a noite, as reservas, a agenda, os eventos, as plantas, o cardápio, o site, as fotos e os clientes (ver, anotar e ver o telefone completo).
Não pode: fazer o cadastro da casa (E07), gerenciar a equipe nem mudar papéis (E41, E42), exportar dados (E40), alterar Configurações (só vê, E44), ver o registro dos outros (E43 só as próprias).

**Salão (tablet)** pode: entrar, aceitar convite, recuperar senha, Minha conta, Hoje (só a noite), Reservas (só hoje), Salão ao vivo (chegada, sentar sem reserva, liberar), Lista de espera, check-in na porta do evento, ligar/desligar prato e prato do dia, ver Agenda, Eventos e Plantas, ver os clientes da noite.
Não pode: aprovar ou recusar pendente, trocar a planta da noite, ver o telefone completo, editar agenda, eventos, plantas, cardápio (além de ligar/desligar), site, galeria, equipe, registro e configurações, nem exportar dados.

**Total equipe: 46 funções** (7 de acesso, 14 da noite e reservas, 10 de agenda/eventos/plantas, 4 de site/cardápio/fotos, 9 de clientes/equipe/registro/configurações, 2 gerais). Acesso por papel: dono 46 (2 em aberto) · gerente 39 (+2 em aberto) · salão 24, das quais 4 parciais e 5 só de ver (+3 em aberto).

---

## 3. Sistema (o que acontece sozinho)

| ID | Função | Gatilho | Regra ou limite importante | Fonte |
| --- | --- | --- | --- | --- |
| S01 | Enviar código de verificação pelo WhatsApp | Cliente reserva ou entra na área do cliente | 30 s para reenviar; 3 códigos por hora; tentativas limitadas; código vence | 02 › Estados 6 e `/minhas-reservas` |
| S02 | Calcular disponibilidade de dia e horário | Cliente abre a reserva | Janela 30 dias/1 h antes (D-7); tempo de mesa (D-3); limite de chegadas (D-17); mesas guardadas (D-16); junção de mesas; máximo online 8 (evento pode baixar); "últimos horários" | 02 › Estados 1–3; 10 D-3, D-7, D-16, D-17 |
| S03 | Confirmar a reserva automaticamente | Grupo até 8, sem regra de aprovação | Comprovante com carimbo | 10 D-5; 05 D-5 |
| S04 | Colocar a reserva em pendente e segurar a mesa provisória | Cliente que já faltou 2 vezes, reserva de evento com aprovação, pedido de grupo grande (se ligado) | A menos de 3 h, em vez de pendente, manda ao WhatsApp. **[CONFLITO]** o 05 D-5 não prevê pendência para quem faltou 2 vezes nem para evento | 10 D-5; 02 › Estados 8 e Estados de mesa; 05 D-5 |
| S05 | Bloquear reserva inválida | Envio da reserva | Reserva repetida, limite de reservas futuras por telefone, cliente bloqueado (mensagem neutra), grupo acima do limite, combinados mudaram. [LACUNA] quem bloqueia um cliente e onde não está descrito | 02 › Estados 8 |
| S06 | Enviar a confirmação pelo WhatsApp com botões | Reserva confirmada | Textos fixos, aprovados pela Meta (D-20). Cobrança por mensagem na conta da casa (~R$ 0,04) | 10 › Reservas, D-20 e Valores |
| S07 | Enviar o lembrete do dia com botões | 3 h antes de a casa abrir (16:00 numa noite que abre às 19:00) | Hora ajustável no painel (D-21) | 10 D-21; 05 D-21 |
| S08 | Processar a resposta do cliente | Botão no WhatsApp ou `/confirmar?t=` | "Confirmo" confirma; "Não vou mais" cancela e libera a mesa a qualquer hora; "Vou atrasar" dá +10 min (D-22); dá para trocar a resposta até o horário | 10 D-6, D-22; 02 › `/confirmar?t=` |
| S09 | Confirmar pela página do site quando o WhatsApp oficial ainda não está liberado | Meta não liberou a conta até a publicação | Mensagens pelo WhatsApp entram assim que a Meta liberar | 10 › Sobre o WhatsApp |
| S10 | Oferecer a mesa a quem está na lista de espera | Abre vaga (cancelamento, "Não vou mais", remarcação) | Oferta só antes do horário começar (05 D-24); contagem com prazo | 10 › Reservas; 02 › `/espera?t=`; 05 D-24 |
| S11 | Vencer a oferta e passar ao próximo da lista | Prazo da oferta acaba ou cliente recusa | O cliente vencido é levado a reservar outro horário | 02 › `/espera?t=` e `/admin/espera` |
| S12 | Aplicar a tolerância e marcar atrasada | 15 min após o horário (+10 se avisou) | Depois da tolerância, a mesa fica para quem chega (D-24, regra do sistema). **[CONFLITO]** ver C7 | 10 D-2, D-24; 02 › Estados de mesa |
| S13 | Enviar mensagem ao cliente quando a casa recusa, remarca ou cancela | Ação da casa (E12, E14, E24) | Recusa leva motivo + link para outro horário (D-28) | 10 D-23 e Fica fora; 05 D-28 |
| S14 | Impedir fechar um dia com reserva ativa | Tentativa de fechar dia | Regra do sistema (D-23) | 10 D-23 |
| S15 | Simular o impacto antes de mudanças | Agenda, evento, horário, planta padrão, tempo de mesa | Mostra quais reservas são afetadas | 02 › Agenda, Eventos, Configurações |
| S16 | Mudar status da reserva com o tempo (concluída, vencida, não veio) *(inferida)* | Fim da noite / prazo | [LACUNA] regras de quando vira `completed`, `expired` ou `no_show` não estão escritas | 02 › Status |
| S17 | Registrar cada ação do painel com o autor | Toda ação | Tablet aparece como "Salão"; ver telefone completo também é registrado | 10 › Organização e D-25; 02 › Permissões |
| S18 | Mascarar o telefone para o perfil do salão | Salão abre reserva ou cliente | Regra do sistema (D-25) | 10 D-25 |
| S19 | Proteger o login | Tentativas erradas; tempo | Bloqueio por tentativas; sessão expira; resposta sempre igual em "esqueci a senha"; links de convite/senha/primeiro acesso vencem e são de uso único | 02 › Painel |
| S20 | Separar link de leitura e link de ação | Envio de mensagem / compartilhar | Só o link de ação cancela; links vencem | 02 › `/r?t=` |
| S21 | Apagar os dados do cliente e cancelar as reservas futuras | Cliente pede em `/minhas-reservas` (ou casa pelo painel) | Cliente vira "anonimizado" | 02 › `/minhas-reservas` e Clientes; 10 › LGPD |
| S22 | Atualizar o "Hoje na casa" com o prato do dia | Prato do dia ligado no Cardápio | D-26 | 10 D-26; 05 D-26 |
| S23 | Calcular aberto/fechado/exceção e a próxima abertura | Agenda e horário | — | 02 › `/` |
| S24 | Atualizar o painel sozinho e avisar quando falha | Hoje, Salão | "Atualizado às HH:MM" | 02 › Telas gerais do painel |
| S25 | Detectar edição simultânea | Duas pessoas mudam o mesmo dado | "Alguém mudou isso agora. Recarregar" (412) | 02 › Telas gerais do painel |
| S26 | Cópia de segurança diária do banco (30 dias) e teste de restauração a cada 3 meses | Diário / trimestral | Coberto pela mensalidade | 10 › Valores e pagamento |

**Total sistema: 26 funções.**

---

## 4. Entrega e serviço (não são telas, mas fazem parte do módulo 1)

| Item | Regra | Fonte |
| --- | --- | --- |
| Publicação no domínio da casa com HTTPS | Front e API no mesmo domínio (`/api/v1`), painel em `/admin` | 10 › Entrega; 01 › Onde vai rodar |
| Planta real das mesas cadastrada pelo Matheus antes de abrir | A partir do que a casa informar | 10 › Entrega e D-1 |
| Noite simulada com a equipe antes de abrir | Aceite: a noite roda sem defeito que impeça reservar ou receber | 10 › Entrega e Etapas |
| 30 dias de correção de defeitos após a publicação | Defeito = diferente do 10 e das telas aprovadas | 10 › Entrega e Etapas |
| Mensalidade R$ 100/mês | Correções, atualizações, backup, acompanhamento, 2 h/mês de ajustes pequenos (ex.: trocar peças da lojinha) | 10 › Valores |
| Política de privacidade redigida | A casa revisa e publica em seu nome | 10 › LGPD |
| Validação das telas pelo Marcus com dados de teste | Aprovação por escrito; depois, mudança de layout é orçamento à parte | 10 › Etapas; 01 › Como vamos construir |

---

## 5. Fica fora do módulo 1

| O quê | Onde entra | Fonte |
| --- | --- | --- |
| Comanda, pedidos na cozinha (impressora ou tela) e gastos | Módulo Comandas (fase 2). **[CONFLITO]** o 01 põe a "tela da cozinha" na fase 3 | 10 › Fica fora; 01 › Depois; 05 D-13 |
| Financeiro | Módulo Financeiro (não estava na proposta) | 10 › Fica fora |
| Lista de clientes para novidades, aniversários e campanhas pelo WhatsApp | Módulo Clientes e WhatsApp (fase 3) | 10 › Fica fora; 05 D-29 |
| Histórico de visitas e convites para eventos | Fase 3 | 01 › Depois |
| Lojinha com pagamento | Fase 3 (no módulo 1: vitrine com "Pedir pelo direct") | 10; 01 |
| Sinal por Pix nas reservas e ingresso pago em evento | Outra conversa | 10; 05 D-9, D-18 |
| Propor outro horário ao recusar uma reserva | Outra conversa (no módulo 1 a recusa leva o link para outro horário) | 10; 05 D-28 |
| Almoço de sábado | Outra conversa (um horário de abertura por dia) | 10; 05 D-10 |
| Entrar com Google | Outra conversa (a reserva é pelo WhatsApp) | 10; 05 D-11 |
| E-mail para cliente | Só se a casa decidir | 01 › Depois (o 10 não cita) |
| Mudanças de layout depois da aprovação das telas e funções novas | Orçamento à parte | 10 › Fica fora |
| Decisões 9, 10, 11, 13, 18, 28 e 29 | Fica fora | 10 › Decisões |

---

## 6. O que a casa fornece

| Item | Observação | Fonte |
| --- | --- | --- |
| Respostas da tabela de decisões | Cada uma começa com um valor padrão | 10 › O que a casa fornece |
| Planta real das mesas | O Matheus cadastra | 10 |
| Cardápio e carta de bebidas finais, com preços | Hoje os preços sem fonte estão "a confirmar" | 10; 05 › Conteúdo que falta |
| Fotos em alta resolução da fachada, do salão, do quintal e dos pratos | — | 10; 05 |
| Dados para a política de privacidade (razão social, CNPJ, contato) | — | 10; 05 |
| Número de WhatsApp da casa para a conta oficial do WhatsApp Business | Verificação, migração do número e aprovação dos textos dependem da Meta (dias a semanas) | 10 › Sobre o WhatsApp |
| Domínio (ou a escolha de um novo) | — | 10 |
| Custos de uso: WhatsApp (Meta, cartão da casa, ~R$ 10–40/mês) e servidor/banco se sair do plano gratuito | Fora da mensalidade | 10 › Valores |
| Autorização para usar frases de clientes nos depoimentos | **[CONFLITO]** só o 05 pede; o 10 não lista depoimentos no site nem neste item | 05 › Conteúdo que falta |

O prazo de 8 semanas só começa a contar quando a casa entrega estes itens (10 › Etapas).

---

## 7. Conflitos e lacunas

| # | Tema | O que o 10 diz | O que os outros dizem | Fica valendo |
| --- | --- | --- | --- | --- |
| C1 | Caixa "quero receber novidades" | Entra no módulo 1, separada da reserva | 05 D-29: fora da v1, o cliente só aceita a política; 02 não mostra a caixa | 10: a caixa entra; 02 precisa ganhar o campo |
| C2 | Quem espera aprovação | Quem já faltou 2 vezes e reserva de evento com aprovação ficam pendentes | 05 D-5: automática até 8; aprovação só como opção para 9+ | 10 |
| C3 | Prazo de 2 h | Vale para cancelar, remarcar e mudar pessoas; "Não vou mais" vale a qualquer hora | 05 D-6: só cancelamento | 10 |
| C4 | Regra do sistema x ajuste | D-20, D-24, D-25 e D-27 são regra do sistema (mudança = pedido ao suporte) | 05 dá lugar no painel para mudar cada uma (Mensagens, Configurações › Reservas, Equipe) | 10: não criar controle no painel para essas |
| C5 | Mesa vaga depois do horário (D-24) | Mesa de quem passou da tolerância fica para quem chega | 05: mesa que vaga depois que o horário começou fica para quem chega; lista de espera só recebe oferta antes do horário | 10 para o gatilho; a regra do 05 sobre a lista não contradiz e pode ser mantida |
| C6 | Lojinha | Vitrine na página inicial com "Pedir pelo direct" | 02 não tem a seção na landing; 01 não a lista em "O que entra" | 10; 02 precisa ganhar a seção |
| C7 | Tela da cozinha | Módulo Comandas (fase 2) | 01: fase 3 | 10 |
| C8 | Horário de reserva | Qua a sáb, a partir das 19h | 05 D-8: reservas das 19:00 às 21:30 (a confirmar) | 10 sem horário final: confirmar com a casa |
| C9 | Quantidade de contas | Dono, gerente e o tablet | 05 D-12: um de cada; 02 prevê "último dono" (vários donos) | Indefinido |
| C10 | Itens só do 02/05 | Silencia sobre duas etapas na conta, e-mail para cliente e depoimentos | 02 tem duas etapas; 01 tira e-mail; 05 pede autorização de depoimentos | Confirmar se entram |
| C11 | Código sem WhatsApp | Sem a conta oficial, a confirmação é pela página do site | 02: reserva e área do cliente dependem de código pelo WhatsApp | [LACUNA]: falta dizer como o código chega |
| L1 | Quem apaga dados de um cliente no painel | O painel tem como encontrar e apagar | 02 só mostra o estado "anonimizado" | [LACUNA] |
| L2 | Quem marca "não veio" e quando a reserva vira concluída/vencida | — | 02 só lista os status | [LACUNA] |
| L3 | Quem bloqueia um cliente | — | 02 só mostra "cliente bloqueado" na reserva | [LACUNA] |
| L4 | Horários: conteúdo ou configuração | Horários estão no "conteúdo editável pela casa" | 02/05: Horários ficam em Configurações (só o dono edita) | Gerente edita horário? Confirmar |

---

## Contagem

| Ator | Funções |
| --- | --- |
| Visitante / cliente | 39 |
| Equipe (painel) | 46: dono 46, gerente 39, salão 24 (4 parciais, 5 só ver) |
| Sistema | 26 |
| **Total** | **111** |
