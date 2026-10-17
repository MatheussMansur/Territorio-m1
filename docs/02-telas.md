# Mapa de telas

> **Superado em 14/10.** Vale o PRD de 14/10 (`territorio/docs/planejamento/prds/prd-territorio-modulo-1-2026-10-14/`), a arquitetura (AD-1…AD-37) e a revisão geral (`territorio/docs/planejamento/revisao-2026-10-14.md`). Diferenças conhecidas: reserva em 3 etapas → uma página que flui em `/reservar`; Entrar com Google fora → dentro do módulo 1 (Minhas reservas entra por código no WhatsApp ou Google); perfil do salão com senha → aparelho aprovado + PIN (últimos 4 dígitos do telefone); painel atualizado por consulta → tempo real por SSE (aviso do Postgres).

Todas as telas do produto, com a URL. As URLs são em português porque aparecem para quem usa; o código é em inglês. Cada tela tem os estados **carregando**, **vazio** e **erro**; aqui ficam só os estados próprios de cada uma.

## Público

| URL | Tela | Para quê | Estados próprios |
| --- | --- | --- | --- |
| `/` | Landing | Mostrar a casa e levar à reserva | Aberto agora, fechado ou exceção do dia (feriado, evento); "Hoje na casa" com a regra do dia, o prato do dia ligado no Cardápio, um aviso ou a próxima abertura; agenda do Território Convida: próximos eventos (com reserva leva a `/reservar?dia=`; fechado ou de entrada livre fica sem botão) e fotos das edições passadas, e some sem evento; cardápio sem API fica o do build; 3D carregando ou indisponível |
| `/cardapio` | Cardápio | O mesmo cardápio da landing, sozinho, para o QR code das mesas | Prato "acabou"; preço "a confirmar" |
| `/reservar` | Reserva | A janela de reserva em página própria (link da bio); aceita `?pessoas=` e `?dia=` | Todos os da reserva (ver abaixo) |
| `/minhas-reservas` | Minhas reservas | Entrar por código no WhatsApp; ver, remarcar (inclusive o número de pessoas) e cancelar; baixar ou apagar dados | Sem reservas; fora do prazo de cancelar; remarcar sem vaga (nada muda); apagar meus dados (pede confirmação e cancela as reservas futuras); sessão vencida (pede o código de novo) |
| `/r?t=` | Comprovante | Ver a reserva por link, sem login. Com o link de leitura, só vê e compartilha; com o link de ação (da mensagem), também cancela | Confirmada, pendente, na espera, mesa oferecida, recusada, cancelada, vencida, concluída; link inválido ou vencido; cancelar fora do prazo (leva ao WhatsApp da casa) |
| `/confirmar?t=` | Confirmar presença | Alternativa aos botões do WhatsApp: Confirmo, Não vou mais, Vou atrasar um pouco | Já respondido (dá para trocar até o horário); "Não vou mais" pede confirmação; horário já passou |
| `/espera?t=` | Mesa da lista de espera | Aceitar ou recusar ("Não vou conseguir") a mesa oferecida, no prazo da oferta | Contagem; oferta vencida (a mesa foi para o próximo; leva a reservar outro horário); já aceita; recusada |
| `/privacidade` | Política de privacidade | Quem guarda o quê, por quanto tempo, como pedir para apagar | — |
| `/404.html` | Não encontrada | Voltar para o início ou reservar | — |
| `/_ds/` | Catálogo do design system | Todos os componentes em todos os estados | Só em desenvolvimento e demonstração |

### Estados da reserva (janela e `/reservar`)

A janela tem 3 etapas, como no aprovado: **Sua mesa** (pessoas, dia, horário, combinados), **Quem vem** (nome, WhatsApp, código, revisão e Confirmar) e **Comprovante**. Cada etapa grava uma entrada no histórico (`?etapa=`): o voltar do celular volta uma etapa, e no sucesso o histórico é trocado para o voltar não refazer a reserva.

1. **Pessoas:** 1 até o máximo online do dia (8; um evento pode baixar). "9 ou mais" leva ao WhatsApp da casa com a mensagem pronta, como na proposta (ou ao pedido de grupo grande, se a casa escolher).
2. **Dia:** aberto; últimos horários (`few_left`); lotado (leva à lista de espera, ou ao WhatsApp se a lista estiver desligada); fechado com motivo (produção, fechado, feriado, evento fechado, manutenção); entrada livre (evento sem reserva); fora da janela; nenhuma vaga nos próximos 30 dias (WhatsApp e Instagram).
3. **Horário:** tem mesa; últimas mesas; lotado (lista de espera). Horário que já passou, ou a menos de 1 hora, não aparece.
4. **Combinados:** falta marcar "Li e tá combinado". Os combinados mostram o tempo de mesa, a tolerância e o prazo de cancelamento daquele dia e daquele grupo.
5. **Quem vem:** campo com erro; telefone de outro país (Brasil, Paraguai e Argentina; outro país vai para o WhatsApp); aviso de dado de saúde no campo de restrição alimentar; link para a política de privacidade.
6. **Código:** enviado; reenviar (depois de 30 s); código errado; código vencido; tentativas esgotadas; limite de 3 códigos por hora.
7. **Dia de evento:** reserva de mesa, entrada na lista (com lugares restantes) ou só o aviso, conforme o modo do evento.
8. **Confirmar:** enviando; lotou enquanto preenchia (com alternativas); reserva repetida; limite de reservas futuras por telefone; cliente bloqueado (mensagem neutra com o WhatsApp da casa); combinados mudaram durante o preenchimento (mostra de novo); sessão do cliente vencida (pede o código de novo); grupo acima do limite do dia ou do evento; pedido que precisaria de aprovação a menos de 3 horas (leva ao WhatsApp); sem internet; API fora.
9. **Comprovante:** confirmada (com carimbo); pendente (sem carimbo, aguardando a casa); lista de espera (com posição); nome na lista do evento. O botão de compartilhar manda o link de leitura, que não cancela.

### Telas gerais do site

| Situação | O que aparece |
| --- | --- |
| Sem internet | A ação fica desligada, com "Tentar de novo" |
| API fora | O WhatsApp da casa, com a mensagem pronta |
| Sucesso | O que mudou e o próximo passo |

### Como o cliente vê cada status

| Status | Rótulo |
| --- | --- |
| `confirmed` | Confirmada |
| `pending` | Esperando a casa |
| `waitlisted` | Na lista de espera |
| `offered` | Abriu uma mesa |
| `completed` | Foi |
| `canceled` | Cancelada |
| `declined` | Não deu dessa vez |
| `expired` | Venceu |
| `no_show` | Não veio |

Os eventos da agenda vêm só de `/admin/eventos`. Os dois eventos do protótipo aprovado são edições passadas e não migram como texto fixo: a casa cadastra as edições com as fotos.

## Painel da casa

`/admin/` leva ao login. Com sessão: enquanto o cadastro da casa não terminou, o dono vai para ele, e gerente e salão vão a Hoje com o aviso "A casa ainda está sendo cadastrada". Depois, todos vão a Hoje. Uma reserva abre por link em `/admin/reservas?r=<id>` (busca rápida, Hoje, Clientes e o aviso de pedido pendente levam para lá).

| URL | Tela | Dono | Gerente | Salão | Estados próprios |
| --- | --- | --- | --- | --- | --- |
| `/admin/entrar` | Login | ✓ | ✓ | ✓ | Sessão expirada; conta desativada; bloqueio por tentativas |
| `/admin/primeiro-acesso?t=` | Criar a conta do dono | ✓ | — | — | Link vencido ou já usado (conferido antes de preencher) |
| `/admin/convite?t=` | Aceitar convite | — | ✓ | ✓ | Mostra o e-mail e o papel antes de preencher; convite vencido ou já usado |
| `/admin/recuperar-senha` | Esqueci minha senha | ✓ | ✓ | ✓ | Resposta sempre igual |
| `/admin/nova-senha?t=` | Nova senha | ✓ | ✓ | ✓ | Link vencido ou já usado (conferido antes de preencher) |
| `/admin/primeiro-uso` | Cadastro da casa (5 passos) | ✓ | — | — | Passo salvo; faltando itens |
| `/admin/hoje` | Hoje | ✓ | ✓ | a noite, sem a semana e sem pendentes | Nenhuma reserva hoje; casa fechada hoje; o evento da noite com a lista (esperados e chegados); reservas que ficaram sem mesa; desatualizado ("Atualizado às HH:MM") |
| `/admin/reservas` | Reservas | ✓ | ✓ | só hoje | Filtro sem resultado; reservas sem mesa (filtro) |
| `/admin/salao` | Salão ao vivo | ✓ | ✓ | ✓ | Sem internet (ações desligadas); sem reservas ("Sentar sem reserva"); casa fechada hoje; os estados de mesa abaixo |
| `/admin/espera` | Lista de espera | ✓ | ✓ | ✓ | Oferta em andamento; oferta vencida |
| `/admin/agenda` | Agenda e plano do dia | ✓ | ✓ | ver | Mudança que mexe em reservas (simulação antes); fechar dia com reservas (remarcar ou cancelar cada uma antes) |
| `/admin/eventos` | Eventos | ✓ | ✓ | ver | Lista cheia; evento fechado; duplicar evento passado; publicar, mudar ou apagar evento num dia com reservas (simulação antes) |
| `/admin/eventos/porta?evento=<id>` | Lista na porta (feita para o celular) | ✓ | ✓ | ✓ | Busca por nome; chegada de parte do grupo; quem chega fora da lista entra se houver lugar; desfazer chegada |
| `/admin/clientes` | Clientes | ✓ | ver e anotar | só os da noite | Cliente anonimizado |
| `/admin/plantas` | Plantas (mesas por dia e por evento) | ✓ | ✓ | ver | Planta em uso em dia com reserva; planta padrão de um dia da semana |
| `/admin/cardapio` | Cardápio | ✓ | ✓ | ligar e desligar prato | "Tem hoje" e prato do dia valem na hora, sem publicar; nome, preço, ordem e categorias ficam em rascunho até Publicar |
| `/admin/site` | Conteúdo do site | ✓ | ✓ | — | Rascunho; versão anterior |
| `/admin/galeria` | Galeria | ✓ | ✓ | — | Enviando; foto em uso |
| `/admin/equipe` | Equipe | ✓ | — | — | Convite pendente; último dono |
| `/admin/registro` | Registro | tudo | só as próprias ações | — | — |
| `/admin/configuracoes` | Configurações | ✓ | ver | — | Mudança de horário, planta padrão ou tempo de mesa que afeta reservas feitas (simulação antes) |
| `/admin/conta` | Minha conta | ✓ | ✓ | ✓ | Duas etapas ligada ou desligada |

### Permissões por ação

| Ação | Dono | Gerente | Salão |
| --- | --- | --- | --- |
| Aprovar ou recusar pendente | ✓ | ✓ | — |
| Trocar a planta da noite | ✓ | ✓ | — |
| Marcar chegada na porta do evento | ✓ | ✓ | ✓ |
| Ver o telefone completo (fica no registro) | ✓ | ✓ | — (decisão 25) |
| Exportar dados (pede a senha de novo) | ✓ | — | — |
| Mudar o papel de alguém (pede a senha de novo) | ✓ | — | — |

### Estados de mesa no Salão

Os cinco do aprovado (reservada, sentada, atrasada, liberar e livre) e mais: guardada para quem chega sem reserva; provisória de um pedido pendente; oferecida, esperando o aceite da lista de espera; área fechada; área em lista (noite de evento).

## Telas gerais do painel

| Situação | O que aparece |
| --- | --- |
| Sem sessão | Vai para o login e volta para a tela pedida (só caminhos internos) |
| Sem permissão (403) | "Essa parte é de outro papel" e o caminho de volta para Hoje |
| Não encontrada (404) | Caminho de volta para Hoje |
| Erro da tela | "Algo deu errado nesta tela", com recarregar e voltar |
| Sem internet | Faixa fixa no topo; ações que mudam dado ficam desligadas |
| Desatualizado | "Atualizado às HH:MM" quando a atualização automática falha |
| Alguém mudou antes (412) | "Alguém mudou isso agora. Recarregar" |

## Navegação do painel

- **Computador e tablet deitado:** menu lateral com Hoje, Reservas, Salão, Espera, Agenda, Eventos, Clientes, Plantas, Cardápio, Site, Galeria, Equipe, Registro e Configurações.
- **Celular e tablet em pé:** barra inferior com Hoje, Reservas, Salão e Mais; "Mais" abre o resto.
- **Por aparelho:** no celular, o Salão vira uma lista por área; Plantas edita a partir de 768 px (no celular só mostra); a lista na porta é uma lista com busca e botões grandes.
- **Topo:** casa aberta ou fechada agora, relógio, seletor de dia, busca rápida (nome, telefone ou código), pendentes e o menu do usuário.
