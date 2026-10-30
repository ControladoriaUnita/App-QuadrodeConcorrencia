import { abrirQc, expect, test } from './fixtures'

// Altera o QC-0001 (Pavimentação externa e passeio): escolhas por insumo e responsáveis.

test('mapa: escolher o fornecedor de cada insumo monta a cotação escolhida com mais de uma empresa', async ({ page }) => {
  await abrirQc(page, 'Pavimentação externa e passeio')
  await page.getByRole('tab', { name: /Mapa de cotação/ }).click()

  // A coluna de IP (vínculo PL) saiu do mapa
  await expect(page.getByRole('columnheader', { name: 'IP', exact: true })).toHaveCount(0)
  await expect(page.getByRole('columnheader', { name: 'Cotação escolhida' })).toBeVisible()

  const linhas = page.getByRole('row').filter({ has: page.getByRole('checkbox', { name: /^Escolher / }) })
  const primeira = linhas.nth(0)
  await primeira.getByRole('checkbox', { name: 'Escolher Pavimenta para IM00011' }).check()
  await expect(primeira.getByRole('checkbox', { name: 'Escolher Pavimenta para IM00011' })).toBeChecked()
  // A coluna "Cotação escolhida" (última) traz o fornecedor e o preço dele (o 05 já mudou o preço deste insumo)
  await expect(primeira.getByRole('cell').nth(-4)).toHaveText('Pavimenta')
  await expect(primeira.getByRole('cell').nth(-2)).not.toHaveText('—')

  // Outro insumo com outra empresa
  const segunda = linhas.nth(1)
  const outra = segunda.getByRole('checkbox', { name: /^Escolher (?!Pavimenta)/ }).and(page.locator(':enabled')).first()
  await outra.check()
  await expect(outra).toBeChecked()
  await expect(page.getByText(/2\/\d+ itens · 2 empresas/)).toBeVisible()

  // Marcar outro fornecedor na mesma linha troca a escolha (um fornecedor por insumo)
  await primeira.getByRole('checkbox', { name: /^Escolher (?!Pavimenta)/ }).and(page.locator(':enabled')).first().check()
  await expect(primeira.getByRole('checkbox', { name: 'Escolher Pavimenta para IM00011' })).not.toBeChecked()
  await expect(primeira.getByRole('checkbox', { checked: true })).toHaveCount(1)

  await page.reload()
  await expect(linhas.nth(0).getByRole('checkbox', { checked: true })).toHaveCount(1)
  await expect(linhas.nth(1).getByRole('checkbox', { checked: true })).toHaveCount(1)

  // Desmarcar tira o insumo do cenário
  const marcada = (await linhas.nth(0).getByRole('checkbox', { checked: true }).getAttribute('aria-label'))!
  await linhas.nth(0).getByRole('checkbox', { name: marcada }).uncheck()
  await expect(linhas.nth(0).getByRole('checkbox', { checked: true })).toHaveCount(0)
  await expect(page.getByText(/1\/\d+ itens · 1 empresa\b/)).toBeVisible()
})

test('dados do QC: engenheiro e suprimentos são digitados', async ({ page }) => {
  await abrirQc(page, 'Pavimentação externa e passeio')
  await page.getByRole('tab', { name: 'Dados do QC' }).click()
  const eng = page.getByRole('textbox', { name: 'Engenheiro responsável' })
  const sup = page.getByRole('textbox', { name: 'Suprimentos responsável' })
  await eng.fill('Eng. Paulo Andrade')
  await sup.fill('Adriano Carvalho')
  await page.getByRole('button', { name: 'Salvar' }).click()
  await expect(page.getByRole('button', { name: 'Salvar' })).toBeDisabled()

  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Engenheiro responsável' })).toHaveValue('Eng. Paulo Andrade')
  await expect(page.getByRole('textbox', { name: 'Suprimentos responsável' })).toHaveValue('Adriano Carvalho')
})

test('QC com solicitação ativa mostra o botão dela e não oferece gerar outra', async ({ page }) => {
  await abrirQc(page, 'Terraplenagem e bota-fora')
  await expect(page.getByRole('button', { name: 'Solicitação SC-2041-001' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Gerar solicitação de contrato' })).toHaveCount(0)
})
