/** PostgREST limita cada resposta (padrão 1.000 linhas): lê em páginas até a última incompleta. */
export async function allPages<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const res = await page(from, from + 999)
    if (res.error) throw new Error(res.error.message)
    const rows = res.data as T[]
    out.push(...rows)
    if (rows.length < 1000) return out
  }
}
