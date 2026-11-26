import { abrirAlpha, abrirQc, expect, nav, test } from './fixtures'

test('"Ocultar campos" esconde objeto, tipo e origem do pedido e eles voltam se faltarem ao criar', async ({ page }) => {
  await abrirAlpha(page)
  await page.getByRole('button', { name: 'Nova concorrência' }).click()
  await page.getByPlaceholder('Ex.: Fornecimento e instalação de esquadrias de alumínio').fill('Teste de ocultar')
  await page.getByLabel('Tipo do pedido').selectOption({ label: 'Material' })

  await page.getByRole('button', { name: 'Ocultar campos' }).click()
  await expect(page.getByPlaceholder('Ex.: Fornecimento e instalação de esquadrias de alumínio')).toHaveCount(0)
  await expect(page.getByLabel('Tipo do pedido')).toHaveCount(0)
  await expect(page.getByLabel('Origem do pedido')).toHaveCount(0)
  // O que foi preenchido fica resumido; data e diretor continuam na tela
  await expect(page.getByText('Teste de ocultar · Material · Origem não escolhida')).toBeVisible()
  await expect(page.getByLabel('Data da solicitação')).toBeVisible()
  await expect(page.getByLabel('Diretor aprovador')).toBeVisible()

  // Mostrar de novo mantém o que foi digitado
  await page.getByRole('button', { name: 'Mostrar campos' }).click()
  await expect(page.getByPlaceholder('Ex.: Fornecimento e instalação de esquadrias de alumínio')).toHaveValue('Teste de ocultar')
  await expect(page.getByLabel('Tipo do pedido')).toHaveValue('material')

  // Oculto com pendência: ao criar, os campos voltam para o aviso aparecer
  await page.getByRole('button', { name: 'Ocultar campos' }).click()
  await page.getByRole('button', { name: 'Criar concorrência' }).click()
  await expect(page.getByText('Escolha quem abriu o pedido')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ocultar campos' })).toBeVisible()
})

test('criar concorrência a partir do orçamento leva ao novo QC e ele aparece no quadro', async ({ page }) => {
  await abrirAlpha(page)
  await page.getByRole('button', { name: 'Nova concorrência' }).click()
  await expect(page).toHaveURL(/\/concorrencias\/nova$/)

  await page.getByRole('button', { name: 'Criar concorrência' }).click()
  await expect(page.getByText('Informe o % a consumir de ao menos um insumo do orçamento.')).toBeVisible()

  await expect(page.getByText('Escolha material ou mão de obra')).toBeVisible()
  await expect(page.getByText('Escolha o diretor que entra no fluxo')).toBeVisible()

  await page.getByPlaceholder('Ex.: Fornecimento e instalação de esquadrias de alumínio').fill('Esquadrias de alumínio — teste E2E')
  // Pedido: tipo, origem e diretor escolhem o fluxo de aprovação
  await page.getByLabel('Tipo do pedido').selectOption({ label: 'Mão de obra' })
  await page.getByLabel('Origem do pedido').selectOption({ label: 'Suprimentos' })
  await page.getByLabel('Diretor aprovador').selectOption({ label: 'RT — Diretor RT' })
  await expect(page.getByText('Fluxo de aprovação: Contratação de serviço (RT)')).toBeVisible()
  await page.getByRole('combobox', { name: 'Vínculo PL' }).selectOption({ label: 'IP00153 — Esquadrias de Alumínio' })
  // Sem caixa de marcação: o % digitado no Item puxa a verba de todos os insumos abaixo
  await expect(page.getByRole('checkbox', { name: /^Marcar/ })).toHaveCount(0)
  await page.getByRole('textbox', { name: /^% a consumir em todos os insumos de/ }).first().fill('100')
  await page.getByRole('textbox', { name: /^% a consumir em todos os insumos de/ }).first().press('Tab')
  await expect(page.getByText(/1 IP\(s\): IP00153/)).toBeVisible()

  await page.getByRole('button', { name: 'Criar concorrência' }).click()
  await expect(page).toHaveURL(/\/qc\/[^/?]+\?aba=vinculos/)
  await expect(page.getByRole('heading', { level: 1, name: /QC-0005 — Esquadrias de alumínio — teste E2E/ })).toBeVisible()
  await expect(page.getByText('Diretor: Diretor RT')).toBeVisible()

  await nav(page).getByText('Concorrências').click()
  await expect(page.getByRole('region', { name: 'Em cotação' })).toContainText('Esquadrias de alumínio — teste E2E')
})

test('o envio do QC para aprovação fica na aba Solicitação de contrato', async ({ page }) => {
  await abrirQc(page, 'Esquadrias de alumínio — teste E2E')
  await expect(page.getByRole('button', { name: 'Enviar para aprovação' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Solicitação e envio' }).click()
  await expect(page.getByRole('tab', { name: /Solicitação de contrato/ })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('button', { name: 'Enviar QC para aprovação' }).click()
  // QC ainda incompleto: o diálogo avisa das pendências; cancela sem enviar
  await expect(page.getByText('Enviar para aprovação?')).toBeVisible()
  await expect(page.getByText('Há pendências')).toBeVisible()
  await page.getByRole('button', { name: 'Cancelar' }).click()
  await expect(page.getByText('Enviar para aprovação?')).toBeHidden()
})

test('a solicitação é liberada antes da aprovação: os dados são preenchidos na própria aba e ela é gerada na hora', async ({ page }) => {
  await abrirQc(page, 'Pavimentação externa e passeio')
  await page.getByRole('tab', { name: /Solicitação de contrato/ }).click()
  await expect(page.getByText('Preencha os dados da solicitação de contrato')).toBeVisible()
  await page.getByLabel('Início do serviço').fill('2027-01-04')
  await page.getByLabel('Término do serviço').fill('2027-03-31')
  await page.getByLabel('Engenheiro responsável').fill('Eng. Teste E2E')
  await page.getByLabel('Tipo de contrato').selectOption({ index: 1 })
  await page.getByLabel('Empresa vencedora').selectOption({ index: 1 })
  await page.getByLabel('Justificativa da escolha').fill('Melhor proposta completa.')
  await page.getByRole('button', { name: 'Salvar' }).click()
  // Gerada sozinha, em rascunho, antes da aprovação; o envio do QC fica na mesma tela
  await expect(page.getByText('QC ainda não aprovado')).toBeVisible()
  await expect(page.getByText('2. Itens do contrato', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Enviar QC para aprovação' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Enviar e concluir' })).toBeDisabled()
  // Cada linha aponta o item do orçamento de onde vem
  await expect(page.getByLabel(/^Item do orçamento de /).first()).toContainText(/Item \d+/)
})
