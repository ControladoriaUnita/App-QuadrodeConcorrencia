import { abrirQc, expect, test } from './fixtures'

test('o QC abre com as abas na ordem do fluxo e os indicadores da cotação', async ({ page }) => {
  await abrirQc(page, 'Pavimentação externa e passeio')
  const abas = page.getByRole('tablist').first().getByRole('tab')
  await expect(abas).toHaveText([
    'Vínculos e insumos',
    /^Mapa de cotação/,
    /^Fornecedores e condições/,
    'Dados do QC',
    'Anexos',
    'Aprovações',
    'Histórico',
  ])
  await expect(page.getByText('Menor proposta completa')).toBeVisible()
  await expect(page.getByText('R$ 47.780,22')).toBeVisible()
  await expect(page.getByText('Pavimenta · 6,3%')).toBeVisible()
  await expect(page.getByRole('button', { name: /6 pendência\(s\) para envio à aprovação/ })).toBeVisible()
})

test('o mapa de cotação compara os fornecedores e aponta a melhor condição', async ({ page }) => {
  await abrirQc(page, 'Pavimentação externa e passeio')
  await page.getByRole('tab', { name: /Mapa de cotação/ }).click()
  await expect(page).toHaveURL(/aba=mapa/)
  for (const f of ['Pavimenta', 'Horizonte', 'Terra Forte', 'Mineira Obras']) {
    await expect(page.getByRole('columnheader', { name: new RegExp(`^${f}`) })).toBeVisible()
  }
  await expect(page.getByRole('columnheader', { name: /Horizonte CND vencida/ })).toBeVisible()
  const linha = page.getByRole('row', { name: /^1 Mini guia de concreto/ })
  await expect(linha.getByRole('textbox', { name: 'Preço unitário de Pavimenta para IM00011' })).toHaveValue('8,06')
  await expect(linha).toContainText(/Pavimenta\s*8,06\s*1\.165,48\s*-11,0%/)
})

test('fornecedores e dados do QC mostram condições e opções de vencedora', async ({ page }) => {
  await abrirQc(page, 'Pavimentação externa e passeio')
  await page.getByRole('tab', { name: /Fornecedores e condições/ }).click()
  await expect(page.getByRole('heading', { level: 3, name: /Pavimenta 1º menor preço/ })).toBeVisible()
  await expect(page.getByRole('definition').filter({ hasText: /30\/09\/2026\s*Vencida/ })).toBeVisible()

  await page.getByRole('tab', { name: 'Dados do QC' }).click()
  const vencedora = page.getByRole('combobox', { name: 'Empresa vencedora' })
  await expect(vencedora.getByRole('option')).toHaveText([
    'Selecione…',
    'Pavimenta — R$ 47.780,22 (1º)',
    'Horizonte — R$ 37.284,65 (proposta incompleta)',
    'Terra Forte — R$ 49.261,21 (2º)',
    'Mineira Obras — R$ 53.203,26 (proposta incompleta)',
  ])
})
