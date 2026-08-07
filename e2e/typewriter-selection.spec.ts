import { expect, test } from '@playwright/test'
import { openNewDocument } from './helpers'

test('typewriter mode does not recenter a non-empty pointer selection', async ({ page }) => {
  await openNewDocument(page)
  await page.keyboard.insertText(
    Array.from(
      { length: 90 },
      (_, index) => `第${index + 1}行普通文本，拖选不应触发打字机滚动`,
    ).join('\n'),
  )

  await page.keyboard.press('F9')
  await expect(page.locator('.status-right')).toContainText('打字机模式')

  const startLine = page.locator('.cm-line', { hasText: '第40行' })
  const endLine = page.locator('.cm-line', { hasText: '第47行' })
  await startLine.scrollIntoViewIfNeeded()
  await expect(startLine).toBeVisible()
  await expect(endLine).toBeVisible()

  const start = await startLine.boundingBox()
  const end = await endLine.boundingBox()
  expect(start).not.toBeNull()
  expect(end).not.toBeNull()

  const scroller = page.locator('.cm-scroller')
  const before = await scroller.evaluate((element) => element.scrollTop)
  await page.mouse.move(start!.x + 2, start!.y + start!.height / 2)
  await page.mouse.down()
  await page.mouse.move(end!.x + 220, end!.y + end!.height / 2, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(220)

  const after = await scroller.evaluate((element) => element.scrollTop)
  const selectedText = await page.evaluate(() => window.getSelection()?.toString() ?? '')

  expect(selectedText).toContain('第40行')
  expect(selectedText).toContain('第47行')
  expect(after).toBeCloseTo(before, 0)
})
