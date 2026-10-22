import { join } from 'node:path'
import { expect, nav, test } from './fixtures'
import type { Locator, Page } from '@playwright/test'

/** Arquivo de indireto de exemplo (valores fictícios; mesmo conteúdo de shared/domain/budget/__fixtures__) */
const INDIRETO = join(__dirname, 'fixtures', 'indireto-exemplo.xlsx')
const tabela = (page: Page) => page.getByRole('table', { name: 'Orçamento da obra' })

async function escolher(page: Page, onde: Page | Locator, campo: string | RegExp, texto: string, opcao: RegExp) {
  const combo = onde.getByRole('combobox', { name: campo, exact: typeof campo === 'string' })
  await combo.click()
  await combo.fill(texto)
  await page.getByRole('option', { name: opcao }).first().click()
}

test('de-para: nome e IP por Item; a obra nova do SharePoint já vem com eles', async ({ page }) => {
  await page.goto('/obras')
  await nav(page).getByText('De-para').click()
  await expect(page.getByRole('heading', { level: 1, name: 'De-para do orçamento' })).toBeVisible()
  const itens = page.getByRole('table', { name: 'De-para dos Itens' })
  await expect(itens.getByRole('textbox', { name: 'Nome do item 16' })).toHaveValue('INDIRETO')
  await escolher(page, page, 'IP do item 02', 'IP00349', /IP00349/)
  await expect(page.getByRole('combobox', { name: 'IP do item 02', exact: true })).toHaveValue(/IP00349/)

  // Obra 2070 pelo SharePoint de exemplo (traz o indireto fechado no item 16)
  await page.goto('/obras')
  await page.getByRole('button', { name: 'Nova obra' }).click()
  const nova = page.getByRole('dialog')
  await escolher(page, nova, /^Empresa/, '2', /Unità Incorporações/)
  await escolher(page, nova, /^Obra/, '2070', /2070/)
  await nova.getByRole('button', { name: 'Criar obra' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Residencial Beta' })).toBeVisible()

  await expect(tabela(page).getByRole('row', { name: /01 Item SERVIÇOS PRELIMINARES/ })).toBeVisible()
  await expect(tabela(page).getByRole('row', { name: /16 Item INDIRETO/ })).toBeVisible()
  const contrapiso = tabela(page).getByRole('row', { name: /Serviço de contra piso/ })
  await expect(contrapiso.getByRole('button', { name: 'IP00349' })).toBeVisible()
})

test('importar o indireto abre o item 16 insumo a insumo e alimenta o de-para do indireto', async ({ page }) => {
  await page.goto('/obras')
  await page.getByRole('link', { name: /Residencial Beta/ }).click()
  await expect(tabela(page).getByRole('row', { name: /Custo indireto - equipamentos/ })).toBeVisible()

  await page.getByRole('button', { name: 'Importar indireto (Excel)' }).click()
  const dialogo = page.getByRole('dialog')
  await expect(dialogo.getByText('Selecione o arquivo .xlsx do indireto')).toBeVisible()
  await expect(dialogo.getByText(/Indireto em uso/)).toHaveCount(0)
  await dialogo.getByLabel('Arquivo do indireto').setInputFiles(INDIRETO)
  const itens = dialogo.getByRole('table', { name: 'Itens do indireto' })
  await expect(itens.getByRole('row', { name: /16\.01 EQUIPAMENTOS 2 R\$ 1\.450,00 R\$ 1\.450,00/ })).toBeVisible()
  await expect(dialogo.getByText('R$ 31.050,00')).toBeVisible()
  await dialogo.getByRole('button', { name: 'Importar indireto' }).click()

  await expect(page.getByText(/Orçamento atualizado · versão 2/)).toBeVisible()
  await expect(tabela(page).getByRole('row', { name: /Carrinho de mão - 80l/ })).toBeVisible()
  await expect(tabela(page).getByRole('row', { name: /Custo indireto - equipamentos/ })).toHaveCount(0)
  // Reabrir mostra o indireto em uso
  await page.getByRole('button', { name: 'Importar indireto (Excel)' }).click()
  await expect(page.getByRole('dialog').getByText(/Indireto em uso: indireto-exemplo\.xlsx · R\$ 31\.050,00/)).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click()

  await nav(page).getByText('De-para').click()
  await page.getByRole('radio', { name: /Indireto/ }).click()
  const indireto = page.getByRole('table', { name: 'De-para do indireto' })
  await expect(indireto.getByRole('row', { name: /Almoxarife 16\.05 MÃO DE OBRA INDIRETA - CLT/ })).toBeVisible()
})
