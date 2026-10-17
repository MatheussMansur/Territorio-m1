# Revisão · rubric walker · spine de 14/10

- **Alvo:** `ARCHITECTURE-SPINE.md` (AD-1 a AD-34, `updated: 2026-10-14`), contra o PRD de 14/10 (`prd.md`, `configuracoes.md`, `addendum.md`).
- **Método:** `reviewer-gate.md` → passo determinístico (`lint_spine.py`) e depois o checklist do bom spine, item por item. Modo Validate: só relato, o spine não foi editado.
- **Lint:** 7 achados, todos `low`, todos falsos positivos de placeholder (`{{tolerancia_min}}`, `{group}`, `{id}`, `{token}` são texto literal de template/caminho). Nenhum ID duplicado, nenhum AD sem Binds/Prevents/Rule.

## Veredito

**Não passa ainda.** A espinha está boa no núcleo (UoW, outbox, ocupação por `EXCLUDE`, contrato primeiro), mas a rodada de 14/10 deixou quatro divergências reais entre unidades: o caminho de "Chegou" (AD-4 × AD-28 × enum do contrato × PRD FR-44), o período de ocupação da sessão de mesa, o corte da noite (AD-7 × PRD §6 × catálogo A) e o registro que não pode ser apagado mas tem prazo de guarda (AD-11 × AD-19 × FR-60). Mais um bloco de contradições mecânicas fáceis (Python 3.13 × 3.14, CSP × Turnstile).

## Checklist

| Item do checklist | Situação | Nota |
| --- | --- | --- |
| Fixa os pontos reais de divergência e não perde nenhum | **Parcial** | Falta: i18n (forma do texto em 3 línguas), cifra de telefone/e-mail, pedidos do titular, dono do horário de funcionamento, período de ocupação da sessão |
| Cada Rule é aplicável e impede a divergência declarada | **Parcial** | AD-18 não impede o limite por telefone entre noites; AD-26 não define o que é assinado; AD-29 só tem "Futuras" e "Todas" (falta "Sim") |
| Nada no Adiado deixa duas unidades divergirem | **OK com ressalva** | "Formato exato das lacunas do contrato" ok (bloqueado antes de qualquer rota). SMS adiado, mas o catálogo G nasce com "SMS ligado" |
| Tecnologia nomeada é atual | **Parcial** | Stack diz Python 3.14; AD-24 diz `uv python install 3.13`. Sentry e PyJWT sem versão fixa no spine (aceitável: travados no `uv.lock`) |
| Ratifica o código existente (brownfield) | **OK** | `client.js` tem `NO_SESSION` igual ao AD-9; lint de `fetch` existe; `VITE_API_MODE` só em `boot.js`. `static`, `features/` e `src/admin/` ainda não existem (o spine diz que entram) |
| Cobre as capacidades do spec | **Parcial** | Ver `review-cobertura-prd-1410.md`: FR-29 (pedido do titular), FR-67 (consentimento), FR-1 (i18n), FR-78 (desfazer `no_show`), FR-79 (lançar ações do papel com hora real) sem AD |
| Não contradiz spine-pai | n/a | Não há spine-pai |
| Toda dimensão da altitude decidida, adiada ou em aberto | **Parcial** | Operação bem coberta (AD-14, 16, 20, 24, 33, 34). Silêncio: i18n, retenção do próprio registro, política de sessão (durações), cabeçalhos de segurança além de CSP |

## Achados

### Críticos

1. **"Chegou" tem três caminhos e dois status de destino.** AD-4 cria o comando `check_in`; o enum `ReservationAction` do `openapi.yaml` (que AD-4 manda ter "um comando por valor") tem `arrived` e `seated`; AD-28 faz a sessão nascer do `check_in`; o addendum tem `POST /floor/sessions` e `/staff/floor/walk-ins`. O PRD FR-44 diz que a reserva fica `completed` na hora; a tabela de transições de `04-regras-reserva.md`, que AD-4 manda seguir, só permite `confirmed → completed` "chegou e a noite fechou". Duas histórias podem obedecer AD-4 e uma gravar `arrived_at` sem sessão, outra abrir sessão e completar.
   - **Correção:** emendar AD-4: tirar `arrived` e `seated` do enum (ou declarar que `arrived` **é** o `check_in`), uma única rota para "Chegou", e atualizar a tabela de transições com `confirmed → completed` no `check_in` e `completed → confirmed` só no `undo_check_in` (15 min, grupo `salao`, sessão sem nada pendurado).

2. **Período de ocupação da sessão de mesa indefinido.** AD-6 define ocupação como `tstzrange` da reserva (horário + tempo de mesa); AD-28 só diz que a linha "passa a apontar também para a sessão". Não diz qual é o período de um walk-in, de uma sessão que passa das 2 h, nem de uma troca de mesa no meio do serviço. Quem escrever `domain.floor` e quem escrever `domain.availability` vão escolher limites diferentes, e o `EXCLUDE` deixa de proteger o que a recepção vê.
   - **Correção:** novo item no AD-28 (ou AD-6): na abertura da sessão o período vira `[seated_at, seated_at + tempo de mesa)`; ao estourar, não se estende (a tela marca "para liberar", FR-47) e a próxima reserva continua valendo; `release` grava `released_at = left_at`; troca de mesa = soltar e inserir `[agora, fim original)`. Walk-in: `[agora, agora + tempo de mesa)` limitado ao início da próxima reserva da mesa (FR-45 "livre até HH:MM").

3. **Corte da noite contradiz o PRD.** AD-7: corte = `closes_at` do plano do dia ou 06:00, o que vier primeiro. Numa noite que fecha 23:00, às 23:30 `night_of(agora)` já é amanhã, mas a casa ainda está servindo e o `night_close` (FR-78) só roda à meia-noite. PRD §6: "a virada depois da meia-noite pertence ao dia de abertura"; catálogo A: virada às 05:00 (Dev, 00:00–08:00).
   - **Correção:** AD-7: corte = configuração `house.night_cutover` (padrão 05:00), independente do fechamento; `night_close` roda em `closes_at + atraso` mas a "noite de hoje" só vira no corte.

4. **O registro não pode ser apagado e tem prazo de guarda.** AD-11: `territorio_app` sem `DELETE` no registro, barrado por gatilho. AD-19 `retention_sweep` (que roda no processo da API como `territorio_app`) apaga "registro de ações" no prazo; FR-60 e catálogo M: 12 meses. Uma das duas histórias vai falhar ou abrir um buraco no gatilho.
   - **Correção:** AD-11: a poda do registro é uma função `SECURITY DEFINER` dona `territorio_owner` (`app.prune_audit(before date)`), única exceção ao gatilho, chamada pela `retention_sweep`; ou partição mensal e `DROP PARTITION` pela migração/timer.

### Altos

5. **AD-29 ignora a terceira categoria do catálogo ("Sim").** Horários, dias abertos, horários de chegada e intervalo (catálogo B e C) recalculam reservas e passam pela simulação de FR-51. AD-29 só tem "Futuras" e "Todas"; o contrato já tem `dry_run`/409 em `/staff/settings/{section}`. **Correção:** AD-29: grupo marcado "Sim" grava só pelo mesmo caminho de AD-25 (`simulation_hash`, `409 plan_changed`, cada reserva por `move_tables`/`reschedule`).
6. **Dois donos para o horário de funcionamento.** Catálogo B ("Abertura e fechamento por dia", "Dias abertos") seria grupo de `domain.settings`; FR-53 diz que a semana padrão (planta e horários por dia) é a única fonte, e o spine põe `day_plans` em `domain.plans`. AD-7 lê `closes_at` do plano do dia. **Correção:** declarar que a semana padrão e o plano do dia são donos de horários e planta (`domain.plans`), e que o grupo `horarios` das configurações é só a tela desse dono, sem linha em `settings`.
7. **Nomes de grupo de configuração em duas línguas.** O spine usa `salao`, `mensagens`, `espera`, `privacidade`, `acesso`; o contrato tem `section: [house, hours, booking, terms, privacy]`; a convenção diz código em inglês. **Correção:** lista fechada dos 17 grupos em inglês num enum `SettingsGroup` do `openapi.yaml`, referenciada por AD-19 e AD-29.
8. **AD-24 × Stack: Python 3.13 × 3.14.** **Correção:** AD-24 → `uv python install 3.14`.
9. **CSP `script-src 'self'` (AD-14) quebra o Turnstile (AD-33) e o "tema antes da primeira pintura" (FR-2).** **Correção:** AD-14: `script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com`, e o script de tema como arquivo próprio bloqueante no `<head>` (sem inline).
10. **AD-18 não impede o limite por telefone entre noites.** A trava é a linha de `nights`; duas abas reservando noites diferentes travam linhas diferentes e furam `max_active_per_phone`. **Correção:** AD-18: criação com telefone também trava a linha de `customers` (ordem: cliente → noites em ordem crescente de data → reservas, emendando AD-17).
11. **Sessão SSE × assinatura do aparelho.** AD-26 exige assinatura em toda requisição da sessão de aparelho; `EventSource` não manda cabeçalho. **Correção:** AD-27: o stream é aberto por `fetch` com corpo em fluxo (mesma porta de API, assinado), ou por um bilhete de curta duração emitido por `POST /staff/stream/ticket` assinado.
12. **Registro com "antes e depois" (AD-29, FR-76) × registro "só ids" (AD-11).** **Correção:** AD-11: coluna `diff jsonb` só com campos do catálogo marcados não pessoais; telefone/nome de cliente e números pessoais da equipe viram `"<alterado>"`; o teste de PII cobre `diff`.
13. **Anonimizar "sem mensagem" (AD-11) × FR-29 "cancela avisando" e cria pedido com prazo de 15 dias.** Não existe entidade de pedido do titular. **Correção:** AD novo ou emenda a AD-11: `privacy_requests(kind, status, due_at)` com dono `domain.customers`; o cancelamento das futuras passa pelo comando `cancel` de AD-4 com `notify_customer=true`; a confirmação vai pela outbox.

### Médios e baixos

Mais 14 no corpo das outras duas lentes: dedupe da outbox × reenvio (AD-5), `MessageLog` × outbox como dois donos do status, foto original servida publicamente com EXIF (AD-13 × FR-65), ordem de travas entre várias noites, `undo no_show` sem comando, `NO_SESSION` sem pareamento/vitals/consentimento, catálogo AD-19 sem lembrete relativo à reserva, durações de sessão sem dono, retenção de logs 14 × 30 dias, restauração trimestral × semanal, Lighthouse/gitleaks/ZAP fora do `publish.sh`, service worker do painel × "SW só no demo" (AD-14 × AD-32), `/webhooks/whatsapp` sem `/api/v1` no catálogo de configurações, Nanum Pen × Nanum Pen Script.
