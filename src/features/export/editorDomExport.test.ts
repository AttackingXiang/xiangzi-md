import { describe, expect, it } from 'vitest'
import { exportRasterViewportHeight } from './editorDomExport'

describe('DOM image export viewport', () => {
  it('never makes a CM6 raster tile taller than the visible WebView', () => {
    expect(exportRasterViewportHeight(900)).toBe(900)
    expect(exportRasterViewportHeight(4_096)).toBe(2_048)
    expect(exportRasterViewportHeight(0)).toBe(1)
  })
})
