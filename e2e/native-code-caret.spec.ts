import { expect, test, type Page } from '@playwright/test'
import { openNewDocument } from './helpers'

/** Code rows use nested horizontal scrollers. Cursor-layer repainting must
 * remain singular while those scrollers move, and the shared controls must
 * stay anchored to the card rather than the padded editor root. */

/** display of `.cm-cursor-primary` — 'absent' when drawSelection has not
 * painted one at all (also an acceptable "no fake caret" state). */
async function primaryCursorDisplay(page: Page): Promise<string> {
  return page.evaluate(() => {
    const cursor = document.querySelector('.cm-cursor-primary')
    return cursor ? getComputedStyle(cursor).display : 'absent'
  })
}

test('CM6 caret stays singular inside horizontally scrolled code', async ({ page }) => {
  await openNewDocument(page)

  await page.keyboard.type('plain paragraph')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.type('```js')
  await page.keyboard.press('Enter')
  await page.keyboard.type('const seed = 1')
  await page.keyboard.press('Enter')
  await page.keyboard.type('```')

  const editor = page.locator('.xmd-cm-editor .cm-editor')
  const codeContent = page.locator('.xmd-cm-code-line-content', { hasText: 'const seed' })
  await expect(codeContent).toBeVisible()

  // Code blocks intentionally use the same CM6 cursor layer as prose. The
  // former native-caret switch left WebKit paint trails after arrow movement.
  await codeContent.click()
  await expect(editor).not.toHaveClass(/xmd-cm-native-code-caret/)
  await expect.poll(() => primaryCursorDisplay(page)).toBe('block')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.cm-cursor-primary')).toHaveCount(1)

  // The singleton controls live under scrollDOM rather than inside the code
  // row, but their right edge must still be measured from the active card.
  // `.cm-content` has page padding, so anchoring to its outer rect pushes the
  // controls into that gutter (most visible at non-default zoom levels).
  const controlsPlacement = await page.evaluate(() => {
    const line = document.querySelector<HTMLElement>('.cm-line.xmd-cm-code-line')
    const controls = document.querySelector<HTMLElement>('.xmd-cm-code-preview-header.is-active')
    if (!line || !controls) return null
    const card = line.getBoundingClientRect()
    const header = controls.getBoundingClientRect()
    return { cardRight: card.right, controlsRight: header.right }
  })
  expect(controlsPlacement).not.toBeNull()
  expect(controlsPlacement!.cardRight - controlsPlacement!.controlsRight).toBeCloseTo(0, 0)

  // The same cursor remains active after returning to prose.
  await page.locator('.cm-line', { hasText: 'plain paragraph' }).click()
  await expect(editor).not.toHaveClass(/xmd-cm-native-code-caret/)
  await expect.poll(() => primaryCursorDisplay(page)).toBe('block')

  // --- Caret follows the nested scroller -----------------------------------
  // Type enough at the end of the code line to overflow the row's nested
  // horizontal scroller. The caret-reveal measure loop (CodeBlockScrollPlugin
  // in codeBlockPreview.ts) must scroll the row so the insertion point stays
  // visible.
  await codeContent.click()
  await page.keyboard.press('End')
  await page.keyboard.type(` + '${'x'.repeat(240)}'`)

  // The nested scroller (not the page, not CM6's .cm-scroller) is what must
  // have scrolled: this was exactly the coordinate space the old fake-cursor
  // math ignored.
  await expect.poll(() => codeContent.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)

  // The visible shared scrollbar uses the same card-relative horizontal
  // geometry. Its 16px insets should sit inside the card at both ends, not
  // inside `.cm-content`'s surrounding page padding.
  await expect(page.locator('.xmd-cm-code-scrollbar.is-overflowing.is-active')).toBeVisible()
  const scrollbarPlacement = await page.evaluate(() => {
    const line = document.querySelector<HTMLElement>('.cm-line.xmd-cm-code-line')
    const scrollbar = document.querySelector<HTMLElement>(
      '.xmd-cm-code-scrollbar.is-overflowing.is-active',
    )
    if (!line || !scrollbar) return null
    const card = line.getBoundingClientRect()
    const track = scrollbar.getBoundingClientRect()
    return {
      leftInset: track.left - card.left,
      rightInset: card.right - track.right,
    }
  })
  expect(scrollbarPlacement).not.toBeNull()
  expect(scrollbarPlacement!.leftInset).toBeCloseTo(16, 0)
  expect(scrollbarPlacement!.rightInset).toBeCloseTo(16, 0)

  // The DOM selection endpoint (the native caret's anchor) must sit inside
  // the scroller's visible rect — i.e. the caret followed the scroll instead
  // of drifting out of the clipped row like the painted cursor used to.
  const placement = await codeContent.evaluate((element) => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return null
    const range = selection.getRangeAt(0).cloneRange()
    range.collapse(false)
    const caret = range.getBoundingClientRect()
    const container = element.getBoundingClientRect()
    return {
      caretLeft: caret.left,
      caretRight: caret.right,
      containerLeft: container.left,
      containerRight: container.right,
      insideContainer: element.contains(range.endContainer),
    }
  })
  expect(placement).not.toBeNull()
  // The caret must belong to this row's scroller subtree…
  expect(placement?.insideContainer).toBe(true)
  // …and its rect must fall within the scroller's on-screen horizontal span
  // (1px tolerance for fractional caret rects at the very edge).
  expect(placement!.caretLeft).toBeGreaterThanOrEqual(placement!.containerLeft - 1)
  expect(placement!.caretRight).toBeLessThanOrEqual(placement!.containerRight + 1)
})
