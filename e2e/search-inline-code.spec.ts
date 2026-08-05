import { expect, test } from '@playwright/test'
import { openNewDocument } from './helpers'

test('search matches remain visible inside rendered inline code', async ({ page }) => {
  await openNewDocument(page)
  await page.keyboard.insertText('plain needle and `inline needle`')

  const inlineCode = page.locator('.xmd-cm-inline-code')
  await expect(inlineCode).toBeVisible()
  await page.keyboard.press('ControlOrMeta+f')
  const findInput = page.locator('.find-input').first()
  await expect(findInput).toBeFocused()
  await findInput.fill('needle')
  await findInput.press('Enter')

  await expect
    .poll(() =>
      page.evaluate(async () => {
        const modulePath = '/src/features/cm6-editor/activeViewBridge.ts'
        const { cm6ActiveViewBridge } = (await import(modulePath)) as {
          cm6ActiveViewBridge: {
            get(): {
              state: {
                sliceDoc(from: number, to: number): string
                selection: { main: { from: number; to: number } }
              }
            } | null
          }
        }
        const view = cm6ActiveViewBridge.get()
        if (!view) return ''
        const { from, to } = view.state.selection.main
        return view.state.sliceDoc(from, to)
      }),
    )
    .toBe('needle')
  const activeMatch = inlineCode.locator('.xmd-cm-active-search-match')
  await expect(activeMatch).toHaveText('needle')
  const selectedSearchMatchColor = await page
    .locator('.xmd-cm-editor')
    .first()
    .evaluate((editor) => {
      const probe = document.createElement('span')
      probe.className = 'cm-searchMatch-selected'
      probe.textContent = 'probe'
      editor.append(probe)
      const color = getComputedStyle(probe).backgroundColor
      probe.remove()
      return color
    })
  await expect(activeMatch).toHaveCSS('background-color', selectedSearchMatchColor)
})
