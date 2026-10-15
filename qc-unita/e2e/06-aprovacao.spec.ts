import { abrirQc, entrarComo, expect, test } from './fixtures'

// QC-0002 (Contrapiso) está em aprovação com Suprimentos já aprovado: a vez é da Engenharia.

test('só o papel da etapa atual decide, e a aprovação passa para a próxima alçada', async ({ page }) => {
  await abrirQc(page, 'Contrapiso — torres e áreas comuns')
  await page.getByRole('tab', { name: 'Aprovações' }).click()

  // Lucas (administrador) e Adriano (Suprimentos) não são da Engenharia
  await entrarComo(page, 'Adriano Carvalho')
  await expect(page.getByText('Aguardando decisão do papel “Engenharia”.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Aprovar' })).toHaveCount(0)

  await entrarComo(page, 'Marina Costa')
  await expect(page.getByText('Etapa atual:')).toContainText('Engenharia')
  await page.getByRole('textbox', { name: 'Comentário' }).fill('Quantitativos conferidos.')
  await page.getByRole('button', { name: 'Aprovar' }).click()

  const etapa = (nome: string) => page.getByRole('listitem').filter({ hasText: nome })
  await expect(etapa('Engenharia')).toContainText('Marina Costa')
  await expect(etapa('Engenharia')).toContainText('“Quantitativos conferidos.”')
  await expect(etapa('Gerente / Coordenador de Obra')).toContainText('Aguardando')
  await expect(page.getByText('Aguardando decisão do papel')).toBeVisible()
})

test('reprovar exige comentário', async ({ page }) => {
  await abrirQc(page, 'Contrapiso — torres e áreas comuns')
  await page.getByRole('tab', { name: 'Aprovações' }).click()
  await entrarComo(page, 'Roberto Lima')
  await expect(page.getByRole('button', { name: 'Reprovar' })).toBeDisabled()
  await page.getByRole('textbox', { name: 'Comentário' }).fill('Rever prazo.')
  await expect(page.getByRole('button', { name: 'Reprovar' })).toBeEnabled()
})
