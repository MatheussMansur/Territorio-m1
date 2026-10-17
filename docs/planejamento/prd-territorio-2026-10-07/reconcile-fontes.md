# Reconciliação do PRD com as fontes

Feito em 07/10/2026. Compara `prd.md` (+ `addendum.md` e o registro de decisões da época, que não está mais no repositório) com `10-escopo-modulo-1.md` (manda em conflito), `01-escopo.md`, `02-telas.md`, `04-regras-reserva.md`, `05-decisoes.md`, `extract-funcoes.md` (V01–V39, E01–E46, S01–S26) e `extract-regras-api.md` (R01–R129, A1–A23). As decisões de 07/10 (sem n8n, WhatsApp Cloud API direto, Oracle Cloud) valem sobre os documentos mais antigos.

Legenda: **✓** coberto por FR · **~** coberto só em texto corrido, nota ou §8, ou pela metade · **✗** sem cobertura.

## Resumo

| Conjunto | Itens | ✓ | ~ | ✗ |
| --- | --- | --- | --- | --- |
| Visitante (V01–V39) | 39 | 37 | 2 | 0 |
| Equipe (E01–E46) | 46 | 40 | 5 | 1 |
| Sistema (S01–S26) | 26 | 24 | 2 (S02; S09 superada) | 0 |
| Automáticos (A1–A23) | 23 | 16 | 4 | 3 |
| **Total** | **134** | **117** | **13** | **4** |

**Sem cobertura (4):** E45 (navegação do painel por aparelho), A14 (encerrar a lista de espera de dia fechado, com mensagem), A20 (validade dos links e tokens), A21 (troca de senha encerra as outras sessões).

**Coberto pela metade (13):** V10, V11, E09, E11, E20, E46, S02, A2, A10, A13, A15, A16 e S09 (superada pela decisão de 07/10, sem pendência).

**FR sem fonte de escopo:** FR-20 (adicionar à agenda do celular, `.ics`) não aparece em 01, 02, 05 nem 10. Vem só do `extract-arquitetura.md` (o que já foi construído). Não contradiz nada, mas vira promessa nova. Ou marcar como "já existe no front" ou tirar do PRD.

---

## 1. Mapa função → FR

### 1.1 Visitante (V)

| ID | FR | Obs. |
| --- | --- | --- |
| V01 | FR-1 | O estado "3D carregando ou indisponível" do 02 sumiu (ver §3.2) |
| V02 | FR-2 | |
| V03 | FR-3 | |
| V04 | FR-4 | Faltam "evento fechado ou de entrada livre fica sem botão", "a seção some sem evento" e "os 2 eventos do protótipo não migram como texto fixo" |
| V05 | FR-5 | |
| V06 | FR-6 | |
| V07 | FR-1 | |
| V08 | FR-7 | |
| V09 | FR-8 | |
| V10 | FR-8 ~ | Falta a regra do 02 de que o **sucesso sempre mostra o que mudou e o próximo passo** |
| V11 | ~ (§4.2 texto) | Abrir em página própria ou link pronto está só no texto. Falta o histórico por etapa (`?etapa=`: o voltar do celular volta uma etapa; no sucesso o histórico é trocado para o voltar não refazer a reserva) |
| V12 | FR-9 | |
| V13 | FR-10 | Faltam os estados "fora da janela", "nenhuma vaga em 30 dias (WhatsApp e Instagram)", "lotado com lista desligada → WhatsApp" e os motivos de fechado (produção, feriado, evento fechado, manutenção) |
| V14 | FR-11 | |
| V15 | FR-12 | |
| V16 | FR-13 | "Lista mostra lugares restantes" não está escrito |
| V17 | FR-14 | Falta o link para a política de privacidade no passo Quem vem |
| V18 | FR-15 | |
| V19 | FR-16 | |
| V20 | FR-17 | Faltam três bloqueios do 02: sessão do cliente vencida (pede o código de novo), sem internet e API fora |
| V21 | FR-17 | |
| V22 | FR-18 | Falta "lista desligada → WhatsApp da casa" |
| V23 | FR-19 | |
| V24 | FR-9 | |
| V25 | FR-50 | |
| V26 | FR-24 | Falta o estado "link inválido ou vencido" |
| V27 | FR-25 | |
| V28 | FR-22 | |
| V29 | FR-23 | |
| V30 | FR-22 (consequência) | |
| V31 | FR-26 | Falta "oferta vencida leva a reservar outro horário" |
| V32 | FR-26 | |
| V33 | FR-28 | |
| V34 | FR-29 | Os rótulos do 02 ("Esperando a casa", "Abriu uma mesa", "Foi", "Não deu dessa vez"…) não são citados (ver §3.1) |
| V35–V39 | FR-30 a FR-34 | |

### 1.2 Equipe (E)

| ID | FR | Obs. |
| --- | --- | --- |
| E01 | FR-81 | Falta "sem sessão vai ao login e volta à tela pedida (só caminhos internos)" |
| E02 | FR-79 | |
| E03 | FR-80 | |
| E04, E05 | FR-81 | |
| E06 | FR-82 | Ver contradição C6 |
| E07 | FR-83 | |
| E08 | FR-45 | **Falta "a semana"** (o 02 dá a semana a dono e gerente em Hoje) e "evento da noite com esperados e chegados" |
| E09 | FR-46 ~ | Só a busca rápida tem FR. Faltam: casa aberta ou fechada agora, relógio, **seletor de dia**, contador de pendentes e menu do usuário na barra do topo |
| E10 | FR-47 | Falta o filtro "sem mesa" (está implícito em FR-57) |
| E11 | ~ | Abrir uma reserva por link `/admin/reservas?r=<id>` (busca, Hoje, Clientes e o aviso de pendente levam para lá). Não tem FR, e o FR-43 depende dele (`{link_painel}`) |
| E12 | FR-55 | |
| E13 | FR-57 | |
| E14 | FR-56 | |
| E15 | FR-48 | Faltam os estados "área fechada" e "área em lista" |
| E16 | FR-49 | Ver contradição C2 (chegou × sentou) |
| E17 | FR-50 | |
| E18 | FR-51 | Ver contradição C2 (liberar × mesa vagou) |
| E19 | FR-52 | |
| E20 | FR-54 ~ | "Acompanhar" não cobre as duas ações da equipe na fila: **virar reserva** com mesa escolhida (R50) e **oferta manual** (R51) |
| E21 | FR-58 | |
| E22 | FR-59 | |
| E23 | FR-60 | |
| E24 | FR-61 | Falta "remarcar ou cancelar todas de uma vez" e o motivo padrão ("A casa não abre nesse dia") |
| E25, E27 | FR-64 | |
| E26, E31 | FR-65 | |
| E28 | FR-66 | Falta "quem chega fora da lista entra se houver lugar" |
| E29, E30 | FR-62 | |
| E32 | FR-67 | Ver contradição C5 (salão e prato do dia) |
| E33 | FR-68 | |
| E34 | FR-69 | Falta "voltar a uma versão anterior" do conteúdo (o 02 e a API têm versões e restaurar) |
| E35 | FR-70 | |
| E36–E38 | FR-71 a FR-73 | |
| E39 | FR-75 | |
| E40 | FR-76 | A API também exporta o registro, e o FR não cita |
| E41, E42 | FR-77 | Falta "ver convite pendente" |
| E43 | FR-78 | |
| E44 | FR-84 | |
| **E45** | **✗** | Menu lateral (computador e tablet deitado) e barra inferior com "Mais" (celular e tablet em pé). Só aparecem soltos o "salão vira lista" (FR-48) e "plantas a partir de 768 px" (FR-62) |
| E46 | ~ | Só "sem internet", "desatualizado" e "412" estão no PRD (§4.6). Faltam 403 "Essa parte é de outro papel", 404 com volta para Hoje e "Algo deu errado nesta tela" |

### 1.3 Sistema (S)

| ID | FR | Obs. |
| --- | --- | --- |
| S01 | FR-15 | |
| S02 | ~ (§4.2 "o sistema calcula as vagas") | Não há FR para o cálculo: mesas reserváveis, mesas guardadas e limite de chegadas aplicados na vaga, junção, alocação pela menor sobra, "últimos horários". Fica para 04, mas o PRD não aponta |
| S03 | FR-35 | |
| S04 | FR-36 | |
| S05 | FR-17, FR-74 | |
| S06 | FR-21 | |
| S07 | FR-22 | |
| S08 | FR-22, FR-23 | |
| S09 | — | Superada em 07/10 (sem plano B; FR-90). O 10 já foi alinhado. Sem pendência |
| S10 | FR-38 | |
| S11 | FR-39 | |
| S12 | FR-40 | Ver contradição C1 |
| S13 | FR-27 | |
| S14 | FR-61 | |
| S15 | FR-60 | |
| S16 | FR-37, FR-42, FR-52 | |
| S17 | FR-78 | |
| S18 | FR-73 | |
| S19 | FR-81 | |
| S20 | §4.3, FR-24 | |
| S21 | FR-34, FR-75 | |
| S22 | FR-3, FR-67 | |
| S23 | FR-2 | |
| S24 | §4.6 | |
| S25 | §4.6 | |
| S26 | FR-86 | |

### 1.4 Comportamentos automáticos (A)

| ID | FR | Obs. |
| --- | --- | --- |
| A1 | FR-37 | Falta a mensagem "pendente vencido" ao cliente |
| A2 | FR-38 ~ | Falta o gatilho "planta com mais lugares dispara ofertas" (R92) |
| A3, A4 | FR-39 | Falta a mensagem "oferta vencida" com link para outro horário |
| A5 | FR-22 | |
| A6 | FR-41 | |
| A7 | FR-22, §10.2 | Agora pelo webhook da Meta (addendum), sem n8n |
| A8 | FR-40, FR-42 | |
| A9 | FR-42 | |
| A10 | FR-21, FR-27 ~ | Os FRs cobrem confirmação, pendente e ações da casa. **Faltam as mensagens de entrar na lista de espera, pendente vencido, oferta vencida, cancelamento feito pelo cliente e remarcação feita pelo cliente.** Todas estão no 04 e precisam de aprovação da Meta |
| A11 | FR-43 | |
| A12 | FR-15 | |
| A13 | FR-27 ~ | Falta dizer que avisar os afetados é uma escolha na hora de gravar (`notify_affected`), não automático |
| **A14** | **✗** | Ao fechar um dia, a lista de espera é encerrada com mensagem (04) |
| A15 | §8 ~ | Apagar o dado de saúde 30 dias depois é tarefa agendada do backend, mas só aparece como qualidade. Sem FR, ninguém constrói |
| A16 | §8 ~ | Mesmo caso: anonimizar depois de 24 meses. A addendum já lista o gatilho como lacuna |
| A17 | FR-71, FR-42 | |
| A18 | FR-70 | |
| A19 | FR-17 | |
| **A20** | **✗** | Validade: links do cliente 30 dias (410), convite 72 h, troca de senha 30 min, primeiro acesso de uso único |
| **A21** | **✗** | Trocar a senha encerra as outras sessões. A API também lista e revoga sessões, e isso não está no PRD nem no inventário |
| A22 | FR-78 | |
| A23 | FR-86 | |

---

## 2. Promessas do `10-escopo-modulo-1.md`

| Promessa do 10 | No PRD? |
| --- | --- |
| Página inicial (capa, sobre, cardápio, eventos, lojinha, localização, horários) | ✓ FR-1 |
| "Hoje na casa" (prato do dia, regra do dia, aviso) | ✓ FR-3 |
| Lojinha com "Pedir pelo direct"; troca de peças = suporte | ✓ FR-5 |
| Conteúdo editável: textos, avisos, cardápio, prato do dia, eventos com fotos, **horários** | ~ Horários ficam em FR-84 só para o dono (Q8 aberta). O 10 lista horários como "conteúdo editável pela casa" |
| Banco de fotos, escolhendo onde cada foto aparece | ✓ FR-70 (lacuna da API registrada) |
| Reserva por horário, combinados, lista de espera, oferta automática | ✓ FR-9 a FR-18, FR-38 |
| Confirmação e lembrete com os 3 botões | ✓ FR-21, FR-22 |
| Área do cliente: ver, remarcar, mudar pessoas, cancelar | ✓ FR-28 a FR-32 |
| Caixa "quero receber novidades", separada | ✓ FR-16 |
| Painel do salão: quem chega, atrasado, mesas livres | ✓ FR-45, FR-48 |
| Agenda mês a mês com plano do dia | ✓ FR-59 |
| Várias plantas e junção de mesas | ✓ FR-62 |
| Eventos: mesa, lista ou os dois, com check-in | ✓ FR-65, FR-66 |
| Acesso por papel; registro; tablet aparece como "Salão" | ✓ FR-77, FR-78 |
| Publicação no domínio com HTTPS | ✓ FR-85 |
| Planta real cadastrada pelo Matheus | ✓ §5, nota da FR-62 |
| Noite simulada com a equipe | ~ Aparece só em §5 e SM-4. Não está como entrega nem como etapa |
| **30 dias de correção de defeitos após a publicação** | **✗ Não aparece** |
| **Definição de defeito** ("diferente deste documento e das telas aprovadas; pedido novo não é defeito") | **✗ Não aparece** |
| **Etapas e aceite** (Telas → Sistema real → Noite simulada → Publicação, cada uma com seu aceite) | ~ Só pedaços em §5 e SM-4. A sequência e os aceites somem |
| R$ 5.000, 50% na assinatura e 50% na publicação | ~ §5 cita só "50% do valor" na assinatura. O valor e a parcela da publicação não aparecem |
| Mensalidade R$ 100: correção, atualização, backup, acompanhamento, 2 h/mês | ~ FR-86 a FR-88 e "2 h/mês" em §6. O valor e o item "correção de qualquer problema" não aparecem |
| Mensalidade revista se a casa contratar outros módulos | ✗ |
| WhatsApp ~R$ 0,04 por mensagem, R$ 10–40/mês, cartão da casa | ✓ §8 |
| Servidor e banco começam grátis; **se precisar de plano pago, Matheus avisa antes com o valor e a casa decide** | ~ §8 diz "começa em planos gratuitos", mas não registra o compromisso de avisar antes |
| Prazo de 8 semanas, contado a partir da entrega dos itens da casa | ~ §10 Q5 cita 8 semanas. A regra "conta a partir de quando a casa entregar" não está (§5 só diz que a assinatura inicia o prazo) |
| Sobre o WhatsApp: verificação não trava a abertura | ✓ FR-90 |
| LGPD: controlador, operador, política, painel encontra e apaga | ✓ §8, FR-7, FR-75 |
| Decisões 1–8, 12, 14–17, 19–27 com os padrões | ✓ espalhadas (FR-9, 10, 22, 36, 40, 50, 59, 61, 62, 65, 73, 84) |
| Ajuste no painel × regra do sistema por decisão; **não criar controle no painel para D-20, D-24, D-25, D-27** | ~ O glossário define os dois tipos, mas o PRD não diz qual decisão é qual. FR-84 fala em "decisões de ajuste no painel" sem a lista |
| D-26 é ajuste no painel (ligar ou desligar o prato do dia no "Hoje na casa") | ~ FR-3 e FR-67 não têm a chave. A addendum registra a lacuna |
| Fase 1 da proposta de 30/09; fases 2 e 3 sem compromisso | ✓ §1, §7 |

---

## 3. O que a estrutura de FRs deixou cair

### 3.1 Voz da casa nas mensagens e na tela
- O 04 tem a tabela **"Mensagens (rascunho, na voz da casa)"**, com 14 textos ("Pode entrar, {nome}!", "Tá de pé?", "Cancelado. Obrigado por avisar!", "Dessa vez não deu…", "Chama a gente no WhatsApp que a gente ajeita"). O PRD diz que "os textos são fixos" (FR-21 a FR-27) mas **não aponta para essa tabela nem fixa o tom**. Quem constrói os templates para a Meta pode escrever no tom de sistema.
- Regra `{dia_com_artigo}` ("hoje", "amanhã", "na quarta", "no sábado") não aparece.
- Rótulos de status para o cliente (02): Confirmada, Esperando a casa, Na lista de espera, Abriu uma mesa, Foi, Cancelada, Não deu dessa vez, Venceu, Não veio. A FR-29 diz só "linguagem simples". O glossário do PRD usa outros nomes (pendente, oferecida, recusada, vencida, concluída), que servem para a equipe. Falta separar a voz do painel da voz do cliente.
- Textos de tela com tom definido: "Li e tá combinado" (está na UJ-1), "Não vou conseguir", "Essa parte é de outro papel", "Algo deu errado nesta tela", "A casa ainda está sendo cadastrada" (está na FR-83), "Alguém mudou isso agora. Recarregar" (está em §4.6). Só parte está no PRD.
- **"Regra de reserva é cuidado com quem espera, nunca ameaça"** (01). É a regra de tom mais importante para tolerância, cancelamento, bloqueio e falta, e não está no PRD. A SM-C1 chega perto ("o cliente que se sente vigiado"), mas como métrica, não como regra de texto.

### 3.2 Visual aprovado
- §1 diz "papel e ferro", migrado sem redesenho. Faltam a definição (papel é a superfície, a esquadria de ferro é a grade, terracota é seleção e carimbo) e **a referência: os prints aprovados da proposta**. Sem isso, "sem redesenho" não é testável.
- O critério de defeito do 10 inclui "as telas aprovadas". O PRD não liga o visual ao aceite.
- Estado "3D carregando ou indisponível" na página inicial (02) sumiu. Segundo o `extract-arquitetura`, o 3D saiu da lojinha, que agora é a vitrine de manequins. O PRD não registra nenhum dos dois.
- "Cada tela tem os estados carregando, vazio e erro" (02, regra geral) não aparece.
- URLs em português para quem usa, código em inglês (02) não aparece.

### 3.3 Regras de conteúdo (01) — nenhuma está no PRD como regra
- Todo fato (preço, horário, prato) tem fonte (legendas, destaques ou o Marcus). O que não tem fica "a confirmar". O PRD só mostra o efeito na FR-6 ("preço a confirmar").
- **Nada de texto em outra língua como enfeite.** Pesa num izakaya, onde a tentação de usar japonês decorativo é grande.
- Nada de oferta que a casa não tem mais (drinks autorais, chopp) nem de parceiros antigos.
- Nada que diminua a casa ("pequena", "poucas mesas"). Vale também para o texto de "últimas mesas" e "lotado".
- Sugestão: um §8 "Conteúdo e tom" com essas 5 regras + a tabela de mensagens do 04 como fonte.

### 3.4 Acessibilidade e celular
- §8 só tem a suposição WCAG 2.1 AA. As fontes já fixam algumas coisas:
  - texto alternativo obrigatório em toda foto (está na FR-70);
  - erros por campo, em português, legíveis por leitor de tela (03);
  - lista na porta com busca e **botões grandes** (02);
  - o voltar do celular volta uma etapa da reserva (02, `?etapa=`).
- O axe já roda nos testes do catálogo (`extract-arquitetura`). Dá para tirar o WCAG de "suposição" e ligar ao que já é medido.

### 3.5 Outros itens qualitativos que sumiram
- Desempenho e busca: SEO, conteúdo gravado no HTML e Lighthouse estão no plano de construção. O PRD diz "funciona sem JavaScript" (§4.1), mas nenhuma fonte de escopo afirma isso. O 02 diz só que, sem API, o cardápio é o do build. Conferir antes de virar promessa.
- "A máquina gratuita da Oracle é só do Território" e "deploy sempre com confirmação antes de rodar" (01).
- Endereço da casa (01). Útil para a seção de localização e a política de privacidade.
- `/_ds/` (catálogo do design system) só em desenvolvimento e demonstração. Não precisa de FR, mas vale uma linha no PRD.

---

## 4. Contradições

### Com as fontes

| # | Onde no PRD | O que diz | Fonte | O que vale |
| --- | --- | --- | --- | --- |
| C1 | FR-40, UJ-4 | "Marcar como atrasada **quem passou da tolerância**"; "quem passou da tolerância aparece como atrasado" | 04 › Andamento da noite: **Atrasada = depois do horário até a tolerância**; depois disso é "Passou da tolerância", e a equipe escolhe "chegou" ou "liberar mesa" | 04. Reescrever a FR-40 com os três estados (aguardando, atrasada, passou da tolerância) |
| C2 | FR-51, FR-52, nota da FR-42 | "Liberar a mesa" e "Marcar não veio" como ações soltas; "os documentos não dizem quem marca não veio" | 04: **"Liberar mesa" (passou da tolerância) → `no_show` com falta**; **"Mesa vagou" → `release`, sem falta**; a transição `confirmed → no_show` é feita pela "casa ou sistema". Ou seja, o 04 diz que a equipe marca, pela ação "liberar mesa" | 04. Separar FR-51 em "Mesa vagou" (sem falta) e "Liberar mesa / não veio" (com falta). A Q4 fica só sobre o fechamento automático e sobre se o salão pode marcar. Faltam também "Sentou" (para quem chegou e esperou) × "Chegou" na FR-49 |
| C3 | Glossário "Decisão da casa" | "cada uma das 29 escolhas… ajuste no painel ou regra do sistema" | 10: 22 decisões na tabela; 9, 10, 11, 13, 18, 28 e 29 ficam fora | 10. Dizer "22 decisões no módulo 1" |
| C4 | §8 Custo | "Mensagens do WhatsApp são o único custo de uso previsto" | 10: servidor e banco também são custo de uso, se saírem do plano gratuito, com aviso prévio | 10 |
| C5 | FR-67 | Salão ✓ em "escolher o prato do dia" | 02: salão só "ligar e desligar prato"; API: salão só `PATCH items` com `available` | Fontes, até alguém decidir o contrário. Ou ajustar a API |
| C6 | §8 Segurança × FR-82 | §8: "**dono** pode ligar duas etapas"; FR-82: dono, gerente e salão | 02 › `/admin/conta`: todos os papéis; o 10 não cita duas etapas (C10 do inventário) | Inconsistência interna. Alinhar §8 com FR-82, e confirmar se duas etapas entra (o 10 não promete) |
| C7 | FR-45 | Hoje sem "a semana" | 02: dono e gerente veem a semana em Hoje | 02. Acrescentar |
| C8 | UJ-1 | "o **dia** mostra 'últimas mesas'" | 02: o dia mostra "últimos horários"; "últimas mesas" é o estado do **horário** | Termo do 02 |

### Com as decisões de 07/10 (registro de decisões da época)

| # | Onde | O que diz | Decisão de 07/10 |
| --- | --- | --- | --- |
| C9 | addendum › "Arquitetura já decidida" | "backend em FastAPI + Supabase + **n8n** + WhatsApp Cloud API" | Sem n8n. O próprio addendum desmente isso três parágrafos abaixo. Tirar o n8n do resumo |
| C10 | addendum › "O que o plano gratuito muda" | "Cabeçalhos de segurança e cache saem do nginx e vão para o provedor"; "o plano previa VPS…" | Oracle Cloud Always Free **mantém o nginx** ("esquema do Dionísio"). O item vale para hospedagem de contêiner, que foi descartada. Reescrever a seção para a VM da Oracle (o que muda: só o backup do Supabase grátis e a pausa por inatividade) |
| C11 | `extract-arquitetura.md` e `extract-regras-api.md` (A7, integrações, tag Interno) | n8n como ponte, `X-Signature` HMAC | Superados. O addendum já registra que `/internal/whatsapp/replies` muda para o webhook da Meta (`X-Hub-Signature-256`). Os extracts não foram corrigidos; avisar quem for ler |

No `prd.md` não há contradição com as decisões de 07/10. O §10 (itens 1 a 3), FR-90 e §6 estão alinhados (sem n8n, Cloud API direto, Oracle).

---

## 5. O que fazer no PRD (ordem sugerida)

1. Corrigir C1 e C2 (FR-40, FR-49, FR-51, FR-52, nota da FR-42). Mexem nas regras da noite e na métrica de faltas.
2. Acrescentar em §5/§6 o que o 10 promete e sumiu: 30 dias de correção, definição de defeito, as 4 etapas com aceite, valores, aviso antes de plano pago, regra de início do prazo.
3. Criar FRs para A14, A15, A16, A20 e A21, e para E09 (barra do topo), E11 (reserva por link), E20 (virar reserva, oferta manual) e E45/E46 (navegação e telas gerais).
4. Completar a FR-27/A10 com as cinco mensagens que faltam e apontar para a tabela de mensagens do 04 como fonte do tom.
5. Criar §8 "Conteúdo e tom" (regras do 01 + "cuidado, nunca ameaça" + rótulos do cliente) e definir "papel e ferro" com a referência dos prints aprovados.
6. Listar quais decisões são regra do sistema (D-12, D-20, D-23, D-24, D-25, D-27), sem controle no painel.
7. Limpar o addendum (C9, C10) e decidir se FR-20 (`.ics`) fica.
