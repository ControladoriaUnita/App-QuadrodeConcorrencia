/**
 * Cliente Supabase do browser — usa apenas a ANON KEY (protegida por RLS).
 * Ausente quando o app roda em modo demonstração (DATA_SOURCE=memory no servidor).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/** Tira espaços, aspas e barra final — erros comuns ao colar valores na Vercel. */
function clean(value: string | undefined): string | undefined {
  const v = value?.trim().replace(/^["']|["']$/g, '').trim()
  return v ? v : undefined
}

const url = clean(import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/+$/, '')
const anonKey = clean(import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)

/** Mensagem para a tela de configuração quando as variáveis existem mas são inválidas (em vez de tela branca). */
export let supabaseConfigError: string | null = null
let client: SupabaseClient | null = null

if (url || anonKey) {
  if (!url || !anonKey) {
    supabaseConfigError = `Falta ${!url ? 'VITE_SUPABASE_URL' : 'VITE_SUPABASE_ANON_KEY'} nas variáveis de ambiente.`
  } else if (!/^https?:\/\/[^\s/]+$/i.test(url)) {
    supabaseConfigError = 'VITE_SUPABASE_URL inválida. Use o Project URL do Supabase, no formato https://xxxx.supabase.co.'
  } else {
    try {
      client = createClient(url, anonKey)
    } catch (err) {
      supabaseConfigError = `Não foi possível iniciar o Supabase: ${(err as Error).message}`
    }
  }
}

export const supabase: SupabaseClient | null = client
export const isDemoMode = !supabase && !supabaseConfigError
