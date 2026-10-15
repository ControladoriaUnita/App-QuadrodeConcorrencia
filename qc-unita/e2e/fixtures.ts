/**
 * Base dos testes de tela. Todo teste falha se a página lançar erro de JavaScript,
 * escrever erro no console ou receber 5xx da API — mesmo que a tela pareça certa.
 *
 * Os arquivos rodam em ordem (01-, 02-…) contra o mesmo banco em memória: os que só leem
 * vêm primeiro; os que alteram dados mexem cada um no seu registro do seed.
 */
import { test as base, expect, type Page } from '@playwright/test'

export const test = base.extend<{ problems: string[] }>({
  problems: [
    async ({ page }, use) => {
      const problems: string[] = []
      page.on('pageerror', (e) => problems.push(`erro na página: ${e.message}`))
      page.on('console', (m) => {
        if (m.type() === 'error') problems.push(`console: ${m.text()}`)
      })
      page.on('response', (r) => {
        if (r.url().includes('/api/') && r.status() >= 500) problems.push(`API ${r.status()}: ${r.request().method()} ${r.url()}`)
      })
      await use(problems)
      expect(problems, 'a página não pode ter erros').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }

export const nav = (page: Page) => page.getByRole('navigation', { name: 'Principal' })

/** Entra como um dos usuários do modo demonstração (seletor do topo). */
export async function entrarComo(page: Page, nome: 'Lucas · Controladoria' | 'Adriano Carvalho' | 'Marina Costa' | 'Roberto Lima' | 'Helena Duarte') {
  await page.getByRole('combobox', { name: 'Demonstração — entrar como' }).selectOption({ label: nome })
}

/** Abre o orçamento da obra 2041 · Residencial Alpha (a obra do seed com concorrências e contrato). */
export async function abrirAlpha(page: Page) {
  await page.goto('/obras')
  await page.getByRole('link', { name: /Residencial Alpha/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Residencial Alpha' })).toBeVisible()
}

export async function abrirQc(page: Page, objeto: string) {
  await abrirAlpha(page)
  await nav(page).getByText('Concorrências').click()
  await page.getByRole('link', { name: new RegExp(objeto) }).click()
  await expect(page.getByRole('heading', { level: 1, name: new RegExp(objeto) })).toBeVisible()
}

export async function abrirContrato(page: Page) {
  await abrirAlpha(page)
  await nav(page).getByText('Contratos e aditivos').click()
  await page.getByText('SC-2041-001').click()
  await expect(page.getByRole('heading', { level: 1, name: /SC-2041-001/ })).toBeVisible()
}
