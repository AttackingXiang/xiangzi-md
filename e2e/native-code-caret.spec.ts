import { expect, test, type Page } from '@playwright/test'
import { openNewDocument } from './helpers'

/**
 * Historical bug (fixed in commit 40fd735, "native caret inside fenced code,
 * drop cursor transform hack"): CM6's drawSelection paints `.cm-cursor` at
 * coordinates it computes itself, with no awareness of the nested
 * `.xmd-cm-code-line-content` horizontal scroller code rows use — once that
 * scroller moved, the painted cursor drifted away from the real insertion
 * point (an earlier transform-based compensation hack was itself buggy). The
 * fix hides CM6's primary fake cursor while the caret is inside a code body
 * (`xmd-cm-native-code-caret` on the editor root, codeBlockPreview.ts's
 * `updateSelectionPresentation`) and lets the browser's native caret — which
 * is positioned in and clipped by that same scroller — take over.
 *
 * NOTE: this suite has been written but not executed — see
 * docs/ENGINEERING_CONSTRAINTS.md ("测试金字塔" → Playwright 浏览器回归).
 */

/** display of `.cm-cursor-primary` — 'absent' when drawSelection has not
 * painted one at all (also an acceptable "no fake caret" state). */
async function primaryCursorDisplay(page: Page): Promise<string> {
  return page.evaluate(() => {
    const cursor = document.querySelector('.cm-cursor-primary')
    return cursor ? getComputedStyle(cursor).display : 'absent'
  })
}

test('native caret takes over inside code and follows horizontal scroll', async ({ page }) => {
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

  // --- Toggle on: caret into the code body ---------------------------------
  await codeContent.click()
  // Bug fixed by 40fd735: without the class toggle the fake cursor stayed
  // visible inside code rows and drifted once the row scrolled.
  await expect(editor).toHaveClass(/xmd-cm-native-code-caret/)
  // codeBlockPreview.css hides only the primary fake cursor (secondary
  // multi-cursor carets keep the overlay) with `display: none !important`.
  await expect.poll(() => primaryCursorDisplay(page)).toMatch(/^(none|absent)$/)

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
  expect(controlsPlacement!.cardRight - controlsPlacement!.controlsRight).toBeCloseTo(10, 0)

  // --- Toggle off: caret back into a plain paragraph ------------------------
  await page.locator('.cm-line', { hasText: 'plain paragraph' }).click()
  await expect(editor).not.toHaveClass(/xmd-cm-native-code-caret/)
  // The fake caret must come back for normal text — regression guard for the
  // class getting stuck on after leaving the block. (The editor is focused,
  // so drawSelection paints a visible primary cursor again.)
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
