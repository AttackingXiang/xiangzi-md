import { expect, type Page } from '@playwright/test'

/**
 * Shared setup for the browser regression suite. NOTE: this whole suite has
 * been written but not run — see docs/ENGINEERING_CONSTRAINTS.md's "测试
 * 金字塔" section for first-run instructions. Selectors/flows below are
 * derived from reading the source (grepped for the real class names — see
 * src/features/cm6-editor/{livePreview,codeBlockPreview}.css/.ts and
 * src/components/Welcome.tsx) rather than from an actual run, so the exact
 * input sequencing (especially around live-preview reveal timing) is the
 * most likely thing to need adjustment once someone runs this for real.
 */

/**
 * Opens the app (which auto-detects browser-preview mode outside Tauri, see
 * src/platform/index.ts and src/main.tsx's `is-browser-preview` body class)
 * and creates a brand-new, empty document via the Welcome screen's "新建文件"
 * action card (src/components/Welcome.tsx) — full control over content,
 * unlike opening the bundled "渲染示例.md" sample. Returns once `.cm-content`
 * (CM6's contenteditable root, see extensions.ts's theme rule of the same
 * name) is attached and focused.
 */
export async function openNewDocument(page: Page): Promise<void> {
  await page.goto('/')
  // Sanity check: outside Tauri the app must have booted into browser-preview
  // mode (body class set by src/main.tsx). If this fails, the suite is being
  // pointed at something other than `npm run dev`'s vite server.
  await expect(page.locator('body')).toHaveClass(/is-browser-preview/)
  // The action cards are only present on the Welcome screen (no tab open
  // yet); '新建文件' is the first of the three (新建文件/打开文件/打开文件夹).
  // Browser-preview settings default to language 'zh' (browserAdapter.ts),
  // and a fresh Playwright context has no persisted settings to override it.
  const newFileCard = page.locator('.action-card', { hasText: '新建文件' })
  await newFileCard.click()

  const content = page.locator('.cm-content')
  await expect(content).toBeVisible()
  await content.click()
  await expect(content).toBeFocused()
}

/** Current line's DOM text content (visible/rendered text, tags collapsed by
 * live preview where applicable) — reads through `.cm-line`, the wrapper CM6
 * puts around every document line unconditionally, not just code lines. */
export async function activeLineText(page: Page): Promise<string> {
  const line = page.locator('.cm-line.cm-activeLine').first()
  return (await line.textContent()) ?? ''
}

/** Full editor document text, reconstructed from every `.cm-line`'s raw text
 * content. Not a substitute for reading CM6 state directly, but good enough
 * for "did the document actually change" assertions from outside the page. */
export async function editorText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const lines = Array.from(document.querySelectorAll('.cm-content > .cm-line'))
    return lines.map((line) => (line as HTMLElement).innerText).join('\n')
  })
}
