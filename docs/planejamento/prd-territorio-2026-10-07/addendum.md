# Adendo técnico do PRD

O que é "como construir" e não cabe no PRD. Vai para a arquitetura.

> Os arquivos `extract-arquitetura.md` e `extract-regras-api.md` foram escritos antes das decisões de 07/10 e ainda citam o n8n como ponte do WhatsApp. Onde discordarem deste adendo, vale o adendo.

## Arquitetura já decidida

Ver `extract-arquitetura.md` §1. Resumo: front em Vite multipágina com HTML, CSS e JS puros e lit-html; uma única camada (`src/services/api/`) fala com a API; API simulada (MSW) até a validação; backend em FastAPI + Supabase (Postgres, região São Paulo) + WhatsApp Cloud API, sem intermediário.

## Decisões de 07/10

- **Servidor:** Oracle Cloud "Always Free" (máquina virtual sempre ligada, região São Paulo). Mantém o esquema do Dionísio: nginx com cabeçalhos de segurança e cache, certbot, uvicorn com systemd, front e API no mesmo domínio (sem CORS, cookie `SameSite=Strict`).
- **Sem n8n:** o FastAPI fala direto com a WhatsApp Cloud API. Lembrete, ofertas, vencimentos, fechamento da noite e limpeza de dados rodam num agendador dentro do backend (por exemplo APScheduler, com as tarefas guardadas no banco para não se perderem num reinício). As respostas dos botões chegam pelo webhook da Meta, assinado com `X-Hub-Signature-256`, com a verificação por GET que a Meta exige. O endpoint `/internal/whatsapp/replies` do contrato muda de formato.
- **WhatsApp:** sem plano B. Sem verificação, a Meta permite cerca de 250 conversas iniciadas pela empresa por dia; a verificação corre em paralelo.

## Riscos do plano gratuito

- **Oracle pode recuperar máquina ociosa:** a Oracle recupera instâncias "Always Free" com uso baixo por vários dias seguidos. Um sistema de restaurante pequeno tem esse perfil. Conferir a regra atual; mitigação: alerta de máquina parada no acompanhamento (FR-87) ou passar a conta para paga sem custo de uso (a regra não vale para contas pagas).
- **Supabase gratuito sem backup diário:** fazer `pg_dump` agendado (na própria máquina ou no GitHub Actions) para um armazenamento grátis, guardar 30 dias e testar a restauração a cada 3 meses (FR-86).
- **Supabase gratuito pausa projeto parado:** em férias longas da casa, pode acontecer. O acompanhamento (FR-87) avisa.

## Lacunas no contrato da API (corrigir antes de congelar a v1)

1. `PATCH /reservations/{code}` sem `party_size` (FR-31).
2. `marketing_opt_in` sem campo na reserva nem endpoint (FR-16).
3. `Event` com uma imagem só (FR-64).
4. `Image.usages` só leitura (FR-70).
5. `Notice` e `TodayRule` sem endpoints (FR-69); sem configuração para o prato do dia aparecer no "Hoje na casa" (FR-3); escolha do prato do dia separada de ligar e desligar prato (FR-67, FR-99).
6. Lançar reserva pela equipe (FR-91) não existe.
7. Matriz papel × operação não formalizada (FR-52, FR-53, FR-56, FR-74, FR-91).
8. Webhook da Meta (formato real, verificação por GET e assinatura) e status das mensagens.
9. Gatilhos das tarefas agendadas: fechar a noite (FR-42), encerrar a lista de dia fechado (FR-96), apagar dado de saúde e anonimizar (FR-97).
10. Texto público da política de privacidade sem bloco de conteúdo.
