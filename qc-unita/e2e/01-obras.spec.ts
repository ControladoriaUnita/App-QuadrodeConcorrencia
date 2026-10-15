import { abrirAlpha, expect, test } from './fixtures'

test('a tela inicial lista as obras ativas com o consumo do orçamento', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/obras$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Selecione a obra' })).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Obras ativas' })).toBeChecked()

  const alpha = page.getByRole('link', { name: /Residencial Alpha/ })
  await expect(alpha).toContainText('R$ 6.101.185,41')
  await expect(alpha).toContainText('R$ 455.438,79 · 7,5%')
  await expect(alpha).toContainText('4 concorrência(s)')
  await expect(page.getByRole('link', { name: /Condomínio Jardins BH/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /Edifício Vila Nova/ })).toBeVisible()
})

test('abrir uma obra leva ao orçamento, e a tela inicial volta para ela', async ({ page }) => {
  await abrirAlpha(page)
  await expect(page).toHaveURL(/\/obras\/[^/]+\/orcamento$/)
  const url = page.url()
  await page.goto('/')
  await expect(page).toHaveURL(url)
})

test('arquivar obra tira da lista de ativas sem apagar, e desarquivar devolve', async ({ page }) => {
  await page.goto('/obras')
  await page.getByRole('link', { name: /Edifício Vila Nova/ }).click()
  await page.getByRole('button', { name: 'Arquivar obra' }).click()
  await expect(page.getByText('Arquivar a obra 2055?')).toBeVisible()
  await page.getByRole('button', { name: 'Arquivar', exact: true }).click()

  await expect(page).toHaveURL(/\/obras$/)
  await expect(page.getByRole('link', { name: /Edifício Vila Nova/ })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Residencial Alpha/ })).toBeVisible()

  await page.getByRole('radio', { name: 'Arquivadas' }).click()
  const arquivada = page.getByRole('link', { name: /Edifício Vila Nova/ })
  await expect(arquivada).toBeVisible()
  await arquivada.click()
  await page.getByRole('button', { name: 'Desarquivar' }).click()
  await expect(page.getByRole('button', { name: 'Arquivar obra' })).toBeVisible()

  await page.goto('/obras')
  await expect(page.getByRole('link', { name: /Edifício Vila Nova/ })).toBeVisible()
})
