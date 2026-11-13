import { abrirAlpha, entrarComo, expect, nav, test } from './fixtures'

// Só lê a configuração dos fluxos (semente): não altera dados.

test('a tela de fluxos mostra diretores e fluxos por tipo de solicitação', async ({ page }) => {
  await abrirAlpha(page)
  await nav(page).getByText('Aprovações').click()
  await expect(page.getByRole('heading', { level: 1, name: 'Fluxos de aprovação' })).toBeVisible()
  await expect(page.getByText('Diretores aprovadores')).toBeVisible()
  await expect(page.getByText('Usuário: Helena Duarte')).toBeVisible()
  const rt = page.getByRole('listitem', { name: 'Fluxo Contratação de serviço (RT)' })
  await expect(rt).toContainText('Diretor responsável (RT)')
  await expect(rt).toContainText('diretor do pedido')
  await expect(page.getByRole('listitem', { name: 'Fluxo Desvio de custo ou quantidade' })).toBeVisible()
  await expect(page.getByRole('listitem', { name: 'Fluxo Aditivo de prazo contratual' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Novo fluxo' }).first()).toBeVisible()
})

test('quem não é administrador só consulta os fluxos', async ({ page }) => {
  await abrirAlpha(page)
  await entrarComo(page, 'Roberto Lima')
  await nav(page).getByText('Aprovações').click()
  await expect(page.getByText('Somente consulta. O administrador cadastra fluxos e diretores.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Novo fluxo' })).toHaveCount(0)
})
