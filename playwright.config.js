import { defineConfig, devices } from "@playwright/test";

// Na máquina local, usa o Chrome instalado quando falta o navegador que vem com o Playwright
// (PW_CHANNEL=chrome); o CI usa o Chromium do próprio Playwright.
const channel = process.env.PW_CHANNEL || undefined;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled" } },
  fullyParallel: true,
  // o servidor de dev compila as páginas na hora; mais workers que isso só dão timeout
  workers: 4,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    channel,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --port 5173 --strictPort",
    url: "http://localhost:5173/_ds/",
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    { name: "computador", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "celular", use: { ...devices["Pixel 7"] } },
  ],
});
