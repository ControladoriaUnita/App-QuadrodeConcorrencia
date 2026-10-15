import { abrirAlpha, expect, nav, test } from './fixtures'

test('criar concorrência a partir do orçamento leva ao novo QC e ele aparece no quadro', async ({ page }) => {
  await abrirAlpha(page)
  await page.getByRole('button', { name: 'Nova concorrência' }).click()
  await expect(page).toHaveURL(/\/concorrencias\/nova$/)

  await page.getByRole('button', { name: 'Criar concorrência' }).click()
  await expect(page.getByText('Marque ao menos um insumo do orçamento.')).toBeVisible()

  await page.getByPlaceholder('Ex.: Fornecimento e instalação de esquadrias de alumínio').fill('Esquadrias de alumínio — teste E2E')
  await page.getByRole('combobox', { name: 'Vínculo PL' }).selectOption({ label: 'IP00153 — Esquadrias de Alumínio' })
  await page.getByRole('checkbox', { name: /^Marcar/ }).first().check()
  await expect(page.getByText(/1 IP\(s\): IP00153/)).toBeVisible()

  await page.getByRole('button', { name: 'Criar concorrência' }).click()
  await expect(page).toHaveURL(/\/qc\/[^/?]+\?aba=vinculos/)
  await expect(page.getByRole('heading', { level: 1, name: /QC-0005 — Esquadrias de alumínio — teste E2E/ })).toBeVisible()

  await nav(page).getByText('Concorrências').click()
  await expect(page.getByRole('region', { name: 'Em cotação' })).toContainText('Esquadrias de alumínio — teste E2E')
})
