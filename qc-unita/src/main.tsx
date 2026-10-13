import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'
import { AuthProvider } from './lib/auth'
import { supabaseConfigError } from './lib/supabase'
import './styles/index.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: 1 } },
})

createRoot(document.getElementById('root')!).render(
  supabaseConfigError ? (
    <div className="flex min-h-full items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-lg rounded-lg border border-border bg-surface p-8">
        <h1 className="text-xl font-semibold">Configuração incompleta</h1>
        <p className="mt-2 text-sm text-text-muted">{supabaseConfigError}</p>
        <p className="mt-4 text-sm text-text-muted">Corrija em Vercel → Settings → Environment Variables e faça o Redeploy.</p>
      </div>
    </div>
  ) : (
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
  ),
)
