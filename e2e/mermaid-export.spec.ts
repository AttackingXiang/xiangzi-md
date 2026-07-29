import { expect, test } from '@playwright/test'
import { openNewDocument } from './helpers'

test('raster export preserves HTML Mermaid labels across tiled capture', async ({ page }) => {
  await openNewDocument(page)
  const leadingText = Array.from({ length: 12 }, (_, index) => `导出前置段落 ${index + 1}`).join(
    '\n\n',
  )
  await page.keyboard.insertText(`${leadingText}

\`\`\`mermaid
flowchart TB
  A["tool.call<br/>执行实际操作"] --> B["maxResultSizeChars 检查<br/>超限则写磁盘返回预览"]
  B --> C["mapToolResultToToolResult<br/>BlockParam"]
  C --> D["renderToolResultMessage<br/>渲染为 React 节点"]
  D --> E["REPL 界面显示结果"]
\`\`\``)

  const previewSvg = page.locator(
    '.xmd-cm-mermaid-preview:not(.is-loading) .xmd-cm-mermaid-content > svg',
  )
  await expect(previewSvg).toBeVisible()
  await expect(previewSvg.locator('foreignObject')).not.toHaveCount(0)

  const exported = await page.evaluate(async () => {
    const modulePath = '/src/features/export/editorDomExport.ts'
    const { createEditorRasterImage, createFullEditorDom } = (await import(modulePath)) as {
      createEditorRasterImage: (format: 'png') => Promise<{
        width: number
        height: number
        chunks: () => AsyncIterable<Uint8Array>
        dispose: () => void
      }>
      createFullEditorDom: () => Promise<HTMLElement>
    }

    const htmlRoot = await createFullEditorDom()
    const htmlForeignObjects = htmlRoot.querySelectorAll(
      '.xmd-cm-mermaid-content foreignObject',
    ).length
    const source = await createEditorRasterImage('png')
    try {
      const rasterRoot = document.querySelector<HTMLElement>(
        '.xmd-export-renderer[aria-hidden="true"]',
      )
      const labelText = rasterRoot?.querySelector('.xmd-cm-mermaid-content')?.textContent ?? ''
      const scroller = rasterRoot?.querySelector<HTMLElement>('.cm-scroller')
      const mermaidBlock = rasterRoot?.querySelector<HTMLElement>('.xmd-cm-mermaid-block')
      const scrollerRect = scroller?.getBoundingClientRect()
      const blockRect = mermaidBlock?.getBoundingClientRect()
      const blockTop =
        scroller && scrollerRect && blockRect
          ? scroller.scrollTop + blockRect.top - scrollerRect.top
          : -1
      const blockBottom =
        scroller && scrollerRect && blockRect
          ? scroller.scrollTop + blockRect.bottom - scrollerRect.top
          : -1
      let bytes = 0
      let chunks = 0
      let rows = 0
      const boundaries: number[] = []
      for await (const chunk of source.chunks()) {
        bytes += chunk.byteLength
        chunks += 1
        rows += chunk.byteLength / (source.width * 4)
        boundaries.push(rows)
      }
      return {
        htmlForeignObjects,
        rasterForeignObjects:
          rasterRoot?.querySelectorAll('.xmd-cm-mermaid-content foreignObject').length ?? -1,
        rasterInlineSvgs:
          rasterRoot?.querySelectorAll('.xmd-cm-mermaid-content > svg').length ?? -1,
        labelText,
        bytes,
        expectedBytes: source.width * source.height * 4,
        chunks,
        boundaries: boundaries.slice(0, -1),
        blockTop,
        blockBottom,
      }
    } finally {
      source.dispose()
    }
  })

  expect(exported.htmlForeignObjects).toBeGreaterThan(0)
  expect(exported.rasterForeignObjects).toBeGreaterThan(0)
  expect(exported.rasterInlineSvgs).toBe(1)
  expect(exported.labelText).toContain('mapToolResultToToolResult')
  expect(exported.labelText).toContain('BlockParam')
  expect(exported.bytes).toBe(exported.expectedBytes)
  expect(exported.chunks).toBeGreaterThan(1)
  expect(exported.blockTop).toBeGreaterThanOrEqual(0)
  expect(
    exported.boundaries.some(
      (boundary) => boundary > exported.blockTop && boundary < exported.blockBottom,
    ),
  ).toBe(false)
})
