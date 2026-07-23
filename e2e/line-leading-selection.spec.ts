import { expect, test, type Locator, type Page } from '@playwright/test'
import { openNewDocument } from './helpers'

interface SelectionProbe {
  selectedText: string
  visibleTextCovered: boolean
}

async function dragFromVisibleStartToPreviousLine(
  page: Page,
  line: Locator,
  previousLine: Locator,
): Promise<SelectionProbe> {
  const geometry = await line.evaluate((element) => {
    const prefixes = element.querySelectorAll<HTMLElement>('.xmd-cm-preserved-hidden-source')
    const prefix = prefixes.item(prefixes.length - 1)
    if (!prefix) return null
    const lineRect = element.getBoundingClientRect()
    const prefixRect = prefix.getBoundingClientRect()
    return {
      start: {
        x: prefixRect.right + 1,
        y: lineRect.top + lineRect.height / 2,
      },
      visibleTextPoint: {
        x: prefixRect.right + 24,
        y: lineRect.top + lineRect.height / 2,
      },
    }
  })
  const previous = await previousLine.boundingBox()
  expect(geometry).not.toBeNull()
  expect(previous).not.toBeNull()

  await page.mouse.move(geometry!.start.x, geometry!.start.y)
  await page.mouse.down()
  await page.mouse.move(previous!.x + 32, previous!.y + previous!.height / 2, { steps: 8 })
  await page.mouse.up()

  return page.evaluate((visibleTextPoint) => {
    const selectedText = window.getSelection()?.toString() ?? ''
    const visibleTextCovered = Array.from(
      document.querySelectorAll<HTMLElement>('.cm-selectionBackground'),
    ).some((element) => {
      const rect = element.getBoundingClientRect()
      return (
        visibleTextPoint.x >= rect.left &&
        visibleTextPoint.x <= rect.right &&
        visibleTextPoint.y >= rect.top &&
        visibleTextPoint.y <= rect.bottom
      )
    })
    return { selectedText, visibleTextCovered }
  }, geometry!.visibleTextPoint)
}

test('cross-line reverse selections do not paint unselected line-leading content', async ({
  page,
}) => {
  await openNewDocument(page)
  await page.keyboard.insertText(
    [
      '```ts',
      'const heading = 1',
      '```',
      '',
      '## 标题端点',
      '',
      '引用上一行',
      '> 引用端点',
      '',
      '粗体上一行',
      '**粗体端点**',
      '',
      '斜体上一行',
      '*斜体端点*',
      '',
      '删除线上一行',
      '~~删除线端点~~',
      '',
      '代码上一行',
      '`代码端点`',
      '',
      '链接上一行',
      '[链接端点](https://example.com)',
      '',
      'HTML上一行',
      '<font color="#f00">HTML端点</font>',
      '',
      '嵌套上一行',
      '> ## **嵌套端点**',
    ].join('\n'),
  )

  const cases = [
    { target: '标题端点', previous: 'const heading = 1', prefixCount: 1 },
    { target: '引用端点', previous: '引用上一行', prefixCount: 1 },
    { target: '粗体端点', previous: '粗体上一行', prefixCount: 1 },
    { target: '斜体端点', previous: '斜体上一行', prefixCount: 1 },
    { target: '删除线端点', previous: '删除线上一行', prefixCount: 1 },
    { target: '代码端点', previous: '代码上一行', prefixCount: 1 },
    { target: '链接端点', previous: '链接上一行', prefixCount: 1 },
    { target: 'HTML端点', previous: 'HTML上一行', prefixCount: 1 },
    { target: '嵌套端点', previous: '嵌套上一行', prefixCount: 3 },
  ]

  for (const item of cases) {
    const line = page.locator('.cm-line', { hasText: item.target })
    const previousLine = page.locator('.cm-line', { hasText: item.previous })
    await line.scrollIntoViewIfNeeded()
    await expect(line).toBeVisible()
    await expect(line.locator('.xmd-cm-preserved-hidden-source')).toHaveCount(item.prefixCount)

    const result = await dragFromVisibleStartToPreviousLine(page, line, previousLine)

    // The drag ends 32px into the previous row, so only its suffix is
    // intentionally selected; the exact character varies with font metrics.
    expect(result.selectedText).toContain(item.previous.slice(-2))
    expect(result.selectedText).not.toContain(item.target)
    expect(result.visibleTextCovered, item.target).toBe(false)
  }
})
