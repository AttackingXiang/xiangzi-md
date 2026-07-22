import { expect, test } from '@playwright/test'
import { activeLineText, editorText, openNewDocument } from './helpers'

/**
 * Historical bug (fixed in commit 8dff016, "inline HTML reveal-on-selection"):
 * live preview hides matched inline HTML tag pairs (`<font …>…</font>`) as
 * unconditionally-atomic hidden ranges. A caret resting exactly on the closing
 * tag's right boundary therefore hit an atomic range on every Backspace — the
 * key did nothing at all ("dead key") and there was no keyboard path to ever
 * reveal or edit the tags. The fix (livePreview.ts, `collectHiddenRanges`'s
 * inline-HTML span loop) reveals both tags whenever the selection touches the
 * span, so the caret at the close tag's boundary sees plain editable text.
 *
 */
test('backspace at the </font> right boundary edits instead of dying', async ({ page }) => {
  await openNewDocument(page)

  // Type a paragraph whose middle is a colored inline HTML span. There is no
  // bracket/tag auto-closing in the editor (createBaseExtensions has no
  // closeBrackets), so this arrives verbatim as document text.
  const source = '前缀<font color="#ff0000">红字</font>后缀'
  await page.keyboard.type(source)

  // With the caret at the very end (after 后缀) the selection no longer
  // touches the tag span, so live preview hides both tags: the rendered line
  // shows only 前缀红字后缀. Wait for that hidden state to settle first so the
  // subsequent reveal assertion cannot pass vacuously.
  await expect.poll(() => activeLineText(page)).not.toContain('<font')

  // Step the caret left over 后缀 (2 characters) onto the closing tag's right
  // boundary. ArrowLeft moves by one character per press; the hidden close
  // tag is atomic, so after two presses the caret rests exactly at `>`.
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')

  // Reveal-on-selection: a caret touching the span boundary must reveal the
  // raw tags (this was the missing keyboard path in the historical bug).
  await expect.poll(() => activeLineText(page)).toContain('<font')

  const before = await editorText(page)
  await page.keyboard.press('Backspace')

  // The historical bug was Backspace being swallowed by the atomic range —
  // document unchanged. Now it must delete exactly the revealed `>` of the
  // closing tag.
  await expect.poll(() => editorText(page)).not.toBe(before)
  const after = await editorText(page)
  expect(after).toContain('</font')
  expect(after).not.toContain('</font>')
})
