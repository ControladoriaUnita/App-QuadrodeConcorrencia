import { abrirAlpha, expect, test } from './fixtures'
import type { Page } from '@playwright/test'

const tabela = (page: Page) => page.getByRole('table', { name: 'Orçamento da obra' })
/** Linhas de insumo: são as que têm o botão do Vínculo PL (IPxxxxx). */
const insumos = (page: Page) => tabela(page).getByRole('row').filter({ has: page.getByRole('button', { name: /^IP\d+$/ }) })

test('o orçamento mostra os totais da obra e a árvore Item → composição → insumo', async ({ page }) => {
  await abrirAlpha(page)
  await expect(page.getByText('165 linhas')).toBeVisible()
  await expect(page.getByText('Saldo não comprometido')).toBeVisible()
  await expect(page.getByText('R$ 5.558.812,91Disponível')).toBeVisible()

  await expect(tabela(page).getByRole('row', { name: /02 Item INFRAESTRUTURA R\$ 345\.603,42/ })).toBeVisible()
  await expect(tabela(page).getByRole('row', { name: /02\.02 Item TERRAPLENAGEM R\$ 294\.614,68/ })).toBeVisible()
  await expect(insumos(page).first()).toBeVisible()
  // Orçamento 100% com IP e nomes: concorrência liberada
  await expect(page.getByText(/Orçamento incompleto/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Nova concorrência' })).toBeEnabled()
})

test('busca e filtro de Vínculo PL mostram só as linhas que batem', async ({ page }) => {
  await abrirAlpha(page)
  await page.getByRole('textbox', { name: 'Buscar no orçamento' }).fill('Cimento CP II')
  await expect(insumos(page).first()).toBeVisible()
  for (const row of await insumos(page).all()) await expect(row).toContainText(/Cimento CP II/i)

  await page.getByRole('textbox', { name: 'Buscar no orçamento' }).fill('')
  await page.getByRole('combobox', { name: 'Vínculo PL' }).selectOption({ label: 'IP00104 — Terraplenagem' })
  await expect(insumos(page).first()).toBeVisible()
  for (const row of await insumos(page).all()) await expect(row.getByRole('button', { name: /^IP\d+$/ })).toHaveText('IP00104')
})

test('filtro por coluna estilo Excel vale para toda a árvore', async ({ page }) => {
  await abrirAlpha(page)
  await page.getByRole('button', { name: 'Filtrar Vínculo PL' }).click()
  const filtro = page.getByRole('dialog', { name: 'Filtro de Vínculo PL' })
  await filtro.getByRole('textbox', { name: 'Pesquisar valores' }).fill('IP00141')
  await filtro.getByRole('button', { name: 'Aplicar' }).click()

  await expect(page.getByRole('button', { name: 'Filtrar Vínculo PL' })).toHaveAttribute('aria-pressed', 'true')
  await expect(insumos(page).first()).toBeVisible()
  for (const row of await insumos(page).all()) await expect(row.getByRole('button', { name: /^IP\d+$/ })).toHaveText('IP00141')
  await expect(tabela(page).getByRole('row', { name: /TERRAPLENAGEM/ })).toHaveCount(0)
})

test('nível de detalhe "Itens" esconde composições e insumos', async ({ page }) => {
  await abrirAlpha(page)
  await page.getByRole('group', { name: 'Nível de detalhe' }).getByRole('button', { name: 'Itens' }).click()
  await expect(tabela(page).getByRole('row', { name: /02 Item INFRAESTRUTURA/ })).toBeVisible()
  await expect(insumos(page)).toHaveCount(0)
})
