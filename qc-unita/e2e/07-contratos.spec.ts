import { abrirAlpha, abrirContrato, entrarComo, expect, nav, test } from './fixtures'

test('a lista de contratos mostra a solicitação gerada do QC aprovado', async ({ page }) => {
  await abrirAlpha(page)
  await nav(page).getByText('Contratos e aditivos').click()
  const linha = page.getByRole('row', { name: /SC-2041-001/ })
  await expect(linha).toContainText('Concluído')
  await expect(linha).toContainText('QC-0004')
  await expect(linha).toContainText('Terra Forte')
  await expect(linha).toContainText('03/11/2026 → 26/02/2027')
  await expect(linha).toContainText('R$ 261.058,04')
})

test('o contrato concluído fica bloqueado e não tem assinatura nem envio ao ERP', async ({ page }) => {
  await abrirContrato(page)
  await expect(page.getByText('Contrato concluído: dados e itens bloqueados.')).toBeVisible()
  await expect(page.getByRole('button', { name: /Registrar assinatura|Enviar ao ERP/ })).toHaveCount(0)
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

test('o aditivo reduz um item e acrescenta outro na mesma solicitação (remanejamento)', async ({ page }) => {
  await abrirContrato(page)
  await page.getByRole('tab', { name: /Aditivos e distratos/ }).click()
  await page.getByRole('button', { name: 'Solicitar aditivo' }).click()
  await page.getByRole('textbox', { name: /Motivo do aditivo/ }).fill('Remanejamento: zera um item e leva o saldo para um item novo')

  // Primeiro item do contrato: reduzir e zerar a quantidade vigente
  await page.getByRole('button', { name: /^Reduzir / }).first().click()
  await page.getByRole('button', { name: /^Zerar / }).first().click()
  await expect(page.getByRole('button', { name: /^Reduzir / }).first()).toHaveAttribute('aria-pressed', 'true')

  // Item novo acrescentando
  await page.getByRole('button', { name: 'Incluir item novo' }).click()
  await page.getByRole('textbox', { name: 'Código do item novo' }).fill('IS99997')
  await page.getByRole('textbox', { name: 'Descrição do item novo' }).fill('Serviço remanejado')
  await page.getByRole('textbox', { name: 'Unidade do item novo' }).fill('m³')
  await page.getByRole('textbox', { name: 'Quantidade do item novo' }).fill('10')
  await page.getByRole('textbox', { name: 'Quantidade do item novo' }).press('Tab')
  await page.getByRole('textbox', { name: 'R$ unitário do item novo' }).fill('50')
  await page.getByRole('textbox', { name: 'R$ unitário do item novo' }).press('Tab')

  await expect(page.getByText('Acréscimos', { exact: false }).first()).toContainText('R$ 500,00')
  await expect(page.getByText('Reduções', { exact: false }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Salvar rascunho' }).click()
  await expect(page.getByRole('button', { name: 'Enviar para aprovação' })).toBeVisible()
})
