import type { Page } from '@playwright/test'
import { abrirAlpha, abrirQc, entrarComo, expect, nav, test } from './fixtures'

// Altera só os custos fora de escopo da obra 2041 (FE-001 e FE-002 vêm do seed).

async function abrirForaDeEscopo(page: Page) {
  await abrirAlpha(page)
  await nav(page).getByText('Fora de escopo').click()
  await expect(page.getByText('Obra 2041 · Custos fora de escopo', { exact: false })).toBeVisible()
}

const kpi = (page: Page, label: string) => page.getByText(label, { exact: true }).locator('..')

test('a aba mostra os lançamentos do seed, o total e o peso sobre o orçamento', async ({ page }) => {
  await abrirForaDeEscopo(page)
  const fe1 = page.getByRole('row', { name: /FE-001/ })
  await expect(fe1).toContainText('Transporte de bota-fora adicional — solo contaminado')
  await expect(fe1).toContainText('Exigência técnica')
  await expect(fe1).toContainText('02.02 · TERRAPLENAGEM')
  await expect(fe1).toContainText('IP00104 — Terraplenagem')
  await expect(fe1).toContainText('R$ 4.584,00')
  await expect(page.getByRole('row', { name: /FE-002/ })).toContainText('Insumo livre')
  await expect(kpi(page, 'Custos fora de escopo')).toContainText('R$ 8.784,00')
  await expect(kpi(page, 'Custos fora de escopo')).toContainText('2 lançamento(s)')
  await expect(kpi(page, 'Sobre o orçamento')).toContainText('0,14%')
})

test('lança, edita e exclui um custo fora de escopo', async ({ page }) => {
  await abrirForaDeEscopo(page)
  await page.getByRole('button', { name: 'Novo custo fora de escopo' }).click()
  const dialog = page.getByRole('dialog')

  // Sem os obrigatórios o lançamento é recusado na própria tela
  await dialog.getByRole('button', { name: 'Lançar custo' }).click()
  await expect(dialog.getByText('Informe a quantidade')).toBeVisible()
  await expect(dialog.getByText('Escolha o motivo')).toBeVisible()
  await expect(dialog.getByText('Escolha a concorrência (QC) a que a solicitação se refere')).toBeVisible()
  await dialog.getByLabel('Concorrência (QC)').selectOption({ label: 'QC-0001 — Pavimentação externa e passeio' })

  await dialog.getByRole('radio', { name: 'Insumo livre' }).click()
  await dialog.getByLabel('Descrição').fill('Grade de proteção da escavação')
  await dialog.getByLabel('Unid.').fill('m')
  await dialog.getByRole('textbox', { name: 'Quantidade' }).fill('25')
  await dialog.getByRole('textbox', { name: 'Custo unitário' }).fill('180,50')
  await dialog.getByRole('textbox', { name: 'Custo unitário' }).blur()
  await expect(dialog.getByText('R$ 4.512,50')).toBeVisible()
  await dialog.getByLabel('Motivo').selectOption({ label: 'Alteração de projeto' })
  await dialog.getByLabel('Justificativa').fill('Projeto revisado incluiu proteção da escavação junto à divisa.')
  await dialog.getByRole('button', { name: 'Lançar custo' }).click()
  await expect(dialog).toBeHidden()

  const fe3 = page.getByRole('row', { name: /FE-003/ })
  await expect(fe3).toContainText('Grade de proteção da escavação')
  await expect(fe3).toContainText('Alteração de projeto')
  await expect(fe3).toContainText('R$ 4.512,50')
  await expect(fe3.getByRole('link', { name: 'QC-0001' })).toBeVisible()
  await expect(kpi(page, 'Custos fora de escopo')).toContainText('R$ 13.296,50')

  // Editar: nova quantidade recalcula o total
  await page.getByRole('button', { name: 'Editar FE-003' }).click()
  await page.getByRole('dialog').getByRole('textbox', { name: 'Quantidade' }).fill('10')
  await page.getByRole('dialog').getByRole('textbox', { name: 'Quantidade' }).blur()
  await page.getByRole('dialog').getByRole('button', { name: 'Salvar' }).click()
  await expect(fe3).toContainText('R$ 1.805,00')

  // Excluir pede confirmação
  await page.getByRole('button', { name: 'Excluir FE-003' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Excluir' }).click()
  await expect(page.getByRole('row', { name: /FE-003/ })).toHaveCount(0)
  await expect(kpi(page, 'Custos fora de escopo')).toContainText('R$ 8.784,00')
})

test('o Gerente vê os custos fora de escopo, mas não lança', async ({ page }) => {
  await abrirForaDeEscopo(page)
  await entrarComo(page, 'Roberto Lima')
  await expect(page.getByRole('row', { name: /FE-001/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Novo custo fora de escopo' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Editar FE-001' })).toHaveCount(0)
})

test('a quantidade fora de escopo informada no mapa vai para a aba, com link para o QC de origem', async ({ page }) => {
  await abrirQc(page, 'Pavimentação externa e passeio')
  await page.getByRole('tab', { name: /Mapa de cotação/ }).click()
  await expect(page.getByRole('columnheader', { name: 'Quant. FE' })).toBeVisible()
  const fe = page.getByRole('textbox', { name: 'Quantidade fora de escopo de IM00011' })
  await fe.fill('10')
  await fe.press('Enter')
  await expect(page.getByText('fora de escopo · 10').first()).toBeVisible()
  await expect(page.getByRole('cell', { name: /^Total sem fora de escopo/ })).toBeVisible()
  await expect(page.getByRole('cell', { name: /^Resultado com fora de escopo/ })).toBeVisible()

  await nav(page).getByText('Fora de escopo').click()
  const linha = page.getByRole('row', { name: /IM00011/ })
  await expect(linha).toContainText('QC-0001')
  await expect(linha).toContainText('informada no mapa')
  await linha.getByRole('link', { name: /QC-0001/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: /Pavimentação externa e passeio/ })).toBeVisible()
})
