import { expect, test } from '@playwright/test'
import { openNewDocument } from './helpers'

/**
 * Historical bug (fixed in commit 8dff016, "unified code select-all"):
 * Cmd/Ctrl+A with the caret inside a fenced code block must select only the
 * code body — mirroring the block's copy-button semantics — instead of the
 * whole document. Two code paths (the module's own Mod-a keymap and the
 * app-level selectAllScope) had drifted apart; both now resolve through
 * `fencedCodeContentRange` (src/features/cm6-editor/codeBlockPreview.ts), and
 * this test pins the user-visible behaviour.
 *
 */
test('Cmd/Ctrl+A inside a fenced code block selects only the code body', async ({ page }) => {
  await openNewDocument(page)

  // Build: a paragraph, then a closed fenced block with a two-line body.
  // Typed exactly like a user would: opening fence, body lines, closing
  // fence. Nothing auto-closes the fence (no closeBrackets extension), so the
  // final ``` line is what completes the block.
  await page.keyboard.type('intro paragraph')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.type('```js')
  await page.keyboard.press('Enter')
  await page.keyboard.type('const alpha = 1')
  await page.keyboard.press('Enter')
  await page.keyboard.type('const beta = 2')
  await page.keyboard.press('Enter')
  await page.keyboard.type('```')

  // Once the block closes, code rows are wrapped in .xmd-cm-code-line-content
  // spans (buildCodeBlockPreviewDecorations). Waiting for the second body
  // line's span both confirms the fence parsed as a complete block and gives
  // us a click target inside the body.
  const secondBodyLine = page.locator('.xmd-cm-code-line-content', { hasText: 'const beta' })
  await expect(secondBodyLine).toBeVisible()
  await secondBodyLine.click()

  // Playwright keyboard events are trusted, so CM6's Mod-a keymap receives
  // this exactly like a real user press. 'ControlOrMeta' maps to Meta on
  // darwin and Control elsewhere.
  await page.keyboard.press('ControlOrMeta+a')

  // The selection must be exactly the code body: both lines, no fences
  // (``` / ```js), no surrounding paragraph. Historical failure mode was the
  // whole document getting selected. Read the *browser* selection — inside a
  // single code block the editor presents selection natively
  // (xmd-cm-native-code-selection), and CM6 keeps the DOM selection in sync
  // with its state selection either way.
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ''))
    .toBe('const alpha = 1\nconst beta = 2')
})
