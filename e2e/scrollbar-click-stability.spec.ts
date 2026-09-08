import { expect, test } from '@playwright/test'
import { openNewDocument } from './helpers'

test('clicking visible content after a thumb drag keeps the manual scroll position', async ({
  page,
}) => {
  await openNewDocument(page)
  await page.keyboard.insertText(
    Array.from({ length: 120 }, (_, index) => `## 标题 ${index + 1}\n正文 ${index + 1}`).join(
      '\n\n',
    ),
  )

  const scroller = page.locator('.cm-scroller')
  const thumb = page.locator(
    '.xmd-cm-editor .hover-scrollbar-track-vertical .hover-scrollbar-thumb',
  )
  await expect(thumb).toBeVisible()
  const thumbBox = await thumb.boundingBox()
  expect(thumbBox).not.toBeNull()

  await page.mouse.move(thumbBox!.x + thumbBox!.width / 2, thumbBox!.y + thumbBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(thumbBox!.x + thumbBox!.width / 2, thumbBox!.y - 220, { steps: 8 })
  await page.mouse.up()

  const scrollerBox = await scroller.boundingBox()
  expect(scrollerBox).not.toBeNull()
  const clickPoint = await page.evaluate(
    ({ top, bottom }) => {
      for (const line of document.querySelectorAll<HTMLElement>('.cm-line')) {
        const rect = line.getBoundingClientRect()
        if (line.textContent?.trim() && rect.top >= top + 24 && rect.bottom <= bottom - 24) {
          return { x: rect.left + Math.min(160, rect.width / 3), y: (rect.top + rect.bottom) / 2 }
        }
      }
      return null
    },
    {
      top: scrollerBox!.y,
      bottom: scrollerBox!.y + scrollerBox!.height,
    },
  )
  expect(clickPoint).not.toBeNull()

  const beforeClick = await scroller.evaluate((element) => element.scrollTop)
  await page.mouse.click(clickPoint!.x, clickPoint!.y)
  await page.waitForTimeout(220)
  const afterClick = await scroller.evaluate((element) => element.scrollTop)

  expect(afterClick).toBeCloseTo(beforeClick, 0)
})
