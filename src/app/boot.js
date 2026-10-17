// Toda página começa aqui: a API simulada (só em desenvolvimento e na demonstração), depois a página.
// <html data-ready> avisa aos testes (e a quem estiver esperando) que a página está pronta.
export async function boot(start) {
  if (import.meta.env.VITE_API_MODE === "mock") {
    const { startMock } = await import("../mocks/start.js");
    await startMock();
  }
  await start();
  document.documentElement.dataset.ready = "true";
}
