import { describe, expect, it } from 'vitest'
import { exportRasterViewportHeight, rowsBeforeUnsplittableBlock } from './editorDomExport'

describe('DOM image export viewport', () => {
  it('never makes a CM6 raster tile taller than the visible WebView', () => {
    expect(exportRasterViewportHeight(900)).toBe(900)
    expect(exportRasterViewportHeight(4_096)).toBe(2_048)
    expect(exportRasterViewportHeight(0)).toBe(1)
  })

  it('ends a raster tile before a rendered block that would cross its boundary', () => {
    expect(
      rowsBeforeUnsplittableBlock(0, 600, 600, [
        { top: 480.4, bottom: 710.2 },
        { top: 900, bottom: 980 },
      ]),
    ).toBe(480)
  })

  it('keeps the normal tile size when blocks fit or cannot fit in one viewport', () => {
    expect(rowsBeforeUnsplittableBlock(0, 600, 600, [{ top: 300, bottom: 500 }])).toBe(600)
    expect(rowsBeforeUnsplittableBlock(0, 600, 600, [{ top: 480, bottom: 1_200 }])).toBe(600)
  })
})
