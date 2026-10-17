// Liga a API simulada. Só é alcançado quando VITE_API_MODE=mock, então os builds de produção
// não levam nem as rotas simuladas nem o service worker.
export async function startMock() {
  const { network } = await import("virtual:msw");
  const { handlers } = await import("./handlers/index.js");
  network.configure({ handlers, onUnhandledFrame: "bypass" });
  await network.enable();
  if (import.meta.env.VITE_DEMO === "true") {
    const { mountDemoBar } = await import("./demo-bar.js");
    mountDemoBar();
  }
}
