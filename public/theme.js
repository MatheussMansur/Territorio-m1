// Aplica o tema salvo do visitante antes da primeira pintura, para a página nunca piscar no
// outro. Arquivo externo de propósito: a CSP não deixa script inline (AD-14).
// A escolha fica no cookie trt_tema (src/lib/cookie-registry.js); sem cookie = segue o aparelho.
(function () {
  var m = document.cookie.match(/(?:^|; )trt_tema=(claro|escuro)(?:;|$)/);
  if (m) document.documentElement.dataset.theme = m[1];
})();
