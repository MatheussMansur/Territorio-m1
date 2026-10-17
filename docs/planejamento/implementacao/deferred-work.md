# Trabalho adiado

- source_spec: `docs/planejamento/implementacao/spec-1-1-casca-do-painel-e-menu-por-papel.md`
  summary: O servidor de verdade (nginx) precisa mandar `/admin/<área>` para `admin/index.html`, como o dev e o preview já fazem.
  evidence: Sem essa regra, abrir ou recarregar `/admin/reservas` no ar dá 404; entra na configuração do nginx no Épico 10.
- source_spec: `docs/planejamento/implementacao/spec-1-1-casca-do-painel-e-menu-por-papel.md`
  summary: Testar o `vite preview` do build da demonstração abrindo uma área direto (`/admin/salao`).
  evidence: Os testes só sobem o `vite dev`; tirar o `configurePreviewServer` não quebra nenhum teste.
