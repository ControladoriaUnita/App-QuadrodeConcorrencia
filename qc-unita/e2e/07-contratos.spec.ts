import { abrirAlpha, abrirContrato, entrarComo, expect, nav, test } from './fixtures'

test('a lista de contratos mostra a solicitação gerada do QC aprovado', async ({ page }) => {
  await abrirAlpha(page)
  await nav(page).getByText('Contratos e aditivos').click()
  const linha = page.getByRole('row', { name: /SC-2041-001/ })
  await expect(linha).toContainText('Enviada a Contratos')
  await expect(linha).toContainText('QC-0004')
  await expect(linha).toContainText('Terra Forte')
  await expect(linha).toContainText('03/11/2026 → 26/02/2027')
  await expect(linha).toContainText('R$ 261.058,04')
})

test('a solicitação enviada fica bloqueada para edição', async ({ page }) => {
  await abrirContrato(page)
  await expect(page.getByText('Solicitação enviada: dados e itens bloqueados.')).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Tipo de contrato' })).toBeDisabled()
  await expect(page.getByRole('textbox', { name: 'Início' })).toHaveValue('2026-11-03')
  await expect(page.getByRole('textbox', { name: 'Início' })).toBeDisabled()
  await expect(page.getByText('Resultado (verba − contrato)').locator('..')).toContainText('R$ 33.556,64')
})

test('a Gerência aprova o aditivo e ele entra no novo total do contrato', async ({ page }) => {
  await abrirContrato(page)
  await entrarComo(page, 'Roberto Lima')
  await page.getByRole('tab', { name: /Aditivos e distratos/ }).click()
  await expect(page.getByText('Volume adicional de bota-fora apontado pela engenharia após sondagem complementar.')).toBeVisible()

  await page.getByRole('button', { name: /^Aprovar/ }).click()
  await expect(page.getByText(/Aprovado por Roberto Lima/)).toBeVisible()

  const novoTotal = page.getByText('Novo total do contrato').first().locator('..')
  await expect(novoTotal).not.toContainText('R$ 261.058,04')
  await expect(page.getByText('Aditivos e distratos', { exact: true }).first().locator('..')).toContainText('1 de 1')
})
