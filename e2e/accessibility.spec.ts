import { expect, test } from '@playwright/test'

test('welcome recents and settings modal are keyboard accessible', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('body')).toHaveClass(/is-browser-preview/)

  const recentFile = page.getByRole('button', { name: /渲染示例/ })
  await recentFile.focus()
  await expect(recentFile).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('.cm-content')).toBeVisible()

  // Return to a stable opener, then verify the modal owns focus and returns it on close.
  await page.reload()
  const opener = page.locator('.action-card', { hasText: '新建文件' })
  await opener.focus()
  const modifier = await page.evaluate(() =>
    /Mac|iPhone|iPad/.test(navigator.platform) ? 'Meta' : 'Control',
  )
  await page.keyboard.press(`${modifier}+,`)
  const dialog = page.getByRole('dialog', { name: '设置' })
  await expect(dialog).toBeVisible()
  const close = dialog.getByRole('button', { name: '关闭设置' })
  await expect(close).toBeFocused()

  const focusable = dialog.locator(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )
  const last = focusable.last()
  await last.focus()
  await page.keyboard.press('Tab')
  await expect(close).toBeFocused()

  await close.click()
  await expect(dialog).toBeHidden()
  await expect(opener).toBeFocused()
})
