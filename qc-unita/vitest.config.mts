import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  test: {
    include: ['shared/**/*.test.ts', 'server/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    // Os testes rodam sempre no modo demonstração, isolados do ambiente da máquina: no build da
    // Vercel (VERCEL_ENV=production, UAU e SharePoint configurados) eles não podem bloquear o banco
    // em memória nem chamar a UAU ou o SharePoint de verdade.
    env: {
      VERCEL: '',
      VERCEL_ENV: '',
      VERCEL_OIDC_TOKEN: '',
      DATA_SOURCE: 'memory',
      ERP_PROVIDER: 'mock',
      UAU_BASE_URL: '',
      UAU_LOGIN: '',
      UAU_PASSWORD: '',
      UAU_INTEGRATION_TOKEN: '',
      MS_GRAPH_TENANT_ID: '',
      MS_GRAPH_CLIENT_ID: '',
      MS_GRAPH_CLIENT_SECRET: '',
    },
  },
})
