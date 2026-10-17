# Revisão de qualidade do PRD — Território · Módulo 1

## Veredito geral

O PRD é sólido: tem uma tese clara (tirar a reserva do WhatsApp manual da equipe), 90 FRs agrupados por quem usa, consequências testáveis nos pontos que mais quebram (idempotência, corrida pela última mesa, links que a prévia do WhatsApp abre) e um escopo honesto, com suposições indexadas. A tabela compacta que aponta para `docs/04-regras-reserva.md` funciona e não é preguiça. Os riscos estão em três lugares. Falta uma função que o próprio fluxo exige: a equipe não tem como lançar reserva no painel, e grupos de 9 ou mais, telefones estrangeiros e cancelamentos tardios vão todos para o WhatsApp da casa sem voltar ao sistema. A decisão "sem plano B" para o WhatsApp foi justificada só pelo volume, quando o risco real é a aprovação dos textos e a migração do número. E o painel tem ambiguidades de semântica ("liberar mesa" × "não veio") que vão gerar estados errados.

## Prontidão para decisão — adequada

O PRD toma decisões de verdade. O §10 separa "Resolvidas em 07/10" (API oficial, sem n8n, Oracle Always Free) de "Travam a arquitetura" e "Não travam, mas precisam de dono". O §1 diz "migrado sem redesenho", e o §7 diz "Mudanças de layout depois da aprovação das telas" estão fora. Isso dá ao Marcus o que assinar e o que não esperar. A regra "Em conflito, ele manda" para `docs/10-escopo-modulo-1.md` (§0) também é uma decisão útil, que evita a deriva entre documentos.

O ponto fraco são as trocas que aparecem sem o que se perdeu. Em FR-90 ("Por isso não há plano B sem WhatsApp"), a justificativa cobre só o limite de ~250 por dia. Ela não diz o que acontece se a Meta demorar ou reprovar os modelos de mensagem, nem se o número for derrubado. Com o código de verificação (FR-15) dependendo do WhatsApp, a reserva inteira para. A Q10 (migrar o número tira o WhatsApp do celular) aparece em "Não travam", mas é exatamente o que pode travar a abertura.

### Achados
- **[alta]** "Sem plano B" sem o custo da escolha (§4.11 FR-90, §10 item 1) — o argumento só trata de volume ("Uma noite cheia do Território usa bem menos que isso"). O risco que importa é o prazo e a reprovação dos modelos da Meta, e a conta ou o número suspensos: com FR-15 obrigatório, ninguém reserva. *Correção:* dizer em uma frase o que foi aceito ("se o WhatsApp cair, a reserva online para e o FR-8 manda para o WhatsApp da casa"). Pôr a aprovação dos modelos como item do §5 com data limite em relação às 8 semanas.
- **[alta]** A Q10 está no grupo errado (§10 item 10) — se o número atual da casa migrar para a Cloud API, ele sai do aplicativo do celular. É dele que a equipe atende hoje e para onde vão os grupos de 9 ou mais, os estrangeiros e os cancelamentos tardios. Isso decide se a casa precisa de um número novo e muda o "WhatsApp da casa" em pelo menos 6 FRs. *Correção:* mover para "Travam a arquitetura" e tratar como bloqueio no §5 ("Número de WhatsApp").
- **[média]** A Q5 não trava a arquitetura (§10 item 5) — o prazo de 8 semanas é uma decisão comercial que *depende* da arquitetura. Lá ela parece pendência técnica. *Correção:* mover para um grupo "Trava a assinatura", com o que acontece se o backend estimado estourar (cortar FRs? estender o prazo?).
- **[média]** A Q4 já está meio respondida nas fontes (§10 item 4, §4.5 nota FR-42) — `04-regras-reserva.md` (linhas 81 e 91) já diz que `no_show` vem de "Casa ou sistema" e que "Liberar mesa" depois da tolerância vira `no_show`. A pergunta aberta é só o fechamento automático da noite. *Correção:* reduzir a Q4 ao que está mesmo aberto e citar a regra já existente.

## Substância em vez de teatro — forte

Não há teatro. As personas do §2.1 são papéis do sistema (cliente, salão, gerente, dono, operador), e cada uma aparece numa coluna de permissão nas tabelas do §4.6 ao §4.10. Isso é estrutura, não enfeite. A Visão (§1) só serve para este projeto ("lota nas noites boas e vive de eventos", "descobre na hora quem não vem"). O §8 tem números próprios do produto: senha de 12+, restrição alimentar "apagada 30 dias após a visita", "R$ 10 a R$ 40 por mês". Não existe seção de diferenciação forçada.

### Achados
- **[baixa]** Custo do WhatsApp sem base (§8 "Custo") — "R$ 10 a R$ 40 por mês" não mostra a conta (reservas por mês × mensagens de autenticação e utilidade × preço da Meta no Brasil). Os códigos de verificação são da categoria autenticação, que é cobrada por mensagem. *Correção:* uma linha com a conta, ou "[SUPOSIÇÃO]" e a fonte.

## Coerência estratégica — forte

A tese é explícita: a reserva sai da mão da equipe (§1), e as métricas medem isso. SM-1 mede "sem ninguém da casa responder" e SM-2 mede faltas sem aviso, que é o que lembrete e tolerância atacam. As contramétricas SM-C1 e SM-C2 são boas e específicas do produto ("a casa perde o cliente que se sente vigiado"). O tipo de MVP (resolver um problema) combina com o corte do §7: pagamento, CRM e campanhas ficaram de fora.

### Achados
- **[alta]** A SM-1 não pode ser medida como está escrita (§9 SM-1) — "70% das reservas da noite" pede o denominador: as reservas que *não* passaram pelo site. Como a equipe não lança reserva no sistema (ver Done-ness), essas reservas nunca entram no banco, e a métrica dá 100% por construção. *Correção:* definir a fonte do denominador (contagem manual da casa, ou reservas lançadas pela equipe se o FR for criado).
- **[média]** A SM-2 não tem linha de base, e a SM-3 não tem meta (§9) — a SM-2 depende da Q9, e a SM-3 só conta. Para um módulo vendido como "tira faltas da noite", a SM-2 é a prova de valor para o Marcus. *Correção:* pedir o número de hoje antes de abrir (ou medir as 2 primeiras semanas como base) e dar à SM-3 um piso ou o rótulo "só observar".
- **[baixa]** A SM-4 é critério de aceite, não métrica (§9 SM-4) — "a noite simulada roda sem defeito" é um portão de entrega. *Correção:* mover para o §5 ou para uma seção de aceite.

## Clareza do "pronto" — fina

A escolha de tabelas compactas com ponteiro para `04-regras-reserva.md` é justa. As regras numéricas estão lá, completas, com estados e transições, e o PRD não as duplica de forma que possam divergir. Onde o PRD escreve consequências (FR-12, FR-15, FR-17, FR-22, FR-24, FR-84), elas são boas e testáveis. O problema é a cobertura: os grupos §4.6 ao §4.10 (as telas que a equipe usa) têm poucas consequências, e há ambiguidades que nenhuma fonte resolve.

### Achados
- **[alta]** Não existe "equipe lança reserva" (§4.6, §4.2 FR-9, §2.2, FR-17, FR-25) — grupos de 9 ou mais, telefones estrangeiros, cliente bloqueado e cancelamento depois do prazo vão para o "WhatsApp da casa", e a casa não tem como registrar nada disso no sistema. As fontes também não têm essa função (sem tela no `02` nem operação no `openapi.yaml`). O resultado: o Salão ao vivo (FR-48) mostra como livre a mesa que a gerente prometeu ao grupo de 10, o site vende a mesma mesa, e o FR-44 não protege. *Correção:* incluir um FR "Lançar reserva pelo painel (dono, gerente, talvez salão), sem código de verificação", ou declarar como **[NÃO-OBJETIVO]** com o processo manual (por exemplo, "guardar mesa" no plano do dia).
- **[alta]** "Liberar a mesa" tem dois sentidos (§4.6 FR-51 × FR-52, FR-40) — em `04-regras-reserva.md` (linha 96), "Liberar mesa" depois da tolerância vira `no_show` e conta falta, e "Mesa vagou" é a saída normal, sem falta. O PRD tem FR-51 "Liberar a mesa" e FR-52 "Marcar 'não veio'" como funções separadas, e o FR-40 diz "deixar a mesa para quem chega". Quem constrói vai ler o FR-51 como "o grupo foi embora" ou como "não veio", e as faltas (que bloqueiam o cliente no FR-36) saem erradas. *Correção:* renomear o FR-51 para "Mesa vagou (o grupo foi embora)" e fazer o FR-52 citar a regra do `04`.
- **[média]** Adjetivos sem limite no painel e na operação (FR-45/FR-48 "se atualiza sozinha", FR-81 "bloqueia por um tempo", FR-87 "se algo grave acontecer", FR-88 "Manter os programas atualizados") — nenhum diz quanto. *Correção:* intervalo de atualização (por exemplo, até 30 s), duração do bloqueio, o que é "grave" (reserva falhando, envio do WhatsApp falhando por mais de X min) e a cadência das atualizações.
- **[média]** Os grupos §4.7 a §4.9 têm poucas consequências — FR-59, FR-63, FR-65, FR-66, FR-68, FR-71, FR-72 e FR-76 não têm nenhuma, e o FR-66 (check-in com "chegada de parte do grupo, desfazer") é exatamente onde aparecem casos-limite. O ponteiro para o `04` cobre a reserva, mas não o painel. *Correção:* uma linha de consequência por FR, ou um ponteiro explícito para a seção do `02-telas.md` que define os estados de cada tela.
- **[média]** Não há limite de desempenho nem de disponibilidade (§8) — o §8 tem segurança, LGPD e celular primeiro, mas não diz quanto a reserva pode demorar no celular nem quanto tempo o sistema pode ficar fora. Com lembretes e ofertas de 10 min dependendo de uma máquina gratuita, a disponibilidade é requisito de produto. *Correção:* metas simples (por exemplo, tela de reserva usável em até 3 s no 4G, e oferta ou lembrete enviados com no máximo 1 min de atraso).
- **[baixa]** Ambiguidade na pendente (FR-37 "4 h, ou 2 h antes do horário") — o texto não diz qual vale primeiro. *Correção:* escrever "o que vier primeiro", ou apontar para a linha do `04`.

## Honestidade do escopo — forte

O §2.2 ("Quem não é atendido") e o §7 ("Fora do módulo 1") fazem trabalho real, com fronteiras que um cliente costuma presumir (almoço de sábado, sinal por Pix, editar textos do WhatsApp). As lacunas do contrato ficam visíveis dentro dos próprios FRs ("**Falta incluir o número de pessoas**" no FR-31, FR-64, FR-69, FR-70) e se repetem no adendo. As suposições estão marcadas em linha e indexadas no §11. A densidade de itens abertos (8 suposições e 10 perguntas abertas) é aceitável para um rascunho, desde que as duas que travam se resolvam antes da assinatura.

### Achados
- **[média]** Não há marcação de não-objetivo nos lugares onde a omissão passa despercebida — o "lançar reserva pela equipe" (ver acima) e "cliente sem WhatsApp reserva por telefone" são omissões que o Marcus vai presumir que existem. *Correção:* marcar com **[NÃO-OBJETIVO]** em linha, se for essa a decisão.
- **[baixa]** Tensão entre o FR-55 e o §7 — o FR-55 diz que "a recusa leva o motivo e o link para outro horário", e o §7 tira "Propor outro horário ao recusar". A diferença (um link genérico × uma sugestão específica) existe, mas não está explicada. *Correção:* meia frase no FR-55 ("link para escolher outro horário, sem sugestão da casa").

## Utilidade para as próximas etapas — adequada

O glossário (§3) é bom e pede expressamente "sem sinônimos". Os IDs FR-1 a FR-90 são contínuos e únicos, e cada grupo diz qual UJ realiza. O adendo separa bem o "como construir" e lista 9 lacunas do contrato numeradas e ligadas aos FRs. A coluna "Constrói" (F/B/M/C) é útil de verdade para a lista de tarefas.

### Achados
- **[média]** O adendo se contradiz sobre o n8n (adendo, "Arquitetura já decidida") — o resumo ainda diz "backend em FastAPI + Supabase ... **+ n8n** + WhatsApp Cloud API", e a seção logo abaixo diz "**Sem n8n**". A arquitetura vai partir daqui. *Correção:* tirar o n8n do resumo.
- **[média]** A Oracle Always Free tem risco não registrado (adendo, "O que o plano gratuito muda") — a Oracle recupera instâncias gratuitas ociosas (uso baixo de CPU por dias seguidos), e um backend de restaurante pequeno é esse perfil. O adendo trata a pausa do Supabase, mas não esta. *Correção:* registrar o risco e a mitigação (alerta de instância parada no FR-87, ou passar para conta paga) e conferir a regra atual da Oracle.
- **[baixa]** Estados soltos fora do glossário — "atrasada" (FR-40), "sem resposta" (FR-41) e "sentada" (FR-48) não estão na lista de estados de **Reserva** (§3). Fica sem saber se são estados ou marcações por cima de "confirmada". *Correção:* uma linha no glossário: "Marcações por cima da confirmada: atrasada, sem resposta, sentada".

## Adequação da forma — forte

O formato serve aos três leitores do §0. O texto para o dono é simples, as tabelas por papel servem a quem constrói, e os detalhes técnicos estão no adendo. As 6 jornadas são poucas e cobrem os três lados (cliente, salão, gestão), cada uma com caso-limite útil. Escrever em português sem jargão faz sentido para quem vai assinar. O sistema tem vários papéis e lado público, então as UJs pagam o que custam.

### Achados
- **[baixa]** Duas UJs sem protagonista com nome (UJ-4 "a pessoa do salão", UJ-5 "A gerente") — é pouco, mas as outras têm nome (Júlia, Rafael, Marcus). *Correção:* dar nome ou deixar explícito que é o papel.

## Notas mecânicas

- **Contagem de funções:** o §0 cita "111 funções" no inventário, e o PRD tem 90 FRs. Não está dito como uma coisa vira a outra (fusões? cortes?). Uma linha resolve e evita que a arquitetura procure as 21 que "faltam".
- **Duas etapas:** o §8 diz "dono pode ligar duas etapas", e o FR-82 dá a opção aos três papéis, incluindo o salão, que é uma conta compartilhada de tablet. Alinhar, e provavelmente tirar do salão.
- **Limite da Meta com termos diferentes:** o PRD diz "mensagem para cerca de 250 pessoas por dia" (FR-90), e o adendo diz "250 conversas iniciadas pela empresa". Usar um termo só.
- **"Cliente" × "Visitante" × "Cliente na mesa":** usados na coluna "Quem usa" sem entrada no glossário. Basta uma entrada.
- **Ida e volta das suposições:** as 8 do §11 batem com as marcações em linha (FR-5, FR-42, FR-43, FR-52, FR-53, FR-56, FR-74, §8 ×2, SM-1). O §11 junta as duas do §8 numa linha só. Está correto.
- **Referências cruzadas:** "Ver Q4" (nota FR-42) aponta para a pergunta 4 do §10, mas as perguntas são numeradas sem prefixo "Q". Alinhar para "§10 item 4" ou numerar como Q1 a Q13. O mesmo vale para "Q9" na SM-2.
- **Datas:** "UJ-5 sexta 14 de novembro" de 2026 é sábado. Conferir a data ou o dia da semana.
