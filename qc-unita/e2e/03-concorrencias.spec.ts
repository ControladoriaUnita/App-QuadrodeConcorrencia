import { abrirAlpha, expect, nav, test } from './fixtures'

test('o quadro de concorrências separa os QCs por etapa', async ({ page }) => {
  await abrirAlpha(page)
  await nav(page).getByText('Concorrências').click()
  await expect(page).toHaveURL(/\/concorrencias$/)

  const coluna = (nome: string) => page.getByRole('region', { name: nome })
  await expect(coluna('Em cotação').getByRole('link')).toHaveCount(2)
  await expect(coluna('Em cotação')).toContainText('Pavimentação externa e passeio')
  await expect(coluna('Em cotação')).toContainText('Materiais básicos — cimento, areia e argamassas')
  await expect(coluna('Em aprovação').getByRole('link')).toHaveCount(1)
  await expect(coluna('Em aprovação')).toContainText('Contrapiso — torres e áreas comuns')
  await expect(coluna('Aprovada')).toContainText('Nenhuma concorrência')
  await expect(coluna('Contratada').getByRole('link')).toHaveCount(1)
  await expect(coluna('Contratada')).toContainText('Terraplenagem e bota-fora')
})

test('a busca do quadro filtra pelo código ou objeto', async ({ page }) => {
  await abrirAlpha(page)
  await nav(page).getByText('Concorrências').click()
  await page.getByRole('textbox', { name: 'Buscar concorrência' }).fill('QC-0002')
  await expect(page.getByRole('link', { name: /QC-0002/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /QC-0001/ })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /QC-0004/ })).toHaveCount(0)
})
