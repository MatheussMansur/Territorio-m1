# Cookies, lembrança e medição: regras para todos os módulos

Vale para o site, a reserva, o painel da casa, a operação (módulo 3), a nota (módulo 4), o financeiro (módulo 5) e a lojinha (módulo 6). A LGPD trata cookie e dado guardado no navegador do mesmo jeito ("cookies e tecnologias semelhantes"), então as regras abaixo valem para os dois.

## 1. Uma lista só

- Todo cookie e todo dado guardado no navegador está em `src/lib/cookie-registry.js`, com:
  - nome;
  - tipo (`cookie` ou `storage`);
  - quem escreve (`page` ou `server`);
  - categoria;
  - prazo;
  - para que serve, em português, espanhol e inglês.
- Nada é escrito fora dessa lista. A página escreve só por `src/lib/cookies.js`, e o teste `tests/unit/cookies.test.mjs` falha se algum arquivo escrever `document.cookie` direto ou usar um nome `trt_`/`trt:` que não está na lista.
- A tabela de cookies da política de privacidade é gerada da mesma lista. Mudou a lista, mudou a política.
- Um cookie novo entra na lista **antes** de entrar no código.

## 2. As três categorias

| Categoria | O que é | Quando liga | Exemplos |
|---|---|---|---|
| **Necessários** | Sem eles a página não funciona, ou a pessoa pediu (escolheu o tema, entrou com o código) | Sempre | `__Host-trt_sessao` (cliente), `__Host-trt_equipe` (equipe), `__Host-trt_aparelho`, `trt_consent`, `trt_tema` |
| **Lembrar de mim** | Os dados da própria pessoa guardados **só no aparelho** para preencher a próxima vez | Depois do sim (banner ou caixa "lembrar neste aparelho") | `trt:lembrar` (nome, WhatsApp, tamanho do grupo) |
| **Medição** | Como o site é usado, com números aleatórios no lugar da pessoa | Depois do sim no banner | `trt_vis`, `trt_visita`, `trt:medida` |

- **Não existe categoria de divulgação.** Sem pixel de anúncio, sem cookie de terceiros, sem Google Analytics (PRD FR-66).
- "Aceitar" e "Recusar" têm o mesmo tamanho. Nada vem marcado. "Cookies", no rodapé, reabre a escolha já nas categorias.
- Recusar ou desligar uma categoria **apaga na hora** o que ela guardou (`forgetCategory`).
- A escolha vale para a versão da política (`privacy.json` → `version`). Mudou a política, as categorias opcionais desligam até a pessoa escolher de novo.
- A escolha vai para `POST /consents` com um id aleatório, a versão e o sim/não de cada categoria. Nunca IP, nome ou telefone.

## 3. Cookies do servidor

- Sempre `__Host-` (sem `Domain`, `Path=/`, `Secure`).
- Sessão e aparelho: `HttpOnly`. Equipe com `SameSite=Strict`; cliente com `SameSite=Lax` (o link do WhatsApp precisa abrir com a sessão).
- `__Host-trt_sessao` (cliente, `SameSite=Lax`): até fechar o navegador; 90 dias com "Lembrar este aparelho". Sair encerra no servidor.
- `__Host-trt_equipe` (equipe, `SameSite=Strict`): até fechar o navegador ou a pessoa sair do aparelho.
- `__Host-trt_aparelho`: aparelho da equipe aprovado pelo dono, 12 meses. Nunca existe no celular de cliente.

## 4. Lembrar de mim

- Fica no navegador (`storage`), **não** em cookie: não viaja a cada pedido ao servidor.
- Guarda só o que a pessoa digitou para ela mesma: nome, WhatsApp, tamanho do grupo. Prazo de 6 meses, contado da última gravação.
- A caixa "Lembrar meu nome e WhatsApp neste aparelho" é o consentimento dessa categoria, registrado como o banner (`setCategory`). Desmarcar apaga.
- Sem essa categoria, o formulário vem vazio. A sessão do código continua funcionando, porque ela é necessária.

## 5. Medição

- Só depois do sim. Antes disso, `track()` não faz nada e nenhum cookie de medição existe.
- Os eventos vão para a própria API (`POST /measure`), que guarda no Brasil e pode repassar ao Umami da própria VM. Nada vai a terceiros.
- **Nunca texto livre.** Os valores são números, booleanos ou códigos curtos (`^[\w:./+-]{0,40}$`). Nome, telefone, e-mail e observação não passam: `clean()` descarta e o servidor recusa.
- `trt_vis` (aleatório, 12 meses) conta quem volta. `trt_visita` (aleatório, 30 minutos parado) junta uma visita.
- Os eventos estão em `EVENTS` (`src/lib/measure.js`) e no contrato (`MeasureEventName`). Evento novo entra nos dois.
- Registros por visita: 12 meses; depois, só os totais (política, "Por quanto tempo").
- Procedência: a marca `?de=` dos links da casa (bio, QR, Google) ou o site de origem; sem nada, "direto".
- O que a casa quer saber e o evento que responde:
  - dias e horários mais procurados: `book_day`, `book_time`;
  - onde a pessoa desiste: a sequência `book_party` → `book_day` → `book_time` → `book_details` → `book_code_sent` → `book_done`, mais `book_error`;
  - de onde vêm as reservas: `page_view.origin` e `book_done`.

## 6. Por módulo

| Módulo | Necessários | Lembrar de mim | Medição |
|---|---|---|---|
| 1 · Site e reserva | sessão do cliente, escolha, tema | nome, WhatsApp, grupo | páginas e passos da reserva |
| 1 · Recepção e painel | sessão da equipe, aparelho, tema | — (aparelho da casa não lembra cliente) | — (o painel não mede pessoas da equipe) |
| 3 · Operação (comanda, tablet, cozinha) | sessão da equipe, aparelho, pessoa ativa pelo PIN | — | — |
| 4 · Nota fiscal | sessão da equipe, aparelho | — | — |
| 5 · Financeiro | sessão da equipe, aparelho | — | — |
| 6 · Lojinha | sessão do cliente, carrinho (necessário: a pessoa pôs o produto lá) | endereço de entrega, só no aparelho | páginas e passos da compra |

- Telas da equipe não usam medição de comportamento. O que a casa precisa saber da operação vem dos próprios registros (pedidos, mesas, notas), não de cookie.
- O modo ilha (sem internet) guarda a fila de pedidos no aparelho da casa. Isso é necessário e fica registrado na lista quando o módulo 3 chegar.

## 7. Antes de publicar

- Conferir que a lista e a tabela da política batem (o teste já confere os nomes).
- Revisão da política pelo jurídico (pendência com o Marcus).
- Umami na VM ligado ao `POST /measure` (sem ele, os eventos ficam na API).
