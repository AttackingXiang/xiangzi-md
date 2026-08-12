import { expect, test } from '@playwright/test'
import { activeLineText, openNewDocument } from './helpers'

/**
 * Live preview hides matched inline HTML tag pairs (`<font …>…</font>`) as
 * unconditionally-atomic hidden ranges — at every caret position, so putting
 * the caret into coloured text to edit it never reflows the line into markup.
 *
 * That makes deletion the only way the tags can go, and it must not be a dead
 * key: the historical bug (fixed in commit 8dff016, then reworked when the
 * tags stopped revealing) was Backspace at the closing tag's right boundary
 * hitting an atomic range and doing nothing at all. Backspace there now
 * removes the whole wrapper and keeps the text (livePreview.ts,
 * `inlineHtmlUnwrapDeletion`).
 *
 * Everything here is asserted through what the user can see: the rendered line
 * text (the source is hidden by design) and the colour mark live preview
 * paints over the span.
 */
test('backspace at the </font> boundary removes the colour and keeps the text', async ({
  page,
}) => {
  await openNewDocument(page)

  // Type a paragraph whose middle is a colored inline HTML span. There is no
  // bracket/tag auto-closing in the editor (createBaseExtensions has no
  // closeBrackets), so this arrives verbatim as document text.
  await page.keyboard.type('前缀<font color="#ff0000">红字</font>后缀')

  // Both tags are hidden, so the line reads as plain text and the colour is
  // carried by a decoration instead.
  await expect.poll(() => activeLineText(page)).toBe('前缀红字后缀')
  const colored = page.locator('.cm-line .xmd-cm-inline-color')
  await expect(colored).toHaveText('红字')

  // Step the caret left over 后缀 (2 characters) onto the closing tag's right
  // boundary. ArrowLeft moves by one character per press; the hidden close
  // tag is atomic, so after two presses the caret rests exactly at `>`.
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')

  // Sitting on the boundary must not surface the raw tags either.
  expect(await activeLineText(page)).toBe('前缀红字后缀')

  await page.keyboard.press('Backspace')

  // Not a dead key (the colour is gone), not a half-deleted tag (no markup
  // leaked into the line), and the words survived.
  await expect(colored).toHaveCount(0)
  expect(await activeLineText(page)).toBe('前缀红字后缀')
})
