import { expect, test } from '@playwright/test'
import { openNewDocument } from './helpers'

/**
 * Alt+drag must produce a column (rectangular) selection: one cursor per line
 * at the dragged column span, not one contiguous run of text. The Markdown
 * editor registers `rectangularSelection()` in `createBaseExtensions`, and
 * every pointer handler this editor owns steps aside while Alt is held
 * (`livePreviewEvents.ts`, `codeBlockPreview.ts`).
 *
 * Runs in both browser projects on purpose: the desktop app is a WKWebView, so
 * WebKit is the engine that matters for a modifier-key regression.
 */
test('alt+drag selects a column instead of a run of text', async ({ page }) => {
  await openNewDocument(page)
  await page.keyboard.type('alpha one\nalpha two\nalpha three\nalpha four')

  const box = await page.evaluate(() => {
    const lines = Array.from(document.querySelectorAll('.cm-line'))
    const first = lines[0].getBoundingClientRect()
    const last = lines[lines.length - 1].getBoundingClientRect()
    return {
      x1: Math.round(first.left + 2),
      y1: Math.round(first.top + first.height / 2),
      x2: Math.round(first.left + 34),
      y2: Math.round(last.top + last.height / 2),
    }
  })

  await page.keyboard.down('Alt')
  await page.mouse.move(box.x1, box.y1)
  await page.mouse.down()
  await page.mouse.move(box.x2, Math.round((box.y1 + box.y2) / 2), { steps: 8 })
  await page.mouse.move(box.x2, box.y2, { steps: 8 })
  await page.mouse.up()
  await page.keyboard.up('Alt')

  // One cursor per line is the observable signature of a rectangular
  // selection; a plain drag leaves exactly one.
  await expect.poll(() => page.locator('.cm-cursor').count()).toBe(4)

  // And it must be a real multi-range selection, not just painting: typing
  // replaces the dragged column on every line at once.
  await page.keyboard.type('X')
  await expect
    .poll(() =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll('.cm-line')).map((line) => line.textContent),
      ),
    )
    .toEqual(['Xa one', 'Xa two', 'Xa three', 'Xa four'])
})
