import { defineConfig } from 'vitest/config'

// Integração com Supabase/PostgREST real. Requer SUPABASE_URL e SUPABASE_JWT_SECRET no ambiente.
export default defineConfig({
  test: {
    include: ['server/**/*.integration.test.ts'],
    environment: 'node',
    env: { SUPABASE_IT: '1' },
  },
})
