import { abrirQc, expect, test } from './fixtures'

// Altera o QC-0001 (Pavimentação externa e passeio). Os arquivos 01–04 já leram os valores originais.

test('mudar o preço no mapa recalcula a melhor proposta e fica gravado', async ({ page }) => {
  await abrirQc(page, 'Pavimentação externa e passeio')
  await page.getByRole('tab', { name: /Mapa de cotação/ }).click()
  const preco = page.getByRole('textbox', { name: 'Preço unitário de Pavimenta para IM00011' })
  await preco.fill('7')
  await preco.press('Enter')

  // 47.780,22 − 1.165,48 (8,06 × 144,60) + 1.012,20 (7,00 × 144,60), somado sem arredondar cada linha
  await expect(page.getByText('R$ 47.626,95').first()).toBeVisible()

  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Preço unitário de Pavimenta para IM00011' })).toHaveValue('7,00')
  await expect(page.getByText('R$ 47.626,95').first()).toBeVisible()
})

test('"Sem Fornecedor" pode ser convidado e indicado como vencedor', async ({ page }) => {
  await abrirQc(page, 'Pavimentação externa e passeio')
  await page.getByRole('tab', { name: /Fornecedores e condições/ }).click()
  const convidar = page.getByRole('combobox', { name: 'Convidar fornecedor' })
  await convidar.click()
  await convidar.fill('Sem Fornecedor')
  await page.getByRole('option', { name: /Sem Fornecedor/ }).first().click()
  await expect(page.getByRole('heading', { level: 3, name: /^Sem Fornecedor/ })).toBeVisible()
  await expect(page.getByRole('tab', { name: /Fornecedores e condições 5/ })).toBeVisible()

  await page.getByRole('tab', { name: 'Dados do QC' }).click()
  const vencedora = page.getByRole('combobox', { name: 'Empresa vencedora' })
  const opcao = vencedora.getByRole('option', { name: /^Sem Fornecedor/ })
  await vencedora.selectOption((await opcao.getAttribute('value'))!)
  await page.getByRole('textbox', { name: 'Justificativa da escolha' }).fill('Execução com equipe própria da obra.')
  await page.getByRole('button', { name: 'Salvar' }).click()
  await expect(page.getByRole('button', { name: 'Salvar' })).toBeDisabled()

  await page.reload()
  await expect(page.getByText('Vencedora indicada').locator('..')).toContainText('Sem Fornecedor')
})
