import { abrirAlpha, abrirContrato, abrirQc, entrarComo, expect, nav, test } from './fixtures'

test('a lista de contratos mostra a solicitação concluída e a gerada no envio do QC (antes da aprovação)', async ({ page }) => {
  await abrirAlpha(page)
  await nav(page).getByText('Contratos e aditivos').click()
  const linha = page.getByRole('row', { name: /SC-2041-002/ })
  await expect(linha).toContainText('Concluído')
  await expect(linha).toContainText('QC-0004')
  await expect(linha).toContainText('Terra Forte')
  await expect(linha).toContainText('03/11/2026 → 26/02/2027')
  await expect(linha).toContainText('R$ 261.058,04')
  // Contrapiso está em aprovação e já tem a solicitação em rascunho
  await expect(page.getByRole('row', { name: /SC-2041-001/ })).toContainText('QC-0002')
})

test('o contrato concluído fica bloqueado na aba Solicitação de contrato do QC e não tem assinatura nem envio ao ERP', async ({ page }) => {
  await abrirQc(page, 'Terraplenagem e bota-fora')
  await page.getByRole('tab', { name: /Solicitação de contrato/ }).click()
  await expect(page.getByText(/Contrato concluído: dados e itens bloqueados\./)).toBeVisible()
  await expect(page.getByRole('button', { name: /Registrar assinatura|Enviar ao ERP/ })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'Tipo de contrato' })).toBeDisabled()
  await expect(page.getByRole('textbox', { name: 'Início' })).toHaveValue('2026-11-03')
  await expect(page.getByRole('textbox', { name: 'Início' })).toBeDisabled()
  await expect(page.getByText('Resultado (verba − contrato)').locator('..')).toContainText('R$ 33.556,64')
  // Os aditivos continuam na tela de Contratos
  await page.getByRole('button', { name: 'Aditivos e distratos' }).click()
  await expect(page.getByRole('heading', { level: 1, name: /SC-2041-002/ })).toBeVisible()
  await expect(page.getByRole('tab', { name: /Aditivos e distratos/ })).toHaveAttribute('aria-selected', 'true')
})

test('QC em aprovação já tem a solicitação em rascunho, mas só conclui depois de aprovado', async ({ page }) => {
  await abrirQc(page, 'Contrapiso')
  await page.getByRole('tab', { name: /Solicitação de contrato/ }).click()
  await expect(page.getByText('QC ainda não aprovado')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Enviar e concluir' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Atualizar pelo mapa' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Tipo de contrato' })).toBeEnabled()
})

test('o Planejamento edita os vínculos de planejamento do contrato concluído', async ({ page }) => {
  await abrirQc(page, 'Terraplenagem e bota-fora')
  await entrarComo(page, 'Paula Reis')
  await page.getByRole('tab', { name: /Solicitação de contrato/ }).click()
  await expect(page.getByText('Os vínculos de planejamento continuam editáveis.', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: /^Editar vínculos de / }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Vínculos fecham com a quantidade')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Salvar vínculos' })).toBeEnabled()
  // Vínculo a mais: não salva
  await dialog.getByRole('button', { name: 'Adicionar IP' }).click()
  await dialog.getByRole('textbox', { name: /^Quantidade no/ }).last().fill('1')
  await dialog.getByRole('textbox', { name: /^Quantidade no/ }).last().press('Tab')
  await expect(dialog.getByText(/Vinculado a mais/)).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Salvar vínculos' })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Remover vínculo' }).last().click()
  await dialog.getByRole('button', { name: 'Salvar vínculos' }).click()
  await expect(dialog).toHaveCount(0)
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

test('o aditivo reduz um item e acrescenta em outro na mesma solicitação (remanejamento), sem insumo novo', async ({ page }) => {
  await abrirContrato(page)
  await page.getByRole('tab', { name: /Aditivos e distratos/ }).click()
  await page.getByRole('button', { name: 'Solicitar aditivo' }).click()
  await page.getByRole('textbox', { name: /Motivo do aditivo/ }).fill('Remanejamento: zera um item e leva o saldo para outro')
  await expect(page.getByRole('button', { name: 'Incluir item novo' })).toHaveCount(0)

  // Primeiro item do contrato: reduzir e zerar a quantidade vigente
  await page.getByRole('button', { name: /^Reduzir / }).first().click()
  await page.getByRole('button', { name: /^Zerar / }).first().click()
  await expect(page.getByRole('button', { name: /^Reduzir / }).first()).toHaveAttribute('aria-pressed', 'true')

  // Segundo item: acrescentar, ao preço contratado (sem campo de R$ unitário)
  await expect(page.getByRole('textbox', { name: /^R\$ unitário de / })).toHaveCount(0)
  await page.getByRole('textbox', { name: /^Quantidade de / }).nth(1).fill('10')
  await page.getByRole('textbox', { name: /^Quantidade de / }).nth(1).press('Tab')

  await expect(page.getByText('Acréscimos', { exact: false }).first()).toContainText('R$ 552,00')
  await expect(page.getByText('Reduções', { exact: false }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Salvar rascunho' }).click()
  await expect(page.getByRole('button', { name: 'Enviar para aprovação' })).toBeVisible()
})

test('mudar o R$ unitário no aditivo duplica a linha: a original fica zerada e a nova recebe o saldo editável', async ({ page }) => {
  await abrirContrato(page)
  await page.getByRole('tab', { name: /Aditivos e distratos/ }).click()
  // O teste anterior deixou um rascunho: exclui para abrir um novo
  const excluir = page.getByRole('button', { name: 'Excluir', exact: true })
  if (await excluir.count()) await excluir.first().click()
  await expect(page.getByRole('button', { name: 'Solicitar aditivo' })).toBeVisible()
  await page.getByRole('button', { name: 'Solicitar aditivo' }).click()
  await page.getByRole('textbox', { name: /Motivo do aditivo/ }).fill('Novo preço negociado para o transporte')
  await page.getByRole('button', { name: 'Mudar unitário de IS00017' }).click()

  // Original zerada (histórico do unitário original); duplicada com o saldo de 351 m³
  await expect(page.getByText('zerada · unitário original')).toBeVisible()
  await expect(page.getByText('linha duplicada · novo unitário')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Quantidade de IS00017' })).toBeDisabled()
  await expect(page.getByRole('textbox', { name: 'Quantidade da linha duplicada de IS00017' })).toHaveValue('351,00')
  // Saldo editável e novo unitário
  await page.getByRole('textbox', { name: 'Quantidade da linha duplicada de IS00017' }).fill('300')
  await page.getByRole('textbox', { name: 'Quantidade da linha duplicada de IS00017' }).press('Tab')
  await page.getByRole('textbox', { name: 'Novo R$ unitário de IS00017' }).fill('60')
  await page.getByRole('textbox', { name: 'Novo R$ unitário de IS00017' }).press('Tab')
  await expect(page.getByText('Acréscimos', { exact: false }).first()).toContainText('R$ 18.000,00')
  await expect(page.getByText('Reduções', { exact: false }).first()).toContainText('R$ 19.375,20')
  await page.getByRole('button', { name: 'Salvar rascunho' }).click()
  await expect(page.getByRole('button', { name: 'Enviar para aprovação' })).toBeVisible()
  await expect(page.getByText('linha duplicada (novo unitário)', { exact: false })).toBeVisible()
})
