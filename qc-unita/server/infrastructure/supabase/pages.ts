const PAGE = 1000
/** Páginas pedidas juntas depois da primeira cheia (o orçamento de 3.500 linhas sai em 2 idas, não 4) */
const AHEAD = 4

/**
 * PostgREST limita cada resposta (padrão 1.000 linhas): lê em páginas até a última incompleta.
 * A primeira página vai sozinha (a maioria das leituras cabe nela); as seguintes, em grupos
 * paralelos, na ordem original.
 */
export async function allPages<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const fetchPage = async (n: number) => {
    const res = await page(n * PAGE, n * PAGE + PAGE - 1)
    if (res.error) throw new Error(res.error.message)
    return res.data as T[]
  }
  const out: T[] = [...(await fetchPage(0))]
  if (out.length < PAGE) return out
  for (let next = 1; ; next += AHEAD) {
    const pages = await Promise.all(Array.from({ length: AHEAD }, (_, k) => fetchPage(next + k)))
    for (const rows of pages) {
      out.push(...rows)
      if (rows.length < PAGE) return out
    }
  }
}

/** Executa as tarefas com no máximo `limit` pedidos simultâneos (gravações ao Supabase em lote) */
export async function inParallel<T>(items: readonly T[], run: (item: T) => Promise<unknown>, limit = 8): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < items.length) await run(items[next++]!)
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}
