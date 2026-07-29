import { expect, test } from '@playwright/test'
import { openNewDocument } from './helpers'

test('raster export preserves a tall Mermaid diagram across tiled capture', async ({ page }) => {
  await openNewDocument(page)
  const leadingText = Array.from({ length: 12 }, (_, index) => `导出前置段落 ${index + 1}`).join(
    '\n\n',
  )
  const mermaidSource = `flowchart TD
  A[模型产生 tool_use block] --> B[tools.ts: getAllBaseTools / getTools]
  B --> C{按 name 查找工具实例}
  C -->|未找到| D[返回 unknown_tool 错误]
  C -->|找到| E[backfillObservableInput\\n展开路径、填充派生字段]
  E --> F[validateInput\\n纯逻辑校验，无 I/O]
  F -->|校验失败| G[返回 validation_error]
  F -->|校验通过| H[checkPermissions\\n权限决策]
  H -->|拒绝| I[返回 permission_denied\\n或弹出审批 UI]
  H -->|允许| J{isConcurrencySafe?}
  J -->|true| K[并发批次\\nrunToolsConcurrently]
  J -->|false| L[串行批次\\nrunToolsSerially]
  K --> M[tool.call\\n执行实际操作]
  L --> M
  M --> N[maxResultSizeChars 检查\\n超限则写磁盘返回预览]
  N --> O[mapToolResultToToolResultBlockParam\\n序列化为 API 格式]
  O --> P[renderToolResultMessage\\n渲染为 React 节点]
  P --> Q[REPL 界面显示结果]`
  await page.keyboard.insertText(`${leadingText}

\`\`\`mermaid
${mermaidSource}
\`\`\`

导出尾部段落`)

  const previewSvg = page.locator(
    '.xmd-cm-mermaid-preview:not(.is-loading) .xmd-cm-mermaid-content > svg',
  )
  await expect(previewSvg).toBeVisible()
  await expect(previewSvg.locator('foreignObject')).not.toHaveCount(0)

  const exported = await page.evaluate(async (sourceText) => {
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
      const { renderMermaidForExport } = (await import('/src/lib/mermaidPreview.ts')) as {
        renderMermaidForExport: (source: string) => Promise<string>
      }
      const pureTemplate = document.createElement('template')
      pureTemplate.innerHTML = await renderMermaidForExport(sourceText)
      const rasterRoot = document.querySelector<HTMLElement>(
        '.xmd-export-renderer[aria-hidden="true"]',
      )
      const labelText = rasterRoot?.querySelector('.xmd-cm-mermaid-content')?.textContent ?? ''
      const mermaidBlock = rasterRoot?.querySelector<HTMLElement>('.xmd-cm-mermaid-block')
      const mermaidSvg = mermaidBlock?.querySelector<SVGSVGElement>('.xmd-cm-mermaid-content > svg')
      const tailLine = Array.from(rasterRoot?.querySelectorAll<HTMLElement>('.cm-line') ?? []).find(
        (line) => line.textContent?.includes('导出尾部段落'),
      )
      const rootRect = rasterRoot?.getBoundingClientRect()
      const blockRect = mermaidBlock?.getBoundingClientRect()
      const svgRect = mermaidSvg?.getBoundingClientRect()
      const tailRect = tailLine?.getBoundingClientRect()
      const blockTop = rootRect && blockRect ? blockRect.top - rootRect.top : -1
      const blockBottom = rootRect && blockRect ? blockRect.bottom - rootRect.top : -1
      const svgTop = rootRect && svgRect ? Math.floor(svgRect.top - rootRect.top) : -1
      const svgBottom = rootRect && svgRect ? Math.ceil(svgRect.bottom - rootRect.top) : -1
      const svgLeft = rootRect && svgRect ? Math.floor(svgRect.left - rootRect.left) : -1
      const svgRight = rootRect && svgRect ? Math.ceil(svgRect.right - rootRect.left) : -1
      const tailTop = rootRect && tailRect ? Math.floor(tailRect.top - rootRect.top) : -1
      const tailLeft = rootRect && tailRect ? Math.floor(tailRect.left - rootRect.left) : -1
      const tailWidth = tailRect ? Math.ceil(tailRect.width) : 0
      const tailHeight = tailRect ? Math.ceil(tailRect.height) : 0
      let bytes = 0
      let rows = 0
      const boundaries: number[] = []
      const coloredPixelsByChunk: number[] = []
      const output = document.createElement('canvas')
      output.width = source.width
      output.height = source.height
      const outputContext = output.getContext('2d')
      if (!outputContext) throw new Error('Unable to create test output canvas')
      for await (const chunk of source.chunks()) {
        const chunkRows = chunk.byteLength / (source.width * 4)
        let coloredPixels = 0
        for (let offset = 0; offset < chunk.length; offset += 4) {
          if (chunk[offset] < 248 || chunk[offset + 1] < 248 || chunk[offset + 2] < 248) {
            coloredPixels += 1
          }
        }
        coloredPixelsByChunk.push(coloredPixels)
        outputContext.putImageData(
          new ImageData(new Uint8ClampedArray(chunk), source.width, chunkRows),
          0,
          rows,
        )
        bytes += chunk.byteLength
        rows += chunkRows
        boundaries.push(rows)
      }

      const rowHasDiagramPixels = (y: number): boolean => {
        const pixels = outputContext.getImageData(svgLeft, y, svgRight - svgLeft, 1).data
        for (let offset = 0; offset < pixels.length; offset += 4) {
          if (pixels[offset] < 248 || pixels[offset + 1] < 248 || pixels[offset + 2] < 248) {
            return true
          }
        }
        return false
      }
      const seamColoredRows = boundaries
        .slice(0, -1)
        .filter((boundary) => boundary > svgTop && boundary < svgBottom)
        .map((boundary) => {
          let coloredRows = 0
          for (let y = boundary - 24; y < boundary + 24; y += 1) {
            if (rowHasDiagramPixels(y)) coloredRows += 1
          }
          return coloredRows
        })
      const tailPixels = outputContext.getImageData(tailLeft, tailTop, tailWidth, tailHeight).data
      let tailColoredPixels = 0
      for (let offset = 0; offset < tailPixels.length; offset += 4) {
        if (
          tailPixels[offset] < 248 ||
          tailPixels[offset + 1] < 248 ||
          tailPixels[offset + 2] < 248
        ) {
          tailColoredPixels += 1
        }
      }

      return {
        htmlForeignObjects,
        pureForeignObjects: pureTemplate.content.querySelectorAll('foreignObject').length,
        pureLabelText: pureTemplate.content.textContent ?? '',
        rasterForeignObjects:
          rasterRoot?.querySelectorAll('.xmd-cm-mermaid-content foreignObject').length ?? -1,
        rasterInlineSvgs:
          rasterRoot?.querySelectorAll('.xmd-cm-mermaid-content > svg').length ?? -1,
        labelText,
        bytes,
        expectedBytes: source.width * source.height * 4,
        coloredPixelsByChunk,
        boundaries: boundaries.slice(0, -1),
        blockTop,
        blockBottom,
        seamColoredRows,
        tailColoredPixels,
      }
    } finally {
      source.dispose()
    }
  }, mermaidSource)

  expect(exported.htmlForeignObjects).toBeGreaterThan(0)
  expect(exported.pureForeignObjects).toBe(0)
  expect(exported.pureLabelText).toContain('mapToolResultToToolResultBlockParam')
  expect(exported.pureLabelText).toContain('序列化为 API 格式')
  expect(exported.rasterForeignObjects).toBeGreaterThan(0)
  expect(exported.rasterInlineSvgs).toBe(1)
  expect(exported.labelText).toContain('mapToolResultToToolResult')
  expect(exported.labelText).toContain('BlockParam')
  expect(exported.bytes).toBe(exported.expectedBytes)
  expect(exported.coloredPixelsByChunk.length).toBeGreaterThan(1)
  expect(exported.coloredPixelsByChunk.every((pixels) => pixels > 0)).toBe(true)
  expect(exported.blockTop).toBeGreaterThanOrEqual(0)
  expect(exported.boundaries.some((boundary) => boundary > exported.blockTop)).toBe(true)
  expect(exported.seamColoredRows.length).toBeGreaterThan(1)
  expect(exported.seamColoredRows.every((rows) => rows >= 24)).toBe(true)
  expect(exported.tailColoredPixels).toBeGreaterThan(0)
})
