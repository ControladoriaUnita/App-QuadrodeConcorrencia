import { expect, test } from './fixtures'

const emTelaCheia = (page: import('@playwright/test').Page) => page.evaluate(() => !!document.fullscreenElement)

test('botão de tela cheia liga e desliga a tela cheia', async ({ page }) => {
  await page.goto('/obras')
  await page.getByRole('button', { name: 'Tela cheia' }).click()
  await expect.poll(() => emTelaCheia(page)).toBe(true)
  await expect(page.getByRole('button', { name: 'Sair da tela cheia' })).toBeVisible()

  await page.getByRole('button', { name: 'Sair da tela cheia' }).click()
  await expect.poll(() => emTelaCheia(page)).toBe(false)
  await expect(page.getByRole('button', { name: 'Tela cheia' })).toBeVisible()
})
