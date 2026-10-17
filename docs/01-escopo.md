# Escopo

> **Superado em 14/10.** Vale o PRD de 14/10 (`territorio/docs/planejamento/prds/prd-territorio-modulo-1-2026-10-14/`), a arquitetura (AD-1…AD-37) e a revisão geral (`territorio/docs/planejamento/revisao-2026-10-14.md`). Diferenças conhecidas: endereço Aporã, Vila A → Ipê, CEP 85869-090; Entrar com Google fora → dentro do módulo 1.

Site e sistema de reservas do **Território**, izakaya em Foz do Iguaçu (Rua Sérgio Roncato, 703 · Conj. Res. Aporã · Vila A). Proposta aprovada em 30/09/2026. Este repositório é a **fase 1** da implantação.

## O que entra

**Aprovado na proposta (fase 1)**

- Site com capa, cardápio, apresentação da casa e localização.
- Reserva por horário, com combinados e lista de espera.
- Confirmação e lembrete no dia pelo WhatsApp.
- Painel do salão e cadastro das mesas.

**Pedido na abertura do projeto**

- Login da equipe, papéis e convites.
- Conteúdo do site editável pela casa (textos, avisos, cardápio, eventos).
- Galeria de fotos.
- Registro das ações do painel.

**Acrescentado no plano (entra no módulo 1, ver [10-escopo-modulo-1.md](10-escopo-modulo-1.md))**

- Várias plantas das mesas (por dia e por evento), plano do dia e eventos com lista na porta: a casa muda o salão conforme o dia, a procura e os muitos eventos.

## O que fica para depois

| Item | Quando |
| --- | --- |
| Comanda digital, impressão dos pedidos na cozinha | Fase 2 da proposta |
| Tela da cozinha, histórico de visitas e convites para eventos | Fase 3 da proposta |
| Lojinha com pagamento | Fase 3 da proposta (nesta fase: vitrine com "Pedir pelo direct") |
| Sinal por Pix, almoço de sábado, Entrar com Google, e-mail para cliente | Só se a casa decidir (ver [05-decisoes.md](05-decisoes.md)) |

## Como vamos construir

1. **Front-end primeiro**, sobre uma API simulada que segue o contrato da API real ([api/openapi.yaml](api/openapi.yaml)).
2. **Validação com o Marcus** usando dados fictícios: ele preenche o cadastro da casa, faz uma reserva e opera uma noite simulada.
3. **Backend depois**, no mesmo formato que a casa vai usar em produção (ver abaixo). Trocar o mock pelo backend não muda nenhuma tela.

## Onde vai rodar

- **Servidor:** máquina virtual gratuita da Oracle Cloud ("Always Free", região São Paulo), com nginx na frente (HTTPS com certbot), repassando para um processo `uvicorn` (FastAPI) gerenciado pelo systemd.
- **Front e API no mesmo domínio:** o FastAPI serve o front (o `dist/` gerado pelo Vite) e a API em `/api/v1`; o painel fica em `/admin`, no mesmo domínio, como no Dionísio. Sem CORS, e o cookie de login fica no próprio domínio.
- **Banco:** Supabase (Postgres, região São Paulo). As migrações são arquivos SQL numerados, rodados no SQL Editor do Supabase.
- **Mensagens:** o backend fala direto com a WhatsApp Cloud API, sem n8n; lembretes e ofertas rodam num agendador dentro do backend.
- **Publicação:** script de deploy (cópia por scp e reinício do serviço), sempre com confirmação antes de rodar.

A máquina gratuita da Oracle é só do Território.

## Base visual

O site e o fluxo aprovados ("papel e ferro": papel é a superfície, a esquadria de ferro é a grade, terracota é seleção e carimbo) são migrados, não redesenhados. A referência são os prints aprovados da proposta.

## Regras de conteúdo

- Todo fato (preço, horário, prato) tem fonte: legendas, destaques ou o Marcus. O que não tem fica "a confirmar".
- Nada de texto em outra língua como enfeite.
- Nada de oferta que a casa não tem mais (drinks autorais, chopp) nem de parceiros antigos.
- Nada que diminua a casa ("pequena", "poucas mesas").
- Regra de reserva é cuidado com quem espera, nunca ameaça.
