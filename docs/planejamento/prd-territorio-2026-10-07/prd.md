---
title: Território · Módulo 1 (Site, Reservas e Organização da casa)
status: final
created: 2026-10-07
updated: 2026-10-07
---

# PRD: Território · Módulo 1

## 0. Para que serve este documento

Este é o mapa completo do módulo 1: cada função que o sistema tem, quem usa, e quem constrói ou fornece cada parte. Serve a três leitores:

- **Matheus**, para explicar o projeto ao Marcus e justificar o que está sendo construído;
- **quem constrói** (front-end, as telas; backend, o servidor e as regras), para não esquecer nenhuma função;
- **a arquitetura e a lista de tarefas**, que partem daqui.

Ele não repete os detalhes que já estão escritos. Quando uma regra tem muitos números, o PRD aponta para a fonte:

| Documento | O que tem |
| --- | --- |
| `docs/10-escopo-modulo-1.md` | O escopo que o Marcus assina. **Em conflito, ele manda.** |
| `docs/02-telas.md` | Todas as telas, URLs e estados |
| `docs/03-modelos.md` | Os dados |
| `docs/04-regras-reserva.md` | As regras da reserva, com os números |
| `docs/05-decisoes.md` | As 29 decisões da casa |
| `docs/api/openapi.yaml` | O contrato da API, ou seja, tudo o que as telas podem pedir ao servidor (104 operações) |
| `extract-*.md` (nesta pasta) | O inventário de 111 funções (agrupadas aqui em 99 FRs), as 129 regras e o estado da construção |

O que eu deduzi sem confirmação está marcado **[SUPOSIÇÃO]** e listado na seção 11.

## 1. Visão

O Território é um izakaya em Foz do Iguaçu que lota nas noites boas e vive de eventos. Hoje a reserva é pelo WhatsApp, na mão: alguém lê, responde, anota, lembra o cliente e descobre na hora quem não vem.

O módulo 1 tira isso da mão da equipe. O cliente reserva sozinho pelo site, em três passos, e recebe confirmação e lembrete no WhatsApp. Se a noite lota, ele entra numa lista de espera e recebe a mesa sozinho quando alguém desiste. A equipe abre o painel e vê a noite inteira: quem chega, quem atrasou, que mesa está livre. O dono planeja o mês, monta as plantas da casa para cada tipo de noite e cuida do site (cardápio, avisos, eventos) sem pedir a ninguém.

O site é o que a casa aprovou em 30/09 ("papel e ferro"), migrado sem redesenho. O sistema é a base para os próximos módulos (comandas, financeiro, clientes) entrarem sem refazer nada.

## 2. Quem usa

### 2.1 O que cada um precisa resolver

- **Cliente:** garantir a mesa sem esperar resposta, saber as regras antes de ir, e conseguir avisar que atrasa ou desiste sem constrangimento.
- **Equipe do salão (tablet):** saber, numa olhada, quem chega agora, quem está atrasado e onde sentar quem chega sem reserva.
- **Gerente:** preparar a noite e o mês, montar eventos, aprovar pedidos que precisam de olho humano.
- **Dono (Marcus):** controlar as regras da casa, a equipe e o site, e ter certeza de que nada é feito sem registro.
- **Matheus (operador):** manter tudo no ar, seguro e com cópia de segurança, dentro da mensalidade.

### 2.2 Quem não é atendido no módulo 1

- Cozinha e garçom tirando pedido (módulo Comandas).
- Quem quer pagar sinal ou ingresso online.
- Quem quer reservar o almoço de sábado.
- Quem reserva sem WhatsApp (o WhatsApp é o canal de verificação e de aviso). Telefone de fora do Brasil, do Paraguai e da Argentina também não reserva pelo site: a pessoa fala com o WhatsApp da casa, e a equipe lança a reserva (FR-91).

### 2.3 Jornadas

**UJ-1. Júlia reserva uma quinta para quatro pelo link da bio.**
Júlia vê o story do prato do dia e toca no link da bio, que abre `/reservar?pessoas=4`. Escolhe quinta (o dia mostra "últimos horários") e 20:30 (o horário mostra "últimas mesas"), lê as regras combinadas (2 h de mesa, 15 min de tolerância, cancelar até 2 h antes) e toca "Li e tá combinado". Informa nome, WhatsApp e "uma pessoa celíaca", recebe um código de 6 dígitos no WhatsApp e digita. O comprovante aparece com o carimbo da casa, e a confirmação chega no WhatsApp com o link para ver ou cancelar. **Caso-limite:** se a última mesa some enquanto ela preenche, a tela mostra os horários próximos que ainda têm mesa.

**UJ-2. Júlia avisa que vai atrasar.**
Na quinta, às 16:00, chega o lembrete: "Tá de pé?", com três botões. Ela toca "Vou atrasar um pouco". O painel mostra o aviso e a tolerância dela passa de 15 para 25 min. **Caso-limite:** se ela tocar "Não vou mais" às 20:00, depois do prazo de cancelar, a reserva é cancelada mesmo assim e a mesa vai para a lista de espera.

**UJ-3. Rafael entra na lista de espera e ganha a mesa.**
Sábado está lotado. Rafael entra na lista de espera para dois. Às 19:40 um casal cancela. O sistema oferece a mesa a Rafael pelo WhatsApp, com 10 minutos para aceitar. Ele toca no link, aceita, e a reserva vira confirmada. **Caso-limite:** se ele não responde em 10 min, a oferta vence e passa ao próximo da lista de espera.

**UJ-4. A equipe do salão opera a noite no tablet.**
Às 19:00, a pessoa do salão abre Hoje no tablet: 14 reservas, 2 atrasadas. Uma família chega sem reserva; o Salão ao vivo mostra que o balcão tem 3 lugares, e ela senta a família ali. Quem passou do horário aparece como "atrasada"; quem passou da tolerância e não chegou, ela libera com "não veio", e a mesa fica para quem chega. O telefone dos clientes aparece com dígitos escondidos.

**UJ-5. A gerente prepara um mês com evento.**
A gerente abre a Agenda de novembro, marca a sexta 13 como "Evento no quintal" com a planta do evento, e cria o evento do Território Convida com lista na porta para 40 pessoas. Antes de salvar, o sistema simula e mostra que 3 reservas daquela sexta perdem a mesa; ela remaneja as três, e os clientes recebem mensagem. No dia, ela faz o check-in pelo celular na porta.

**UJ-6. Marcus põe a casa no ar.**
Marcus recebe o link de primeiro acesso, cria a conta de dono e passa pelo cadastro da casa em 5 passos, respondendo as decisões (tolerância, tempo de mesa, horários). Convida a gerente e cria o acesso do tablet do salão. Liga o prato do dia no cardápio, e o "Hoje na casa" do site muda na hora.

## 3. Glossário

Use estes termos sempre, sem sinônimos.

- **Casa** — o Território. O sistema já guarda tudo por casa, para servir outras no futuro.
- **Noite** — um dia de funcionamento. O que passa da meia-noite pertence à noite anterior.
- **Reserva** — o pedido de mesa de um cliente para uma noite e um horário. Estados: pendente, confirmada, na lista de espera, oferecida, recusada, vencida, cancelada, concluída, não veio.
- **Marcações da noite** — por cima de uma reserva confirmada: **atrasada** (passou do horário, ainda dentro da tolerância), **passou da tolerância**, **sem resposta** (não respondeu o lembrete), **sentada**.
- **Não veio** — reserva confirmada que passou da tolerância sem chegar. Conta uma falta para o cliente. Diferente de **mesa vagou**, quando o grupo foi embora, que não conta falta.
- **Pendente** — reserva que espera a casa aprovar. Segura uma mesa provisória.
- **Lista de espera** — fila de quem quer uma noite ou horário lotado.
- **Oferta** — a mesa que abriu e foi oferecida ao primeiro da lista de espera, com prazo de 10 min.
- **Regras combinadas** — o que o cliente aceita ao reservar: tempo de mesa, tolerância e prazo de cancelamento daquela noite.
- **Tolerância** — quanto tempo depois do horário a mesa espera. 15 min, ou 25 se o cliente avisou.
- **Planta** — o desenho das mesas por área (salão, quintal, balcão) e quais se juntam. A casa tem várias: Padrão, Sem quintal, Evento no quintal.
- **Plano do dia** — a configuração de uma noite: planta, horários, tempo de mesa, limite de chegadas, mesas guardadas, dia fechado.
- **Evento** — noite especial (Território Convida). Modo: reserva de mesa, lista na porta, ou os dois.
- **Lista na porta** — os nomes de um evento, conferidos na entrada (check-in).
- **Painel** — a parte do sistema para a equipe, em `/admin`.
- **Papel** — o que cada conta pode fazer: **dono**, **gerente** ou **salão**. O salão é a conta compartilhada do tablet.
- **Registro** — a lista de quem fez o quê no painel.
- **Código da reserva** — o identificador curto de cada reserva, que aparece no comprovante e na busca do painel.
- **Código de verificação** — 6 dígitos enviados pelo WhatsApp para confirmar que o número é do cliente.
- **Link de leitura** — link da reserva que só mostra, e que o cliente pode compartilhar.
- **Link de ação** — link da reserva que confirma, cancela ou aceita oferta. Vai só para o próprio cliente.
- **Hoje na casa** — faixa da página inicial com o prato do dia, a regra do dia ou um aviso.
- **Lojinha** — vitrine das peças da casa no site, com o botão para pedir pelo direct do Instagram.
- **Banco de fotos** — as fotos que a casa sobe no painel e escolhe onde aparecem no site.
- **Decisão da casa** — cada uma das escolhas de funcionamento. São 29 ao todo; 22 estão no módulo 1. Cada uma é **ajuste no painel** (a casa muda) ou **regra do sistema** (muda por pedido ao suporte; não ganha controle no painel). Regras do sistema: 12 (quem opera o painel), 20 (resposta ao lembrete e textos), 23 (dia fechado com reservas), 24 (mesa de quem passou da tolerância), 25 (telefone escondido para o salão), 27 (cliente muda o número de pessoas).

## 4. Funções

Cada função tem um número (FR-n) que não muda. A coluna "Constrói" diz quem faz: **F** = front-end, **B** = backend, **M** = Matheus (contas, configuração, conteúdo técnico), **C** = a casa.

### 4.1 Site público

A página inicial apresenta a casa e leva à reserva. Funciona mesmo se o navegador não rodar JavaScript: o conteúdo já vem gravado na página quando o site é publicado, como no plano de construção. É atualizada pelo painel. O visual é o "papel e ferro" aprovado (ver §8). Realiza UJ-1 e UJ-6.

| FR | Função | Quem usa | Constrói |
| --- | --- | --- | --- |
| FR-1 | Ver a página inicial: capa, sobre a casa, cardápio, eventos, lojinha, localização e horários | Visitante | F |
| FR-2 | Ver se a casa está aberta agora, fechada, ou com exceção do dia, e a próxima abertura | Visitante | F, B |
| FR-3 | Ver o "Hoje na casa" (prato do dia, regra do dia ou aviso) | Visitante | F, B |
| FR-4 | Ver a agenda de eventos (próximos e fotos das edições passadas); evento com reserva leva à reserva daquele dia | Visitante | F, B |
| FR-5 | Ver a lojinha e pedir uma peça pelo direct do Instagram | Visitante | F |
| FR-6 | Ver o cardápio sozinho (QR code das mesas), com prato que acabou e preço "a confirmar" | Cliente na mesa | F, B |
| FR-7 | Ler a política de privacidade | Visitante | F, M (texto), C (revisa) |
| FR-8 | Recuperar de falhas: página não encontrada, sem internet ("Tentar de novo"), sistema fora do ar (WhatsApp da casa com mensagem pronta) | Visitante | F |
| FR-100 | Na entrega 1, antes do sistema: tocar "Reservar" e abrir o WhatsApp da casa (link simples, sem formulário nem tela de reserva) | Visitante | F |

**Consequências testáveis:**
- FR-1: sem a API, a página mostra o cardápio do momento da publicação, e nada quebra.
- FR-3: ligar o prato do dia no painel muda o "Hoje na casa" sem publicar de novo. A casa escolhe se o prato do dia aparece no "Hoje na casa" (decisão 26, ajuste no painel).
- FR-5: a lojinha não tem carrinho nem pagamento. Trocar as peças é pedido ao suporte. **[SUPOSIÇÃO]** As peças ficam gravadas no site, sem cadastro no painel, porque o contrato da API não tem lojinha.

### 4.2 Reserva

Três passos: **Sua mesa** (pessoas, dia, horário, regras combinadas), **Quem vem** (nome, WhatsApp, código) e **Comprovante**. Abre como janela na página inicial ou em `/reservar`, inclusive com link pronto (`?pessoas=&dia=`). O sistema calcula as vagas; a tela nunca calcula. Realiza UJ-1 e UJ-3.

| FR | Função | Quem usa | Constrói |
| --- | --- | --- | --- |
| FR-9 | Escolher o número de pessoas (1 a 8 online; evento pode baixar). 9 ou mais vai ao WhatsApp da casa com mensagem pronta | Visitante | F, B |
| FR-10 | Escolher o dia dentro da janela (até 30 dias à frente, até 1 h antes), vendo aberto, últimos horários, lotado, fechado com motivo, entrada livre | Visitante | F, B |
| FR-11 | Escolher o horário, vendo os que têm mesa, últimas mesas e lotados | Visitante | F, B |
| FR-12 | Ler e aceitar as regras combinadas da noite e do tamanho do grupo | Visitante | F, B |
| FR-13 | Reservar em noite de evento conforme o modo: mesa, nome na lista, ou só o aviso | Visitante | F, B |
| FR-14 | Informar nome, WhatsApp (Brasil, Paraguai, Argentina) e restrição alimentar, com aviso de dado de saúde | Visitante | F, B |
| FR-15 | Confirmar o WhatsApp com o código de verificação | Visitante | F, B, M (conta Meta) |
| FR-16 | Marcar a caixa opcional "quero receber novidades da casa" | Visitante | F, B |
| FR-17 | Enviar a reserva e receber o comprovante: confirmada (com carimbo), pendente, na lista de espera (com posição) ou nome na lista do evento | Visitante | F, B |
| FR-18 | Entrar na lista de espera quando a noite ou o horário estão lotados | Visitante | F, B |
| FR-19 | Compartilhar a reserva pelo link de leitura | Visitante | F, B |
| FR-20 | Adicionar a reserva à agenda do celular (vem do plano de construção, não do escopo) | Visitante | F, B |

**Consequências testáveis:**
- FR-12: se as regras mudam enquanto o cliente preenche, elas aparecem de novo para aceitar. A reserva guarda a versão aceita.
- FR-15: reenviar o código só depois de 30 s; no máximo 3 códigos por hora por número; o código vence em 10 min e aceita 5 tentativas.
- FR-16: a caixa vem desmarcada e não é condição para reservar.
- FR-17: o envio é bloqueado com mensagem clara quando: lotou enquanto preenchia (mostra alternativas), reserva repetida, mais de 2 reservas futuras no mesmo telefone, cliente bloqueado (mensagem neutra e WhatsApp da casa), grupo acima do limite, pedido que precisaria de aprovação a menos de 3 h.
- FR-17: enviar duas vezes a mesma reserva (toque duplo, internet ruim) cria uma reserva só.

### 4.3 Mensagens e links do cliente

O WhatsApp é o canal com o cliente. Cada mensagem traz um link: o de ação, só para o cliente, e o de leitura, para compartilhar. Abrir um link nunca muda nada sozinho, porque o próprio WhatsApp abre o link para montar a prévia. Realiza UJ-1, UJ-2 e UJ-3.

| FR | Função | Quem usa | Constrói |
| --- | --- | --- | --- |
| FR-21 | Receber a confirmação (ou o aviso de pendente) com o link de ação | Cliente | B, M (textos aprovados na Meta) |
| FR-22 | Receber o lembrete no dia (3 h antes de a casa abrir) com os botões "Confirmo", "Não vou mais", "Vou atrasar um pouco" | Cliente | B, M |
| FR-23 | Responder pela página `/confirmar` em vez dos botões, e trocar a resposta até o horário | Cliente | F, B |
| FR-24 | Ver a reserva pelo link de leitura, com o estado atual | Cliente ou quem recebeu o link | F, B |
| FR-25 | Cancelar pelo link de ação até 2 h antes; depois disso, a tela leva ao WhatsApp da casa | Cliente | F, B |
| FR-26 | Aceitar ou recusar a mesa oferecida da lista de espera, com contagem do prazo | Cliente na lista | F, B |
| FR-27 | Receber mensagem quando a casa recusa, remarca, cancela ou muda a mesa ou o horário | Cliente | B |

**Consequências testáveis:**
- FR-22: "Não vou mais" cancela a qualquer hora, mesmo depois do prazo de 2 h, e libera a mesa. "Vou atrasar um pouco" soma 10 min à tolerância.
- FR-22: reserva feita depois do envio do lembrete não recebe lembrete.
- FR-24: o link de leitura nunca cancela nem aceita oferta.
- FR-21 a FR-27: os textos são fixos no módulo 1 (regra do sistema) e seguem a tabela "Mensagens" de `04-regras-reserva.md`, na voz da casa ("Pode entrar, {nome}!", "Tá de pé?"). Cada texto passa pela aprovação da Meta.
- FR-27 inclui também: entrou na lista de espera, pendente vencido, oferta vencida, cancelada pelo cliente e remarcada pelo cliente.

### 4.4 Área do cliente

Em `/minhas-reservas`, o cliente entra com o código de verificação e cuida das próprias reservas.

| FR | Função | Quem usa | Constrói |
| --- | --- | --- | --- |
| FR-28 | Entrar com o código de verificação e manter o aparelho lembrado | Cliente | F, B |
| FR-29 | Ver as próprias reservas, com o estado em linguagem simples | Cliente | F, B |
| FR-30 | Remarcar uma reserva até 2 h antes, se o novo horário tiver mesa | Cliente | F, B |
| FR-31 | Mudar o número de pessoas até 2 h antes, se houver mesa para o novo tamanho | Cliente | F, B |
| FR-32 | Cancelar uma reserva até 2 h antes | Cliente | F, B |
| FR-33 | Baixar os próprios dados | Cliente | F, B |
| FR-34 | Apagar os próprios dados, o que cancela as reservas futuras | Cliente | F, B |

**Consequências testáveis:**
- FR-30 e FR-31: se não há mesa, nada muda e a reserva antiga continua valendo.
- FR-31: hoje o contrato da API só remarca dia e horário. **Falta incluir o número de pessoas.**

### 4.5 Regras automáticas da reserva

O que o sistema faz sozinho. As regras com números estão em `docs/04-regras-reserva.md`.

| FR | Função | Constrói |
| --- | --- | --- |
| FR-35 | Confirmar sozinho reserva de até 8 pessoas | B |
| FR-36 | Deixar pendente, para a casa aprovar, a reserva de quem já faltou 2 vezes e a de evento com aprovação, segurando uma mesa provisória | B |
| FR-37 | Vencer a pendente que a casa não respondeu (em 4 h ou 2 h antes do horário, o que vier primeiro) e liberar a mesa provisória | B |
| FR-38 | Oferecer a mesa ao primeiro da lista de espera quando abre uma vaga que serve o grupo, antes de o horário começar | B |
| FR-39 | Vencer a oferta em 10 min ou na recusa e passar ao próximo | B |
| FR-40 | Marcar a reserva como atrasada depois do horário e como "passou da tolerância" depois de 15 min (25 se avisou), para a equipe decidir entre "chegou" e "não veio" | B, F |
| FR-41 | Marcar "sem resposta" quem não respondeu o lembrete até 30 min antes de abrir, como alerta no painel, sem cancelar | B |
| FR-42 | Fechar a noite: quem chegou vira concluída (conta visita), quem não veio conta falta, a lista de espera vence | B |
| FR-43 | Avisar a casa pelo WhatsApp quando entra uma reserva pendente | B, M |
| FR-44 | Impedir duas reservas na mesma mesa e horário, mesmo com duas pessoas reservando ao mesmo tempo | B |
| FR-96 | Encerrar a lista de espera de um dia que a casa fechou, com mensagem para quem estava nela | B |
| FR-97 | Apagar a restrição alimentar 30 dias depois da visita e anonimizar o cliente depois de 24 meses sem visita | B |

**Notas:**
- FR-42: a equipe marca "não veio" durante a noite (FR-52, como em `04`). Falta dizer **quando** a noite fecha sozinha. **[SUPOSIÇÃO]** No horário de fechamento da casa; quem ainda estiver como "passou da tolerância" vira "não veio". Ver Q4.
- FR-43: falta dizer para qual número vai o aviso. **[SUPOSIÇÃO]** O WhatsApp do dono.

### 4.6 Noite no painel

O que a equipe usa durante o serviço. Funciona no tablet do salão e no celular. Realiza UJ-4.

| FR | Função | Dono | Gerente | Salão | Constrói |
| --- | --- | --- | --- | --- | --- |
| FR-45 | Ver Hoje: a noite, a semana (dono e gerente), os pendentes, as reservas sem mesa, quem respondeu o lembrete, o evento da noite | ✓ | ✓ | só a noite | F, B |
| FR-46 | Buscar uma reserva por nome, telefone ou código | ✓ | ✓ | ✓ | F, B |
| FR-47 | Ver e filtrar as reservas | ✓ | ✓ | só hoje | F, B |
| FR-48 | Ver o Salão ao vivo: cada mesa reservada, sentada, atrasada, livre, guardada, provisória ou oferecida | ✓ | ✓ | ✓ | F, B |
| FR-49 | Marcar "chegou" e "sentou" (quem chegou e esperou a mesa) | ✓ | ✓ | ✓ | F, B |
| FR-50 | Sentar quem chega sem reserva (balcão ou mesa livre) | ✓ | ✓ | ✓ | F, B |
| FR-51 | Marcar "mesa vagou" quando o grupo vai embora, sem contar falta | ✓ | ✓ | ✓ | F, B |
| FR-52 | Marcar "não veio" ("liberar mesa") depois da tolerância, contando uma falta | ✓ | ✓ | ✓ [sugestão: confirmar com o Marcus] | F, B |
| FR-53 | Mudar a reserva de mesa | ✓ | ✓ | ✓ [sugestão: confirmar com o Marcus] | F, B |
| FR-54 | Acompanhar a lista de espera e as ofertas | ✓ | ✓ | ✓ | F, B |
| FR-55 | Aprovar ou recusar pendente; a recusa leva o motivo e o link para o cliente escolher outro horário, sem sugestão da casa | ✓ | ✓ | — | F, B |
| FR-56 | Remarcar ou cancelar a reserva de um cliente, com mensagem | ✓ | ✓ | ✓ [sugestão: confirmar com o Marcus] | F, B |
| FR-57 | Resolver reservas que ficaram sem mesa depois de mudar planta, agenda ou evento | ✓ | ✓ | — | F, B |
| FR-58 | Trocar a planta da noite | ✓ | ✓ | — | F, B |
| FR-91 | Lançar uma reserva pela equipe (cliente que pediu pelo WhatsApp ou telefone, grupo de 9 ou mais), para a mesa aparecer ocupada | ✓ | ✓ | ✓ [sugestão: confirmar com o Marcus] | F, B |
| FR-92 | Usar a barra do topo: aberta ou fechada agora, relógio, seletor de dia, número de pendentes | ✓ | ✓ | ✓ (sem pendentes) | F |
| FR-93 | Abrir uma reserva por link (da busca, do Hoje, de Clientes, do aviso de pendente) | ✓ | ✓ | só hoje | F |
| FR-94 | Na lista de espera: oferecer a mesa à mão ou transformar em reserva | ✓ | ✓ | ✓ | F, B |

**Consequências testáveis:**
- FR-45 e FR-48: a tela se atualiza sozinha a cada 30 s no máximo e mostra "Atualizado às HH:MM". Sem internet, as ações ficam desligadas com aviso.
- FR-48: no celular, o salão vira lista por área.
- FR-52: as faltas alimentam a regra de aprovação (FR-36). "Mesa vagou" nunca conta falta.
- FR-91: a reserva lançada pela equipe ocupa a mesa e entra nas contas de faltas e visitas como as outras. **Falta no contrato da API.**
- Duas pessoas mudando a mesma reserva: a segunda vê "Alguém mudou isso agora. Recarregar".

### 4.7 Agenda, plantas e eventos

O planejamento. Toda mudança que mexe em reservas já feitas mostra antes uma simulação de quem é afetado. Realiza UJ-5.

| FR | Função | Dono | Gerente | Salão | Constrói |
| --- | --- | --- | --- | --- | --- |
| FR-59 | Ver a agenda mês a mês e definir o plano do dia de cada data | ✓ | ✓ | só ver | F, B |
| FR-60 | Ver a simulação antes de uma mudança que mexe em reservas | ✓ | ✓ | — | F, B |
| FR-61 | Fechar um dia; o sistema só fecha depois que cada reserva foi remarcada ou cancelada | ✓ | ✓ | — | F, B |
| FR-62 | Criar e editar várias plantas, com mesas por área e junção de mesas | ✓ | ✓ | só ver | F, B |
| FR-63 | Escolher a planta padrão de cada dia da semana | ✓ | ✓ | — | F, B |
| FR-64 | Criar, publicar, mudar, duplicar e apagar evento, com fotos das edições passadas | ✓ | ✓ | só ver | F, B |
| FR-65 | Escolher o modo do evento (mesa, lista na porta, os dois) e a capacidade da lista | ✓ | ✓ | — | F, B |
| FR-66 | Fazer o check-in na lista na porta pelo celular: busca por nome, chegada de parte do grupo, desfazer | ✓ | ✓ | ✓ | F, B |

**Notas:**
- FR-62: o editor de plantas só funciona a partir de 768 px (tablet ou computador). No celular, só mostra. A planta real é cadastrada pelo Matheus antes de abrir as reservas.
- FR-64: hoje o evento tem uma foto só. **Falta suportar as fotos das edições passadas.**

### 4.8 Site, cardápio e fotos pelo painel

| FR | Função | Dono | Gerente | Salão | Constrói |
| --- | --- | --- | --- | --- | --- |
| FR-67 | Ligar e desligar um prato ("tem hoje"), valendo na hora | ✓ | ✓ | ✓ | F, B |
| FR-99 | Escolher o prato do dia | ✓ | ✓ | — | F, B |
| FR-68 | Editar o cardápio (pratos, preços, ordem, categorias) em rascunho e publicar | ✓ | ✓ | — | F, B |
| FR-69 | Editar os textos do site, os avisos com validade e a regra de cada dia da semana | ✓ | ✓ | — | F, B |
| FR-70 | Subir fotos ao banco de fotos e escolher onde cada uma aparece | ✓ | ✓ | — | F, B |

**Consequências testáveis:**
- FR-70: toda foto exige texto alternativo; o sistema tira os metadados e gera os tamanhos para celular e computador.
- FR-70: hoje o contrato só mostra onde a foto está em uso. **Falta permitir escolher onde ela aparece.**
- FR-69: **falta no contrato** o caminho para editar avisos e a regra do dia.

### 4.9 Clientes, equipe e registro

| FR | Função | Dono | Gerente | Salão | Constrói |
| --- | --- | --- | --- | --- | --- |
| FR-71 | Ver os clientes, com visitas e faltas | ✓ | ✓ | só os da noite | F, B |
| FR-72 | Anotar no cliente | ✓ | ✓ | — | F, B |
| FR-73 | Ver o telefone completo (cada vez fica no registro) | ✓ | ✓ | — (vê com dígitos escondidos) | F, B |
| FR-74 | Bloquear um cliente de reservar online | ✓ | ✓ | ✓ [sugestão: confirmar com o Marcus] | F, B |
| FR-75 | Apagar os dados de um cliente a pedido dele (pede a senha de novo) | ✓ | — | — | F, B |
| FR-76 | Exportar reservas, listas e clientes (pede a senha de novo) | ✓ | — | — | F, B |
| FR-77 | Convidar pessoas, desativar contas e mudar papéis | ✓ | — | — | F, B |
| FR-78 | Ver o registro de ações | tudo | só as próprias | — | F, B |

**Consequências testáveis:**
- FR-73 e FR-75: ficam no registro com quem fez e quando.
- FR-77: o sistema nunca deixa a casa sem dono.
- FR-78: o que é feito no tablet aparece como "Salão".

### 4.10 Acesso e configuração da casa

| FR | Função | Dono | Gerente | Salão | Constrói |
| --- | --- | --- | --- | --- | --- |
| FR-79 | Criar a conta de dono pelo link de primeiro acesso | ✓ | — | — | F, B, M (gera o link) |
| FR-80 | Aceitar convite e criar a senha | — | ✓ | ✓ | F, B |
| FR-81 | Entrar com senha; recuperar a senha por e-mail | ✓ | ✓ | ✓ | F, B, M (provedor de e-mail) |
| FR-82 | Ligar a verificação em duas etapas na própria conta | ✓ | ✓ | ✓ | F, B |
| FR-83 | Fazer o cadastro da casa em 5 passos no primeiro uso, respondendo as decisões | ✓ | — | — | F, B |
| FR-84 | Mudar as configurações da reserva e do horário (as decisões de "ajuste no painel") | ✓ | só ver | — | F, B |
| FR-95 | Navegar pelo painel no aparelho certo (menu lateral no computador e tablet deitado, barra inferior com "Mais" no celular) e ver as telas gerais: carregando, vazio, erro, sem permissão ("Essa parte é de outro papel"), não encontrada, sem internet | ✓ | ✓ | ✓ | F |
| FR-98 | Ver e encerrar as próprias sessões; trocar a senha encerra as outras | ✓ | ✓ | ✓ | F, B |

**Consequências testáveis:**
- FR-81: depois de 5 senhas erradas, a conta bloqueia por 15 min, e o tempo cresce a cada nova série de erros **[SUPOSIÇÃO]**. "Esqueci a senha" dá a mesma resposta, exista ou não o e-mail.
- FR-83: enquanto o cadastro não termina, gerente e salão veem "A casa ainda está sendo cadastrada".
- FR-84: mudar tolerância, tempo de mesa ou prazo vale para reservas novas. As já feitas mantêm o que o cliente aceitou.
- FR-98: os links vencem: os do cliente 30 dias depois da reserva, o convite em 72 h, a troca de senha em 30 min; o primeiro acesso do dono é de uso único.

### 4.11 Operação e manutenção (Matheus)

Não são telas. São o que a mensalidade cobre e o que a publicação exige.

| FR | Função | Constrói |
| --- | --- | --- |
| FR-85 | Publicar no domínio da casa com conexão segura | M |
| FR-86 | Fazer cópia de segurança diária do banco, guardar 30 dias, testar a restauração a cada 3 meses | M, B |
| FR-87 | Acompanhar erros do sistema e avisar a casa em até 1 h quando a reserva ou o envio de mensagens ficar fora por mais de 10 min | M, B |
| FR-88 | Manter os programas atualizados: correções de segurança em até 7 dias, o resto uma vez por mês | M |
| FR-89 | Configurar a conta oficial do WhatsApp no nome da casa e enviar os textos à Meta | M, C |
| FR-90 | Começar a usar a API oficial do WhatsApp antes de a Meta verificar a empresa, dentro do limite inicial dela | M, B |

**Notas:**
- FR-90: sem a verificação da empresa, a Meta já deixa a conta mandar mensagem para cerca de 250 pessoas por dia. Uma noite cheia do Território usa bem menos que isso (código, confirmação e lembrete). Os textos ainda precisam ser aprovados pela Meta antes do primeiro envio. Por isso não há plano B sem WhatsApp: a verificação corre em paralelo e só aumenta o limite.
- Riscos que sobram: a Meta recusar um texto, ou suspender o número. Mitigação: os textos vão para a Meta no dia da assinatura, e, se o número cair, o site mostra o telefone da casa e a equipe lança as reservas (FR-91).

## 5. O que a casa fornece

| Item | Bloqueia |
| --- | --- |
| Assinatura do escopo e 50% do valor | O início do prazo |
| Respostas das decisões (no cadastro da casa) | A configuração final |
| Planta real das mesas | Abrir as reservas |
| Cardápio e carta de bebidas finais, com preços | A página inicial e o cardápio |
| Fotos em alta resolução (fachada, salão, quintal, pratos) | A página inicial |
| Material da marca atualizado | O acabamento visual (o site aprovado já usa o que existe) |
| Imagens das peças da lojinha em alta resolução (mockups, pedidas à Mixi) | A lojinha final |
| Razão social, CNPJ e contato | A política de privacidade |
| Um número de telefone novo, só para o sistema, e o cartão para a conta da Meta | Mensagens e código de verificação |
| Domínio (ou a escolha de um novo) | A publicação |
| Aprovação das telas por escrito | O início do sistema real |
| A equipe na noite simulada | A publicação |

### Entrega, aceite e valores (do escopo assinável)

- **Etapas e aceite:** 1) telas, aprovadas por escrito pelo Marcus depois de usar com dados de teste; 2) sistema real; 3) noite simulada, aceita se roda sem defeito que impeça reservar ou receber o cliente; 4) publicação.
- **Três entregas** (decidido em 08/10, depois da estimativa):
  - **Entrega 1, site, 15 dias úteis:** FR-1, FR-5, FR-7, FR-8 e FR-100. Cardápio, horários e eventos vêm gravados no site; mudar é pedido ao Matheus até a entrega 2 trazer o painel.
  - **Entrega 2, sistema, 14 semanas:** todo o resto, menos a entrega 3. A lista de espera funciona com oferta pela equipe (FR-94); uma planta só, com junção de mesas; eventos com reserva de mesa.
  - **Entrega 3, complementos, até 3 semanas depois da entrega 2:** oferta automática (FR-26, FR-38, FR-39), várias plantas e simulação (FR-57, FR-58, FR-60, FR-62 com mais de uma planta, FR-63), lista na porta (FR-65, FR-66) e fotos das edições passadas (parte da FR-64).
- **Prazos** contam da assinatura, a partir de quando a casa entrega o que está na tabela acima. A estimativa está em `docs/planejamento/architecture-territorio-2026-10-07/estimativa-backend.md`.
- **Defeito** é o que o sistema faz diferente do escopo e das telas aprovadas. Há 30 dias de correção depois da publicação.
- **Valores:** R$ 5.000 (50% na assinatura, 50% na publicação) e R$ 100 por mês de manutenção. WhatsApp, servidor e banco são custo de uso da casa; antes de qualquer plano pago, Matheus avisa com o valor.

## 6. Responsabilidades

| Bloco | Matheus | Front-end | Backend | Casa |
| --- | --- | --- | --- | --- |
| Venda e escopo | Envia, explica, cobra | | | Assina e paga |
| Site público (FR-1 a FR-8) | Texto da privacidade | Constrói | Conteúdo pela API | Conteúdo, fotos, revisão da privacidade |
| Reserva e área do cliente (FR-9 a FR-20, FR-28 a FR-34) | | Telas | Vagas, regras, código | Decisões |
| Mensagens (FR-21 a FR-27, FR-43) | Conta Meta, textos | Páginas dos links | Envio direto pela API do WhatsApp e recebimento das respostas | Número e cartão |
| Regras automáticas (FR-35 a FR-44, FR-96, FR-97) | | | Constrói | |
| Painel (FR-45 a FR-84, FR-91 a FR-95, FR-98, FR-99) | Gera o primeiro acesso | Telas | Permissões e regras | Usa e aprova |
| Planta real | Cadastra | | | Informa |
| Validação das telas | Conduz | Ajusta | | Testa e aprova |
| Publicação e operação (FR-85 a FR-90) | Faz e mantém | | Cópia de segurança, acompanhamento | Domínio |
| Dia a dia depois de publicar | Suporte (2 h/mês) | | | Cardápio, eventos, plano do dia, fotos |

Hoje Matheus faz front-end e backend. As colunas separam o tipo de trabalho, para a lista de tarefas.

## 7. Fora do módulo 1

- Comanda, pedidos na cozinha e gastos (módulo Comandas).
- Financeiro (módulo Financeiro).
- Campanhas, aniversários e novidades pelo WhatsApp (módulo Clientes e WhatsApp). A caixa de novidades (FR-16) só junta a base.
- Lojinha com pagamento, sinal por Pix, ingresso pago.
- Propor outro horário ao recusar, almoço de sábado, entrar com Google, e-mail para o cliente.
- Editar os textos das mensagens do WhatsApp.
- Mudanças no desenho das telas depois da aprovação.

O sistema não vira um app de entregas, nem um sistema de vendas e relacionamento com clientes (CRM), nem um app instalável. É site e painel no navegador.

## 8. Qualidade em todo o sistema

- **Segurança:** nenhuma chave secreta fica no navegador; equipe com sessão no servidor e senha de 12 caracteres ou mais; qualquer conta da equipe pode ligar a verificação em duas etapas; ações sensíveis pedem a senha de novo; limite de tentativas no código, no login e na reserva.
- **Dados pessoais (LGPD):** a casa é controladora (decide o que se faz com os dados) e o Matheus é operador (cuida dos dados em nome da casa). Só nome e WhatsApp são obrigatórios. Restrição alimentar é dado de saúde: acesso restrito, fora das exportações, apagada 30 dias após a visita. Dados guardados por 24 meses e depois anonimizados. **[SUPOSIÇÃO]** 24 meses, como no plano; o modelo não tem o valor padrão.
- **Acessibilidade:** **[SUPOSIÇÃO]** WCAG 2.1 nível AA (o padrão internacional de acessibilidade) no site e no painel, conferido com axe (já roda nos testes) e com leitor de tela. Fotos com texto alternativo; erros por campo, em português; botões grandes na lista na porta; o voltar do celular volta uma etapa da reserva.
- **Desempenho:** a reserva fica usável em até 3 s num celular com 4G; lembretes, ofertas e vencimentos saem com no máximo 1 min de atraso. **[SUPOSIÇÃO]** nos números.
- **Celular primeiro:** a reserva e o check-in são feitos para celular; o painel funciona em tablet, celular e computador.
- **Tempo:** fuso de São Paulo; vale o horário do servidor, não o do aparelho.
- **Custo:** o sistema começa em planos gratuitos. O custo de uso previsto são as mensagens do WhatsApp (R$ 10 a R$ 40 por mês, pagos pela casa). Servidor e banco só custam se saírem do plano gratuito, com aviso antes.

### Visual, conteúdo e tom

- **Visual:** o "papel e ferro" aprovado em 30/09: papel é a superfície, a esquadria de ferro é a grade, terracota é seleção e carimbo. A referência são os prints aprovados da proposta (`territorio/pdf/shots` e `site/fluxo.html`). "Sem redesenho" quer dizer: a tela construída bate com o print.
- **Regra de reserva é cuidado com quem espera, nunca ameaça.** Vale para tolerância, cancelamento, falta e bloqueio.
- **O cliente vê os estados com nomes da casa:** Confirmada, Esperando a casa, Na lista de espera, Abriu uma mesa, Foi, Cancelada, Não deu dessa vez, Venceu, Não veio. Os nomes do glossário são os da equipe.
- **Todo fato tem fonte** (preço, horário, prato): legendas, destaques ou o Marcus. O que não tem fica "a confirmar".
- Nada de texto em outra língua como enfeite; nada de oferta que a casa não tem mais; nada que diminua a casa.

## 9. Como saber que deu certo

**Principais**
- **SM-1:** parte das reservas que chegam pelo site, em relação a todas as reservas no sistema (site + lançadas pela equipe, FR-91). Meta: 70% no primeiro mês. Valida FR-9 a FR-17. **[SUPOSIÇÃO]** na meta.
- **SM-2:** faltas sem aviso ("não veio"). Base: as 2 primeiras semanas depois de abrir, ou o número que a casa estima hoje (Q9). Meta: cair pela metade em 3 meses. Valida FR-22, FR-41 e FR-52.

**Secundárias**
- **SM-3:** mesas recuperadas pela lista de espera por mês. Só observar, sem meta. Valida FR-38 e FR-39.

**Não otimizar**
- **SM-C1:** não aumentar reservas apertando a tolerância ou cobrando sinal. Equilibra SM-1 e SM-2: a casa perde o cliente que se sente vigiado.
- **SM-C2:** não mandar mais mensagens para reduzir faltas. Cada mensagem custa e cansa. Equilibra SM-2.

## 10. Perguntas em aberto

**Resolvidas em 07/10:**

- **Q1. WhatsApp:** API oficial (WhatsApp Cloud API) desde o início, sem plano B (ver FR-90).
- **Q2. Sem n8n (ferramenta de automação):** o backend manda as mensagens direto pela API do WhatsApp e agenda sozinho o lembrete, as ofertas e os vencimentos. A Meta entrega as respostas dos botões direto no backend.
- **Q3. Servidor:** Oracle Cloud "Always Free", máquina sempre ligada em São Paulo.
- **Q10. Número do WhatsApp:** um número novo, só para o sistema. O número que a casa usa hoje continua no celular para conversar com os clientes; os fluxos que mandam "falar com a casa pelo WhatsApp" apontam para ele.

**Segue com a sugestão, a casa pode mudar depois:**

- **Q4. Fechar a noite:** a equipe marca "não veio" durante a noite (`04`); a noite fecha sozinha no horário de fechamento da casa (FR-42).

**Trava a assinatura:**

- **Q5. Prazo:** resolvida em 08/10. A estimativa deu ~77 dias úteis no cenário provável; 8 semanas não cabiam. Ficaram três entregas (ver §5).

**Não travam, mas precisam de dono:**

- **Q6.** Horário final das reservas: 21:30, como no `05`? (o escopo não diz)
- **Q7.** Pode haver mais de um dono? (o painel prevê "último dono")
- **Q8.** O gerente pode mudar os horários da casa, ou só o dono?
- **Q9.** Quantas faltas sem aviso a casa tem hoje, para medir o SM-2?
- **Q11.** A casa já tem domínio?
- **Q12.** Depoimentos de clientes entram no site? (o `05` pede autorização, o escopo não cita)
- **Q13.** Qual provedor de e-mail para "esqueci a senha" da equipe?

## 11. Suposições

- §4.1 FR-5: peças da lojinha gravadas no site, sem cadastro no painel.
- §4.5 FR-42: a noite fecha sozinha no horário de fechamento; a equipe pode marcar "não veio" antes.
- §4.5 FR-43: o aviso de pendente vai para o WhatsApp do dono.
- §4.6 e §4.9, sugestões do Matheus (08/10) para confirmar com o Marcus na validação das telas: o salão pode marcar "não veio" (FR-52), mudar a reserva de mesa (FR-53), remarcar ou cancelar reserva de cliente (FR-56), lançar reserva (FR-91) e bloquear cliente (FR-74); o gerente também bloqueia.
- §4.10 FR-81: bloqueio de 15 min depois de 5 senhas erradas.
- §8: dados guardados por 24 meses; meta de acessibilidade WCAG 2.1 AA.
- §8: desempenho de 3 s no 4G e mensagens com até 1 min de atraso.
- §9 SM-1: meta de 70% das reservas pelo site no primeiro mês.
