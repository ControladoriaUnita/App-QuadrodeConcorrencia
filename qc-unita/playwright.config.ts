/**
 * Testes de tela (E2E): o app inteiro (tela + API) no modo demonstração, com banco em memória
 * e ERP simulado. Nunca toca no Supabase nem na UAU. Cada execução começa com os dados do seed.
 */
import { defineConfig } from '@playwright/test'

const PORT = 5199

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Usa o Edge que já vem no Windows (sem baixar navegador). Para usar o Chrome: PW_CHANNEL=chrome
    channel: process.env.PW_CHANNEL || 'msedge',
    locale: 'pt-BR',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATA_SOURCE: 'memory',
      ERP_PROVIDER: 'mock',
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: '',
      MS_GRAPH_TENANT_ID: '',
      MS_GRAPH_CLIENT_ID: '',
      MS_GRAPH_CLIENT_SECRET: '',
    },
  },
})
