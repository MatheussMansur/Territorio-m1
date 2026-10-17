# Território

Site e sistema de reservas do Território, izakaya em Foz do Iguaçu: landing, reserva por horário com lista de espera, área do cliente e painel da casa (salão, reservas, plantas das mesas, agenda com plano do dia, eventos, cardápio, conteúdo, equipe).

O front é construído primeiro, sobre uma API simulada que segue o contrato da API real ([docs/api/openapi.yaml](docs/api/openapi.yaml)). Trocar o mock pelo backend não muda nenhuma tela.

## Rodar

```bash
npm install          # também liga o hook que barra segredos no commit
npm run dev          # http://localhost:5173 (mock ligado, barra de demonstração)
```

- `/`, `/es/` e `/en/` são a página da casa, gerada no build a partir de `src/content` e `src/site/pages/home.js` (abre sem JavaScript; o script só liga tema, setas e "aberto agora").
- `/_ds/` é o catálogo do design system: todo componente em todos os estados.
- Estados forçados: `?mock=lento`, `?mock=erro`, `?mock=vazio`; hora da casa fingida: `?agora=2026-10-01T20:40`. A barra de demonstração faz o mesmo e recomeça os dados.

## Comandos

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento com a API simulada |
| `npm run build` | Build de produção (API real; falha se estiver com mock) |
| `npm run build:demo` | Build de demonstração para o cliente (mock, dados fictícios) |
| `npm run build:site` | O site sem a API, para conferir (noindex) |
| `npm run build:site:ar` | O site sem a API para o domínio da casa (entrega 1; entra no Google) |
| `npm run lint` | ESLint e Stylelint (cor fora dos tokens, `innerHTML` com dados, `fetch` fora da API) |
| `npm run test:unit` | Testes das funções (datas, telefone, validação, preço) |
| `npm test` | Testes no navegador, no computador e no celular, com checagem de acessibilidade. Sem o Chromium do Playwright: `PW_CHANNEL=chrome npm test` |
| `npm run fonts` | Refaz as fontes locais e confere os acentos |
| `npm run images` | Gera AVIF, WebP e JPG das fotos de `assets-src/` |
| `node scripts/site/mapa-osm.mjs` | Refaz os tamanhos do mapa fixo de "Onde fica" (OpenStreetMap); com `--baixar`, baixa o mapa de novo, só se a casa mudar de lugar |
| `npm run check:secrets` | Procura chaves e senhas em todos os arquivos |

## Estrutura

```text
index.html, _ds/, (fase 2+) cardapio/, reservar/, minhas-reservas/, r/, confirmar/, espera/, admin/…
src/
  styles/       tokens (tema Território), base, esquadria, componentes, páginas
  components/   janela, confirmação, aviso, escolhas, abas, campos, código, telefone, sementes
  lib/          datas no fuso da casa, telefone BR/PY/AR, validação, preço, textos, html seguro
  services/api/ o único lugar que conhece URLs
  mocks/        API simulada (MSW): seeds, motor de disponibilidade, barra de demonstração
  pages/        um módulo por página
  partials/     HTML compartilhado (<!-- @include head.html -->)
  types/        modelos em JSDoc
docs/           escopo, telas, modelos, regras da reserva, decisões da casa, contrato da API
scripts/        fontes, imagens, segredos
tests/          unit (node:test) e e2e (Playwright + axe)
```

## Regras do código

- Toda cor, fonte e medida vem de `src/styles/tokens.css`. A próxima casa troca o tema, não os componentes.
- Texto de tela fica em `src/i18n/{pt,es,en}.json` (lido por `t()` de `src/lib/strings.js`), nunca dentro dos componentes. As três línguas têm as mesmas chaves; o teste quebra se faltar uma.
- Nada de `innerHTML` com dados: a interface é desenhada com lit-html, que escapa tudo.
- Telas chamam `src/services/api`, nunca `fetch` direto.
- Componente novo entra no catálogo `/_ds/` com todos os estados.
- Regra de negócio (vaga, limite, permissão) é da API; o front só repete para ajudar quem digita.
- Nenhum segredo no front nem no repositório: variáveis `VITE_` vão para o navegador.

## Documentos

1. [Escopo](docs/01-escopo.md)
2. [Mapa de telas](docs/02-telas.md)
3. [Modelos de dados](docs/03-modelos.md)
4. [Regras da reserva](docs/04-regras-reserva.md)
5. [Decisões da casa](docs/05-decisoes.md)
6. [Contrato da API](docs/api/openapi.yaml)
