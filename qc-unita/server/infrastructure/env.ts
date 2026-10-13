/**
 * Leitura de variáveis de ambiente tolerante a erros comuns ao colar no painel da Vercel:
 * espaços e aspas em volta (" valor ", "\"valor\"" → "valor").
 */
export function envValue(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const v = (env[name] ?? '')
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2')
    .trim()
  return v || null
}

/** Opção de modo (ERP_PROVIDER, DATA_SOURCE...): como envValue, em minúsculas ('' = ausente). */
export function envOption(name: string, env: NodeJS.ProcessEnv = process.env): string {
  return (envValue(name, env) ?? '').toLowerCase()
}
