import { expect, test, type Locator, type Page } from '@playwright/test'
import { openNewDocument } from './helpers'

interface EdgeStyles {
  borderBottomWidth: string
  borderLeftWidth: string
  borderRightWidth: string
  borderTopWidth: string
  zIndex: string
}

async function selectDocumentRange(page: Page, from: number, to: number) {
  await page.evaluate(
    async ({ rangeFrom, rangeTo }) => {
      const modulePath = '/src/features/cm6-editor/activeViewBridge.ts'
      const { cm6ActiveViewBridge } = (await import(modulePath)) as {
        cm6ActiveViewBridge: {
          get(): { dispatch(spec: { selection: { anchor: number; head: number } }): void } | null
        }
      }
      cm6ActiveViewBridge.get()?.dispatch({ selection: { anchor: rangeFrom, head: rangeTo } })
    },
    { rangeFrom: from, rangeTo: to },
  )
}

async function pseudoEdgeStyles(locator: Locator): Promise<EdgeStyles> {
  return locator.evaluate((element): EdgeStyles => {
    const styles = getComputedStyle(element, '::after')
    return {
      borderBottomWidth: styles.borderBottomWidth,
      borderLeftWidth: styles.borderLeftWidth,
      borderRightWidth: styles.borderRightWidth,
      borderTopWidth: styles.borderTopWidth,
      zIndex: styles.zIndex,
    }
  })
}

test('selected thematic breaks keep their foreground rule', async ({ page }) => {
  await openNewDocument(page)
  await page.keyboard.insertText('---\n\nafter')

  const rule = page.locator('.xmd-cm-horizontal-rule-widget')
  await expect(rule).toHaveCount(1)
  await selectDocumentRange(page, 0, 3)

  await expect(page.locator('.cm-editor')).toHaveClass(/xmd-cm-native-line-selection/)
  await expect
    .poll(() => pseudoEdgeStyles(rule))
    .toMatchObject({
      borderTopWidth: '1px',
      zIndex: '1',
    })
})

test('selected code blocks keep all foreground card edges', async ({ page }) => {
  await openNewDocument(page)
  const markdown = '```ts\nconst alpha = 1\nconst beta = 2\n```'
  await page.keyboard.insertText(markdown)

  const firstLine = page.locator('.cm-line.xmd-cm-code-line-first')
  const lastLine = page.locator('.cm-line.xmd-cm-code-line-last')
  await expect(firstLine).toBeVisible()
  await expect(lastLine).toBeVisible()

  const bodyFrom = markdown.indexOf('const alpha')
  const bodyTo = markdown.indexOf('\n```')
  await selectDocumentRange(page, bodyFrom, bodyTo)

  await expect(page.locator('.cm-editor')).toHaveClass(/xmd-cm-native-code-selection/)
  await expect
    .poll(() => pseudoEdgeStyles(firstLine))
    .toMatchObject({
      borderLeftWidth: '1px',
      borderRightWidth: '1px',
      borderTopWidth: '1px',
      zIndex: '1',
    })
  await expect
    .poll(() => pseudoEdgeStyles(lastLine))
    .toMatchObject({
      borderBottomWidth: '1px',
      borderLeftWidth: '1px',
      borderRightWidth: '1px',
      zIndex: '1',
    })
})

test('single-line and cross-paragraph selections use the same background color', async ({
  page,
}) => {
  await openNewDocument(page)
  const markdown = 'first paragraph\n\nsecond paragraph'
  await page.keyboard.insertText(markdown)

  await selectDocumentRange(page, 0, 'first'.length)
  const editor = page.locator('.cm-editor')
  await expect(editor).toHaveClass(/xmd-cm-native-line-selection/)
  const nativeColor = await page
    .locator('.cm-content')
    .evaluate((element) =>
      getComputedStyle(element, '::selection').getPropertyValue('background-color'),
    )

  await selectDocumentRange(page, 0, markdown.length)
  await expect(editor).not.toHaveClass(/xmd-cm-native-selection/)
  const paintedSelections = page.locator('.cm-selectionBackground')
  await expect(paintedSelections.first()).toBeVisible()
  const cm6Colors = await paintedSelections.evaluateAll((elements) =>
    Array.from(new Set(elements.map((element) => getComputedStyle(element).backgroundColor))),
  )

  expect(cm6Colors).toEqual([nativeColor])
})
